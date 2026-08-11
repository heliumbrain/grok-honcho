# Contributing

## Dev setup

```bash
bun install
bun test
```

## Layout

Single-plugin repo root (installable as `heliumbrain/grok-honcho`). **Grok-only** — no `.claude-plugin/` tree.

- Manifest: root `plugin.json` + marketplace index `.grok-plugin/marketplace.json`
- Hooks: `hooks/hooks.json` + thin entry scripts; logic in `src/hooks/`; runtime `dist/hooks/`
- MCP: `.mcp.json` → `dist/mcp-server.js` (source: `mcp-server.ts` / `src/mcp/`)
- Skills: `skills/`
- Pure payload/session helpers: `src/payload.ts`, `src/config.ts`

## Local install

```bash
grok plugin install /path/to/grok-honcho --trust
grok plugin enable honcho
```

In the TUI, run **`/hooks` → `r`** so plugin hooks bind. On current Grok Build only Global hooks (`~/.grok/hooks/`) auto-load; plugin hooks stay unbound until that reload.

## Rules of thumb

1. Fail open on hook errors — never block the agent on memory failure.
2. Prefer `lastAssistantMessage` over transcript parsing on Stop.
3. Do not commit secrets; use `~/.honcho/config.json` or env vars.
4. Keep Grok host-first; do not reintroduce Claude-only matchers as the primary path.
5. No force-push to `main` after the first public push.

## PRs

- Add or update unit tests for payload/config changes.
- Run `bun test` and `bunx tsc --noEmit` from the repo root.
- Bump version in `plugin.json` / `package.json` and `CHANGELOG.md` for releases.
