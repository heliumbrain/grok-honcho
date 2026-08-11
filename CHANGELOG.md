# Changelog

## [0.1.1] — 2026-08-11

- Auto `bun install` on first hook/MCP use after git install (`scripts/ensure-deps.sh`)
- Document bun requirement in README

## [0.1.0] — 2026-08-11

Initial public release of **grok-honcho**, a Grok Build–native Honcho memory plugin.

### Highlights
- SessionStart / UserPromptSubmit / Stop / SessionEnd hooks for Grok's camelCase hook envelope
- Stop saves assistant text from `lastAssistantMessage` first (fixes claude-honcho no-op on Grok)
- MCP tools: get_briefing, get_config, set_config, chat, search, create_conclusion, list_conclusions, get_context, get_representation
- Host `grok`, default AI peer `grok`, shared `~/.honcho/config.json` (self-hosted endpoints supported)
- Install: `grok plugin install heliumbrain/grok-honcho --trust`

### Attribution
Adapted from [plastic-labs/claude-honcho](https://github.com/plastic-labs/claude-honcho) (MIT).
