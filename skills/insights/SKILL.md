---
name: insights
description: Turn Honcho memory into ranked, evidence-backed, user-approved improvements to AGENTS.md, configuration, or workflow guidance
---

# Honcho insights

Use this skill only when the user asks to improve project instructions, configuration, or agent workflow from remembered experience. It is advisory: **never edit `AGENTS.md`, configuration, skills, or any other file until the user explicitly selects a suggestion and confirms the target and change.**

## 1. Gather bounded evidence

Start with the current project and use existing Honcho tools:

1. Call `get_config` to identify the current session, workspace, and active settings. Never include an API key or any value that resembles a credential in the report.
2. Call `get_context` (with a bounded `max_conclusions`, normally 25) and `list_conclusions` to collect durable conclusions and peer-card context.
3. Call `search` for focused project/workflow terms. Search the current session first; use `scope: "workspace"` only when cross-session evidence is needed.
4. When a question needs synthesis, call `chat` or, if enabled, `honcho_remember` with 2–5 focused questions. Treat responses as leads, not proof.

If memories may be stale, fragmented, or redundant, offer `schedule_dream` as an optional consolidation step. Explain that it runs in the background and does not change project files. Do not imply that it has completed or use its output as evidence until fresh recall is available.

## 2. Separate durable signals from one-off context

Classify each finding before proposing anything:

- **Durable pattern**: a saved conclusion, repeated behavior across independent sessions, or a stable user preference. Include the supporting conclusion ID(s) or concise redacted memory reference.
- **One-off context**: a single task, transient error, deadline, branch state, or isolated message. Do not turn this into standing instruction; it may be mentioned only as context or a question for the user.
- **Insufficient evidence**: a plausible idea without repeated or conclusion-backed support. Ask a clarifying question instead of making a recommendation.

Never reproduce raw memory that contains or appears to contain secrets, tokens, passwords, private keys, connection strings, personal addresses, or other sensitive data. Summarize it generically (for example, “a redacted credential-handling preference”) or omit it. Do not request secret values to improve a suggestion.

## 3. Produce ranked proposals, not edits

Return at most five proposals, ranked by expected value and confidence. For every proposal include:

- **Rank and target**: `AGENTS.md`, a named config field/file, or a workflow/skill guidance file.
- **Suggested change**: a small, concrete instruction or setting; show a short draft only, never apply it.
- **Why it is durable**: distinguish the durable pattern from any one-off context.
- **Evidence**: conclusion IDs and/or concise redacted references to memory/context; state when evidence is only indirect.
- **Expected benefit and trade-off**.
- **Confidence**: high, medium, or low.

Prefer minimal, reversible guidance. Do not recommend adding a preference to `AGENTS.md` if it is project-local, temporary, or already covered by existing instructions. Do not propose a config change that would expose secrets or silently broaden access.

End with a clear selection gate, for example:

> No files or configuration have been changed. Reply with the proposal number(s), the desired target, and explicit confirmation (for example, “Apply 1 to AGENTS.md”) and I will prepare or make only those changes.

## 4. Apply only after explicit selection and confirmation

After the user names a proposal **and** explicitly confirms its target, re-check the current file/config and summarize the exact change before editing. If the target is a configuration field that already requires `confirm: true`, preserve that MCP confirmation requirement as well.

Apply only the selected proposals. Do not infer approval from interest, discussion, or a request to “make it better.” Afterward, report the changed files/configuration and leave unselected proposals untouched.
