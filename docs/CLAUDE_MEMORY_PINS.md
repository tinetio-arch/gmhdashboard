# Claude Memory Pins — GMH Dashboard

> **Purpose**: Copy these into Claude Code `/memory` or session context. Each pin is a critical fact that prevents common AI mistakes on this codebase.
> **Last refreshed**: 2026-05-12 — added coordinator usage, pre-deploy gatekeeper, branch discipline, file count guardrails.

---

## System Identity

- GMH Dashboard is a Next.js 14 healthcare ops platform at `/home/ec2-user/gmhdashboard`
- Production URL: `https://nowoptimal.com/ops/` (base path is `/ops`)
- The MASTER reference document is `ANTIGRAVITY_SOURCE_OF_TRUTH.md` (5,733 lines, last updated 2026-04-22). Use `docs/sot-modules/INDEX.md` to load only relevant sections (29 modules + INDEX).
- Live system state lives in `docs/PROJECT_TRACKER.md` (regenerated daily by `scripts/refresh-project-tracker.sh` at 6am MST).

## Source of Truth Hierarchy

- **Tier 1 (Real-time)**: Healthie API, Postgres database, PM2 process list
- **Tier 2 (Near real-time)**: GHL API, Stripe
- **Tier 3 (Delayed 4-6hr)**: Snowflake analytics warehouse
- **RULE**: For patient data, ALWAYS query Postgres first, then Healthie API. NEVER trust Snowflake for real-time data (6hr lag).

## Base Paths & Critical Directories

- Active codebase: `/home/ec2-user/gmhdashboard/` (NOT `/apps/gmh-dashboard`)
- PM2 ecosystem config: `/home/ec2-user/ecosystem.config.js`
- Nginx config: `/etc/nginx/conf.d/nowoptimal.conf`
- Environment vars: `/home/ec2-user/gmhdashboard/.env.local`
- Websites monorepo: `/var/www/nowoptimal-websites/`
- Live NowPrimary (with booking): `/home/ec2-user/nowprimarycare-website/`
- ABX TAC WordPress: `/var/www/abxtac/`

## Database Connection

- Host: `clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com`
- Database: `postgres`, User: `clinicadmin`, Port: 5432, SSL required
- Connection pool: `lib/db.ts` — single pool for all queries
- **118 tables** total (as of 2026-05-12; up from 88 in April). Key tables: patients (491 rows), healthie_clients (503), vials, dea_transactions, payment_transactions, lab_review_queue, **bioscope_authorized_patients**, **patient_status_audit**, **patient_signals_cache**, **agent_action_log**, **patient_push_tokens**

## Critical Providers & Patients

- **Phil Schafer NP** (Healthie ID: 12088269) — works BOTH locations
- **Dr. Aaron Whitten** (Healthie ID: 12093125) — Medical Director, Men's Health focus
- NOW Primary Care location ID: 13023235 (212 S Montezuma)
- NOW Men's Health location ID: 13029260 (215 N McCormick)
- Healthie Groups: Men's Health=75522, Primary Care=75523, Weight Loss=75976

## PM2 Rules (NEVER VIOLATE)

- NEVER start services with `pm2 start npm -- start` — always use `pm2 start ecosystem.config.js --only <name>`
- All services MUST have `max_restarts: 10` and `restart_delay: 5000`
- After ANY PM2 change: `pm2 save`
- Port conflicts cause infinite restart loops (burned CPU: 34,000+ restarts incident Jan 28, 106,000+ restarts incident Feb)
- gmh-dashboard=3011, upload-receiver=3001, jessica-mcp=3002, ghl-webhooks=PM2-only (no TCP listener observed 2026-05-12), nowmentalhealth-website=3003, nowprimary-website=3004, nowmenshealth-website=3007, nowoptimal-website=3008, abxtac-website=3009, dispatch-mcp=3010

## Mandatory Pre-Deploy Gatekeeper (NEW — May 2026)

