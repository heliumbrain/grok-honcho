#!/usr/bin/env bun
process.env.HONCHO_HOST = process.env.HONCHO_HOST || "grok";
import { runMcpServer } from "./src/mcp/server.js";

await runMcpServer();
