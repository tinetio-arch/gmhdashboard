# CODE_ROUTER — topic-to-source-file lookup

**Purpose:** when Phil describes work in natural language, this maps the topic to the canonical source files + SOT module that own it. Read this FIRST in every pre-flight, then read the files for the topic at hand.

**Maintenance:** Phil or Claude adds rows as new areas come up. The truth is the source files — this file just points at them.

**Last refreshed:** 2026-05-28 (initial scan after Phil flagged "I don't have a good knowledge of the files and where they are at").

---

## Lookup table

| When Phil says… | Canonical source files | SOT module / memory |
|---|---|---|
| **peptide visibility · "not in app" · inventory · drafts** | `~/execution/sync_ypb_woocommerce.py` (truth source = YPB supplier API; auto-creates/publishes/drafts in WC every 6hr) · `~/execution/sync_ypb_availability.py` (Google Sheet → Postgres) · `~/gmhdashboard/app/api/headless/products/route.ts` (patient app fetch) · `~/gmhdashboard/lib/abxtac-woo.ts` · table `ypb_available_products` | `30-peptide-pipeline.md` + memory [peptide-pipeline-truth-source] |
| **peptide pricing · sell_price · charge patient vs ship** | `~/gmhdashboard/app/api/ipad/billing/products/route.ts` (charge patient; table `peptide_products.sell_price`) · `~/gmhdashboard/app/api/ipad/billing/woo-products/route.ts` (ship to patient; WooCommerce) · WooCommerce is CANON, peptide_products patched to match 2026-05-28 | memory [peptide-pipeline-truth-source] |
| **peptide channels · inhouse vs woo · education gate** | `~/gmhdashboard/lib/peptideQueries.ts` (createPeptideDispense, channel column) · `~/gmhdashboard/app/api/ipad/billing/charge/route.ts` (inhouse) · `~/gmhdashboard/app/api/ipad/billing/ship-order/route.ts` (woo) · `~/gmhdashboard/app/api/ipad/billing/send-consent/route.ts` (skips ship-to) | `30-peptide-pipeline.md` |
| **CEO revenue · dashboard · recurring vs one-time · Healthie billing** | `~/gmhdashboard/app/api/ipad/ceo/revenue-breakdown/route.ts` (uses Healthie billingItems + BillingItem.is_recurring) · `~/gmhdashboard/public/ipad/app.js` renderBreakdown function | memory [healthie-revenue-classification-truth] |
| **CEO drill-down (per-day charges)** | `~/gmhdashboard/app/api/ipad/ceo/drill-down/route.ts` · `~/gmhdashboard/app/api/ipad/ceo/resolve-charge/route.ts` | — |
| **iPad chart panel · vitals · patient metrics · allergies · meds** | `~/gmhdashboard/public/ipad/app.js` (renderChartPanel function ~line 6190; vitals dedup ~6320–6420) · `~/gmhdashboard/app/api/ipad/patient-chart/route.ts` (mergeVitals, etc.) · `~/gmhdashboard/lib/healthieChart.ts` · `~/gmhdashboard/app/api/ipad/vitals/route.ts` | `10-critical-code-patterns.md` |
| **iPad Healthie messages · staff inbox · privacy lockdown** | `~/gmhdashboard/app/api/ipad/messages/route.ts` (force-scoped to user.healthie_provider_id) · `~/gmhdashboard/app/api/ipad/messages/mark-read/route.ts` · `~/gmhdashboard/public/ipad/app.js` _pollGlobalMessagesOnce | `15-integration-endpoints.md` |
| **AI Edit (SOAP) · scribe editor · timeout** | `~/gmhdashboard/app/api/scribe/notes/[id]/edit-ai/route.ts` (maxDuration 90, Haiku 3.5 triage → Haiku 4.5 sections) · `~/gmhdashboard/public/ipad/app.js` aiEditNote function (_timeout 90000) | `10-critical-code-patterns.md` |
| **Scribe transcribe / generate / submit to Healthie** | `~/gmhdashboard/app/api/scribe/transcribe/route.ts` · `~/gmhdashboard/app/api/scribe/generate-note/route.ts` · `~/gmhdashboard/app/api/scribe/submit-to-healthie/route.ts` · `~/gmhdashboard/app/api/scribe/sessions/route.ts` | `02-critical-read-first.md` (Scribe SOP) |
| **TRT card · self-log · dispense math · next-due** | `~/gmhdashboard/lib/trtEligibility.ts` (computeDispenseEligibility) · `~/gmhdashboard/lib/patientStack.ts` (synthesizeTrtStackItem — NMH-only) · `~/gmhdashboard/app/api/patients/[id]/stack/[stackId]/log/route.ts` (virtual-trt: prefix routes to trt_injection_log) · table `trt_injection_log` | `22-brand-group-architecture.md` |
| **Patient app Stack / Vault (Expo)** | `~/.gemini/antigravity/scratch/nowoptimal-headless-app/mobile-app/src/components/StackSection.tsx` · `mobile-app/src/screens/PeptideEducationScreen.tsx` (Vault shop) · `mobile-app/src/lib/peptideShopBuckets.ts` (data-driven) · `mobile-app/src/constants/peptides.ts` (catalog metadata) · `mobile-app/__tests__/peptide-shop-runtime.test.js` (iron-clad) | `20-headless-mobile-app.md` + memory [peptide-vault-and-stack-architecture] |
| **Patient app deploy (Expo OTA · EAS build)** | `~/.gemini/.../mobile-app/app.json` (runtimeVersion 2.2.0) · `~/.gemini/.../mobile-app/eas.json` · `eas update --branch production` (OTA) · `eas build --platform android` (native) · master may drift from what's deployed | `20-headless-mobile-app.md` + memory [mobile-app-deploy-pitfalls] |
| **iPad/staff PWA serving · sync-mobile.sh** | `/etc/nginx/conf.d/nowoptimal.conf` (alias /ipad and /mobile) · `~/gmhdashboard/public/ipad/` (iPad) · `~/gmhdashboard/public/mobile/` (phone) · `~/gmhdashboard/scripts/sync-mobile.sh` (ONLY syncs app.js — style.css/index.html are separate per device) | memory [ipad-mobile-pwa-serving-and-sync-gap] |
| **Patient app: Ask AI / Ask Jarvis (clinical Q&A)** | `~/gmhdashboard/app/api/ipad/patient/[id]/ask/route.ts` (admin-locked Bedrock Claude with peptide protocols) · `~/gmhdashboard/lib/peptideProtocols.ts` (clinic handbook system prompt) · `~/gmhdashboard/lib/patientChart.ts` (chart context assembly) | `15-integration-endpoints.md` |
| **Intake forms · kiosk · onboarding** | `~/gmhdashboard/app/api/ipad/kiosk/submit/route.ts` · `~/gmhdashboard/app/api/ipad/kiosk/pin/route.ts` · `~/gmhdashboard/app/api/intake/[brand]/progress/route.ts` (resume-by-email) · `~/gmhdashboard/app/api/intake/[brand]/forms/route.ts` | `04-clinic-setup.md` + `22-brand-group-architecture.md` |
| **Labs · review queue · order approval · LabCorp/Access** | `~/gmhdashboard/app/api/labs/review-queue/route.ts` · `~/gmhdashboard/app/api/labs/orders/route.ts` · `~/gmhdashboard/app/api/labs/order/[id]/approve/route.ts` · `~/gmhdashboard/scripts/email-triage/access_labs_processor.py` (Access Medical Lab PDF email triage) · `~/gmhdashboard/app/api/webhooks/healthie/lab-order/route.ts` (Healthie webhook) | `08-alert-notification-system.md` |
| **Appointments · iPad chart appointments tab** | `~/gmhdashboard/app/api/ipad/schedule/route.ts` · `~/gmhdashboard/app/api/ipad/patient-chart/route.ts` (healthie_appointments) · `~/gmhdashboard/app/api/webhooks/healthie/appointment-updated/route.ts` · `~/gmhdashboard/lib/appointmentRouting.ts` | `15-integration-endpoints.md` |
| **Healthie GraphQL · schema · queries** | `~/gmhdashboard/lib/healthie.ts` (core client) · `~/gmhdashboard/lib/healthieApi.ts` (graphQL helper) · `~/gmhdashboard/lib/healthieChart.ts` · `~/gmhdashboard/lib/healthie/*.ts` (per-entity helpers) | `15-integration-endpoints.md` + `17-learning-resources.md` |
| **Healthie webhooks · payment dedup · billing-item / requested-payment events** | `~/gmhdashboard/scripts/process-healthie-webhooks.ts` (race-safe dedup via healthie_payment_alert_dedup table) · `~/gmhdashboard/app/api/webhooks/healthie/lab-order/route.ts` · `~/gmhdashboard/app/api/webhooks/healthie/patient-created/route.ts` | `08-alert-notification-system.md` |
| **GHL sync · contacts · custom fields · tags** | `~/gmhdashboard/app/api/cron/ghl-sync/route.ts` · `~/gmhdashboard/lib/ghl/*.ts` (sync helpers) · `~/gmhdashboard/app/api/webhooks/ghl/messages/route.ts` · table `ghl_sync_history` | `23-ghl-ai-agents.md` |
| **iPad ops staff tasks · inbox · agents panel** | `~/dispatch-mcp/scripts/sync_staff_tasks.py` (every 1 min) · `~/dispatch-mcp/scripts/sync_inbox_to_todoist.py` (every 2 min) · `~/.claude/coord/inbox/*.json` · table `staff_tasks` · `~/gmhdashboard/app/api/ipad/staff-tasks/route.ts` · `~/gmhdashboard/app/api/ipad/tasks/route.ts` | memory [cowork-rules-dispatch-aware] |
| **Coord agents (claude/claude1-7 sessions) · registry · self-heal** | `~/dispatch-mcp/tools/projects.py` (start/status/list/checkout) · `~/dispatch-mcp/scripts/idle-reaper.py` · `~/dispatch-mcp/scripts/flip-live-in-progress.py` · `~/dispatch-mcp/scripts/reconcile-board.py` · `~/.claude/coord/registry.json` | memory [project-reactive-agents-system] |
| **Pre-deploy gate · health check · debug-all-systems** | `~/gmhdashboard/scripts/pre-deploy-check.sh` (exit 0 required before pm2 restart) · `~/gmhdashboard/scripts/health-check.sh` · `~/gmhdashboard/scripts/agents/debug-all-systems.sh` (28/30 tests) · `~/gmhdashboard/scripts/agents/debug-mobile.sh` | `09-operational-procedures.md` |
| **Telegram alerts · cron failures · payment alerts** | `~/scripts/cron-alert.sh` (wraps every cron, alerts on non-zero exit) · `~/gmhdashboard/scripts/process-healthie-webhooks.ts` (dedup for payment-received/failed) · `~/gmhdashboard/scripts/sync-healthie-failed-payments.ts` | `08-alert-notification-system.md` + memory [patient-comms-and-cron-alerts] |
| **Stripe direct iPad billing · payment_transactions** | `~/gmhdashboard/app/api/ipad/billing/charge/route.ts` (direct Stripe; stripe_account='direct') · `~/gmhdashboard/app/api/ipad/billing/recovery/route.ts` (declined recovery) · `~/gmhdashboard/app/api/ipad/billing/refund/route.ts` · table `payment_transactions` | `15-integration-endpoints.md` |
| **Snowflake sync · analytics · 6hr lag** | `~/scripts/sync-all-to-snowflake.py` (every 4hr) · `~/gmhdashboard/scripts/cache-healthie-revenue.ts` (Snowflake cache, every 30min) · `~/gmhdashboard/app/api/analytics/summary/route.ts` · Snowflake `GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS` (LAGGY — don't use for real-time) | `15-integration-endpoints.md` |
| **WooCommerce ABXTAC · WC products · 3D vials** | `https://abxtac.com` (WordPress + WooCommerce) · `~/gmhdashboard/lib/abxtac-woo.ts` (REST API helpers) · `~/gmhdashboard/scripts/generate-3d-vials.py` (mockup images) · WP-CLI via `cd /var/www/abxtac && sudo -u apache wp wc product` | `21-websites-brand-system.md` |
| **4 websites · brand colors · ports** | `~/abxtac-website/` (Astro · 3009) · `~/nowoptimal-website/` (4001) · `~/nowmenshealth-website/` (4002) · `~/nowprimarycare-website/` (4003) · `/etc/nginx/conf.d/nowoptimal.conf` | `21-websites-brand-system.md` |
| **Patient comms · push notifications · SMS · email gateway** | `~/gmhdashboard/lib/comms-gateway.ts` (single send fn) · `~/gmhdashboard/lib/comms-ledger.ts` (audit) · `~/gmhdashboard/lib/comms-profile.ts` (per-patient prefs) · `~/gmhdashboard/app/api/headless/push-tokens/register/route.ts` | memory [patient-comms-overhaul-direction] + [patient-comms-and-cron-alerts] |
| **Pre-flight rule · SOT modules · CLAUDE_MEMORY_PINS** | `~/gmhdashboard/docs/sot-modules/INDEX.md` (decision tree) · `~/gmhdashboard/docs/CLAUDE_MEMORY_PINS.md` · `~/gmhdashboard/docs/DEPENDENCIES.md` (cross-system) · `~/gmhdashboard/docs/CODE_ROUTER.md` (this file) | memory [sot-module-index-and-pre-flight] |
| **Healthie BillingItem field semantics (recipient/sender/note/state)** | Schema introspection in `~/gmhdashboard/app/api/ipad/ceo/revenue-breakdown/route.ts` (comments document it). Key facts: `BillingItem.sender` = patient (sends money); `BillingItem.recipient` = clinic (receives money); `BillingItem.note` = staff invoice comment ("sick visit", "PT 141 blend"); auto-generated notes are "Invoice for Package …" / "Failed Recurring Payment …" — filter those out for display; `state` = succeeded/failed/scheduled (filter to 'succeeded' for revenue); created_at is space-separated "YYYY-MM-DD HH:MM:SS ±HHMM" (NOT ISO 8601 — must normalize for Safari). | memory [healthie-revenue-classification-truth] |

---

## How I use this (rule for myself)

Before any code recommendation:
1. Identify the topic from Phil's message.
2. Find the matching row in the table (`grep CODE_ROUTER.md` for the keyword).
3. Read the canonical source files for that row.
4. If the relevant SOT module is listed, read it too.
5. Now answer — with file path + line numbers, not from memory.

If the topic isn't in the table: read first, then add a row.

## Maintenance — adding a row

Each row should be:
- **Topic keywords** Phil might use (3–6 short phrases).
- **Canonical files** in priority order (truth source first, fetchers second).
- **SOT module / memory** if one documents the area.

Keep rows short. Link out, don't summarize the file's behavior here.

## Auto-add rules — when Claude MUST add a row (Phil 2026-05-28)

Phil 2026-05-28: "I think you should automatically add rows, and have rules for how you decide when you should make a row."

**ADD a row BEFORE answering when ANY of these triggers fires:**

1. **Zero-match trigger.** `grep -i <topic>` against this file returns no hits AND the question is about a system area (route, lib file, table, cron, integration). The topic isn't in the map yet → add it.
2. **New file discovered.** While investigating something, I find a canonical truth-source file (1+ table, route, or script) that isn't named in any existing row. Future-me will need to find it → add a row pointing at it.
3. **Schema/semantics learning.** Field semantics on an external API, an undocumented gotcha, a non-obvious naming convention (like `BillingItem.recipient` = clinic / `BillingItem.sender` = patient). Save as a memory + add a CODE_ROUTER row that links to that memory.
4. **Bug Phil flagged.** If Phil reports a bug in an area not yet in the router, the post-fix step is "add a row" so the bug investigation path is preserved for next time.

**SKIP if any of these is true:**

1. **Already-covered topic.** A grep on this file already returns a row whose canonical files would have led to the right answer.
2. **Incidental code touch.** I'm reading a file purely to understand context for an unrelated change; no canonical truth-source is being established.
3. **One-off / throwaway.** A migration script, a one-time data fix, a scratch query — no recurring system to point at.
4. **The topic is too specific.** "How does function X work" is not a routable topic; "X's containing area" might be.

**Auto-update workflow:**

1. Identify canonical files (1–3 truth-source files first, 1–2 fetchers/helpers after).
2. Identify SOT module (`~/gmhdashboard/docs/sot-modules/`) and/or Cowork memory if applicable.
3. Add row to this file in the table above. Keep it terse.
4. Commit to `~/gmhdashboard` master with message: `docs(router): add row for <topic> (auto-add by Claude)`.
5. Now answer the original question.

**Periodic review:** Phil can audit accumulated rows weekly. If a row is wrong or stale, prune it. If a row's keywords are too narrow and we keep grep-missing it, broaden them.
