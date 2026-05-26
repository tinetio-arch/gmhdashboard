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
- **2026-05-26 — Phase-aware AUTO-ADVANCE dispatch (dispatch row 20260526-225012-e73e).** Phil's rule: on a phased project, all-done(Phase N, debug-green) → auto-launch Phase N+1, no manual approval. Phil is never asked "shall I advance?" — the only thing that surfaces a Waiting-on-You card is a phase that genuinely needs a Phil decision before code can begin. Fix in `~/dispatch-mcp/tools/projects.py` (commit `4b252b0`, master). **Helpers** (module-level): `_parse_phase(row)` (regex `^\s*\[\s*phase\s*(\d+)\s*\]` on the title, case-insensitive); `_next_phase_partition(rows, slug, next_phase)` (buckets open top-level tasks in (slug, phase) → `launchable` / `phil_needed` / `skipped`; launchable = `routed_to ∈ {null,"",code_task,cowork,auto}` and not already running; phil_needed = `routed_to ∈ {todoist,notify}` OR `needs-review` label OR `status=blocked` with phil reason; skipped = already-running tmux); `_maybe_auto_advance_phase(self, completed_row)` (the hook). **project_launch_tasks gained `phase: int` arg**: omit = lowest open phase among the project's phased tasks; `0` = no scoping (legacy); back-compat for unphased projects (no [Phase N] anywhere → no scoping). Tool docstring + input schema updated to advertise this. **Lifecycle hook in `_h_inbox_update`**: best-effort try/except so a bug in auto-advance never blocks an inbox update; fires only on top-level rows (`not parent_task_id` — subtasks roll up to parent and were already handled by the subtask rollup path) transitioning to `status=done` from a non-done prev. Reads inbox fresh, filters out the just-completed row, confirms zero remaining opens in (slug, phase); if so, partitions next phase. If launchable non-empty → calls back into `_h_project_launch_tasks` with explicit task_ids + phase. If only phil_needed → flips the oldest one to `status=blocked` with `blocked_reason="phase-N+1 auto-advance: needs phil-decision (no code_task tasks ready in this phase)"`, appends a notes_thread breadcrumb, writes a `auto_advance_needs_phil` history event. Surfaces in `_h_needs_you`'s `blocked-on-phil` lane (existing logic). If next phase empty (project complete or numbering skips) → audit log only, no card. **Result rides on `_h_inbox_update` response** as `_auto_advance: {ok, advanced, current_phase, next_phase, launched: [task_ids], phil_needed_count, phil_card_row}` so the dashboard can render confirmation toast. **Tests**: 6 in-memory cases pass (parser correctness, partition for code-only phase 2 + phil-only phase 4, end-to-end phase 1→2 launch, phase 3→4 phil-card surfacing, non-phased row no-op, not-last-in-phase guard) plus 4 launch-default cases (auto-pick lowest, explicit phase, phase=0 legacy, unphased project back-compat). All 3 existing dispatch-mcp test scripts still pass (test_code_touch_hints / test_debug / test_stdio). `pm2 restart dispatch-mcp` clean (pid 2848901). Live http smoke: phase=999 returns spawned=[]; phase="two" rejected with proper error. `claude-coord debug` ✅ 27/27. Pairs with the existing `[Phase N]` dashboard grouping (row 20260526-192919-3126, claude-dashboard-overhaul, already merged). The first project this will exercise live: `untangling-healthie-communications-from-healthie` (Phase 1 has 1 task still in_progress; when it lands done, Phase 2's 3 code_task rows auto-launch). NOT pushed to origin (no-master-push rule). Coordination: `tools/projects.py` was claimed by `claude-coord-reliability` whose work was already merged at `6a0e08d`/`80457ec`/`63afadc` (DONE in its log, tmux idle); Phil approved reclaim before edit.
- **2026-05-26 — needs_you: STAFF messages now surface in "Waiting on You" strip (dispatch row 20260526-225008-3131).** Phil's complaint: when Hannah/Michele/an agent messages on a task via `inbox_chat`, the message sits in that task's `chat_thread` invisibly — `_h_needs_you` (which feeds the dashboard strip) only returned `needs-review` / `blocked-on-phil` / `cowork-pending` rows, so Phil only saw the chat by accident. Fix in `~/dispatch-mcp/tools/projects.py` (commit `63afadc`, merged ff to master): new module-level helper `_chat_unread_for_phil(row)` scans `chat_thread` and returns metadata when the trailing run of messages is all non-Phil (staff/agent spoke last, Phil hasn't replied); `_h_needs_you` adds it as a 4th `_why = "staff-message"` lane gated to `OPEN_STATUSES`. Staff-message rows carry five extra fields (`chat_unread_count`, `chat_last_from`, `chat_last_at`, `chat_preview` truncated to 200 chars, `chat_last_surface`) so the dashboard renders the preview + count without a second `inbox_chat_read` round-trip; the same metadata rides along on rows that landed in the other 3 lanes whenever they also have unread chat (lane label stays specific, chat fields still attached). `needs_you` Tool docstring updated to document all four lanes. Verified: 8/8 helper unit cases pass, zero regressions on the legacy 3 lanes; pre-patch `needs_you` returned 0 rows, post-patch surfaces the Hannah → Phil "Develop wellness protocols" thread (`unread=1 from=hannah at=2026-05-21T17:46:53 preview="Hi Phil, this document does not include reconstitution amounts..."`); live HTTP smoke-test through PM2 `dispatch-mcp` (port 3010, restart #103) returns the new fields end-to-end. Coordination: file was also claimed by `claude-coord-reliability` (work merged at `6a0e08d`/`80457ec` before this session began; claim was stale, tmux idle); no conflicts on merge. NOT pushed to origin.
- **2026-05-26 — Wellness Protocols PDF: verified per-peptide reconstitution recipes (dispatch row 20260526-221513-b872, parent 20260519-224757-f25b).** Hannah reported the wellness protocols PDF was missing reconstitution amounts. Audited the older `ABXTac_Peptide_Protocol_Guide.docx` reference doc against arithmetic (`concentration = mg ÷ mL water; units = (dose ÷ concentration) × 100`) and found **catastrophic 10× under-dose errors** in 4 peptides: Tirzepatide (claimed 5 u for 2.5 mg, actual 25 u), Retatrutide (claimed 2 u for 2 mg, actual 20 u), TB-500 (claimed 8 u for 2 mg, actual 80 u), Epitalon (claimed 10 u for 5 mg, actual 100 u). Re-derived every recipe from scratch. **Generator (`scripts/generate-wellness-protocols.py`)**: new `RECON` dict at module level covers every injectable peptide we carry (~46 recipes); `profile()` renderer now wires a "Reconstitution" row into each peptide profile between Protocol and Cycling; new "Reconstitution Quick Reference (All Peptides)" page added to Foundations with a 41-row table (vial+water → concentration → common-dose units) and explicit safety callout that any dose >100 units must be split into two separate injections (never combined in one syringe). Every recipe targets readable units on a U-100 insulin syringe. **PDF**: regenerated from 35 → 41 pages (104 KB), attached to dispatch row 20260526-221513-b872 AND parent row 20260519-224757-f25b so Hannah sees it on her original task. **Cherry-picked** the original generator commit `584277e` (which was never merged to master — lived only on the Cowork branch `claude/cowork-4757f25b/...`) onto this branch as a prerequisite for the recon work. NOT pushed to origin. Branch ready to merge to master.
- **2026-05-26 — iPad patient-chart 💬 Comms tab Phase 1 (dispatch row 20260526-192900-5d16, project `untangling-healthie-communications-from-healthie`).** Added the Comms tab/button to the patient chart header right next to ⭐ Interesting in `public/ipad/app.js` (chart header at the previously-line-6406 button cluster). Mirrors the toggle-panel pattern (new `toggleCommsPanel()` next to `toggleInterestingPanel()`); collapsible `#commsPanel` placeholder explains it's the entry point for the Healthie-comms untangling project and that content lands in Phase 2. Color: green (`#22c55e`) to distinguish from ⭐ purple. Mobile bundle resynced (`app.7ae8b25d.js`) via pre-commit hook. Debug 27/27 PASS. Merged to master locally (commit `9590c93` merge of branch `claude/claude-task-29005d16/...`). **Not deployed** — placeholder UI only, no backend wiring; sibling Phase-1 work shipped the comms ledger (row 20260526-192859-db1d) and `notifyPatient()` gateway (row 20260526-192859-78d8). Phase 2 will populate the panel from `patient_communications`.
- **2026-05-26 — Agents dashboard subtasks Phase 2: sub-agent roll-up (dispatch row 20260526-201129-c002).** Phil's actual intent for subtasks: each child is a sub-agent whose output feeds the parent. Phase 2 builds the roll-up layer on top of Phase 1's parent/child structure. **Backend (`~/dispatch-mcp/tools/projects.py`, commit `b3e2d37`)**: (1) `_h_inbox_update` rejects `status=done` on any row that has open child subtasks — clear error message lists up to 3 open subtask titles + an overflow count, and tells Phil to either close the subtasks or cancel/drop the parent. The whole point of subtasks-as-sub-agents is that the parent depends on their output. (2) New `_rollup_subtask_to_parent(subtask_row)` helper — fires on a subtask's transition to done. Every attachment on the subtask gets appended to the parent's `attachments` list with `rolled_up_from_task_id` + `rolled_up_from_title` + `rolled_up_at` provenance. Files are NOT copied or moved — `_row_view` rebuilds `agents_url` / `download_url` against `rolled_up_from_task_id` so clicks resolve to the subtask's storage folder. Also appends a roll-up note to `parent.notes_thread` (✅ + child title + file list + notes excerpt + tmux session if any), writes a `subtask_completed` event to the parent's history. Idempotent on `(rolled_up_from_task_id, name)`. (3) `_h_project_rows` pre-computes open/done/total subtask counts per parent; `_row_view` returns `subtask_open_count`, `subtask_done_count`, `subtask_total` (back-compat `subtask_count` = open). (4) `inbox_quick_add` accepts new `spawn=true` arg — immediately routes the new row to `code_task` via existing tmux spawn path, so adding a subtask AND launching it as a sub-agent is one call. Output rolls up via the subtask→done→rollup path. **Bug discovered + fixed**: `claude-dashboard-overhaul`'s commit `0bad044` accidentally bundled half of my in-flight Phase-2 work (the `_rollup_subtask_to_parent(row)` call site + the aggregate count fields) without the function definition or the spawn flow — `from tools.projects import _rollup_subtask_to_parent` failed on master HEAD. This commit completes their commit. **Frontend (`~/agents-dashboard/index.html`, commit `875f39c`)**: Subtasks section header shows progress meter `(N/M done)` — turns green `(N/M done ✓)` when complete. `+ Subtask` form gains a "spawn" checkbox (tooltip explains: tmux Claude sub-agent, output rolls up here); success toast names the spawned session. ⛔ Done-blocker hint appears under the form whenever any child is open. Each sub-row shows 🤖 tmux session (clickable, jumps to it) and 📎 N attachment-count chip. Project-tile parent badge upgraded from open-only `🧩 N` to aggregate `🧩 N/M` (green when complete). Parent's Files section: roll-up attachments get a `↳ subtask` provenance badge + soft green left border, with the source subtask's title in the tooltip. **End-to-end live integration test PASSED** (5 checks): aggregate progress badge data (`0/2` → `1/2` → `2/2`), attachment + notes + history rollup on subtask done, agents_url correctly resolves back to subtask storage, parent-done rejected with the listed sibling title, parent-done succeeds after closing the last subtask. Test artifacts cleaned. dispatch-mcp restarted (27 tools in projects module, +1 from Phase 1). 27/27 debug pass. NOT pushed to origin. Coordination: dispatch-mcp `tools/projects.py` was concurrently being edited by claude-coord-reliability (harm-gate hunks in `_row_view` + class methods, non-overlapping with mine, branch ready but unmerged) and claude-dashboard-overhaul (`waiting_on` field — uncommitted; restored to the working tree after my commit). agents-dashboard `index.html` advanced from `d5f92e6` to `a733331` (claude-dashboard-overhaul's `waiting_on` indicator) during my work — my anchors still resolved cleanly, no overlap.
- **2026-05-26 — Agents dashboard subtasks (parent/child tasks; dispatch row 20260526-201129-c002).** Phil wanted to break a task into sub-items (e.g. the Wellness Protocols PDF-reconstitution work as a subtask of the wellness protocols task). Subtasks are independent inbox rows with a new top-level `parent_task_id` field — each one keeps its own assignee, status, route, tools manifest, and tmux session, so they can be spawned/handled separately. **Backend (`~/dispatch-mcp/tools/projects.py`, commit `8044f98`)**: added `parent_task_id` to `INBOX_UPDATE_WHITELIST` (validated against missing-row / self-parent / pointing-at-a-subtask cycles); `_row_view` now returns `parent_task_id` and a `subtask_count` computed by `_h_project_rows` (counts only OPEN children, across all projects — a subtask in another bucket still counts toward its parent's badge); `_h_inbox_quick_add` accepts `parent_task_id` and inherits the parent's `project_slug` when not supplied; one level of nesting only (grandchildren rejected with a clear error); audit events: `created` on the child carries `parent_task_id`, parent's history gets a `subtask_added` event. New tool `inbox_subtasks(row_uuid, include_closed=True)` returns children sorted open-first → priority → age. **Frontend (`~/agents-dashboard/index.html`, commit `3dd7a5e`)**: new 🧩 Subtasks section in the task panel (only on top-level rows) with inline "+ Subtask" input (Enter or button); each child renders as a clickable row showing title/assignee/status that opens the child's panel; subtask panels get an "↑ Subtask of parent — open" breadcrumb at top; project-tile rows now show a `↳` prefix for subtasks and a `🧩 N` badge on parents with open children. **Smoke test**: REST `inbox_quick_add` w/ parent_task_id created a child that inherited the parent's slug, `inbox_subtasks` returned it, `project_rows` stamped `subtask_count=1` on the parent; nested-subtask and self-parent attempts both rejected; dispatch-mcp restarted via pm2 (66 tools registered, +1 from baseline). 27/27 debug pass. NOT pushed to origin. Coordination note: the live `~/agents-dashboard/index.html` carries this session's changes plus uncommitted in-flight projmaster-ui work from another session — my commit on master captures ONLY my 111 lines; projmaster's work stays in the working tree for that session to commit.
- **2026-05-26 — Central comms gateway `notifyPatient()` (dispatch row 20260526-192859-78d8, project `untangling-healthie-communications-from-healthie` Phase 1).** New `lib/comms-gateway.ts` exposes one chokepoint `notifyPatient(patientRef, event, payload, options)` that every future outbound caller will route through. Resolves channel by priority `push → SMS → email` (or caller-forced `event.preferredChannel`), skipping any channel the patient can't receive on (no opted-in push tokens → SMS; no GHL contact + phone → email; no email → ledger row `status='skipped'` reason `no_channel`). Enforces three suppression layers, **each writing a ledger row for audit**: (1) **hard idempotency** — same `idempotencyKey` (caller-supplied OR derived `auto:<event>:<patient>:<sha256-payload>`) returns the prior row's outcome without re-sending (race-safe via the UNIQUE-when-not-null index from sibling's migration); (2) **soft dedup** — when `event.dedupWindowMinutes > 0`, suppresses if any non-failed row for the same `(patient_id, event_type)` exists in the window; (3) **per-patient daily cap** — default 6 sends per rolling 24h (env `COMMS_PATIENT_DAILY_CAP` overrides; `options.dailyCap`/`capWindowHours` per-call overrides; `event.bypassCap=true` for transactional/critical sends like lab results, payment receipts). Writes to the `patient_communications` ledger via a thin repo wrapper `lib/comms-ledger.ts` (the only file that knows the schema — single point of edit if the table evolves). Provider mapping: push → `provider='expo'` + Expo ticket id deferred (existing `push_send_log` + cron handles receipts); SMS → `provider='ghl'` + `external_id = GHL message id`; email → `provider='ses'` + SES MessageId via `messagingService.sendPatientMessage`. Suppression reasons (dedup / cap / optout) round-trip via `raw_metadata.suppress_reason` because the ledger's `status` enum collapses them into a single `suppressed`. **Phase 1 only — gateway library built, NO existing callers migrated.** That happens in later phases per the "untangling-healthie-communications-from-healthie" project. Coordination: lived-in parallel with sibling session `claude-task-2859db1d` (the ledger migration); coord contract posted to `~/.claude/coord/decisions.md` 2026-05-26T13:25; gateway reads the actual schema (NOT my originally-proposed one — sibling expanded `channel` to 7 values, `status` to 9, dropped `dedup_key`, renamed to `event_type`/`external_id`/`error_message`/`queued_at`), and the ledger wrapper was rewritten to match. Live-DB smoke test (insert → roundtrip lookup → countSent → findRecentByPatientEvent → update → delete) all PASS. Typecheck + ESLint clean on both new files. Files: `lib/comms-gateway.ts` (new, 380 lines), `lib/comms-ledger.ts` (new, 220 lines). No callers touched.
- **2026-05-26 — `patient_communications` ledger table (dispatch row 20260526-192859-db1d, project `untangling-healthie-communications-from-healthie` Phase 1).** Migration `migrations/20260526_patient_communications.sql` adds the unified outbound-message ledger: 33 columns covering who (patient_id UUID FK ON DELETE SET NULL, healthie_client_id, ghl_contact_id, clinic, account_key constrained to `mensHealth|primaryCare|abxtac` to match `ghl_messages`), what triggered it (source, event_type), channel (sms/email/push/voice/in_app/healthie_message/other), direction (outbound/inbound, default outbound), template_key + template_variables JSONB, recipient routing (phone/email/push_token denormalized), content (subject/body), provider identifiers (provider + external_id), status lifecycle (queued/sent/delivered/failed/opened/clicked/bounced/skipped/suppressed), audit (triggered_by_user_id, request_id, raw_metadata), and 5 timestamps (queued_at NOT NULL DEFAULT NOW, sent/delivered/opened/failed). Idempotency_key is UNIQUE-when-present so writers can safely re-run crons (e.g. `appt:<id>:reminder24h`). Six indexes: idempotency unique, (patient_id, queued_at DESC), (event_type, queued_at DESC), (account_key, queued_at DESC), partial (status, queued_at) WHERE status IN ('queued','failed'), and (provider, external_id) WHERE external_id NOT NULL. updated_at trigger included. Applied to live RDS — table exists, 0 rows baseline. **Phase 1 only: schema + indexes, NO writers yet.** Phase 2 will plumb writers through the comms-suppression gate (see `untangling-healthie-communications-from-healthie` project). Memory `[patients CASCADE delete danger]` honored — patient_id is ON DELETE SET NULL so the audit trail survives.
- **2026-05-26 — GHL inbound-SMS appointment-booking auto-responder (dispatch row 20260519-224757-026e).** New patient-facing capability: when an inbound SMS lands in a clinic GHL sub-account (mensHealth / primaryCare / abxtac) asking to schedule, classify intent via Claude 3.5 Haiku (Bedrock) and auto-reply with the brand-appropriate Healthie booking URL (nowmenshealth.care/book, nowprimary.care/book, abxtac.com/booking). New `lib/ghl-auto-reply.ts` exposes `maybeSendBookingAutoReply()` with three guards: (1) classifier must return YES (NO on confirm/cancel/reschedule/labs/refills/etc.), (2) 24h cooldown so we don't double-reply in the same conversation, (3) 30-minute backoff if any staff outbound is more recent than the inbound — to avoid stepping on a live human thread. Outbound auto-reply rows go into `ghl_messages` with `sent_by_name = "Auto-Booking Assistant"` so staff see what was automated. Hook is 25 lines in `app/api/webhooks/ghl/messages/route.ts`, fully try/catch-wrapped so classifier or send failures never poison the webhook 200. **OFF by default** — gated on env `GHL_AUTO_BOOKING_ENABLED=true`; deploying the code changes zero patient behavior until Phil flips the flag. Pre-deploy SAFE (5✅/3⚠/0🔴 — warnings are pre-existing TS baseline, unrelated WIP, disk-80%). Debug 27/27 PASS. Deployed to prod (master `a21d5f3` merge + `8182ccf` feat, local only — not pushed to origin). To activate: add `GHL_AUTO_BOOKING_ENABLED=true` to `~/gmhdashboard/.env.local` then `pm2 restart gmh-dashboard`; smoke-test by texting "Can I get an appointment?" to a clinic GHL number → expect inbound row in `ghl_messages` immediately followed by an outbound row sent by "Auto-Booking Assistant" with the booking link. Co-existing with the `claude-apptspam` reminder-untangling work — that session is pausing **outbound reminder crons** (a different system); inbound-triggered auto-reply is complementary, not duplicative.
- **2026-05-26 — iPad vitals dictation parser fix (dispatch row 20260519-224757-26c2).** Hannah reported the "🎤 Dictate" button on the Record Vitals modal was buggy — common phrasings didn't populate the boxes. Three concrete parser bugs in `_wordsToDigits` / `parseDictatedVitalsToFields` (`public/ipad/app.js`): (1) punctuation glued to word numbers ("eighty,") missed the number-word map, so "BP one twenty over eighty, pulse seventy two" left "eighty" un-converted → BP regex failed; (2) the word-number combinator's bare `else num += nxt` fell through on "BP one twenty eighty" and produced **200** (120+80) instead of stopping — replaced with an explicit "stop and re-process" path that only adds tens when the running total is a clean multiple of 100; (3) BP labeled regex required `/`, "over", "on", or "to" between the two numbers, so "BP 120 80" / "BP 120, 80" / "blood pressure 120, 80" missed entirely — widened to also accept bare whitespace or comma **only** when preceded by a BP label (bare `120 80` elsewhere in the dictation still doesn't false-match as a BP). Also added `weighs|weighing|weighed` and "weighed in at" connector to the weight regex (clinicians say "weighs 185" much more often than "weight 185"). Node-validated parser against 20+ realistic Hannah-style dictation strings; previously-broken cases ("BP one-twenty over eighty, pulse seventy-two", "BP 120 80 HR 72…", "weighs 185 pounds") now all populate. No backend change — saving was already correct via `submitAllVitals` → `/ops/api/ipad/patient/<id>/metrics/` + Healthie sync. iPad-only file; pre-commit hook auto-resynced the mobile bundle on merge. Branch `claude/claude-task-475726c2/project-launch-from-row-20260519-224757-` merged into master locally (not pushed to origin).
- **2026-05-26 — iPad chart Appointments surfaced in header (dispatch row 20260519-224757-e2c8).** Phil's complaint: "Make it so I can see a patient's appointments on the iPad — it doesn't let me scroll down to see them." Prior fix (576c6d1) put the Appointments section at the top of the **Notes tab**, but the tab itself sits below ~700 px of always-visible clinical sections (demographics, allergies, diagnoses, medications, vitals, kiosk, family) so on a portrait iPad the appointments were still below the fold. Added a compact, always-visible "📅 Appointments" section in the chart panel header, right after Last Vitals — next 2 upcoming + 3 most recent past + a "View all →" jump-to-Notes-tab link. Same data source (`chartPanelData.healthie_appointments`), no API change. Sync-mobile.sh auto-rebundled to `app.dabdc83f.js`. Pre-deploy SAFE (5/3/0). Deployed to prod locally (master `064b41c` + mobile sync `b7c2b32`, not pushed to origin). Verified live: `curl https://nowoptimal.com/ops/ipad/app.js | grep "APPOINTMENTS (always visible — Phil request 2026-05-26"` → 1 match.
- **2026-05-26 — iPad "New Order" McKesson button fix (dispatch row 20260520-231517-ec86).** Phil reported the iPad supply-inventory "📦 New Order" button does nothing. Deep-dive of the McKesson supply stack (catalog → availability sync → invoices → ordering): backend, data, code, and modal all healthy — 67 purchasable items mapped, `MCKESSON_ALLOW_PRODUCTION_ORDERS=true`, dryRun preview returns full draft when called correctly. **Root cause: `next.config.js` has `trailingSlash:true`, and the iPad's `previewNewOrder` / `submitNewOrder` POST'd to `/ops/api/ipad/mckesson/orders` (no trailing slash) → Next 308-redirects to `/orders/`. iOS Safari/WebKit drops the POST body when following a 308**, so the redirected request arrived with empty body → route returned 400 `items[] is required` → modal silently failed. Proven directly in nginx access logs: `POST /ops/api/supplies/mapping → 308 → /supplies/mapping/ → 500` (same bug, different endpoint — and "Map to McKesson" was also broken). curl preserves the body on 308, which is why backend tests passed. **Fix**: added trailing slashes to the entire McKesson/supply mutation cluster in `public/ipad/app.js` — 11 calls across New Order (2), Map-to-McKesson (4), supplies PATCH (1), invoice edit (2), invoice reorder (2), plus 4 GETs for consistency. Pre-commit hook auto-ran `sync-mobile.sh` and re-bundled `app.86db2dee.js`. Debug 27/27, pre-deploy SAFE. Deployed to prod (master `3460e2b` + merge, local only — not pushed to origin). Verified live: `curl https://nowoptimal.com/ops/ipad/app.js | grep "/ops/api/ipad/mckesson/orders/'"` → 2 matches.
- **2026-05-26 — Acosta duplicate-Healthie login fix (claude-acosta session).** Chris Acosta could not log into the patient app because two Healthie users shared his email: `12212961` (active, KEEPER, holds payments + Stripe cus_UE71PDOvYxBjAJ + 3 succeeded payments totaling $610 + 3 TRT dispenses + 5 peptides + active lab cadence) and `12741471` (archived 2026-01-20, "Jesus Cris Acosta Acosta" — the dup audrey@nowoptimal.com created in our DB on 2026-04-09; zero payments / zero dispenses / zero memberships locally). Healthie's email-based login lookup was ambiguous. Comparison record `12792633` (a third Cris dup) showed Healthie's own dedup convention: rename archived dup emails to `<hash>@gethealthie.com` — but `12741471` missed that step in January. **Fix** (minimal, reversible): renamed Healthie 12741471 email → `archived-hc12741471@gethealthie.com` via `updateClient`, mirrored on local DUP `patients.email` (status_key=inactive so demographics sync skips it anyway). KEEPER untouched. **Verified (33/33 independent checks)**: Healthie search for `teteacosta12111987@gmail.com` returns exactly one user (12212961, active=true); KEEPER's payment_method/stripe_customer_id/3 payments/3 TRT/3 DEA/5 peptide/labs all intact; DUP retired locally still has `Inactive (Merged)` + zero financial footprint; healthie_clients junction still maps 12741471 → KEEPER for inbound webhook routing. Side-effect noted: post-rename, DUP's `last_sign_in_at` cleared from 2026-05-24 → null (confirming Healthie was pooling sign-in across same-email users — the root mechanism behind the login failure). Audit: `agent_action_log` id 166 (category=patient_data_dedup). Backup: `.tmp/acosta-dedup/backup-latest.json`. Reversal: `node /home/ec2-user/gmhdashboard/.tmp/acosta-dedup/06-reversal.js --execute`.
- **2026-05-21 — TRT staged-dose "only 0.5ml saves" (dispatch row 20260520-235955-1d54).** Reported bug was already fixed in running prod — root cause was the pre-04-22 `LIKE '%30%'` vial filter (staging only saw Carrie Boyd 30mL vials); with those depleted, only a 0.5mL dose found a qualifying vial and larger doses hit a *silent* 400. Live-tested API (0.5/0.7/1.0 → all 200, inventory reversed after). Shipped two hardening fixes: (1) `StagedDosesManager.tsx` now surfaces the API's real error ("Not enough medication in vials…") instead of generic "Failed to save staged dose" — that hidden message was why staff couldn't diagnose; (2) `staged-doses/route.ts` rounds `totalMl` to 2dp (kills `3.1999999999999997` float artifacts + spurious volume-check edge case) and fixes `wasteMl || 0.1` turning a legit 0 waste into 0.1. Deployed to prod (master 30bab59, local only — not pushed to origin). Verified live: dose 0.7 now returns `totalMl: 3.2`.
- **2026-05-20 — iPad patient-chart Appointments (dispatch row 1_...194086).** Fixed recurring "appointments missing / files need upload dates" task. Files/docs already showed upload dates (no change). Appointments section was collapsed + buried in Notes tab + gated on `hAppts>0` so it vanished for patients with no upcoming appt. Moved to top of chart, expanded, always-visible; split into Upcoming/Past. Root API fix: `patient-chart` appointments query `is_active:true` → `filter:"all"` (Healthie was upcoming-only). Deployed to prod (master 576c6d1, local only — not pushed to origin).








---

## Recent Session Output — 2026-05-26

- **2026-05-26 — Per-patient comms profile (app-state + opt-outs) Phase 1 (dispatch row `20260526-192859-9a90`, project `untangling-healthie-communications-from-healthie`).** Third sibling Phase-1 task — built the single per-patient signal the gateway (sibling `lib/comms-gateway.ts` from row `...78d8`) will read to decide channel routing + suppression. **Migration** `migrations/20260526_patient_comms_preferences.sql`: (1) new `patient_comms_preferences` table — PK `patient_id` UUID FK→patients ON DELETE CASCADE, `channel_optouts` jsonb, `category_optouts` jsonb, `notes`, `updated_by_user_id`, updated_at trigger; one row per patient (NOT per account_key — Phil decision Q1); row may be absent and the view treats absence as no opt-outs. (2) `ALTER patient_push_tokens ADD app_version TEXT, last_heartbeat_at TIMESTAMPTZ` — NULL until mobile is wired in a future phase. (3) New view `v_patient_comms_profile` — single read point joining patients + aggregated patient_push_tokens + patient_comms_preferences. Exposes per-channel `reachable`/`optout`/`eligible` flags (push/sms/email/voice) and per-category `allow_*` booleans (billing/results/messages/promotions/appointments/announcements) where local override wins over per-device push pref (BOOL_OR across active devices). **API** `lib/comms-profile.ts`: typed `getPatientCommsProfile(patientId)` + `getPatientCommsProfiles(patientIds[])` returning `{appState, channels, allowsCategory, isSuppressed(channel, category), canSend(...)}`. **SAFETY** (Phil's hard rule): `BYPASSABLE_CATEGORIES = new Set(['billing'])` — explicitly excludes ALL clinical categories. Critical labs are phone-only, human-to-human; lab_critical is NOT and never will be an automated patient-comms category. `BYPASSABLE_CATEGORIES.has('results')` would throw in tests if anyone adds it. **Live RDS verified**: migration applied clean; view returns 512 patients (47 with app, 503 SMS-eligible, 495 email-eligible, 506 voice-eligible, 3 unreachable). **Smoke test** (`.tmp/comms-profile-smoke.ts`): write→read roundtrip flips eligibility correctly when opt-out inserted, `billing` IS bypassable, `promotions/results/appointments` are NOT, cleanup restores baseline, batch read works, missing patient → null. ALL ASSERTIONS PASS. **Typecheck**: 148 errors in worktree = 148 in master (zero new errors from my files). **ESLint clean**. **Phase 1 ONLY** — read-only API, no writers, no callers wired. Gateway swap and iPad Comms-tab edit UI come in later phases. Phil's standing rule: **entire comms stack stays gated off real patients until he signs off on testing** — Phase 1 is read-only so it cannot trigger sends on its own. Files: `migrations/20260526_patient_comms_preferences.sql` (new), `lib/comms-profile.ts` (new, 217 lines). Branch `claude/claude-task-28599a90/project-launch-from-row-20260526-192859-`.

- **ABXTAC self-serve intake — Phase 1 DEPLOYED (claude-task-2254f5ef)**: Merged branch `claude/claude-task-2254f5ef/healthie-intake-abxtac-deep-dive-safety-` into master (`3c6844f`) and deployed. Pre-deploy gate ✅ 6/2/0 (cleared 86% → 85% disk with `pm2 flush` + `npm cache clean --force` + `/tmp/node-compile-cache` rm). Build succeeded; mobile sync ran. `pm2 restart gmh-dashboard` clean. Live smoke: `GET /ops/api/intake/abxtac/hipaa-agreement` returns form structure 3 fields (✅), `GET /ops/api/intake/abxtac/services-agreement` → 404 (removed form, isolation ✅), `GET /ops/api/intake/nowmenshealth/hipaa-agreement` → 404 (cross-brand isolation ✅), `GET /ops/intake/abxtac` (hub) → 200. **nginx**: added `location ^~ /.well-known/` + `location = /apple-app-site-association` aliased to `/home/ec2-user/gmhdashboard/public-static/.well-known/` (config backed up to `nowoptimal.conf.bak-20260526-153834`, `nginx -t` ✅, reload ✅). All three universal-link endpoints serve 200 application/json: `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`, legacy `/apple-app-site-association`. Site root + /ops + /ops/intake/abxtac all still 200. Health-check 3/1/4 — same business-KPI baseline (billing holds, disk, PM2 restart counts, peptide zero-stock — pre-existing, not caused by this deploy). `claude-coord debug` ✅ 27/27. **Placeholders Phil needs to fill before Phase 2** (mobile EAS build): `<APPLE_TEAM_ID>` in AASA file, `<UPLOAD_KEY_SHA256>` + `<PLAY_APP_SIGNING_SHA256>` in assetlinks.json (see `docs/UNIVERSAL_LINKS_SETUP.md`). **Phases remaining** per `docs/ABXTAC_INTAKE_ROLLOUT_RUNBOOK.md`: 2 (mobile EAS build + store submit), 3 (GHL email + workflow), 4 (smoke-test with 1 real patient), 5 (flip `INTAKE_PUSH_TO_HEALTHIE=false`). **master committed locally + deployed but NOT pushed to origin** (no-master-push rule).

- **Inbox auto-categorize (claude-task-28a17b02)**: Session 1 of the auto-classify feature (dispatch row `1_20260519_150528_a17b02`). Every new inbox row now gets an `category` axis orthogonal to the existing `project_slug`: `todoist_ops` (Phil personally does this — "call patient X", "approve Z"), `pm2_code` (needs a tmux Claude session — bugs, schema changes, webhook timeouts), or `ambiguous`. For `pm2_code` rows the categorizer also computes `suggested_files[]` — top-5 grep hits across `~/gmhdashboard` and `~/dispatch-mcp` for identifier-like tokens pulled out of the task text — so a spawned session has a head start. **Flow**: (1) `tools/inbox.py:_h_inbox_add` does a synchronous regex pre-stamp at row-write time (`category_source=regex-prestamp`) so the dashboard has a category to filter on even when the LLM watcher is down; (2) `scripts/inbox_watcher.py` (PM2 service `inbox-categorizer`) upgrades the row with the LLM classification within ~250ms (`category_source=llm`, includes `suggested_files`); (3) on LLM failure, `lib/categorizer.py` falls back to the regex classifier and still emits a category + `needs-review` label rather than the prior `_error` envelope that left rows unclassified forever; (4) `tools/projects.py:_h_inbox_route` auto-mode now honors `category` (`pm2_code → code_task`, `todoist_ops → todoist`) ahead of the legacy `tool_manifest` heuristic. **New module** `lib/code_touch_hints.py` is the pure-Python heart — uses `(?-i:...)` for case-sensitive identifier patterns (without that `re.IGNORECASE` turned `[A-Z]` into `[A-Za-z]` and every plain word matched the camelCase pattern), prefers `git grep` to honor `.gitignore` for free, filters `*.bak*` so the dispatch-mcp backup soup doesn't drown out real source files. **Tests**: `test_code_touch_hints.py` — 18 unit tests, all pass. **Smoke test**: live `inbox_add` via dispatch HTTP API verified pre-stamp (regex-prestamp → pm2_code 0.75) and watcher LLM upgrade (llm → pm2_code 0.95, project_slug=mobile-ipad, 5 suggested files). Restarts: `inbox-categorizer` + `dispatch-mcp` (NOT `gmh-dashboard`); reinstalled `watchdog` in the venv (was missing from the mid-rebuild state claude-silentfix flagged on 05-20). dispatch-mcp commit `3619a14` on master. **Out of scope (future sessions)**: live Todoist API push (Session 2), `/agents` UI "Send to Todoist" button (Session 2), LLM-ranked code-touch hints (Session 3).

- **Appointment notes on create (claude-task-3701014b)**: Project-launch from dispatch row `20260520-103701-014b` ("Allow notes to be made when creating a new appointment"). The Healthie `createAppointment` mutation already supported `notes` (and `lib/scheduling.ts` exposes it), but the iPad's main booking endpoint `app/api/ipad/schedule/route.ts` was not extracting/forwarding it — and the iPad Add-to-Schedule modal had no notes field. Fixed both ends. **Backend**: POST `/api/ipad/schedule` (action='create') now destructures `notes` from the body, declares `$notes: String` in the GraphQL mutation, sets `notes: $notes` in the createAppointment input, and forwards `notes: notes || null` in the variables. GET handler already pulled `notes` from Healthie for blocks; now also includes `notes: appt.notes || ''` in the per-patient result row so downstream renderers can read it. The approval-request path was already wired end-to-end (`/schedule/request` → `appointment_requests.notes` → `/schedule/request/decide` passes `req.notes` to Healthie). **Frontend** (`public/ipad/app.js`): added an `addSchedNotes` textarea to the Add-to-Schedule modal (between Location and Submit); `submitAddToSchedule()` reads it and forwards `notes` on both the direct-create payload and the block-conflict request payload. Two cached-data shapers (`healthieAppointments` map at ~L1196 and `scheduleAllData` map at ~L17134) now carry `notes` (and `contact_type` on the second, which was also missing) so cached renders aren't notes-blind. Render: 📝 note pill appears on all three schedule views — split (tight, ellipsis with title tooltip), single-provider (purple-tinted pill under the type/time line), and list (full-width purple pill below the meta line). `sanitize()` used on every render. **Edit-appointment modal already had notes (`eaNotes`)** — no change needed. Verified: `npx tsc --noEmit` shows 0 new errors in the touched file; pre-deploy gate ✅ 5 pass / 3 warn / 0 fail (warns are baseline TS-error count, untracked WIP from other sessions, and 79% disk — none caused by this change); `claude-coord debug` ✅ 27/27; deployed to prod via `pm2 restart gmh-dashboard` from master HEAD `97988a5` (merge of `663daef`); built `route.js` confirms `$notes:` is in the deployed mutation; built `app.js` carries 5 `addSchedNotes` refs (modal + read + send paths + mobile sync via `app.86db2dee.js`). Health check 4/0/4 unchanged from pre-deploy baseline (billing holds, disk, restart counts, peptide zero-stock — all pre-existing business KPIs). **master committed locally + deployed but NOT pushed to origin** (no-master-push rule).

- **Sam Breyer name+DOB dedup (claude-task-1401249c)**: Project-launch from dispatch row `20260520-111401-249c` ("Merge patients with identical names and date of births"). Strict name+DOB scan across all 510 patients returned exactly one pair: Sam Breyer (DOB 1995-09-19). KEEPER = `7313f334-fd41-4670-933e-cbaeb694aef5` (Healthie 12744648, `sbreyer95@gmail.com`, NowMensHealth.Care, last sign-in 2026-04-15, has_created_password=true). DUP = `52221564-dc08-4ef6-b685-1b4c410bab5e` (legacy "Approved Disc / Pro-Bono PT" chart; Healthie 12183157 **already purged from Healthie** — `user(id)` returns null, not searchable by email or name). DUP held the TRT history because dispenses were recorded on the old chart before B was created on 2026-04-16. Single-transaction merge via `.tmp/name-dob-dedup/09-merge.js --execute`: re-homed 2 dispenses (with `corrected_from_patient_id=A`, Keira pattern), 2 dea_transactions, 1 staged_dose (both `patient_id` + `dispensed_to_patient_id`), 51 ghl_sync_history. Deleted A's regenerable caches (1 labs row, 1 patient_signals_cache row — both have UNIQUE(patient_id)) and stale `healthie_clients` junction for 12183157. Archived A row into `patients_archived` with `merged_into_patient_id=B`. Audit row in `agent_action_log`. Post-verify: 0 stragglers across all 40 inbound FK constraints; B footprint = 2 dispenses + 89 ghl_sync_history (38 native + 51 inherited) + all expected children; **0 strict name+DOB duplicates remain in `patients`**. Backup at `.tmp/name-dob-dedup/backup-latest.json`; reversal at `.tmp/name-dob-dedup/10-reversal.js --execute` (dry-tested).

## Recent Session Output — 2026-05-20

- **Patient-data dedup fixes — Keira/Greg Gannon split + 3 data-quality fixes (claude-dedup session)**: Executed the Phil-approved dedup batch. **(1) Keira Gannon** was not a clean duplicate — a read-only FK sweep (before any write) showed Row A `471ea04b` was a *blend*: it carried **Greg's** TRT money (5 QuickBooks $140/mo receipts under QB cust 878="Greg Gannon", a "General TRT Telemedicine Appt" membership, 2 payment_issues), Greg's 2 testosterone dispenses + 2 DEA rows + Greg's DOB, **and** Keira's ClinicSync identity. claude17's overnight research had reported Row A as "payments 0" (true only for the Stripe `payment_transactions` table — it missed the QuickBooks/membership footprint), so I had to correct an earlier "unambiguous keeper" call to Phil before proceeding. Both rows were payment-bearing (the brief's STOP condition) and `labs`/`quickbooks_sales_receipts`/`memberships`/`payment_issues` all `ON DELETE CASCADE`, so a naive archive would have destroyed financial + lab records. Phil approved a **full per-record split**, executed as one transaction (new migration `20260520_patients_archived_and_dispense_correction.sql` — additive `patients_archived` table per SOT §7.3 + `dispenses.corrected_from_patient_id` per §7.6 — applied in-txn): Greg ← 2 dispenses (`corrected_from_patient_id=471ea04b`) + 2 DEA (with §7.6 corrective note, no new controlled-substance qty) + 5 QB receipts ($700) + qb_mapping + TRT membership + 2 payment_issues; keeper `fa75dcdd` ← ClinicSync membership/mapping + 59 ghl_sync rows + Healthie chart 12182730 (reparented, deactivated); Row A `labs` summary + `patient_signals_cache` deleted (UNIQUE(patient_id) collisions; regenerable, backed up); spouse rewired keeper↔Greg; Row A soft-archived. Dry-run validated, post-state verified (0 real orphans, ONE "Keira Gannon" row remains), full reversal script staged (`.tmp/dedup-keira-*.js`). **(2) Peptide-duplication bug** root cause = the duplicate "Keira Gannon" identity (`peptide_dispenses` links by name only); the merge collapses it to one identity (structural fix; no inventory math changed per brief + SOT 30 — Phil to re-test the sell flow on-device). **(3) Raul Martinez** clinic + **(4) Jackie Miller** gender were already corrected by a batch Healthie sync before my run (idempotent guard made no double-write; Jackie Male corroborated by lab 007026416 gender M / T-total 1870). **(5) Ryan Foster** staff_task #59 → completed (Phil confirmed resolved). Audit in `agent_action_log` category `patient_data_dedup`. Debug ✅ 27/27. Report: `~/.claude/coord/morning-report-dedup.md`. **Flagged for Phil:** deactivate/merge Healthie chart 12182730 on the Healthie side so the reconciliation cron doesn't re-create Row A. Migration committed to branch `claude/claude-dedup/...` (not pushed to master — left for Phil).

- **Healthie intake decoupling — data-driven self-serve forms, first slice (claude-task-2254f5ef)**: Dispatch row `20260520-182254-f5ef`. Goal: move patient documentation/intake OFF Healthie's native portal onto our own "Google-facing" web form + iPhone/iPad app, so a patient can completely set up an account on our surfaces. Phil's chosen model: **our forms feed Healthie** (capture in our Postgres as point-of-record, push to Healthie which stays the clinical record). First brand: **ABXTAC**. Built (reviewable, NOT deployed): (1) `migrations/20260520_intake_forms.sql` — `form_definitions` + `form_fields` (data-driven, reusable per brand) + `intake_submissions` (capture point of record) + seeded ABXTAC "Tactical Services Agreement" (9 fields mirroring `scripts/create-healthie-forms.ts` Form 5); (2) `lib/intakeForms.ts` — load/validate/provision: INSERT submission → find-or-create patient (dedup by email) → `createPatientInHealthie` (clientTypeKey `abxtac` → group 82534, triggers Healthie flow) → push answers via `createFormAnswerGroup` when the form is mapped; Healthie best-effort so a submission is never lost; (3) public API `app/api/intake/[brand]/[slug]/route.ts` (GET structure, POST submit, optional `INTAKE_TOKEN` gate); (4) Google-facing web form `app/intake/[brand]/[slug]/page.tsx` rendering the definition; (5) **repeatable playbook `docs/INTAKE_MIGRATION_PLAYBOOK.md`** with the per-brand rollout checklist for the remaining companies (Now Men's Health → Now Primary Care → Now Longevity, one at a time). New files typecheck clean. **NOT yet done:** ABXTAC Healthie `custom_module_form_id`/per-field `custom_module_id` mapping (Step 4) — until mapped, submissions land as `healthie_unmapped` (expected, not a bug); rate-limit/OTP/CAPTCHA before public launch; iPhone screen against the shared GET contract. Branch `claude/claude-task-2254f5ef/...` — left for Phil to review/merge/deploy.
- **↳ ABXTAC intake WIRED end-to-end (self-serve primary, Healthie silent) — 2026-05-26**: Per Phil's choice, the 8-form ABXTAC intake set is now wired so patients fill our self-serve form and answers post to the right Healthie chart, while Healthie itself emails nobody automatically. New script `scripts/wire-abxtac-intake.ts` (idempotent; template for the next brand): created the missing "ABX Tactical Services Agreement" form template in Healthie (id `3098004`, 9 questions), read each of the 8 forms' `custom_modules` from Healthie, and UPSERTed `form_definitions` + per-field `form_fields` in RDS with `healthie_custom_module_form_id` + per-field `healthie_custom_module_id` set so `submitIntake` → `createFormAnswerGroup` posts to the right module on the right form. Built an unattached "ABXTAC Intake" onboarding flow in Healthie (id 127754) for Healthie-side organization — *not* attached to group 82534 → Healthie sends no auto-comms (`createOnboardingItem` returned 500s so the flow is empty; non-blocking — staff can drop forms in via UI). Found legacy `scripts/create-healthie-forms.ts` is stale: Healthie's `createCustomModuleForm` input now uses `name:` (was `form_name`) and `createCustomModule` uses `sublabel:` (was `description`) — the new script uses the current schema. Re-ran dry-run pipeline test against the live wiring: **16/16 pass**, isolation holds, all 8 forms loaded + mapped, validation rules work against real Healthie mod_types. Per-form table in playbook §4c, code map updated. Next: deploy the branch (no customer impact, Healthie silent); build the multi-form patient UX (today each form is at `/ops/intake/abxtac/<slug>`); publish a GHL workflow that sends the intake link.
- **↳ Deep-dive safety pass + migration APPLIED (same session)**: Phil approved applying the migration *if proven safe*. Audited end-to-end (findings in playbook §4a): migration is **additive only** (3 new tables, no ALTER/DROP, idempotent — re-run inserts 0); verified live-DB deps (gen_random_uuid, patients UUID PK, single-col unique on healthie_clients.healthie_client_id for ON CONFLICT, status-audit trigger allows the active INSERT); **isolation proven** — `createPatientInHealthie` has only one other caller and the new `suppressWelcome` flag is additive-default so the existing patient-create flow is byte-for-byte unchanged, and only ABXTAC is seeded so every other brand 404s. **Healthie comms hardening:** intake now sets `suppressWelcome: true` by default (Healthie welcome/set-password email suppressed — OUR forms own comms; re-enable via `INTAKE_HEALTHIE_SEND_WELCOME=1`), and added a **dry-run mode** (`INTAKE_DRY_RUN=1` or body `{"dry_run":true}`) that validates+captures with zero patient/Healthie side effects. **Applied `migrations/20260520_intake_forms.sql` to RDS** (additive, verified idempotent). Ran `.tmp/test-intake-pipeline.ts` against live schema: **16/16 pass** (load, isolation, validation, dry-run with no patient created, capture, cleanup). **🚦 GATE before any real provisioning:** confirm/disable the auto-onboarding flow on Healthie group 82534 (Healthie-side config — even with suppressWelcome, a group auto-flow would email the customer). Live HTTP tests (5–8) await a deploy of the branch. Files: `lib/intakeForms.ts`, `lib/patientHealthieSync.ts` (+`suppressWelcome`), `app/api/intake/...`, playbook §4a/§4b. **Not deployed; not pushed to master.**
- **Healthie chats default to Hannah RN for Dr. Whitten's patients (claude-task-38010970)**: Dr. Whitten was being overloaded with patient messages. Root mechanism (verified via live Healthie API — all 20 of Whitten's patient chat threads are `owner=12093125`, `dietitian_id=12093125`): in Healthie a patient's *default chat contact* is their `dietitian_id`, and Healthie auto-creates the patient's first conversation owned by that dietitian. Fix (Option A, approved by Phil): `lib/patientHealthieSync.ts` `CLIENT_TYPE_HEALTHIE_MAP` now splits `providerId` (clinical/appointment+prescribing provider, unchanged = Whitten) from new `dietitianId` (default chat contact). For `nowmenshealth` + `abxtac` client types `dietitianId = Hannah Schafer RN (13815235)`; `createPatientInHealthie` sends `dietitian_id = config.dietitianId`. New men's-health/ABXTAC patients' chats now default to Hannah; Whitten stays the appointment provider (appointmentRouting keys off appointment TYPE, not dietitian_id) and patients still land in the men's-health GROUP. Hannah can add Whitten to any chat. **Existing patients untouched.** **Coverage caveat**: only patients created via dashboard intake (`POST /api/patients`) flow through this code; self-registered Healthie-portal signups need a Healthie-side group/registration default change (not code — flagged to Phil). Configurable via `HEALTHIE_MENS_HEALTH_CHAT_CONTACT_ID`. Crons unaffected (morning-prep + patient-reconciliation scope by *appointment* `provider_id`, not dietitian). Debug ✅ 27/27. Branch `claude/claude-task-38010970/...` commit `2583f66` — **NOT yet merged/deployed** (pre-deploy gate Check-1 `npm run build` fails in this worktree on a pre-existing/env issue: `ApolloProvider` import + abxtac/book SDK apiKey during page-data collection — no `.env.local` in worktree; both files last touched 8d/5mo ago, unrelated to this change). Awaiting Phil's go-ahead to merge→master + deploy from on-box main repo.

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
