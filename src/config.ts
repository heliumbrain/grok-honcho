/**
 * Honcho config for Grok Build.
 * Shares ~/.honcho/config.json with claude-honcho / other hosts.
 * Prefer hosts.grok; fall back to hosts.claude_code then root defaults.
 *
 * Adapted from plastic-labs/claude-honcho (MIT).
 */

import { homedir } from "os";
import { basename, dirname, join, resolve, sep } from "path";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";

export type SessionStrategy = "per-directory" | "git-branch" | "chat-instance";
export type HonchoEnvironment = "production" | "local";
export type ObservationMode = "unified" | "directional";
export type ReasoningLevel = "minimal" | "low" | "medium" | "high" | "max";
export type HonchoHost = "grok" | "claude_code" | "cursor" | "obsidian";

export interface HonchoEndpointConfig {
  environment?: HonchoEnvironment;
  baseUrl?: string;
}

export interface HostConfig {
  workspace?: string;
  aiPeer?: string;
  apiKey?: string;
  enabled?: boolean;
  logging?: boolean;
  saveMessages?: boolean;
  sessionStrategy?: SessionStrategy;
  sessionPeerPrefix?: boolean;
  reasoningLevel?: ReasoningLevel;
  observationMode?: ObservationMode;
  endpoint?: HonchoEndpointConfig | string;
}

interface HonchoFileConfig {
  apiKey?: string;
  peerName?: string;
  workspace?: string;
  aiPeer?: string;
  sessions?: Record<string, string>;
  saveMessages?: boolean;
  enabled?: boolean;
  logging?: boolean;
  sessionStrategy?: SessionStrategy;
  sessionPeerPrefix?: boolean;
  reasoningLevel?: ReasoningLevel;
  observationMode?: ObservationMode;
  endpoint?: HonchoEndpointConfig | string;
  hosts?: Record<string, HostConfig>;
  globalOverride?: boolean;
  claudePeer?: string;
  cursorPeer?: string;
}

export interface HonchoRuntimeConfig {
  peerName: string;
  apiKey: string;
  workspace: string;
  aiPeer: string;
  sessionStrategy?: SessionStrategy;
  sessionPeerPrefix?: boolean;
  sessions?: Record<string, string>;
  saveMessages?: boolean;
  reasoningLevel?: ReasoningLevel;
  observationMode?: ObservationMode;
  endpoint?: HonchoEndpointConfig;
  enabled?: boolean;
  logging?: boolean;
  globalOverride?: boolean;
}

const CONFIG_DIR = join(homedir(), ".honcho");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const HONCHO_BASE_URLS = {
  production: "https://api.honcho.dev/v3",
  local: "http://localhost:8000/v3",
} as const;

const DEFAULT_WORKSPACE: Record<HonchoHost, string> = {
  grok: "default",
  claude_code: "claude_code",
  cursor: "cursor",
  obsidian: "obsidian",
};

const DEFAULT_AI_PEER: Record<HonchoHost, string> = {
  grok: "grok",
  claude_code: "claude",
  cursor: "cursor",
  obsidian: "honcho",
};

let _detectedHost: HonchoHost | null = null;
let _stdinText: string | null = null;

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

export function setDetectedHost(host: HonchoHost): void {
  _detectedHost = host;
}

export function getDetectedHost(): HonchoHost {
  return _detectedHost ?? "grok";
}

/**
 * Detect host. Prefer HONCHO_HOST=grok; Grok plugin env markers; then stdin.
 * Default for this package is grok (not claude_code).
 */
export function detectHost(stdinInput?: Record<string, unknown>): HonchoHost {
  const envHost = process.env.HONCHO_HOST;
  if (
    envHost === "grok" ||
    envHost === "cursor" ||
    envHost === "claude_code" ||
    envHost === "obsidian"
  ) {
    return envHost;
  }

  if (process.env.GROK_PLUGIN_ROOT || process.env.GROK_SESSION_ID || process.env.GROK_WORKSPACE_ROOT) {
    return "grok";
  }
  if (process.env.CURSOR_PROJECT_DIR || stdinInput?.cursor_version) return "cursor";
  // Default: this plugin is Grok-native
  return "grok";
}

