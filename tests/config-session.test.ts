/**
 * Config + session naming tests against real shipped functions.
 */
import { describe, expect, test } from "bun:test";
import {
  deriveSessionName,
  sanitizeForSessionName,
  resolveConfigFromJson,
  getSessionName,
  getHonchoBaseUrlForEndpoint,
  detectHost,
  getDefaultAiPeer,
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

  test("git-branch includes branch", () => {
    const name = deriveSessionName("git-branch", "/repo/foo", {
      peerName: "nils",
      branch: "feat/x",
    });
    expect(name).toBe("nils-foo-feat-x");
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
