import { describe, expect, test } from "bun:test";
import { normalizeHookInput } from "../src/payload.js";
import {
  classifyMcpToolOutcome,
  isHonchoMcpTool,
  mcpToolActivity,
} from "../src/hooks/mcp-tool-activity.js";

describe("Honcho MCP tool activity", () => {
  test("recognizes only qualified Honcho MCP names", () => {
    expect(isHonchoMcpTool("honcho__get_config")).toBe(true);
    expect(isHonchoMcpTool("honcho__")).toBe(false);
    expect(isHonchoMcpTool("server__get_config")).toBe(false);
    expect(isHonchoMcpTool("Bash")).toBe(false);
  });

  test("records successful qualified calls with metadata only", () => {
    const activity = mcpToolActivity(normalizeHookInput({
      hookEventName: "PostToolUse",
      toolName: "honcho__honcho_remember",
      durationMs: 42,
      toolInput: { queries: ["private recalled prompt"], apiKey: "secret" },
      toolResponse: { content: "private recalled memory" },
    }));

    expect(activity).toEqual({ tool: "honcho__honcho_remember", outcome: "success", durationMs: 42 });
    expect(JSON.stringify(activity)).not.toContain("private");
    expect(JSON.stringify(activity)).not.toContain("secret");
  });

  test("classifies PostToolUseFailure and error results as errors", () => {
    expect(classifyMcpToolOutcome(normalizeHookInput({
      hookEventName: "PostToolUseFailure",
      toolName: "honcho__get_briefing",
    }))).toBe("error");
    expect(classifyMcpToolOutcome(normalizeHookInput({
      hookEventName: "PostToolUse",
      toolName: "honcho__get_briefing",
      toolResponse: { error: "do not retain this" },
    }))).toBe("error");
  });

  test("handles missing session and cwd context without retaining inputs", () => {
    const hook = normalizeHookInput({
      hookEventName: "PostToolUse",
      toolName: "honcho__get_config",
      toolInput: { token: "secret" },
      duration_ms: -1,
    });
    expect(hook.durationMs).toBeUndefined();
    expect(mcpToolActivity(hook)).toEqual({ tool: "honcho__get_config", outcome: "success" });
  });
});
