/**
 * Honcho MCP server for Grok Build.
 * Tools appear as honcho__* / server__tool when trusted via plugin .mcp.json.
 *
 * Adapted from plastic-labs/claude-honcho (MIT).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Honcho } from "@honcho-ai/sdk";
import { readFileSync } from "fs";
import {
  loadConfig,
  saveConfig,
  saveRootField,
  coerceBoolean,
  getHonchoClientOptions,
  getSessionName,
  getGitBranch,
  getConfigPath,
  configExists,
  getDetectedHost,
  setDetectedHost,
  getEndpointInfo,
  getKnownHosts,
  getObservationMode,
  getPluginVersion,
  normalizeCwd,
  type HonchoRuntimeConfig,
  type SessionStrategy,
  type ReasoningLevel,
  type HonchoEnvironment,
  type ObservationMode,
} from "../config.js";
import { getLastActiveCwd } from "../cache.js";
import { checkPluginUpdate, getCachedPluginUpdateStatus } from "../plugin-update.js";
import { getHookHealth, getLogPath } from "../log.js";
import { validateRedactPattern } from "../redact.js";
import {
  alreadyImported,
  previewTranscript,
  recordImported,
  targetSessionName,
  withImportLedgerLock,
  type ImportSelection,
} from "../transcript-import.js";

const DIALECTIC_TIMEOUT_MS = 120_000;

const DANGEROUS_FIELDS = new Set(["workspace", "endpoint.environment", "endpoint.baseUrl"]);

const ENV_SHADOW_MAP: Record<string, string> = {
  apiKey: "HONCHO_API_KEY",
  peerName: "HONCHO_PEER_NAME",
  workspace: "HONCHO_WORKSPACE",
  aiPeer: "HONCHO_AI_PEER",
  enabled: "HONCHO_ENABLED",
  logging: "HONCHO_LOGGING",
  saveMessages: "HONCHO_SAVE_MESSAGES",
  "endpoint.baseUrl": "HONCHO_ENDPOINT",
  "endpoint.environment": "HONCHO_ENDPOINT",
};

const REMEMBER_REASONING_LEVELS = ["low", "medium", "high"] as const;
const REMEMBER_MAX_QUERIES = 5;

const REMEMBER_TOOL = {
  name: "honcho_remember",
  description:
    "Recall what Honcho knows about the user by asking several questions at once. " +
    "Fans out up to 5 parallel dialectic queries and returns a labeled, per-question answer. " +
    "Use this liberally and proactively — before starting a task, whenever the user's " +
    "preferences, past decisions, or history could shape your response, when you're " +
    "about to guess at something they've likely told you before, or when the user asks to " +
    "catch up, resume, or recall what you were working on together. Prefer several " +
    "focused questions in one call over one broad question. Pick reasoning_level by need: " +
    "'low' for quick factual lookups, 'medium' for general recall, 'high' for questions " +
    "that need real reasoning over the user's context.",
  inputSchema: {
    type: "object",
    properties: {
      queries: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: REMEMBER_MAX_QUERIES,
        description: `1–${REMEMBER_MAX_QUERIES} natural-language questions about the user, dispatched concurrently.`,
      },
      reasoning_level: {
        type: "string",
        enum: [...REMEMBER_REASONING_LEVELS],
        description:
          "Reasoning budget applied to every query in this call. 'low' = quick lookups, " +
          "'medium' = general recall, 'high' = complex reasoning over the user's context.",
      },
    },
    required: ["queries", "reasoning_level"],
  },
};

function resolveCwdForMcp(): string {
  // Prefer cwd of last SessionStart; else process.cwd()
  return normalizeCwd(getLastActiveCwd() || process.cwd());
}

function handleGetConfig(cwd: string) {
  const cfg = loadConfig();
  const host = getDetectedHost();
  const cfgPath = getConfigPath();
  const cfgExists = configExists();

  let rawFile: Record<string, unknown> = {};
  if (cfgExists) {
    try {
      rawFile = JSON.parse(readFileSync(cfgPath, "utf-8"));
    } catch {
      /* */
    }
  }

  const branch = cfg?.sessionStrategy === "git-branch" ? getGitBranch(cwd) : undefined;
  const sessionName = cfg ? getSessionName(cwd, undefined, cfg, branch) : null;
  const endpointInfo = cfg ? getEndpointInfo(cfg) : null;
  const hookHealth = getHookHealth(cwd);

  const resolved = cfg
    ? {
        peerName: cfg.peerName,
        aiPeer: cfg.aiPeer,
        workspace: cfg.workspace,
        endpoint: endpointInfo,
        sessionStrategy: cfg.sessionStrategy ?? "per-directory",
        sessionPeerPrefix: cfg.sessionPeerPrefix !== false,
        sessions: cfg.sessions ?? {},
        reasoningLevel: cfg.reasoningLevel ?? "medium",
        observationMode: cfg.observationMode ?? "unified",
        enabled: cfg.enabled !== false,
        logging: cfg.logging !== false,
        saveMessages: cfg.saveMessages !== false,
        saveToolUse: cfg.saveToolUse === true,
        redactPatterns: cfg.redactPatterns ?? [],
        globalOverride: cfg.globalOverride === true,
        rememberTool: cfg.rememberTool === true,
        apiKeySource: cfg.apiKeySource ?? "root",
      }
    : null;

  const current = cfg
    ? {
        workspace: cfg.workspace,
        session: sessionName,
        peerName: cfg.peerName,
        aiPeer: cfg.aiPeer,
        host,
        cwd,
        endpoint: endpointInfo,
      }
    : null;

  const allHosts = getKnownHosts();
  const hosts = rawFile.hosts as Record<string, { workspace?: string }> | undefined;
  const otherHosts: Record<string, { workspace: string }> = {};
  for (const hk of allHosts) {
    if (hk === host) continue;
    otherHosts[hk] = { workspace: hosts?.[hk]?.workspace ?? hk };
  }

  const warnings: string[] = [];
  for (const [field, envVar] of Object.entries(ENV_SHADOW_MAP)) {
    if (process.env[envVar]) {
      warnings.push(`${field} may be shadowed by ${envVar}`);
    }
  }
  if (cfg?.enabled !== false && hookHealth.lastActivityAt === null) {
    warnings.push(
      "No plugin hook activity found for this project. In Grok, open /hooks and press r, then retry a turn.",
    );
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            resolved,
            current,
            host: { detected: host, hasHostsBlock: !!rawFile.hosts, otherHosts },
            hookHealth: { ...hookHealth, logPath: getLogPath() },
            warnings,
            configPath: cfgPath,
            configExists: cfgExists,
            plugin: {
              name: "grok-honcho",
              version: getPluginVersion(),
              update: getCachedPluginUpdateStatus(getPluginVersion()),
            },
          },
          null,
          2,
        ),
      },
    ],
  };
}

