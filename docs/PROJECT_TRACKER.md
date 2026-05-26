# NOW Optimal — Master Project Tracker v2

> **Last Updated**: May 12, 2026 — Live refresh (DB, PM2, crontab verified)
> **Rule**: Every Claude Code session must update this file after completing work.
>
> **Auto-generated section below** — regenerated daily by `scripts/refresh-project-tracker.sh` (cron 6am MST). Manual edits between the AUTOGEN markers will be overwritten. The "Active Projects" sections beneath stay manual.
>
> **Archive convention**: when a project/task is DONE, move its section to `docs/archive/completed-YYYY-MM.md` (grouped by month). The main tracker only shows active work. See `docs/archive/README.md` for the rule.

---

<!-- AUTOGEN:START — do not edit between these markers; overwritten by scripts/refresh-project-tracker.sh -->
## LIVE SYSTEM SNAPSHOT (verified 2026-05-26)

_Auto-regenerated 2026-05-26 06:00:01 MST by `scripts/refresh-project-tracker.sh`._

| Metric | Value | Source |
|---|---|---|
| Total patients | **510** | `SELECT COUNT(*) FROM patients` |
| ↳ active | 393 | `status_key='active'` |
| ↳ active_pending | 26 | `status_key='active_pending'` |
| ↳ inactive | 78 | `status_key='inactive'` |
| ↳ hold_payment_research | 11 | `status_key='hold_payment_research'` |
| ↳ inactive_payment_research | 2 | `status_key='inactive_payment_research'` |
| healthie_clients rows | 523 | (>patients because legacy duplicate links exist) |
| patient_qb_mapping rows | 192 | QuickBooks mappings |
| patients w/ ghl_contact_id | 504 | `ghl_contact_id IS NOT NULL` (legacy mapping table dropped 2026-05-19) |
| memberships (active) | 32 | `status='active'` |
| lab_orders (total) | 180 | — |
| lab_review_queue (pending) | 0 | — |
| dispenses (total) | 864 | — |
| dea_transactions | 912 | — |
| staged_doses (staged) | 1 | — |
| payment_issues (open) | 0 | `resolved_at IS NULL` |
| bioscope_authorized (active) | 1 | `revoked_at IS NULL` |
| Postgres tables (public) | **125** | `information_schema.tables` |
| PM2 services | **0** total, **0** online | `pm2 jlist` |
| Cron jobs (active) | **38** | `crontab -l` (non-comment, non-blank) |
| Disk used | **73%** (28G free of 100G) | `df -h /` |
| Git branch | `master` @ `4766aa8` (8 dirty file(s)) | `git status --porcelain` |
| Orphan Claude branches | 43 | `git branch --list 'claude/*'` |
| Active coordinator sessions | 12 | `~/.claude/coord/registry.json` |

### Patient distribution by `client_type_key`
| Type | Count |
|---|---|
| nowmenshealth | 325 |
| nowlongevity | 43 |
| nowprimarycare | 30 |
| sick_visit | 27 |
| primecare_premier_50_month | 20 |
| approved_disc_pro_bono_pt | 13 |
| qbo_tcmh_180_month | 12 |
| (null) | 10 |
| primecare_elite_100_month | 10 |
| qbo_f_f_fr_veteran_140_month | 6 |
| jane_f_f_fr_veteran_140_month | 5 |
| other | 4 |
| jane_tcmh_180_month | 3 |
| ins_supp_60_month | 2 |

<!-- AUTOGEN:END -->







### Recently shipped
- **2026-05-26 — iPad "New Order" McKesson button fix (dispatch row 20260520-231517-ec86).** Phil reported the iPad supply-inventory "📦 New Order" button does nothing. Deep-dive of the McKesson supply stack (catalog → availability sync → invoices → ordering): backend, data, code, and modal all healthy — 67 purchasable items mapped, `MCKESSON_ALLOW_PRODUCTION_ORDERS=true`, dryRun preview returns full draft when called correctly. **Root cause: `next.config.js` has `trailingSlash:true`, and the iPad's `previewNewOrder` / `submitNewOrder` POST'd to `/ops/api/ipad/mckesson/orders` (no trailing slash) → Next 308-redirects to `/orders/`. iOS Safari/WebKit drops the POST body when following a 308**, so the redirected request arrived with empty body → route returned 400 `items[] is required` → modal silently failed. Proven directly in nginx access logs: `POST /ops/api/supplies/mapping → 308 → /supplies/mapping/ → 500` (same bug, different endpoint — and "Map to McKesson" was also broken). curl preserves the body on 308, which is why backend tests passed. **Fix**: added trailing slashes to the entire McKesson/supply mutation cluster in `public/ipad/app.js` — 11 calls across New Order (2), Map-to-McKesson (4), supplies PATCH (1), invoice edit (2), invoice reorder (2), plus 4 GETs for consistency. Pre-commit hook auto-ran `sync-mobile.sh` and re-bundled `app.86db2dee.js`. Debug 27/27, pre-deploy SAFE. Deployed to prod (master `3460e2b` + merge, local only — not pushed to origin). Verified live: `curl https://nowoptimal.com/ops/ipad/app.js | grep "/ops/api/ipad/mckesson/orders/'"` → 2 matches.
- **2026-05-26 — Acosta duplicate-Healthie login fix (claude-acosta session).** Chris Acosta could not log into the patient app because two Healthie users shared his email: `12212961` (active, KEEPER, holds payments + Stripe cus_UE71PDOvYxBjAJ + 3 succeeded payments totaling $610 + 3 TRT dispenses + 5 peptides + active lab cadence) and `12741471` (archived 2026-01-20, "Jesus Cris Acosta Acosta" — the dup audrey@nowoptimal.com created in our DB on 2026-04-09; zero payments / zero dispenses / zero memberships locally). Healthie's email-based login lookup was ambiguous. Comparison record `12792633` (a third Cris dup) showed Healthie's own dedup convention: rename archived dup emails to `<hash>@gethealthie.com` — but `12741471` missed that step in January. **Fix** (minimal, reversible): renamed Healthie 12741471 email → `archived-hc12741471@gethealthie.com` via `updateClient`, mirrored on local DUP `patients.email` (status_key=inactive so demographics sync skips it anyway). KEEPER untouched. **Verified (33/33 independent checks)**: Healthie search for `teteacosta12111987@gmail.com` returns exactly one user (12212961, active=true); KEEPER's payment_method/stripe_customer_id/3 payments/3 TRT/3 DEA/5 peptide/labs all intact; DUP retired locally still has `Inactive (Merged)` + zero financial footprint; healthie_clients junction still maps 12741471 → KEEPER for inbound webhook routing. Side-effect noted: post-rename, DUP's `last_sign_in_at` cleared from 2026-05-24 → null (confirming Healthie was pooling sign-in across same-email users — the root mechanism behind the login failure). Audit: `agent_action_log` id 166 (category=patient_data_dedup). Backup: `.tmp/acosta-dedup/backup-latest.json`. Reversal: `node /home/ec2-user/gmhdashboard/.tmp/acosta-dedup/06-reversal.js --execute`.
- **2026-05-21 — TRT staged-dose "only 0.5ml saves" (dispatch row 20260520-235955-1d54).** Reported bug was already fixed in running prod — root cause was the pre-04-22 `LIKE '%30%'` vial filter (staging only saw Carrie Boyd 30mL vials); with those depleted, only a 0.5mL dose found a qualifying vial and larger doses hit a *silent* 400. Live-tested API (0.5/0.7/1.0 → all 200, inventory reversed after). Shipped two hardening fixes: (1) `StagedDosesManager.tsx` now surfaces the API's real error ("Not enough medication in vials…") instead of generic "Failed to save staged dose" — that hidden message was why staff couldn't diagnose; (2) `staged-doses/route.ts` rounds `totalMl` to 2dp (kills `3.1999999999999997` float artifacts + spurious volume-check edge case) and fixes `wasteMl || 0.1` turning a legit 0 waste into 0.1. Deployed to prod (master 30bab59, local only — not pushed to origin). Verified live: dose 0.7 now returns `totalMl: 3.2`.
- **2026-05-20 — iPad patient-chart Appointments (dispatch row 1_...194086).** Fixed recurring "appointments missing / files need upload dates" task. Files/docs already showed upload dates (no change). Appointments section was collapsed + buried in Notes tab + gated on `hAppts>0` so it vanished for patients with no upcoming appt. Moved to top of chart, expanded, always-visible; split into Upcoming/Past. Root API fix: `patient-chart` appointments query `is_active:true` → `filter:"all"` (Healthie was upcoming-only). Deployed to prod (master 576c6d1, local only — not pushed to origin).








