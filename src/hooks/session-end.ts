/**
 * SessionEnd — local cleanup only. No network (fail open, return fast).
 */

import { loadConfig, getSessionName, isPluginEnabled, getCachedStdin } from "../config.js";
import { normalizeHookInput, resolveCwd } from "../payload.js";
import { getInstanceIdForCwd } from "../cache.js";
import { logHook, setLogContext } from "../log.js";

export async function handleSessionEnd(): Promise<void> {
  try {
    const config = loadConfig();
    if (!config || !isPluginEnabled()) {
      process.exit(0);
    }

    let raw: Record<string, unknown> = {};
    try {
      const input = getCachedStdin() ?? (await Bun.stdin.text());
      if (input.trim()) raw = JSON.parse(input);
    } catch {
      // defaults
    }

    const hook = normalizeHookInput(raw);
    const cwd = resolveCwd(hook);
    const reason = hook.reason || "unknown";
    const instanceId = hook.sessionId || getInstanceIdForCwd(cwd) || undefined;
    const sessionName = getSessionName(cwd, instanceId);

    setLogContext(cwd, sessionName);
    logHook("session-end", "Session ending", { reason });
    logHook("session-end", "Session ended — no upload (messages saved live)");
  } catch (error) {
    logHook("session-end", `Error: ${error}`, { error: String(error) });
  }

  process.exit(0);
}
