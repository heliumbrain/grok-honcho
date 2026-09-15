import { describe, expect, test } from "bun:test";
import { parseHookHealth } from "../src/log.js";

const entry = (timestamp: string, source: string, cwd = "/repo") =>
  JSON.stringify({ timestamp, source, cwd, plugin: "grok-honcho" });

describe("hook health", () => {
  test("reports the latest hook activity for the current project", () => {
    const health = parseHookHealth(
      [
        entry("2026-08-12T10:00:00.000Z", "grok-honcho:session-start"),
        entry("2026-08-12T10:01:00.000Z", "grok-honcho:user-prompt"),
        entry("2026-08-12T10:02:00.000Z", "grok-honcho:stop"),
      ].join("\n"),
      "/repo",
    );

    expect(health).toEqual({
      lastActivityAt: "2026-08-12T10:02:00.000Z",
      lastSessionStartAt: "2026-08-12T10:00:00.000Z",
      lastUserPromptAt: "2026-08-12T10:01:00.000Z",
      lastStopAt: "2026-08-12T10:02:00.000Z",
      lastMcpToolAt: null,
      lastMcpToolSuccessAt: null,
      lastMcpToolErrorAt: null,
      lastMcpTool: null,
    });
  });

  test("reports the latest qualified MCP outcome without arguments or results", () => {
    const health = parseHookHealth(
      [
        JSON.stringify({
          timestamp: "2026-08-12T10:03:00.000Z",
          source: "grok-honcho:mcp-tool",
          message: "MCP success: honcho__get_config",
          timing: 12,
          session: "user-repo",
          cwd: "/repo",
          toolInput: { apiKey: "secret" },
          toolResponse: { content: "private memory" },
        }),
        JSON.stringify({
          timestamp: "2026-08-12T10:04:00.000Z",
          source: "grok-honcho:mcp-tool",
          message: "MCP error: honcho__honcho_remember",
          timing: 20,
          session: "user-repo",
          cwd: "/repo",
        }),
      ].join("\n"),
      "/repo",
    );

    expect(health.lastMcpToolSuccessAt).toBe("2026-08-12T10:03:00.000Z");
    expect(health.lastMcpToolErrorAt).toBe("2026-08-12T10:04:00.000Z");
    expect(health.lastMcpTool).toEqual({
      name: "honcho__honcho_remember",
      outcome: "error",
      durationMs: 20,
      session: "user-repo",
    });
  });


  test("ignores malformed, other-plugin, and other-project entries", () => {
    const health = parseHookHealth(
      [
        "{bad json",
        entry("2026-08-12T10:00:00.000Z", "claude-honcho:stop"),
        entry("2026-08-12T10:01:00.000Z", "grok-honcho:stop", "/other"),
      ].join("\n"),
      "/repo",
    );

    expect(health.lastActivityAt).toBeNull();
  });
});