---

## Recent Session Output — 2026-05-20

- **iPad per-task chat send fixed + Today-page polish (claude5 session)**: The Wave-3a chat bottom-sheet (commit 1604b84) shipped *broken* — every iPad "Send" failed. Root cause: the cookie-authed proxy `app/api/ipad/chat/route.ts` POST called dispatch-mcp `/api/call` with only a `Content-Type` header, but `dispatch-mcp/server.py` requires `x-auth-token === DISPATCH_TOKEN` → 401, which the proxy surfaced as a 502. Fix: proxy now forwards `process.env.DISPATCH_TOKEN` as `x-auth-token` (token already in gmh `.env.local`). **Verified end-to-end in prod** via a minted phil session cookie: `POST /ops/api/ipad/chat` → `{success:true, thread_length:2, dm_status:"sent"}` — Google Chat DM fires + thread appends through iPad→proxy→dispatch-mcp→inbox_chat_send. Test session revoked + test row chat_thread reset to `[]` afterward. Polish (all in `public/ipad/app.js`): (1) batch unread-counts mode `GET ?counts=1 → {staff_task_id:thread_len}` so the Today list lights all 💬 badges in one request; (2) per-task unread badge via localStorage `taskChatSeen.v1` seen-tracking (per-device approximation — no server read-receipts), cleared on open; (3) task cards `min-width:0` + `overflow-wrap:anywhere` kills character-per-line wrapping; (4) top-right chip repurposed priority→colored STATUS pill (pending/in-progress/done); (5) Done button fades the card out before list reload + added `resp.ok` guard. Web Push verified (sw.js served 200, `/api/push/subscribe` present, scope logic correct, no push errors). Sync verified (`sync_staff_tasks.py` cron runs every minute, bidirectional, `closed_db`/`closed_inbox` counters propagate done-rows to iPad <60s). Gatekeeper ✅ 7/1/0. Debug ✅ 27/27. Health-check 4/1/3 (same business-KPI baseline — not regressions). Commits on master: `7340962` (fix+polish) + merge `0a1ce7d` + mobile sync `e2a4e0c` (bundle `app.e9dd3b4d.js`, force-reload stamp `20260520-0012`). **master committed locally + deployed but NOT pushed to origin** (left for Phil per the no-master-push rule).

## Recent Session Output — 2026-05-19

- **SPAWN_CONTRACT enforcement system (claude2 session)**: Every Cowork task and tmux session spawned by Dispatch now inherits a single SPAWN_CONTRACT — Phil's standing rules + surface-specific pre-flight + a live snapshot of `~/.claude/coord/learned-patterns.md` + the tmux-vs-Cowork capability matrix. Single source of truth: `docs/spawn-contract/{standing-rules,preflight-tmux,preflight-cowork,capability-matrix}.md`, composed by `scripts/build-spawn-contract.sh` into `docs/SPAWN_CONTRACT.md` + two injectable preambles (`SPAWN_CONTRACT.{tmux,cowork}.txt`, mirrored to `~/.claude/coord/`). **On-box injection** wired into both tmux spawn paths: `scripts/claude-task.sh` (replaced its hardcoded PREAMBLE; switched the prompt send to atomic load-buffer/paste-buffer so the multi-line contract doesn't submit prematurely) and `dispatch-mcp/tools/lifecycle.py:_h_start` (new best-effort `_inject_spawn_contract()` pastes contract+task as the first prompt; returns `spawn_contract_injected` in the start result). **Cowork (cloud) inheritance**: contract committed to the repo + new pointer section in `CLAUDE.md` directing cloud sessions to follow the "Cloud Pre-Flight (Cowork surface)" section (no `claude-coord`/pm2/psql/deploy — deliverable is a reviewable PR). Capability gating: tmux = full on-box, may deploy behind the pre-deploy gate; Cowork = PR-only. Helper `scripts/spawn-contract/print-contract.sh <tmux|cowork>` gives spawners a stable interface (auto-builds if stale). Verified: generator runs, both preambles emit correct surface headers, cowork variant carries the PROHIBITED block, bash/py syntax clean. **Activation pending**: dispatch-mcp change is on branch `claude/claude2/spawn-contract-injection` — needs merge + `pm2 restart dispatch-mcp` to take effect (left for Phil). Re-run the generator + commit whenever `learned-patterns.md` changes to refresh the embedded snapshot for cloud sessions.

