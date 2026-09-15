import { describe, expect, test } from "bun:test";
import { join } from "path";
import { previewTranscript, targetSessionName } from "../src/transcript-import.js";

const fixture = join(import.meta.dir, "fixtures", "updates.jsonl");
const chunkFixture = join(import.meta.dir, "fixtures", "chunked-updates.jsonl");

describe("Grok historical transcript preview", () => {
  test("parses only complete durable messages, preserves timestamps, and skips malformed lines", () => {
    const preview = previewTranscript({ sourcePath: fixture, maxEvents: 50, sessionStrategy: "source-session" });
    expect(preview.events).toHaveLength(3);
    expect(preview.events.map((event) => event.role)).toEqual(["user", "assistant", "user"]);
    expect(preview.events[0]?.createdAt).toBe("2024-03-09T16:00:00.000Z");
    expect(preview.events[2]?.sourceSessionId).toBe("grok-session-b");
    expect(preview.malformedLines).toBe(1);
    expect(preview.ignoredLines).toBe(2);
    expect(preview.events.map((event) => event.id)).toEqual([
      "host:grok-session-a:user-a-1", "host:grok-session-a:assistant-a-1", expect.stringMatching(/^content:/),
    ]);
    expect(preview.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test("skips chunk streams without a completion schema instead of importing partial messages", () => {
    const preview = previewTranscript({ sourcePath: chunkFixture });
    expect(preview.events).toEqual([]);
    expect(preview.ignoredLines).toBe(3);
  });

  test("filters source sessions and date range without throwing on inaccessible paths", () => {
    const filtered = previewTranscript({
      sourcePath: fixture,
      sourceSessions: ["grok-session-a"],
      from: "2024-03-09T16:00:03.000Z",
      to: "2024-03-09T16:00:06.000Z",
    });
    expect(filtered.events.map((event) => event.content)).toEqual(["I will preserve them."]);
    expect(previewTranscript({ sourcePath: "/no/user/transcript/updates.jsonl" }).events).toEqual([]);
  });

  test("uses a separate stable target for each source session unless current-session is selected", () => {
    const event = previewTranscript({ sourcePath: fixture }).events[0]!;
    expect(targetSessionName(event, "alice-project", "source-session")).toMatch(/^alice-project-grok-grok-session-a-[a-f0-9]{12}$/);
    expect(targetSessionName(event, "alice-project", "current-session")).toBe("alice-project");
  });

  test("keeps a stable hash when sanitized IDs collide and current session is 128 characters", () => {
    const currentSession = "a".repeat(128);
    const first = { ...previewTranscript({ sourcePath: fixture }).events[0]!, sourceSessionId: "source/a" };
    const second = { ...first, sourceSessionId: "source:a" };
    const firstName = targetSessionName(first, currentSession, "source-session");
    const secondName = targetSessionName(second, currentSession, "source-session");
    expect(firstName).toHaveLength(128);
    expect(secondName).toHaveLength(128);
    expect(firstName).not.toBe(secondName);
    expect(firstName).toMatch(/-[a-f0-9]{12}$/);
    expect(secondName).toMatch(/-[a-f0-9]{12}$/);
  });
});
