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

Self-hosted: set `endpoint.baseUrl` (with or without trailing `/v3`). SaaS: omit endpoint or use `endpoint.environment: "production"`.
