import { describe, expect, test } from "bun:test";
import { normalizeHookInput } from "../src/payload.js";
import {
  canonicalizeToolName,
  formatToolSummary,
  shouldLogTool,
} from "../src/hooks/post-tool-use.js";
import { redactSecrets } from "../src/redact.js";

describe("PostToolUse summaries", () => {
  test("maps Grok native tool names", () => {
    expect(canonicalizeToolName("run_terminal_command")).toBe("Bash");
    expect(canonicalizeToolName("search_replace")).toBe("Edit");
    expect(canonicalizeToolName("write")).toBe("Write");
    expect(canonicalizeToolName("spawn_subagent")).toBe("Task");
  });

  test("skips trivial bash", () => {
    expect(shouldLogTool("run_terminal_command", { command: "ls -la" })).toBe(false);
    expect(shouldLogTool("Bash", { command: "  git status" })).toBe(false);
    expect(shouldLogTool("run_terminal_command", { command: "bun test" })).toBe(true);
  });

  test("skips non-significant tools", () => {
    expect(shouldLogTool("read_file", { file_path: "/x" })).toBe(false);
  });

  test("summarizes write without dumping file contents", () => {
    const summary = formatToolSummary("write", {
      file_path: "/repo/src/redact.ts",
      content: "export function redactSecrets() {}\n".repeat(40),
    });
    expect(summary).toContain("Wrote redact.ts");
    expect(summary).not.toContain("export function redactSecrets");
  });

  test("camelCase envelope feeds the summarizer", () => {
    const hook = normalizeHookInput({
      hookEventName: "PostToolUse",
      toolName: "run_terminal_command",
      toolInput: { command: 'export HONCHO_API_KEY=hch-abcdefghijklmnopqrstuvwxyz bun test' },
      cwd: "/tmp/proj",
    });
    expect(hook.toolName).toBe("run_terminal_command");
    expect(hook.toolInput).toEqual({
      command: 'export HONCHO_API_KEY=hch-abcdefghijklmnopqrstuvwxyz bun test',
    });
    const summary = redactSecrets(formatToolSummary(hook.toolName!, hook.toolInput!));
    expect(summary).toContain("HONCHO_API_KEY=***");
    expect(summary).not.toContain("hch-abcdefghijklmnopqrstuvwxyz");
  });
});
