/**
 * Minimal cwd → session cache + message chunking.
 * Adapted from plastic-labs/claude-honcho (MIT).
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

const CACHE_DIR = join(homedir(), ".honcho");
const ID_CACHE_FILE = join(CACHE_DIR, "cache.json");

const MAX_MESSAGE_SIZE = 25_000;
const HONCHO_MAX_BATCH = 50;

interface IdCache {
  sessions?: Record<string, { name: string; id: string; updatedAt: string; instanceId?: string }>;
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function loadIdCache(): IdCache {
  ensureCacheDir();
  if (!existsSync(ID_CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(ID_CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveIdCache(cache: IdCache): void {
  ensureCacheDir();
  writeFileSync(ID_CACHE_FILE, JSON.stringify(cache, null, 2));
}

export function setCachedSessionId(
  cwd: string,
  name: string,
  id: string,
  instanceId?: string,
): void {
  const cache = loadIdCache();
  if (!cache.sessions) cache.sessions = {};
  cache.sessions[cwd] = {
    name,
    id,
    updatedAt: new Date().toISOString(),
    instanceId,
  };
  saveIdCache(cache);
}

export function getInstanceIdForCwd(cwd: string): string | null {
  const cache = loadIdCache();
  return cache.sessions?.[cwd]?.instanceId ?? null;
}

/** Most recently active CWD — MCP fallback when process.cwd() is wrong. */
export function getLastActiveCwd(): string | null {
  const cache = loadIdCache();
  if (!cache.sessions) return null;
  let latest: { cwd: string; updatedAt: string } | null = null;
  for (const [cwd, entry] of Object.entries(cache.sessions)) {
    if (!latest || entry.updatedAt > latest.updatedAt) {
      latest = { cwd, updatedAt: entry.updatedAt };
    }
  }
  return latest?.cwd || null;
}

export function chunkContent(content: string, maxSize: number = MAX_MESSAGE_SIZE): string[] {
  if (content.length <= maxSize) return [content];

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= maxSize) {
      chunks.push(remaining);
      break;
    }
    let splitIndex = remaining.lastIndexOf("\n", maxSize);
    if (splitIndex <= 0 || splitIndex < maxSize * 0.25) {
      splitIndex = remaining.lastIndexOf(" ", maxSize);
    }
    if (splitIndex <= 0 || splitIndex < maxSize * 0.25) {
      splitIndex = maxSize;
    }
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  if (chunks.length > 1) {
    return chunks.map((chunk, i) => `[Part ${i + 1}/${chunks.length}] ${chunk}`);
  }
  return chunks;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface SessionLike {
  addMessages(messages: any[]): Promise<any>;
}

export async function addMessagesBatched(
  session: SessionLike,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[],
  resolveFallback?: (error: unknown) => Promise<SessionLike>,
): Promise<void> {
  let active = session;
  let usedFallback = false;
  for (let i = 0; i < messages.length; i += HONCHO_MAX_BATCH) {
    const batch = messages.slice(i, i + HONCHO_MAX_BATCH);
    try {
      await active.addMessages(batch);
    } catch (e) {
      if (usedFallback || !resolveFallback) throw e;
      active = await resolveFallback(e);
      usedFallback = true;
      await active.addMessages(batch);
    }
  }
}
