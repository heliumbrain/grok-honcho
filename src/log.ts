/**
 * Fail-open activity log for grok-honcho.
 * Writes to ~/.honcho/activity.log (shared with claude-honcho) with source prefix.
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, appendFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { isLoggingEnabled } from "./config.js";

const CACHE_DIR = join(homedir(), ".honcho");
const LOG_FILE = join(CACHE_DIR, "activity.log");
const MAX_LOG_SIZE = 100 * 1024;

export type LogLevel = "hook" | "api" | "cache" | "flow" | "async" | "error" | "debug";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
  timing?: number;
  success?: boolean;
  depth?: number;
  cwd?: string;
  session?: string;
  plugin?: string;
}

export interface HookHealth {
  lastActivityAt: string | null;
  lastSessionStartAt: string | null;
  lastUserPromptAt: string | null;
  lastStopAt: string | null;
}

let currentCwd: string | null = null;
let currentSession: string | null = null;

export function setLogContext(cwd: string, session?: string): void {
  currentCwd = cwd;
  currentSession = session || null;
}

function ensureLogDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function logActivity(
  level: LogLevel,
  source: string,
  message: string,
  data?: unknown,
  options?: { timing?: number; success?: boolean; depth?: number; cwd?: string; session?: string },
): void {
  if (!isLoggingEnabled()) return;
  ensureLogDir();

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    source: source.startsWith("grok-honcho") ? source : `grok-honcho:${source}`,
    message,
    data,
    timing: options?.timing,
    success: options?.success,
    depth: options?.depth ?? 0,
    cwd: options?.cwd || currentCwd || undefined,
    session: options?.session || currentSession || undefined,
    plugin: "grok-honcho",
  };

  try {
    if (existsSync(LOG_FILE)) {
      try {
        const stats = Bun.file(LOG_FILE).size;
        if (stats > MAX_LOG_SIZE) {
          const content = readFileSync(LOG_FILE, "utf-8");
          writeFileSync(LOG_FILE, content.slice(-50 * 1024));
        }
      } catch {
        // ignore size check failures
      }
    }
    appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // never throw from logging
  }
}

export function logHook(hookName: string, message: string, data?: unknown): void {
  logActivity("hook", hookName, message, data);
}

export function logApiCall(
  endpoint: string,
  method: string,
  details?: string,
  timing?: number,
  success?: boolean,
): void {
  const msg = `${method} ${endpoint}${details ? ` → ${details}` : ""}`;
  logActivity("api", "honcho", msg, undefined, { timing, success });
}

export function logFlow(stage: string, message: string, data?: unknown): void {
  logActivity("flow", stage, message, data);
}

export function getLogPath(): string {
  return LOG_FILE;
}

export function parseHookHealth(content: string, cwd?: string): HookHealth {
  const health: HookHealth = {
    lastActivityAt: null,
    lastSessionStartAt: null,
    lastUserPromptAt: null,
    lastStopAt: null,
  };

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Partial<LogEntry>;
      if (
        typeof entry.timestamp !== "string" ||
        typeof entry.source !== "string" ||
        !entry.source.startsWith("grok-honcho:") ||
        (cwd && entry.cwd !== cwd)
      ) {
        continue;
      }

      health.lastActivityAt = entry.timestamp;
      if (entry.source === "grok-honcho:session-start") health.lastSessionStartAt = entry.timestamp;
      if (entry.source === "grok-honcho:user-prompt") health.lastUserPromptAt = entry.timestamp;
      if (entry.source === "grok-honcho:stop") health.lastStopAt = entry.timestamp;
    } catch {
      // Ignore malformed/shared log lines.
    }
  }

  return health;
}

export function getHookHealth(cwd?: string): HookHealth {
  try {
    return parseHookHealth(readFileSync(LOG_FILE, "utf-8"), cwd);
  } catch {
    return parseHookHealth("", cwd);
  }
}
