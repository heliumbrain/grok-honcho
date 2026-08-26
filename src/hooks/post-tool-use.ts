/**
 * PostToolUse — upload a redacted summary of significant tool use.
 * Fail open. Uploads are opt-in (`saveToolUse=true` and `saveMessages` not false).
 */

import { Honcho } from "@honcho-ai/sdk";
import {
  loadConfig,
  getSessionName,
  getGitBranch,
  getHonchoClientOptions,
  isPluginEnabled,
  getCachedStdin,
} from "../config.js";
import { normalizeHookInput, resolveCwd } from "../payload.js";
import { logHook, logApiCall, setLogContext } from "../log.js";
import { redactSecrets } from "../redact.js";

const SIGNIFICANT = new Set(["Write", "Edit", "Bash", "Task", "NotebookEdit"]);

const TRIVIAL_BASH = [
  "cd",
  "ls",
  "pwd",
  "echo",
  "cat",
  "head",
  "tail",
  "which",
  "type",
  "git status",
  "git log",
  "git diff",
];

/** Map Grok native tool ids (and Claude names) to the summarizer's vocabulary. */
export function canonicalizeToolName(name: string): string {
  switch (name) {
    case "run_terminal_command":
    case "run_terminal_cmd":
    case "Bash":
      return "Bash";
    case "search_replace":
    case "Edit":
    case "MultiEdit":
      return "Edit";
    case "write":
    case "Write":
      return "Write";
    case "spawn_subagent":
    case "task":
    case "Task":
      return "Task";
    default:
      return name;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function field(input: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = str(input[key]);
    if (value) return value;
  }
  return "";
}

export function shouldLogTool(toolName: string, toolInput: Record<string, unknown>): boolean {
  const name = canonicalizeToolName(toolName);
  if (!SIGNIFICANT.has(name)) return false;
  if (name === "Bash") {
    const command = str(toolInput.command);
    if (TRIVIAL_BASH.some((cmd) => command.trim().startsWith(cmd))) return false;
  }
  return true;
}

function inferContentPurpose(content: string, filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  if (["ts", "tsx", "js", "jsx"].includes(ext)) {
    const exportMatch = content.match(/export\s+(default\s+)?(function|class|const|interface|type)\s+(\w+)/);
    if (exportMatch) return `defines ${exportMatch[2]} ${exportMatch[3]}`;
  }
  if (ext === "py") {
    const classMatch = content.match(/class\s+(\w+)/);
    if (classMatch) return `defines class ${classMatch[1]}`;
    const defMatch = content.match(/def\s+(\w+)/);
    if (defMatch) return `defines function ${defMatch[1]}`;
  }
  if (["md", "mdx", "txt"].includes(ext)) {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) return `doc: ${headingMatch[1].slice(0, 50)}`;
  }
  if (["json", "yaml", "yml", "toml"].includes(ext)) return "config file";
  return `${content.split("\n").length} lines`;
}

function summarizeEdit(oldStr: string, newStr: string, filePath: string): string {
  const oldLines = oldStr.split("\n").length;
  const newLines = newStr.split("\n").length;
  if (oldStr.trim() === "") return `added ${newLines} lines (${inferContentPurpose(newStr, filePath)})`;
  if (newStr.trim() === "") return `removed ${oldLines} lines`;
  const lineDiff = newLines - oldLines;
  if (lineDiff > 0) return `expanded by ${lineDiff} lines`;
  if (lineDiff < 0) return `reduced by ${-lineDiff} lines`;
  return `modified ${oldLines} lines`;
}

export function formatToolSummary(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: Record<string, unknown> = {},
): string {
  const name = canonicalizeToolName(toolName);
  switch (name) {
    case "Write": {
      const filePath = field(toolInput, "file_path", "filePath") || "unknown";
      const fileName = filePath.split("/").pop() || filePath;
      return `Wrote ${fileName} (${inferContentPurpose(field(toolInput, "content", "contents"), filePath)})`;
    }
    case "Edit": {
      const filePath = field(toolInput, "file_path", "filePath") || "unknown";
      const fileName = filePath.split("/").pop() || filePath;
      return `Edited ${fileName}: ${summarizeEdit(field(toolInput, "old_string", "oldString"), field(toolInput, "new_string", "newString"), filePath)}`;
    }
    case "Bash": {
      const command = field(toolInput, "command").slice(0, 100);
      const success = !toolResponse.error;
      const cmdParts = command.split(/[;&|]/)[0]?.trim() ?? "";
      return `Ran: ${cmdParts.slice(0, 60)} (${success ? "success" : "failed"})`;
    }
    case "Task": {
      const desc = field(toolInput, "description") || "unknown";
      const type = field(toolInput, "subagent_type", "subagentType");
      return type ? `Agent task (${type}): ${desc}` : `Agent task: ${desc}`;
    }
    default:
      return `Used ${name || toolName}`;
  }
}

export async function handlePostToolUse(): Promise<void> {
  try {
    const config = loadConfig();
    if (!config || !isPluginEnabled()) process.exit(0);

    let raw: Record<string, unknown> = {};
    try {
      const input = getCachedStdin() ?? (await Bun.stdin.text());
      if (input.trim()) raw = JSON.parse(input);
    } catch {
      process.exit(0);
    }

    const hook = normalizeHookInput(raw);
    const toolName = hook.toolName || "";
    const toolInput = asRecord(hook.toolInput);
    const toolResponse = asRecord(hook.toolResponse);
    const cwd = resolveCwd(hook);
    const branch = config.sessionStrategy === "git-branch" ? getGitBranch(cwd) : undefined;
    const sessionName = getSessionName(cwd, hook.sessionId, config, branch);
    setLogContext(cwd, sessionName);

    if (!shouldLogTool(toolName, toolInput)) process.exit(0);

    const summary = redactSecrets(
      formatToolSummary(toolName, toolInput, toolResponse),
      config.redactPatterns,
    );
    logHook("post-tool-use", summary, { tool: canonicalizeToolName(toolName) });

    if (config.saveMessages === false || config.saveToolUse !== true) process.exit(0);

    const honcho = new Honcho(getHonchoClientOptions(config));
    const session = await honcho.session(sessionName);
    const aiPeer = await honcho.peer(config.aiPeer);
    logApiCall("session.addMessages", "POST", `tool: ${summary.slice(0, 50)}`);
    await session.addMessages([
      aiPeer.message(`[Tool] ${summary}`, {
        metadata: {
          instance_id: hook.sessionId || undefined,
          session_affinity: sessionName,
          host: "grok",
          type: "tool_use",
        },
      }),
    ]);
  } catch (error) {
    logHook("post-tool-use", `Upload failed: ${error}`, { error: String(error) });
  }

  process.exit(0);
}