export function cacheStdin(text: string): void {
  _stdinText = text;
}

export function getCachedStdin(): string | null {
  return _stdinText;
}

export async function initHook(): Promise<Record<string, unknown>> {
  const stdinText = await Bun.stdin.text();
  cacheStdin(stdinText);
  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(stdinText || "{}");
  } catch {
    process.exit(0);
  }
  setDetectedHost(detectHost(input));
  return input;
}

function normalizeEndpoint(
  endpoint?: HonchoEndpointConfig | string,
): HonchoEndpointConfig | undefined {
  if (!endpoint) return undefined;
  if (typeof endpoint === "string") {
    if (endpoint === "local" || endpoint === "production") {
      return { environment: endpoint };
    }
    if (endpoint.startsWith("http")) {
      return { baseUrl: endpoint };
    }
    return undefined;
  }
  return endpoint;
}

function hostBlock(raw: HonchoFileConfig, host: HonchoHost): HostConfig | undefined {
  if (!raw.hosts) return undefined;
  // Prefer exact host; for grok also accept claude_code as shared self-host fallback
  return (
    raw.hosts[host] ??
    raw.hosts[host.replace(/_/g, "-")] ??
    raw.hosts[host.replace(/-/g, "_")]
  );
}

/**
 * For host=grok with no hosts.grok, fall back to hosts.claude_code so existing
 * self-hosted setups keep working without a config rewrite.
 */
function resolveHostBlock(raw: HonchoFileConfig, host: HonchoHost): HostConfig | undefined {
  const primary = hostBlock(raw, host);
  if (primary) return primary;
  if (host === "grok") {
    return hostBlock(raw, "claude_code");
  }
  return undefined;
}

export function loadConfig(host?: HonchoHost): HonchoRuntimeConfig | null {
  const resolvedHost = host ?? getDetectedHost();

  if (configExists()) {
    try {
      const content = readFileSync(CONFIG_FILE, "utf-8");
      const raw = JSON.parse(content) as HonchoFileConfig;
      return resolveConfig(raw, resolvedHost);
    } catch {
      // fall through
    }
  }
  return loadConfigFromEnv(resolvedHost);
}

function resolveConfig(raw: HonchoFileConfig, host: HonchoHost): HonchoRuntimeConfig | null {
  const hb = resolveHostBlock(raw, host);
  const apiKey = process.env.HONCHO_API_KEY || hb?.apiKey || raw.apiKey;
  if (!apiKey) return null;

  const peerName =
    raw.peerName || process.env.HONCHO_PEER_NAME || process.env.USER || process.env.USERNAME || "user";

  let workspace: string;
  let aiPeer: string;

  if (raw.globalOverride === true) {
    workspace = raw.workspace ?? DEFAULT_WORKSPACE[host];
    aiPeer = raw.aiPeer ?? hb?.aiPeer ?? DEFAULT_AI_PEER[host];
  } else if (hb) {
    workspace = hb.workspace ?? DEFAULT_WORKSPACE[host];
    aiPeer = hb.aiPeer ?? DEFAULT_AI_PEER[host];
  } else {
    workspace = process.env.HONCHO_WORKSPACE ?? raw.workspace ?? DEFAULT_WORKSPACE[host];
    aiPeer = raw.aiPeer ?? DEFAULT_AI_PEER[host];
  }

  const endpoint = normalizeEndpoint(hb?.endpoint ?? raw.endpoint);

  const config: HonchoRuntimeConfig = {
    apiKey,
    peerName,
    workspace,
    aiPeer,
    sessionStrategy: hb?.sessionStrategy ?? raw.sessionStrategy,
    sessionPeerPrefix: hb?.sessionPeerPrefix ?? raw.sessionPeerPrefix,
    sessions: raw.sessions,
    saveMessages: hb?.saveMessages ?? raw.saveMessages,
    reasoningLevel: hb?.reasoningLevel ?? raw.reasoningLevel,
    observationMode: hb?.observationMode ?? raw.observationMode,
    endpoint,
    enabled: hb?.enabled ?? raw.enabled,
    logging: hb?.logging ?? raw.logging,
    globalOverride: raw.globalOverride,
  };

  return mergeWithEnvVars(config);
}

