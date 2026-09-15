# grok-honcho

**Grok Build–native** persistent memory via [Honcho](https://docs.honcho.dev).

Adapted from [plastic-labs/claude-honcho](https://github.com/plastic-labs/claude-honcho) (MIT).

## Install

**Requires [bun](https://bun.sh)** on your PATH (runtime only — no `bun install` step).

```bash
grok plugin install heliumbrain/grok-honcho --trust
grok plugin enable honcho   # if not already enabled
```

The plugin ships prebuilt `dist/` bundles (MCP + hooks). Dependencies are compiled in; you do **not** need to run `bun install` after installing the plugin.

Local dev / contributors:

```bash
cd /path/to/grok-honcho
bun install          # for tests and rebuilds only
bun run build        # regenerate dist/ after source changes
grok plugin install . --trust
grok plugin enable honcho
```

Then **reload plugin hooks** (required on current Grok Build — see below) and open a project directory.

### Trust vs enable

- **Enable** loads skills/commands; plugins are off until enabled.
- **Trust** (`--trust` or under `~/.grok/plugins/`) allows the plugin’s **hooks and MCP** to run. Without trust, MCP shows as blocked.

Verify:

```bash
grok plugin list
grok plugin details honcho
grok inspect   # optional: inventory
```

### Activate hooks after install (Grok host quirk)

On current Grok Build (**1.0.0** and main through at least 2026-08-10):

| Hook source | Cold start |
|-------------|------------|
| **Global** (`~/.grok/hooks/*.json`) | Auto-load and run |
| **Plugin** (this plugin, `phx`, …) | Discovered / trusted, but **not bound** until reload |

**Workaround (every new Grok process until fixed):** open **`/hooks`** → press **`r`** (reload hooks from disk). A brand-new process + session alone is **not** enough.

MCP skills/tools from the same plugin often work before that reload; message-saving hooks do not. This is a Grok host gap (not specific to grok-honcho). Confirm live hooks via `~/.honcho/activity.log` (`grok-honcho:user-prompt` / `stop` lines).

### MCP without config.toml

Once the plugin is trusted, Honcho MCP attaches from the plugin’s `.mcp.json`. You do **not** need a hand-maintained `[mcp_servers.honcho]` in `~/.grok/config.toml`. If you previously added a manual Honcho MCP block, remove or disable it to avoid duplicate tools.

### Optional native status line

Grok treats `ui.status_line` as a user-owned local command, so this plugin **never** edits `~/.grok/config.toml` and never replaces an existing status line. The opt-in helper reads only bounded local Honcho state—`config.json`, `cache.json`, and the tail of `activity.log`—and performs no network request during status updates. It renders only enabled state, current session association, latest hook/MCP activity age, and concise degraded states; it never shows API keys, prompts, message contents, or tool arguments.

After reviewing and approving the change yourself, install a user-owned copy from the plugin directory:

```bash
bash scripts/install-status-line.sh
```

Then, **only if you have no existing status-line command**, add this exact configuration yourself:

```toml
[ui]
status_line = { command = "bun run ~/.grok/bin/honcho-status-line.js" }
```

If you already use a status line, leave it unchanged; compose a wrapper only if you deliberately want to maintain one. To disable, remove `status_line` from `~/.grok/config.toml`; optionally run `rm ~/.grok/bin/honcho-status-line.js`. `Honcho: setup` means it is unconfigured, `Honcho: off` means it is disabled, and `degraded: no activity` usually means reload hooks with `/hooks` → `r` and complete a turn. `degraded: stale` is local-only—not a connectivity check—so use `get_config` or an MCP tool for server diagnostics.

## Config

Shared file: **`~/.honcho/config.json`** (same as other Honcho clients). Preferred block: `hosts.grok`.

Self-hosted example:

```json
{
  "peerName": "alice",
  "hosts": {
    "grok": {
      "apiKey": "your-key",
      "workspace": "default",
      "aiPeer": "grok",
      "sessionStrategy": "per-directory",
      "endpoint": { "baseUrl": "http://localhost:8000" }
    }
  }
}
```

API key resolution (first match wins): `HONCHO_API_KEY` → `hosts.<host>.apiKey` → root `apiKey`. `get_config` reports `resolved.apiKeySource` as `env` | `host` | `root` and never echoes the key. A `HONCHO_API_KEY` warning is listed when the env var is set.

SaaS: omit `endpoint` (or `"environment": "production"`). Other env overrides: `HONCHO_ENDPOINT`, `HONCHO_PEER_NAME`, `HONCHO_HOST=grok`.

If `hosts.grok` is missing, this plugin **falls back to `hosts.claude_code`** so existing setups keep working without rewriting config.

Session naming (default `per-directory`): `{peerName}-{dirname}` → e.g. `alice-myapp` for `/…/myapp`. Override with root `sessions` map:

```json
"sessions": { "/home/alice/projects/myapp": "my-session" }
```

The `sessions` map is explicit-only (`set_config` `sessions.set`); SessionStart does not auto-pin a directory on first visit. Linked git worktrees resolve to the main repository's session name (and to a main-repo `sessions` entry when present). An explicit mapping for the worktree path still wins.

| `sessionStrategy` | Name | Notes |
|-------------------|------|-------|
| `per-directory` (default) | `{peerName}-{dirname}` | Worktrees share the main repo name |
| `git-branch` | `{peerName}-{dirname}-{branch}` | Branch comes from the checkout (including worktrees). No branch (outside a repo / detached HEAD) falls back to the per-directory shape |
| `chat-instance` | `{peerName}-chat-{sessionId}` | Needs a stable Grok `sessionId` for the life of the chat. Missing `sessionId` falls back to the per-directory shape |

### Config reference

Host-level keys go under `hosts.grok` (or fall back to `hosts.claude_code`). Root keys (`apiKey`, `peerName`, `sessions`, `redactPatterns`) are shared. Prefer `hosts.grok.apiKey` so other hosts can keep their own keys.

| Field | Default | When to change it |
|-------|---------|-------------------|
| `enabled` | `true` | Kill switch. `false`: hooks no-op; every MCP tool except `get_config`/`set_config` errors. Distinct from `saveMessages`. |
| `saveMessages` | `true` | `false`: UserPrompt/Stop/PostToolUse skip Honcho uploads. Hooks and MCP still run. |
| `saveToolUse` | `false` | Opt in to PostToolUse uploads (also requires `saveMessages`). |
| `logging` | `true` | Write `~/.honcho/activity.log`. |
| `sessionStrategy` | `per-directory` | See table above. |
| `sessionPeerPrefix` | `true` | `false` drops `{peerName}-` from session names. Keep `true` in shared/team workspaces to avoid collisions. |
| `observationMode` | `unified` | `unified`: conclusions stored/read as the user peer. `directional`: the AI peer observes the user. Switching modes does **not** migrate existing conclusions. |
| `reasoningLevel` | `medium` | Dialectic budget for the `chat` tool (`minimal` … `max`). |
| `rememberTool` | `false` | Opt in to the `honcho_remember` MCP tool (batched dialectic recall). Off until `set_config field=rememberTool value=true` (or `hosts.grok.rememberTool: true`). |
| `globalOverride` | `false` | `true`: root `workspace`/`aiPeer` win over the host block. Use to force one workspace across hosts. |
| `redactPatterns` | `[]` | Extra regexes, additive to built-in secret redaction. Invalid patterns are rejected by `set_config`. |

Dangerous `set_config` fields (`workspace`, `endpoint.*`) need `confirm=true`.

### Plugin updates

Release checks are **explicit only**: no hook, startup path, status line, or `get_config` call makes a network request. Invoke the `check_plugin_update` MCP tool when you want to check the documented public source, [GitHub Releases for `heliumbrain/grok-honcho`](https://api.github.com/repos/heliumbrain/grok-honcho/releases). It uses a 2-second timeout and a local six-hour success cache at `~/.honcho/plugin-update.json`; failures and malformed responses are reported as unavailable and use a one-minute negative cache so a subsequent explicit retry is not delayed. The request contains only the fixed public releases URL—never credentials, configuration, prompts, or memory. `get_config` displays only the cached update status (installed/latest version, last check, policy, and safe update command). Stable installs consider stable releases only; prerelease installs may consider prereleases. Review and run the displayed `grok plugin update honcho` command yourself.

## Hooks

| Event | Behavior |
|-------|----------|
| **SessionStart** | Ensure session; persist one deduplicated, tagged Git-state observation when available (branch or detached HEAD, commit SHA, clean/dirty); inject memory directives + optional summary; nudge `get_briefing`. Git state excludes diffs, paths, remotes, and credentials; each Git subprocess is capped at one second and 4 KiB output, and non-repositories/failures are skipped. When `rememberTool` is on, name `honcho_remember` as the primary recall path. When `saveMessages=false`, skip Honcho network calls and inject a short notice instead |
| **UserPromptSubmit** | Save real user prompts (skip harness-injected) |
| **PostToolUse** | Log a redacted summary of Write/Edit/Bash/Task (Grok names mapped). Upload only when `saveToolUse=true` (default **off**) and `saveMessages` is not false |
| **PostToolUse / PostToolUseFailure** | For this plugin's qualified `honcho__*` MCP calls only, record local timestamp, tool name, success/error, optional duration, and session/cwd association. Arguments, results, credentials, and recalled memory are never logged or uploaded. |
| **Stop** | Save assistant text from **`lastAssistantMessage` first**; transcript fallback only if needed; skip when `stopHookActive` |
| **PreCompact** | Fetch a compact memory card and write it to `activity.log`. Grok ignores PreCompact stdout, so nothing is injected — call `get_briefing` after compaction |
| **SessionEnd** | Local log only, fail open |

Errors never block the agent. Logs: `~/.honcho/activity.log` with `grok-honcho:` sources.

Hooks are registered via `hooks/hooks.json` and run the prebuilt `dist/hooks/*.js` bundles. They must be **bound in the live session** — on current Grok that means **`/hooks` → `r`** after install or after starting a new Grok process (see [Activate hooks after install](#activate-hooks-after-install-grok-host-quirk)).

## MCP tools

`get_briefing`, `get_config`, `check_plugin_update`, `set_config`, `chat`, `search`, `create_conclusion`, `list_conclusions`, `query_conclusions`, `delete_conclusion`, `get_context`, `get_representation`, `schedule_dream`, `import_grok_transcript`. Opt-in: `honcho_remember` (requires `rememberTool=true`).

- **`honcho_remember`** — batched dialectic recall (1–5 queries, `reasoning_level` `low`/`medium`/`high`). Hidden from the tool list until enabled.
- **`schedule_dream`** — trigger Honcho background consolidation (`scheduleDream` in `@honcho-ai/sdk`). Default scopes to the current session; pass `session: false` for workspace-wide. Observer follows `observationMode`.
- **`import_grok_transcript`** — imports only an explicitly supplied `updates.jsonl`; it never scans real transcript paths. The first call is a dry-run with event/session counts, malformed-line count, a sample without content, and a `previewToken`. Upload requires `confirm: true` plus that exact token. It parses Grok's durable `timestamp` / `method: "session/update"` / `params.sessionId.update` envelope and imports only complete text user/assistant messages with original timestamps; chunk updates are skipped because their current schema has no safe completion marker or message identity. `from`, `to`, `source_sessions`, and `max_events` bound selection; `source-session` (default) keeps historical Grok sessions separate with collision-safe names while `current-session` merges them. Each target associates both peers using the configured observation mode before its messages. Files are capped at 25 MiB / 100,000 lines / 5,000 events; malformed or irrelevant records are skipped; and same-host imports serialize a local ledger around upload. Ledger keys prefer host event IDs, falling back to session/role/timestamp/content identity when the host omits IDs; consequently two genuinely distinct, byte-identical ID-less records cannot be distinguished. The ledger remains best-effort, so failures or separate hosts/filesystems can still permit re-imports.

Skills: `setup`, `status`, `config`, `briefing`, `interview` (first-run preference capture via `chat` + `create_conclusion`), `import-transcript` (explicit-path, preview-and-confirm historical import), `insights` (ranked, evidence-backed suggestions for instructions, configuration, or workflow guidance).

### Insights skill

`insights` uses existing Honcho context, conclusions, search, and optional `schedule_dream` consolidation to propose at most five durable improvements to `AGENTS.md`, configuration, or workflow/skill guidance. It labels one-off context separately, cites redacted supporting memory/conclusion IDs, and ranks proposals by value and confidence. It is advisory: it never edits files or configuration until the user selects a proposal and explicitly confirms its target.

Session for tools resolves from the project cwd (last SessionStart cache, else `process.cwd()`), not a stale other-directory name.

Config is reloaded from disk on every tool call — `set_config` changes (including `enabled`) take effect immediately, no restart required. When `enabled=false`, every tool except `get_config`/`set_config` returns an error instead of reaching Honcho, so you can always re-enable via `set_config`.

### `get_config` response

```jsonc
{
  "resolved": { /* peerName, aiPeer, workspace, endpoint, sessionStrategy, enabled, saveMessages, … */ },
  "current": { "workspace": "…", "session": "alice-myapp", "peerName": "alice", "aiPeer": "grok", "host": "grok", "cwd": "…" },
  "host": { "detected": "grok", "hasHostsBlock": true, "otherHosts": {} },
  "hookHealth": {
    "lastActivityAt": "2026-08-12T10:02:00.000Z",   // null if no hook has run for this project yet
    "lastSessionStartAt": "…", "lastUserPromptAt": "…", "lastStopAt": "…",
    "lastMcpToolAt": "…", "lastMcpToolSuccessAt": "…", "lastMcpToolErrorAt": null,
    "lastMcpTool": { "name": "honcho__get_config", "outcome": "success", "durationMs": 12, "session": "alice-myapp" },
    "logPath": "/home/alice/.honcho/activity.log"
  },
  "warnings": [ /* e.g. "No plugin hook activity found for this project. In Grok, open /hooks and press r, then retry a turn." */ ],
  "configPath": "/home/alice/.honcho/config.json",
  "configExists": true,
  "plugin": {
    "name": "grok-honcho", "version": "0.1.5",
    "update": { "installedVersion": "0.1.5", "latestVersion": null, "checkedAt": null, "updateCommand": "grok plugin update honcho" }
  }
}
```

`hookHealth.lastActivityAt === null` means hooks haven't fired for this project yet — MCP working does not prove hooks are bound (see [Activate hooks after install](#activate-hooks-after-install-grok-host-quirk)). `get_config` surfaces the `/hooks` → `r` reminder as a warning automatically in that case.

## Verification

```bash
bun install && bun test
# cold stdin (fail-open without live Honcho is ok for shape):
echo '{"sessionId":"t","cwd":"/tmp/x","workspaceRoot":"/tmp/x","lastAssistantMessage":"hi","stopHookActive":false,"reason":"end_turn"}' \
  | HONCHO_HOST=grok bun run hooks/stop.ts ; echo exit:$?
```

More detail: [docs/verification.md](docs/verification.md).

## Security

- API keys only in env or `~/.honcho/config.json` — never commit them.
- Hooks fail open; do not rely on them for hard policy enforcement.
- Only install plugins you trust (`--trust` runs hooks/MCP with your privileges).

## License

MIT. Portions adapted from plastic-labs/claude-honcho (MIT).
