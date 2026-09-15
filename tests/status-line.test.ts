import { describe, expect, test } from "bun:test";
import {
  getStatusAssociation,
  parseStatusActivity,
  parseStatusLineConfig,
  parseStatusLineInput,
  renderStatusLine,
} from "../src/status-line.js";

const entry = (timestamp: string, source: string, cwd = "/work/app", extra: Record<string, unknown> = {}) =>
  JSON.stringify({ timestamp, source, cwd, ...extra });

describe("status line", () => {
  test("renders only local association and latest successful activity", () => {
    const config = parseStatusLineConfig(JSON.stringify({ apiKey: "secret-not-rendered", peerName: "Ada" }));
    const activity = parseStatusActivity(entry("2026-09-15T07:00:00.000Z", "grok-honcho:mcp"), "/work/app");
    expect(renderStatusLine({ config, association: getStatusAssociation("/work/app", config, null), activity }, Date.parse("2026-09-15T07:04:00.000Z"))).toBe("Honcho · ada-app · 4m ago");
  });

  test("reports disabled, unconfigured, stale, and failed local states without content", () => {
    expect(renderStatusLine({ config: parseStatusLineConfig(null), association: null, activity: { timestamp: null, degraded: false } })).toBe("Honcho: setup");
    expect(renderStatusLine({ config: parseStatusLineConfig(JSON.stringify({ apiKey: "x", enabled: false })), association: null, activity: { timestamp: null, degraded: false } })).toBe("Honcho: off");
    const activity = parseStatusActivity([
      entry("2026-09-15T06:00:00.000Z", "grok-honcho:stop"),
      entry("2026-09-15T06:01:00.000Z", "grok-honcho:mcp-tool", "/work/app", { level: "hook", success: false, message: "MCP error: honcho__get_config" }),
    ].join("\n"), "/work/app");
    expect(renderStatusLine({ config: parseStatusLineConfig(JSON.stringify({ apiKey: "x" })), association: null, activity }, Date.parse("2026-09-15T07:00:00.000Z"))).toBe("Honcho · degraded");
  });

  test("reports a first or only MCP failure as degraded", () => {
    const activity = parseStatusActivity(
      entry("2026-09-15T07:00:00.000Z", "grok-honcho:mcp-tool", "/work/app", { success: false, message: "MCP error" }),
      "/work/app",
    );
    expect(activity).toEqual({ timestamp: null, degraded: true });
    expect(renderStatusLine({ config: parseStatusLineConfig(JSON.stringify({ apiKey: "x" })), association: null, activity })).toBe("Honcho · degraded");
  });

  test("accepts Grok cwd payloads and ignores other projects", () => {
    expect(parseStatusLineInput('{"workspaceRoot":"/work/app"}')).toEqual({ cwd: "/work/app" });
    expect(parseStatusLineInput("not json")).toEqual({ cwd: null });
    expect(parseStatusActivity(entry("2026-09-15T07:00:00.000Z", "grok-honcho:stop", "/other"), "/work/app").timestamp).toBeNull();
  });
});