- **Per-staff Healthie unread badge + GHL staff-reply attribution (claude15 session)**: iPad/mobile message badge never lit up for any staff member. Root cause: the dashboard queries Healthie with a single org API key (Phil Schafer NP, 12088269), so Healthie's per-membership `viewed` flag reflected only *his* read state — unread was wrong for everyone else and even Phil's own backlog read as caught-up. Fix = local per-staff read tracking: migration `20260519_conversation_reads.sql` (user_id+conversation_id → last_read_at); `GET /api/ipad/messages` recomputes `unread = updated_at > last_read_at` (first-use seeds the backlog as read to avoid a flood; missing row = genuinely-new = unread); new `POST /api/ipad/messages/mark-read` called on conversation open; client marks read on open (instant badge clear) + removed the duplicate `pollMessagesBadge` poller (was double-polling Healthie + double-beeping), consolidated onto `_pollGlobalMessagesOnce` + the pulse-capable `setMessagesBadge`. **Confirmed working in production by Phil.** GHL staff-reply visibility (ABXTAC/nowmenshealth.care/nowprimary.care): migration `20260519_ghl_messages_sender.sql` adds `sent_by_name`/`sent_by_email`; dashboard-sent replies now record the logged-in staff member; webhook + thread view (`renderGhlBubbles` label) surface the sender. GHL-typed (native app) replies still show generic "Staff" — deferred: capturing them needs a paid GHL marketplace app (workflow outbound trigger is paywalled; native OutboundMessage webhook needs OAuth, not the current Private-Integration-Token setup). userId→name resolution via GHL `/users/` API verified working, so the code is ready if Phil ever enables the app. Parked an unrelated cookie-scope change in lib/auth (the iPad 401 was a transient expired session, not a structural bug — Phil logs in fine; `Path=/ops` cookie works from `/ipad/`). Pre-deploy ✅ 6/2/0. Debug 27/27 (pre + post deploy). Health-check 5/0/3 (same business-KPI baseline: 11 billing holds / 22 zero-stock peptides / cumulative restarts — not regressions). Branch `claude/claude15/ipad-mobile-new-message-notifications-br` merged to master (b1bc968 + mobile sync 2a90640) and pushed to origin.

- **Peptide channel discriminator added to peptide_dispenses (claude8 session)**: Ship-to (ABXTAC) peptide dispenses were showing "Education: incomplete" forever on iPad because `peptide_dispenses` had no fulfillment-channel awareness — ABXTAC handles education at WC checkout, outside our DB, so nothing ever flipped `education_complete=true` for those rows. Migration `20260519_peptide_dispenses_channel.sql` adds `channel TEXT NOT NULL DEFAULT 'inhouse' CHECK IN ('woo','inhouse')` (mirrors `peptide_order_tracking.channel`) with a two-pass backfill (notes ILIKE 'Shipped via ABX TAC%' → 15 rows; payment_transactions woocommerce_order_id linkage → 7 more rows). Result on 558 rows: 536 inhouse + 22 woo. Three surfaces gated on `channel='inhouse'`: (1) iPad dispense modal `public/ipad/app.js:13287` (Education label hidden for woo); (2) `app/api/ipad/billing/send-consent/route.ts` accepts optional `channel` body field and short-circuits with `{success,skipped:true}` for woo (frontend `sendPeptideConsent()` now passes `channel:'woo'` from ship-cart and shows "ABXTAC handles it" toast); (3) `lib/healthie/peptideWebhook.ts` skips auto-creating a Pending dispense when the BillingItem has a matching `payment_transactions.woocommerce_order_id` (ship-order route owns the row). Explicit `channel='woo'` on ship-order, company-order, headless/checkout (mobile), pending-orders INSERTs; in-house paths rely on DEFAULT. Skipped optional inventory SUM tightening per brief (claude7 active on `scripts/health-check.sh`; acceptance test confirmed 519==519 so it would have been a no-op). Pre-deploy ✅ 6/2/0 on master. Debug 27/27. Health-check 5/0/3 (same baseline as claude5+claude7 deploys earlier today). Branch `claude/claude8/peptide-channel-discriminator-add-channe` merged to master via f0b46d2. New SOT module `docs/sot-modules/30-peptide-pipeline.md` + INDEX entry + DEPENDENCIES ship-to chain added. Acceptance examples: Heather Ramirez (1 woo, 0 inhouse), Jodi Ellsworth (1 woo, 0 inhouse), Ryan Foster (3 woo + 5 inhouse — dual-channel canary).

- **Retire-vial prompt fixed for staged-dose prefill workflow (claude2 session)**: The "Retired Vials not working" report turned out to be a missing surface, not a broken endpoint. Three workflows decrement vial volume but only two prompted retirement — the staged-dose prefill path (iPad `submitStageDose` and Dashboard `StagedDosesManager`) skipped the < 2.0 mL prompt entirely. TopRX 10 mL vials hit this every time (4 syringes × 2.4 mL = 9.6 mL → 0.4 mL stranded). 31 vials (15.6 mL aggregate) were stuck below threshold as a result. Fixes: (a) `public/ipad/app.js submitStageDose` now prompts retire + toasts success/failure; (b) two existing iPad retire call sites now surface failure (were `console.error`-only); (c) `app/inventory/StagedDosesManager.tsx handleSubmit` mirrors the same prompt; (d) `lib/dispenseHistory.ts` `DispenseEventType` union now includes `'vial_retired'` so the existing audit insert typechecks; (e) `scripts/backfill-retire-stuck-vials.ts` ran against the 31 stranded vials, producing the full dispense + dea_transactions + dispense_history audit trail (event_payload.retiredByName tagged `[backfill]`). DEA audit verified: 0 stuck vials remain, 31 waste_retirement dispenses + 31 dea_transactions + 31 dispense_history rows created (1:1:1). Pre-deploy ✅ 7/1/0. Debug 27/27. Branch `claude/claude2/retired-vials-not-working-investigate-op` merged to master via 6026705 + mobile re-sync 459d9ee.

## Recent Session Output — 2026-05-12

- **Tri-Mix + Acupuncture appointment types added (claude12 session)**: Two new staff-only Healthie types — `527506` Tri-Mix Injection Consult and `527507` Acupuncture, both 30 min in-person, `clients_can_book: false`, **bound to Dr. Whitten only** via `require_specific_providers: true` + provider connection to 12093125 (pattern matches existing 504725 / 520702). No pricing (per Mar 31 SOT rule). Two idempotent scripts: `scripts/healthie/create-trimix-acupuncture-types.js` (creates) + `scripts/healthie/bind-trimix-acupuncture-to-whitten.js` (binds provider). `getClinicGroup()` updated to map both to NowMensHealth.Care brand. Mobile-app booking.ts intentionally NOT updated (patient-facing list — staff-only types stay hidden). Master SOT + module 24 + module 06 all updated. Debug 26/26 pass.

---

## Archive — completed work

Completed projects/phases live in `docs/archive/completed-YYYY-MM.md` (one file per calendar month). See `docs/archive/README.md` for the rule. **Keep this main tracker focused on active work only.**

When you finish a project section, cut it out of this file, append it to the month's archive, and commit both edits together (`docs(archive): YYYY-MM <section name>`).

---

## PROJECT 1: GMH Dashboard (Operations Hub)
**URL**: https://nowoptimal.com/ops/
**PM2**: gmh-dashboard (port 3011) | **Restarts**: 69 (uptime ~30m at snapshot — post pre-deploy gatekeeper deploy) | **Status**: ONLINE
**Tech**: Next.js 14 + Postgres (118 tables) + Healthie + Snowflake + GHL

