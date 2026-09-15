/** Local-only Grok status-line state for Honcho. Never contacts Honcho. */

import { closeSync, existsSync, openSync, readSync, statSync } from "fs";
import { homedir } from "os";
import { basename, join, resolve } from "path";

const MAX_LOG_BYTES = 128 * 1024;
const STALE_ACTIVITY_MS = 15 * 60 * 1000;

export interface StatusLineInput {
  cwd: string | null;
}

export interface StatusLineConfig {
  configured: boolean;
  enabled: boolean;
  peerName: string;
  sessionPeerPrefix: boolean;
}

export interface StatusLineActivity {
  timestamp: string | null;
  degraded: boolean;
}

export interface StatusLineState {
  config: StatusLineConfig;
  association: string | null;
  activity: StatusLineActivity;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseStatusLineInput(input: string): StatusLineInput {
  try {
    const raw = record(JSON.parse(input));
    for (const key of ["cwd", "workspaceRoot", "workspace_root", "projectRoot", "project_root"]) {
      if (typeof raw[key] === "string" && raw[key].trim()) return { cwd: resolve(raw[key] as string) };
    }
  } catch {
    // Status lines must fail silently on a malformed host payload.
  }
  return { cwd: null };
}

export function parseStatusLineConfig(content: string | null, envApiKey = false): StatusLineConfig {
  try {
    const raw = record(content ? JSON.parse(content) : {});
    const hosts = record(raw.hosts);
    const host = record(hosts.grok);
    const fallback = record(hosts.claude_code);
    const selected = Object.keys(host).length > 0 ? host : fallback;
    const configured = envApiKey || typeof selected.apiKey === "string" || typeof raw.apiKey === "string";
    return {
      configured,
      enabled: selected.enabled !== false && raw.enabled !== false,
      peerName: typeof raw.peerName === "string" && raw.peerName.trim() ? raw.peerName : "user",
      sessionPeerPrefix: selected.sessionPeerPrefix !== false && raw.sessionPeerPrefix !== false,
    };
  } catch {
    return { configured: envApiKey, enabled: true, peerName: "user", sessionPeerPrefix: true };
  }
}

function associationFromCache(content: string | null, cwd: string | null): string | null {
  if (!cwd || !content) return null;
  try {
    const sessions = record(record(JSON.parse(content)).sessions);
    const direct = record(sessions[cwd]);
    if (typeof direct.name === "string" && direct.name) return direct.name;
    for (const [storedCwd, entry] of Object.entries(sessions)) {
      if (resolve(storedCwd) === cwd) {
        const name = record(entry).name;
        if (typeof name === "string" && name) return name;
      }
    }
  } catch {
    // A missing or malformed cache only loses the optional association label.
  }
  return null;
}

export function getStatusAssociation(
  cwd: string | null,
  config: StatusLineConfig,
  cacheContent: string | null,
): string | null {
  const cached = associationFromCache(cacheContent, cwd);
  if (cached) return cached;
  if (!cwd || !config.configured) return null;
  const directory = basename(cwd).toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  const peer = config.peerName.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  return config.sessionPeerPrefix ? `${peer}-${directory}` : directory;
}

export function parseStatusActivity(content: string | null, cwd: string | null): StatusLineActivity {
  let timestamp: string | null = null;
  let degraded = false;
  for (const line of (content ?? "").split("\n")) {
    try {
      const entry = record(JSON.parse(line));
      if (
        typeof entry.timestamp !== "string" ||
        typeof entry.source !== "string" ||
        !entry.source.startsWith("grok-honcho:") ||
        (cwd && entry.cwd !== cwd)
      ) continue;
      if (entry.level === "error" || entry.success === false || /(?:failed|error)/i.test(String(entry.message ?? ""))) {
        degraded = true;
        continue;
      }
      timestamp = entry.timestamp;
      degraded = false;
    } catch {
      // Shared activity logs can contain malformed lines.
    }
  }
  return { timestamp, degraded };
}

export function renderStatusLine(state: StatusLineState, now = Date.now()): string {
  if (!state.config.configured) return "Honcho: setup";
  if (!state.config.enabled) return "Honcho: off";
  const association = state.association ? ` · ${state.association}` : "";
  if (state.activity.degraded) return `Honcho${association} · degraded`;
  if (!state.activity.timestamp) return `Honcho${association} · degraded: no activity`;
  const age = Math.max(0, now - Date.parse(state.activity.timestamp));
  const minutes = Math.floor(age / 60_000);
  const ageLabel = minutes < 1 ? "active now" : `${minutes}m ago`;
  if (!Number.isFinite(age) || age > STALE_ACTIVITY_MS) return `Honcho${association} · degraded: stale (${ageLabel})`;
  return `Honcho${association} · ${ageLabel}`;
}

function readBounded(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const fd = openSync(path, "r");
    try {
      const size = statSync(path).size;
      const length = Math.min(size, MAX_LOG_BYTES);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, Math.max(0, size - length));
      return buffer.toString("utf-8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

export async function runStatusLine(): Promise<void> {
  const input = parseStatusLineInput(await Bun.stdin.text());
  const dir = join(homedir(), ".honcho");
  const config = parseStatusLineConfig(readBounded(join(dir, "config.json")), Boolean(process.env.HONCHO_API_KEY));
  const state: StatusLineState = {
    config,
    association: getStatusAssociation(input.cwd, config, readBounded(join(dir, "cache.json"))),
    activity: parseStatusActivity(readBounded(join(dir, "activity.log")), input.cwd),
  };
  console.log(renderStatusLine(state));
}
