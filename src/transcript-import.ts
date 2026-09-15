import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { sanitizeForSessionName } from "./config.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_LINES = 100_000;
const MAX_EVENTS = 5_000;
const MAX_TEXT_LENGTH = 100_000;
const MAX_LEDGER_ENTRIES = 20_000;

export type ImportedRole = "user" | "assistant";

export interface TranscriptEvent {
  /** A host record ID when supplied; otherwise a content-based fallback identity. */
  id: string;
  sourceSessionId: string;
  role: ImportedRole;
  content: string;
  createdAt: string;
  line: number;
}

export interface ImportSelection {
  sourcePath: string;
  from?: string;
  to?: string;
  sourceSessions?: string[];
  maxEvents?: number;
  sessionStrategy?: "source-session" | "current-session";
}

export interface TranscriptPreview {
  events: TranscriptEvent[];
  malformedLines: number;
  ignoredLines: number;
  truncated: boolean;
  fingerprint: string;
  sourceName: string;
}

interface ImportLedger {
  eventIds?: Record<string, string>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function timestampToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return new Date(value * 1000).toISOString();
}

function contentText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const content = value as { type?: unknown; text?: unknown };
  return content.type === "text" && typeof content.text === "string" && content.text.trim()
    ? content.text.slice(0, MAX_TEXT_LENGTH)
    : null;
}

function stableEventId(
  hostId: unknown,
  sourceSessionId: string,
  role: ImportedRole,
  createdAt: string,
  content: string,
): string {
  if (typeof hostId === "string" && hostId) return `host:${sourceSessionId}:${hostId}`;
  // ID-less host records cannot distinguish two byte-for-byte identical messages.
  return `content:${sha256(JSON.stringify({ sourceSessionId, role, createdAt, content }))}`;
}

function selected(event: TranscriptEvent, selection: ImportSelection): boolean {
  const from = parseDate(selection.from);
  const to = parseDate(selection.to);
  const eventDate = new Date(event.createdAt);
  if (from && eventDate < from) return false;
  if (to && eventDate > to) return false;
  return !selection.sourceSessions?.length || selection.sourceSessions.includes(event.sourceSessionId);
}

/** Parse the durable Grok SessionUpdateEnvelope format without reading any implicit user paths. */
export function previewTranscript(selection: ImportSelection): TranscriptPreview {
  const maxEvents = Math.min(Math.max(Number(selection.maxEvents) || MAX_EVENTS, 1), MAX_EVENTS);
  const sourceName = basename(selection.sourcePath);
  const empty = (malformedLines = 0, ignoredLines = 0): TranscriptPreview => ({
    events: [], malformedLines, ignoredLines, truncated: false,
    fingerprint: sha256(JSON.stringify({ selection, events: [] })), sourceName,
  });

  try {
    if (!selection.sourcePath.endsWith("updates.jsonl") || !existsSync(selection.sourcePath)) return empty();
    const bytes = readFileSync(selection.sourcePath);
    if (bytes.byteLength > MAX_FILE_BYTES) return { ...empty(), truncated: true };
    const lines = bytes.toString("utf8").split(/\r?\n/);
    const events: TranscriptEvent[] = [];
    let malformedLines = 0;
    let ignoredLines = 0;
    let truncated = false;

    for (let index = 0; index < lines.length; index++) {
      if (index >= MAX_LINES) { truncated = true; break; }
      const line = lines[index]?.trim();
      if (!line) continue;
      let raw: unknown;
      try { raw = JSON.parse(line); } catch { malformedLines++; continue; }
      const envelope = raw as {
        id?: unknown; eventId?: unknown; timestamp?: unknown; method?: unknown;
        params?: { sessionId?: unknown; update?: { id?: unknown; eventId?: unknown; sessionUpdate?: unknown; content?: unknown } };
      };
      const update = envelope.params?.update;
      const sourceSessionId = envelope.params?.sessionId;
      const createdAt = timestampToIso(envelope.timestamp);
      const tag = update?.sessionUpdate;
      // Chunks have neither a documented completion marker nor a stable message identity.
      // Treating each update as a message (or guessing how to aggregate them) corrupts history.
      const role: ImportedRole | null = tag === "user_message" ? "user" : tag === "agent_message" ? "assistant" : null;
      const content = contentText(update?.content);
      if (envelope.method !== "session/update" || typeof sourceSessionId !== "string" || !role || !content || !createdAt) {
        ignoredLines++;
        continue;
      }
      const event: TranscriptEvent = {
        id: stableEventId(update?.id ?? update?.eventId ?? envelope.id ?? envelope.eventId, sourceSessionId, role, createdAt, content),
        sourceSessionId, role, content, createdAt, line: index + 1,
      };
      if (!selected(event, selection)) continue;
      events.push(event);
      if (events.length >= maxEvents) { truncated = true; break; }
    }
    return {
      events, malformedLines, ignoredLines, truncated,
      fingerprint: sha256(JSON.stringify({ selection: { ...selection, maxEvents }, eventIds: events.map((e) => e.id) })),
      sourceName,
    };
  } catch {
    return empty();
  }
}