export function loadConfigFromEnv(host?: HonchoHost): HonchoRuntimeConfig | null {
  const apiKey = process.env.HONCHO_API_KEY;
  if (!apiKey) return null;

  const resolvedHost = host ?? getDetectedHost();
  const peerName =
    process.env.HONCHO_PEER_NAME || process.env.USER || process.env.USERNAME || "user";
  const workspace = process.env.HONCHO_WORKSPACE || DEFAULT_WORKSPACE[resolvedHost];
  const aiPeer = process.env.HONCHO_AI_PEER || DEFAULT_AI_PEER[resolvedHost];
  const endpointEnv = process.env.HONCHO_ENDPOINT;

  const config: HonchoRuntimeConfig = {
    apiKey,
    peerName,
    workspace,
    aiPeer,
    saveMessages: process.env.HONCHO_SAVE_MESSAGES !== "false",
    enabled: process.env.HONCHO_ENABLED !== "false",
    logging: process.env.HONCHO_LOGGING !== "false",
  };

  if (endpointEnv) {
    if (endpointEnv === "local") config.endpoint = { environment: "local" };
    else if (endpointEnv.startsWith("http")) config.endpoint = { baseUrl: endpointEnv };
  }

  return config;
}

function mergeWithEnvVars(config: HonchoRuntimeConfig): HonchoRuntimeConfig {
  if (process.env.HONCHO_API_KEY) config.apiKey = process.env.HONCHO_API_KEY;
  if (process.env.HONCHO_PEER_NAME) config.peerName = process.env.HONCHO_PEER_NAME;
  if (process.env.HONCHO_ENABLED === "false") config.enabled = false;
  if (process.env.HONCHO_LOGGING === "false") config.logging = false;
  return config;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
  for (const key of keys) {
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

/**
 * Write host block for the detected host only. Never clobbers other hosts.
 * Sessions map is shared at root.
 */
export function saveConfig(config: HonchoRuntimeConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });

  let existing: HonchoFileConfig = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      existing = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    } catch {
      // start fresh
    }
  }

  if (config.sessions !== undefined) existing.sessions = config.sessions;

  const host = getDetectedHost();
  if (!existing.hosts) existing.hosts = {};
  const existingHost: HostConfig = existing.hosts[host] ?? {};
  const hostEntry: HostConfig = {};

  const setHostIfExplicit = <K extends keyof HostConfig>(
    key: K,
    value: HostConfig[K],
    rootValue: unknown,
  ) => {
    if (value === undefined) return;
    const hasHostOverride = Object.prototype.hasOwnProperty.call(existingHost, key);
    if (hasHostOverride || !deepEqual(value, rootValue)) {
      hostEntry[key] = value;
    }
  };

  setHostIfExplicit("workspace", config.workspace, existing.workspace ?? DEFAULT_WORKSPACE[host]);
  setHostIfExplicit("aiPeer", config.aiPeer, existing.aiPeer ?? DEFAULT_AI_PEER[host]);
  setHostIfExplicit("enabled", config.enabled, existing.enabled);
  setHostIfExplicit("logging", config.logging, existing.logging);
  setHostIfExplicit("saveMessages", config.saveMessages, existing.saveMessages);
  setHostIfExplicit("sessionStrategy", config.sessionStrategy, existing.sessionStrategy);
  setHostIfExplicit("sessionPeerPrefix", config.sessionPeerPrefix, existing.sessionPeerPrefix);
  setHostIfExplicit("reasoningLevel", config.reasoningLevel, existing.reasoningLevel);
  setHostIfExplicit("observationMode", config.observationMode, existing.observationMode);
  setHostIfExplicit("endpoint", config.endpoint, existing.endpoint);

  if (existingHost.apiKey !== undefined) hostEntry.apiKey = existingHost.apiKey;

  existing.hosts[host] = hostEntry;
  writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2));
}

