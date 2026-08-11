# grok-honcho

**Grok Build–native** persistent memory via [Honcho](https://docs.honcho.dev).

Adapted from [plastic-labs/claude-honcho](https://github.com/plastic-labs/claude-honcho) (MIT).

## Install

**Requires [bun](https://bun.sh)** on your PATH (hooks and MCP run with `bun`).

```bash
grok plugin install heliumbrain/grok-honcho --trust
grok plugin enable honcho   # if not already enabled
```

Git installs do not ship `node_modules`. The first hook/MCP run runs `bun install` via `scripts/ensure-deps.sh` (or run it yourself once under the installed plugin path).

Local dev:

```bash
cd /path/to/grok-honcho && bun install
grok plugin install /path/to/grok-honcho --trust
grok plugin enable honcho
```

Then **start a new Grok session**. Trusted+enabled plugins load hooks and MCP without a manual `/hooks` dance. If hooks still look empty once, press `r` in the Plugins tab or restart the session.

### Trust vs enable

- **Enable** loads skills/commands; plugins are off until enabled.
- **Trust** (`--trust` or under `~/.grok/plugins/`) activates **hooks and MCP**. Without trust, MCP shows as blocked.

Verify:

```bash
grok plugin list
grok plugin details honcho
grok inspect   # optional: inventory
```

### MCP without config.toml

Once the plugin is trusted, Honcho MCP attaches from the plugin’s `.mcp.json`. You do **not** need a hand-maintained `[mcp_servers.honcho]` in `~/.grok/config.toml`. If you previously added a manual Honcho MCP block, remove or disable it to avoid duplicate tools.

## Config

Shared file: **`~/.honcho/config.json`** (same as other Honcho clients). Preferred block: `hosts.grok`.

Self-hosted example:

```json
{
  "apiKey": "your-key",
  "peerName": "alice",
  "hosts": {
    "grok": {
      "workspace": "default",
      "aiPeer": "grok",
      "sessionStrategy": "per-directory",
      "endpoint": { "baseUrl": "http://localhost:8000" }
    }
  }
}
```

SaaS: omit `endpoint` (or `"environment": "production"`). Env overrides: `HONCHO_API_KEY`, `HONCHO_ENDPOINT`, `HONCHO_PEER_NAME`, `HONCHO_HOST=grok`.

If `hosts.grok` is missing, this plugin **falls back to `hosts.claude_code`** so existing setups keep working without rewriting config.

Session naming (default `per-directory`): `{peerName}-{dirname}` → e.g. `alice-myapp` for `/…/myapp`. Override with root `sessions` map:

```json
"sessions": { "/home/alice/projects/myapp": "my-session" }
```

## Hooks

| Event | Behavior |
|-------|----------|
| **SessionStart** | Ensure session; inject memory directives + optional summary; nudge `get_briefing` |
| **UserPromptSubmit** | Save real user prompts (skip harness-injected) |
| **Stop** | Save assistant text from **`lastAssistantMessage` first**; transcript fallback only if needed; skip when `stopHookActive` |
| **SessionEnd** | Local log only, fail open |

Errors never block the agent. Logs: `~/.honcho/activity.log` with `grok-honcho:` sources.

## MCP tools

`get_briefing`, `get_config`, `set_config`, `chat`, `search`, `create_conclusion`, `list_conclusions`, `get_context`, `get_representation`.

Session for tools resolves from the project cwd (last SessionStart cache, else `process.cwd()`), not a stale other-directory name.

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