### Dashboard Pages (30+ routes)
patients, labs, scribe, faxes, supplies, peptides, finance-audit, inventory, transactions, dea, pharmacy (5 sub-pages), provider/signatures, admin (users, shipments, app-control, **bioscope**), executive-dashboard, business-intelligence, analytics, system-health, code (Command Center — sessions, agent-health, kill-session, launch-task, health-check), patient-hub, ops-center, menshealth

### API Routes (40+ endpoints — additions vs April)
abxtac, admin (now incl. `/admin/bioscope`), analytics, app-access, auth, **bioscope** (`/bioscope/patient/[id]`, `/bioscope/patient/[id]/notes`), checks, code (5 sub-routes incl. `agent-health`), cron (now 14+ cron endpoints incl. push-receipts, push-log-retention, appointment-reminders, timezone-audit, peptide-pipeline-sync, payment-reconcile, missing-recurring-payments, patient-reconciliation), debug, dispense-override, dispenses, export, faxes, finance-audit, headless (7 mobile APIs), healthie, heidi, integrations, inventory, ipad (14 kiosk APIs), jane-membership-revenue, jane-revenue, jarvis (lab-eligibility for BioBox), labels, labs, patients, peptides, pharmacy, prescriptions, receipts, scribe, smart-dispense, specialty-orders, staged-doses, supplies, ups, webhooks (incl. `woo-biobox-order`)

### Cron Jobs (33 active — verified `crontab -l`)
**Every 5 min**: Heartbeat, Process Healthie Webhooks, Website Monitor, claude-coord reap
**Every 15 min**: Appointment reminders push, Push receipts, Peptide pipeline sync
**Every 30 min**: Lab Results Fetch, Cleanup Stale Processes, Payment reconcile
**Hourly**: Kill stale terminals, System Monitor agent (:13)
**Every 2 hr**: Snowflake Freshness (:10), GHL Sync (:30)
**Every 3 hr**: QuickBooks Sync
**Every 4 hr**: Snowflake Sync, Prescription Sync (:20)
**Every 6 hr**: Healthie Revenue Cache (:40), Healthie Failed Payments, Peptide Sync (:50), YPB WC Sync, Missing recurring payments (:10)
**Daily**: Infrastructure Monitor (8:30am), Healthie ID Audit (6am), Morning Intelligence agent (6:47am), Auto-Remediation Agent (7am), Intake-signals refresh (3am), Push-log retention (3:30am), Timezone Audit (3:05am), Crontab Backup (2am), Scheduled Patient Sync (2am), Lab Status Refresh (5am UTC)
**Twice daily**: YPB Availability Sync (6am, 6pm)
**Note**: Git Auto-backup is DISABLED 2026-04-15 (commented out in crontab — pending untested feature review)

### Critical Issues (live verified)
| Issue | Severity | Status |
|---|---|---|
| Disk previously claimed 95% full | (RESOLVED) | Now 49% — 52GB free |
| 275-restart memory leak claim | (STALE) | Current uptime ~30m, 69 restarts (post-deploy) — re-verify |
| QuickBooks integration | HIGH | NOT VERIFIED (sync cron still running every 3hr) |
| Stripe disconnected | HIGH | KEYS EXIST — VERIFY |
| Open payment_issues | LOW | **2** open (was 50 in stale tracker) |
| patient_ghl_mapping table | (RESOLVED 2026-05-19) | DROPPED — was 0 rows / 0 callsites; GHL contact id lives on patients.ghl_contact_id |
| SoT enforcement (Phases 7/6/3) | (SHIPPED 2026-05-19) | patient_ghl_mapping dropped; Healthie sync gate loosened (no client_type allowlist; skips→patient_sync_skips); webhook stops /ops overwrite (divergences→sync_conflicts, view at /ops/sync-conflicts). Branch claude/claude2/sot-enforcement-bundled-phase-3-webhook- merged to master + deployed. |

---

## PROJECT 2: NOW Men's Health Website
**URL**: https://nowmenshealth.care | **Status**: LIVE (200)
**PM2**: nowmenshealth-website (port 3007 via nginx) | **Restarts**: 1
**Tech**: Next.js | **Deps**: 3 packages

### Pages (11)
Home, Book (Healthie booking widget), Contact, Low-T Checklist, Privacy, Terms, Services: Testosterone, Sexual Health, Weight Loss, IV Therapy, ABX TAC Mockups

### Key Features
- Healthie booking widget (BookingWidget.tsx + lib/healthie-booking.ts) — WORKING
- 6 appointment types configured (TRT Initial, Supply Refill, EvexiPel Male Initial/Repeat, Weight Loss Consult, IV Therapy GFE)
- API routes for slots and booking
- Sitemap.ts for SEO

### What's Missing
| Feature | Status |
|---|---|
| Google Analytics tracking | NOT CONFIGURED |
| GHL chat widget | NOT INSTALLED |
| Review generation CTA | NOT BUILT |
| Online scheduling for Aaron Whitten | VERIFY WORKING |

---

## PROJECT 3: NOW Optimal Website (Brand Parent)
**URL**: https://nowoptimal.com | **Status**: LIVE (200)
**PM2**: nowoptimal-website (port 3008 via nginx) | **Restarts**: 8
**Tech**: Next.js v0.1.0

### Pages (6)
Home, Privacy, Terms, HIPAA, Delete Account, Support

### Assessment
Minimal brand site. Serves as the parent umbrella for NOW ecosystem. Functions primarily as the ops dashboard host (nowoptimal.com/ops/).

### What's Missing
| Feature | Status |
|---|---|
| Brand overview of all NOW services | MINIMAL |
| Links to sub-brands | VERIFY |
| SEO optimization | NOT DONE |

---

## PROJECT 4: NOW Mental Health Website
**URL**: https://nowmentalhealth.care | **Status**: LIVE (200)
**PM2**: nowmentalhealth-website (port 3003 via nginx) | **Restarts**: 6
**Tech**: Next.js v1.0.0

### Pages (9)
Home, About, Book, Contact, Privacy, Terms, HIPAA, Services: Ketamine, Groups

### Assessment
Site is built and live but the service line is "configured, not active" per blueprint. 9 appointment types exist in Healthie but 0 upcoming appointments. No provider hired yet.

### What's Missing
| Feature | Status |
|---|---|
| Provider assignment (hire pending) | BLOCKED |
| Active appointment types in Healthie | CONFIGURED but INACTIVE |
| GHL sub-account | NOT SET UP |
| Patient intake flow | NOT TESTED |

---

## PROJECT 5: NOW Primary Care Website
**URL**: https://nowprimary.care | **Status**: LIVE (200)
**PM2**: nowprimary-website (port 3004 via nginx) | **Restarts**: 3
**Tech**: Next.js v1.0.0

