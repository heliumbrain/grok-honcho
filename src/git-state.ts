/** Bounded, privacy-safe Git state observations for Honcho sessions. */

import { resolve } from "path";

export interface GitState {
  repoRoot: string;
  branch: string | null;
  commit: string;
  dirty: boolean;
}

export type GitStateResult =
  | { kind: "state"; state: GitState }
  | { kind: "not-repository" }
  | { kind: "unavailable"; error: string };

const MAX_OBSERVATION_LENGTH = 512;
const MAX_DEDUPLICATION_ENTRIES = 200;
export const GIT_COMMAND_TIMEOUT_MS = 1_000;
const GIT_COMMAND_MAX_BUFFER_BYTES = 4 * 1024;

type GitCommandResult = ReturnType<typeof Bun.spawnSync>;
type GitRunner = (cwd: string, args: string[]) => GitCommandResult;

function git(cwd: string, args: string[]): GitCommandResult {
  return Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "ignore",
    timeout: GIT_COMMAND_TIMEOUT_MS,
    maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
  });
}

function output(result: GitCommandResult): string {
  return result.stdout?.toString().trim() ?? "";
}

/**
 * Collect only repository identity and working-tree state. This intentionally
 * never reads diffs, remotes, config, credentials, commit messages, or paths.
 */
export function collectGitState(cwd: string, runGit: GitRunner = git): GitStateResult {
  try {
    const run = (args: string[]): GitCommandResult | null => {
      const result = runGit(cwd, args);
      return result.exitedDueToTimeout || result.exitedDueToMaxBuffer ? null : result;
    };
    const root = run(["rev-parse", "--show-toplevel"]);
    if (!root) return { kind: "unavailable", error: "git command timed out" };
    if (!root.success) return { kind: "not-repository" };

    const head = run(["rev-parse", "--verify", "HEAD"]);
    if (!head) return { kind: "unavailable", error: "git command timed out" };
    if (!head.success || !output(head)) return { kind: "unavailable", error: "HEAD unavailable" };

    const symbolicRef = run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (!symbolicRef) return { kind: "unavailable", error: "git command timed out" };
    const branch = symbolicRef.success ? output(symbolicRef) || null : null;
    const unstaged = run(["diff", "--quiet"]);
    const staged = run(["diff", "--cached", "--quiet"]);
    const untracked = run(["ls-files", "--others", "--exclude-standard", "--directory"]);
    if (!unstaged || !staged || !untracked) return { kind: "unavailable", error: "git command timed out" };
    if (unstaged.exitCode > 1 || staged.exitCode > 1 || !untracked.success) {
      return { kind: "unavailable", error: "working tree status unavailable" };
    }

    return {
      kind: "state",
      state: {
        repoRoot: resolve(output(root)),
        branch,
        commit: output(head),
        dirty: unstaged.exitCode === 1 || staged.exitCode === 1 || output(untracked).length > 0,
      },
    };
  } catch (error) {
    return { kind: "unavailable", error: error instanceof Error ? error.message : String(error) };
  }
}

/** Fixed tagged text, deliberately capped well below a normal message limit. */
export function formatGitStateObservation(state: GitState): string {
  const ref = state.branch ? `branch=${state.branch}` : "head=detached";
  return `[honcho:git-state] ${ref} commit=${state.commit} worktree=${state.dirty ? "dirty" : "clean"}`.slice(
    0,
    MAX_OBSERVATION_LENGTH,
  );
}

export function gitStateFingerprint(state: GitState): string {
  return `${state.branch ?? "DETACHED"}\0${state.commit}\0${state.dirty ? "dirty" : "clean"}`;
}

/** Bounded LRU-ish index used by the persistent cache and unit tests. */
export function rememberGitState(
  entries: Record<string, string> | undefined,
  key: string,
  fingerprint: string,
): { duplicate: boolean; entries: Record<string, string> } {
  const next = { ...(entries ?? {}) };
  if (next[key] === fingerprint) return { duplicate: true, entries: next };
  delete next[key];
  next[key] = fingerprint;
  const keys = Object.keys(next);
  for (const oldKey of keys.slice(0, Math.max(0, keys.length - MAX_DEDUPLICATION_ENTRIES))) {
    delete next[oldKey];
  }
  return { duplicate: false, entries: next };
}

export const GIT_STATE_DEDUPLICATION_LIMIT = MAX_DEDUPLICATION_ENTRIES;
