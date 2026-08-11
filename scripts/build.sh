#!/usr/bin/env bash
# Build zero-dependency runtime bundles (MCP + hooks). No node_modules needed at runtime.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p dist/hooks

echo "Building MCP server…"
bun build ./mcp-server.ts --outfile dist/mcp-server.js --target bun

for h in session-start session-end user-prompt stop; do
  echo "Building hooks/${h}…"
  bun build "./hooks/${h}.ts" --outfile "dist/hooks/${h}.js" --target bun
done

echo "Done:"
ls -lh dist/mcp-server.js dist/hooks/*.js
