---
name: config
description: Configure Honcho memory plugin settings interactively
---

# Configure Honcho (Grok)

Config lives at `~/.honcho/config.json` (shared with Claude/other hosts). Prefer a `hosts.grok` block:

```json
{
  "apiKey": "…",
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

Use MCP `get_config` to inspect, `set_config` for careful field updates. Dangerous fields (`workspace`, `endpoint.*`) require `confirm: true`.

See the **Config reference** table in the plugin README for `observationMode`, `reasoningLevel`, `sessionPeerPrefix`, `globalOverride`, and `enabled` vs `saveMessages`.

Config changes take effect immediately — no restart needed. Setting `enabled` to `false` via `set_config` makes every other MCP tool (`search`, `chat`, etc.) return an error until re-enabled; `get_config`/`set_config` keep working so you can flip it back.

Self-hosted: set `endpoint.baseUrl` (with or without trailing `/v3`). SaaS: omit endpoint or use `endpoint.environment: "production"`.