### Pages (5)
Home, About, Book, Contact, Services

### Assessment
Site is live. Phil wants to phase out Primary Care per blueprint. 14 active patients. Has its own GHL sub-account with separate API key. Lower priority.

---

## PROJECT 6: ABX TAC Website (Peptide E-Commerce)
**URL**: https://abxtac.com | **Status**: LIVE (200)
**PM2**: abxtac-website (port 3009) | **Restarts**: 26
**Tech**: Next.js v1.0.0

### Pages (9)
Home, Shop (with dynamic [slug] pages), Cart, Checkout, Verify, About, Research, Peptides

### Key Features
- Full e-commerce flow (shop → cart → checkout → verify)
- Product catalog with individual product pages
- Peptide research/education content
- Patient verification flow
- Dashboard API integration for fulfillment (api/abxtac/)

### Assessment
Most feature-complete e-commerce site. 26 restarts suggest some instability. Top revenue line ($14,864/mo in peptides).

### What's Missing
| Feature | Status |
|---|---|
| Stripe payment processing | VERIFY WORKING |
| Shipping integration (UPS) | BUILT (api/ups) |
| Inventory sync with dashboard | VERIFY |
| YPB availability sync | CRON RUNNING (2hr) |

---

## PROJECT 7: NOW Longevity Website — NOT BUILT
**Domain**: nowlongevity.care | **Status**: DNS NOT CONFIGURED (timeout)
**PM2**: NONE | **Directory**: NONE | **Nginx**: NONE