function handleSetConfig(args: Record<string, unknown>) {
  const field = args.field;
  if (typeof field !== "string" || !field) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "field required" }) }],
      isError: true,
    };
  }
  const value = args.value;
  const confirm = args.confirm === true;

  if (DANGEROUS_FIELDS.has(field) && !confirm) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            field,
            requiresConfirm: true,
            description: "Pass confirm=true to change workspace/endpoint.",
          }),
        },
      ],
    };
  }

  const cfg = loadConfig();
  if (!cfg) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ success: false, error: "No config. Set HONCHO_API_KEY or ~/.honcho/config.json" }),
        },
      ],
      isError: true,
    };
  }

  let previousValue: unknown;
  const warnings: string[] = [];

  switch (field) {
    case "peerName":
      previousValue = cfg.peerName;
      cfg.peerName = String(value);
      saveRootField("peerName", cfg.peerName);
      if (String(value) !== String(previousValue) && Object.keys(cfg.sessions ?? {}).length > 0) {
        warnings.push(
          `${Object.keys(cfg.sessions ?? {}).length} session override(s) kept under their existing names; only newly created sessions use the new naming. Use sessions.set/sessions.remove to adjust individual mappings.`,
        );
      }
      break;
    case "aiPeer":
      previousValue = cfg.aiPeer;
      cfg.aiPeer = String(value);
      break;
    case "workspace":
      previousValue = cfg.workspace;
      cfg.workspace = String(value);
      break;
    case "endpoint.environment": {
      previousValue = cfg.endpoint?.environment;
      if (!cfg.endpoint) cfg.endpoint = {};
      const envVal = String(value) === "platform" ? "production" : String(value);
      cfg.endpoint.environment = envVal as HonchoEnvironment;
      cfg.endpoint.baseUrl = undefined;
      saveRootField("endpoint", cfg.endpoint);
      break;
    }
    case "endpoint.baseUrl":
      previousValue = cfg.endpoint?.baseUrl;
      if (!cfg.endpoint) cfg.endpoint = {};
      cfg.endpoint.baseUrl = String(value);
      cfg.endpoint.environment = undefined;
      saveRootField("endpoint", cfg.endpoint);
      break;
    case "sessionStrategy": {
      const prevStrategy = cfg.sessionStrategy ?? "per-directory";
      previousValue = prevStrategy;
      cfg.sessionStrategy = String(value) as SessionStrategy;
      if (
        String(value) !== prevStrategy &&
        String(value) !== "per-directory" &&
        Object.keys(cfg.sessions ?? {}).length > 0
      ) {
        warnings.push(
          `${Object.keys(cfg.sessions ?? {}).length} session override(s) kept but inactive: overrides only apply under the per-directory strategy.`,
        );
      }
      break;
    }
    case "sessionPeerPrefix": {
      const prevPrefix = cfg.sessionPeerPrefix !== false;
      previousValue = prevPrefix;
      cfg.sessionPeerPrefix = coerceBoolean(value);
      if (cfg.sessionPeerPrefix !== prevPrefix && Object.keys(cfg.sessions ?? {}).length > 0) {
        warnings.push(
          `${Object.keys(cfg.sessions ?? {}).length} session override(s) kept under their existing names; only newly created sessions use the new naming. Use sessions.set/sessions.remove to adjust individual mappings.`,
        );
      }
      break;
    }
    case "globalOverride":
      previousValue = cfg.globalOverride ?? false;
      cfg.globalOverride = coerceBoolean(value);
      saveRootField("globalOverride", cfg.globalOverride);
      break;
    case "enabled":
      previousValue = cfg.enabled;
      cfg.enabled = coerceBoolean(value);
      break;
    case "logging":
      previousValue = cfg.logging;
      cfg.logging = coerceBoolean(value);
      break;
    case "saveMessages":
      previousValue = cfg.saveMessages;
      cfg.saveMessages = coerceBoolean(value);
      break;
    case "saveToolUse":
      previousValue = cfg.saveToolUse === true;
      cfg.saveToolUse = coerceBoolean(value);
      break;
    case "redactPatterns": {
      const sources = Array.isArray(value) ? value.map(String) : [String(value)];
      for (const source of sources) {
        const err = validateRedactPattern(source);
        if (err) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: err }) }],
            isError: true,
          };
        }
      }
      previousValue = cfg.redactPatterns ?? [];
      cfg.redactPatterns = sources;
      saveRootField("redactPatterns", cfg.redactPatterns);
      break;
    }
    case "reasoningLevel":
      previousValue = cfg.reasoningLevel ?? "medium";
      cfg.reasoningLevel = String(value) as ReasoningLevel;
      break;
    case "observationMode":
      previousValue = cfg.observationMode ?? "unified";
      cfg.observationMode = String(value) as ObservationMode;
      break;
    case "rememberTool":
      previousValue = cfg.rememberTool === true;
      cfg.rememberTool = coerceBoolean(value);
      break;
    case "sessions.set": {
      const obj = value as Record<string, unknown>;
      if (typeof obj?.path !== "string" || typeof obj?.name !== "string") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "sessions.set requires {path, name}" }),
            },
          ],
          isError: true,
        };
      }
      if (!cfg.sessions) cfg.sessions = {};
      const path = normalizeCwd(obj.path);
      previousValue = cfg.sessions[path] ?? cfg.sessions[obj.path] ?? null;
      cfg.sessions[path] = obj.name;
      if (obj.path !== path) delete cfg.sessions[obj.path];
      break;
    }
    case "sessions.remove": {
      const obj = value as Record<string, unknown>;
      if (typeof obj?.path !== "string") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "sessions.remove requires {path}" }),
            },
          ],
          isError: true,
        };
      }
      if (!cfg.sessions) cfg.sessions = {};
      const path = normalizeCwd(obj.path);
      previousValue = cfg.sessions[path] ?? cfg.sessions[obj.path] ?? null;
      delete cfg.sessions[path];
      delete cfg.sessions[obj.path];
      for (const stored of Object.keys(cfg.sessions)) {
        if (normalizeCwd(stored) === path) delete cfg.sessions[stored];
      }
      break;
    }
    default:
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: false, error: `Unknown field: ${field}` }),
          },
        ],
        isError: true,
      };
  }

  saveConfig(cfg);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            field,
            previousValue,
            newValue: value,
            ...(warnings.length ? { warnings } : {}),
            resolved: {
              peerName: cfg.peerName,
              aiPeer: cfg.aiPeer,
              workspace: cfg.workspace,
              endpoint: getEndpointInfo(cfg),
              sessionStrategy: cfg.sessionStrategy ?? "per-directory",
            },
          },
          null,
          2,
        ),
      },
    ],
  };
}