**BEFORE every `pm2 restart gmh-dashboard`**, run:
```bash
bash ~/gmhdashboard/scripts/pre-deploy-check.sh
```
- Exit code 0 = SAFE to deploy. Proceed with `pm2 restart gmh-dashboard && pm2 save`.
- Exit code non-zero = BLOCKED. Do NOT deploy. Read `docs/DEPLOY_CHECK.md` and fix failures first.
- After deploy, run `bash ~/gmhdashboard/scripts/health-check.sh` to verify nothing regressed (writes `docs/KPI_CHECK.md`).
- `claude-coord checkout` will re-run debug as a safety gate — override with `--skip-debug` only when Phil explicitly says so.
- **Why**: On May 12, 2026, a 362-file uncommitted refactor running on production with `ignoreBuildErrors=true` masked TypeScript breakage. The gatekeeper exists to make that impossible.

## Branch Discipline (NEW — May 2026, MANDATORY)

1. **All work must be merged to master before the session ends.** No orphan branches.
2. **Never deploy from a feature branch.** Merge to master first, then deploy from master.
3. If your changes aren't ready to merge, commit them as WIP but do NOT `pm2 restart` with unmerged code.
4. Before starting work, verify branch: `git branch --show-current`. If not on a `claude/<tmux>/<task>` branch, run `claude-coord checkin --task "..."` to create one (it auto-creates the branch). Never edit master directly.
5. Delete your branch after merging: `git branch -d <branch-name>`.

## File Count Guardrail (NEW — May 2026)

- Modified more than **20 files** in one session → STOP and commit a checkpoint.
- Modified more than **50 files** → run `bash scripts/pre-deploy-check.sh` before continuing.
- **Never accumulate 100+ modified files** without committing. (This is how 362-file refactors happen.)

## Session Coordinator Usage (claude-coord)

The `claude-coord` tool (at `~/.claude/bin/claude-coord`) coordinates 5–15 parallel tmux Claude sessions so they stop colliding on the same files.

| When | Command |
|---|---|
| Starting work (auto via `cs`) | `claude-coord checkin --task "<one-liner>"` — registers tmux + auto-creates branch `claude/<tmux>/<slug>` |
| Before editing files | `claude-coord conflicts <paths>` — advisory check against other sessions' claims |
| Reserve files | `claude-coord claim <paths>` — advisory, not a lock |
| Log significant action | `claude-coord log "<msg>"` — written to `~/.claude/coord/sessions/<tmux>.md` |
| Verify pre-deploy/debug | `claude-coord debug` — auto-detects project's debug script (gmhdashboard → `scripts/agents/debug-all-systems.sh`) |
| Finish work | `claude-coord checkout` — releases claims, archives log, **re-runs debug as safety gate** |
| Survey state | `claude-coord status` (alias `claude-status`) or `claude-coord list` |
| Resume context | `claude-coord show <name>` (alias `claude-resume`) |