export function targetSessionName(event: TranscriptEvent, currentSession: string, grouping: ImportSelection["sessionStrategy"]): string {
  if (grouping !== "source-session") return currentSession;
  const hash = sha256(event.sourceSessionId).slice(0, 12);
  const suffix = sanitizeForSessionName(event.sourceSessionId) || "unknown";
  const separator = "-grok-";
  const prefixLength = Math.max(1, Math.min(currentSession.length, 128 - separator.length - hash.length - 2));
  const prefix = currentSession.slice(0, prefixLength);
  const sourceLength = 128 - prefix.length - separator.length - hash.length - 1;
  return `${prefix}${separator}${suffix.slice(0, sourceLength)}-${hash}`;
}

function ledgerPath(): string {
  return join(homedir(), ".honcho", "import-ledger.json");
}

function ledgerLockPath(): string {
  return join(homedir(), ".honcho", "import-ledger.lock");
}

function loadLedger(): ImportLedger {
  try { return JSON.parse(readFileSync(ledgerPath(), "utf8")) as ImportLedger; } catch { return {}; }
}

export function alreadyImported(eventId: string): boolean {
  try { return Boolean(loadLedger().eventIds?.[eventId]); } catch { return false; }
}

/** Best-effort local idempotency marker, written only after a successful upload. */
export function recordImported(eventId: string): void {
  try {
    const path = ledgerPath();
    mkdirSync(join(homedir(), ".honcho"), { recursive: true });
    const ledger = loadLedger();
    const ids = ledger.eventIds ?? {};
    delete ids[eventId];
    ids[eventId] = new Date().toISOString();
    for (const stale of Object.keys(ids).slice(0, Math.max(0, Object.keys(ids).length - MAX_LEDGER_ENTRIES))) delete ids[stale];
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, JSON.stringify({ eventIds: ids }));
    renameSync(temp, path);
  } catch {
    // Import remains successful if the privacy-preserving local ledger is unavailable.
  }
}

let importQueue = Promise.resolve();

async function acquireLedgerLock(): Promise<() => void> {
  const path = ledgerLockPath();
  mkdirSync(join(homedir(), ".honcho"), { recursive: true });
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      mkdirSync(path);
      return () => { try { rmdirSync(path); } catch { /* lock cleanup is best effort */ } };
    } catch {
      try {
        if (Date.now() - statSync(path).mtimeMs > 5 * 60_000) rmdirSync(path);
      } catch { /* another importer may have released or replaced the lock */ }
      await Bun.sleep(100);
    }
  }
  throw new Error("another transcript import is still in progress");
}

/** Serialize ledger check/upload/record operations in this process and across local processes. */
export async function withImportLedgerLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = importQueue;
  let releaseQueue!: () => void;
  importQueue = new Promise<void>((resolve) => { releaseQueue = resolve; });
  await previous;
  try {
    const releaseLock = await acquireLedgerLock();
    try { return await operation(); } finally { releaseLock(); }
  } finally {
    releaseQueue();
  }
}
