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

describe("MCP config", () => {
  test("applies enabled changes without restarting the server", async () => {
    const home = mkdtempSync(join(tmpdir(), "grok-honcho-home-"));
    homes.push(home);
    mkdirSync(join(home, ".honcho"));
    writeFileSync(
      join(home, ".honcho", "config.json"),
      JSON.stringify({
        apiKey: "test-key-not-real",
        peerName: "tester",
        hosts: { grok: { enabled: true } },
      }),
    );

    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", join(import.meta.dir, "../mcp-server.ts")],
      cwd: join(import.meta.dir, ".."),
      env: { ...env, HOME: home, HONCHO_HOST: "grok", GROK_PLUGIN_ROOT: join(import.meta.dir, "..") },
      stderr: "pipe",
    });
    const client = new Client({ name: "grok-honcho-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const changed = await client.callTool({
        name: "set_config",
        arguments: { field: "enabled", value: false },
      });
      expect(changed.isError).not.toBe(true);

      const search = await client.callTool({
        name: "search",
        arguments: { query: "must not reach Honcho" },
      });
      const searchResult = search as {
        isError?: boolean;
        content: Array<{ type: string; text?: string }>;
      };
      expect(searchResult.isError).toBe(true);
      expect(searchResult.content[0]).toMatchObject({
        type: "text",
        text: "Error: Honcho is disabled. Use set_config to enable it.",
      });

      const status = await client.callTool({ name: "get_config", arguments: {} });
      const statusResult = status as { content: Array<{ type: string; text?: string }> };
      const text =
        statusResult.content[0]?.type === "text" ? (statusResult.content[0].text ?? "{}") : "{}";
      const config = JSON.parse(text);
      expect(config.resolved.enabled).toBe(false);
      expect(config.plugin).toEqual({ name: "grok-honcho", version: "0.1.3" });
    } finally {
      await client.close();
    }
  });
});
