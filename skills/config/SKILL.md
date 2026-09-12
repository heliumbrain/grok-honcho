---
name: config
description: Configure Honcho memory plugin settings interactively
---

# Configure Honcho (Grok)

Config lives at `~/.honcho/config.json` (shared with Claude/other hosts). Prefer a `hosts.grok` block:

```json
{
  "peerName": "alice",
  "hosts": {
    "grok": {
      "apiKey": "…",
      "workspace": "default",
      "aiPeer": "grok",
      "sessionStrategy": "per-directory",
      "endpoint": { "baseUrl": "http://localhost:8000" }
    }
  }
}
```

API key: `HONCHO_API_KEY` → `hosts.grok.apiKey` → root `apiKey`. `get_config` reports `resolved.apiKeySource` (`env`/`host`/`root`) and never returns the key.

Use MCP `get_config` to inspect, `set_config` for careful field updates. Dangerous fields (`workspace`, `endpoint.*`) require `confirm: true`. To enable batched recall: `set_config` `field=rememberTool` `value=true` (then `honcho_remember` appears in the tool list). `schedule_dream` is always available.

See the **Config reference** table in the plugin README for `observationMode`, `reasoningLevel`, `sessionPeerPrefix`, `globalOverride`, and `enabled` vs `saveMessages`.

Config changes take effect immediately — no restart needed. Setting `enabled` to `false` via `set_config` makes every other MCP tool (`search`, `chat`, etc.) return an error until re-enabled; `get_config`/`set_config` keep working so you can flip it back.

Self-hosted: set `endpoint.baseUrl` (with or without trailing `/v3`). SaaS: omit endpoint or use `endpoint.environment: "production"`.