export function saveRootField(field: string, value: unknown): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  let existing: Record<string, unknown> = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      existing = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    } catch {
      // empty
    }
  }
  existing[field] = value;
  writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2));
}

export function sanitizeForSessionName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
}

/** Canonical path for sessions-map / cache keys (`/proj/` == `/proj`). */
export function normalizeCwd(cwd: string): string {
  const resolved = resolve(cwd);
  try {
    return existsSync(resolved) ? realpathSync(resolved) : resolved;
  } catch {
    return resolved;
  }
}

function sessionOverrideFor(cwd: string, sessions: Record<string, string>): string | null {
  const key = normalizeCwd(cwd);
  if (sessions[key]) return sessions[key];
  if (sessions[cwd]) return sessions[cwd];
  for (const [stored, name] of Object.entries(sessions)) {
    if (normalizeCwd(stored) === key) return name;
  }
  return null;
}

/** Main repo root for a linked worktree, from dir's `.git` pointer file. */
export function resolveWorktreeMainRoot(dir: string): string | null {
  try {
    const gitPath = join(dir, ".git");
    if (!statSync(gitPath).isFile()) return null;
    const match = readFileSync(gitPath, "utf-8").match(/^gitdir:\s*(.+?)\s*$/m);
    if (!match?.[1]) return null;
    const gitdir = resolve(dir, match[1]);
    const idx = gitdir.lastIndexOf(`${sep}worktrees${sep}`);
    if (idx === -1) return null;
    const gitContainer = gitdir.slice(0, idx);
    if (basename(gitContainer) === ".git") return dirname(gitContainer);
    if (gitContainer.endsWith(".git")) return gitContainer;
    return null;
  } catch {
    return null;
  }
}

const MAX_GIT_WALK_UP = 12;

