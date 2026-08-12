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
