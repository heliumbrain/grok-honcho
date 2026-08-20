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

describe("MCP conclusions", () => {
  test("lists query/delete tools and rejects missing args without reaching Honcho", async () => {
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
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name);
      expect(names).toContain("query_conclusions");
      expect(names).toContain("delete_conclusion");
      const search = listed.tools.find((t) => t.name === "search");
      expect(search?.description ?? "").toContain("conclusions");

      const missingQuery = await client.callTool({ name: "query_conclusions", arguments: {} });
      const missingQueryResult = missingQuery as {
        isError?: boolean;
        content: Array<{ type: string; text?: string }>;
      };
      expect(missingQueryResult.isError).toBe(true);
      expect(missingQueryResult.content[0]).toMatchObject({ type: "text", text: "Error: query required" });

      const missingId = await client.callTool({ name: "delete_conclusion", arguments: {} });
      const missingIdResult = missingId as {
        isError?: boolean;
        content: Array<{ type: string; text?: string }>;
      };
      expect(missingIdResult.isError).toBe(true);
      expect(missingIdResult.content[0]).toMatchObject({ type: "text", text: "Error: id required" });
    } finally {
      await client.close();
    }
  });
});
