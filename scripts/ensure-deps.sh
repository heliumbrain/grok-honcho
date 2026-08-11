#!/usr/bin/env bash
# Ensure bun dependencies exist after a git-based plugin install (no node_modules in the clone).
# Used by hooks only — never from MCP spawn (stdout must stay protocol-clean).
# All install noise goes to stderr so it cannot corrupt JSON-RPC if miswired.
set -euo pipefail
ROOT="${GROK_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
if [[ -z "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
cd "$ROOT"
if [[ ! -d node_modules/@honcho-ai/sdk ]]; then
  if command -v bun >/dev/null 2>&1; then
    # Redirect stdout→stderr: bun install prints progress on stdout
    bun install --frozen-lockfile >/dev/null 2>&1 || bun install 1>&2
  else
    echo "[grok-honcho] bun is required. Install bun, then: cd \"$ROOT\" && bun install" >&2
    exit 0 # fail open for hooks
  fi
fi
