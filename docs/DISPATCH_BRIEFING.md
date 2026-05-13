# Dispatch Briefing — For New Cowork/Dispatch Sessions

> **Last updated**: May 12, 2026 (evening — Cowork dispatch build)
> **Purpose**: Read this FIRST when starting a new Dispatch session. Contains current state, active work, and key decisions.

## What Happened Most Recently (May 12, 2026)

### Bug Fixes Deployed
- 4 critical iPad bugs fixed by claude8: dob column rename, UUID cast, Healthie timezone, scribe transcription
- Messages badge fix cherry-picked from claude1
- ABXTAC password reset hardening
- All merged to master, production running commit 8eac0d2+

### McKesson New-Order Modal (Cowork, evening of May 12) ✅ SHIPPED
- iPad **📦 New Order** button on Supplies tab → modal with picker → cart → dryRun preview → confirm submit.
- Backend: new `POST /api/ipad/mckesson/orders` (iPad-namespaced; existing `/api/mckesson/orders` left untouched). dryRun=true is the default; live submit requires UUID-v4 `idempotencyKey`.
- Production gate (`MCKESSON_ALLOW_PRODUCTION_ORDERS`) **stays false** — every live submit currently returns 503 `gateEngaged:true`. The 36-assertion test script (`scripts/test-mckesson-new-order.ts`) includes this as test #11. Phil flips the gate manually when ready.
- DB migration: `migrations/20260512_mckesson_order_idempotency.sql` (partial UNIQUE index on `mckesson_orders.idempotency_key`).
- Mobile synced to `app.c77759b5.js`.
- Plan: `~/gmhdashboard/.tmp/mckesson-new-order-modal.plan.md`.
- Commits: `598b1ea` (feature) + `45d8fda` (test endpoint trailing-slash fix); merged via `5aa2ad7`.
- Note: claude-mckesson's "ready to merge" framing from earlier was misleading — that session was still parked. This work was done from Cowork on a fresh `claude/dispatch-build/mckesson-new-order-modal` branch.
- Follow-up: Dispatch-chat ordering tool wraps this same backend (outlined in plan §10; ~150 lines in `~/dispatch-mcp/server.py` — not built yet).

### Infrastructure Built Today
- `scripts/pre-deploy-check.sh` — mandatory gatekeeper before any pm2 restart
- `scripts/refresh-project-tracker.sh` — auto-generates live data section of PROJECT_TRACKER.md
- `docs/archive/` — system for archiving completed work from project tracker
- Context preservation + code safety rules added to CLAUDE.md
- All SOT modules refreshed with live data (was stale since April 6)
- DEPENDENCIES.md, CLAUDE_MEMORY_PINS.md, INDEX.md all updated
- **Dispatch-MCP**: send-prompt fix + worktree-isolation patch deployed (separate work; fresh `cs` tmux sessions now get their own worktree automatically — Cowork-via-SSH keeps using the shared tree with careful targeted `git add`).

### Key Decisions Made
- ignoreBuildErrors stays true for now (146 pre-existing TS errors, mostly admin pages)
- Dave Brown DOB (2026-04-29) is a known data entry typo — don't keep flagging it
- All Claude Code sessions must go through the coordinator (claude-coord)
- Agents dashboard lives at nowoptimal.com/agents/ (NOT /ops/agents — that was a mistake, removed)
- No permanent "master agent" needed — Dispatch checks agents on demand using coordinator tools

## Currently In Progress
- **claude3** — SOT refresh, adding daily cron for project tracker. Almost done.
- **claude9** — Adding file upload support to agents dashboard inbox. In progress.
- **claude8** — Completed. Should be checked out.

## Sessions That Should Be Cleaned Up
- claude, claude1, claude5 — unassigned, idle. Kill them.
- claude2, claude4, claude7 — old tasks, idle. Review or kill.
- claude-mckesson — McKesson integration WIP, parked.
- claude-task-ghl-email-template — patient dedup work, parked.
- claude6 — TRT booking fix, 1876 inherited dirty files, needs review before deploy.

## How To Check Agents
```bash
# From Dispatch, use the coordinator MCP tools:
claude-coord list                    # all sessions + tasks
claude-coord show <session>          # full session log with history
claude-coord capture_pane <session>  # current terminal state
claude-coord git_status_all          # branches, uncommitted files
claude-coord conflicts <paths>       # check for file collisions
claude-coord debug                   # run 26-test debug suite
```

## Morning Pulse
Scheduled task runs at 7 AM MST (14:00 UTC cron). Sometimes fails when sandbox lacks SSH access. If it fails, run manually:
```bash
ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8 "bash ~/gmhdashboard/scripts/health-check.sh && bash ~/gmhdashboard/scripts/generate-status-report.sh"
```
Then read ~/gmhdashboard/docs/KPI_CHECK.md and LIVE_STATUS.md.

## Phil's Priorities (as of May 12)
1. Stop breaking code — the #1 frustration. Coordinator + gatekeeper + rules are the fix.
2. Agents need to talk to each other — coordinator handles this, but needs enforcement.
3. Single dashboard at /agents/ for all agent visibility — don't build separate UIs.
4. Mobile app still has 0/260 verified patients — month-old issue.
5. Billing holds keep bouncing between 6-9 — payment failures create new ones as fast as old ones resolve.
