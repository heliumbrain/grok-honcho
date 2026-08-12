# Changelog

## [0.1.4] — 2026-08-12

- `git-branch` session strategy now resolves the current branch via `git branch --show-current` and includes it in the session name; falls back to per-directory naming outside a repo or on detached HEAD
- `get_config` now reports hook-activity health (`hookHealth`: last SessionStart / UserPromptSubmit / Stop timestamps + log path), the resolved plugin version (`plugin: { name, version }`), and a warning to run `/hooks` → `r` when no hook activity is found for the current project
- MCP config is reloaded on every tool call instead of once at server startup, so `set_config` changes (including `enabled`) take effect immediately without a Grok restart
- MCP tools other than `get_config`/`set_config` now return an error when `enabled=false`, instead of silently continuing to reach Honcho
- CI now runs `bun run build` and fails if the committed `dist/` bundles differ, so stale prebuilt bundles can't ship

## [0.1.3] — 2026-08-11

- Zero-install runtime: ship prebuilt `dist/` bundles (MCP + hooks) — no manual `bun install` after plugin install
- MCP: `bun run ${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js` (protocol-clean stdout)
- Hooks: run bundled `dist/hooks/*.js`; `bun` still required on PATH
- `bun run build` regenerates bundles for contributors
- Docs: document Grok host quirk — only **Global** hooks auto-load; plugin hooks need **`/hooks` → `r`** even on a brand-new process/session (affects honcho and other plugins like phx). Fix setup/status skills and verification accordingly.
- Pure Grok plugin: drop `.claude-plugin/`; keep `.grok-plugin/` + root `plugin.json` (hooks/MCP/skills paths explicit)

## [0.1.2] — 2026-08-11

- Fix MCP handshake: launch with direct `bun run ${CLAUDE_PLUGIN_ROOT}/mcp-server.ts` (OpenViking/Telegram pattern)
- Never run `bun install` on MCP spawn — stdout noise broke initialize (Broken pipe)
- `ensure-deps.sh` remains for hooks only; install output redirected off stdout

## [0.1.1] — 2026-08-11

- Auto `bun install` on first hook use after git install (`scripts/ensure-deps.sh`)
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