export async function runMcpServer(): Promise<void> {
  setDetectedHost("grok");

  const config = loadConfig();
  if (!config) {
    console.error("[grok-honcho] MCP: no config (need apiKey in ~/.honcho/config.json or HONCHO_API_KEY)");
    // Still start so tools can surface the error via get_config
  }

  const server = new Server(
    { name: "honcho", version: getPluginVersion() },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const live = loadConfig();
    const rememberEnabled = live?.rememberTool === true;
    return {
      tools: [
        ...(rememberEnabled ? [REMEMBER_TOOL] : []),
      {
        name: "import_grok_transcript",
        description:
          "Preview or explicitly import a user-selected Grok updates.jsonl transcript. Defaults to dry-run; upload requires confirm=true and the exact preview_token returned by that dry-run.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Explicit path to one updates.jsonl file" },
            from: { type: "string", description: "Inclusive ISO-8601 timestamp" },
            to: { type: "string", description: "Inclusive ISO-8601 timestamp" },
            source_sessions: { type: "array", items: { type: "string" }, description: "Source Grok session IDs to include" },
            max_events: { type: "number", default: 500, description: "Maximum events to preview/import (1-5000)" },
            session_strategy: { type: "string", enum: ["source-session", "current-session"], default: "source-session" },
            confirm: { type: "boolean", default: false, description: "Set true only after reviewing the dry-run" },
            preview_token: { type: "string", description: "Exact token returned by the dry-run" },
          },
          required: ["path"],
        },
      },
      {
        name: "schedule_dream",
        description:
          "Trigger background memory consolidation (a Honcho dream). Honcho merges redundant conclusions and derives higher-level insights. Scope follows observationMode: unified dreams as the user peer; directional dreams as the AI peer observing the user.",
        inputSchema: {
          type: "object",
          properties: {
            session: {
              type: "boolean",
              description: "If true (default), scope the dream to the current session. If false, dream workspace-wide for this observer.",
              default: true,
            },
          },
        },
      },
      {
        name: "search",
        description:
          "Semantic search across messages and saved conclusions. Messages default to the current session; use scope='workspace' for all sessions. Conclusions are always searched workspace-wide.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results (1-50)", default: 10 },
            scope: {
              type: "string",
              enum: ["session", "workspace"],
              description: "Search scope",
              default: "session",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "chat",
        description: "Query Honcho's knowledge about the user using dialectic reasoning",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural language question about the user" },
            reasoning_level: {
              type: "string",
              enum: ["minimal", "low", "medium", "high", "max"],
              description: "Reasoning budget",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "create_conclusion",
        description: "Save a key insight or biographical detail about the user",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "The insight or fact to remember" },
          },
          required: ["content"],
        },
      },
      {
        name: "list_conclusions",
        description:
          "List conclusions Honcho has saved about the user. Use this to review what is remembered before creating duplicates, or to find IDs for deletion.",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", default: 1 },
            size: { type: "number", default: 20 },
          },
        },
      },
      {
        name: "query_conclusions",
        description:
          "Semantically search conclusions Honcho has saved about the user. Returns IDs usable with delete_conclusion.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            top_k: { type: "number", description: "Max results (default 10)", default: 10 },
          },
          required: ["query"],
        },
      },
      {
        name: "delete_conclusion",
        description:
          "Delete a conclusion from Honcho's memory by ID. Use query_conclusions or list_conclusions to find the ID first.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The conclusion ID to delete" },
          },
          required: ["id"],
        },
      },
      {
        name: "get_briefing",
        description:
          "Load the session briefing: long summary plus user peer card. Call at session start when directives ask for it.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_context",
        description: "Full context object (representation + peer card) for the current user",
        inputSchema: {
          type: "object",
          properties: {
            max_conclusions: { type: "number", default: 25 },
          },
        },
      },
      {
        name: "get_representation",
        description: "User representation string from Honcho (lighter than get_context)",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_config",
        description: "Current Honcho plugin configuration, session name, and diagnostics",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "check_plugin_update",
        description:
          "Explicitly check the public grok-honcho GitHub Releases feed for an update. Uses a short timeout and cached result; sends no plugin configuration, credentials, or prompts.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "set_config",
        description: "Update a Honcho config field. Dangerous changes need confirm=true.",
        inputSchema: {
          type: "object",
          properties: {
            field: {
              type: "string",
              enum: [
                "peerName",
                "aiPeer",
                "workspace",
                "globalOverride",
                "endpoint.environment",
                "endpoint.baseUrl",
                "sessionStrategy",
                "sessionPeerPrefix",
                "enabled",
                "logging",
                "saveMessages",
                "saveToolUse",
                "redactPatterns",
                "reasoningLevel",
                "observationMode",
                "rememberTool",
                "sessions.set",
                "sessions.remove",
              ],
            },
            value: { description: "New value" },
            confirm: { type: "boolean" },
          },
          required: ["field", "value"],
        },
      },
    ],
  };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const cwd = resolveCwdForMcp();

    if (name === "get_config") return handleGetConfig(cwd);
    if (name === "check_plugin_update") {
      const status = await checkPluginUpdate(getPluginVersion());
      return { content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }] };
    }
    if (name === "set_config") return handleSetConfig((args ?? {}) as Record<string, unknown>);

    if (name === "import_grok_transcript") {
      const sourcePath = typeof args?.path === "string" ? args.path : "";
      const from = typeof args?.from === "string" ? new Date(args.from) : null;
      const to = typeof args?.to === "string" ? new Date(args.to) : null;
      const maxEvents = typeof args?.max_events === "number" ? args.max_events : 500;
      if ((from && Number.isNaN(from.valueOf())) || (to && Number.isNaN(to.valueOf())) || (from && to && from > to)) {
        return { content: [{ type: "text" as const, text: "Error: from/to must be valid ISO timestamps with from no later than to." }], isError: true };
      }
      if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 5_000) {
        return { content: [{ type: "text" as const, text: "Error: max_events must be an integer from 1 to 5000." }], isError: true };
      }
      const selection: ImportSelection = {
        sourcePath,
        ...(typeof args?.from === "string" ? { from: args.from } : {}),
        ...(typeof args?.to === "string" ? { to: args.to } : {}),
        ...(Array.isArray(args?.source_sessions)
          ? { sourceSessions: (args.source_sessions as unknown[]).filter((value): value is string => typeof value === "string") }
          : {}),
        maxEvents,
        ...(args?.session_strategy === "current-session" || args?.session_strategy === "source-session"
          ? { sessionStrategy: args.session_strategy }
          : { sessionStrategy: "source-session" }),
      };
      const preview = previewTranscript(selection);
      const groups = new Map<string, number>();
      for (const event of preview.events) groups.set(event.sourceSessionId, (groups.get(event.sourceSessionId) ?? 0) + 1);
      const previewResult = {
        dryRun: args?.confirm !== true,
        source: preview.sourceName,
        selectedEvents: preview.events.length,
        sourceSessions: Object.fromEntries(groups),
        malformedLines: preview.malformedLines,
        ignoredLines: preview.ignoredLines,
        truncated: preview.truncated,
        previewToken: preview.fingerprint,
        sample: preview.events.slice(0, 5).map(({ role, createdAt, sourceSessionId, line }) => ({ role, createdAt, sourceSessionId, line })),
      };
      if (args?.confirm !== true) {
        return { content: [{ type: "text" as const, text: JSON.stringify(previewResult, null, 2) }] };
      }
      if (typeof args?.preview_token !== "string" || args.preview_token !== preview.fingerprint) {
        return {
          content: [{ type: "text" as const, text: "Error: confirmation requires the exact preview_token from a matching dry-run." }],
          isError: true,
        };
      }
      const activeConfig = loadConfig();
      if (!activeConfig || activeConfig.enabled === false) {
        return {
          content: [{ type: "text" as const, text: "Error: Honcho must be configured and enabled before importing." }],
          isError: true,
        };
      }
      try {
        const honcho = new Honcho(getHonchoClientOptions(activeConfig));
        const currentSession = getSessionName(cwd, undefined, activeConfig, activeConfig.sessionStrategy === "git-branch" ? getGitBranch(cwd) : undefined);
        const userPeer = await honcho.peer(activeConfig.peerName);
        const aiPeer = await honcho.peer(activeConfig.aiPeer);
        const observationMode = getObservationMode(activeConfig);
        const result = await withImportLedgerLock(async () => {
          let uploaded = 0;
          let skipped = 0;
          const sessions = new Map<string, Awaited<ReturnType<typeof honcho.session>>>();
          for (const event of preview.events) {
            if (alreadyImported(event.id)) { skipped++; continue; }
            const targetName = targetSessionName(event, currentSession, selection.sessionStrategy);
            let session = sessions.get(targetName);
            if (!session) {
              session = await honcho.session(targetName);
              const peers: Parameters<typeof session.addPeers>[0] = observationMode === "directional"
                ? [userPeer, [aiPeer, { observeOthers: true }]]
                : [userPeer, aiPeer];
              await session.addPeers(peers);
              sessions.set(targetName, session);
            }
            const peer = event.role === "user" ? userPeer : aiPeer;
            await session.addMessages([peer.message(event.content, {
              createdAt: event.createdAt,
              metadata: { type: "grok_transcript_import", source_session_id: event.sourceSessionId, source_line: event.line, source_event_id: event.id, host: "grok" },
            })]);
            recordImported(event.id);
            uploaded++;
          }
          return { uploaded, skipped, targetSessions: [...sessions.keys()] };
        });
        return { content: [{ type: "text" as const, text: JSON.stringify({ ...previewResult, dryRun: false, ...result }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: import stopped safely: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }

    const activeConfig: HonchoRuntimeConfig | null = loadConfig();
    if (!activeConfig) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: Honcho not configured. Set apiKey in ~/.honcho/config.json or HONCHO_API_KEY.",
          },
        ],
        isError: true,
      };
    }
    if (activeConfig.enabled === false) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: Honcho is disabled. Use set_config to enable it.",
          },
        ],
        isError: true,
      };
    }

    if (name === "honcho_remember") {
      if (activeConfig.rememberTool !== true) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: honcho_remember is off. Enable with set_config field=rememberTool value=true.",
            },
          ],
          isError: true,
        };
      }
      const queries = Array.isArray(args?.queries)
        ? (args.queries as unknown[]).map(String).map((q) => q.trim()).filter(Boolean)
        : [];
      const reasoningLevel = args?.reasoning_level as string;
      if (queries.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "Error: honcho_remember requires a non-empty `queries` array." },
          ],
          isError: true,
        };
      }
      if (queries.length > REMEMBER_MAX_QUERIES) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: honcho_remember accepts at most ${REMEMBER_MAX_QUERIES} queries (got ${queries.length}).`,
            },
          ],
          isError: true,
        };
      }
      if (!(REMEMBER_REASONING_LEVELS as readonly string[]).includes(reasoningLevel)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: reasoning_level must be one of: ${REMEMBER_REASONING_LEVELS.join(", ")}`,
            },
          ],
          isError: true,
        };
      }
    }

    const honcho = new Honcho(getHonchoClientOptions(activeConfig));
    const honchoDialectic = new Honcho({
      ...getHonchoClientOptions(activeConfig),
      timeout: DIALECTIC_TIMEOUT_MS,
      maxRetries: 0,
    });

    if (name === "list_conclusions" || name === "delete_conclusion" || name === "query_conclusions") {
      try {
        if (name === "query_conclusions") {
          const query = args?.query;
          if (typeof query !== "string" || !query.trim()) {
            return {
              content: [{ type: "text" as const, text: "Error: query required" }],
              isError: true,
            };
          }
        }
        if (name === "delete_conclusion") {
          const id = args?.id;
          if (typeof id !== "string" || !id.trim()) {
            return {
              content: [{ type: "text" as const, text: "Error: id required" }],
              isError: true,
            };
          }
        }

        const observationMode = getObservationMode(activeConfig);
        const scopePeer =
          observationMode === "unified"
            ? await honcho.peer(activeConfig.peerName)
            : await honcho.peer(activeConfig.aiPeer);
        const conclusionScope = scopePeer.conclusionsOf(activeConfig.peerName);

        if (name === "list_conclusions") {
          const page = (args?.page as number) ?? 1;
          const size = Math.min((args?.size as number) ?? 20, 100);
          const result = await conclusionScope.list({ page, size });
          const items = result.items.map((c: { id: string; content: string; createdAt?: string }) => ({
            id: c.id,
            content: c.content,
            createdAt: c.createdAt,
          }));
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { items, total: result.total, page: result.page, pages: result.pages },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        if (name === "query_conclusions") {
          const query = args?.query as string;
          const topK = Math.min((args?.top_k as number) ?? 10, 50);
          const conclusions = await conclusionScope.query(query, topK);
          const items = conclusions.map((c: { id: string; content: string; createdAt?: string }) => ({
            id: c.id,
            content: c.content,
            createdAt: c.createdAt,
          }));
          return {
            content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }],
          };
        }

        await conclusionScope.delete(args?.id as string);
        return {
          content: [{ type: "text" as const, text: `Deleted conclusion ${args?.id}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }

    const branch =
      activeConfig.sessionStrategy === "git-branch" ? getGitBranch(cwd) : undefined;
    const sessionName = getSessionName(cwd, undefined, activeConfig, branch);

    try {
      const session = await honcho.session(sessionName);
      const observationMode = getObservationMode(activeConfig);
      const userPeer = await honcho.peer(activeConfig.peerName);
      const aiPeer =
        observationMode === "directional" ? await honcho.peer(activeConfig.aiPeer) : null;
      const activePeer = observationMode === "unified" ? userPeer : aiPeer!;
      const chatTarget = observationMode === "unified" ? undefined : activeConfig.peerName;
      const contextTarget = observationMode === "unified" ? undefined : activeConfig.peerName;

      switch (name) {
        case "search": {
          const query = args?.query as string;
          const limit = (args?.limit as number) ?? 10;
          const scope = (args?.scope as string) ?? "session";
          const [messages, conclusions] = await Promise.all([
            scope === "workspace"
              ? honcho.search(query, { limit })
              : session.search(query, { limit }),
            activePeer.conclusionsOf(activeConfig.peerName).query(query, limit).catch(() => []),
          ]);
          const results = {
            messages: messages.map(
              (msg: { content: string; peer?: string; createdAt?: string; created_at?: string }) => ({
                content: msg.content,
                peerId: msg.peer,
                createdAt: msg.createdAt || msg.created_at,
              }),
            ),
            conclusions: (conclusions as Array<{ id: string; content: string; createdAt?: string }>).map((c) => ({
              id: c.id,
              content: c.content,
              createdAt: c.createdAt,
            })),
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
        }

        case "chat": {
          const query = args?.query as string;
          const reasoningLevel =
            (args?.reasoning_level as string) ?? activeConfig.reasoningLevel ?? "medium";
          let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
          const deadline = new Promise<never>((_, reject) => {
            deadlineTimer = setTimeout(
              () => reject(new Error(`Dialectic call exceeded ${DIALECTIC_TIMEOUT_MS}ms`)),
              DIALECTIC_TIMEOUT_MS,
            );
          });
          const chatFlow = (async () => {
            const dialecticPeer = await honchoDialectic.peer(activePeer.id);
            return dialecticPeer.chat(query, {
              ...(chatTarget ? { target: chatTarget } : {}),
              session,
              reasoningLevel,
            });
          })();
          try {
            const response = await Promise.race([chatFlow, deadline]);
            return {
              content: [{ type: "text" as const, text: response ?? "No response from Honcho" }],
            };
          } finally {
            clearTimeout(deadlineTimer);
            chatFlow.catch(() => {});
          }
        }

        case "honcho_remember": {
          const queries = Array.isArray(args?.queries)
            ? (args.queries as unknown[]).map(String).map((q) => q.trim()).filter(Boolean)
            : [];
          const reasoningLevel = args?.reasoning_level as string;

          if (activeConfig.rememberTool !== true) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: honcho_remember is off. Enable with set_config field=rememberTool value=true.",
                },
              ],
              isError: true,
            };
          }
          if (queries.length === 0) {
            return {
              content: [{ type: "text" as const, text: "Error: honcho_remember requires a non-empty `queries` array." }],
              isError: true,
            };
          }
          if (queries.length > REMEMBER_MAX_QUERIES) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: honcho_remember accepts at most ${REMEMBER_MAX_QUERIES} queries (got ${queries.length}).`,
                },
              ],
              isError: true,
            };
          }
          if (!(REMEMBER_REASONING_LEVELS as readonly string[]).includes(reasoningLevel)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: reasoning_level must be one of: ${REMEMBER_REASONING_LEVELS.join(", ")}`,
                },
              ],
              isError: true,
            };
          }

          let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
          const deadline = new Promise<never>((_, reject) => {
            deadlineTimer = setTimeout(
              () => reject(new Error(`honcho_remember exceeded ${DIALECTIC_TIMEOUT_MS}ms`)),
              DIALECTIC_TIMEOUT_MS,
            );
          });

          const batchStart = Date.now();
          const fanOut = (async () => {
            const dialecticPeer = await honchoDialectic.peer(activePeer.id);
            return Promise.allSettled(
              queries.map(async (q) => {
                const qStart = Date.now();
                const answer = await dialecticPeer.chat(q, {
                  ...(chatTarget ? { target: chatTarget } : {}),
                  session,
                  reasoningLevel,
                });
                return { answer, ms: Date.now() - qStart };
              }),
            );
          })();

          try {
            const settled = await Promise.race([fanOut, deadline]);
            const totalMs = Date.now() - batchStart;
            const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
            const hits = settled.filter((r) => r.status === "fulfilled" && r.value.answer).length;
            const header =
              `recalled ${hits} insight${hits === 1 ? "" : "s"} · ` +
              `${queries.length} dialectic${queries.length === 1 ? "" : "s"} @ ${reasoningLevel} · ${secs(totalMs)}`;
            const blocks = settled.map((r, i) => {
              const label = `q${i + 1} "${queries[i]}"`;
              if (r.status === "rejected") {
                const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
                return `${label} — failed\n→ (error: ${msg})`;
              }
              const { answer, ms } = r.value;
              const body = answer && answer.trim() ? answer.trim() : "(no memory found)";
              return `${label} — ${secs(ms)}\n→ ${body}`;
            });
            return {
              content: [{ type: "text" as const, text: `${header}\n\n${blocks.join("\n\n")}` }],
            };
          } finally {
            clearTimeout(deadlineTimer);
            fanOut.catch(() => {});
          }
        }

        case "schedule_dream": {
          const scopeToSession = args?.session !== false;
          const observationMode = getObservationMode(activeConfig);
          const observer =
            observationMode === "unified" ? activeConfig.peerName : activeConfig.aiPeer;
          const observed =
            observationMode === "directional" ? activeConfig.peerName : undefined;
          await honcho.scheduleDream({
            observer,
            ...(observed ? { observed } : {}),
            ...(scopeToSession ? { session } : {}),
          });
          const scope = scopeToSession ? `session ${sessionName}` : "workspace";
          return {
            content: [
              {
                type: "text" as const,
                text: `Scheduled dream for observer=${observer}${observed ? ` observed=${observed}` : ""} (${scope}). Consolidation runs in the background.`,
              },
            ],
          };
        }

        case "create_conclusion": {
          const content = args?.content as string;
          const conclusions = await activePeer.conclusionsOf(activeConfig.peerName).create({
            content,
            sessionId: session.id,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Saved conclusion: ${conclusions[0]?.content || content}`,
              },
            ],
          };
        }

        case "get_briefing": {
          const [summariesResult, ctxResult] = await Promise.allSettled([
            session.summaries(),
            activePeer.context({
              ...(contextTarget ? { target: contextTarget } : {}),
              maxConclusions: 25,
              includeMostFrequent: true,
            }),
          ]);
          const summary =
            summariesResult.status === "fulfilled"
              ? (summariesResult.value as { longSummary?: { content?: string } })?.longSummary
                  ?.content?.trim()
              : null;
          const card: string[] =
            ctxResult.status === "fulfilled"
              ? ((ctxResult.value as { peerCard?: string[] })?.peerCard ?? []).filter(
                  (item: string) => item?.trim(),
                )
              : [];
          const parts: string[] = [];
          if (summary) parts.push(`## Session summary\n${summary}`);
          if (card.length)
            parts.push(`## Peer card (${card.length} items)\n${card.map((i) => `- ${i}`).join("\n")}`);
          if (parts.length === 0)
            parts.push("No briefing available yet — no stored session summary or peer card.");
          return { content: [{ type: "text" as const, text: parts.join("\n\n") }] };
        }

        case "get_context": {
          const maxConclusions = (args?.max_conclusions as number) ?? 25;
          const ctx = await activePeer.context({
            ...(contextTarget ? { target: contextTarget } : {}),
            maxConclusions,
            includeMostFrequent: true,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(ctx, null, 2) }] };
        }

        case "get_representation": {
          const rep = await activePeer.representation(
            contextTarget ? { target: contextTarget } : undefined,
          );
          return {
            content: [
              {
                type: "text" as const,
                text: typeof rep === "string" ? rep : JSON.stringify(rep, null, 2),
              },
            ],
          };
        }

        default:
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
