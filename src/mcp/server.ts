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
  type HonchoRuntimeConfig,
  type SessionStrategy,
  type ReasoningLevel,
  type HonchoEnvironment,
  type ObservationMode,
} from "../config.js";
import { getLastActiveCwd } from "../cache.js";
import { getHookHealth, getLogPath } from "../log.js";

const DIALECTIC_TIMEOUT_MS = 120_000;

const DANGEROUS_FIELDS = new Set(["workspace", "endpoint.environment", "endpoint.baseUrl"]);

const ENV_SHADOW_MAP: Record<string, string> = {
  peerName: "HONCHO_PEER_NAME",
  workspace: "HONCHO_WORKSPACE",
  aiPeer: "HONCHO_AI_PEER",
  enabled: "HONCHO_ENABLED",
  logging: "HONCHO_LOGGING",
  saveMessages: "HONCHO_SAVE_MESSAGES",
  "endpoint.baseUrl": "HONCHO_ENDPOINT",
  "endpoint.environment": "HONCHO_ENDPOINT",
};

function resolveCwdForMcp(): string {
  // Prefer cwd of last SessionStart; else process.cwd()
  return getLastActiveCwd() || process.cwd();
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
        globalOverride: cfg.globalOverride === true,
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
            warnings,
            configPath: cfgPath,
            configExists: cfgExists,
            plugin: "grok-honcho",
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

  switch (field) {
    case "peerName":
      previousValue = cfg.peerName;
      cfg.peerName = String(value);
      saveRootField("peerName", cfg.peerName);
      cfg.sessions = {};
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
    case "sessionStrategy":
      previousValue = cfg.sessionStrategy ?? "per-directory";
      cfg.sessionStrategy = String(value) as SessionStrategy;
      cfg.sessions = {};
      break;
    case "sessionPeerPrefix":
      previousValue = cfg.sessionPeerPrefix !== false;
      cfg.sessionPeerPrefix = coerceBoolean(value);
      cfg.sessions = {};
      break;
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
    case "reasoningLevel":
      previousValue = cfg.reasoningLevel ?? "medium";
      cfg.reasoningLevel = String(value) as ReasoningLevel;
      break;
    case "observationMode":
      previousValue = cfg.observationMode ?? "unified";
      cfg.observationMode = String(value) as ObservationMode;
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
      previousValue = cfg.sessions[obj.path] ?? null;
      cfg.sessions[obj.path] = obj.name;
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
      previousValue = cfg.sessions[obj.path] ?? null;
      delete cfg.sessions[obj.path];
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

  const activeConfig: HonchoRuntimeConfig | null = config;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search",
        description:
          "Search across messages using semantic search. Defaults to the current session; use scope='workspace' for all sessions.",
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
        description: "List conclusions Honcho has saved about the user",
        inputSchema: {
          type: "object",
          properties: {
            page: { type: "number", default: 1 },
            size: { type: "number", default: 20 },
          },
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
                "reasoningLevel",
                "observationMode",
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
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const cwd = resolveCwdForMcp();

    if (name === "get_config") return handleGetConfig(cwd);
    if (name === "set_config") return handleSetConfig((args ?? {}) as Record<string, unknown>);

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

    const honcho = new Honcho(getHonchoClientOptions(activeConfig));
    const honchoDialectic = new Honcho({
      ...getHonchoClientOptions(activeConfig),
      timeout: DIALECTIC_TIMEOUT_MS,
      maxRetries: 0,
    });

    if (name === "list_conclusions") {
      try {
        const observationMode = getObservationMode(activeConfig);
        const scopePeer =
          observationMode === "unified"
            ? await honcho.peer(activeConfig.peerName)
            : await honcho.peer(activeConfig.aiPeer);
        const conclusionScope = scopePeer.conclusionsOf(activeConfig.peerName);
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
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }

    const sessionName = getSessionName(cwd);

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
          const messages =
            scope === "workspace"
              ? await honcho.search(query, { limit })
              : await session.search(query, { limit });
          const results = messages.map(
            (msg: { content: string; peer?: string; createdAt?: string; created_at?: string }) => ({
              content: msg.content,
              peerId: msg.peer,
              createdAt: msg.createdAt || msg.created_at,
            }),
          );
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
