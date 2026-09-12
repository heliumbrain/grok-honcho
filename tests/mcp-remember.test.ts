import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function toolText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "";
}

async function withMcp(
  config: unknown,
  fn: (client: Client) => Promise<void>,
  extraEnv: Record<string, string> = {},
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "grok-honcho-home-"));
  homes.push(home);
  mkdirSync(join(home, ".honcho"));
  writeFileSync(join(home, ".honcho", "config.json"), JSON.stringify(config));

  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", join(import.meta.dir, "../mcp-server.ts")],
    cwd: join(import.meta.dir, ".."),
    env: {
      ...env,
      HOME: home,
      HONCHO_HOST: "grok",
      GROK_PLUGIN_ROOT: join(import.meta.dir, ".."),
      ...extraEnv,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "grok-honcho-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    await fn(client);
  } finally {
    await client.close();
  }
}

describe("MCP honcho_remember", () => {
  test("is hidden by default and errors if called while off", async () => {
    await withMcp(
      {
        apiKey: "test-key-not-real",
        peerName: "tester",
        hosts: { grok: { enabled: true } },
      },
      async (client) => {
        const listed = await client.listTools();
        expect(listed.tools.map((t) => t.name)).not.toContain("honcho_remember");
        expect(listed.tools.map((t) => t.name)).toContain("schedule_dream");

        const off = await client.callTool({
          name: "honcho_remember",
          arguments: { queries: ["who am I?"], reasoning_level: "low" },
        });
        const offResult = off as { isError?: boolean; content: Array<{ type: string; text?: string }> };
        expect(offResult.isError).toBe(true);
        expect(toolText(offResult)).toContain("honcho_remember is off");
      },
    );
  });

  test("appears after set_config rememberTool=true and validates args without Honcho", async () => {
    await withMcp(
      {
        apiKey: "test-key-not-real",
        peerName: "tester",
        hosts: { grok: { enabled: true } },
      },
      async (client) => {
        const changed = await client.callTool({
          name: "set_config",
          arguments: { field: "rememberTool", value: true },
        });
        expect(changed.isError).not.toBe(true);

        const listed = await client.listTools();
        const remember = listed.tools.find((t) => t.name === "honcho_remember");
        expect(remember).toBeDefined();
        expect(remember?.inputSchema).toMatchObject({ required: ["queries", "reasoning_level"] });

        const missing = await client.callTool({ name: "honcho_remember", arguments: {} });
        const missingResult = missing as {
          isError?: boolean;
          content: Array<{ type: string; text?: string }>;
        };
        expect(missingResult.isError).toBe(true);
        expect(toolText(missingResult)).toContain("non-empty `queries` array");

        const tooMany = await client.callTool({
          name: "honcho_remember",
          arguments: {
            queries: ["a", "b", "c", "d", "e", "f"],
            reasoning_level: "low",
          },
        });
        const tooManyResult = tooMany as {
          isError?: boolean;
          content: Array<{ type: string; text?: string }>;
        };
        expect(tooManyResult.isError).toBe(true);
        expect(toolText(tooManyResult)).toContain("at most 5 queries");

        const badLevel = await client.callTool({
          name: "honcho_remember",
          arguments: { queries: ["who am I?"], reasoning_level: "max" },
        });
        const badLevelResult = badLevel as {
          isError?: boolean;
          content: Array<{ type: string; text?: string }>;
        };
        expect(badLevelResult.isError).toBe(true);
        expect(toolText(badLevelResult)).toContain("low, medium, high");
      },
    );
  });
});

describe("MCP schedule_dream", () => {
  test("is always listed", async () => {
    await withMcp(
      {
        apiKey: "test-key-not-real",
        peerName: "tester",
        hosts: { grok: { enabled: true } },
      },
      async (client) => {
        const listed = await client.listTools();
        const dream = listed.tools.find((t) => t.name === "schedule_dream");
        expect(dream).toBeDefined();
        expect(dream?.description ?? "").toContain("memory consolidation");
      },
    );
  });
});

describe("MCP get_config apiKeySource", () => {
  test("reports host when only hosts.grok.apiKey is set", async () => {
    await withMcp(
      {
        peerName: "tester",
        hosts: { grok: { enabled: true, apiKey: "host-only-key" } },
      },
      async (client) => {
        const status = await client.callTool({ name: "get_config", arguments: {} });
        const config = JSON.parse(toolText(status as { content: Array<{ type: string; text?: string }> }));
        expect(config.resolved.apiKeySource).toBe("host");
        expect(config.resolved.apiKey).toBeUndefined();
      },
    );
  });

  test("warns when HONCHO_API_KEY shadows the file key", async () => {
    await withMcp(
      {
        apiKey: "root-key",
        peerName: "tester",
        hosts: { grok: { enabled: true } },
      },
      async (client) => {
        const status = await client.callTool({ name: "get_config", arguments: {} });
        const config = JSON.parse(toolText(status as { content: Array<{ type: string; text?: string }> }));
        expect(config.resolved.apiKeySource).toBe("env");
        expect(config.warnings.some((w: string) => w.includes("HONCHO_API_KEY"))).toBe(true);
      },
      { HONCHO_API_KEY: "env-key" },
    );
  });
});
