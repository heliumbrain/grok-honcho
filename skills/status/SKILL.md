---
name: status
description: Show current Honcho memory status and configuration
---

# Honcho status

Call the MCP tool `get_config` (server `honcho`) and summarize:

- Detected host (should be `grok`)
- Workspace, session name, peers
- Endpoint (SaaS vs self-hosted base URL)
- Whether message saving is enabled
- Any warnings

Session name must match the current project directory strategy (default: `{peerName}-{dirname}`).

**Hooks vs MCP:** MCP working does not prove hooks are bound. On current Grok Build only Global hooks auto-load; plugin hooks need **`/hooks` → `r`** after starting Grok. Confirm with `~/.honcho/activity.log` (`grok-honcho:user-prompt` / `stop`). If nothing appears after a turn, reload hooks and retry.

If the MCP tool is unavailable, check that the plugin is installed with `--trust` and enabled:

```bash
grok plugin list
grok plugin details honcho
```
