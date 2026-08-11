#!/usr/bin/env bash
# Ensure bun dependencies exist after a git-based plugin install (no node_modules in the clone).
set -euo pipefail
ROOT="${GROK_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
if [[ -z "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
cd "$ROOT"
if [[ ! -d node_modules/@honcho-ai/sdk ]]; then
  if command -v bun >/dev/null 2>&1; then
    bun install --frozen-lockfile 2>/dev/null || bun install
  else
    echo "[grok-honcho] bun is required. Install bun, then: cd \"$ROOT\" && bun install" >&2
    exit 0 # fail open for hooks
  fi
fi
