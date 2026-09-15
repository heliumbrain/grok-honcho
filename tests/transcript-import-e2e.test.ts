import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const homes: string[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];

function toolText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "";
}

async function withMcp(
  config: unknown,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "grok-honcho-import-home-"));
  homes.push(home);
  mkdirSync(join(home, ".honcho"));
  writeFileSync(join(home, ".honcho", "config.json"), JSON.stringify(config));
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(import.meta.dir, "../mcp-server.ts")],
    cwd: join(import.meta.dir, ".."),
    env: { ...env, HOME: home, HONCHO_HOST: "grok", GROK_PLUGIN_ROOT: join(import.meta.dir, "..") },
    stderr: "pipe",
  });
  const client = new Client({ name: "grok-honcho-import-test", version: "1.0.0" });
  try { await client.connect(transport); await fn(client); } finally { await client.close(); }
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("transcript import end to end", () => {
  test("uses the local Honcho API, associates directional peers before messages, and records imports", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        const body = request.method === "POST" || request.method === "PUT" ? await request.json() : undefined;
        calls.push({ path, body });
        const now = "2024-01-01T00:00:00.000Z";
        if (path === "/v3/workspaces") return Response.json({ id: "test", metadata: {}, configuration: {}, created_at: now });
        if (path.endsWith("/peers")) {
          const id = (body as { id: string }).id;
          return Response.json({ id, workspace_id: "test", metadata: {}, configuration: {}, created_at: now });
        }
        if (path.endsWith("/sessions") && !path.endsWith("/peers")) {
          const id = (body as { id: string }).id;
          return Response.json({ id, workspace_id: "test", is_active: true, metadata: {}, configuration: {}, created_at: now });
        }
        if (path.endsWith("/messages")) {
          return Response.json(((body as { messages: Array<{ peer_id: string; content: string; metadata: object; created_at: string }> }).messages).map((message, index) => ({
            id: `message-${index}`, peer_id: message.peer_id, session_id: "unused", workspace_id: "test", content: message.content,
            metadata: message.metadata, created_at: message.created_at, token_count: 1,
          })));
        }
        return new Response(null, { status: 204 });
      },
    });
    servers.push(server);
    const fixture = join(import.meta.dir, "fixtures", "updates.jsonl");
    await withMcp({
      apiKey: "local-test-key", peerName: "user", aiPeer: "grok", workspace: "test",
      hosts: { grok: { enabled: true, observationMode: "directional", endpoint: { baseUrl: `http://127.0.0.1:${server.port}` } } },
    }, async (client) => {
      const previewResult = await client.callTool({ name: "import_grok_transcript", arguments: { path: fixture } });
      const preview = JSON.parse(toolText(previewResult as { content: Array<{ type: string; text?: string }> }));
      expect(preview).toMatchObject({ dryRun: true, selectedEvents: 3 });
      const importedResult = await client.callTool({
        name: "import_grok_transcript", arguments: { path: fixture, confirm: true, preview_token: preview.previewToken },
      });
      expect(JSON.parse(toolText(importedResult as { content: Array<{ type: string; text?: string }> }))).toMatchObject({
        dryRun: false, uploaded: 3, skipped: 0,
      });
    });
    const peerCalls = calls.filter((call) => call.path.endsWith("/peers") && call.path.includes("/sessions/"));
    const messageCalls = calls.filter((call) => call.path.endsWith("/messages"));
    expect(peerCalls).toHaveLength(2);
    expect(peerCalls.every((call) => JSON.stringify(call.body).includes('"grok":{"observe_others":true}'))).toBe(true);
    expect(messageCalls).toHaveLength(3);
    for (const message of messageCalls) {
      expect(calls.indexOf(peerCalls.find((peer) => peer.path.split("/peers")[0] === message.path.split("/messages")[0])!)).toBeLessThan(calls.indexOf(message));
    }
  });
});
