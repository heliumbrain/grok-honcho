# Verification

## Verified (v0.1.0, 2026-08-11)

Machine smoke on implementer host (self-hosted Honcho `http://komodo:8008`, `~/.honcho/config.json` with `hosts.claude_code` fallback → host `grok`):

| Check | Result |
|-------|--------|
| `bun test` | 24 pass |
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

Interactive TUI cold-start (new session without `/hooks` first) was not driven in automation; hooks are registered, trusted, enabled, and proven under representative Grok JSON stdin against the live self-hosted endpoint.

## Unit tests (gating)

```bash
bun install
bun test
```

Covers:

- Grok camelCase Stop payload → `lastAssistantMessage` preferred
- Empty `lastAssistantMessage` + transcript fallback
- `stopHookActive` visible to handlers
- Session naming `nils-svarm` / overrides
- Self-hosted `hosts.grok` and fallback to `hosts.claude_code`

## Local install (gating)

```bash
grok plugin install /path/to/grok-honcho --trust
grok plugin enable honcho
grok plugin details honcho
```

Expect hooks (SessionStart, UserPromptSubmit, Stop, SessionEnd) and MCP server `honcho` listed, not blocked solely for lack of trust.

## Cold-start / stdin smoke

Interactive TUI cold-start may be limited in automation. Minimum bar:

1. Registered hooks in `hooks/hooks.json`
2. Unit tests prove Stop never no-ops on non-empty `lastAssistantMessage`
3. Hook scripts exit 0 under representative Grok JSON stdin (fail-open if Honcho unreachable)

```bash
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

With plugin trusted, call `get_config` in a Grok session opened in a known dir (e.g. `…/svarm`). Session field should be `{peerName}-{dirname}` or a manual override for that path — not another project’s name.

## Publish

```bash
gh repo view heliumbrain/grok-honcho --json isPrivate,url
git tag v0.1.0 && git push origin v0.1.0
```

Install from public:

```bash
grok plugin install heliumbrain/grok-honcho --trust
```
