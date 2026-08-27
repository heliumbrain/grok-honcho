/**
 * Spawn each hook entrypoint with a fixture HOME against an unreachable Honcho.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseHookHealth } from "../src/log.js";

const homes: string[] = [];
const repo = join(import.meta.dir, "..");

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function unreachableConfig(extra: Record<string, unknown> = {}) {
  return {
    apiKey: "test-key-not-real",
    peerName: "tester",
    endpoint: { baseUrl: "http://127.0.0.1:1" },
    logging: true,
    hosts: { grok: { enabled: true } },
    ...extra,
  };
}

async function runHook(
  entry: string,
  stdin: Record<string, unknown>,
  config: unknown = unreachableConfig(),
): Promise<{ exitCode: number; log: string; home: string; cwd: string; stdout: string }> {
  const home = mkdtempSync(join(tmpdir(), "grok-honcho-hook-"));
  homes.push(home);
  const cwd = join(home, "proj");
  mkdirSync(join(home, ".honcho"));
  mkdirSync(cwd);
  writeFileSync(join(home, ".honcho", "config.json"), JSON.stringify(config));

  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  const proc = Bun.spawn(["bun", "run", join(repo, "hooks", entry)], {
    cwd: repo,
    env: { ...env, HOME: home, HONCHO_HOST: "grok", GROK_PLUGIN_ROOT: repo },
    stdin: new TextEncoder().encode(JSON.stringify({ cwd, workspaceRoot: cwd, ...stdin })),
    stdout: "pipe",
    stderr: "pipe",
  });

  const killer = setTimeout(() => proc.kill(), 15_000);
  const exitCode = await proc.exited;
  clearTimeout(killer);

  const logPath = join(home, ".honcho", "activity.log");
  const log = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
  const stdout = await new Response(proc.stdout).text();
  return { exitCode, log, home, cwd, stdout };
}

describe("hook stdin", () => {
  test("session-start fail-opens when Honcho is unreachable", async () => {
    const { exitCode, log, cwd } = await runHook("session-start.ts", {
      sessionId: "s1",
      source: "startup",
    });
    expect(exitCode).toBe(0);
    expect(log).toContain("grok-honcho:session-start");
    expect(parseHookHealth(log, cwd).lastSessionStartAt).not.toBeNull();
  });

  test("user-prompt skips harness-injected content", async () => {
    const { exitCode, log } = await runHook("user-prompt.ts", {
      prompt: "<system-reminder>do not save</system-reminder>",
    });
    expect(exitCode).toBe(0);
    expect(log).toContain("Skipping upload (harness-injected content)");
  });

  test("user-prompt skips when saveMessages is false", async () => {
    const { exitCode, log } = await runHook(
      "user-prompt.ts",
      { prompt: "please remember this" },
      unreachableConfig({ hosts: { grok: { enabled: true, saveMessages: false } } }),
    );
    expect(exitCode).toBe(0);
    expect(log).not.toContain("Saved user prompt");
  });

  test("stop skips when stopHookActive", async () => {
    const { exitCode, log } = await runHook("stop.ts", {
      stopHookActive: true,
      lastAssistantMessage: "should not save",
      reason: "end_turn",
    });
    expect(exitCode).toBe(0);
    expect(log).toContain("Skipping (stopHookActive=true)");
  });

  test("session-end logs locally", async () => {
    const { exitCode, log } = await runHook("session-end.ts", { reason: "end" });
    expect(exitCode).toBe(0);
    expect(log).toContain("Session ended");
  });

  test("pre-compact fail-opens on unreachable Honcho and writes no stdout", async () => {
    const { exitCode, log, stdout } = await runHook("pre-compact.ts", {
      hookEventName: "PreCompact",
      trigger: "auto",
    });
    expect(exitCode).toBe(0);
    expect(log).toContain("grok-honcho:pre-compact");
    expect(stdout.trim()).toBe("");
  });

  test("post-tool-use skips trivial bash and redacts significant commands", async () => {
    const skip = await runHook("post-tool-use.ts", {
      toolName: "run_terminal_command",
      toolInput: { command: "ls -la" },
    });
    expect(skip.exitCode).toBe(0);
    expect(skip.log).not.toContain("Ran:");

    const ran = await runHook("post-tool-use.ts", {
      toolName: "run_terminal_command",
      toolInput: { command: "export HONCHO_API_KEY=hch-abcdefghijklmnopqrstuvwxyz bun test" },
    });
    expect(ran.exitCode).toBe(0);
    expect(ran.log).toContain("HONCHO_API_KEY=***");
    expect(ran.log).not.toContain("hch-abcdefghijklmnopqrstuvwxyz");
  });
});
