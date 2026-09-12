# Verification

## Current (v0.1.4, 2026-09-12)

Gating checks on `main` after #31 (`9cc80d3`; tag `v0.1.4` is `83f771c`):

| Check | Result |
|-------|--------|
| `bun test` | 70 pass |
| `bunx tsc --noEmit` | pass |
| `bun run build` + `git diff --exit-code -- dist` | pass (committed bundles match) |
| GitHub release | https://github.com/heliumbrain/grok-honcho/releases/tag/v0.1.4 |

CI workflow: `.github/workflows/ci.yml` (bun 1.3.14, frozen lockfile, tests, typecheck, dist freshness).

Interactive TUI was last smoked on Grok Build **1.0.0** (2026-08-11): plugin hooks **do not auto-bind on cold start** (only Global `~/.grok/hooks/` load). After `/hooks` → `r`, SessionStart / UserPromptSubmit / Stop fire and write `activity.log`. Re-run the TUI steps below on a current Grok Build if you need a fresh host confirmation.

## Unit tests (gating)

```bash
bun install
bun test
bunx tsc --noEmit
```

Covers:

- Grok camelCase Stop payload → `lastAssistantMessage` preferred; transcript fallback when empty
- `stopHookActive` visible to handlers
- Session naming: `per-directory` (`nils-svarm`), `git-branch`, `chat-instance` (stable `sessionId`, fallback without it)
- Linked git worktrees resolve to the main-repo session; explicit worktree `sessions` entries still win
- Cwd normalization (trailing slash) for cache / session-override keys
- Self-hosted `hosts.grok` and fallback to `hosts.claude_code`
- Hook stdin: SessionStart / UserPromptSubmit / Stop / SessionEnd / PreCompact / PostToolUse fail-open; `saveMessages=false` skips Honcho network on SessionStart
- PostToolUse Grok tool-name mapping + secret redaction
- MCP: `set_config` keeps session overrides; `enabled=false` takes effect without restart; `query_conclusions` / `delete_conclusion` listed
- Marketplace / plugin / package versions stay aligned
- Per-host `apiKey` (`hosts.grok.apiKey` vs root vs `HONCHO_API_KEY`) and `get_config.resolved.apiKeySource`
- Opt-in `honcho_remember` (hidden until `rememberTool=true`; arg validation without Honcho)
- `schedule_dream` listed; SessionStart directives switch on `rememberTool`

## Local install (gating)

```bash
grok plugin install /path/to/grok-honcho --trust
grok plugin enable honcho
grok plugin details honcho
```

Expect hooks (SessionStart, UserPromptSubmit, PostToolUse, PreCompact, Stop, SessionEnd) and MCP server `honcho` listed, not blocked solely for lack of trust.

## Cold-start / stdin smoke

### TUI binding (Grok host)

1. Install + trust + enable (above).
2. Open **`/hooks` → `r`** (plugin hooks are not auto-bound on cold start; Global hooks are).
3. Send a user message and wait for a reply.
4. Expect `~/.honcho/activity.log` lines: `grok-honcho:user-prompt` then `grok-honcho:stop` with a non-empty save.

Without step 2, MCP may still work while hooks stay silent — that is the host quirk, not a plugin misconfig. `get_config` reports `hookHealth.lastActivityAt === null` and warns to run `/hooks` → `r` in that case.

### Stdin (handlers without TUI)

Minimum bar independent of TUI binding:

1. Registered hooks in `hooks/hooks.json`
2. Unit tests prove Stop never no-ops on non-empty `lastAssistantMessage`
3. Hook scripts exit 0 under representative Grok JSON stdin (fail-open if Honcho unreachable)

```bash
export GROK_PLUGIN_ROOT=/path/to/grok-honcho
export HONCHO_HOST=grok

echo '{"sessionId":"verify-1","cwd":"/tmp/grok-honcho-verify","workspaceRoot":"/tmp/grok-honcho-verify","source":"startup"}' \
  | bun run "$GROK_PLUGIN_ROOT/hooks/session-start.ts"

echo '{"sessionId":"verify-1","cwd":"/tmp/grok-honcho-verify","workspaceRoot":"/tmp/grok-honcho-verify","prompt":"hello memory verify"}' \
  | bun run "$GROK_PLUGIN_ROOT/hooks/user-prompt.ts"

echo '{"sessionId":"verify-1","cwd":"/tmp/grok-honcho-verify","workspaceRoot":"/tmp/grok-honcho-verify","stopHookActive":false,"reason":"end_turn","lastAssistantMessage":"assistant verify reply"}' \
  | bun run "$GROK_PLUGIN_ROOT/hooks/stop.ts"
```

Check `~/.honcho/activity.log` for `grok-honcho:session-start` / `stop` lines with the verify session name.

## MCP get_config

With plugin trusted, call `get_config` in a Grok session opened in a known dir (e.g. `…/svarm`). Session field should be `{peerName}-{dirname}` or a manual override for that path — not another project’s name. `resolved.apiKeySource` should be `env`, `host`, or `root`; the key itself must not appear.

## MCP remember / dream

- Default: `listTools` includes `schedule_dream` and does **not** include `honcho_remember`.
- `set_config field=rememberTool value=true`, then `listTools` includes `honcho_remember`.
- Invalid `honcho_remember` args (empty queries, more than 5, `reasoning_level=max`) error without contacting Honcho.
- Live Honcho (optional): `honcho_remember` with 1–2 `low` queries returns labeled answers; `schedule_dream` returns a scheduled confirmation.

Also check:

- `plugin.version` is `0.1.4`
- `hookHealth` timestamps populate after a bound SessionStart / UserPrompt / Stop
- `warnings` includes the `/hooks` → `r` reminder when `hookHealth.lastActivityAt` is null

## Publish

Version bump in `plugin.json`, `package.json`, `.grok-plugin/marketplace.json`, and `CHANGELOG.md` (the versions test fails if those drift). Then:

```bash
git tag -a v0.1.x -m "v0.1.x — …"
git push origin v0.1.x
gh release create v0.1.x --title "v0.1.x" --notes-file -
```

Install from public (git tip of main, or a tag):

```bash
grok plugin install heliumbrain/grok-honcho --trust
grok plugin enable honcho
# then in TUI: /hooks → r
```

## Historical smoke (v0.1.0, 2026-08-11)

Machine smoke on implementer host (self-hosted Honcho `http://komodo:8008`, `~/.honcho/config.json` with `hosts.claude_code` fallback → host `grok`):

| Check | Result |
|-------|--------|
| `bun test` | 24 pass (suite has grown since) |
| `grok plugin install <repo-root> --trust` + enable | hooks + MCP listed |
| SessionStart stdin | session `nils-verify-proj`, peers `nils/grok` |
| UserPromptSubmit | user message saved |
| Stop + `lastAssistantMessage` | **Saved assistant message (lastAssistantMessage)** |
| Session name from cwd | `nils-verify-proj` / fixture `nils-svarm` |

Activity log excerpts:

```
grok-honcho:session-start Starting session in …/verify-proj session=nils-verify-proj
grok-honcho:user-prompt Saved user prompt
grok-honcho:stop Capturing assistant message via lastAssistantMessage (56 chars)
grok-honcho:stop Saved assistant message (lastAssistantMessage)
```
