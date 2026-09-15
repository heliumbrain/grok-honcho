---
name: import-transcript
description: Consent-based import of an explicitly selected historical Grok updates.jsonl transcript
---

# Import a historical Grok transcript

Use `import_grok_transcript` only when the user asks to import history and explicitly supplies the path to a single `updates.jsonl` file. Do **not** search for, infer, or open transcript directories.

1. Call the tool without `confirm` to produce a dry-run. Use `from`, `to`, `source_sessions`, and `max_events` to keep the selection bounded.
2. Present the dry-run counts, source-session grouping, malformed/ignored count, truncation status, and the fact that only text user/assistant records will be uploaded with original timestamps. The preview deliberately excludes transcript content.
3. Ask for clear approval. Only after approval call again with `confirm: true` and the exact `previewToken` from the unchanged preview.

Default `session_strategy: "source-session"` imports each original Grok session into a separate Honcho session. Use `"current-session"` only if the user explicitly wants selected history merged into the active project session.

Malformed/torn lines are skipped. A best-effort local ledger prevents successful source events from being imported again. If the tool reports a failed or stopped import, report it accurately; do not bypass the confirmation gate.
