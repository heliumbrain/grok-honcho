#!/usr/bin/env bun
// @bun

// src/config.ts
import { homedir } from "os";
import { basename, join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
var CONFIG_DIR = join(homedir(), ".honcho");
var CONFIG_FILE = join(CONFIG_DIR, "config.json");
var DEFAULT_WORKSPACE = {
  grok: "default",
  claude_code: "claude_code",
  cursor: "cursor",
  obsidian: "obsidian"
};
var DEFAULT_AI_PEER = {
  grok: "grok",
  claude_code: "claude",
  cursor: "cursor",
  obsidian: "honcho"
};
var _detectedHost = null;
var _stdinText = null;
function configExists() {
  return existsSync(CONFIG_FILE);
}
function setDetectedHost(host) {
  _detectedHost = host;
}
function getDetectedHost() {
  return _detectedHost ?? "grok";
}
function detectHost(stdinInput) {
  const envHost = process.env.HONCHO_HOST;
  if (envHost === "grok" || envHost === "cursor" || envHost === "claude_code" || envHost === "obsidian") {
    return envHost;
  }
  if (process.env.GROK_PLUGIN_ROOT || process.env.GROK_SESSION_ID || process.env.GROK_WORKSPACE_ROOT) {
    return "grok";
  }
  if (process.env.CURSOR_PROJECT_DIR || stdinInput?.cursor_version)
    return "cursor";
  return "grok";
}
function cacheStdin(text) {
  _stdinText = text;
}
function getCachedStdin() {
  return _stdinText;
}
async function initHook() {
  const stdinText = await Bun.stdin.text();
  cacheStdin(stdinText);
  let input = {};
  try {
    input = JSON.parse(stdinText || "{}");
  } catch {
    process.exit(0);
  }
  setDetectedHost(detectHost(input));
  return input;
}
function normalizeEndpoint(endpoint) {
  if (!endpoint)
    return;
  if (typeof endpoint === "string") {
    if (endpoint === "local" || endpoint === "production") {
      return { environment: endpoint };
    }
    if (endpoint.startsWith("http")) {
      return { baseUrl: endpoint };
    }
    return;
  }
  return endpoint;
}
function hostBlock(raw, host) {
  if (!raw.hosts)
    return;
  return raw.hosts[host] ?? raw.hosts[host.replace(/_/g, "-")] ?? raw.hosts[host.replace(/-/g, "_")];
}
function resolveHostBlock(raw, host) {
  const primary = hostBlock(raw, host);
  if (primary)
    return primary;
  if (host === "grok") {
    return hostBlock(raw, "claude_code");
  }
  return;
}
function loadConfig(host) {
  const resolvedHost = host ?? getDetectedHost();
  if (configExists()) {
    try {
      const content = readFileSync(CONFIG_FILE, "utf-8");
      const raw = JSON.parse(content);
      return resolveConfig(raw, resolvedHost);
    } catch {}
  }
  return loadConfigFromEnv(resolvedHost);
}
function resolveConfig(raw, host) {
  const hb = resolveHostBlock(raw, host);
  const apiKey = process.env.HONCHO_API_KEY || hb?.apiKey || raw.apiKey;
  if (!apiKey)
    return null;
  const peerName = raw.peerName || process.env.HONCHO_PEER_NAME || process.env.USER || process.env.USERNAME || "user";
  let workspace;
  let aiPeer;
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
  const config = {
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
    globalOverride: raw.globalOverride
  };
  return mergeWithEnvVars(config);
}
function loadConfigFromEnv(host) {
  const apiKey = process.env.HONCHO_API_KEY;
  if (!apiKey)
    return null;
  const resolvedHost = host ?? getDetectedHost();
  const peerName = process.env.HONCHO_PEER_NAME || process.env.USER || process.env.USERNAME || "user";
  const workspace = process.env.HONCHO_WORKSPACE || DEFAULT_WORKSPACE[resolvedHost];
  const aiPeer = process.env.HONCHO_AI_PEER || DEFAULT_AI_PEER[resolvedHost];
  const endpointEnv = process.env.HONCHO_ENDPOINT;
  const config = {
    apiKey,
    peerName,
    workspace,
    aiPeer,
    saveMessages: process.env.HONCHO_SAVE_MESSAGES !== "false",
    enabled: process.env.HONCHO_ENABLED !== "false",
    logging: process.env.HONCHO_LOGGING !== "false"
  };
  if (endpointEnv) {
    if (endpointEnv === "local")
      config.endpoint = { environment: "local" };
    else if (endpointEnv.startsWith("http"))
      config.endpoint = { baseUrl: endpointEnv };
  }
  return config;
}
function mergeWithEnvVars(config) {
  if (process.env.HONCHO_API_KEY)
    config.apiKey = process.env.HONCHO_API_KEY;
  if (process.env.HONCHO_PEER_NAME)
    config.peerName = process.env.HONCHO_PEER_NAME;
  if (process.env.HONCHO_ENABLED === "false")
    config.enabled = false;
  if (process.env.HONCHO_LOGGING === "false")
    config.logging = false;
  return config;
}
function sanitizeForSessionName(s) {
  return s.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
}
function deriveSessionName(strategy, cwd, opts = {}) {
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
function getSessionForPath(cwd, config) {
  const cfg = config === undefined ? loadConfig() : config;
  if (!cfg?.sessions)
    return null;
  return cfg.sessions[cwd] || null;
}
function getSessionName(cwd, instanceId, config, branch) {
  const cfg = config === undefined ? loadConfig() : config;
  const strategy = cfg?.sessionStrategy ?? "per-directory";
  if (strategy === "per-directory") {
    const override = getSessionForPath(cwd, cfg);
    if (override)
      return override;
  }
  return deriveSessionName(strategy, cwd, {
    peerName: cfg?.peerName,
    sessionPeerPrefix: cfg?.sessionPeerPrefix,
    branch,
    instanceId
  });
}
function isLoggingEnabled() {
  return loadConfig()?.logging !== false;
}
function isPluginEnabled() {
  return loadConfig()?.enabled !== false;
}

// src/payload.ts
function asString(v) {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function asBool(v) {
  if (typeof v === "boolean")
    return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "1")
      return true;
    if (t === "false" || t === "0")
      return false;
  }
  return;
}
function normalizeHookInput(input) {
  const workspaceRoots = input.workspace_roots ?? input.workspaceRoots;
  let workspaceRoot = asString(input.workspaceRoot) ?? asString(input.workspace_root);
  if (!workspaceRoot && Array.isArray(workspaceRoots) && workspaceRoots.length > 0) {
    workspaceRoot = asString(workspaceRoots[0]);
  }
  return {
    sessionId: asString(input.sessionId) ?? asString(input.session_id),
    transcriptPath: asString(input.transcriptPath) ?? asString(input.transcript_path),
    cwd: asString(input.cwd),
    workspaceRoot,
    stopHookActive: asBool(input.stopHookActive) ?? asBool(input.stop_hook_active) ?? false,
    lastAssistantMessage: asString(input.lastAssistantMessage) ?? asString(input.last_assistant_message),
    prompt: asString(input.prompt),
    source: asString(input.source),
    reason: asString(input.reason),
    hookEventName: asString(input.hookEventName) ?? asString(input.hook_event_name),
    raw: input
  };
}
function resolveCwd(input, fallback = process.cwd()) {
  return input.workspaceRoot || input.cwd || fallback;
}

// src/cache.ts
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "fs";
var CACHE_DIR = join2(homedir2(), ".honcho");
var ID_CACHE_FILE = join2(CACHE_DIR, "cache.json");
function ensureCacheDir() {
  if (!existsSync2(CACHE_DIR))
    mkdirSync2(CACHE_DIR, { recursive: true });
}
function loadIdCache() {
  ensureCacheDir();
  if (!existsSync2(ID_CACHE_FILE))
    return {};
  try {
    return JSON.parse(readFileSync2(ID_CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}
function getInstanceIdForCwd(cwd) {
  const cache = loadIdCache();
  return cache.sessions?.[cwd]?.instanceId ?? null;
}

// src/log.ts
import { homedir as homedir3 } from "os";
import { join as join3 } from "path";
import { existsSync as existsSync3, appendFileSync, mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync3 } from "fs";
var CACHE_DIR2 = join3(homedir3(), ".honcho");
var LOG_FILE = join3(CACHE_DIR2, "activity.log");
var MAX_LOG_SIZE = 100 * 1024;
var currentCwd = null;
var currentSession = null;
function setLogContext(cwd, session) {
  currentCwd = cwd;
  currentSession = session || null;
}
function ensureLogDir() {
  if (!existsSync3(CACHE_DIR2))
    mkdirSync3(CACHE_DIR2, { recursive: true });
}
function logActivity(level, source, message, data, options) {
  if (!isLoggingEnabled())
    return;
  ensureLogDir();
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    source: source.startsWith("grok-honcho") ? source : `grok-honcho:${source}`,
    message,
    data,
    timing: options?.timing,
    success: options?.success,
    depth: options?.depth ?? 0,
    cwd: options?.cwd || currentCwd || undefined,
    session: options?.session || currentSession || undefined,
    plugin: "grok-honcho"
  };
  try {
    if (existsSync3(LOG_FILE)) {
      try {
        const stats = Bun.file(LOG_FILE).size;
        if (stats > MAX_LOG_SIZE) {
          const content = readFileSync3(LOG_FILE, "utf-8");
          writeFileSync3(LOG_FILE, content.slice(-50 * 1024));
        }
      } catch {}
    }
    appendFileSync(LOG_FILE, JSON.stringify(entry) + `
`);
  } catch {}
}
function logHook(hookName, message, data) {
  logActivity("hook", hookName, message, data);
}

// src/hooks/session-end.ts
async function handleSessionEnd() {
  try {
    const config = loadConfig();
    if (!config || !isPluginEnabled()) {
      process.exit(0);
    }
    let raw = {};
    try {
      const input = getCachedStdin() ?? await Bun.stdin.text();
      if (input.trim())
        raw = JSON.parse(input);
    } catch {}
    const hook = normalizeHookInput(raw);
    const cwd = resolveCwd(hook);
    const reason = hook.reason || "unknown";
    const instanceId = hook.sessionId || getInstanceIdForCwd(cwd) || undefined;
    const sessionName = getSessionName(cwd, instanceId);
    setLogContext(cwd, sessionName);
    logHook("session-end", "Session ending", { reason });
    logHook("session-end", "Session ended \u2014 no upload (messages saved live)");
  } catch (error) {
    logHook("session-end", `Error: ${error}`, { error: String(error) });
  }
  process.exit(0);
}

// hooks/session-end.ts
await initHook();
await handleSessionEnd();
