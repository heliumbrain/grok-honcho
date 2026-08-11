#!/usr/bin/env bun
/**
 * MCP entry — stdout is JSON-RPC only. Never log to stdout here.
 * Launch via: bun run ${CLAUDE_PLUGIN_ROOT}/mcp-server.ts
 * (Do not wrap with bun install; that pollutes stdout and breaks the handshake.)
 */
process.env.HONCHO_HOST = process.env.HONCHO_HOST || "grok";
// Bun: ensure stdin delivers data events for the MCP SDK transport
if (typeof process.stdin.resume === "function") {
  process.stdin.resume();
}
import { runMcpServer } from "./src/mcp/server.js";

await runMcpServer();
