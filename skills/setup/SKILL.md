---
name: setup
description: First-time Honcho configuration for Grok Build
---

# Setup grok-honcho

1. Install and trust:

```bash
grok plugin install heliumbrain/grok-honcho --trust
# or local: grok plugin install /path/to/grok-honcho --trust
```

2. Ensure the plugin is enabled (plugins are off until listed in `[plugins].enabled` or toggled in the UI):

```bash
grok plugin enable honcho
```

3. Configure `~/.honcho/config.json` with at least `apiKey` and preferred `hosts.grok` (or reuse an existing Claude host block — this plugin falls back to `hosts.claude_code` for endpoint/workspace).

4. **Bind plugin hooks** (Grok host quirk — required until fixed upstream): open **`/hooks`** → press **`r`**.  
   Only **Global** hooks under `~/.grok/hooks/` auto-load on cold start. Plugin hooks (honcho, phx, …) are discovered/trusted but not attached until that reload. A brand-new Grok process + session is **not** enough. MCP from this plugin may already work before reload.

5. Verify: check `~/.honcho/activity.log` for `grok-honcho:user-prompt` / `stop` after a real turn; call MCP `get_config` and confirm session name matches cwd.
