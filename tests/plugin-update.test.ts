import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  RELEASES_URL,
  UPDATE_CACHE_TTL_MS,
  UPDATE_FAILURE_CACHE_TTL_MS,
  checkPluginUpdate,
  compareSemver,
  getCachedPluginUpdateStatus,
  parseSemver,
} from "../src/plugin-update.js";

const directories: string[] = [];

function cachePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "grok-honcho-update-"));
  directories.push(directory);
  return join(directory, "plugin-update.json");
}

function releases(body: unknown, calls: { count: number }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.count++;
    expect(String(url)).toBe(RELEASES_URL);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(init ?? {})).toEqual(["signal"]);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("plugin update checks", () => {
  test("parses and compares semver including prereleases", () => {
    expect(parseSemver("v1.2.3-beta.1")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: ["beta", "1"] });
    expect(parseSemver("1.02.3")).toBeNull();
    expect(compareSemver("1.2.3", "1.2.3-rc.1")).toBe(1);
    expect(compareSemver("1.2.3-beta.2", "1.2.3-beta.11")).toBe(-1);
    expect(compareSemver("nope", "1.0.0")).toBeNull();
  });

  test("uses a fresh cache without a network request", async () => {
    const path = cachePath();
    const calls = { count: 0 };
    const now = Date.parse("2026-09-15T00:00:00.000Z");
    const first = await checkPluginUpdate("0.1.4", {
      cachePath: path,
      now: () => now,
      fetch: releases([{ tag_name: "v0.2.0" }], calls),
    });
    const second = await checkPluginUpdate("0.1.4", {
      cachePath: path,
      now: () => now + UPDATE_CACHE_TTL_MS - 1,
      fetch: releases([{ tag_name: "v9.0.0" }], calls),
    });
    expect(calls.count).toBe(1);
    expect(first).toMatchObject({ latestVersion: "v0.2.0", updateAvailable: true, cached: false, stale: false });
    expect(second).toMatchObject({ latestVersion: "v0.2.0", cached: true, stale: false });
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ latestVersion: "v0.2.0" });
  });

  test("rejects malformed release data and fails safely offline", async () => {
    const path = cachePath();
    const malformed = await checkPluginUpdate("0.1.4", {
      cachePath: path,
      now: () => 1_000,
      fetch: releases([{ tag_name: "not-a-version" }, { draft: true, tag_name: "v9.0.0" }], { count: 0 }),
    });
    const offline = await checkPluginUpdate("0.1.4", {
      cachePath: cachePath(),
      now: () => 1_000,
      fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch,
    });
    expect(malformed).toMatchObject({ latestVersion: null, error: "unavailable", updateAvailable: false });
    expect(offline).toMatchObject({ latestVersion: null, error: "unavailable", updateAvailable: false });
  });

  test("retries a failed check after the short negative-cache TTL", async () => {
    const path = cachePath();
    const calls = { count: 0 };
    const now = Date.parse("2026-09-15T00:00:00.000Z");
    const failingFetch = (async () => {
      calls.count++;
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const failed = await checkPluginUpdate("0.1.5", { cachePath: path, now: () => now, fetch: failingFetch });
    const cachedFailure = await checkPluginUpdate("0.1.5", {
      cachePath: path,
      now: () => now + UPDATE_FAILURE_CACHE_TTL_MS - 1,
      fetch: releases([{ tag_name: "v0.1.6" }], calls),
    });
    const retried = await checkPluginUpdate("0.1.5", {
      cachePath: path,
      now: () => now + UPDATE_FAILURE_CACHE_TTL_MS,
      fetch: releases([{ tag_name: "v0.1.6" }], calls),
    });

    expect(failed).toMatchObject({ error: "unavailable", stale: false });
    expect(cachedFailure).toMatchObject({ error: "unavailable", cached: true, stale: false });
    expect(retried).toMatchObject({ latestVersion: "v0.1.6", updateAvailable: true, cached: false, stale: false });
    expect(calls.count).toBe(2);
  });

  test("stable installs ignore prereleases while prerelease installs include them", async () => {
    const body = [
      { tag_name: "v1.1.0", prerelease: true },
      { tag_name: "v1.1.0-rc.1" },
      { tag_name: "v1.0.1" },
      { tag_name: "v1.1.0-beta.2" },
    ];
    const stable = await checkPluginUpdate("1.0.0", {
      cachePath: cachePath(), now: () => 1_000, fetch: releases(body, { count: 0 }),
    });
    const prerelease = await checkPluginUpdate("1.0.0-beta.1", {
      cachePath: cachePath(), now: () => 1_000, fetch: releases(body, { count: 0 }),
    });
    expect(stable).toMatchObject({ latestVersion: "v1.0.1", prereleasePolicy: "stable-only" });
    expect(prerelease).toMatchObject({ latestVersion: "v1.1.0", prereleasePolicy: "include-prereleases" });
  });

  test("cached status never performs a network request", () => {
    const status = getCachedPluginUpdateStatus("0.1.4", { cachePath: cachePath(), now: () => 1_000 });
    expect(status).toMatchObject({ installedVersion: "0.1.4", latestVersion: null, stale: true, source: RELEASES_URL });
  });
});
