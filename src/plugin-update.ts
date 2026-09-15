/** Opt-in plugin update checks against the public GitHub Releases API. */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export const RELEASES_URL = "https://api.github.com/repos/heliumbrain/grok-honcho/releases";
export const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Failed checks are retried soon; only successful results receive the full TTL. */
export const UPDATE_FAILURE_CACHE_TTL_MS = 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 2_000;
export const SAFE_UPDATE_COMMAND = "grok plugin update honcho";

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

interface Release {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

interface UpdateCache {
  checkedAt?: unknown;
  latestVersion?: unknown;
  error?: unknown;
}

export interface PluginUpdateStatus {
  installedVersion: string;
  latestVersion: string | null;
  checkedAt: string | null;
  updateAvailable: boolean;
  prereleasePolicy: "stable-only" | "include-prereleases";
  source: string;
  updateCommand: string;
  cached: boolean;
  stale: boolean;
  error?: "unavailable";
}

export interface UpdateCheckOptions {
  now?: () => number;
  fetch?: typeof fetch;
  cachePath?: string;
  force?: boolean;
}

function defaultCachePath(): string {
  return join(homedir(), ".honcho", "plugin-update.json");
}

export function parseSemver(value: string): Semver | null {
  const match = value.trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  const prerelease = match[4] ? match[4].split(".") : [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease };
}

export function compareSemver(a: string, b: string): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (const field of ["major", "minor", "patch"] as const) {
    if (left[field] !== right[field]) return left[field] > right[field] ? 1 : -1;
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    if (!left.prerelease.length && !right.prerelease.length) return 0;
    return left.prerelease.length ? -1 : 1;
  }
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
    const aPart = left.prerelease[index];
    const bPart = right.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Number(aPart) > Number(bPart) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart > bPart ? 1 : -1;
  }
  return 0;
}

function policyFor(version: string): "stable-only" | "include-prereleases" {
  return parseSemver(version)?.prerelease.length ? "include-prereleases" : "stable-only";
}

function readCache(cachePath: string): UpdateCache | null {
  try {
    if (!existsSync(cachePath)) return null;
    const value = JSON.parse(readFileSync(cachePath, "utf-8"));
    return value && typeof value === "object" ? value as UpdateCache : null;
  } catch {
    return null;
  }
}

function writeCache(cachePath: string, value: UpdateCache): void {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    const temporary = `${cachePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(temporary, cachePath);
  } catch {
    // Update checks must never affect plugin operation.
  }
}

function statusFromCache(installedVersion: string, cache: UpdateCache | null, now: number, cached: boolean): PluginUpdateStatus {
  const checkedAt = typeof cache?.checkedAt === "string" && !Number.isNaN(Date.parse(cache.checkedAt)) ? cache.checkedAt : null;
  const latestVersion = typeof cache?.latestVersion === "string" && parseSemver(cache.latestVersion) ? cache.latestVersion : null;
  const comparison = latestVersion ? compareSemver(latestVersion, installedVersion) : null;
  const ttl = cache?.error === "unavailable" ? UPDATE_FAILURE_CACHE_TTL_MS : UPDATE_CACHE_TTL_MS;
  const stale = !checkedAt || now - Date.parse(checkedAt) >= ttl;
  return {
    installedVersion,
    latestVersion,
    checkedAt,
    updateAvailable: comparison !== null && comparison > 0,
    prereleasePolicy: policyFor(installedVersion),
    source: RELEASES_URL,
    updateCommand: SAFE_UPDATE_COMMAND,
    cached,
    stale,
    ...(cache?.error === "unavailable" ? { error: "unavailable" as const } : {}),
  };
}

export function getCachedPluginUpdateStatus(installedVersion: string, options: UpdateCheckOptions = {}): PluginUpdateStatus {
  const now = (options.now ?? Date.now)();
  return statusFromCache(installedVersion, readCache(options.cachePath ?? defaultCachePath()), now, true);
}

function latestRelease(releases: unknown, policy: "stable-only" | "include-prereleases"): string | null {
  if (!Array.isArray(releases)) return null;
  let latest: string | null = null;
  for (const release of releases as Release[]) {
    if (release?.draft === true || typeof release?.tag_name !== "string") continue;
    const version = release.tag_name.trim();
    const parsed = parseSemver(version);
    if (!parsed || (policy === "stable-only" && (parsed.prerelease.length || release.prerelease === true))) continue;
    if (!latest || (compareSemver(version, latest) ?? -1) > 0) latest = version;
  }
  return latest;
}

export async function checkPluginUpdate(installedVersion: string, options: UpdateCheckOptions = {}): Promise<PluginUpdateStatus> {
  const nowFn = options.now ?? Date.now;
  const now = nowFn();
  const cachePath = options.cachePath ?? defaultCachePath();
  const existing = readCache(cachePath);
  const cached = statusFromCache(installedVersion, existing, now, true);
  if (!options.force && !cached.stale) return cached;

  try {
    const signal = AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS);
    const response = await (options.fetch ?? fetch)(RELEASES_URL, { signal });
    if (!response.ok) throw new Error(`Release request failed: ${response.status}`);
    const latestVersion = latestRelease(await response.json(), policyFor(installedVersion));
    if (!latestVersion) throw new Error("No usable release version");
    const next = { checkedAt: new Date(now).toISOString(), latestVersion };
    writeCache(cachePath, next);
    return statusFromCache(installedVersion, next, now, false);
  } catch {
    const next = {
      ...(typeof existing?.latestVersion === "string" ? { latestVersion: existing.latestVersion } : {}),
      checkedAt: new Date(now).toISOString(),
      error: "unavailable",
    };
    writeCache(cachePath, next);
    return statusFromCache(installedVersion, next, now, false);
  }
}
