/**
 * Grok hook envelope normalization.
 *
 * Grok stdin is camelCase (sessionId, cwd, lastAssistantMessage, stopHookActive).
 * Claude Code used snake_case. Accept both so fixtures and dual-host configs work.
 */

export interface NormalizedHookInput {
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  workspaceRoot?: string;
  /** True when a previous Stop already continued this turn. */
  stopHookActive?: boolean;
  /** Final assistant text for this turn (Grok-native). */
  lastAssistantMessage?: string;
  prompt?: string;
  source?: string;
  reason?: string;
  hookEventName?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResponse?: Record<string, unknown>;
  /** PreCompact trigger: `auto` | `manual`. */
  trigger?: string;
  /** Raw parsed object for advanced use. */
  raw: Record<string, unknown>;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "1") return true;
    if (t === "false" || t === "0") return false;
  }
  return undefined;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

/**
 * Normalize a Grok (or Claude-compat) hook stdin object to a single shape.
 */
export function normalizeHookInput(input: Record<string, unknown>): NormalizedHookInput {
  const workspaceRoots = input.workspace_roots ?? input.workspaceRoots;
  let workspaceRoot = asString(input.workspaceRoot) ?? asString(input.workspace_root);
  if (!workspaceRoot && Array.isArray(workspaceRoots) && workspaceRoots.length > 0) {
    workspaceRoot = asString(workspaceRoots[0]);
  }

  return {
    sessionId: asString(input.sessionId) ?? asString(input.session_id),
    transcriptPath: asString(input.transcriptPath) ?? asString(input.transcript_path),
    cwd: asString(input.cwd),
    workspaceRoot,
    stopHookActive: asBool(input.stopHookActive) ?? asBool(input.stop_hook_active) ?? false,
    lastAssistantMessage:
      asString(input.lastAssistantMessage) ?? asString(input.last_assistant_message),
    prompt: asString(input.prompt),
    source: asString(input.source),
    reason: asString(input.reason),
    hookEventName: asString(input.hookEventName) ?? asString(input.hook_event_name),
    toolName: asString(input.toolName) ?? asString(input.tool_name),
    toolInput: asRecord(input.toolInput) ?? asRecord(input.tool_input),
    toolResponse: asRecord(input.toolResponse) ?? asRecord(input.tool_response),
    trigger: asString(input.trigger),
    raw: input,
  };
}

/** Resolve project directory for session naming. Prefer workspace root, then cwd. */
export function resolveCwd(input: NormalizedHookInput, fallback = process.cwd()): string {
  return input.workspaceRoot || input.cwd || fallback;
}

/**
 * Extract assistant text for the Stop hook.
 * Prefer lastAssistantMessage; fall back to transcript only if present and parseable.
 * Never returns empty when lastAssistantMessage is non-empty.
 */
export function extractAssistantText(
  input: NormalizedHookInput,
  readTranscript?: (path: string) => string | null,
): { text: string; source: "lastAssistantMessage" | "transcript" | "none" } {
  const fromField = input.lastAssistantMessage?.trim() ?? "";
  if (fromField.length > 0) {
    return { text: fromField, source: "lastAssistantMessage" };
  }

  if (input.transcriptPath && readTranscript) {
    try {
      const raw = readTranscript(input.transcriptPath);
      if (raw) {
        const fromTranscript = parseLastTurnAssistantFromTranscript(raw);
        if (fromTranscript.trim()) {
          return { text: fromTranscript, source: "transcript" };
        }
      }
    } catch {
      // fail open
    }
  }

  return { text: "", source: "none" };
}

interface TranscriptEntry {
  type?: string;
  role?: string;
  isMeta?: boolean;
  timestamp?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  content?: string | Array<{ type: string; text?: string }>;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text?: string } => !!b && typeof b === "object")
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n\n");
  }
  return "";
}

function isRealUserPrompt(entry: TranscriptEntry): boolean {
  if (entry.isMeta) return false;
  const text = contentToText(entry.message?.content ?? entry.content).trim();
  return text.length > 0 && !text.startsWith("<");
}

/** Best-effort: assistant text blocks since the last real user prompt. */
export function parseLastTurnAssistantFromTranscript(transcriptContent: string): string {
  const lines = transcriptContent.trim().split("\n").filter((l) => l.trim());
  if (lines.length === 0) return "";

  let lastPromptIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry: TranscriptEntry = JSON.parse(lines[i]!);
      if ((entry.type || entry.role || entry.message?.role) === "user" && isRealUserPrompt(entry)) {
        lastPromptIdx = i;
        break;
      }
    } catch {
      continue;
    }
  }
  if (lastPromptIdx === -1) return "";

  const blocks: string[] = [];
  for (let i = lastPromptIdx + 1; i < lines.length; i++) {
    try {
      const entry: TranscriptEntry = JSON.parse(lines[i]!);
      const role = entry.type || entry.role || entry.message?.role;
      if (role !== "assistant") continue;
      const text = contentToText(entry.message?.content ?? entry.content);
      if (text.trim()) blocks.push(text);
    } catch {
      continue;
    }
  }
  return blocks.join("\n\n");
}

// ── User prompt filters (shared with UserPromptSubmit) ──

const TRIVIAL_REPLY_PATTERN =
  /^(yes|no|ok|sure|thanks|y|n|yep|nope|yeah|nah|continue|go ahead|do it|proceed)$/i;

// Harness sentinels only. Grok goal wrappers like <user_query> are real user text — save them.
const HARNESS_INJECTED_PATTERNS = [
  /^<task-notification>/,
  /^<local-command-stdout>/,
  /^<command-name>/,
  /^<command-message>/,
  /^<system-reminder>/,
  /^<bash-(stdout|stderr|input)>/,
  /^<<[\w-]+>>$/,
];

export function isTerseReply(prompt: string): boolean {
  return TRIVIAL_REPLY_PATTERN.test(prompt.trim());
}

export function isHarnessInjected(prompt: string): boolean {
  return HARNESS_INJECTED_PATTERNS.some((p) => p.test(prompt.trim()));
}

export function shouldSaveUserPrompt(prompt: string): boolean {
  const t = prompt.trim();
  if (!t) return false;
  if (isHarnessInjected(t)) return false;
  // Still save terse replies (user said something); skip only empty/harness
  return true;
}
