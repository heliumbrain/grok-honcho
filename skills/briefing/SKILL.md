---
name: briefing
description: Load the Honcho session briefing (session summary + peer card) via MCP get_briefing
---

# Session briefing

Call the Honcho MCP tool `get_briefing` and present the session summary and peer card to the user (or use them as background for the next steps).

If `honcho_remember` is available (opt-in via `rememberTool`), prefer it for mid-session recall instead of a single `chat` call. Use `schedule_dream` when the user asks to consolidate or "dream" on memory.

If nothing is stored yet, say so briefly and continue.
