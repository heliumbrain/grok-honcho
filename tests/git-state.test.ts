import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  collectGitState,
  formatGitStateObservation,
  gitStateFingerprint,
  rememberGitState,
  GIT_STATE_DEDUPLICATION_LIMIT,
} from "../src/git-state.js";

const temporaryPaths: string[] = [];

function run(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(result.stderr.toString());
}

function repository(): string {
  const path = mkdtempSync(join(tmpdir(), "grok-honcho-git-state-"));
  temporaryPaths.push(path);
  run(path, ["init", "--initial-branch=main"]);
  run(path, ["config", "user.email", "test@example.com"]);
  run(path, ["config", "user.name", "Test User"]);
  writeFileSync(join(path, "tracked.txt"), "initial\n");
  run(path, ["add", "tracked.txt"]);
  run(path, ["commit", "-m", "initial"]);
  return path;
}

afterEach(() => {
  while (temporaryPaths.length) rmSync(temporaryPaths.pop()!, { recursive: true, force: true });
});

describe("collectGitState", () => {
  test("collects a clean branch without exposing repository content", () => {
    const repo = repository();
    run(repo, ["checkout", "-b", "feature/state"]);
    const result = collectGitState(repo);

    expect(result.kind).toBe("state");
    if (result.kind !== "state") return;
    expect(result.state.branch).toBe("feature/state");
    expect(result.state.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.state.dirty).toBe(false);
    expect(formatGitStateObservation(result.state)).toBe(
      `[honcho:git-state] branch=feature/state commit=${result.state.commit} worktree=clean`,
    );
  });

  test("reports dirty tracked and untracked working trees", () => {
    const repo = repository();
    writeFileSync(join(repo, "tracked.txt"), "changed\n");
    expect(collectGitState(repo)).toMatchObject({ kind: "state", state: { dirty: true } });

    run(repo, ["checkout", "--", "tracked.txt"]);
    writeFileSync(join(repo, "untracked.txt"), "new\n");
    expect(collectGitState(repo)).toMatchObject({ kind: "state", state: { dirty: true } });
  });

  test("reports detached HEAD explicitly", () => {
    const repo = repository();
    const initial = collectGitState(repo);
    if (initial.kind !== "state") throw new Error("expected repository state");
    run(repo, ["checkout", "--detach", initial.state.commit]);

    const result = collectGitState(repo);
    expect(result).toMatchObject({ kind: "state", state: { branch: null, dirty: false } });
    if (result.kind === "state") expect(formatGitStateObservation(result.state)).toContain("head=detached");
  });

  test("uses the linked worktree root while retaining its checked-out branch", () => {
    const repo = repository();
    const worktree = `${repo}-worktree`;
    temporaryPaths.push(worktree);
    run(repo, ["worktree", "add", "-b", "feature/worktree", worktree]);

    const result = collectGitState(worktree);
    expect(result.kind).toBe("state");
    if (result.kind !== "state") return;
    expect(result.state.repoRoot).toBe(worktree);
    expect(result.state.branch).toBe("feature/worktree");
  });

  test("skips a non-repository", () => {
    const path = mkdtempSync(join(tmpdir(), "grok-honcho-not-repo-"));
    temporaryPaths.push(path);
    expect(collectGitState(path)).toEqual({ kind: "not-repository" });
  });

  test("times out a Git subprocess instead of blocking SessionStart", () => {
    const path = mkdtempSync(join(tmpdir(), "grok-honcho-git-timeout-"));
    temporaryPaths.push(path);
    const git = join(path, "git");
    writeFileSync(git, "#!/bin/sh\nsleep 2\n");
    chmodSync(git, 0o755);
    const started = performance.now();
    const result = collectGitState(path, (cwd, args) => Bun.spawnSync([git, "-C", cwd, ...args], {
      stdout: "pipe", stderr: "ignore", timeout: 20, maxBuffer: 4 * 1024,
    }));

    expect(result).toEqual({ kind: "unavailable", error: "git command timed out" });
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("Git-state deduplication", () => {
  test("deduplicates unchanged state and bounds cache entries", () => {
    const state = { repoRoot: "/repo", branch: "main", commit: "a".repeat(40), dirty: false };
    const fingerprint = gitStateFingerprint(state);
    let entries: Record<string, string> = {};
    ({ entries } = rememberGitState(entries, "repo\0session", fingerprint));
    expect(rememberGitState(entries, "repo\0session", fingerprint).duplicate).toBe(true);

    for (let i = 0; i <= GIT_STATE_DEDUPLICATION_LIMIT; i++) {
      ({ entries } = rememberGitState(entries, `repo-${i}`, `${fingerprint}-${i}`));
    }
    expect(Object.keys(entries)).toHaveLength(GIT_STATE_DEDUPLICATION_LIMIT);
  });
});
