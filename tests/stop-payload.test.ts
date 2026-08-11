/**
 * Unit tests for Grok Stop payload handling.
 * Drives real shipped normalizeHookInput + extractAssistantText (not reimplemented).
 */
import { describe, expect, test } from "bun:test";
import {
  normalizeHookInput,
  extractAssistantText,
  parseLastTurnAssistantFromTranscript,
  shouldSaveUserPrompt,
  isHarnessInjected,
  resolveCwd,
} from "../src/payload.js";

describe("normalizeHookInput (Grok camelCase)", () => {
  test("reads camelCase fields from Grok Stop stdin", () => {
    const n = normalizeHookInput({
      hookEventName: "stop",
      sessionId: "sess-abc",
      cwd: "/home/nils/projects/svarm",
      workspaceRoot: "/home/nils/projects/svarm",
      stopHookActive: false,
      lastAssistantMessage: "Hello from Grok",
      reason: "end_turn",
    });
    expect(n.sessionId).toBe("sess-abc");
    expect(n.cwd).toBe("/home/nils/projects/svarm");
    expect(n.workspaceRoot).toBe("/home/nils/projects/svarm");
    expect(n.stopHookActive).toBe(false);
    expect(n.lastAssistantMessage).toBe("Hello from Grok");
    expect(n.reason).toBe("end_turn");
  });

  test("accepts snake_case Claude-compat aliases", () => {
    const n = normalizeHookInput({
      session_id: "old",
      stop_hook_active: true,
      last_assistant_message: "legacy",
      workspace_roots: ["/tmp/proj"],
    });
    expect(n.sessionId).toBe("old");
    expect(n.stopHookActive).toBe(true);
    expect(n.lastAssistantMessage).toBe("legacy");
    expect(n.workspaceRoot).toBe("/tmp/proj");
  });
});

describe("extractAssistantText", () => {
  test("prefers non-empty lastAssistantMessage (critical Grok path)", () => {
    const n = normalizeHookInput({
      lastAssistantMessage: "Assistant reply that must be saved",
      transcriptPath: "/nonexistent/transcript.jsonl",
    });
    const r = extractAssistantText(n, () => null);
    expect(r.source).toBe("lastAssistantMessage");
    expect(r.text).toBe("Assistant reply that must be saved");
  });

  test("never no-ops when lastAssistantMessage is non-empty even if transcript empty", () => {
    const n = normalizeHookInput({
      lastAssistantMessage: "  keep me  ",
      transcript_path: "/x",
    });
    const r = extractAssistantText(n, () => "");
    expect(r.text.trim().length).toBeGreaterThan(0);
    expect(r.source).toBe("lastAssistantMessage");
  });

  test("falls back to transcript when lastAssistantMessage empty", () => {
    const transcript = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "hi" },
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "from transcript" }] },
      }),
    ].join("\n");

    const n = normalizeHookInput({
      lastAssistantMessage: "",
      transcriptPath: "/fake/t.jsonl",
    });
    const r = extractAssistantText(n, () => transcript);
    expect(r.source).toBe("transcript");
    expect(r.text).toContain("from transcript");
  });

  test("returns none when both empty", () => {
    const n = normalizeHookInput({});
    const r = extractAssistantText(n);
    expect(r.source).toBe("none");
    expect(r.text).toBe("");
  });
});

describe("stopHookActive double-save guard (payload surface)", () => {
  test("stopHookActive true is visible to handlers", () => {
    const n = normalizeHookInput({ stopHookActive: true, lastAssistantMessage: "x" });
    expect(n.stopHookActive).toBe(true);
    // Handler skips upload when true; message still parseable if needed later
    const r = extractAssistantText(n);
    expect(r.text).toBe("x");
  });
});

describe("parseLastTurnAssistantFromTranscript", () => {
  test("joins assistant blocks after last real user prompt", () => {
    const raw = [
      JSON.stringify({ type: "user", message: { content: "q1" } }),
      JSON.stringify({ type: "assistant", message: { content: "a1" } }),
      JSON.stringify({ type: "user", message: { content: "q2" } }),
      JSON.stringify({ type: "assistant", message: { content: "a2-part1" } }),
      JSON.stringify({ type: "assistant", message: { content: "a2-part2" } }),
    ].join("\n");
    const text = parseLastTurnAssistantFromTranscript(raw);
    expect(text).toContain("a2-part1");
    expect(text).toContain("a2-part2");
    expect(text).not.toContain("a1");
  });
});

describe("user prompt filters", () => {
  test("saves normal prompts", () => {
    expect(shouldSaveUserPrompt("fix the bug")).toBe(true);
  });
  test("skips harness injected", () => {
    expect(isHarnessInjected("<system-reminder>foo</system-reminder>")).toBe(true);
    expect(shouldSaveUserPrompt("<system-reminder>foo</system-reminder>")).toBe(false);
  });
  test("keeps user_query wrappers", () => {
    expect(shouldSaveUserPrompt("<user_query>\nhello\n</user_query>")).toBe(true);
  });
});

describe("resolveCwd", () => {
  test("prefers workspaceRoot over cwd", () => {
    const n = normalizeHookInput({
      cwd: "/a",
      workspaceRoot: "/b",
    });
    expect(resolveCwd(n)).toBe("/b");
  });
});
