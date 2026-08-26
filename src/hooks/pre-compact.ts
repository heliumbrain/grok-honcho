/**
 * PreCompact — build a memory card before compaction.
 *
 * Grok treats PreCompact as a passive event and ignores hook stdout, so this
 * does not emit additionalContext (that would be a no-op / invalid output).
 * The card is written to the activity log; call get_briefing after compact.
 * Fail open.
 */

import { Honcho } from "@honcho-ai/sdk";
import {
  loadConfig,
  getSessionName,
  getGitBranch,
  getHonchoClientOptions,
  isPluginEnabled,
  getCachedStdin,
  getObservationMode,
} from "../config.js";
import { normalizeHookInput, resolveCwd } from "../payload.js";
import { logHook, logApiCall, setLogContext } from "../log.js";

const FETCH_TIMEOUT_MS = 10_000;

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function formatMemoryCard(
  config: { peerName: string; aiPeer: string; workspace: string },
  sessionName: string,
  userContext: { peerCard?: string[]; representation?: string } | null,
  summaries: { shortSummary?: { content?: string } } | null,
): string {
  const parts = [
    `## HONCHO MEMORY ANCHOR
This context is being compacted. Preserve these conclusions.

### Session Identity
- User: ${config.peerName}
- AI: ${config.aiPeer}
- Workspace: ${config.workspace}
- Session: ${sessionName}`,
  ];

  const peerCard = userContext?.peerCard;
  if (peerCard && peerCard.length > 0) {
    parts.push(`### ${config.peerName}'s Profile (PRESERVE)\n${peerCard.join("\n")}`);
  }

  const userRep = userContext?.representation;
  if (typeof userRep === "string" && userRep.trim()) {
    parts.push(`### Key Conclusions About ${config.peerName} (PRESERVE)\n${userRep}`);
  }

  const shortSummary = summaries?.shortSummary?.content;
  if (shortSummary) {
    parts.push(`### Session Context (PRESERVE)\n${shortSummary}`);
  }

  parts.push(`### End Memory Anchor
Call get_briefing after compaction if this context is missing.`);
  return parts.join("\n\n");
}

export async function handlePreCompact(): Promise<void> {
  try {
    const config = loadConfig();
    if (!config || !isPluginEnabled()) process.exit(0);

    let raw: Record<string, unknown> = {};
    try {
      const input = getCachedStdin() ?? (await Bun.stdin.text());
      if (input.trim()) raw = JSON.parse(input);
    } catch {
      // defaults
    }

    const hook = normalizeHookInput(raw);
    const cwd = resolveCwd(hook);
    const trigger = hook.trigger || "auto";
    const branch = config.sessionStrategy === "git-branch" ? getGitBranch(cwd) : undefined;
    const sessionName = getSessionName(cwd, hook.sessionId, config, branch);
    setLogContext(cwd, sessionName);
    logHook("pre-compact", `Compaction triggered (${trigger})`);

    const honcho = new Honcho(getHonchoClientOptions(config));
    const observationMode = getObservationMode(config);
    const session = await honcho.session(sessionName);
    const contextPeer =
      observationMode === "unified"
        ? await honcho.peer(config.peerName)
        : await honcho.peer(config.aiPeer);
    const contextTarget = observationMode === "unified" ? undefined : config.peerName;

    logApiCall("peer.context", "GET", observationMode);
    logApiCall("session.summaries", "GET", sessionName);

    const [userContext, summaries] = await Promise.all([
      raceTimeout(
        contextPeer.context({
          ...(contextTarget ? { target: contextTarget } : {}),
          maxConclusions: 30,
          includeMostFrequent: true,
        }),
        FETCH_TIMEOUT_MS,
      ),
      raceTimeout(session.summaries(), FETCH_TIMEOUT_MS),
    ]);

    const memoryCard = formatMemoryCard(
      config,
      sessionName,
      userContext as { peerCard?: string[]; representation?: string } | null,
      summaries as { shortSummary?: { content?: string } } | null,
    );

    // Grok ignores PreCompact stdout (passive event). Log the card; do not invent a side channel.
    logHook("pre-compact", `Memory card built (${memoryCard.length} chars); Grok ignores PreCompact stdout so it was not injected`, {
      trigger,
    });
  } catch (error) {
    logHook("pre-compact", `Error: ${error}`, { error: String(error) });
  }

  process.exit(0);
}
