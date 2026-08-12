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
- Plugin version and recent hook timestamps for the current project
- Any warnings

Session name must match the current project directory strategy (default: `{peerName}-{dirname}`).

**Hooks vs MCP:** MCP working does not prove hooks are bound. If `get_config` reports no hook activity, follow its **`/hooks` → `r`** instruction and retry a turn.

If the MCP tool is unavailable, check that the plugin is installed with `--trust` and enabled:

```bash
grok plugin list
grok plugin details honcho
```
