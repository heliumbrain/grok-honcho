#!/usr/bin/env bun
import { initHook } from "../src/config.js";
import { recordMcpToolActivity } from "../src/hooks/mcp-tool-activity.js";

recordMcpToolActivity(await initHook());
