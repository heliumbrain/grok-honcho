/** Local-only health diagnostics for this plugin's MCP tool hooks. */

import { getGitBranch, getSessionName, loadConfig } from "../config.js";
import { logActivity, setLogContext } from "../log.js";
import { normalizeHookInput, resolveCwd, type NormalizedHookInput } from "../payload.js";

const HONCHO_MCP_NAMESPACE = "honcho__";

export type McpToolOutcome = "success" | "error";

export interface McpToolActivity {
  tool: string;
  outcome: McpToolOutcome;
  durationMs?: number;
}

/** Only observe this plugin's MCP server; never inspect other MCP calls. */
export function isHonchoMcpTool(toolName: string | undefined): boolean {
  return Boolean(toolName && toolName.startsWith(HONCHO_MCP_NAMESPACE) && toolName.length > HONCHO_MCP_NAMESPACE.length);
}

export function classifyMcpToolOutcome(hook: Pick<NormalizedHookInput, "hookEventName" | "toolResponse">): McpToolOutcome {
  if (hook.hookEventName === "PostToolUseFailure" || hook.toolResponse?.error !== undefined) return "error";
  return "success";
}

export function mcpToolActivity(hook: NormalizedHookInput): McpToolActivity | null {
  if (!isHonchoMcpTool(hook.toolName)) return null;
  return {
    tool: hook.toolName!,
    outcome: classifyMcpToolOutcome(hook),
    ...(hook.durationMs === undefined ? {} : { durationMs: hook.durationMs }),
  };
}

export function recordMcpToolActivity(raw: Record<string, unknown>): McpToolActivity | null {
  const hook = normalizeHookInput(raw);
  const activity = mcpToolActivity(hook);
  if (!activity) return null;

  const cwd = resolveCwd(hook);
  const config = loadConfig();
  const branch = config?.sessionStrategy === "git-branch" ? getGitBranch(cwd) : undefined;
  const session = config ? getSessionName(cwd, hook.sessionId, config, branch) : undefined;
  setLogContext(cwd, session);
  logActivity("hook", "mcp-tool", `MCP ${activity.outcome}: ${activity.tool}`, undefined, {
    timing: activity.durationMs,
    success: activity.outcome === "success",
    cwd,
    session,
  });
  return activity;
}
