# NOW Optimal — Master Project Tracker v2

> **Last Updated**: April 6, 2026 — Deep System Audit
> **Rule**: Every Claude Code session must update this file after completing work.

---

## PROJECT 1: GMH Dashboard (Operations Hub)
**URL**: https://nowoptimal.com/ops/
**PM2**: gmh-dashboard (port 3011) | **Restarts**: 275 | **Status**: ONLINE but UNSTABLE
**Tech**: Next.js 14 + Postgres + Healthie + Snowflake + GHL

### Dashboard Pages (30 routes)
patients, labs, scribe, faxes, supplies, peptides, finance-audit, inventory, transactions, dea, pharmacy (5 sub-pages), provider/signatures, admin (users, shipments, app-control), executive-dashboard, business-intelligence, analytics, system-health, code (Command Center), patient-hub, ops-center, menshealth

### API Routes (36 endpoints)
abxtac, admin, analytics, app-access, auth, checks, code (4 sub-routes), cron, debug, dispense-override, dispenses, export, faxes, finance-audit, headless (7 mobile APIs), healthie, heidi, integrations, inventory, ipad (14 kiosk APIs), jane-membership-revenue, jane-revenue, jarvis, labels, labs, patients, peptides, pharmacy, prescriptions, receipts, scribe, smart-dispense, specialty-orders, staged-doses, supplies, ups, webhooks

### Cron Jobs (18 scheduled)
Heartbeat (5min), Morning Report (8am), Infrastructure Monitor (8:30am), Snowflake Sync (4hr), QuickBooks Sync (3hr), Revenue Cache (6hr), Failed Payments (6hr), Webhook Processing (5min), Lab Fetch (30min), Lab Status Refresh (daily 5am), Peptide Sync (6hr), Website Monitor (5min), Stale Terminal Cleanup (1hr), Snowflake Freshness (2hr), Stale Process Cleanup (30min), Git Auto-backup (6hr), Prescription Sync (4hr), GHL Sync (2hr), YPB Availability Sync (2hr), Healthie ID Audit (6am)

### Critical Issues
| Issue | Severity | Status |
|---|---|---|
| 275 restarts (memory leak suspected) | CRITICAL | NOT FIXED |
| Disk 95% full | CRITICAL | NOT FIXED |
| QuickBooks integration failing | HIGH | NOT VERIFIED |
| Stripe disconnected | HIGH | KEYS EXIST — VERIFY |
| 50 unresolved payment issues | HIGH | NOT STARTED |

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

## PROJECT 9: AI Services

### AI Scribe (upload-receiver)
**PM2**: upload-receiver | **Status**: ONLINE (5 restarts, 25 days uptime)
- Audio upload → Telegram approval → Healthie document injection
- PDF generation for clinical notes
- Pharmacy search/favorites integration

### Telegram AI Bot v2
**PM2**: telegram-ai-bot-v2 | **Status**: ONLINE (1 restart)
- Patient data queries via Telegram
- Morning report delivery
- Alert notifications

### Jessica MCP Server
**PM2**: jessica-mcp | **Status**: ONLINE (0 restarts, 25 days uptime)
- Connects Snowflake, Healthie, GHL, Postgres, Gemini
- Used by Claude Code sessions for data access

### GHL AI Agents (Jessica & Max)
- Jessica: Patient-facing SMS chatbot for Men's Health
- Max: Patient-facing SMS chatbot (additional)
- Webhook server + SMS chatbot handler
- Knowledge base docs extensive (20+ config files)

### Email Triage
**PM2**: email-triage | **Status**: ONLINE (0 restarts)
- Email classification, Access Labs processing, fax PDF processing
- Lab review queue management, Google Chat posting

---

## PROJECT 10: Infrastructure Services

### Uptime Monitor
**PM2**: uptime-monitor | **Status**: ONLINE (0 restarts)
- Checks all 5 websites every 5 minutes

### GHL Webhooks
**PM2**: ghl-webhooks | **Status**: ONLINE (0 restarts)
- Receives GHL webhook events

### Fax Processor
**PM2**: fax-processor | **Status**: ONLINE (0 restarts)

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
