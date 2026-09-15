#!/usr/bin/env bash
# Explicitly install the local-only helper. This never edits ~/.grok/config.toml.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-$HOME/.grok/bin/honcho-status-line.js}"

mkdir -p "$(dirname "$TARGET")"
cp "$ROOT/dist/status-line.js" "$TARGET"
printf 'Installed user-owned helper: %s\n' "$TARGET"
printf 'No Grok configuration was changed. Add the documented status_line command only after review.\n'
