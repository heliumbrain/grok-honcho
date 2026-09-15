---
name: status-line
description: Opt-in local Honcho health in Grok's command status line
---

# Honcho status line (opt in)

Grok's `ui.status_line` runs a user-configured local command. This plugin must **never** write `~/.grok/config.toml` or replace a status line. First inspect the user's existing configuration and ask whether they want this integration.

If they approve and **no** `ui.status_line` is configured, present these exact commands/configuration for the user to review and run themselves:

```bash
# From this plugin checkout/install directory; copies only the helper.
bash scripts/install-status-line.sh
```

```toml
# ~/.grok/config.toml — add only after reviewing the command above.
[ui]
status_line = { command = "bun run ~/.grok/bin/honcho-status-line.js" }
```

Do not execute either command or edit the file. The helper is user-owned after copying, reads stdin plus local `~/.honcho/{config.json,cache.json,activity.log}`, and makes no network requests. It shows only: Honcho enabled state, local session association, the latest hook/MCP activity age, and concise degraded state. It never emits keys, prompts, message bodies, or tool arguments.

If a status line already exists, preserve it. Offer to help the user compose an explicit wrapper only if they request that work; do not infer another command's behavior or overwrite its configuration.

## Disable

The user can remove the `status_line` entry from `~/.grok/config.toml`. Optionally remove the copied helper:

```bash
rm ~/.grok/bin/honcho-status-line.js
```

## Troubleshooting

- `Honcho: setup`: configure Honcho, then restart/reload the status line.
- `Honcho: off`: set `hosts.grok.enabled` (or root `enabled`) to `true` in `~/.honcho/config.json`.
- `degraded: no activity`: open `/hooks`, press `r`, and complete a real turn. MCP activity is also shown after an MCP tool call.
- `degraded: stale`: the helper is intentionally local-only; it cannot test server connectivity. Use `get_config` or a normal Honcho MCP tool for network diagnostics.
- No line: verify Bun is on `PATH`, the copied helper exists, and the command matches the TOML exactly.
