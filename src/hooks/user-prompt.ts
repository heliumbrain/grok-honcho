/**
 * UserPromptSubmit — save real user prompts to Honcho (fail open).
 * Skips harness-injected content. Injection/context is via MCP get_briefing, not heavy per-turn.
 */

import { Honcho, Session, Peer } from "@honcho-ai/sdk";
import {
  loadConfig,
  getSessionName,
  getHonchoClientOptions,
  isPluginEnabled,
  getCachedStdin,
} from "../config.js";
import {
  normalizeHookInput,
  resolveCwd,
  shouldSaveUserPrompt,
  isTerseReply,
  isHarnessInjected,
} from "../payload.js";
import { getInstanceIdForCwd, chunkContent, addMessagesBatched } from "../cache.js";
import { logHook, logApiCall, setLogContext } from "../log.js";

export async function handleUserPrompt(): Promise<void> {
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
    const prompt = hook.prompt || "";
    if (!shouldSaveUserPrompt(prompt)) {
      if (isHarnessInjected(prompt)) {
        logHook("user-prompt", "Skipping upload (harness-injected content)");
      }
      process.exit(0);
    }

    const cwd = resolveCwd(hook);
    const instanceId = hook.sessionId || getInstanceIdForCwd(cwd) || undefined;
    const sessionName = getSessionName(cwd, instanceId);
    setLogContext(cwd, sessionName);

    logHook("user-prompt", `Prompt received (${prompt.length} chars)`);

    const honcho = new Honcho(getHonchoClientOptions(config));
    const noEnsure = () => Promise.resolve();
    const userPeer = new Peer(
      config.peerName,
      honcho.workspaceId,
      honcho.http,
      undefined,
      undefined,
      noEnsure,
    );

    const createdAt = new Date().toISOString();
    const configuration = isTerseReply(prompt) ? { reasoning: { enabled: false } } : undefined;
    const messages = chunkContent(prompt).map((chunk) =>
      userPeer.message(chunk, {
        createdAt,
        metadata: {
          instance_id: instanceId || undefined,
          session_affinity: sessionName,
          host: "grok",
        },
        ...(configuration ? { configuration } : {}),
      }),
    );

    logApiCall("session.addMessages", "POST", `user prompt (${prompt.length} chars, ${messages.length} msg)`);

    const session = new Session(sessionName, honcho.workspaceId, honcho.http, undefined, undefined, noEnsure);
    await addMessagesBatched(session, messages, (e) => {
      logHook("user-prompt", `Direct upload failed, retrying via get-or-create: ${e}`);
      return honcho.session(sessionName);
    });

    logHook("user-prompt", "Saved user prompt");
  } catch (error) {
    logHook("user-prompt", `Upload failed: ${error}`, { error: String(error) });
  }

  process.exit(0);
}