/** Main repo root when cwd is inside a linked worktree, else null. */
export function worktreeMainRootFor(cwd: string): string | null {
  try {
    let dir = resolve(cwd);
    for (let i = 0; i < MAX_GIT_WALK_UP; i++) {
      if (existsSync(join(dir, ".git"))) return resolveWorktreeMainRoot(dir);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function getGitBranch(cwd: string): string | undefined {
  try {
    const result = Bun.spawnSync(["git", "-C", cwd, "branch", "--show-current"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    if (!result.success) return undefined;
    return result.stdout.toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

export function deriveSessionName(
  strategy: SessionStrategy,
  cwd: string,
  opts: {
    peerName?: string;
    sessionPeerPrefix?: boolean;
    branch?: string;
    instanceId?: string;
  } = {},
): string {
  const usePrefix = opts.sessionPeerPrefix !== false;
  const peerPart = opts.peerName ? sanitizeForSessionName(opts.peerName) : "user";
  const repoPart = sanitizeForSessionName(basename(cwd));
  const base = usePrefix ? `${peerPart}-${repoPart}` : repoPart;

  switch (strategy) {
    case "git-branch": {
      if (opts.branch) {
        return `${base}-${sanitizeForSessionName(opts.branch)}`;
      }
      return base;
    }
    case "chat-instance": {
      if (opts.instanceId) {
        return usePrefix ? `${peerPart}-chat-${opts.instanceId}` : `chat-${opts.instanceId}`;
      }
      return base;
    }
    case "per-directory":
    default:
      return base;
  }
}

export function getSessionForPath(cwd: string, config?: HonchoRuntimeConfig | null): string | null {
  const cfg = config === undefined ? loadConfig() : config;
  if (!cfg?.sessions) return null;
  const direct = sessionOverrideFor(cwd, cfg.sessions);
  if (direct) return direct;
  const mainRoot = worktreeMainRootFor(cwd);
  if (mainRoot) return sessionOverrideFor(mainRoot, cfg.sessions);
  return null;
}

/**
 * Session name from project cwd (not a stale global from another directory).
 * Manual sessions map overrides apply only for per-directory strategy.
 */
export function getSessionName(
  cwd: string,
  instanceId?: string,
  config?: HonchoRuntimeConfig | null,
  branch?: string,
): string {
  const cfg = config === undefined ? loadConfig() : config;
  const strategy = cfg?.sessionStrategy ?? "per-directory";
  const path = normalizeCwd(cwd);
  const mainRoot = worktreeMainRootFor(path);

  if (strategy === "per-directory") {
    const override = getSessionForPath(path, cfg);
    if (override) return override;
  }

  return deriveSessionName(strategy, mainRoot ?? path, {
    peerName: cfg?.peerName,
    sessionPeerPrefix: cfg?.sessionPeerPrefix,
    branch,
    instanceId,
  });
}

export function setSessionForPath(cwd: string, sessionName: string): void {
  const config = loadConfig();
  if (!config) return;
  if (!config.sessions) config.sessions = {};
  const key = normalizeCwd(cwd);
  config.sessions[key] = sessionName;
  if (cwd !== key) delete config.sessions[cwd];
  saveConfig(config);
}

export function isLoggingEnabled(): boolean {
  return loadConfig()?.logging !== false;
}

export function isPluginEnabled(): boolean {
  return loadConfig()?.enabled !== false;
}

export function getObservationMode(config: HonchoRuntimeConfig): ObservationMode {
  return config.observationMode ?? "unified";
}

export function getHonchoBaseUrlForEndpoint(endpoint?: HonchoEndpointConfig): string {
  if (endpoint?.baseUrl) {
    const url = endpoint.baseUrl;
    return url.endsWith("/v3") ? url : `${url}/v3`;
  }
  if (endpoint?.environment === "local") return HONCHO_BASE_URLS.local;
  return HONCHO_BASE_URLS.production;
}

export function getHonchoBaseUrl(config: HonchoRuntimeConfig): string {
  return getHonchoBaseUrlForEndpoint(config.endpoint);
}

export interface HonchoClientOptions {
  apiKey: string;
  baseURL: string;
  workspaceId: string;
  timeout?: number;
  maxRetries?: number;
}

export function getHonchoClientOptions(config: HonchoRuntimeConfig): HonchoClientOptions {
  return {
    apiKey: config.apiKey,
    baseURL: getHonchoBaseUrl(config),
    workspaceId: config.workspace,
    timeout: 120000,
    maxRetries: 1,
  };
}

export function getEndpointInfo(config: HonchoRuntimeConfig): { type: string; url: string } {
  if (config.endpoint?.baseUrl) {
    return { type: "custom", url: config.endpoint.baseUrl };
  }
  if (config.endpoint?.environment === "local") {
    return { type: "local", url: HONCHO_BASE_URLS.local };
  }
  return { type: "production", url: HONCHO_BASE_URLS.production };
}

export function getKnownHosts(): string[] {
  if (!configExists()) return [];
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    return raw.hosts ? Object.keys(raw.hosts) : [];
  } catch {
    return [];
  }
}

export function getPluginVersion(): string {
  const roots = [
    process.env.GROK_PLUGIN_ROOT,
    process.env.CLAUDE_PLUGIN_ROOT,
    join(import.meta.dir, ".."),
    join(import.meta.dir, "../.."),
  ];
  for (const root of roots) {
    if (!root) continue;
    try {
      const raw = readFileSync(join(root, "plugin.json"), "utf-8");
      const version = (JSON.parse(raw) as { version?: unknown }).version;
      if (typeof version === "string" && version) return version;
    } catch {
      // Try the next likely plugin root.
    }
  }
  return "unknown";
}

export function getDefaultWorkspace(host?: HonchoHost): string {
  return DEFAULT_WORKSPACE[host ?? getDetectedHost()];
}

export function getDefaultAiPeer(host?: HonchoHost): string {
  return DEFAULT_AI_PEER[host ?? getDetectedHost()];
}

export function coerceBoolean(value: unknown): boolean {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v !== "false" && v !== "0" && v !== "";
  }
  return Boolean(value);
}

/**
 * Load config from an explicit JSON string (for tests / fixtures).
 * Does not touch disk.
 */
export function resolveConfigFromJson(
  json: string,
  host: HonchoHost = "grok",
): HonchoRuntimeConfig | null {
  try {
    const raw = JSON.parse(json) as HonchoFileConfig;
    return resolveConfig(raw, host);
  } catch {
    return null;
  }
}