**State files** (under `~/.claude/coord/`, namespaced to avoid Claude Code's own state):
- `registry.json` — live session registry (don't hand-edit)
- `sessions/<tmux>.md` — per-session activity log (markdown)
- `sessions/archive/` — completed-session logs (kept for review)

**Auto-cleanup**:
- Cron `*/5 * * * * claude-coord reap` clears registry entries for dead tmux sessions
- Tmux `session-closed` hook reaps immediately
- `claude-start.sh` runs reap preflight before launching new sessions

**MCP exposure**: `dispatch-mcp` (PM2 service) makes every `claude-coord` action callable from Cowork via HTTP/SSE on `127.0.0.1:3010` (drive via SSH tunnel; `--stdio` fallback also supported).

## Deployment Rules (3-Layer Architecture)

1. **Run pre-deploy check first**: `bash scripts/pre-deploy-check.sh` (see above — MANDATORY)
2. `df -h /` — must have >2GB free disk
3. `pm2 stop gmh-dashboard`
4. `rm -rf .next && npm run build`
5. `pm2 start gmh-dashboard && pm2 save`
6. Verify: `curl -I http://localhost:3011/ops/`
7. **Post-deploy**: `bash scripts/health-check.sh`
- NEVER run `pm2 start npm -- start` (loses PORT env var → cascading 502s)

## Code Patterns (MANDATORY)

- **Patient search**: ALWAYS use Healthie `users(keywords:)` GraphQL — local Postgres `patients` table is incomplete
- **Hydration**: Use `mounted` state guard pattern in client components (`useState(false) → useEffect → setMounted(true)`)
- **Base path**: All routes use `/ops` prefix — `lib/basePath.ts` handles this
- **Healthie API gotcha**: `client_id` vs `user_id` — different endpoints use different arg names, wrong one silently returns empty arrays
- **createAppointment**: MUST use BOTH `other_party_id` AND `providers` to prevent dual-provider bug
- **DO NOT pass `location_id`** to `availableSlotsForRange` — causes field error

## Patient Status Rules

- **NEVER change inactive → any other status** via code. Only direct DB admin access can reactivate.
- Payment decline auto-sets `hold_payment_research`. Payment received auto-reactivates to `active`.
- Status colors: active=green, active_pending=yellow, hold_*=red, inactive=red

## iPad/Mobile Sync Rule

- **ALWAYS edit `public/ipad/app.js`**, then run `bash scripts/sync-mobile.sh`
- NEVER edit `public/mobile/app.js` directly
- NEVER copy iPad CSS to mobile — they are separate files for different screen sizes

## Healthie Appointment Pricing Rule

- DO NOT set pricing on appointment types — Healthie auto-generates invoices at booking
- Subscription billing uses offerings/packages, NOT appointment type pricing
- Incident: Patient Jacob McKenney was double-charged $180 from pricing on appointment type

## Timezone

- Server timezone: America/Phoenix (MST, no DST)
- Cron jobs use MST directly — do NOT convert from UTC
- PostgreSQL queries: `(NOW() AT TIME ZONE 'America/Phoenix')::DATE`

## Snowflake Auth

- Use `JARVIS_SERVICE_ACCOUNT` with key-pair auth (private key at `~/.snowflake/rsa_key_new.p8`)
- Old user `tinetio123` is blocked by MFA — do NOT use password auth

## GHL Authentication

- GHL uses Private Integration Tokens (PITs), NOT OAuth2. Tokens do NOT expire.
- Men's Health: `GHL_MENS_HEALTH_API_KEY` → Location `0dpAFAovcFXbe0G5TUFr`
- Primary Care: `GHL_PRIMARY_CARE_API_KEY` → Location `NyfcCiwUMdmXafnUMML8`
- DO NOT implement OAuth token refresh for GHL — unnecessary and will break things

## Patient Status Writes (MANDATORY — Hardening Plan v3)

- Every `UPDATE patients SET ... status_key` MUST go through `lib/status-transitions.ts:transitionStatus()`
- Raw SQL `UPDATE patients SET ... status_key` outside that file = **ESLint error** (`eslint.config.mjs` no-restricted-syntax)
- DB trigger `trg_patient_status_audit` is a bypass-proof backstop — it re-applies rules and writes `patient_status_audit`
- Hard rules baked in: `webhook_processor` cannot set `inactive`; out of `inactive` only via `admin_api` or `script:*`
- Module: `docs/sot-modules/28-hardening-plan-v3.md`. Acceptance tests: `scripts/test-status-chokepoint.ts` (17/17 passing)

## Patient Sync Status Columns (NEW May 19, 2026)

Two parallel status columns on `patients`, both populated by every successful or failed sync attempt:

- `ghl_sync_status` / `ghl_sync_error` / `ghl_last_synced_at` — GHL contact upsert
- `healthie_sync_status` / `healthie_sync_error` / `healthie_last_synced_at` — Healthie demographics + address

Status values: `ok` (last attempt succeeded), `error` (generic failure — see error column), `blocked_email_collision` (Healthie rejected the email because another user — usually a provider account — already has it; **do NOT retry** until a human resolves the dedup). `NULL` = never attempted.

**Write sites** (all use the same pattern: persist on success AND on every failure path, set `*_last_synced_at = NOW()`):
- `app/api/patients/[id]/route.ts` PATCH — both GHL + Healthie sync legs
- `app/api/ipad/patient/[id]/demographics/route.ts` PUT — both GHL + Healthie sync legs

Index: `idx_patients_healthie_sync_blocked` partial index for the /ops triage surface.

## Healthie Sync Gate (loosened May 19, 2026)

`lib/healthieDemographics.ts:syncHealthiePatientDemographics()`:

- Sync runs when `method_of_payment ~ /healthie/i` AND (`client_type ∈ {NowMensHealth.Care, NowPrimary.Care}` OR patient already has a `healthie_clients` link).
- Only the original allowlist (`NowMensHealth.Care`, `NowPrimary.Care`) reaches `ensureHealthieClientId`'s create-by-sync path. Other types sync demographics ONLY if they're already linked.
- Unblocks ~83 patients that were silently skipping (NOWLongevity, Sick Visit, PrimeCare Premier/Elite, Pro-Bono).

## Healthie Webhook Divergence Log (NEW May 19, 2026)

`app/api/integrations/healthie/webhook/route.ts` writes to `agent_action_log` BEFORE its COALESCE update when the incoming Healthie payload differs from the local `patients` row. Query the audit:

```sql
SELECT created_at, summary, details
FROM agent_action_log
WHERE agent_name = 'healthie_webhook' AND action_type = 'patient_divergence'
ORDER BY created_at DESC LIMIT 50;
```

The COALESCE write still happens — instrumentation is additive. Future flip to log-only requires its own session once we know which fields drift most.

## BioSCOPE Third-Party API (NEW Apr 29, 2026)

- Bearer token format `bsk_live_<32 bytes base64url>` in `BIOSCOPE_API_SECRET` (Stripe/GitHub-style prefix for grep/leak detection)
- Compared with `crypto.timingSafeEqual` in `lib/bioscope-auth.ts`
- Dedicated Healthie key in `BIOSCOPE_HEALTHIE_API_KEY` (segregates audit trail; rotate independently from `HEALTHIE_API_KEY`)
- Allowlist at `bioscope_authorized_patients` (revoked rows preserved; active = `revoked_at IS NULL`)
- Admin UI: `/ops/admin/bioscope` (admin-role only)
- Every request audited to `agent_action_log` with `agent_name='bioscope'`
- Kill switch: set `BIOSCOPE_API_SECRET=""` → all requests return 401
- Module: `docs/sot-modules/29-bioscope-integration.md`

## What NOT to Do

- DO NOT modify `ANTIGRAVITY_SOURCE_OF_TRUTH.md` without explicit approval
- DO NOT restart PM2 services without first running `bash scripts/pre-deploy-check.sh`
- DO NOT hardcode credentials — always reference `.env.local`
- DO NOT use `/apps/gmh-dashboard` — that path does not exist
- DO NOT deploy without running `npm run build` first (type errors will break production)
- DO NOT use Snowflake for real-time patient lookups (6hr lag)
- DO NOT move patients between Healthie groups without approval (clears onboarding forms)
- DO NOT skip `claude-coord checkin` — your session is invisible to other agents and you risk collisions
- DO NOT push to master directly — every session has its own `claude/<tmux>/<task>` branch
- DO NOT skip `--no-verify` on commits or `--skip-debug` on checkout without Phil's explicit approval
- DO NOT re-create the `/ops/agents` page — the duplicate was removed in commit `d87a91b`; the existing `/agents` dashboard uses the retained `app/api/code/agent-health/` infrastructure

---

*Pin these into /memory at the start of every Claude Code session working on GMH Dashboard.*
