/**
 * Stop hook — save assistant text to Honcho.
 *
 * Grok-native: prefer lastAssistantMessage; never no-op when that field is non-empty.
 * Fail open on all errors.
 */

import { Honcho, Session, Peer } from "@honcho-ai/sdk";
import { existsSync, readFileSync } from "fs";
import {
  loadConfig,
  getSessionName,
  getHonchoClientOptions,
  isPluginEnabled,
  getCachedStdin,
} from "../config.js";
import { normalizeHookInput, resolveCwd, extractAssistantText } from "../payload.js";
import { getInstanceIdForCwd, chunkContent, addMessagesBatched } from "../cache.js";
import { logHook, logApiCall, setLogContext } from "../log.js";

export async function handleStop(): Promise<void> {
  try {
    const config = loadConfig();
    if (!config || !isPluginEnabled() || config.saveMessages === false) {
      process.exit(0);
    }

    let raw: Record<string, unknown> = {};
    try {
      const input = getCachedStdin() ?? (await Bun.stdin.text());
      if (input.trim()) raw = JSON.parse(input);
    } catch {
      process.exit(0);
    }

    const hook = normalizeHookInput(raw);

    // Avoid double-save when a previous Stop already continued this turn
    if (hook.stopHookActive) {
      logHook("stop", "Skipping (stopHookActive=true)");
      process.exit(0);
    }

    // Session-end observe fire has no new assistant text to capture
    if (hook.reason && hook.reason !== "end_turn" && !hook.lastAssistantMessage) {
      logHook("stop", `Skipping (reason=${hook.reason}, no lastAssistantMessage)`);
      process.exit(0);
    }

    const cwd = resolveCwd(hook);
    const instanceId = hook.sessionId || getInstanceIdForCwd(cwd) || undefined;
    const sessionName = getSessionName(cwd, instanceId);
    setLogContext(cwd, sessionName);

    const { text, source } = extractAssistantText(hook, (path) => {
      if (!path || !existsSync(path)) return null;
      try {
        return readFileSync(path, "utf-8");
      } catch {
        return null;
      }
    });

    if (!text.trim()) {
      logHook("stop", "Skipping (no assistant content this turn)");
      process.exit(0);
    }

    logHook("stop", `Capturing assistant message via ${source} (${text.length} chars)`);

    const honcho = new Honcho(getHonchoClientOptions(config));
    const noEnsure = () => Promise.resolve();
    const aiPeer = new Peer(config.aiPeer, honcho.workspaceId, honcho.http, undefined, undefined, noEnsure);

    const createdAt = new Date().toISOString();
    const messages = chunkContent(text).map((chunk) =>
      aiPeer.message(chunk, {
        createdAt,
        metadata: {
          instance_id: instanceId || undefined,
          type: "assistant_response",
          session_affinity: sessionName,
          source,
          host: "grok",
        },
      }),
    );

    logApiCall("session.addMessages", "POST", `assistant (${text.length} chars, ${messages.length} chunk(s), ${source})`);

    const session = new Session(sessionName, honcho.workspaceId, honcho.http, undefined, undefined, noEnsure);
    await addMessagesBatched(session, messages, (e) => {
      logHook("stop", `Direct upload failed, retrying via get-or-create: ${e}`);
      return honcho.session(sessionName);
    });

    logHook("stop", `Saved assistant message (${source})`);
  } catch (error) {
    logHook("stop", `Upload failed: ${error}`, { error: String(error) });
  }

  process.exit(0);
}
