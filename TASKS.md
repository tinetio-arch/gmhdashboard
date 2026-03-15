# TASKS.md — AntiGravity Task Queue

> **Instructions**: Pick the highest priority pending task. Mark it 🔄 when starting, ✅ when done.
> Add new tasks at the bottom with the next number. Never delete completed tasks — they're your history.

---

## Priority Legend
- 🔴 **CRITICAL** — Blocking production or patient care
- 🟡 **HIGH** — Important feature or significant bug
- 🟢 **MEDIUM** — Improvement or non-blocking bug
- 🔵 **LOW** — Nice to have, tech debt cleanup

## Status Legend
- ⬜ **PENDING** — Not started
- 🔄 **IN PROGRESS** — Currently being worked on
- ✅ **DONE** — Completed (include date and summary)
- ❌ **BLOCKED** — Cannot proceed (include reason)

---

## Active Tasks

### Task 001 — [TEMPLATE]
- **Priority**: 🟡 HIGH
- **Status**: ⬜ PENDING
- **Description**: Brief description of what needs to be done
- **Files**: `app/api/example/route.ts`, `lib/example.ts`
- **Acceptance Criteria**:
  - [ ] Criterion 1
  - [ ] Criterion 2
  - [ ] Build passes (`npx next build`)
  - [ ] Tested with curl or browser
- **Notes**: Any additional context, links, or gotchas
- **Completed**: _(date and brief summary when done)_

---

## Completed Tasks

_(Move completed tasks here to keep the active section clean)_

---

## How Perplexity Adds Tasks

Perplexity Computer writes task specs here with full context:
- Exact files to modify
- Code patterns to follow (referencing CLAUDE.md)
- Database schema if relevant
- API contracts (request/response shapes)
- Test commands to verify

AntiGravity picks them up, implements, and marks done.

---

*This file is the shared handoff point between Perplexity (research/planning) and AntiGravity (implementation).*