### What Exists
- GHL sub-account configured (API key + location ID in .env.local)
- Brand colors defined in SOT (Sage #6B8F71)
- iPad schedule code recognizes "longevity" routing
- Blueprint pricing tiers designed ($350 Premium, $500 VIP, $750 Founders Circle)
- One theme preview HTML in .tmp/ (throwaway)

### Hormozi Blueprint Phases (ALL NOT STARTED)

**Phase 1: Foundation (Week 1-2)**
| Task | Status |
|---|---|
| Create Healthie group "NowLongevity.Care" | NOT DONE (TBD in SOT) |
| Configure Healthie appointment types for Longevity | NOT DONE |
| Set up DNS for nowlongevity.care → server | NOT DONE |
| Build website (clone nowmenshealth pattern) | NOT DONE |
| Add Nginx config for nowlongevity.care | NOT DONE |
| Create PM2 service | NOT DONE |
| SSL certificate | NOT DONE |

**Phase 2: Patient Acquisition (Week 2-3)**
| Task | Status |
|---|---|
| Build waitlist form + embed on site | NOT DONE |
| Create GHL waitlist pipeline | NOT DONE |
| Build booking widget for Longevity appts | NOT DONE |
| Educational content pages (what is longevity medicine) | NOT DONE |
| Landing page for Founders Circle (25 spots, $750/mo) | NOT DONE |

**Phase 3: Marketing Launch (Week 3-4)**
| Task | Status |
|---|---|
| Email campaign to 2,829 GMH list announcing Longevity | NOT DONE |
| GHL drip sequence for waitlist | NOT DONE |
| Facebook/Instagram ad funnel (ages 35-55, Prescott) | NOT DONE |
| Google Business Profile for Montezuma location | NOT DONE |

**Phase 4: Operations (Month 2)**
| Task | Status |
|---|---|
| Migrate legacy patients (Weight Loss 6, Female Pelleting 48, Male Pelleting 2) | NOT DONE |
| Configure pricing tiers in Healthie billing | NOT DONE |
| Set up Stripe recurring billing for Longevity tiers | NOT DONE |
| Soft launch at 404 S. Montezuma | NOT DONE |

---

## PROJECT 8: Mobile App (NOW Optimal Patient App)
**Tech**: Expo/React Native (headless) | **Status**: DEPLOYED but 0 VERIFIED

### Backend APIs (7 headless endpoints)
access-check, billing-status, lab-status, patient-context, patient-services, record-app-login, update-avatar

### iPad/Kiosk APIs (14 endpoints)
appointment-status, dashboard, icd10-search, me, messages, patient-chart, patient-data, patient, previsit-tasks, quick-dispense, schedule, stage-dose, tasks, vitals

### Current State
| Metric | Value |
|---|---|
| Patients with app access | 260 (all active) |
| Verified (is_verified=true) | 0 |
| First app login recorded | 1 |
| App store status | VERIFY |

### What's Missing
| Feature | Status |
|---|---|
| Fix verification flow (0 of 260 verified) | CRITICAL |
| Diagnose is_verified sync | NOT DONE |
| In-clinic onboarding flow (front desk walks patients through) | NOT DONE |
| SMS blast with download link | NOT DONE |
| Incentive program ($50 credit for first 50 verified) | NOT DONE |
| Push notifications | UNKNOWN |

---

## PROJECT 9: AI Services (live `pm2 list` 2026-05-12)

### AI Scribe (upload-receiver)
**PM2**: upload-receiver | **Status**: ONLINE (5 restarts, 57 days uptime)
- Audio upload → Telegram approval → Healthie document injection
- PDF generation for clinical notes
- Pharmacy search/favorites integration

### Telegram AI Bot v2
**PM2**: telegram-ai-bot-v2 | **Status**: ONLINE (1 restart, 22 days uptime)
- Patient data queries via Telegram
- Morning report delivery
- Alert notifications

### Jessica MCP Server
**PM2**: jessica-mcp | **Status**: ONLINE (0 restarts, 2 months uptime)
- Connects Snowflake, Healthie, GHL, Postgres, Gemini
- Used by Claude Code sessions for data access

### Dispatch MCP Server (NEW — added Apr/May 2026)
**PM2**: dispatch-mcp | **Status**: ONLINE (35 restarts, 4 days uptime)
- MCP server exposing the `claude-coord` dispatch system over HTTP/SSE on `127.0.0.1:3010` (localhost; drive via SSH tunnel)
- Stdio fallback via `--stdio`
- State files live in `~/.claude/coord/` (registry, sessions, inbox, decisions)
- Tools: coord (checkin/checkout/log/claim/conflicts/status), lifecycle, gitops, inbox, system, integrations
- Source: `/home/ec2-user/dispatch-mcp/` (server.py, tools/, venv)

### GHL AI Agents (Jessica & Max)
- Jessica: Patient-facing SMS chatbot for Men's Health
- Max: Patient-facing SMS chatbot (additional)
- Webhook server + SMS chatbot handler
- Knowledge base docs extensive (20+ config files)

### Email Triage
**PM2**: email-triage | **Status**: ONLINE (0 restarts, 2 months uptime)
- Email classification, Access Labs processing, fax PDF processing
- Lab review queue management, Google Chat posting

---

## PROJECT 10: Infrastructure Services

### Uptime Monitor
**PM2**: uptime-monitor | **Status**: ONLINE (0 restarts, 2 months uptime)
- Checks all 5 websites every 5 minutes

### GHL Webhooks
**PM2**: ghl-webhooks | **Status**: ONLINE (0 restarts, 2 months uptime)
- Receives GHL webhook events

### Fax Processor
**PM2**: fax-processor | **Status**: ONLINE (3 restarts, 13 days uptime)

### pm2-logrotate (module)
**PM2 module** | **Status**: ONLINE | Rotates `~/.pm2/logs/*` to prevent disk fill

---

## SUMMARY SCOREBOARD

| Project | Status | Health | Priority |
|---|---|---|---|
| GMH Dashboard | LIVE | UNSTABLE (275 restarts, 95% disk) | FIX NOW |
| NOW Men's Health | LIVE | STABLE | ADD GA + GHL WIDGET |
| NOW Optimal | LIVE | STABLE | LOW PRIORITY |
| NOW Mental Health | LIVE | STABLE | BLOCKED (no provider) |
| NOW Primary Care | LIVE | STABLE | PHASING OUT |
| ABX TAC | LIVE | MODERATE (26 restarts) | VERIFY PAYMENTS |
| NOW Longevity | NOT BUILT | N/A | BUILD NEXT |
| Mobile App | DEPLOYED | BROKEN (0 verified) | FIX VERIFICATION |
| AI Services | LIVE | HEALTHY | MAINTAIN |
| Infrastructure | LIVE | DISK CRITICAL | CLEAN DISK |

---

## PROJECT: ABX TAC BioBox Integration (Apr 16, 2026 — IN PROGRESS)

**Goal**: Add Access Labs BioBox at-home lab kits to ABXTAC WooCommerce store + native mobile app + dashboard staff-ordering UI. Patients must have completed a provider consult in last 365 days to order.

**Supplier**: Access Medical Labs (COMTRON) — reuses existing `scripts/labs/access_labs_client.py`
**Ordering provider**: Dr. Whitten NMD (NPI 1366037806), clinic 22937 (Tri-City Men's Health)
**14 BioBox panels** (SKUs B001, B002, B003, B004, B005, B006, B007, B009, B010, B011, B013, B014, B015, B017) — see `abxtac-website/docs/BIOBOX_PRODUCT_GUIDE.md`

**Membership tier discounts (peptides)**: Heal 10% / Optimize 20% / Thrive 30%
**Membership tier discounts (BioBox labs)**: Heal 10% / Optimize 15% / Thrive 25% + 1 panel ≤$149 cost included annually for Thrive members
**Healthie offering IDs**: Heal=246743, Optimize=246744, Thrive=246745
**Consult fee**: $99 per visit (separate from monthly packages)

### Phase 1 status (Apr 16, 2026 — IN PROGRESS)
| Item | Status | File |
|------|--------|------|
| Migration: BioBox columns on `lab_orders` | ✅ Created (not yet run) | `migrations/20260416_biobox_lab_orders.sql` |
| API: `/api/jarvis/lab-eligibility` (consult gate) | ✅ Created | `app/api/jarvis/lab-eligibility/route.ts` |
| API: `/api/webhooks/woo-biobox-order` (WC → Access Labs) | ✅ Created | `app/api/webhooks/woo-biobox-order/route.ts` |
| BioBox Python wrapper | ✅ SKIPPED (existing `order_lab.py` handles B### codes via fallthrough) | — |
| Build verification | ✅ `npx next build` passes | — |
| Tier discount alignment (20/30/40 → 10/20/30) | 🚫 BLOCKED — awaits user decision (affects live coupons) | `lib/abxtac-provider-access.ts:51-56` |

### Phase 1 — NOT YET DONE (pre-deployment steps)
- [ ] Run migration against production DB: `psql $DATABASE_URL -f migrations/20260416_biobox_lab_orders.sql`
- [ ] Configure env vars: `WOO_BIOBOX_WEBHOOK_SECRET` (matches WC webhook setting), confirm `JARVIS_SHARED_SECRET` is set
- [ ] PM2 restart `gmh-dashboard` after migration
- [ ] Configure WC webhook on abxtac.com → `https://nowoptimal.com/ops/api/webhooks/woo-biobox-order` on `order.completed` event
- [ ] Test with philschafer7@gmail.com account before any real customer order

### Pending phases
- **Phase 2**: Dashboard `OrderLabModal` BioBox mode + sync to `public/ipad/` + `public/mobile/` (web staff UI)
- **Phase 3**: Native iOS/Android app BioBox screen + 3 lambda actions (`get_biobox_catalog`, `get_biobox_eligibility`, `order_biobox_kit`) — deployable via EAS OTA (no store re-submission)
- **Phase 4**: ABXTAC WC storefront `/labs` page + pre-checkout eligibility gate (WP plugin hook)
- **Phase 0 (you)**: Create 14 products + 6 sub-categories in WC admin using `abxtac-website/docs/BIOBOX_PRODUCT_GUIDE.md`

### Key architectural decisions (locked)
1. **Reuse existing lab infrastructure** — `order_lab.py` already accepts B### codes via PANEL_CODES fallthrough; `fetch_results.py` cron + `lab_review_queue` already handles BioBox accessions
2. **Consult gate via `abxtac_customer_access` table** — `provider_verified=true AND tier_expires_at > NOW()` = eligible
3. **WC webhook defense-in-depth** — if an ineligible customer somehow pays, `status='held_ineligible'` halts submission + alerts staff (no silent fail, no silent refund)
4. **No new Python script** — `order_lab.py --from-json` pattern from existing `/api/labs/orders/route.ts:313` reused
5. **Native app uses EAS OTA** — JS-only BioBox screen deploys without App Store/Google Play review

---

## PROJECT: BioSCOPE Third-Party API (Apr 29, 2026 — PHASE 1 COMPLETE)

**Goal**: Allow BioSCOPE to call our API with patient-scoped access. Healthie keys can't be patient-scoped, so we proxy: BioSCOPE → us → dedicated Healthie key. Token leak is bounded to allowlisted patients only.

**Direction (current)**: Inbound (BioSCOPE → us). Future bidirectional planned.
**SOT module**: `docs/sot-modules/29-bioscope-integration.md`

### Phase 1 status (Apr 29, 2026 — INFRASTRUCTURE COMPLETE)
| Item | Status | File |
|------|--------|------|
| Migration: `bioscope_authorized_patients` allowlist + Doug Dolan seed | ✅ Created (not yet run) | `migrations/20260429_bioscope_authorized_patients.sql` |
| Auth middleware: secret check, allowlist check, audit logger | ✅ Created | `lib/bioscope-auth.ts` |
| Dedicated Healthie client (separate API key) | ✅ Created | `lib/bioscope-healthie.ts` |
| Admin page: add/revoke patients | ✅ Created | `app/admin/bioscope/page.tsx`, `app/admin/BioscopeAdminClient.tsx` |
| Admin API: GET/POST/DELETE allowlist | ✅ Created | `app/api/admin/bioscope/route.ts` |
| Build verification | ✅ `npx next build` passes — both routes registered | — |

### Phase 1 — NOT YET DONE (pre-deployment steps)
- [ ] Configure env vars in `.env.local`: `BIOSCOPE_API_SECRET=bsk_live_<token>` and `BIOSCOPE_HEALTHIE_API_KEY=gh_live_<key>`
- [ ] Run migration against production DB: `psql $DATABASE_URL -f migrations/20260429_bioscope_authorized_patients.sql`
- [ ] PM2 restart `gmh-dashboard` after env + migration
- [ ] Smoke-test admin UI at `/ops/admin/bioscope` (verify Doug Dolan appears in active list)
- [ ] Email bearer token to BioSCOPE (no live endpoints to use yet — they get the token now, endpoints come in Phase 2)

### Pending phases
- **Phase 2**: Read endpoints — `/api/bioscope/patient/[id]` (demographics, labs, notes). Curated set, NOT generic GraphQL passthrough. Gated on BioSCOPE confirming the operation list.
- **Phase 3**: Write endpoints — push lab results, push chart notes. Higher review bar since these mutate the chart.
- **Phase 4 (future)**: Outbound — `lib/bioscope-client.ts` for *us* calling *them*. Their auth in `.env.local`.

### Key architectural decisions (locked)
1. **We are the gatekeeper** — BioSCOPE never gets a Healthie key directly (Healthie keys are tenant-wide, can't be patient-scoped). All requests proxy through `/api/bioscope/*` so we can enforce the allowlist server-side.
2. **Bearer token = `bsk_live_<32 bytes base64url>`** — Stripe/GitHub-style prefix for grep/leak detection. Compared with `crypto.timingSafeEqual`.
3. **Dedicated Healthie key** (`BIOSCOPE_HEALTHIE_API_KEY`) — segregates BioSCOPE-driven Healthie audit-log activity, rotatable independently from main `HEALTHIE_API_KEY`.
4. **Allowlist as DB table** (not Healthie tag) — fast at request time, explicit toggle in admin UI, revoked rows preserved for audit.
5. **Curated endpoints, not generic passthrough** — GraphQL passthrough makes scope-validation brittle (queries can fan out). Each endpoint takes an explicit `patient_id` and validates it.
6. **Audit every call** to `agent_action_log` with `agent_name='bioscope'` — single pane for spotting abuse/anomalies.

### Current allowlist seed
| Healthie ID | Patient | Added | Notes |
|---|---|---|---|
| 12743455 | Doug Dolan | 2026-04-29 | Initial seed — BioSCOPE pilot patient |

---

## Controlled Substance System — Bug Fixes (Apr 20-22, 2026)

### Morning DEA Check (Fixed Apr 20-22)
**Problem**: Morning check only compared vial volumes — prefilled syringes (staged doses) were invisible. Staff couldn't reconcile physical inventory against system.

**Root cause**: Three bugs:
1. iPad UI didn't show staged doses in system counts or ask staff to count syringes
2. Backend `controlledSubstanceCheck.ts` discrepancy formula excluded staged doses
3. `route.ts` pre-check and `controlledSubstanceCheck.ts` recording used different formulas (disagreed)

**Fix**: 
- iPad now shows staged syringes as separate line + hides syringe input when there are 0 staged
- Backend uses unified grand-total formula: `system = vials + staged` vs `physical = counted vials + counted syringes`
- Live running total on iPad shows match/discrepancy in real time as staff types
- Files: `public/ipad/app.js` (display + form + live calc), `lib/controlledSubstanceCheck.ts` (formula), `app/api/inventory/controlled-check/route.ts` (pre-check)

### Staged Dose Creation "Failed to save" (Fixed Apr 22)
**Problem**: Selecting a patient before staging a dose caused "Failed to save" error. Staging without a patient (generic) worked fine.

**Root cause**: iPad patient search returns Healthie IDs (numeric, e.g., `"12345678"`). The `staged_doses.patient_id` column has a FK to `patients.patient_id` (UUID). Inserting a Healthie ID into a UUID FK column → constraint violation → 500 error.

**Fix**: Backend `app/api/ipad/stage-dose/route.ts` now detects non-UUID patient IDs and resolves them via `healthie_clients` junction table before insert. If the Healthie patient isn't in the dashboard DB, staging proceeds with `patient_id = null` (non-fatal fallback).

### Key files for controlled substance system
| File | Purpose |
|------|---------|
| `lib/controlledSubstanceCheck.ts` | Core reconciliation logic — `getSystemInventoryCounts()`, `recordControlledSubstanceCheck()`, `adjustInventoryToPhysicalCount()` |
| `app/api/inventory/controlled-check/route.ts` | GET (counts/status/history) + POST (record check) |
| `app/api/ipad/stage-dose/route.ts` | Create staged doses (prefill syringes from vials) |
| `public/ipad/app.js` | iPad UI — DEA check modal (~line 8580), stage dose modal (~line 8410), `submitDEACheck()`, `submitStageDose()`, `updateDEACheckTotal()` |

### Reconciliation formula (current)
```
System Total  = SUM(vials.remaining_volume_ml WHERE active) + SUM(staged_doses.total_ml WHERE status='staged')
Physical Total = (CB full × 30) + CB partial + (TopRx full × 10) + TopRx partial + (syringe count × 0.60)
Discrepancy   = System Total - Physical Total
Threshold     = ±2.0mL (auto-documented as waste if within threshold)
```

### Timezone handling
- All timestamps use `America/Phoenix` (MST, UTC-7, no DST)
- `CLINIC_TIMEZONE = 'America/Phoenix'` constant at line 67 of iPad app.js
- Postgres `timestamp without timezone` columns store UTC; displayed via `toLocaleString('en-US', {timeZone: 'America/Phoenix'})`

---

## PROJECT: Dispatch Session Coordinator (Apr–May 2026 — IN USE)

**Goal**: Coordinate 5–15 parallel tmux Claude Code sessions so they stop colliding on the same files and trampling each other's branches.

**Components**:
| Component | Location |
|---|---|
| CLI tool | `~/.claude/bin/claude-coord` |
| MCP server (Cowork integration) | `~/dispatch-mcp/` (PM2 service `dispatch-mcp`, port 3010 localhost) |
| State files | `~/.claude/coord/` (registry.json, sessions/, sessions/archive/, decisions.md, inbox/, antigravity-queue) |
| Auto-cleanup | Cron `*/5 * * * * claude-coord reap` + tmux `session-closed` hook |
| Smart launcher | `cs` alias → `claude-start.sh` (auto-checkin + tmux + Claude) |

**Workflow**:
1. `claude-coord checkin --task "<one-liner>"` registers tmux session + auto-creates feature branch `claude/<tmux>/<slug>`
2. `claude-coord conflicts <paths>` before editing (advisory check against other sessions' claims)
3. `claude-coord claim <paths>` reserves files (advisory, not a lock)
4. `claude-coord log "<msg>"` keeps a per-session activity log
5. `claude-coord checkout` releases claims, archives log, **re-runs `claude-coord debug` as safety gate**

**Rules (enforced via CLAUDE.md)**:
- Every session uses its own branch (no direct edits to master)
- Branch discipline: merge to master before session end — no orphan branches
- File count guardrail: stop and checkpoint at 20 modified files, run pre-deploy at 50, never accumulate 100+

**Why this exists**: On May 12, 2026, we found 16 orphan Claude Code branches with overlapping changes and a 362-file uncommitted refactor running on production.

---

## PROJECT: Pre-Deploy Gatekeeper + Agents Dashboard (May 2026)

**Pre-deploy gatekeeper** (`~/gmhdashboard/scripts/pre-deploy-check.sh`):
- MANDATORY before any `pm2 restart gmh-dashboard`
- Exit code 0 = safe; non-zero = BLOCKED
- Writes report to `docs/DEPLOY_CHECK.md`
- Wired into `claude-coord checkout` as a re-run safety gate (override with `--skip-debug` only when Phil explicitly says so)
- Self-excluded from dangerous-grep check (commit `8eac0d2`)

**Health check** (`~/gmhdashboard/scripts/health-check.sh`):
- Writes scoreboard to `docs/KPI_CHECK.md`
- Based on NOW_120M_Playbook KPI scoreboard targets
- Uses `.env.local` DB creds, runs SQL probes

**Agents dashboard** (existing `/agents` page driven by:):
- API: `app/api/code/agent-health/route.ts` — health endpoint for the ops/agents view
- API: `app/api/code/sessions/route.ts`, `kill-session/route.ts`, `launch-task/route.ts`, `health-check/route.ts`
- Page: `/ops/ops-center/page.tsx` (Operations Center client component)
- Duplicate `/ops/agents` page was removed (commit `d87a91b`) — API infrastructure retained for existing `/agents` dashboard

**Agent scripts** (`scripts/agents/`):
- `morning-intelligence.sh` — daily 6:47am MST CEO brief
- `system-monitor.sh` — hourly :13 minute
- `auto-remediation.sh` — daily 7am MST (after morning intel)
- `data-integrity.sh` — on-demand
- `debug-all-systems.sh` — 26-test debug suite (PM2, DB, 5 APIs, gender filter, dates, wholesale pricing security, 6 Lambda actions, 4 marketing sites)

---

## PROJECT: Patient Classification Engine (Apr 28+ 2026)

**Goal**: Replace ad-hoc `client_type` strings with structured classification (Member / Intermittent / Visit) + signal badges + intake defaults + dedup.

**Components**:
| File | Purpose |
|---|---|
| `migrations/20260428_client_type_classification.sql` | Schema migration for classification columns |
| `scripts/generate-classification-audit.js`, `…-v3.js` | Read-only dry-run audit over all 491 patients (duplicates, orphan links, proposed classifications) |
| `scripts/apply-classification-batch.js` | Idempotent batch applier |
| `scripts/refresh-intake-signals.js` | Nightly 3am MST refresh — populates `patient_signals_cache` (badge data) |
| `docs/sot-modules/25-patient-classification-and-dashboard.md` | Spec (draft) — Member/Intermittent/Visit, signal badges, intake defaults, dedup |
| `docs/sot-modules/26-classification-audit.md` | Audit snapshot (regenerate via `node scripts/generate-classification-audit.js`) |
| `docs/sot-modules/27-patient-flow-map.md` | Stage-oriented lifecycle (Lead→Booked→Intake→Evaluated→Onboarded→Active→At-risk→Off-service) |

**Status**: Spec + audit modules live. Migration created. Nightly refresh cron live since 2026-04-19.

---

## Patient Status Chokepoint — Hardening Plan v3 (Apr 25, 2026)

Single chokepoint for all `patients.status_key` writes. Spec: `docs/sot-modules/28-hardening-plan-v3.md`.

### Phase 1.0–1.4 status: ✅ COMPLETE
| Sub-phase | Scope | Result |
|---|---|---|
| 1.0 | Schema migration + helper skeleton | ✅ `migrations/20260425_status_audit.sql`, `lib/status-transitions.ts` |
| 1.1 | Migrate 3 admin-API writers | ✅ |
| 1.2 | Migrate 6 webhook-processor writers | ✅ |
| 1.3 | Migrate 7 script writers | ✅ |
| 1.4 | iPad widget + ESLint rule + acceptance tests | ✅ commits `cef50b6`, `611048f`, `6f13c8e` |

**Total writers migrated**: 24 (plan said 16; thorough grep + post-Phase 1.4 ESLint surfaced 8 more).

### Architecture
- **Helper**: `lib/status-transitions.ts:transitionStatus()` — pre-flight rule check, SET LOCAL session GUCs, single UPDATE. Returns `{applied, blocked, blockReason, fromStatus, toStatus}`. Supports caller-managed transactions via `client` param.
- **DB trigger**: `migrations/20260425_status_audit.sql` — BEFORE UPDATE OF status_key. Re-applies rules from session GUCs as bypass-proof backstop, writes `patient_status_audit` rows for accepted transitions, sets `status_key_updated_at`.
- **Hard rules**:
  - Rule 1: `webhook_processor` cannot set `inactive`
  - Rule 2: out of `inactive` only via `admin_api` or `script:*`
- **ESLint rule**: `eslint.config.mjs` `no-restricted-syntax` blocks `UPDATE patients SET ... status_key` outside `lib/status-transitions.ts`. Severity: error.

### iPad widget
- Endpoint: `app/api/dashboard/status-activity/route.ts` (default `?days=7`, max 90)
- Render: `renderStatusActivityCard()` in `public/ipad/app.js` (between Patient Retention and Accounts Receivable)
- Loaded as part of dashboard refresh `Promise.allSettled` block (`loadStatusActivity()`)

### Acceptance tests
- Runner: `scripts/test-status-chokepoint.ts` — 17/17 passing as of Apr 25
- Run: `TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' npx ts-node --transpile-only scripts/test-status-chokepoint.ts`
- Backfill gap (`status_key='inactive'` patients with no audit history): **59** (matches v3 plan estimate; pre-Phase 1.0 inactives, expected)

### Phase 1.5 — soak (calendar-bound)
- 1 week post-deploy: monitor audit-gap query (any `status_key` change without an audit row indicates a writer bypassed both helper and trigger — should be 0).
- Watch `patient_status_audit WHERE source = 'unknown'` — trigger fallback for rogue UPDATEs.
- Pending: optional Telegram alert for inactive-target blocks (Phil's Q4 from spec).
