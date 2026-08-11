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

If the tool is unavailable, check that the plugin is installed with `--trust` and enabled:

```bash
grok plugin list
grok plugin details honcho
```
