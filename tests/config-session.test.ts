/**
 * Config + session naming tests against real shipped functions.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  deriveSessionName,
  sanitizeForSessionName,
  getGitBranch,
  resolveConfigFromJson,
  getSessionName,
  getHonchoBaseUrlForEndpoint,
  detectHost,
  getDefaultAiPeer,
  normalizeCwd,
  worktreeMainRootFor,
} from "../src/config.js";

describe("session naming", () => {
  test("per-directory with peer prefix (nils-svarm)", () => {
    const name = deriveSessionName("per-directory", "/home/nils/projects/svarm", {
      peerName: "nils",
      sessionPeerPrefix: true,
    });
    expect(name).toBe("nils-svarm");
  });

  test("sanitize strips junk", () => {
    expect(sanitizeForSessionName("Nils_User!")).toBe("nils_user-");
  });

  test("manual override via getSessionName", () => {
    const cfg = resolveConfigFromJson(
      JSON.stringify({
        apiKey: "test-key-not-real",
        peerName: "nils",
        sessions: { "/tmp/proj": "custom-session" },
        sessionStrategy: "per-directory",
      }),
      "grok",
    );
    expect(cfg).not.toBeNull();
    expect(getSessionName("/tmp/proj", undefined, cfg)).toBe("custom-session");
    expect(getSessionName("/tmp/other", undefined, cfg)).toBe("nils-other");
  });

  test("trailing slash hits the same session override", () => {
    const cfg = resolveConfigFromJson(
      JSON.stringify({
        apiKey: "test-key-not-real",
        peerName: "nils",
        sessions: { "/tmp/proj": "custom-session" },
        sessionStrategy: "per-directory",
      }),
      "grok",
    );
    expect(normalizeCwd("/tmp/proj/")).toBe(normalizeCwd("/tmp/proj"));
    expect(getSessionName("/tmp/proj/", undefined, cfg)).toBe("custom-session");
    expect(getSessionName("/tmp/proj", undefined, cfg)).toBe("custom-session");
  });

  test("stored trailing-slash override still matches a normalized cwd", () => {
    const cfg = resolveConfigFromJson(
      JSON.stringify({
        apiKey: "test-key-not-real",
        peerName: "nils",
        sessions: { "/tmp/proj/": "legacy-session" },
        sessionStrategy: "per-directory",
      }),
      "grok",
    );
    expect(getSessionName("/tmp/proj", undefined, cfg)).toBe("legacy-session");
  });

  test("linked worktree uses the main repo session name", () => {
    const root = mkdtempSync(join(tmpdir(), "grok-honcho-wt-"));
    const main = join(root, "myapp");
    const worktree = join(root, ".worktrees", "feat-x");
    try {
      mkdirSync(join(main, ".git"), { recursive: true });
      mkdirSync(worktree, { recursive: true });
      writeFileSync(
        join(worktree, ".git"),
        `gitdir: ${join(main, ".git", "worktrees", "feat-x")}\n`,
      );

      expect(worktreeMainRootFor(worktree)).toBe(main);
      expect(worktreeMainRootFor(join(worktree, "src"))).toBe(main);
      expect(worktreeMainRootFor(main)).toBeNull();

      const cfg = resolveConfigFromJson(
        JSON.stringify({
          apiKey: "test-key-not-real",
          peerName: "nils",
          sessionStrategy: "per-directory",
        }),
        "grok",
      );
      expect(getSessionName(worktree, undefined, cfg)).toBe("nils-myapp");
      expect(getSessionName(main, undefined, cfg)).toBe("nils-myapp");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("worktree falls through to the main repo sessions map", () => {
    const root = mkdtempSync(join(tmpdir(), "grok-honcho-wt-map-"));
    const main = join(root, "myapp");
    const worktree = join(root, ".worktrees", "feat-x");
    try {
      mkdirSync(join(main, ".git"), { recursive: true });
      mkdirSync(worktree, { recursive: true });
      writeFileSync(
        join(worktree, ".git"),
        `gitdir: ${join(main, ".git", "worktrees", "feat-x")}\n`,
      );

      const cfg = resolveConfigFromJson(
        JSON.stringify({
          apiKey: "test-key-not-real",
          peerName: "nils",
          sessions: { [main]: "shared-session" },
          sessionStrategy: "per-directory",
        }),
        "grok",
      );
      expect(getSessionName(worktree, undefined, cfg)).toBe("shared-session");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("explicit worktree mapping still wins", () => {
    const root = mkdtempSync(join(tmpdir(), "grok-honcho-wt-direct-"));
    const main = join(root, "myapp");
    const worktree = join(root, ".worktrees", "feat-x");
    try {
      mkdirSync(join(main, ".git"), { recursive: true });
      mkdirSync(worktree, { recursive: true });
      writeFileSync(
        join(worktree, ".git"),
        `gitdir: ${join(main, ".git", "worktrees", "feat-x")}\n`,
      );

      const cfg = resolveConfigFromJson(
        JSON.stringify({
          apiKey: "test-key-not-real",
          peerName: "nils",
          sessions: { [worktree]: "worktree-only" },
          sessionStrategy: "per-directory",
        }),
        "grok",
      );
      expect(getSessionName(worktree, undefined, cfg)).toBe("worktree-only");
      expect(getSessionName(main, undefined, cfg)).toBe("nils-myapp");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("regular repo and submodule gitdir pointers are not worktrees", () => {
    const root = mkdtempSync(join(tmpdir(), "grok-honcho-gitdir-"));
    const repo = join(root, "repo");
    const sub = join(root, "sub");
    try {
      mkdirSync(join(repo, ".git"), { recursive: true });
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, ".git"), `gitdir: ${join(repo, ".git", "modules", "sub")}\n`);
      expect(worktreeMainRootFor(repo)).toBeNull();
      expect(worktreeMainRootFor(sub)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("git-branch includes branch", () => {
    const name = deriveSessionName("git-branch", "/repo/foo", {
      peerName: "nils",
      branch: "feat/x",
    });
    expect(name).toBe("nils-foo-feat-x");
  });

  test("chat-instance uses a stable sessionId", () => {
    const name = deriveSessionName("chat-instance", "/repo/foo", {
      peerName: "nils",
      instanceId: "sess-abc",
    });
    expect(name).toBe("nils-chat-sess-abc");
  });

  test("chat-instance falls back to the per-directory name without sessionId", () => {
    const name = deriveSessionName("chat-instance", "/repo/foo", { peerName: "nils" });
    expect(name).toBe("nils-foo");
  });

  test("getSessionName chat-instance is distinct per instanceId", () => {
    const cfg = resolveConfigFromJson(
      JSON.stringify({
        apiKey: "test-key-not-real",
        peerName: "nils",
        sessionStrategy: "chat-instance",
      }),
      "grok",
    );
    expect(getSessionName("/tmp/proj", "aaa", cfg)).toBe("nils-chat-aaa");
    expect(getSessionName("/tmp/proj", "bbb", cfg)).toBe("nils-chat-bbb");
    expect(getSessionName("/tmp/proj", undefined, cfg)).toBe("nils-proj");
  });

  test("git-branch resolves the current branch", () => {
    const repo = mkdtempSync(join(tmpdir(), "grok-honcho-git-"));
    try {
      expect(Bun.spawnSync(["git", "init", "-b", "main", repo]).success).toBe(true);
      expect(Bun.spawnSync(["git", "-C", repo, "checkout", "-b", "feat/memory"]).success).toBe(
        true,
      );
      expect(getGitBranch(repo)).toBe("feat/memory");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("git-branch falls back outside repos and on detached HEAD", () => {
    const repo = mkdtempSync(join(tmpdir(), "grok-honcho-git-"));
    try {
      expect(getGitBranch(tmpdir())).toBeUndefined();
      expect(Bun.spawnSync(["git", "init", "-b", "main", repo]).success).toBe(true);
      writeFileSync(join(repo, "fixture"), "fixture");
      expect(Bun.spawnSync(["git", "-C", repo, "add", "fixture"]).success).toBe(true);
      expect(
        Bun.spawnSync([
          "git",
          "-C",
          repo,
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "-m",
          "fixture",
        ]).success,
      ).toBe(true);
      expect(Bun.spawnSync(["git", "-C", repo, "checkout", "--detach", "HEAD"]).success).toBe(true);
      expect(getGitBranch(repo)).toBeUndefined();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("host defaults", () => {
  test("default AI peer for grok is grok", () => {
    expect(getDefaultAiPeer("grok")).toBe("grok");
  });

  test("detectHost prefers HONCHO_HOST", () => {
    const prev = process.env.HONCHO_HOST;
    process.env.HONCHO_HOST = "grok";
    expect(detectHost()).toBe("grok");
    if (prev === undefined) delete process.env.HONCHO_HOST;
    else process.env.HONCHO_HOST = prev;
  });

  test("detectHost uses GROK_PLUGIN_ROOT marker", () => {
    const prevHost = process.env.HONCHO_HOST;
    const prevRoot = process.env.GROK_PLUGIN_ROOT;
    delete process.env.HONCHO_HOST;
    process.env.GROK_PLUGIN_ROOT = "/tmp/plugin";
    expect(detectHost()).toBe("grok");
    if (prevHost === undefined) delete process.env.HONCHO_HOST;
    else process.env.HONCHO_HOST = prevHost;
    if (prevRoot === undefined) delete process.env.GROK_PLUGIN_ROOT;
    else process.env.GROK_PLUGIN_ROOT = prevRoot;
  });
});

describe("self-hosted endpoint resolution", () => {
  test("baseUrl without /v3 appends /v3", () => {
    expect(getHonchoBaseUrlForEndpoint({ baseUrl: "http://komodo:8008" })).toBe(
      "http://komodo:8008/v3",
    );
  });

  test("baseUrl with /v3 kept", () => {
    expect(getHonchoBaseUrlForEndpoint({ baseUrl: "http://honcho.example/v3" })).toBe(
      "http://honcho.example/v3",
    );
  });

  test("resolveConfigFromJson reads hosts.grok endpoint", () => {
    const cfg = resolveConfigFromJson(
      JSON.stringify({
        apiKey: "fixture-key",
        peerName: "nils",
        hosts: {
          grok: {
            workspace: "default",
            aiPeer: "grok",
            sessionStrategy: "per-directory",
            endpoint: { baseUrl: "http://komodo:8008" },
          },
        },
      }),
      "grok",
    );
    expect(cfg).not.toBeNull();
    expect(cfg!.aiPeer).toBe("grok");
    expect(cfg!.workspace).toBe("default");
    expect(cfg!.endpoint?.baseUrl).toBe("http://komodo:8008");
    expect(getHonchoBaseUrlForEndpoint(cfg!.endpoint)).toBe("http://komodo:8008/v3");
  });

  test("grok host falls back to hosts.claude_code when hosts.grok missing", () => {
    const cfg = resolveConfigFromJson(
      JSON.stringify({
        apiKey: "fixture-key",
        peerName: "nils",
        hosts: {
          claude_code: {
            workspace: "default",
            aiPeer: "grok",
            sessionStrategy: "per-directory",
            endpoint: { baseUrl: "http://komodo:8008" },
          },
        },
      }),
      "grok",
    );
    expect(cfg).not.toBeNull();
    expect(cfg!.aiPeer).toBe("grok");
    expect(cfg!.endpoint?.baseUrl).toBe("http://komodo:8008");
  });

  test("string endpoint form (some host configs)", () => {
    const cfg = resolveConfigFromJson(
      JSON.stringify({
        apiKey: "fixture-key",
        peerName: "nils",
        hosts: {
          grok: {
            endpoint: "http://honcho.pandacrew.xyz",
          },
        },
      }),
      "grok",
    );
    expect(cfg!.endpoint?.baseUrl).toBe("http://honcho.pandacrew.xyz");
  });
});
