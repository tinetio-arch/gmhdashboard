# GMH Dashboard — AntiGravity Source of Truth

**Last Updated**: February 26, 2026  
**Primary AI Assistant**: AntiGravity (Google Deepmind Agentic Coding)  
**Sprint Period**: December 25, 2025 - February 26, 2026


> **Purpose**: This is the MASTER reference document for all AI assistants working on the GMH Dashboard system. When in doubt, refer to this file first. All critical system information, recent changes, and operational procedures are documented here.

## 📑 TABLE OF CONTENTS (AI Agent Quick-Lookup)

> **How to use**: Read this TOC first. Then load **only** the sections relevant to your task using line ranges below. Do NOT read the full 3,000+ line document unless doing a comprehensive audit.

| # | Section | Lines | When to Read |
|---|---------|-------|-------------|
| 1 | [Quick Orientation](#-quick-orientation) | 39–68 | **ALWAYS** — system overview, admin access, critical facts |
| 2 | [Critical – Read First](#-critical---read-first) | 69–114 | **ALWAYS** — patient workflows, SOPs, lab/scribe systems, emergency contacts |
| 3 | [PM2 Service Rules](#%EF%B8%8F-pm2-service-critical-rules) | 115–180 | When managing PM2 services, ports, or crash loops |
| 4 | [Clinic Setup](#-clinic-setup-deep-dive-jan-2026) | 181–215 | When working with clinic locations, providers, or intake flows |
| 5 | [System Architecture](#-system-architecture) | 216–345 | When working with file paths, URLs, directory structure, PM2 service registry |
| 6 | [Recent Changes (Feb 2026)](#-recent-major-changes-dec-25-2025---feb-25-2026) | 346–1433 | When understanding recent features, bug fixes, or system changes |
| 7 | [Previous Changes (Dec 2025)](#-previous-major-changes-dec-25-30-2025) | 1405–2103 | When understanding foundational features or GHL/Scribe/Email systems |
| 8 | [Alert & Notification System](#-alert--notification-system) | 2104–2322 | When working with email triage, lab monitoring, health checks |
| 9 | [Operational Procedures](#-operational-procedures) | 2323–2506 | When deploying, configuring Nginx, managing PM2, or changing env vars |
| 10 | [Critical Code Patterns](#-critical-code-patterns) | 2507–2685 | When writing code — base path, hydration, formatting patterns |
| 11 | [Troubleshooting](#-troubleshooting) | 2686–2860 | When debugging dashboard, OAuth, redirects, disk, scribe, or Snowflake |
| 12 | [File Locations](#-reference-file-locations) | 2861–2906 | When looking for specific config, source, or script files |
| 13 | [Development Guidelines](#-development-guidelines) | 2907–2940 | When writing new code — style, commits, testing checklist |
| 14 | [Quick Commands](#-quick-commands-reference) | 2941–2996 | Copy-paste deployment, status, log, and cleanup commands |
| 15 | [Integration Endpoints](#-integration-endpoints) | 2997–3020 | Healthie, QuickBooks, Snowflake, Telegram API details |
| 16 | [Security Notes](#-security-notes) | 3021–3043 | Cookie security, OAuth, never-commit rules |
| 17 | [Learning Resources](#-learning-resources) | 3044–3094 | Next.js, Healthie, QuickBooks, Snowflake docs + API behavior notes |
| 18 | [Common Queries](#-appendix-common-queries) | 3095–3157 | SQL/GraphQL snippets for patient lookup, QB check, Snowflake queries |
| 19 | [Deprecated Systems](#%EF%B8%8F-deprecated--removed-systems) | 3158–3204 | ClinicSync removal history, Dec 28 emergency fixes |
| 20 | [Headless Mobile App](#-headless-mobile-app-nowoptimal-patient-app) | 3205–3309 | **When working on mobile app** — config IDs, Lambda actions, API gotchas, access control |
| 21 | [Websites & Brand System](#-now-optimal-websites--brand-system) | 3310–3431 | **When working on websites** — 4 sites, ports, brand colors, booking integration |
| 22 | [GHL AI Agents](#-ghl-ai-agents-jessica--max) | 3432–3523 | **When working on AI agents** — Jessica/Max, webhook actions, SMS chatbot, Jarvis |
| 23 | [System Access Credentials](#system-access-credentials-updated-feb-19-2026) | 3524–3548 | Login URLs and credential references |

---

## 📍 QUICK ORIENTATION

### What is This System?
**GMH Dashboard** is a Next.js 14 healthcare operations platform integrating:
- **Clinical**: Healthie EHR (patient records, appointments, billing)
- **Financial**: QuickBooks (payments, invoices, accounting)
- **Analytics**: Snowflake (data warehouse) + Metabase (BI dashboards)
- **Communications**: Telegram (ops notifications), GoHighLevel (patient comms)
- **AI Features**: Scribe (visit documentation), Telegram bot (data queries)

### Critical System Facts
- **Active Directory**: `/home/ec2-user/gmhdashboard` ✅ (NOT `/apps/gmh-dashboard`)
- **Production URL**: `https://nowoptimal.com/ops/`
- **Base Path**: `/ops` (all routes prefixed with this)
- **Running On**: AWS EC2, Amazon Linux, PM2 process manager
- **Disk**: 50GB EBS volume (currently 71% used, 15GB free)
- **Database**: Postgres (operational writes) + Snowflake (analytics reads)

### Who Works Here?
- **Providers**: Aaron Whitten (243 patients), Phil Schafer NP (27 patients)
- **Operations**: You (via AI assistants)
- **Domains**: nowoptimal.com, nowprimary.care, nowmenshealth.care

### Admin Access
- **Dashboard URL**: `https://nowoptimal.com/ops/`
- **Admin Email**: `admin@nowoptimal.com`
- **Admin Password**: (see `.env.local`)

---

## 🚨 CRITICAL - READ FIRST

### 📘 NEW: Patient Workflows (Source of Truth)
**For all clinical procedures and patient lifecycles, refer to:**
👉 **[PATIENT_WORKFLOWS.md](file:///home/ec2-user/gmhdashboard/docs/PATIENT_WORKFLOWS.md)**

Defines comprehensive workflows for:
- 🚹 **Men's Health** (TRT, Hormones)
- ⚖️ **Weight Loss** (GLP-1s)
- 🩺 **Primary Care** (Membership)

### 👮 Staff SOPs (Mandatory)
**For Front Desk & Medical Assistants:**
👉 **[STAFF_ONBOARDING_SOP.md](file:///home/ec2-user/gmhdashboard/docs/STAFF_ONBOARDING_SOP.md)**
*Critical checklist for: Photos, Forms, and Medical History completeness.*

### 🧪 Lab Management System (UPDATED Jan 28, 2026)
**For ordering labs, reviewing results, and patient management:**
👉 **[SOP-Lab-System.html](file:///home/ec2-user/gmhdashboard/public/menshealth/SOP-Lab-System.html)**
*Comprehensive lab ordering, print requisitions, delete orders, result review, and critical alerts.*

### 🎤 AI Scribe System (NEW Jan 2026)
**For providers using AI-assisted clinical documentation:**
👉 **[SOP-AI-Scribe.pdf](file:///home/ec2-user/gmhdashboard/public/menshealth/SOP-AI-Scribe.pdf)**
*Recording visits, Telegram approval workflow, document injection to Healthie.*

> [!IMPORTANT]
> **SOP DEPLOYMENT RULE**: All new Men's Health SOPs must be generated as PDFs and added to `https://nowoptimal.com/ops/menshealth/` (Directory: `/home/ec2-user/gmhdashboard/public/menshealth/`). Do NOT create web pages for SOPs.

---

### Before Making ANY Changes
1. **Check disk space**: `df -h /` (must have >2GB free)
2. **Verify you're in the right directory**: `pwd` → should be `/home/ec2-user/gmhdashboard`
3. **Check PM2 working directory**: `pm2 describe gmh-dashboard | grep cwd` → should be `/home/ec2-user/gmhdashboard`
4. **Review recent changes**: Read the "Recent Changes" section below
5. **Test locally first**: `npm run dev` before deploying to production

### Emergency Contacts
- **If system is down**: Check PM2 logs first: `pm2 logs gmh-dashboard --lines 50`
- **If disk is full**: See "Disk Space Maintenance" section
- **If OAuth broken**: See "QuickBooks OAuth" section
- **If Scribe failing**: Check `/tmp/scribe_*.log`

---

## ⚙️ PM2 SERVICE CRITICAL RULES

> [!CAUTION]
> **Failure to follow these rules caused 106,000+ restart loops on jessica-mcp (Feb 2026)**

### Python Services (MANDATORY)

1. **Document Python version requirements** in code comments and README
   - MCP package requires **Python 3.10+**
   - Check package compatibility: `pip show <package> | grep Requires-Python`

2. **Use the correct Python interpreter in ecosystem.config.js**
   ```javascript
   // WRONG - defaults to Python 3.9 which lacks many packages
   interpreter: 'python3'
   
   // CORRECT - explicit version with required packages
   interpreter: 'python3.11'
   ```

3. **Virtual environments for Python projects** (recommended)
   ```bash
   cd /path/to/project
   python3.11 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

4. **Always install dependencies before starting PM2**
   ```bash
   pip install -r requirements.txt  # BEFORE pm2 start
   ```

### Crash Loop Prevention

The system has automatic crash loop detection via `uptime-monitor`:
- **Detection**: Checks restart counts every 60 seconds
- **Threshold**: >50 restarts triggers alert, >100 triggers auto-stop
- **Alert**: Instant Telegram notification with error details
- **Auto-Stop**: Prevents CPU meltdown from infinite restart loops

**If a service is in crash loop:**
```bash
pm2 stop <service>      # Stop it immediately
pm2 logs <service>      # Check the error
pm2 reset <service>     # Reset restart counter after fixing
```

### Current PM2 Services

| Service | Interpreter | Port | Purpose |
|---------|-------------|------|---------|
| gmh-dashboard | node (npm) | 3011 | Next.js Admin Panel |
| telegram-ai-bot-v2 | npx tsx | - | AI Query Bot |
| jessica-mcp | python3.11 | 3002 | MCP Server for GHL |
| upload-receiver | node | 3001 | AI Scribe Audio Receiver |
| email-triage | python3 | - | Email Processing |
| fax-processor | python3 | - | Incoming Fax Processor |
| ghl-webhooks | node | 3003 | GoHighLevel Integration |
| nowprimary-website | node | 3004 | Primary Care Website |
| nowmenshealth-website | node | 3005 | Men's Health Website |
| nowoptimal-website | node | 3008 | NOW Optimal Parent Website |
| uptime-monitor | python3 | - | Real-time PM2/Website Monitoring |

---

## 🏥 CLINIC SETUP (DEEP DIVE JAN 2026)

### Locations
**1. NOW Primary Care** (ID: `13023235`)
- **Address**: 212 S Montezuma, Prescott, AZ 86303
- **Focus**: Primary Care, Sick Visits, Annual Physicals
- **Key Patient Types**: Membership (Elite/Premier), Urgent Care

**2. NOW Men's Health** (ID: `13029260`)
- **Address**: 215 N McCormick, Prescott, AZ 86301
- **Focus**: TRT, Hormone Optimization, Weight Loss
- **Key Patient Types**: Men's Health, EvexiPel, Weight Loss

### Key Providers
- **Phil Schafer NP** (ID: `12088269`): Works across **BOTH** locations (Men's Health, Primary Care, Weight Loss).
- **Dr. Aaron Whitten** (ID: `12093125`): Medical Director (Men's Health focus).

### Service Workflows
- **Men's Health**: `Initial Male Hormone Replacement Consult`, `EvexiPel Procedure`, `TRT Supply Refill`.
- **Primary Care**: `Annual Physical`, `Sick Visit`, `Elite/Premier Membership Consult`.
- **Weight Loss**: `Weight Loss Consult` (45m), `Weight Loss Injection`.

### Intake Flows (Source of Truth)
| Group Name | Group ID | Flow Assigned | Content |
| :--- | :--- | :--- | :--- |
| **NowMensHealth.Care** | `75522` | **Master Flow** | *Default* + Men's Intake + Policies |
| **Weight Loss** | `75976` | **Master Flow** | *Default* + Weight Loss Agmt + History |
| **NowPrimary.Care** | `75523` | **Default** | HIPAA, Consent, AI, Medical History |
| **Pelleting Client** | `75977` | **Default** | HIPAA, Consent, AI, Medical History |

> [!WARNING]
> **Pellet vs Injection Rule**: EvexiPel Pellets are **ONLY** done at Primary Care (Montezuma). Testosterone Injections are done at Men's Health (McCormick). **Do not send injection patients to Montezuma.**

---

## 📊 SYSTEM ARCHITECTURE

### Technology Stack
- **Frontend**: Next.js 14 (App Router), React 18, TypeScript
- **Backend**: Next.js API Routes, Postgres (via `lib/db.ts`)
- **Auth**: Session cookies (`gmh_session_v2`), HMAC signing
- **Deployment**: PM2 (`next start`), Nginx reverse proxy
- **AI**: AWS Bedrock (Claude), Deepgram (transcription)
- **Warehouse**: Snowflake (GMH_CLINIC database)

### Key URLs & Routes
- **Dashboard**: `https://nowoptimal.com/ops/` (requires login)
- **Login**: `https://nowoptimal.com/ops/login/`
- **QuickBooks OAuth**: `https://nowoptimal.com/ops/api/auth/quickbooks/`
- **API Base**: `https://nowoptimal.com/ops/api/...`

### Important Files & Directories
```
/home/ec2-user/gmhdashboard/          # Active dashboard (PRODUCTION)
├── app/                              # Next.js app router
│   ├── api/                          # API routes
│   │   ├── auth/quickbooks/          # QuickBooks OAuth (NEW Dec 28)
│   │   └── admin/quickbooks/         # QuickBooks admin endpoints
│   ├── components/                   # React components
│   ├── login/                        # Login page
│   └── page.tsx                      # Main dashboard
├── lib/                              # Utility libraries
│   ├── auth.ts                       # Authentication (gmh_session_v2)
│   ├── db.ts                         # Postgres connection pool
│   ├── basePath.ts                   # Base path helpers (CRITICAL)
│   ├── quickbooks.ts                 # QuickBooks API client
│   └── healthie.ts                   # Healthie GraphQL client
├── scripts/                          # Background jobs
│   ├── scribe/                       # AI Scribe system (NEW Dec 25-27)
│   │   ├── scribe_orchestrator.py    # Main workflow
│   │   ├── telegram_approver.py      # Telegram approval UI
│   │   ├── document_generators.py    # AI document generation
│   │   ├── prompts_config.yaml       # Prompt templates
│   │   └── upload_receiver.js        # PM2 service (port 3001)
│   ├── prescribing/                  # E-prescribing automation
│   └── sync-healthie-*.ts            # Healthie → Snowflake sync
├── .env.local                        # Environment variables (CRITICAL)
├── next.config.js                    # Next.js config (trailingSlash: true)
└── ANTIGRAVITY_SOURCE_OF_TRUTH.md    # This file

/home/ec2-user/ecosystem.config.js        # PM2 master config (ALL 11 services)

/home/ec2-user/scripts/               # Shared scripts (Snowflake sync, etc.)
/etc/nginx/conf.d/nowoptimal.conf     # Nginx configuration

/home/ec2-user/nowprimarycare-website/  # NOW Primary Care public website
├── app/                              # Next.js app router
│   ├── page.tsx                      # Home page
│   ├── about/page.tsx                # About clinic & provider
│   ├── services/page.tsx             # All 26 appointment types
│   ├── contact/page.tsx              # Contact form & location
│   └── book/page.tsx                 # Appointment booking
├── components/                       # React components (Header, Footer, etc.)
├── public/logo.png                   # NOW Primary Care logo
└── globals.css                       # Design system (navy #00205B, green #00A550)

/home/ec2-user/nowmenshealth-website/   # NOW Men's Health public website [NEW Jan 2026]
├── app/                               # Next.js 14 app router
│   ├── page.tsx                       # Home - hero, 4 service sections, CTAs
│   ├── services/testosterone/         # TRT service page
│   ├── services/sexual-health/        # ED & Sexual Health page
│   ├── services/weight-loss/          # Medical Weight Loss page
│   ├── services/iv-therapy/           # IV Hydration page
│   ├── low-t-checklist/               # Interactive Low-T symptom quiz
│   ├── book/page.tsx                  # Booking page with services
│   ├── contact/page.tsx               # Contact info & map
│   ├── sitemap.ts                     # Dynamic SEO sitemap
│   └── globals.css                    # Design system (black/white/gradient)
├── components/Header.tsx              # Nav with gradient CTA
├── components/Footer.tsx              # Contact, address, hours
├── public/robots.txt                  # SEO robots.txt
├── .env.local                         # Healthie config (Location 13029260)
└── Port: 3005                         # Nginx proxy to nowmenshealth.care
```

### PM2 Services

> [!CAUTION]
> **CRITICAL - PM2 MANAGEMENT RULES**
>
> 1. **ALL services MUST be defined in `/home/ec2-user/ecosystem.config.js`**
> 2. **NEVER start services with `pm2 start npm -- start`** - use `pm2 start ecosystem.config.js --only <service-name>`
> 3. **All services MUST have these settings to prevent CPU meltdown:**
>    - `max_restarts: 10` - Stop after 10 consecutive failures
>    - `restart_delay: 5000` - Wait 5 seconds between restarts
>    - `exp_backoff_restart_delay: 1000` - Exponential backoff
> 4. **After any PM2 changes, always run:** `pm2 save`
>
> **Incident**: On Jan 28, 2026, `nowprimary-website` and `nowmenshealth-website` reached **34,000+ restarts** because they were started ad-hoc without restart limits. Port conflicts caused infinite restart loops, burning CPU until fixed.

**Service Registry:**
| Service | Port | In Ecosystem | Description |
|---------|------|:------------:|-------------|
| gmh-dashboard | 3011 | ✅ | Ops Dashboard (nowoptimal.com/ops/) |
| upload-receiver | 3001 | ✅ | Scribe upload service |
| jessica-mcp | 3002 | ✅ | MCP server for Jessica AI |
| ghl-webhooks | 3003 | ✅ | GoHighLevel webhook handler |
| nowprimary-website | 3004 | ✅ | NOW Primary Care public site (nowprimary.care) |
| nowmenshealth-website | 3005 | ✅ | NOW Men's Health public site (nowmenshealth.care) |
| nowoptimal-website | 3008 | ✅ | NOW Optimal parent site (nowoptimal.com) |
| telegram-ai-bot-v2 | N/A | ✅ | Jarvis Telegram bot |
| email-triage | N/A | ✅ | Email classification service |
| fax-processor | N/A | ✅ | Incoming fax processor (S3 → Google Chat + Dashboard) |
| uptime-monitor | N/A | ✅ | PM2 service + website health monitoring |

**Essential PM2 Commands:**
```bash
# Start a service (CORRECT way)
pm2 start /home/ec2-user/ecosystem.config.js --only <service-name>

# Restart after code changes
pm2 restart <service-name>

# Check status
pm2 list

# View logs
pm2 logs <service-name> --lines 50

# ALWAYS save after changes
pm2 save
```

---

## 🔥 RECENT MAJOR CHANGES (DEC 25, 2025 - FEB 25, 2026)

### February 26, 2026: Apple AI Privacy Fix, Journal/Metrics Bug Fixes

**Apple App Store Rejection Fix (Guidelines 5.1.1(i) & 5.1.2(i))**:
- Added first-time AI consent dialog to `JarvisScreen.tsx` — discloses what data is sent to Google Gemini AI, requires explicit "I Agree" before Jarvis is usable
- Consent stored in `expo-secure-store` (one-time prompt)
- Updated `nowoptimal-website/app/privacy/page.tsx` Section 3: removed contradictory "not shared with external AI providers" wording, replaced with accurate Gemini disclosure
- Added Google (Gemini AI) to BAA list in Section 4
- Website rebuilt and redeployed via PM2

**Journal & Metrics Display Bug Fixes** (`JournalScreen.tsx`, `MetricsScreen.tsx`):
- Fixed "Invalid Date" — `safeParseDate()` handles Healthie date-only strings (`"2025-12-26"`) that iOS chokes on
- Fixed Blood Pressure: `13686` → `136/86 mmHg` (smart split based on digit count)
- Fixed Weight: `56` → `56 lbs (25.4 kg)` (dual units)
- Fixed Height: `5` → `5'0" (152.4 cm)` (detects feet vs inches, shows both)
- Fixed Sleep: `8.5` → `8.5 hours` (unit label added)
- Added smart `formatMetricValue()` dispatcher for all metric categories
- MetricsScreen cards now show secondary unit line (e.g., `86.2 kg` under Weight card)

### February 25, 2026: Peptide System Overhaul, Revenue Fix, Transaction Delete Fix

**Peptide Soft-Delete** (`lib/peptideQueries.ts`, `app/peptides/PeptideTable.tsx`):
- Added `active` boolean column to `peptide_products` table
- Replaced hard delete with toggle (deactivate/reactivate)
- Inactive peptides shown with reduced opacity and "Show Inactive" filter

**Healthie Patient Search for Peptide Dispenses** (`app/peptides/DispenseForm.tsx`):
- Replaced plain text patient name field with debounced Healthie patient search (same API as labs: `/ops/api/patients/search`)
- Auto-fills patient name and DOB on selection; DOB stored in new `patient_dob` column on `peptide_dispenses`
- DOB passed to label generation for accurate prescription labels

**Label Date Formatting** (`lib/pdf/labelGenerator.ts`):
- Added `formatDateMMDDYYYY()` helper — normalizes all dates (ISO, slash, dash) to MM-DD-YYYY
- Applied to `patientDob`, `dateDispensed`, and `expDate` on all labels

> [!IMPORTANT]
> **Critical Schema Gotcha — `patients` table column names**:
> - The raw `patients` table uses `dob` (DATE type) and `full_name` — NOT `date_of_birth` or `patient_name`
> - `date_of_birth` only exists on the VIEW `patient_data_entry_v` 
> - When JOINing to `patients`, always use `pt.dob` and `pt.full_name`
> - When using `dob` in COALESCE with a TEXT column, cast it: `pt.dob::text`
> - `sale_date` on `peptide_dispenses` is a plain DATE — do NOT apply `AT TIME ZONE` to it

**Revenue "Today" Card Fix** (`lib/peptideQueries.ts` → `fetchPeptideFinancials()`):
- Root cause: `CURRENT_DATE` is UTC; clinic is in MST (UTC-7). Afternoon dispenses showed as "tomorrow"
- Fix: Use `(NOW() AT TIME ZONE 'America/Phoenix')::date` for date boundaries
- `sale_date` is a DATE column — only apply timezone to `NOW()` and `created_at`, never to `sale_date` itself

**Transaction Delete Fix** (`lib/inventoryQueries.ts` → `deleteDispense()`):
- Root cause: `dispense_history` table has NOT NULL FK to `dispenses` with ON DELETE SET NULL → constraint violation
- Fix: Added `DELETE FROM dispense_history WHERE dispense_id = $1` before deleting the dispense

**Revenue Section Rename** (`app/analytics/components/PeptideFinancials.tsx`, `app/analytics/AnalyticsClient.tsx`):
- Renamed "Peptide Financials" → "Revenue" (💰)
- Moved from Overview tab to Revenue tab on CEO Dashboard

### February 24-25, 2026: DEA Improvements, Label Printing, Vial Deletion Bug Fix & Cleanup

> [!WARNING]
> **Gemini Flash Incident**: On Feb 24, Gemini Flash made changes without consulting or updating the SOT. It reverted the `TransactionsTable` column fix (#3 from Feb 18), dumped 18 debug scripts in the project root, and made direct database modifications without documentation. All issues were remediated on Feb 25.

**DEA Page Enhancements** (`app/dea/page.tsx`, `lib/deaQueries.ts`):
- Date range filtering (start/end date inputs) for DEA log
- Default limit increased from 200→500 dispenses
- `ChecksManager` component added for controlled substance check history
- CSV export now supports date-filtered downloads
- Date formatting switched to `formatDateUTC()`

**Label Printing** (`lib/pdf/labelGenerator.ts` [NEW], `lib/healthieUploadLabel.ts` [NEW]):
- PDF label generation for testosterone dispensing
- Print Label button added to Transactions table (per-row action)
- Upload label to Healthie patient chart support

**`deleteDispense()` Hardening** (`lib/inventoryQueries.ts`):
- Audit trail: records deletion event via `recordDispenseEvent()` BEFORE removing the dispense
- Overfill cap: restored volume capped at `LEAST(size_ml, ...)` to prevent vials exceeding max capacity
- Auto-reactivate: vials with 0 mL restored to 'Active' when volume is added back
- `staged_doses` FK: nullifies `dispense_dea_tx_id` and `vial_id` references before cascade delete

**Vial Deletion Bug (Phil Schafer)**: Investigation found that deleting transactions for Phil Schafer didn't correctly restore vial inventory. Gemini Flash manually restored 9.6 mL to V0367 and marked V0368 as 'Completed'. Also changed `dispense_history_dispense_id_fkey` from CASCADE to SET NULL so history survives dispense deletion.

**Cleanup (Feb 25)**: 18 debug scripts moved from project root to `.tmp/gemini-flash-feb24-debug/`. `TransactionsTable` "Total Volume" column reverted to `total_amount` (per Feb 18 Fix #3). `CLAUDE.md` and `GEMINI.md` updated with mandatory SOT review protocol.

---

### February 23, 2026: Monitoring Alert Cycling Fix & Cron Schedule Correction

**Problem 1 — Webhook Alert/Recovery Cycling**: The uptime monitor checked webhook health every 60s, but the webhook processor runs every 5 min. Between processing cycles, pending webhooks naturally queued up (>10), triggering WARNING → then processing cleared them → RECOVERY. This cycled 24/7 with misleading "Payment failure alerts may not be working!" text.

**Problem 2 — No Morning Report**: Cron schedule comments said "7am MST (2pm UTC)" and "8am MST (3pm UTC)" but the server's cron daemon runs in **MST** (not UTC). So `0 14 * * *` = **2pm MST** and `0 15 * * *` = **3pm MST**. Neither report ever ran in the morning.

| Fix | File | Change |
|-----|------|--------|
| Webhook threshold raised | `app/api/analytics/system-health/route.ts` L562 | `pending > 10` → `pending > 50` |
| 10-min grace period | `scripts/uptime_monitor.py` L27, L191-240 | Only alerts after 10 min of continuous degradation |
| Payment warning text | `scripts/uptime_monitor.py` L221 | "Payment alerts may not be working" only on actual `error` status |
| Recovery suppression | `scripts/uptime_monitor.py` L236 | No recovery message if alert was never sent (cleared during grace) |
| Morning Report cron | crontab | `0 14 * * *` → `0 8 * * *` (8:00 AM MST) |
| Infrastructure Monitor cron | crontab | `0 15 * * *` → `30 8 * * *` (8:30 AM MST) |

> [!IMPORTANT]
> **Cron runs in MST** on this server (`/etc/localtime` → `America/Phoenix`). Always use MST hours in cron expressions. Comments must say MST, not UTC.

---

### February 19, 2026: Supply PAR System (Multi-Location)

**New system** for tracking general clinic supplies with Periodic Automatic Replenishment (PAR) level alerts. **Completely separate from DEA controlled substance inventory** (`app/inventory/`).

> [!CAUTION]
> The Supply PAR system (`app/supplies/`, `supply_*` tables) is **NOT** for controlled substances. DEA-regulated vials use `app/inventory/`, `vials` table, and `app/dea/`. Never mix these systems.

**Locations**:
| Location ID | Name | Address | Seeded Data |
|-------------|------|---------|-------------|
| `primary_care` | NowPrimary.Care | 404 S. Montezuma, Prescott, AZ 86303 | 132 items from Jan 16 2026 inventory |
| `mens_health` | NowMensHealth.Care | 215 N. McCormick, Prescott, AZ 86301 | Empty (no data yet) |

**Database Tables**:
| Table | Purpose |
|-------|---------|
| `supply_locations` | Clinic locations (id, name, address) |
| `supply_items` | Master catalog (132 items, 10 categories) |
| `supply_counts` | Current qty per item+location (UNIQUE constraint) |
| `supply_count_history` | Audit trail — every count, usage, adjustment with optional Healthie patient association |

**Key Files**:
| File | Purpose |
|------|---------|
| `lib/supplyQueries.ts` | All queries: CRUD, bulk counts, patient-linked usage, history |
| `app/supplies/page.tsx` | Main dashboard (server component) |
| `app/supplies/SupplyTable.tsx` | Interactive table with location selector, Use/Count modals |
| `app/api/supplies/route.ts` | GET (list/filter by location) + POST (create item) |
| `app/api/supplies/[id]/route.ts` | PATCH (update PAR level, name, etc.) |
| `app/api/supplies/count/route.ts` | POST (bulk inventory count) |
| `app/api/supplies/use/route.ts` | POST (use supplies, link to Healthie patient visit) |
| `app/api/supplies/history/route.ts` | GET (audit trail) |
| `scripts/seed-supply-inventory.ts` | Seeds 132 items from Google Doc (NowPrimary.Care) |
| `migrations/20260219_supply_par.sql` | Schema migration |

**Features**: Location selector tabs, PAR level alerts (🟢 OK / 🟡 Low / 🔴 Reorder / ✕ Out), category filter pills (10 categories), Use Supplies modal with Healthie patient association, Record Count modal for bulk inventory counts, full audit trail.

**Navigation**: Under **Clinical ▼** → Supplies (along with Patients, Labs, Faxes, Peptides)

**Categories** (10): Blood Glucose, Cleaning/Office, IV Supplies, Kits, Meds/Supplements, Miscellaneous, Monofilament, Pelleting Supplies, Syringes/Needles, Tests

---

### February 23, 2026: Scribe System — Dual Upload, Patient Search & Name Fix

**Root Cause**: When provider clicked "Confirm & Send" during active scribe lock, Python scribe uploaded to Healthie AND TS bot processed the same callback after lock was released — creating **duplicate chart notes**. Additionally, `updateFormAnswerGroup` mutation included invalid `filler_id` field, causing resubmit failures.

| Bug | File | Fix |
|-----|------|-----|
| Dual upload race condition | `telegram-ai-bot-v2.ts` L3009 | Skip `confirm_send` if session already `SUBMITTED` |
| Duplicate upload safety net | `telegram-ai-bot-v2.ts` L3122 | 30-second timestamp protection on `confirm_final_send` |
| `filler_id` schema error | `telegram-ai-bot-v2.ts` L3207 | Removed invalid field from `updateFormAnswerGroup` |
| Chart note update fallback | `telegram-ai-bot-v2.ts` L3256 | Falls back to create if update fails (e.g. deleted in Healthie) |
| Duplicate patient search | `telegram_approver.py` L466 | `PATIENT_360_VIEW` filtered to `STATUS = 'ACTIVE'` + `ROW_NUMBER()` dedup |
| Wrong name in SOAP after change | `telegram_approver.py` L694, L1027 | Auto-replace old patient name in SOAP note when patient is changed |

> **Key Learning**: The Python scribe (`telegram_approver.py` + `scribe_orchestrator.py`) and TS bot (`telegram-ai-bot-v2.ts`) both handle callbacks. When scribe lock is released mid-callback, TS bot re-processes the same action. Always check session status before acting.

### February 19, 2026: Home Directory Reorganization

**Moved 220+ loose files from root home directory into organized structure.** Nothing deleted — all preserved in `archive/`.

| Category | Destination |
|---|---|
| 72 documentation files | `docs/` (architecture, integrations, audits, plans, setup, incidents) |
| 72 loose scripts (.js/.py/.ts/.sh) | `archive/loose-scripts/` |
| 12 log files | `archive/loose-logs/` |
| 18 data exports | `archive/loose-data/` |
| Build artifacts, stale configs | `archive/build-artifacts/`, `archive/configs/` |
| Stale dashboard copies (gmhdashboard-1, apps/gmh-dashboard) | `archive/` |
| Root app/, lib/, components/ dirs | `archive/` |

**New directory structure**:
- `docs/` — All documentation organized by topic + `SOURCE_OF_TRUTH.md` symlink
- `directives/` — 3-layer architecture SOPs
- `execution/` — 3-layer architecture Python scripts
- `archive/` — Everything old (recoverable)

**3-Layer Architecture** added per `AGENTS.md`:
- Directives (SOPs) in `directives/`
- Execution scripts in `execution/`
- AI orchestrates between them

---

### February 17, 2026: Recurring Payment Hold Loop Fix

**Problem**: Patients who had already paid were being repeatedly put on "Hold - Payment Research" then reactivated, creating a hold-reactivate-hold loop.

**Root Cause**: `sync-healthie-failed-payments.ts` was matching old failed billing items that had already been resolved, without checking for more recent successful payments.

**Fix**: Implemented deduplication in `sync-healthie-failed-payments.ts` — before setting a hold, the system now checks if the patient has a more recent successful payment. If so, the hold is skipped.

---

### February 16, 2026: Unified Python Snowflake Sync

**Replaced 4 broken Node.js sync scripts with a single Python script**: `scripts/sync-all-to-snowflake.py`

| Old (broken) | New (working) |
|---|---|
| `sync-healthie-ops.js` | `sync-all-to-snowflake.py` |
| `sync-healthie-billing-items.ts` | (included in unified sync) |
| `sync-healthie-invoices.ts` | (included in unified sync) |
| `scripts/scribe/healthie_snowflake_sync.py` | (included in unified sync) |

**Also added**:
- `cron-alert.sh` — wrapper for all cron jobs that sends Telegram alert on failure
- `website-monitor.sh` — checks all websites every 5 min
- `kill-stale-terminals.sh` — cleans up hung terminal sessions
- `snowflake-freshness-check.py` — alerts if any Snowflake table is older than expected
- `cache-healthie-revenue.py` — Python replacement of the TS revenue cache script

---

### February 15, 2026: Fax System — Active Patients Only

**Problem**: Archived patients were appearing in fax patient search results.

**Fix**: Modified patient search in fax system to filter out archived Healthie patients, ensuring only active patients appear when attributing faxes.

---

### February 13, 2026: Scribe Session Persistence Fix

**Problem**: Scribe sessions were not being marked as ‘SUBMITTED’ after being sent to Healthie.

**Root Cause**: Two bugs in the `confirm_final_send` handler in `telegram-ai-bot-v2.ts`:
1. Invalid `filler_id` field in `createFormAnswerGroupInput` mutation
2. Premature `continue` statement on error, skipping the status update

**Fix**: Removed invalid field and fixed control flow so sessions are properly finalized.

---

### February 10-11, 2026: Scribe Patient Matching Safety

**Problem**: AI Scribe was auto-selecting incorrectly matched patients (e.g., Lauren Vanegas for Vaughn Larsen) because the `requires_manual_verification` flag was being ignored.

**Fix**:
1. `buildSessionKeyboard` no longer shows "Confirm & Send" if `requires_manual_verification` is true and patient hasn’t been manually assigned
2. `confirm_final_send` handler blocks upload to unverified patients

---

### February 2, 2026: Lab Approvals with Patient Verification

**Problem**: Low-confidence patient matches could result in lab results being assigned to the wrong patient.

**Fix**: Added a patient verification modal for low-confidence matches. Upon lab approval, system confirms patient details (name and DOB) and provides a manual selection option when confidence is below threshold.

**Comprehensive audit and 15-fix hardening of the controlled substance inventory, dispensing, and DEA compliance system.**

### February 18, 2026: Dispense Amount Bug Fixes (Split-Vial & Staged Doses)

**Three fixes for inflated dispense amounts and incorrect totals in the Transactions page.**

| # | Fix | File(s) |
|---|-----|---------|
| 1 | Split-vial handler now caps `doseCurrent` to actual vial remaining when vial has less than one dose+waste cycle | `app/inventory/TransactionForm.tsx` |
| 2 | Staged dose `use` API computes `totalDispensed = dose_ml × syringe_count` instead of using `total_ml` (which included waste) | `app/api/staged-doses/use/route.ts` |
| 3 | TransactionsTable "Total Volume" column now shows `total_amount` instead of duplicating `total_dispensed_ml` | `app/transactions/TransactionsTable.tsx` |


#### What Changed (Code — deployed)

| # | Fix | File(s) |
|---|-----|---------|
| 1 | `deleteDispense()` now caps restored volume at `size_ml` to prevent overfill | `lib/inventoryQueries.ts` |
| 2 | `createDispense()` uses `FOR UPDATE` on vial row to prevent race conditions | `lib/inventoryQueries.ts` |
| 3 | Stale staged doses (past `staged_for_date`) show amber ⚠️ STALE warning | `app/inventory/StagedDosesManager.tsx` |
| 4 | DEA export CSV route created — was previously 404 | `app/api/export/dea/route.ts` (NEW) |
| 5 | Zombie vials cleanup migration (Active but 0 remaining → Empty) | `migrations/20250211_cleanup_zombie_vials.sql` |
| 6 | `deleteDispense()` now records audit trail via `recordDispenseEvent()` | `lib/inventoryQueries.ts` |
| 7 | DB pool increased from 10→20 with idle/connection timeouts | `lib/db.ts` |
| 8 | DEA view optimization (deferred — view unchanged) | — |
| 9 | Patient name fallback requires unique match, no more `LIMIT 1` | `lib/inventoryQueries.ts` |
| 10 | Removed debug payment method display | `app/inventory/TransactionForm.tsx` |
| 11 | Expired vial warning on dispense form | `app/inventory/TransactionForm.tsx` |
| 12 | Provider signature queue limited to 200 rows | `lib/inventoryQueries.ts` |
| 13 | Morning check link uses `withBasePath()` | `app/inventory/TransactionForm.tsx` |
| 14 | `total_amount` column precision fix (12,2 → 12,3) | `migrations/20250211_fix_total_amount_precision.sql` |
| 15 | `WASTE_PER_SYRINGE` centralized in `lib/testosterone.ts` | `lib/testosterone.ts` |

#### Pending DB Migrations (run when connections free up)
```sql
-- 1. Fix total_amount precision (requires view drop/recreate)
-- See: migrations/20250211_fix_total_amount_precision.sql

-- 2. Clean up zombie vials
-- See: migrations/20250211_cleanup_zombie_vials.sql
```

---

### Testosterone Inventory & Controlled Substance System

**The inventory system tracks testosterone vials, dispenses, staged (prefilled) doses, DEA compliance records, and controlled substance checks.**

#### Database Tables

| Table | Purpose |
|-------|---------|
| `vials` | Testosterone inventory vials with lot numbers, expiration dates, remaining volume |
| `dispenses` | Individual dispense records (dose, waste, syringe count, signature status) |
| `dea_transactions` | DEA compliance records (drug name, schedule, quantity, patient info preserved) |
| `staged_doses` | Prefilled syringes staged for upcoming patient visits |
| `controlled_substance_checks` | Morning/EOD inventory counts and discrepancy tracking |
| `dispense_history` | Audit trail for create/sign/reopen/delete events |

#### SQL Views

| View | Purpose |
|------|---------|
| `dea_dispense_log_v` | Joins dispenses + dea_transactions + patients + vials for DEA reporting |
| `provider_signature_queue_v` | Unsigned dispenses awaiting provider signature |

#### Key Files

| File | Purpose |
|------|---------|
| `lib/inventoryQueries.ts` | All DB queries: `createDispense()`, `deleteDispense()`, `signDispense()`, `reopenDispense()`, `fetchInventory()`, `fetchTransactions()` |
| `lib/deaQueries.ts` | `fetchRecentDeaLog()` with optional date range filtering |
| `lib/testosterone.ts` | Shared constants: vendor names, DEA codes, `WASTE_PER_SYRINGE` |
| `lib/exporters.ts` | `exportDeaLogToS3()` for S3 export |
| `app/api/export/dea/route.ts` | GET endpoint for CSV download of DEA log |
| `app/inventory/TransactionForm.tsx` | Dispense form with patient search, split-vial logic, QBO payment gating |
| `app/inventory/StagedDosesManager.tsx` | Prefilled dose management with stale warnings |
| `app/dea/page.tsx` | DEA log page with date filtering and CSV export |
| `app/provider/signatures/page.tsx` | Provider signature queue |

#### Business Rules

- **Waste**: Fixed 0.1 mL per syringe (`WASTE_PER_SYRINGE` in `lib/testosterone.ts`)
- **Vendors**: Carrie Boyd (30 mL pre-filled syringes, Miglyol oil) and TopRx (10 mL vials, cottonseed oil)
- **Morning Check**: Required before dispensing; enforced in TransactionForm UI
- **Signature Flow**: Dispenses start as `awaiting_signature` → provider signs → `signed`; can be reopened
- **Split-Vial**: When a dose exceeds remaining vial volume, TransactionForm splits across two vials
- **DEA Records**: Preserved even after patient deletion (patient info denormalized into `dea_transactions`)
- **QBO Payment**: Patients with Quickbooks payment method require override approval before dispensing

### January 27, 2026: Fax Processing System (COMPLETE)

**Incoming fax automation with GMH Dashboard approval workflow**

#### Architecture
1. **AWS SES** receives emails at `fax@nowprimary.care`
2. **S3 bucket** `gmh-incoming-faxes-east1` stores raw emails
3. **fax-processor** PM2 service extracts PDFs, summarizes with Gemini AI
4. **Google Chat** receives smart-routed alerts (Clinical, Billing, etc.)
5. **GMH Dashboard** `/faxes` page for review and Healthie upload

#### Database Table
```sql
fax_queue - Incoming faxes with AI analysis and approval workflow
  - ai_summary, ai_fax_type, ai_patient_name, ai_urgency
  - healthie_patient_id, status, approved_at, healthie_document_id
```

#### Files
| File | Purpose |
|:-----|:--------|
| `scripts/email-triage/fax_s3_processor.py` | Monitors S3, extracts PDF, summarizes, posts to Chat |
| `app/faxes/page.tsx` | Fax review page (server component) |
| `app/faxes/FaxesDashboardClient.tsx` | Approval UI with patient search |
| `app/api/faxes/queue/route.ts` | API for approve/reject + Healthie upload |
| `app/api/faxes/pdf/[id]/route.ts` | Presigned PDF URLs |
| `app/api/faxes/patients/route.ts` | Search-as-you-type patient lookup from Snowflake |

#### Navigation
**Top-level link**: `Faxes` (after Labs)

#### DNS Required for nowprimary.care
| Type | Host | Value |
|------|------|-------|
| MX | fax | 10 inbound-smtp.us-east-1.amazonaws.com |
| TXT | fax | v=spf1 include:amazonses.com ~all |

> [!IMPORTANT]
> **S3 Bucket Regions for Fax System:**
> - `gmh-incoming-faxes-east1` (raw emails) → **us-east-1**
> - `gmh-clinical-data-lake` (processed PDFs) → **us-east-2**
> 
> The fax queue API (`app/api/faxes/queue/route.ts`) must use **us-east-2** for the S3 client when downloading PDFs for Healthie upload. Using the wrong region causes "Failed to download PDF" errors.

---

### February 2, 2026: Fax Upload to Healthie Fix

**Problem**: When approving faxes and uploading to patient charts, users received "Failed to download PDF" error.

**Root Cause**: The S3 client in `app/api/faxes/queue/route.ts` was configured for `us-east-1`, but the PDF bucket (`gmh-clinical-data-lake`) is in `us-east-2`.

**Fix Applied**:
```typescript
// BEFORE (broken):
const s3Client = new S3Client({ region: 'us-east-1' });

// AFTER (fixed):
const s3Client = new S3Client({ region: 'us-east-2' }); // Clinical bucket is in us-east-2
```

---

### January 27, 2026: Peptide Inventory System (COMPLETE)

**Peptide inventory tracking with Healthie integration**

#### Database Schema
| Table | Purpose | Records |
|:------|:--------|:-------:|
| `peptide_products` | 28 peptides with Healthie IDs | 28 |
| `peptide_orders` | Incoming shipments (PO numbers) | 105 |
| `peptide_dispenses` | Patient dispensing log | 367 |

#### Healthie Product IDs (29082-29109)
All 28 peptides are linked to Healthie products. Key examples:
- BPC-157 (10mg): `29084`
- Retatrutide (12 mg): `29095`
- Retatrutide (24 mg): `29096`

#### Inventory Math (Matches Excel)
```
Current Stock = Total Ordered - Total Dispensed
Dispensed counts only WHERE: status='Paid' AND education_complete=true
Re-Order Alert = IF(Stock <= reorder_point, 'Reorder', 'OK')
```

#### Dispense Workflow
1. **Patient purchases peptide via Healthie** → Webhook creates "Pending" dispense
2. **Inventory NOT deducted** (Pending dispenses don't count)
3. **Patient picks up** → Staff marks Paid + Education Complete
4. **Inventory deducted** → Stock decremented

#### Files
| File | Purpose |
|:-----|:--------|
| `lib/peptideQueries.ts` | Query functions with Excel formula logic |
| `app/peptides/page.tsx` | Main inventory page |
| `app/peptides/DispenseForm.tsx` | Dispense peptide to patient |
| `app/peptides/DispenseHistory.tsx` | Patient dispense log (inline editing) |
| `app/peptides/InStockList.tsx` | In-stock reference |
| `app/api/peptides/dispenses/route.ts` | Dispense CRUD API |

#### Navigation
**Top-level link**: `Peptides` (between Patients and Dispensing)

**Peptide Types**: AOD 9604, BPC-157, CJC 1295, Gonadorelin, HCG, PT 141, Retatrutide, Semax, Semorelin, TB500, Tesamorelin, various blends

---

### January 26, 2026: Jane EMR Products Imported to Healthie

**Product Import Complete**

Successfully imported **242 products** from Jane EMR CSV to Healthie.

| Metric | Value |
|:-------|:------|
| Products Imported | 242 |
| Healthie Product IDs | 29079-29320 |
| Failures | 0 |
| Rate Limit Issues | None |

**Script**: `scripts/import-products-to-healthie.ts`
- Uses 500ms delay between API calls
- Batch pause every 10 products
- All products set to `unlimited_quantity: true`
- Tax descriptions preserved for taxable items

**Product Categories**: Peptides, Tri-Mix, Skincare (Alastin, ZO, Anteage), Injectables (Botox, Juvederm, Restylane), Supplements, Medical services


---

### January 28, 2026 (PM): Snowflake Authentication Fix & Monitoring Overhaul

**Problem**: Fax patient search and other Snowflake-dependent features were silently failing due to MFA enforcement on `tinetio123` account.

**Root Cause**: On Jan 13, `JARVIS_SERVICE_ACCOUNT` was created with key-pair auth, but the fax patient search API (`/api/faxes/patients`) was never updated - it still used the old password-based auth.

**Why Monitoring Didn't Catch It**: CEO dashboard system health only checked cache file age, NOT actual Snowflake connectivity.

**Fixes Applied**:

| Fix | File | Change |
|-----|------|--------|
| Shared Snowflake client | `lib/snowflakeClient.ts` [NEW] | Key-pair auth using `JARVIS_SERVICE_ACCOUNT` |
| Fax patient search | `app/api/faxes/patients/route.ts` | Now uses shared client instead of password auth |
| Pharmacy patient search | `app/api/pharmacy/patients/route.ts` [NEW] | Uses Healthie GraphQL directly (fallback) |
| System health | `app/api/analytics/system-health/route.ts` | Added real Snowflake connectivity test |

**Snowflake Service Account Configuration**:
```
Account: KXWWLYZ-DZ83651
User: JARVIS_SERVICE_ACCOUNT
Auth: Key-pair (JWT)
Private Key: /home/ec2-user/.snowflake/rsa_key_new.p8
Role: JARVIS_BOT_ROLE
```

**Environment Variables** (add to `.env.local`):
```bash
SNOWFLAKE_SERVICE_USER=JARVIS_SERVICE_ACCOUNT
SNOWFLAKE_PRIVATE_KEY_PATH=/home/ec2-user/.snowflake/rsa_key_new.p8
```

> [!IMPORTANT]
> **For ALL new Snowflake integrations**: Use `lib/snowflakeClient.ts` with `executeSnowflakeQuery()`. DO NOT use password-based auth with `tinetio123` - it will fail due to MFA.

---

### January 28, 2026: Healthie Webhook 308 Redirect Fix + Scheduled Payment Handling

**Root Cause Found for Silent Payment Failure Handling**

**Problem 1: Webhooks Not Received**: All webhook requests returning HTTP 308 (Permanent Redirect). Next.js `trailingSlash: true` redirects `/webhook` → `/webhook/`, losing POST body.

**Fix Applied** (January 2026 - rewrite):
```nginx
location = /ops/api/healthie/webhook {
    rewrite ^(.*)$ $1/ last;
}
```

⚠️ **CRITICAL UPDATE - February 1, 2026**: The rewrite approach was still causing 502 errors. When Healthie sends webhooks, the rewrite results in Next.js returning 308, which Healthie follows but loses the POST body. 

**CORRECT Fix** (direct proxy_pass with trailing slash in URI):
```nginx
location = /ops/api/healthie/webhook {
    proxy_pass http://127.0.0.1:3011/ops/api/healthie/webhook/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Content-Type $content_type;
    proxy_set_header Content-Length $content_length;
}
```

**Problem 2: Scheduled Payment Events Ignored**: Kory Johnson's failure was a SCHEDULED PAYMENT (recurring subscription), which uses `scheduled_payment.*` events. Handler only processed `requested_payment.*` and `billing_item.*`.

**Fix Applied** (process-healthie-webhooks.ts):
- Added handler for `scheduled_payment.*`, `subscription`, and `recurring` events
- Matches patients by `healthie_client_id` OR `full_name`
- Triggers: Telegram alert, Google Spaces alert, SMS, status update to Hold

**Problem 3: .join() Error** (fixed Feb 1, 2026): `changed_fields` from Healthie is sometimes a string, not an array. Fixed with `Array.isArray()` check.

**Problem 4: No Failsafe for Dashboard Downtime** (fixed Feb 1, 2026): When dashboard is down, webhooks aren't received, and payment failures go undetected.

**Fix Applied** (Startup Payment Sync):
- `scripts/heartbeat-writer.ts` - Writes heartbeat every 5 min via cron
- `scripts/startup-payment-sync.ts` - Checks last heartbeat on startup
- `scripts/start-dashboard.sh` - PM2 wrapper that runs sync before starting
- If dashboard was down >1 hour, automatically runs payment sync + Telegram alert
- **Syncs last 7 days of data** to catch any missed failures during downtime

**What Gets Synced** (on extended downtime):
1. **requestedPayments** - One-time invoices with failed status
2. **billingItems(status: "failed")** - ALL recurring/subscription payment failures

| Component | File | Function |
|-----------|------|----------|
| Heartbeat Writer | `scripts/heartbeat-writer.ts` | Records uptime to `.heartbeat` |
| Startup Sync | `scripts/startup-payment-sync.ts` | Runs sync on extended downtime |
| PM2 Wrapper | `scripts/start-dashboard.sh` | Calls startup sync before `npm start` |

**Query for Failed Recurring Payments**:
```graphql
# IMPORTANT: billingItems uses "sender" for PATIENT (who pays), "recipient" for PROVIDER (who receives)
# This is REVERSED from requestedPayments where "recipient" = PATIENT
billingItems(status: "failed") {
  id state failure_reason stripe_error amount_paid
  is_recurring sender { id full_name email } created_at
}
```

**Cron Job**: `*/5 * * * * cd /home/ec2-user/gmhdashboard && npx tsx scripts/heartbeat-writer.ts`


**CEO Dashboard Enhancement**:
- Added `checkWebhookHealth()` to system-health API
- Alerts when no webhooks received in 24h+
- Displays webhook status card with pending/processed counts


---

### January 26, 2026: Healthie Webhook Fix, Lab Status Refresh & Payment Processing

**Healthie Webhook Integration - FIXED**

**Problems Found**:
1. Base64 padding in content-digest was being stripped (trailing `=`)
2. Signature verification used internal path (`/api/healthie/webhook/`) but Healthie signs with external path (`/ops/api/healthie/webhook/`)
3. `HEALTHIE_WEBHOOK_SECRET` wasn't in `.env.local`

**Fixes Applied**:
| Fix | File | Change |
|-----|------|--------|
| Base64 padding | `app/api/healthie/webhook/route.ts` | Changed `split('=')[1]` to `slice(1).join('=')` |
| Path prefix | `app/api/healthie/webhook/route.ts` | Added `/ops` base path to signature verification |
| Env var | `.env.local` | Added `HEALTHIE_WEBHOOK_SECRET` |

**Webhook URL**: `https://nowoptimal.com/ops/api/healthie/webhook/`
**Secret**: (see `.env.local` — `HEALTHIE_WEBHOOK_SECRET`)

---

**Lab Status Refresh System - NEW**

**Problem**: Lab status was stored as static text (e.g., "Due in 30 days") that was never recalculated, causing 46 patients to show stale data.

**Solution**: Created `scripts/refresh-lab-status.ts` that:
- Recalculates all `lab_status` values based on `next_lab_date` vs current date
- Sets "Overdue by X days", "Due in X days", or "Current (due in X days)"
- Runs daily via cron at 10pm MST (5am UTC)

**Script**: `npx tsx scripts/refresh-lab-status.ts`

---

**Unpaid Payments Processing - NEW**

**Script Created**: `scripts/process-unpaid-payments.ts`
- Queries Healthie for all payments with `status_filter: "not_yet_paid"`
- Matches with dashboard patients via `healthie_clients` table
- Updates matching patients to "Hold - Payment Research" status
- Adds timestamped note for audit trail

**Initial Run**: Updated 15 patients with outstanding Healthie payments.

---

**Patient ID Mapping Architecture** (corrected Feb 1, 2026):

| Table | Purpose | Status |
|-------|---------|--------|
| `healthie_clients` | **CANONICAL** - Links patient_id ↔ healthie_client_id | 326 linked (99%) |
| `patients.healthie_client_id` | **LEGACY** - Not actively used, migrated to healthie_clients | 16 records |

**Duplicate Prevention** (updated Feb 2, 2026):
- Patient creation API checks Healthie + GMH before creating
- **Searches by**: Email → Phone → Name (in order, all three checked)
- Returns HTTP 409 with `duplicateWarnings` if potential match found
- Use `forceCreate: true` to bypass (will auto-link to existing Healthie patient)
- **Email field added to Add Patient form** for better Healthie matching
- Implemented in: `app/api/patients/route.ts`, `lib/patientHealthieSync.ts`

> [!CAUTION]
> **Previous Bug (Feb 2, 2026)**: Name-based search was only used as "last resort" when email/phone failed.
> **Fix**: Now searches by name alongside email/phone, not just as fallback. Also searches by name 
> inside `findHealthiePatient()` before creating new Healthie patients.

---

**Cron Jobs (Updated Feb 19, 2026)**:

> [!NOTE]
> All jobs are wrapped in `cron-alert.sh` which sends a Telegram alert on failure.

```cron
# Heartbeat writer - Every 5 minutes
*/5 * * * * /home/ec2-user/scripts/cron-alert.sh "Heartbeat" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/heartbeat-writer.ts"

# Morning Telegram Report - 7am MST (2pm UTC)
0 14 * * * /home/ec2-user/scripts/cron-alert.sh "Morning Report" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/morning-telegram-report.ts"

# Infrastructure Monitoring - 9am MST (4pm UTC)
0 16 * * * /home/ec2-user/scripts/cron-alert.sh "Infrastructure Monitor" "/usr/bin/python3 /home/ec2-user/scripts/unified_monitor.py"

# === UNIFIED SNOWFLAKE SYNC (Python - replaces 4 broken Node.js scripts) ===
# Syncs: patients, invoices, payment_issues, dispenses, vials, memberships, qb_payments, prescriptions
# Runs every 4 hours - takes ~36 seconds
0 */4 * * * /home/ec2-user/scripts/cron-alert.sh "Snowflake Sync" "python3 -u /home/ec2-user/scripts/sync-all-to-snowflake.py"

# QuickBooks Sync - Every 3 hours
0 */3 * * * /home/ec2-user/scripts/cron-alert.sh "QuickBooks Sync" "/home/ec2-user/quickbooks-sync.sh"

# Healthie Revenue Cache - Every 6 hours at :40
40 */6 * * * /home/ec2-user/scripts/cron-alert.sh "Healthie Revenue Cache" "python3 /home/ec2-user/scripts/cache-healthie-revenue.py"

# Healthie Failed Payments Sync - Every 6 hours
0 */6 * * * /home/ec2-user/scripts/cron-alert.sh "Healthie Failed Payments" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/sync-healthie-failed-payments.ts"

# Process Healthie Webhooks (payment failures) - Every 5 minutes
*/5 * * * * /home/ec2-user/scripts/cron-alert.sh "Process Healthie Webhooks" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/process-healthie-webhooks.ts"

# Access Labs Auto-upload - Every 30 minutes
*/30 * * * * /home/ec2-user/scripts/cron-alert.sh "Lab Results Fetch" "cd /home/ec2-user/scripts/labs && python3 fetch_results.py --auto-upload"

# Refresh Lab Status - Daily at 10pm MST (5am UTC)
0 5 * * * /home/ec2-user/scripts/cron-alert.sh "Lab Status Refresh" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/refresh-lab-status.ts"

# Peptide Purchases Sync - Every 6 hours at :50
50 */6 * * * /home/ec2-user/scripts/cron-alert.sh "Peptide Sync" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/sync-peptide-purchases.ts"

# Website Monitor - Every 5 minutes
*/5 * * * * /home/ec2-user/scripts/website-monitor.sh >> /home/ec2-user/logs/website-monitor.log 2>&1

# Kill stale interactive terminal sessions - Every hour
0 * * * * /home/ec2-user/scripts/kill-stale-terminals.sh

# Snowflake Data Freshness Check - Every 2 hours at :10 (ALERTS when stale)
10 */2 * * * /home/ec2-user/scripts/cron-alert.sh "Snowflake Freshness" "python3 /home/ec2-user/scripts/snowflake-freshness-check.py"
```

---

### January 14, 2026 (Evening): Telegram Alert System Restoration

**Problem**: Infrastructure monitoring alerts (Costs, Uptime, Server Load) were not being sent to Telegram. The system was experiencing "silent failures" for 17+ days.

**Root Causes Identified**:
1. **No cron job** for `unified_monitor.py` (last run: Dec 28, 2025!)
2. **Snowflake MFA requirement** blocking password-based auth in monitoring scripts
3. **AWS billing API error** (GroupBy `Type: 'SERVICE'` should be `Type: 'DIMENSION'`)
4. **Duplicate errored PM2 processes** (IDs 25, 26 in errored state)

**Fixes Applied**:
| Fix | File | Change |
|-----|------|--------|
| Cron job added | `crontab` | `0 16 * * *` (9AM MST) runs `unified_monitor.py` |
| Snowflake auth | `scripts/telegram_monitor.py` | Switched to `JARVIS_SERVICE_ACCOUNT` with key-pair auth |
| AWS billing | `scripts/aws_monitor.py` | Changed `GroupBy Type` from `SERVICE` to `DIMENSION` |
| PM2 cleanup | PM2 | Deleted errored processes 25, 26; reset restart counts |

**Verification**: Ran `unified_monitor.py` manually - all checks passed, 3 Telegram alerts sent successfully.

---

### January 14, 2026 (PM): QuickBooks Dispense Restriction & Override System

**Purpose**: Block dispensing to QuickBooks patients (who need to migrate to Healthie billing) while allowing emergency overrides with billing notification.

**New Features**:
1. **Dispense Restriction**:
   - Patients with "QuickBooks" payment method show red warning on Transactions page
   - Dispense is blocked until migrated to Healthie EMR or override is used

2. **Last Payment Display**:
   - Shows most recent QBO sales receipt date and amount
   - Data from `quickbooks_sales_receipts` table (recurring payments)

3. **Override System**:
   - Staff can click "Request Override" with required reason
   - Sends notification to Billing team via Google Chat (`GOOGLE_CHAT_WEBHOOK_OPS_BILLING`)
   - Allows dispense to proceed after override

**Files Created/Modified**:
| File | Purpose |
|------|---------|
| `/app/api/patients/[id]/qbo-last-payment/route.ts` | [NEW] Fetch last sales receipt |
| `/app/api/dispense-override/route.ts` | [NEW] Send override notification |
| `/app/inventory/TransactionForm.tsx` | [MODIFIED] Override UI & logic |
| `/lib/patientQueries.ts` | [MODIFIED] Added `method_of_payment` to PatientOption |

**Staff SOP**: `docs/SOP-QuickBooks-Override.md`

**Database Tables Used**:
- `quickbooks_sales_receipts` - Recurring payment history (2,221 rows)
- `patient_data_entry_v` - Patient method of payment

---

### January 14, 2026: Proactive AI Scribe & Automation (Deep Dive Fix)

**Purpose**: Ensure Care Plans, Discharge Instructions, and Work/School notes are generated **proactively** or via simple prompts, rather than requiring manual creation.

**New Capabilities Enabled**:
1.  **Automated Care Plans**:
    - **Trigger**: Happens immediately after audio processing.
    - **Process**: Jarvis extracts goals/interventions -> Proposal shown in Telegram -> **Auto-created in Healthie upon approval**.
    - **No extra clicks**: If you approve the note, you approve the Care Plan.

2.  **Proactive Discharge Instructions**:
    - **Trigger**: Happens in background during note approval.
    - **Process**: Jarvis generates the PDF -> Prompts via Telegram: *"Discharge Instructions ready. Send to Portal? (Yes/Edit)"*.
    - **Improvement**: Removes the "Do you want to generate?" step. Now it's just "Review & Send".

3.  **School/Work Notes**:
    - **Process**: If audio mentions "excuse note" or "work", Jarvis auto-detects -> Prompts via Telegram.
    - **Manual Trigger**: You can also ask Jarvis in the Telegram thread: *"Generate school note for [Patient]"*.

**Debugging Checklist (If "Missing Note"):**
1.  **Check Telegram**: Did you receive the "Review Scribe Note" message?
2.  **Check Process**: `pm2 list` (ensure `upload-receiver` is online).
3.  **Check Logs**: `/home/ec2-user/.pm2/logs/upload-receiver-out.log`.

---

### January 13, 2026 (PM): Jarvis Gemini Migration & Snowflake Auth Overhaul

**Jarvis Telegram Bot - Migrated to Google Gemini**
- **Old**: AWS Bedrock Claude 3 Haiku
- **New**: Google Gemini 2.0 Flash via REST API
- **Why**: Cost savings, align with Vertex AI strategy
- **File**: `/home/ec2-user/gmhdashboard/scripts/telegram-ai-bot-v2.ts`
- **Change**: Added `callGemini()` helper, replaced 3 `InvokeModelCommand` calls

**Snowflake Authentication - Service Account Setup**
- **Old User**: `tinetio123` (blocked by MFA)
- **New User**: `JARVIS_SERVICE_ACCOUNT` (TYPE=SERVICE, key-pair auth)
- **Private Key**: `/home/ec2-user/.snowflake/rsa_key_new.p8`
- **Role**: `JARVIS_BOT_ROLE` with grants on `PATIENT_DATA` and `FINANCIAL_DATA` schemas
- **Sync Scripts Updated**:
  - `sync-healthie-billing-items.ts` - Now uses key-pair auth
  - `sync-healthie-invoices.ts` - Now uses key-pair auth

**Schema Name Fix**
- **Problem**: AI hallucinating `GMHCLINIC` instead of `GMH_CLINIC`
- **Solution**: Post-processing code fixes schema names after AI generates SQL
- **Lines 1060-1064** in telegram-ai-bot-v2.ts

**Cron Jobs Installed**
```cron
# Healthie Billing Items - Every 6 hours at :30
30 */6 * * * cd /home/ec2-user/gmhdashboard && HEALTHIE_API_KEY=... /usr/bin/npx tsx scripts/sync-healthie-billing-items.ts

# Healthie Invoices - Every 6 hours at :15
15 */6 * * * cd /home/ec2-user/gmhdashboard && HEALTHIE_API_KEY=... /usr/bin/npx tsx scripts/sync-healthie-invoices.ts
```

**⚠️ Snowflake Sync Status (Updated Feb 2026)**
All tables now synced by unified Python script `sync-all-to-snowflake.py` every 4 hours.

| Table | Source | Sync Status |
|-------|--------|-------------|
| PATIENTS | Postgres | ✅ Running (every 4h) |
| VIALS | Postgres | ✅ Running (every 4h) |
| DISPENSES | Postgres | ✅ Running (every 4h) |
| HEALTHIE_BILLING_ITEMS | Postgres | ✅ Running (every 4h) |
| HEALTHIE_INVOICES | Postgres | ✅ Running (every 4h) |
| QB_PAYMENTS | Postgres | ✅ Running (every 4h) |
| MEMBERSHIPS | Postgres | ✅ Running (every 4h) |
| PRESCRIPTIONS | Postgres | ✅ Running (every 4h) |

**Files Updated (Jan 13)**:
- `scripts/telegram-ai-bot-v2.ts` - Gemini migration + schema fix
- `scripts/sync-healthie-billing-items.ts` - Key-pair auth
- `scripts/sync-healthie-invoices.ts` - Key-pair auth

---

### January 13, 2026 (AM): Staged Doses Bug Fixes & DEA Compliance Hardening


**Critical Bug Fixed: V0129 Over-Count**
- **Issue**: V0129 showed 30ml (full) but had a 9.6ml staged dose deducted from it
- **Cause**: Early failed staged dose attempts and race conditions from rapid clicking
- **Fix**: Manually corrected V0129 to 20.4ml (30 - 9.6ml staged)
- **Prevention**: Transaction-based operations with proper COMMIT/ROLLBACK

**Patient Selector Modal for Generic Prefills**
- **Old behavior**: Used JavaScript `prompt()` which was confusing
- **New behavior**: Opens a modal with autocomplete patient search (same as Transactions page)
- **File changed**: `app/inventory/StagedDosesManager.tsx`

**Data Integrity Checks - Run This Query to Audit:**
```sql
-- Check for vials with staged doses that don't match remaining volume
SELECT v.external_id, v.remaining_volume_ml,
       sd.total_ml as staged_ml, sd.status
FROM staged_doses sd
JOIN vials v ON v.vial_id = sd.vial_id
WHERE sd.status = 'staged';

-- Count all Carrie Boyd vials
SELECT 
  COUNT(*) FILTER (WHERE remaining_volume_ml >= 29.9) as full_count,
  COUNT(*) FILTER (WHERE remaining_volume_ml > 0 AND remaining_volume_ml < 29.9) as partial_count,
  SUM(remaining_volume_ml) as total_ml
FROM vials WHERE dea_drug_name LIKE '%30%';
```

**Known Issues & Lessons Learned:**
1. **Rapid clicking creates duplicates**: Users clicking "Save Prefill" multiple times creates multiple staged doses
   - Solution: Add loading state to disable button after first click (already implemented)
2. **Database transactions are critical**: All inventory changes MUST be in a transaction
3. **PostgreSQL type inference**: Always use explicit casts (::uuid, ::numeric) for parameterized queries
4. **NULL vial_id in early attempts**: Some staged doses have NULL vial_id from before we added vial tracking
   - These are harmless (status='discarded') but show up in audits
5. **Morning check math**: System expects = (Full vials × 30ml) + partial vials - staged doses

**Inventory Reconciliation Formula:**
```
Physical vials in storage = System vial total - (staged doses in syringes)

Example:
- System shows: 35 full (1050ml) + V0129 (20.4ml) + V0165 (8ml) = 1078.4ml in vials
- Plus staged: 9.6ml in syringes
- Total controlled substance: 1088ml
```

**Files for DEA Compliance Audit:**
- `/home/ec2-user/gmhdashboard/docs/SOP-Inventory-Check.md` - Staff procedure
- `/home/ec2-user/gmhdashboard/docs/SOP-PreFilled-Doses.md` - Prefill procedure
- PDFs available at: `nowoptimal.com/ops/menshealth/`

---

### January 12, 2026: Pre-Filled (Staged) Doses System

**Purpose**: Allow staff to pre-fill syringes the night before for patients coming in the next day. This improves efficiency while maintaining DEA compliance and accurate inventory tracking.

**Database Table**: `staged_doses`
- Tracks all prefilled syringes with patient info, dose details, and status
- Links to `vials` table (which vial was used) and `dea_transactions` (audit trail)
- Status values: `staged` (waiting to be used), `dispensed` (given to patient), `discarded` (removed/wasted)

**API Endpoints**:
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/staged-doses` | GET | Fetch all staged doses |
| `/api/staged-doses` | POST | Create new prefilled dose (deducts inventory immediately) |
| `/api/staged-doses?id=` | DELETE | Remove prefill and restore medication to vial |
| `/api/staged-doses/use` | POST | Convert prefill to actual dispense (no double DEA entry) |

**UI Component**: `app/inventory/StagedDosesManager.tsx`
- Appears on both Inventory page (`/ops/inventory`) and Transactions page (`/ops/transactions`)
- Shows list of staged doses with "✓ Use This" and "Remove" buttons
- Form for creating new prefills (patient-specific or generic)

**Workflow**:
1. **Create Prefill** (night before):
   - Staff selects patient (or "Generic" for walk-ins)
   - Enters dose details: dose_ml, waste_ml, syringe_count
   - System IMMEDIATELY deducts medication from a vial
   - System creates DEA transaction marked as "STAGED PREFILL"
   - Prefill appears in staged doses list

2. **Use Prefill** (next day when patient arrives):
   - Staff physically hands prefilled syringes to patient
   - Clicks "✓ Use This" button on the staged dose
   - System creates dispense record for the patient
   - System updates existing DEA transaction (NO double entry)
   - Prefill disappears from list

3. **Remove Prefill** (if patient no-shows or prefill unused):
   - Staff clicks "Remove" button
   - System RESTORES medication to the original vial
   - System marks DEA transaction as "[VOIDED - Prefill removed]"
   - Inventory is fully restored

**DEA Compliance**:
- ✅ Medication is logged when prefilled (before physical dispense)
- ✅ Single DEA entry per transaction (no double-counting)
- ✅ Voids are documented with "[VOIDED]" note
- ✅ Full audit trail from prefill → dispense or prefill → discard

**Key Design Decisions**:
- Inventory deducted at PREFILL time (not dispense time) - ensures physical syringes match logged inventory
- DEA transaction created at prefill, updated at dispense - avoids duplicate entries
- Vial external ID stored in staged_doses for traceability
- All queries use explicit type casts (::uuid, ::numeric, etc.) to avoid PostgreSQL parameter inference issues

**Files Changed**:
- `app/api/staged-doses/route.ts` - GET/POST/DELETE for staged doses
- `app/api/staged-doses/use/route.ts` - POST to convert staged → dispensed
- `app/inventory/StagedDosesManager.tsx` - UI component
- `app/inventory/page.tsx` - Added StagedDosesManager
- `app/transactions/page.tsx` - Added StagedDosesManager
- `lib/inventoryQueries.ts` - Added COALESCE for recorded_by fallback
- `app/transactions/TransactionsTable.tsx` - Fixed to use total_dispensed_ml

**Morning Check Update**:
- Replaced "missed transactions" checkbox with a link to Transactions page
- Staff can now click "→ Enter Prior Day Transactions" to open transactions page in new tab
- More actionable than a simple checkbox

### January 7, 2026: Payment Status & Merge UI Fixes

**QuickBooks Payment Issue Auto-Status (FIX)**:
- **Problem**: 142 patients had unresolved payment_declined issues but still showed "Active" status
- **Root Cause**: Payment issues were being recorded in `payment_issues` table but patient status wasn't being updated
- **Solution**: Ran bulk update to set all patients with unresolved payment issues to "Hold - Payment Research"
- **Affected Table**: `patients` - updated `status_key` and `alert_status`

**Merge Patients Auto-Refresh (FIX)**:
- **Problem**: After merging duplicate patients, the UI didn't refresh and patients appeared to still exist
- **Root Cause**: `router.refresh()` in Next.js App Router only does a soft refresh
- **Solution**: Changed to `window.location.reload()` for full page reload after merge/resolve
- **Files Changed**: `app/admin/membership-audit/SimplifiedAuditClient.tsx`

**Note on Merged Patients**:
- Merged patients are NOT deleted (for audit trail)
- They're marked as `status_key = 'inactive'` and `alert_status = 'Inactive (Merged)'`
- Filter by status to exclude merged patients from views

### January 6, 2026: DEA Controlled Substance System Improvements

**DEA Log Reconciliation (CRITICAL FIX)**:
- **Problem**: System had 6.5 vials more than physical inventory, dispenses spread across multiple vials incorrectly
- **Root Cause**: Initial reconciliation used flawed logic that didn't drain vials completely before moving to next
- **Solution**: Rewrote reconciliation to use proper FIFO (First In, First Out) - each vial fully emptied before next
- **Result**: 
  - Carrie Boyd: 37 empty, 1 in-progress (6.8ml), 8 full = 36.8ml (1.23 vials)
  - TopRX: 56 empty, 24 full = 240ml correct

**Controlled Substance Inventory Checks (NEW FEATURE)**:
- **Purpose**: DEA compliance - staff must verify physical inventory twice daily
- **Database Table**: `controlled_substance_checks` (with `check_type` column: 'morning' or 'evening')
- **Library**: `lib/controlledSubstanceCheck.ts`
- **API Endpoint**: `/api/inventory/controlled-check`
- **UI Component**: `app/inventory/MorningCheckForm.tsx`
- **Check Types**:
  | Type | Required for Dispensing? | Purpose |
  |------|-------------------------|---------|
  | Morning | ✅ YES - Blocks dispensing | DEA compliance - verify inventory before opening |
  | EOD | ❌ NO - Optional | Audit trail - verify inventory at end of day |

**Timezone Handling (IMPORTANT)**:
- All date comparisons use **Mountain Time** (`America/Denver`), NOT UTC
- PostgreSQL queries use: `(NOW() AT TIME ZONE 'America/Denver')::DATE`
- This ensures EOD checks submitted after 5PM MST are recorded for TODAY, not tomorrow
- Morning check requirement is based on local Mountain Time date, not server UTC

**Discrepancy Threshold & Auto-Waste (NEW)**:
- **Threshold**: Only differences >2ml trigger a "discrepancy" requiring explanation
- **Auto-Waste**: Differences ≤2ml are auto-documented as "user waste" (needle dead-space, spillage)
- **Example**: If system shows 50.4ml but staff counts 49.1ml (1.3ml difference), system auto-records as waste

**Morning Telegram Report (NEW)**:
- **Script**: `scripts/morning-telegram-report.ts`
- **Cron Job**: `0 14 * * *` (7am MST = 2pm UTC)
- **Contents**:
  - System health status
  - Yesterday's morning + EOD check status
  - Current testosterone inventory levels
  - Last 24hr dispensing activity
  - Unsigned dispenses count
  - Action items (missed checks, low stock, etc.)

**Environment Variables Added**:
```bash
TELEGRAM_BOT_TOKEN=(see .env.local)
TELEGRAM_CHAT_ID=7540038135
```

**Telegram DEA Commands**:
| Command | Description |
|---------|-------------|
| `/dea` or `/inventory` or `/t` | Show current inventory status |
| `/check cb:1,6.8 tr:24` | Record morning check (1 CB full + 6.8ml partial, 24 TopRX) |
| `/dea-history` | View check history |

**Frontend/Backend Validation**:
- **Frontend**: Vial dropdown only shows vials with remaining > 0
- **Backend**: API rejects dispenses from 0ml vials
- **Morning Check Enforcement**: API blocks controlled substance dispensing until morning check completed
- **Error**: "Daily controlled substance audit not completed..."

**Staff Documentation**:
- Created: `docs/STAFF_DISPENSING_GUIDE.md`
- Comprehensive guide for staff on dispensing workflow
- Explains morning + EOD checks, waste calculation, troubleshooting

**Waste Calculation Verified**:
- 0.1ml per syringe (needle dead-space)
- 185.7ml total waste / 1,855 syringes = exactly 0.100 ml/syringe ✅

---

### January 4, 2026: Data Sync Recovery & Monitoring Improvements

**CRITICAL: Healthie → Snowflake Sync Fixed**
- **Problem**: Billing items sync had been silently failing since Dec 29 - Snowflake data was 6 days stale!
- **Root Cause**: Cron job using old Node.js path `/home/ec2-user/.local/share/nvm/v20.19.6/bin/npx` which no longer exists
- **Solution**: Updated cron to use `/usr/bin/npx`
- **Manual Sync Ran**: Data now current (last payment: January 4, 2026)

**Telegram Bot Improvements (NOWJarvis)**:
- **Date Format**: All dates now display as **MM-DD-YYYY** (not YYYY-MM-DD)
- **Time Range Clarification**: AI now asks for clarification when queries like "total" are ambiguous
- **"Total" Interpretation**: When user asks for "total" without date qualifier, queries ALL data (no date filter)
- **Year Updated**: AI prompts updated from 2025 to 2026
- **New Commands Added**:
  - `/ghl` - Show Men's Health existing patients from GoHighLevel
  - `/dashboard [SQL]` - Query PostgreSQL directly (SELECT only)
  - `/datasources` - List all connected data sources

**Data Staleness Monitoring Added**:
- Health monitor now checks Snowflake billing data freshness
- Alerts via Telegram if data is >2 days old (sync failure)
- Prevents silent data sync failures from recurring

**Healthie Payment Decline Alerts (UPDATED 2026-02-01)**:
- **File**: `scripts/process-healthie-webhooks.ts`
- **Detection**: Monitors for status containing `failed`, `declined`, `error`, `rejected`, `cancelled`, `card_error`
- **CRITICAL: Recent Payment Check**: Before alerting or setting Hold, system checks if patient has a more recent SUCCESSFUL payment. If they've paid since the failure, **NO ALERT is sent**.
- **Healthie API Semantics**:
  - `billingItems`: `sender` = PATIENT (who pays), `recipient` = PROVIDER (who receives)
  - `requestedPayments`: `recipient` = PATIENT, `sender` = PROVIDER (REVERSED!)
- **Alerts To** (only if no recent payment):
  1. **Telegram**: Immediate alert with patient name, amount, status
  2. **Google Spaces**: ops-billing space (requires `GOOGLE_CHAT_WEBHOOK_OPS_BILLING` env var)
- **Automatic Dashboard Update**:
  - Patient status set to **"Hold - Payment Research"** (red)
  - Note added with timestamp: `[MM/DD/YYYY HH:MM AM] PAYMENT DECLINED - Amount: $X, Due: MM/DD/YYYY. Status auto-set to Hold - Payment Research.`
  - **Staff must manually set to Inactive if needed** - system never sets Inactive
- **Auto Message to Patient** (via Healthie Chat - in-app messaging):
  - Uses Healthie's `createConversation` + `createNote` mutations
  - Message appears in patient's Healthie messaging/chat inbox
  - **NOT SMS** - this is in-app chat that patients see when they log into Healthie
  - Message: `Hi {FirstName}, we noticed your {clinic} payment didn't go through. Please update your card here: https://secureclient.gethealthie.com/users/sign_in (Log in → Settings ⚙️ → Update Payment Cards). Questions? Call {phone}. Thank you!`
  - **Phone Numbers**: Men's Health = **928-212-2772**, All Others = **928-277-0001**
  - **Payment Portal**: `https://secureclient.gethealthie.com/users/sign_in` - patients log in, go to Settings → Update Payment Cards
  - **IMPORTANT**: GHL SMS is NOT used - only Healthie Chat to prevent duplicate messages
  - **CRITICAL**: Only messages ACTIVE patients - archived patients are SKIPPED. System checks `user.active` field from Healthie API before sending.
- **Auto-Reactivation** (when patient pays after being on Hold):
  - Patient status → Active
  - Note added: `[timestamp] PAYMENT RECEIVED - Auto-reactivated from Hold - Payment Research.`
  - Telegram notification sent to staff
  - **Chat to Patient** (via Healthie): `Hi {FirstName}, thank you! Your {clinic} payment has been received. We appreciate you! - NOW Optimal`


**Patient Status Color Rules** (GMH Dashboard):
| Status | Key | Color | Description |
|--------|-----|-------|-------------|
| Active | `active` | Green (`#d9ead3`) | Current, no issues |
| Active - Pending | `active_pending` | Yellow (`#fff2cc`) | Labs due or pending action |
| **Hold - Payment Research** | `hold_payment_research` | Red (`#f4cccc`) | **AUTO-SET when Healthie payment declines** |
| Hold - Patient Research | `hold_patient_research` | Red (`#f4cccc`) | Manual investigation needed |
| Inactive | `inactive` | Red (`#f4cccc`) | **STAFF ONLY** - No longer active patient |


**Overdue Rule** (Red status trigger):
- Balance > $0.50, OR
- Status contains "past"/"due", OR
- > 3 days past charge date

**Cost Report Enhanced**:
- Now includes real Snowflake credit usage (not estimates)
- Added SaaS subscriptions: GHL ($97), Healthie ($149), Ngrok ($8)
- **Grand Total**: Displays complete monthly infrastructure cost (~$356/mo)

**PM2 Services Updated**:
- Added `fax-processor` and `uptime-monitor` to critical services monitoring list


---

### January 2, 2026: NOW Primary Care Website Deployed


**New Website Live at https://www.nowprimary.care**
- **Purpose**: Professional public-facing website for NOW Primary Care clinic
- **Technology**: Next.js 14, vanilla CSS design system
- **Port**: 3004 (Nginx proxies nowprimary.care to localhost:3004)
- **PM2 Service**: `nowprimary-website`
- **Directory**: `/home/ec2-user/nowprimarycare-website/`

**Pages Created**:
- Home: Hero, features, provider spotlight, location, CTA
- About: Mission, values, Phil Schafer bio
- Services: All 26 Healthie appointment types organized by category
- Contact: Location map, contact form
- Book: Interactive service selection widget → Healthie portal

**Design System**:
- Navy Blue: `#00205B` (primary, from logo)
- Green: `#00A550` (accent, from logo compass)
- Inter font (Google Fonts)
- Responsive, mobile-first design

**Nginx Config Updated**:
- Changed `nowprimary.care` proxy from port 3001 to 3004
- Port 3001 remains for upload-receiver (Scribe service)

**postcss.config.mjs Relocated**:
- Moved from `/home/ec2-user/postcss.config.mjs` to `/home/ec2-user/gmhdashboard/postcss.config.mjs`
- Prevents conflict when building nowprimarycare-website (which doesn't use Tailwind)

---

## 🔥 PREVIOUS MAJOR CHANGES (DEC 25-30, 2025)

### December 30: Dashboard Hydration Fix & Jarvis Bot Improvements

**PatientTable Hydration Error Fixed**
- **Problem**: React hydration error on `/ops/patients/` - server rendered "Bruce French" but client expected "Travis Gonzales"
- **Root Cause**: Client-side sorting with `comparePatients()` produced different order than server SQL ORDER BY
- **Solution**: Added `mounted` state guard pattern to `PatientTable.tsx` (same pattern already in `AddPatientForm.tsx`)
- **Pattern Used**:
  ```typescript
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <LoadingPlaceholder />;
  ```

**PM2 Production Mode Fixed**
- **Problem**: PM2 was running `npm run dev` instead of `npm run start`
- **Impact**: Dev mode causes slower hydration, extra React strict mode renders
- **Solution**: 
  ```bash
  pm2 delete gmh-dashboard
  pm2 start npm --name "gmh-dashboard" -- run start
  pm2 save
  ```
- **Verification**: `pm2 describe gmh-dashboard | grep "script args"` → should show "run start"

**Jarvis Telegram Bot Response Formatting Improved**
- **Problem**: Bot giving verbose, padded responses with unnecessary emojis and filler text
- **Solution**: Updated `formatAnswer()` prompt in `scripts/telegram-ai-bot-v2.ts`:
  - Reduced `max_tokens` from 800 to 300
  - Reduced `temperature` from 0.3 to 0.1
  - Added explicit instructions: "Be EXTREMELY BRIEF - 1-3 sentences max"
  - Added good/bad examples to guide response style
- **File**: `/home/ec2-user/gmhdashboard/scripts/telegram-ai-bot-v2.ts` (lines 1103-1145)

**CRITICAL FIX: Healthie Billing Items Sync Gap**
- **Problem**: Jarvis bot reporting $0 revenue when Healthie showed $1,280 for Dec 29
- **Root Cause**: `HEALTHIE_BILLING_ITEMS` table in Snowflake had NO automated sync from Healthie API
  - The existing `sync-healthie-ops.js` syncs from Postgres (dashboard data), NOT from Healthie API
  - Billing items table was stuck with data from Dec 23
- **Solution**: 
  1. Created `/home/ec2-user/gmhdashboard/scripts/sync-healthie-billing-items.ts` 
  2. Added hourly cron job to sync billing items from Healthie API to Snowflake
  3. Ran manual sync - now shows Dec 29: 8 transactions = $1,280 ✅
- **Cron Added**: `0 * * * *` (every hour at minute 0)

**Removed Rogue PM2 Process**
- `upload-receiver` had 1481 restart attempts and was in stopped state
- Deleted with `pm2 delete upload-receiver && pm2 save`

**Snowflake Sync System Overview** (Updated Feb 2026)
| Sync Job | Schedule | What It Syncs | Script Location |
|----------|----------|---------------|-----------------|
| Unified Python Sync | Every 4 hrs at :00 | patients, invoices, vials, dispenses, memberships, qb_payments, prescriptions → Snowflake | `/home/ec2-user/scripts/sync-all-to-snowflake.py` |
| QuickBooks | Every 3 hrs | QB payments/transactions | `/home/ec2-user/quickbooks-sync.sh` |
| Revenue Cache | Every 6 hrs at :40 | Healthie revenue data | `/home/ec2-user/scripts/cache-healthie-revenue.py` |

**Rate Limiting Measures** (added Dec 30):
- Billing items sync reduced from hourly to every 6 hours
- Staggered at :30 to avoid collision with scribe sync at :00
- Added 500ms delay between paginated API requests

**Important**: The Jarvis bot queries `HEALTHIE_BILLING_ITEMS` for financial data.

### December 28: Infrastructure Hardening
**Disk Space Crisis & Resolution**
- Ran out of disk space (98% on 20GB volume)
- Cleaned 4GB (old duplicates, logs, n8n Docker)
- Expanded EBS volume 20GB → 50GB via AWS Console
- Commands: `sudo growpart /dev/nvme0n1 1 && sudo xfs_growfs -d /`
- Result: Now 32% usage (35GB free) ✅

**QuickBooks OAuth Routes Created**
- **Problem**: Routes never existed, returned 404
- **Solution**: Created from scratch:
  - `/app/api/auth/quickbooks/route.ts` - Initiates OAuth
  - `/app/api/auth/quickbooks/callback/route.ts` - Token exchange
  - Added `getPublicUrl()` helper for proper redirects
- **Database**: Stores tokens in `quickbooks_oauth_tokens` table
- **Flow**: User → QuickBooks → Callback → Tokens saved → Redirect to dashboard

**Redirect Loop Fixed**
- **Problem**: `ERR_TOO_MANY_REDIRECTS` on `/ops` ↔ `/ops/`
- **Root Cause**: Nginx forced `/` but Next.js stripped it
- **Solution**: 
  - Added `trailingSlash: true` to `next.config.js`
  - All URLs now end with `/` (standard)
  - Renamed cookie `gmh_session` → `gmh_session_v2` (invalidate old)

**Base Path Configuration Standardized**
- **ENV**: `NEXT_PUBLIC_BASE_PATH=/ops` (in `.env.local` AND `next.config.js`)
- **Helper**: `lib/basePath.ts` exports `withBasePath(path)` and `getBasePath()`
- **Rule**: ALL client-side fetches MUST use `withBasePath('/api/...')`
- **Example**: `fetch(withBasePath('/api/admin/quickbooks/sync'), ...)`

**Production Mode Fixed**
- **Problem**: PM2 was running `npm run dev` instead of `npm run start`
- **Solution**: 
  ```bash
  pm2 delete gmh-dashboard
  pm2 start npm --name "gmh-dashboard" -- run start
  pm2 save
  ```
- **Verify**: `pm2 logs gmh-dashboard` should show `next start` (not `next dev`)

**Type Safety & Hydration Fixes**
- **Hydration**: Added client-side guards to `AddPatientForm`, `LoginForm`
- **Pattern**: `useState(false)` + `useEffect(() => setMounted(true))` + early return
- **Formatters**: All `formatCurrency/formatNumber` now handle `number | string | null | undefined`
- **Dates**: Use UTC-based `safeDateFormat()` instead of `toLocaleString()`

### December 25-27: AI Scribe System Built
**Full Clinical Documentation Automation**
- **Location**: `/home/ec2-user/scripts/scribe/`
- **Workflow**:
  1. Audio recording uploaded → Deepgram transcription
  2. Claude analyzes visit → Classifies visit type
  3. Generates 4 documents: SOAP note, patient summary, prescription recs, lab orders
  4. Sends to Telegram for provider approval (inline buttons)
  5. Provider reviews/edits/approves
  6. Approved docs injected into Healthie chart

**Key Components**:
- `scribe_orchestrator.py` - Main coordinator
- `telegram_approver.py` - Human-in-the-loop approval UI
- `document_generators.py` - AI-powered generation
- `prompts_config.yaml` - Customizable prompt templates
- `upload_receiver.js` - PM2 service (listens on port 3001)

**Visit Types Detected**:
- Initial consultation
- Follow-up visit
- Prescription refill
- Medication adjustment
- Lab review

**Safety Features**:
- Telegram approval required (no auto-injection)
- Edit capability before approval
- **Change Patient feature** (Jan 21, 2026): When fuzzy matching assigns wrong patient, tap "🔄 Change Patient" to search and reassign to correct patient
- Comprehensive logging
- Graceful error handling (Telegram failures don't crash workflow)

**Documentation**:
- Setup: `scripts/scribe/SETUP.md`
- Safety: `scripts/scribe/SAFETY_GUIDE.md`
- Customization: `scripts/scribe/PROMPT_CUSTOMIZATION.md`

### December 25-27: Snowflake "Mini-Bridge" Complete
**Infrastructure Provisioned**:
1. **AWS S3 Bucket**: `gmh-snowflake-stage` (us-east-2)
2. **IAM Role**: `snowflake-s3-access-role` (trust to Snowflake)
3. **Storage Integration**: S3 → Snowflake connection
4. **Snowpipe**: Auto-ingest on file upload

**Data Flow**:
```
Clinical Systems (Healthie, QB, Postgres)
  ↓ (Sync scripts)
AWS S3 (gmh-snowflake-stage)
  ↓ (Snowpipe)
Snowflake (GMH_CLINIC)
  ↓ (SQL views)
Metabase (BI)
```

**Active Syncs**:
- Every 6 hours: `scripts/sync-healthie-ops.js` → Snowflake
- Every hour: `scripts/scribe/healthie_snowflake_sync.py`
- On-demand: Invoice sync, provider sync, billing items

**Snowflake Details**:
- Account: `KXWWLYZ-DZ83651`
- User: `JARVIS_SERVICE_ACCOUNT` (key-pair auth) — see Snowflake Auth section above
- Database: `GMH_CLINIC`
- Schemas: `FINANCIAL_DATA`, `PATIENT_DATA`, `INTEGRATION_LOGS`

**Key Tables** (as of Dec 28):
- `PATIENTS`: 305 rows
- `HEALTHIE_INVOICES`: 69
- `HEALTHIE_BILLING_ITEMS`: 20
- `QB_PAYMENTS`: 84
- `MEMBERSHIPS`: 102
- `DISPENSES`: 192

### December 25-27: Prescribing & Patient Engagement
**Pre-Staging E-Rx Orders**:
- AI Scribe generates prescription recommendations
- Creates Healthie tasks (tagged `erx-pending`)
- Provider reviews/approves via dashboard
- Approved scripts sent to pharmacy

**5th-Grade Patient Summaries**:
- AI generates patient-friendly visit summaries
- Written at 5th-grade reading level
- Posted to Healthie patient portal
- Improves patient understanding & engagement

### December 28-29: AI Email Triage System ✅ DEPLOYED

**Email**: `hello@nowoptimal.com` (Google Workspace)  
**Status**: Running 24/7 in PM2 as `email-triage`  
**Purpose**: Intelligent AI-powered routing of all incoming emails to appropriate Google Chat spaces

**Architecture**:
```
Incoming Email → Gmail API (every 2 min) → AI Classification (Bedrock Claude) 
→ Google Chat Post → Feedback Learning → Improved Accuracy
```

**Google Chat Spaces & Webhooks**:

1. **NOW Ops & Billing** (`OPS_BILLING`)
   - Webhook: `https://chat.googleapis.com/v1/spaces/AAQAuw3Rvdc/messages?key=...`
   - Routes: Billing, payments, insurance, claims, no-shows, cancellations
   - Keywords: billing, payment, insurance, card on file, balance, claim

2. **NOW Exec/Finance** (`EXEC_FINANCE`)
   - Webhook: `https://chat.googleapis.com/v1/spaces/AAQARw60cl0/messages?key=...`
   - Routes: KPIs, revenue, patient complaints, leadership decisions
   - Keywords: KPI, revenue, complaint, reconciliation, QuickBooks

3. **NOW Patient Outreach** (`PATIENT_OUTREACH`)
   - Webhook: `https://chat.googleapis.com/v1/spaces/AAQAR7R9T3w/messages?key=...`
   - Routes: Retention, engagement, human follow-up needed
   - Keywords: retention, outreach, churn risk, follow-up

4. **NOW Clinical Alerts** (`CLINICAL`)
   - Webhook: `https://chat.googleapis.com/v1/spaces/AAQANhoAdgo/messages?key=...`
   - Routes: Lab results, vitals, medications, clinical follow-ups, faxed reports
   - Keywords: lab, vital, medication, abnormal, out of range, clinical

**AI Learning System**:
- Every Google Chat message includes "Reroute" buttons
- User corrections automatically tracked in `/home/ec2-user/gmhdashboard/data/email-triage-feedback.json`
- System extracts patterns (keywords, sender domains) from corrections
- Future classifications incorporate learned patterns
- Accuracy tracking: Shows current routing accuracy with each email

**Files**:
- `/home/ec2-user/gmhdashboard/scripts/email-triage/email-monitor.py` - Gmail API monitoring
- `/home/ec2-user/gmhdashboard/scripts/email-triage/email-classifier.py` - AI classification with Bedrock
- `/home/ec2-user/gmhdashboard/scripts/email-triage/google-chat-poster.py` - Google Chat formatting
- `/home/ec2-user/gmhdashboard/scripts/email-triage/feedback-tracker.py` - Learning system
- `/home/ec2-user/gmhdashboard/config/gmail-credentials.json` - OAuth credentials
- `/home/ec2-user/gmhdashboard/config/gmail-token.pickle` - Saved authentication token

**PM2 Management**:
```bash
pm2 list                    # View status
pm2 logs email-triage       # View logs
pm2 restart email-triage    # Restart service
pm2 stop email-triage       # Stop service
```

**Daily Monitoring**:
- Integrated into `/home/ec2-user/scripts/telegram_monitor.py`
- Daily Telegram report includes:
  - Emails processed count
  - Routing accuracy percentage
  - Corrections made count

---

### December 28-29: GoHighLevel (GHL) Communication System 🚀 IN PROGRESS

**GHL Account**: HIPAA-approved  
**Purpose**: Centralized patient communication platform with AI Voice agents  
**Status**: Voice AI webhook server deployed, MCP server in development

**Architecture Overview**:
```
Patient Communication Flow:
Ooma Phone System → GHL Phone Numbers → Jessica Voice AI
    ↓
MCP Server (Real-time data access)
    ├→ Postgres (Patient IDs)
    ├→ Healthie (Appointments, Forms)
    ├→ Snowflake (Historical Data)
    └→ AWS Bedrock (AI Decisions)
    ↓
Actions: Book appointments, Send SMS, Update tags, Trigger workflows
```

**GHL Sub-Accounts** (Multi-brand strategy):

1. **NOW Men's Health Care**
   - Location ID: `0dpAFAovcFXbe0G5TUFr`
   - Phone: 928-212-2772
   - Voice AI: **Max** (TRT/Men's health specialist)
   - Address: 215 N. McCormick St, Prescott, AZ 86301
   - Hours: Mon 1pm-6pm, Tue-Fri 9am-6pm, Sat 9am-1pm

2. **NOW Primary Care**
   - Location ID: TBD (to be created)
   - Phone: TBD (Ooma forwarding)
   - Voice AI: **Jessica** (Primary care receptionist)
   - Address: 404 S. Montezuma St, Suite A, Prescott, AZ 86303
   - Hours: Mon-Fri 9am-5pm
   - Fax: 928-350-6228

**Max Voice AI Agent** (NEW - Jan 2, 2026):
- **Role**: Men's health receptionist for NOW Men's Health Care
- **Port**: 3006
- **PM2 Process**: `max-webhooks`
- **Healthie Group**: NowMensHealth.Care (ID: 75522)
- **Provider ID**: 12093125
- **Capabilities**:
  - Patient verification (DOB check)
  - New patient intake (creates in GHL + Healthie MensHealth.Care group)
  - TRT appointment scheduling (Initial, Refill, Labs)
  - EvexiPEL pellet therapy booking
  - Peptide education scheduling
  - Lab/imaging results requests (date only, NO PHI)
  - Billing inquiries
  - SMS confirmations
- **HIPAA Compliance**: Never discusses actual lab values or diagnoses
- **Intelligent Routing**: Transfers primary care requests to NOW Primary Care
- **Personality**: Confident, knowledgeable, discreet about sensitive topics

**Max Custom Actions** (Webhook endpoints on port 3006):
- `POST /api/ghl/max/verify-patient` - Authenticate caller
- `POST /api/ghl/max/create-new-patient` - Create in GHL + Healthie (MensHealth.Care)
- `POST /api/ghl/max/get-availability` - Query TRT appointment slots
- `POST /api/ghl/max/book-appointment` - Create Healthie appointment
- `POST /api/ghl/max/check-lab-results` - Get lab date (HIPAA safe)
- `POST /api/ghl/max/send-provider-message` - Notify Google Chat
- `POST /api/ghl/max/patient-balance` - Check balance
- `POST /api/ghl/max/send-payment-link` - SMS payment link

**Max Appointment Types** (Prices verified via Healthie GraphQL - Jan 2026):
| Type | Healthie ID | Duration | Price | Pricing Option |
|------|-------------|----------|-------|----------------|
| Male HRT Initial | 504725 | 30 min | Free | custom |
| TRT Supply Refill | 504735 | 20 min | Custom | custom |
| EvexiPEL Male Initial | 504727 | 60 min | Custom | custom |
| EvexiPEL Male Repeat | 504728 | 45 min | Custom | N/A |
| TRT Telemedicine | 505645 | 30 min | Custom | custom |
| Peptide Education | 504736 | 20 min | Custom | custom |
| 5-Week Lab | 504732 | 15 min | Free | N/A |
| 90-Day Lab | 504734 | 20 min | Free | N/A |
| Weight Loss Consult | 504717 | 45 min | $99 | custom |
| IV Therapy GFE | 505647 | 15 min | $50 | custom |

**Healthie GraphQL Query for Appointment Type Pricing**:
```graphql
query {
  appointmentTypes(page_size: 50) {
    id
    client_display_name
    length
    pricing              # String: displays as "$99.00" or "$" for custom
    pricing_option       # String: "custom" or "N/A"
    pricing_info {
      price              # String: actual price in cents/dollars  
      cpt_code { code }
    }
    clients_can_book
    user_group { id name }
  }
}
```
Note: "Custom" pricing means the patient pays at checkout based on actual supplies/services provided.

**Jessica Voice AI Agent**:
- **Role**: Primary care receptionist for NOW Primary Care
- **Capabilities**:
  - Patient verification (DOB check)
  - New patient intake (creates in GHL + Healthie)
  - Appointment scheduling (via Healthie API)
  - Lab/imaging results requests (date only, NO PHI)
  - Prescription refill routing
  - Billing inquiries
  - SMS confirmations
- **HIPAA Compliance**: Never discusses actual lab values or diagnoses
- **Intelligent Routing**: Transfers testosterone/men's health calls to NOW Men's Health (928-212-2772)
- **Caller ID Recognition**: Tailors greeting for known vs unknown callers

**GHL Custom Actions** (Webhooks - Tested Jan 3, 2026):
Server: `https://nowoptimal.ngrok.app` (Static Ngrok Domain)

| # | Endpoint | Status | Description |
|---|----------|--------|-------------|
| 1 | `verify_patient` | ✅ PASS | Authenticate caller by DOB |
| 2 | `create_new_patient` | ✅ PASS | Create in GHL + Healthie |
| 3 | `get_availability` | ✅ PASS | Query Healthie for slots (60+ returned) |
| 4 | `book_appointment` | ✅ PASS | Create in Healthie (ID: 529416766 confirmed) |
| 5 | `check_lab_results` | ✅ PASS | Get last lab date (HIPAA safe) |
| 6 | `patient_balance` | ✅ PASS | Returns balance + payment history |
| 7 | `send_payment_link` | ⚠️ CONFIG | Needs GHL payment integration setup |
| 8 | `send_provider_message` | ⚠️ CONFIG | Needs Google Chat webhook URL |
| 9 | `transfer_call` (FrontDesk) | ✅ PASS | Tags contact for workflow transfer |
| 10 | `transfer_call` (MensHealth) | ✅ PASS | Tags contact for workflow transfer |
| 11 | `request_prescription_refill` | ✅ PASS | Sends to Google Chat clinical |
| 12 | `find_pharmacy` | 🔲 TODO | Google Places API integration |
| 13 | `get_available_slots` | ✅ PASS | Returns specific time slots |


**MCP Server Integration** (CRITICAL):
- **Port**: 3002 (HTTP/SSE mode)
- **GHL Native Support**: Jessica connects via MCP protocol
- **Real-Time Data Access**: Sub-2 second queries across all systems
- **Tools Exposed**:
  - `get_patient_context` - Complete patient overview (Postgres + Snowflake + Healthie + GHL)
  - `lookup_patient` - Search by phone/email/name
  - `check_availability` - Provider appointment slots
  - `book_appointment` - Create appointment with constraint checking
  - `get_recent_labs` - Lab dates (NO values - HIPAA)
  - `check_form_status` - Intake paperwork completion
  - `trigger_patient_workflow` - Start Healthie workflows
  - `send_sms` - Send text via GHL
  - `notify_team` - Google Chat notifications
  - `summarize_patient_for_call` - AI-powered patient summary (Bedrock)

**Data Flow - Patient Lookup** (Critical for integration):
```
Jessica receives call from (928) 555-1234
    ↓
MCP: get_patient_context(phone="9285551234")
    ↓
1. Postgres Query (REAL-TIME - source of truth for IDs)
   SELECT patient_id, healthie_client_id, ghl_contact_id
   FROM patient_data_entry_v + healthie_clients + patients
    ↓
2. If patient found in Postgres:
   ├→ Snowflake: Get visit history, lab dates (ANALYTICS - 6hr lag OK)
   ├→ Healthie API: Get forms completion status (REAL-TIME)
   ├→ GHL API: Get tags, custom fields (REAL-TIME)
   └→ Bedrock AI: Summarize for natural conversation
    ↓
3. Return combined context to Jessica (<2 sec)
    ↓
Jessica: "Hi Sarah! I see you're due for your annual physical..."
```

**Patient Workflows** (Auto-triggered via Healthie):
- **Sick Visit**: Urgent care intake forms
- **Primary Care**: Annual exam paperwork
- **Pelleting**: Hormone pellet therapy forms
- **Weight Loss**: GLP-1/weight management intake
- **Men's Health**: TRANSFER to NOW Men's Health clinic

**GHL ↔ Healthie Sync**:
- Patient created in GHL → GHL custom field `healthie_patient_id` stored
- Patient created in Healthie → Postgres `healthie_clients` table updated
- Appointment booked → GHL workflow triggered (SMS confirmation)
- Forms completed in Healthie → GHL tag updated (`paperwork_complete`)

**GHL ↔ Postgres Sync**:
- **Source of Truth**: Postgres for all patient IDs
- **GHL Field**: `ghl_contact_id` stored in Postgres `patients` table
- **Healthie ID**: `healthie_client_id` stored in Postgres `healthie_clients` table
- **Critical**: MCP server MUST query Postgres first, NOT Snowflake (6hr lag)

**GHL Workflows Required** (Must be created in GHL UI - API doesn't support workflow creation):
| Workflow Name | Trigger | Action | Target Number |
|---------------|---------|--------|---------------|
| Transfer to Front Desk | Tag `transfer_front_desk` added | Forward Call | +1 (928) 277-0001 |
| Transfer to Men's Health | Tag `transfer_mens_health` added | Forward Call | +1 (928) 212-2772 |
| SMS Appointment Confirmation | Appointment Created | Send SMS | (Patient phone) |


**Files & Locations**:
```
/home/ec2-user/gmhdashboard/scripts/ghl-integration/
├── webhook-server.js          # Express server for custom actions (port 3001)
├── ghl-client.js               # GHL API wrapper
├── JESSICA_AI_AGENT.md         # Jessica documentation
├── JESSICA_GHL_PROMPT.md       # Copy-paste prompt for GHL
├── JESSICA_QUICK_REFERENCE.md  # Quick decision trees
├── YOUR_GHL_CONFIG.md          # ngrok URL and setup
└── PATIENT_WORKFLOW_GUIDE.md   # Routing logic

/home/ec2-user/mcp-server/
├── server.py                   # MCP HTTP/SSE server (port 3002)
├── clients/
│   ├── postgres_client.py      # Postgres queries (SOURCE OF TRUTH)
│   ├── snowflake_client.py     # Analytics queries
│   ├── healthie_client.py      # Healthie GraphQL API
│   ├── ghl_client.py           # GHL REST API
│   └── bedrock_client.py       # AWS AI reasoning
├── tools/
│   ├── snowflake.py            # Snowflake MCP tools
│   ├── healthie.py             # Healthie MCP tools
│   ├── ghl.py                  # GHL MCP tools
│   └── composite.py            # Multi-system intelligent tools
└── GHL_MCP_CONFIG.md           # How to connect MCP to GHL
```

**PM2 Services**:
```bash
pm2 list
├── ghl-webhooks     # Webhook server (port 3001)
└── jessica-mcp      # MCP server (port 3002) [TO BE DEPLOYED]
```

**Environment Variables** (`.env.production`):
```bash
# GHL API (V2 - Primary Integration)
GHL_V2_API_KEY=pit-f38c02ee-...       # V2 Private Integration Token (PIT)
GHL_API_VERSION=v2                     # Forces V2 API usage
GHL_LOCATION_ID=NyfcCiwUMdmXafnUMML8  # NOW Primary Care location
GHL_WEBHOOK_SECRET=960dd12...         # Webhook authentication
GHL_WEBHOOK_PORT=3003

# GHL V2 API Notes (CRITICAL - Updated Jan 8, 2026):
# - V2 Base URL: https://services.leadconnectorhq.com
# - V1 Base URL: https://rest.gohighlevel.com/v1 (legacy)
# - V2 Header: "Version: 2021-07-28" required
# - Contact Search: Use "query=" param (NOT "email=" or "phone=")
# - Workflows: CANNOT be created via API - must use GHL UI
# - SMS: POST /conversations/messages (works with PIT token)
#
# **CRITICAL - Private Integration Token Scoping (Updated Jan 9, 2026):**
# - V2 Private Integration Tokens (PIT) are SUB-ACCOUNT SCOPED by default
# - When you create a PIT from within a GHL sub-account (e.g., NOW Men's Health),
#   the token is AUTOMATICALLY associated with that sub-account for AUTHENTICATION
# - The token "knows" which location it belongs to and enforces this in auth
#
# **HOWEVER** - locationId still needed in API request bodies:
# - Certain GHL API operations (like /contacts/search, /tags) REQUIRE locationId
#   IN THE REQUEST BODY, even when using a sub-account-scoped token
# - This is a quirk of GHL API v2 design - the token is scoped, but the API
#   still wants locationId explicitly in certain request payloads
# - Solution: Pass locationId to GHLClient constructor, which will include it
#   in request bodies where needed
# - The token's sub-account scope is still enforced - passing a different
#   locationId will result in "token does not have access" errors
#
# Current setup:
# - Token: pit-cb1c18dd-... (scoped to NOW Men's Health sub-account)
# - GHL_MENS_HEALTH_LOCATION_ID=0dpAFAovcFXbe0G5TUFr (used in request bodies)
# - These MUST match or you'll get "token does not have access" errors
#
# **DUAL LOCATION SETUP (Updated Jan 15, 2026):**
# Two separate tokens are needed, one for each GHL sub-account:
#
# Men's Health Location:
#   - Token: GHL_MENS_HEALTH_API_KEY=pit-d5e53eeb-...
#   - Location ID: 0dpAFAovcFXbe0G5TUFr
#
# Primary Care Location:
#   - Token: GHL_PRIMARY_CARE_API_KEY=pit-9383d96a-...
#   - Location ID: NyfcCiwUMdmXafnUMML8
#
# ==== GHL PATIENT ROUTING RULES (CRITICAL - Updated Jan 15, 2026) ====
#
# MEN'S HEALTH Location (default for most patients):
#   - QBO TCMH $180/Month (qbo_tcmh_180_month)
#   - QBO F&F/FR/Veteran $140/Month (qbo_f_f_fr_veteran_140_month)
#   - Jane TCMH $180/Month (jane_tcmh_180_month)
#   - Jane F&F/FR/Veteran $140/Month (jane_f_f_fr_veteran_140_month)
#   - Approved Disc / Pro-Bono PT (approved_disc_pro_bono_pt)
#   - NowMensHealth.Care (nowmenshealth)
#   - Ins. Supp. $60/Month (ins_supp_60_month)
#
# PRIMARY CARE Location (only these 3 client types):
#   - NowPrimary.Care (nowprimarycare)
#   - PrimeCare Premier $50/Month (primecare_premier_50_month)
#   - PrimeCare Elite $100/Month (primecare_elite_100_month)
#
# Implementation: getGHLClientForPatient() in lib/ghl.ts
# - Routes based on client_type_key field
# - Primary Care types explicitly listed, all others default to Men's Health



# Healthie Provider IDs (for appointment routing)
HEALTHIE_MENS_HEALTH_PROVIDER_ID=12093125
HEALTHIE_PRIMARY_CARE_PROVIDER_ID=12088269  # Phil Schafer, NP

# ============================================
# NowMensHealth.Care Website Healthie Integration [NEW Jan 2026]
# ============================================
#
# Website: https://www.nowmenshealth.care
# Directory: /home/ec2-user/nowmenshealth-website/
# PM2 Service: nowmenshealth-website (port 3005)
#
# Healthie Configuration:
#   Location ID: 13029260 (215 N. McCormick St, Prescott)
#   Group ID: 75522 (NowMensHealth.Care)
#   Provider ID: 12093125 (Dr. Aaron Whitten)
#   Timezone: America/Phoenix
#
# Appointment Types Available for Online Booking:
#   TRT_INITIAL: 504725 (Initial TRT Consultation, 30 min, Free)
#   TRT_SUPPLY_REFILL: 504735 (TRT Supply Refill, 20 min, $79)
#   EVEXIPEL_MALE_INITIAL: 504727 (Pellet Therapy Initial, 60 min, $499)
#   EVEXIPEL_MALE_REPEAT: 504728 (Pellet Therapy Repeat, 45 min, $399)
#   WEIGHT_LOSS_CONSULT: 504717 (Weight Loss Consultation, 45 min, Free)
#   IV_THERAPY_GFE: 505647 (IV Therapy Consultation, 15 min, $50)
#
# API Routes:
#   POST /api/healthie/slots - Fetch available slots
#   POST /api/healthie/book - Book appointment & create patient
#
# Key Files:
#   lib/healthie-booking.ts - Healthie client with config
#   components/BookingWidget.tsx - Multi-step booking UI
#   app/book/page.tsx - Booking page
# ============================================


# Healthie Appointment Types (26 total - queried Dec 31, 2024)
# === URGENT/SICK VISITS ===
HEALTHIE_APPT_TYPE_SICK_VISIT_INPERSON=504715     # 50 min, In Person+Video, $129
HEALTHIE_APPT_TYPE_SICK_VISIT_TELE=505646         # 30 min, Video, $79
HEALTHIE_APPT_TYPE_WOUND_CARE=504716              # 60 min, In Person
HEALTHIE_APPT_TYPE_SPORTS_PHYSICAL=504718         # 45 min, In Person
HEALTHIE_APPT_TYPE_MEDICAL_CLEARANCE=504719       # 45 min, In Person
HEALTHIE_APPT_TYPE_TB_TEST=504741                 # 15 min, In Person
HEALTHIE_APPT_TYPE_ALLERGY_INJECTION=505648       # 20 min, In Person, $55
HEALTHIE_APPT_TYPE_IV_THERAPY_GFE=505647          # 15 min, In Person, $50
HEALTHIE_APPT_TYPE_INJECTION=505649               # 25 min, In Person

# === WEIGHT LOSS ===
HEALTHIE_APPT_TYPE_WEIGHT_LOSS_CONSULT=504717     # 45 min, Video+In Person, $99
HEALTHIE_APPT_TYPE_WEIGHT_LOSS_EDUCATION=504731   # 45 min, In Person

# === HORMONE REPLACEMENT THERAPY ===
HEALTHIE_APPT_TYPE_MALE_HRT_INITIAL=504725        # 30 min, In Person
HEALTHIE_APPT_TYPE_FEMALE_HRT_INITIAL=504726      # 30 min, In Person
HEALTHIE_APPT_TYPE_EVEXIPEL_MALE_INITIAL=504727   # 60 min, In Person
HEALTHIE_APPT_TYPE_EVEXIPEL_MALE_REPEAT=504728    # 45 min, In Person
HEALTHIE_APPT_TYPE_EVEXIPEL_FEMALE_INITIAL=504730 # 60 min, In Person
HEALTHIE_APPT_TYPE_EVEXIPEL_FEMALE_REPEAT=504729  # 45 min, In Person
HEALTHIE_APPT_TYPE_TRT_TELEMEDICINE=505645        # 30 min, Video (staff booking only)
HEALTHIE_APPT_TYPE_TRT_SUPPLY_REFILL=504735       # 20 min, In Person
HEALTHIE_APPT_TYPE_PEPTIDE_EDUCATION=504736       # 20 min, In Person

# === LAB DRAWS ===
HEALTHIE_APPT_TYPE_5_WEEK_LAB=504732              # 15 min, In Person
HEALTHIE_APPT_TYPE_90_DAY_LAB=504734              # 20 min, In Person (staff booking only)

# === PRIMARY CARE ===
HEALTHIE_APPT_TYPE_INITIAL_PC_CONSULT=504743      # 60 min, In Person (staff booking only)
HEALTHIE_APPT_TYPE_ELITE_MEMBERSHIP=504759        # 30 min, In Person, $250 (staff booking only)
HEALTHIE_APPT_TYPE_PREMIER_MEMBERSHIP=504760      # 30 min, In Person, $250 (staff booking only)

# === ABX TACTICAL ===
HEALTHIE_APPT_TYPE_ABX_TACTICAL_TELE=505650       # 25 min, Video

# Phil Schafer Availability (Created Jan 2, 2026 via API)
# Location assignment must be done manually in Healthie UI (API limitation)
#
# NowPrimary.Care Schedule:
#   Monday-Friday: 9:00 AM - 5:00 PM
#
# NowMensHealth Schedule:  
#   Monday: 1:00 PM - 6:00 PM
#   Saturday: 9:00 AM - 1:00 PM

# Healthie Workflow Groups
HEALTHIE_PRIMARY_CARE_GROUP_ID=TBD
HEALTHIE_SICK_VISIT_GROUP_ID=TBD
HEALTHIE_PELLETING_GROUP_ID=TBD
HEALTHIE_WEIGHT_LOSS_GROUP_ID=TBD
```

**Next Steps**:
1. ✅ Webhook server deployed and tested
2. ✅ MCP server built (needs Postgres client)
3. ⏳ Add Postgres client to MCP (CRITICAL for data integrity)
4. ⏳ Deploy MCP server with PM2
5. ⏳ Expose MCP via ngrok (port 3002)
6. ⏳ Connect MCP to GHL Jessica agent
7. ⏳ Create NOW Primary Care sub-account
8. ⏳ Configure Ooma phone forwarding
9. ⏳ End-to-end testing with live calls

**Integration Safety Checklist**:
- [ ] MCP queries Postgres FIRST (not Snowflake)
- [ ] MCP never writes to Healthie directly (uses webhooks)
- [ ] MCP respects 6-hour Snowflake lag for analytics
- [ ] All patient IDs resolved from Postgres
- [ ] No PHI in voice responses (dates only)
- [ ] Google Chat notifications for all callback requests


  - Routing accuracy percentage
  - Number of corrections made
  - System uptime
- Alerts if accuracy drops below 80%

**Ooma Fax Integration** (Ready):
- Configure Ooma to forward faxes to `hello@nowoptimal.com`
- AI automatically routes lab/imaging faxes to Clinical Alerts
- PDF attachments extracted for future Healthie upload

**Future Enhancements**:
- PDF text extraction for better AI analysis
- Patient matching (fuzzy match by name/DOB)
- Automatic Healthie chart upload
- Snowflake logging for audit trail
- Email threading and conversation tracking

---

## 🔔 Alert & Notification System

### AI Email Triage System
**Inbox**: `hello@nowoptimal.com` (Google Workspace)  
**Function**: AI-powered email classification and routing to appropriate Google Chat spaces

#### Google Chat Spaces & Webhooks

**1. NOW Ops & Billing**
- **Webhook**: `https://chat.googleapis.com/v1/spaces/AAQAuw3Rvdc/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=DXw_3jUF-tpu-IVQuL2bPj0fC-GuHXJAbwOkKCjGrSA`
- **Routes**: Billing/payments, insurance, claims, appointment no-shows/cancels, intake blockers
- **Keywords**: billing, payment, insurance, authorization, claim, denial, no-show, cancel

**2. NOW Exec/Finance**
- **Webhook**: `https://chat.googleapis.com/v1/spaces/AAQARw60cl0/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=m7E2GmVPaGoNE2mnYyvaRUiEtlRzv9crhs7LqvQmvA8`
- **Routes**: KPIs, revenue, reconciliation, patient complaints, leadership decisions
- **Keywords**: KPI, revenue, forecast, reconciliation, QuickBooks, complaint, executive

**3. NOW Patient Outreach**
- **Webhook**: `https://chat.googleapis.com/v1/spaces/AAQAR7R9T3w/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=A8GwUsPKzf7JEqoMaMA0Ova1gqP98vnePcoSYY03N7A`
- **Routes**: Retention, engagement, human follow-up needed
- **Keywords**: retention, outreach, follow-up, engagement, membership, churn risk

**4. NOW Clinical Alerts**
- **Webhook**: `https://chat.googleapis.com/v1/spaces/AAQANhoAdgo/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=qmp8OHOsnK6mr9ERMnMX4Ejn2wLfYOwWO925dMBxFxI`
- **Routes**: Lab results, vitals, medications, clinical follow-ups
- **Keywords**: lab, vital, clinical, abnormal, out of range, medication, refill

**Routing Logic**: AI analyzes email → classifies with confidence score → posts formatted card to appropriate space → tags suggested assignee
**Goal**: Auto-upload lab results and imaging reports to Healthie patient charts

**Sources Integrated**:
1. **LabGen** (Lab Results)
   - Portal: https://access.labsvc.net/labgen/
   - Credentials: `pschafer` / `xSqQaE1232` ✅ Verified working
   - Browser automation (Playwright)
   - Downloads PDF reports every 15 minutes
   
2. **InteliPACS** (Imaging Reports)
   - Portal: https://images.simonmed.com/Portal/app
   - Credentials: `phil.schafer` / `Welcome123!` ✅ Verified working
   - Browser automation (Playwright)
   - Monitors "Critical" findings tab
   - Downloads STAT priority reports

**Architecture** (LabGen/InteliPACS → S3 → Snowflake → Healthie):
1. **Browser Automation**: Playwright scripts poll both portals every 15 min
2. **S3 Storage**: PDFs stored in `s3://gmh-documents/incoming/{labs|imaging}/`
3. **Snowflake Middleware** (HIPAA-compliant tracking):
   - `document_intake` - Ingestion tracking
   - `patient_matches` - Name/DOB → Healthie patient_id mapping
   - `ai_analysis_results` - Severity scores (1-5 scale)
   - `alert_history` - De-duplication, anti-fatigue
   - `audit_log` - Full HIPAA audit trail
4. **AI Analysis**: Extract patient name/DOB, match to Healthie patient, analyze severity
5. **Healthie Upload**: Auto-upload as "provider-only" (hidden from patient)
6. **Smart Alerts**: Google Chat with tiered severity (prevent alert fatigue)

**Alert Tiers** (Anti-Fatigue Strategy):
- **Level 5 (Critical)**: Immediate Google Chat + Telegram (e.g., K+ >6.5, PE)
- **Level 4 (Urgent)**: Immediate Google Chat (needs <3h attention)
- **Level 3 (Significant)**: Hourly digest (same-day review)
- **Level 2 (Important)**: Daily digest at 8am (24-48h follow-up)
- **Level 1 (Informational)**: No alert, logged to Snowflake only

**De-Duplication**: Snowflake tracks alert history - won't re-alert for same patient/finding in 24h

**Patient Matching**:
- Extract name/DOB from PDF (AWS Textract or pdf-parse)
- Query Snowflake cache first
- Fuzzy match against Healthie patients (Levenshtein distance)
- Confidence ≥0.9 → auto-match, <0.7 → manual review queue
- Cache matches in Snowflake for future speed

**Cost Estimate**:
- AWS Bedrock (AI analysis): ~$75/month (120 reports/day)
- Snowflake (warehouse): ~$60/month (X-Small warehouse)
- S3 storage: ~$1/month (500MB)
- **Total**: ~$135/month (use pdf-parse instead of Textract to save $30)

**Status**: Planning complete, ready for implementation (4 weeks)
**Location**: `/home/ec2-user/.gemini/antigravity/brain/.../document_automation_plan.md`

### Access Labs API Integration ✅ ACTIVE (Jan 2026)

**Purpose**: Direct API integration with Access Medical Labs for real-time lab result retrieval and review.

**API Credentials** (stored in `~/.env.production`):
- `ACCESS_LABS_USERNAME`: pschafer@nowoptimal.com
- `ACCESS_LABS_PASSWORD`: (encrypted)
- **Base URL**: `https://api.accessmedlab.com/apigateway/`

**Scripts** (`/home/ec2-user/scripts/labs/`):
| File | Purpose |
|------|---------|
| `access_labs_client.py` | API client (auth, results, orders) |
| `fetch_results.py` | Cron job - fetches new results every 30 min |
| `generate_lab_pdf.py` | PDF generation using reportlab |
| `lab_s3_storage.py` | S3 upload/download with presigned URLs |
| `healthie_lab_uploader.py` | Uploads PDFs to Healthie patient charts |

**Cron Schedule**: Every 30 minutes
```cron
*/30 * * * * cd /home/ec2-user/scripts/labs && /usr/bin/python3 fetch_results.py >> /var/log/access-labs.log 2>&1
```

**Data Flow**:
1. **Fetch**: Cron polls Access Labs API for new results
2. **Match Patient**: Fuzzy match (Snowflake cache → Healthie direct search)
3. **Generate PDF**: `generate_lab_pdf.py` creates professional PDF with critical value highlighting
4. **Upload to S3**: `gmh-clinical-data-lake/labs/pending/{accession}_{name}.pdf`
5. **Queue for Review**: Added to `/home/ec2-user/gmhdashboard/data/labs-review-queue.json`
6. **Provider Review**: Dashboard at `/ops/labs` shows pending labs
7. **Approve**: PDF uploaded to Healthie (initially hidden), then made visible on approval

**Patient Matching Logic**:
1. Parse Access Labs name format (`PAINTER, BRET` → `Bret Painter`)
2. Query Snowflake `PATIENT_360_VIEW` for fuzzy match (rapidfuzz, token_sort_ratio)
3. If score ≥80%, accept match
4. If score <80%, fall back to direct Healthie API search (`users(keywords: "...")`)
5. Exact match in Healthie required, else flag for manual review

**Key Fields from Snowflake** (`GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW`):
- `HEALTHIE_CLIENT_ID` → used as `healthie_id`
- `PATIENT_NAME` → fuzzy match target
- `DATE_OF_BIRTH` → DOB boost for confidence

**S3 Storage**:
- **Bucket**: `gmh-clinical-data-lake`
- **Pending**: `labs/pending/{accession}_{name}_{uuid}.pdf`
- **Approved**: `labs/approved/{accession}_{name}_{uuid}.pdf`

**Dashboard APIs** (`/app/api/labs/`):
- `GET /api/labs/review-queue` - List pending reviews
- `POST /api/labs/review-queue` - Approve/reject with Healthie upload
- `GET /api/labs/pdf/[id]` - Serve PDF from S3 (presigned URL)

**Critical Value Handling**:
- Severity levels 1-5 based on test abnormality flags
- Critical tests highlighted in PDF
- Google Chat alert for severity ≥4

### Service Health Monitoring (PM2)

**Purpose**: Automatic monitoring of critical PM2 services with Telegram alerts on down/recovery.

**Cron Schedule** (all times MST — cron runs in local timezone):
```cron
# Morning Telegram Report - 8:00am MST
0 8 * * * /home/ec2-user/scripts/cron-alert.sh "Morning Report" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/morning-telegram-report.ts"

# Infrastructure Monitoring - 8:30am MST
30 8 * * * /home/ec2-user/scripts/cron-alert.sh "Infrastructure Monitor" "/usr/bin/python3 /home/ec2-user/scripts/unified_monitor.py"

# Website health check (every 5 min)
*/5 * * * * /home/ec2-user/scripts/website-monitor.sh >> /home/ec2-user/logs/website-monitor.log 2>&1
```

> [!IMPORTANT]
> **Cron uses MST** on this server (`/etc/localtime` → `America/Phoenix`). Use MST hours directly — do NOT convert from UTC.

**Monitored Services**:
- `gmh-dashboard` - Main Next.js app
- `telegram-ai-bot-v2` - Jarvis data query bot
- `upload-receiver` - Scribe audio receiver
- `email-triage` - AI email routing
- `ghl-webhooks` - GHL integration
- `jessica-mcp` - GHL MCP server

**Alerts Sent**:
- 🔴 **Service Down**: When any service status ≠ "online"
- ✅ **Service Recovered**: When previously-down service comes back
- 🔄 **Crash Loop**: When restart count > 5
- 🔥 **High CPU**: When CPU load > 80%
- 💾 **High Memory**: When memory usage > 85%

**Webhook Health Monitoring** (via `uptime-monitor` PM2 service):
- Checks every 60 seconds via system-health API
- **Threshold**: Warning only when `pending > 50` webhooks (normal queue is <30)
- **Grace period**: 10 minutes of continuous degradation before alerting
- **"Payment alerts" warning**: Only shown for actual `error` status (no webhooks in 24h+)
- **Recovery messages**: Only sent if an alert was actually fired (no noise from grace-period clears)

**Resource Thresholds**:
- CPU: 80% (based on load avg / cores)
- Memory: 85%
- Alerts have cooldown - only fire once until recovered

**Daily Reports** (8:00 AM MST):
- **Morning Report** (8:00 AM): Patient overview, revenue, appointments via `morning-telegram-report.ts`
- **Infrastructure Monitor** (8:30 AM): System stats, Snowflake health, AWS costs via `unified_monitor.py`

**Jarvis Bot System Queries**:
Ask the Telegram bot anytime:
- `/status` or `server status` or `system status`
- `cpu usage` / `memory usage` / `disk usage`
- `how's the server` / `check server`

Response includes CPU %, memory %, disk %, swap, PM2 service count, and uptime with color-coded indicators.

**Testing the Monitor**:
```bash
# Manual run
cd /home/ec2-user && python3 scripts/monitoring/health_monitor.py

# Simulate outage (will trigger alert in ~5 min)
pm2 stop telegram-ai-bot-v2
# Wait for alert, then restart
pm2 start telegram-ai-bot-v2
```

**Fix History**:
- **Jan 1, 2026**: Fixed cron log path from `/var/log/` (permission denied) to `/home/ec2-user/logs/`
- **Jan 1, 2026**: Added CPU/memory monitoring with Telegram alerts (80%/85% thresholds)
- **Jan 1, 2026**: Added daily system stats to morning report
- **Jan 1, 2026**: Added Jarvis query capability (`/status`, `cpu usage`, etc.)

---

## 🔧 OPERATIONAL PROCEDURES

### Build & Deploy to Production

**Standard Deployment**:
```bash
# 1. Verify preconditions
df -h /                                    # Check disk space (>2GB free)
pwd                                        # Should be /home/ec2-user/gmhdashboard
pm2 describe gmh-dashboard | grep cwd     # Verify working directory

# 2. Stop application
pm2 stop gmh-dashboard

# 3. Clean build artifacts
rm -rf .next

# 4. Install dependencies (if package.json changed)
npm install

# 5. Build production bundle
npm run build
# Look for "Exit code: 0" at end (ignore TS warnings if ignoreBuildErrors: true)

# 6. Start application
pm2 start gmh-dashboard
# OR if deleted: pm2 start npm --name "gmh-dashboard" -- run start

# 7. Save PM2 state
pm2 save

# 8. Verify deployment
curl -I http://localhost:3011/ops/        # Should: 307 redirect to /ops/login/
pm2 logs gmh-dashboard --lines 10         # Should: show "next start" (not "next dev")
curl -I https://nowoptimal.com/ops/       # Test public URL

# 9. Monitor for errors
pm2 logs gmh-dashboard --lines 50
```

**Emergency Recovery** (if completely broken):
```bash
pm2 stop gmh-dashboard
cd /home/ec2-user/gmhdashboard
rm -rf .next node_modules/.cache
npm install
npm run build
pm2 start gmh-dashboard
pm2 logs gmh-dashboard --lines 50
```

### Nginx Configuration Changes

**Edit config**:
```bash
sudo nano /etc/nginx/conf.d/nowoptimal.conf
```

**Test & reload**:
```bash
sudo nginx -t                  # Test config syntax
sudo systemctl reload nginx    # Apply changes (no downtime)
# OR
sudo systemctl restart nginx   # Full restart (brief downtime)
```

**Key sections**:
```nginx
# Force trailing slash on /ops
location = /ops {
    return 301 /ops/;
}

# Proxy to Next.js (preserve /ops prefix)
location /ops/ {
    proxy_pass http://127.0.0.1:3011;   # NO trailing slash here
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### PM2 Operations

**Check process status**:
```bash
pm2 list                                 # All processes
pm2 describe gmh-dashboard               # Detailed info
pm2 logs gmh-dashboard --lines 50        # Recent logs
pm2 monit                                # Real-time monitoring
```

**Restart specific service**:
```bash
pm2 restart gmh-dashboard
pm2 restart telegram-ai-bot-v2
pm2 restart upload-receiver
```

**Save state** (persist after reboot):
```bash
pm2 save
pm2 startup                              # Generate startup script
```

**Current services**:
- `gmh-dashboard` (port 3011) - Next.js dashboard
- `telegram-ai-bot-v2` - Conversational AI for data queries
- `upload-receiver` (port 3001) - Scribe audio file receiver
- `ghl-webhooks` (port 3003) - GoHighLevel integration
- `jessica-mcp` (port 3002) - MCP server
- `email-triage` - AI email routing
- `fax-processor` - Incoming fax processor
- `nowprimary-website` (port 3004) - Primary Care site
- `nowmenshealth-website` (port 3005) - Men's Health site
- `nowoptimal-website` (port 3008) - NowOptimal parent site
- `uptime-monitor` - PM2 service and website health monitoring

### Environment Variables

**Location**: `/home/ec2-user/gmhdashboard/.env.local`

**Critical vars**:
```bash
# Next.js
NEXT_PUBLIC_BASE_PATH=/ops
NODE_ENV=production

# Healthie
HEALTHIE_API_KEY=gh_live_...
HEALTHIE_API_URL=https://api.gethealthie.com/graphql
NEXT_PUBLIC_HEALTHIE_TOKEN=gh_live_...   # For client components

# QuickBooks
QUICKBOOKS_CLIENT_ID=...
QUICKBOOKS_CLIENT_SECRET=...
QUICKBOOKS_REDIRECT_URI=https://nowoptimal.com/ops/api/auth/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=production
QUICKBOOKS_REALM_ID=9130349088183916

# Database
DATABASE_HOST=clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com
DATABASE_PORT=5432
DATABASE_NAME=postgres
DATABASE_USER=clinicadmin
DATABASE_PASSWORD=...
DATABASE_SSLMODE=require

# Snowflake (use JARVIS_SERVICE_ACCOUNT — key-pair auth)
SNOWFLAKE_ACCOUNT=KXWWLYZ-DZ83651
SNOWFLAKE_SERVICE_USER=JARVIS_SERVICE_ACCOUNT
SNOWFLAKE_PRIVATE_KEY_PATH=/home/ec2-user/.snowflake/rsa_key_new.p8
SNOWFLAKE_WAREHOUSE=GMH_WAREHOUSE
SNOWFLAKE_DATABASE=GMH_CLINIC
SNOWFLAKE_SCHEMA=FINANCIAL_DATA
# NOTE: Old user 'tinetio123' is blocked by MFA — do NOT use password auth

# Auth
SESSION_SECRET=...                       # HMAC signing key

# Telegram (for bots)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
TELEGRAM_AUTHORIZED_CHAT_IDS=...

# AWS (for Scribe)
AWS_REGION=us-east-1
ANTHROPIC_API_KEY=...
DEEPGRAM_API_KEY=...
```

**After changing env vars**:
```bash
pm2 restart gmh-dashboard
# PM2 reloads .env.local automatically
```

---

## 🧩 CRITICAL CODE PATTERNS

### Base Path Usage (MANDATORY)

**Problem**: App runs at `/ops` prefix, not root `/`

**Solution**: Use helpers from `lib/basePath.ts`

**Client-side fetch (MUST use withBasePath)**:
```typescript
import { withBasePath } from '@/lib/basePath';

// ❌ WRONG - will 404
fetch('/api/admin/quickbooks/sync', { method: 'POST' });

// ✅ CORRECT
fetch(withBasePath('/api/admin/quickbooks/sync'), { method: 'POST' });
```

**Building public redirect URLs**:
```typescript
// In API routes (OAuth callback, etc.)
function getPublicUrl(path: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://nowoptimal.com';
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return `${baseUrl}${basePath}${path}`;
}

// ❌ WRONG - creates localhost URLs
return NextResponse.redirect(new URL('/admin/quickbooks', request.url));

// ✅ CORRECT
return NextResponse.redirect(getPublicUrl('/admin/quickbooks?success=true'));
```

**Server components & <Link>** (automatic):
```tsx
// These work automatically (Next.js handles basePath):
import Link from 'next/link';
<Link href="/admin/quickbooks">QuickBooks</Link>  // ✅ Works

import { redirect } from 'next/navigation';
redirect('/login');  // ✅ Works
```

### React Hydration Prevention

**Problem**: Browser extensions inject scripts, causing SSR/client mismatch

**Solution**: Client-side rendering guard

```typescript
'use client';
import { useState, useEffect } from 'react';

export default function MyForm() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Return placeholder during SSR
  if (!mounted) {
    return <div style={{ minHeight: '300px' }} />;
  }

  // Render actual content only on client
  return <form>...</form>;
}
```

### Type-Safe Data Formatting

**Problem**: API responses sometimes return numbers as strings

**Solution**: Defensive formatting

```typescript
// ❌ UNSAFE - crashes if val is string
function formatCurrency(val: number): string {
  return `$${val.toFixed(2)}`;
}

// ✅ SAFE
function formatCurrency(val: number | string | null | undefined): string {
  const num = Number(val);
  return Number.isFinite(num) ? `$${num.toFixed(2)}` : '$0.00';
}

function formatNumber(val: number | string | null | undefined): string {
  const num = Number(val);
  return Number.isFinite(num) ? num.toLocaleString() : '0';
}
```

### UTC Date Formatting (Hydration-Safe)

**Problem**: `toLocaleString()` varies by server/client timezone

**Solution**: UTC-based formatter

```typescript
function safeDateFormat(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'N/A';
  
  try {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(d.getTime())) return 'Invalid Date';
    
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    
    return `${mm}-${dd}-${yyyy}`;
  } catch {
    return 'Error';
  }
}
```

### Healthie Rate Limiting (MANDATORY — Feb 19, 2026)

> [!CAUTION]
> **Healthie rate limits are CREDENTIAL-BASED (API) and IP-BASED (portal). Once triggered, ALL access fails for 30-60+ minutes. VPN does NOT help for API bans. There is NO workaround except waiting.**

**Two types of rate limits:**

| Type | Scope | Trigger | Duration | Affects |
|------|-------|---------|----------|--------|
| **API** | API key | 39+ rapid GraphQL requests | 30-60 min | All API calls with that key |
| **Portal/Website** | IP address | Rapid browser requests to `secure.gethealthie.com` | 30-60 min | Browser access from server |

**Incident (Feb 18, 2026)**: AI assistant's browser subagent opened Healthie portal pages repeatedly on the **local workstation** while debugging errors, triggering an IP-based ban on `secure.gethealthie.com` from the user's local IP (not the EC2 server). Ban persisted 24+ hours — may require Healthie support to lift.

**Mandatory Rules:**

1. **NEVER** use raw `fetch()` for Healthie GraphQL — use one of:
   - `HealthieClient` (automatically rate-limited via `lib/healthieRateLimiter.ts`)
   - `healthieGraphQL()` from `lib/healthieApi.ts` (standalone wrapper)
2. **NEVER** open Healthie portals (`secure.gethealthie.com`) in browser automation tools unless absolutely necessary
3. **For batch scripts**: Always add `await healthieRateLimiter.acquire()` before each request
4. **For new API routes**: Import from `@/lib/healthieApi` instead of hardcoding fetch calls

**Rate Limiter Utility** (`lib/healthieRateLimiter.ts`):
- Token-bucket: 5 requests/second (well under 250/s limit)
- Queue-based: requests wait their turn, never dropped
- 429 auto-backoff: 60-second pause on HTTP 429
- Singleton: one limiter per process, all callers share it

```typescript
// In HealthieClient — already integrated, no action needed
// graphql() method calls healthieRateLimiter.acquire() before every request

// For standalone API routes — use the shared wrapper:
import { healthieGraphQL } from '@/lib/healthieApi';

const data = await healthieGraphQL<{ users: User[] }>(
  `query { users(offset: 0, limit: 10) { id first_name } }`
);

// For batch scripts — acquire manually:
import { healthieRateLimiter } from '@/lib/healthieRateLimiter';

for (const item of items) {
  await healthieRateLimiter.acquire();
  await fetch(...);
}
```

**Key Files:**
| File | Purpose |
|------|---------|
| `lib/healthieRateLimiter.ts` | Token-bucket singleton (5 req/s, 429 backoff) |
| `lib/healthieApi.ts` | Shared `healthieGraphQL()` wrapper (auth + rate limit + errors) |
| `lib/healthie.ts` | `HealthieClient.graphql()` — integrated with rate limiter |

---

## 🔍 TROUBLESHOOTING

### ⚠️ Node.js / npx Does NOT Work on This Server

**Symptom**: Running `node -e "..."` or `npx tsx ...` hangs indefinitely or produces no output.

**Cause**: The EC2 instance's Node.js installation is unreliable for ad-hoc CLI scripting. `npx` commands frequently hang.

**Solution**: **Use Python instead** for all ad-hoc scripts, database queries, and one-off tasks:
```bash
# ❌ DON'T — hangs or crashes
node -e "const fs = require('fs'); console.log(fs.readFileSync('file.txt','utf8'))"
npx tsx script.ts

# ✅ DO — works reliably
python3 -c "print(open('file.txt').read())"
python3 script.py
```

> **Note**: Node.js works fine inside PM2-managed services (gmh-dashboard, telegram-ai-bot, etc.) and for `npm run build`. It's only the ad-hoc CLI usage that hangs.

### Dashboard Not Accessible

**Symptom**: `https://nowoptimal.com/ops/` returns error

**Check**:
```bash
# 1. Is PM2 running?
pm2 list
# Should show: gmh-dashboard (online)

# 2. Is Next.js responding?
curl -I http://localhost:3011/ops/
# Should: 307 redirect to /ops/login/

# 3. Is Nginx running?
sudo systemctl status nginx
# Should: active (running)

# 4. Check PM2 logs
pm2 logs gmh-dashboard --lines 50
# Look for: errors, "next start", port 3011

# 5. Check Nginx logs
sudo tail -50 /var/log/nginx/error.log
```

**Common fixes**:
- PM2 stopped: `pm2 start gmh-dashboard`
- Build corrupted: See "Emergency Recovery" above
- Nginx misconfigured: `sudo nginx -t` then fix errors

### QuickBooks OAuth 404

**Symptom**: `/ops/api/auth/quickbooks/` returns 404

**Check**:
```bash
# 1. Do route files exist?
ls -la app/api/auth/quickbooks/route.ts
ls -la app/api/auth/quickbooks/callback/route.ts
# Should: both exist

# 2. Is build up-to-date?
ls -la .next/server/app/api/auth/quickbooks/
# Should: route.js exists

# 3. Test route
curl -I http://localhost:3011/ops/api/auth/quickbooks/
# Should: 307 redirect to appcenter.intuit.com
```

**Fix**: Rebuild application (`npm run build && pm2 restart gmh-dashboard`)

### Redirect Loop (ERR_TOO_MANY_REDIRECTS)

**Symptom**: Browser shows "redirected too many times"

**Check**:
```bash
# 1. Verify trailingSlash setting
grep trailingSlash next.config.js
# Should: trailingSlash: true

# 2. Test redirect behavior
curl -I http://localhost:3011/ops
# Should: 308 redirect to /ops/

curl -I http://localhost:3011/ops/
# Should: 307 redirect to /ops/login/ (or 200 if logged in)

# 3. Check Nginx config
grep -A5 "location = /ops" /etc/nginx/conf.d/nowoptimal.conf
# Should: return 301 /ops/;
```

**Fix**: Ensure `trailingSlash: true` in `next.config.js`, rebuild

### Disk Space Full

**Symptom**: npm commands fail silently, builds corrupt

**Check**:
```bash
df -h /
# Usage should be <90%
```

**Clean**:
```bash
# npm logs (often 100s of MB)
rm -rf ~/.npm/_logs/*

# Old PM2 logs
find ~/.pm2/logs -name "*.log" -mtime +7 -delete

# Docker (if not using)
sudo docker system prune -f
```

**Expand** (if needed):
```bash
# AWS Console → EC2 → Volumes → Modify → Increase size → Save
# Then on server:
sudo growpart /dev/nvme0n1 1
sudo xfs_growfs -d /
df -h /
```

### Scribe System Not Processing

**Symptom**: Audio uploaded but no Telegram messages

**Check**:
```bash
# 1. Is receiver running?
pm2 list | grep upload-receiver
# Should: online

# 2. Check receiver logs
pm2 logs upload-receiver --lines 20

# 3. Check scribe logs
tail -50 /tmp/scribe_orchestrator.log
tail -50 /tmp/scribe_document_generation.log

# 4. Test Telegram bot
cd /home/ec2-user/scripts/scribe
python3 -c "import telegram; bot = telegram.Bot(token='$TELEGRAM_BOT_TOKEN'); print(bot.get_me())"
# Should: show bot info
```

**Common fixes**:
- Receiver crashed: `pm2 restart upload-receiver`
- Missing env vars: Check `scripts/scribe/.env`
- Telegram token invalid: Verify with BotFather

### Snowflake Sync Failing

**Symptom**: Stale data in Metabase dashboards

**Check**:
```bash
# 1. Check last sync
tail -50 /home/ec2-user/logs/snowflake-sync.log
# Look for: "✅ SYNC COMPLETE", errors

# 2. Test Snowflake connection (use key-pair auth)
python3 << 'EOF'
import snowflake.connector
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
with open('/home/ec2-user/.snowflake/rsa_key_new.p8', 'rb') as f:
    p_key = serialization.load_pem_private_key(f.read(), password=None, backend=default_backend())
pkb = p_key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
conn = snowflake.connector.connect(
    account='KXWWLYZ-DZ83651',
    user='JARVIS_SERVICE_ACCOUNT',
    private_key=pkb,
    warehouse='GMH_WAREHOUSE',
    database='GMH_CLINIC'
)
print("Connected:", conn.cursor().execute("SELECT CURRENT_USER()").fetchone())
EOF

# 3. Run manual sync
cd /home/ec2-user
node scripts/sync-healthie-ops.js
```

**Fix**: Check env vars, verify Snowflake credentials, review sync logs

---

## 📚 REFERENCE: FILE LOCATIONS

### Configuration Files
- **Next.js**: `next.config.js` (trailingSlash, basePath, typescript ignore)
- **Env**: `.env.local` (all secrets)
- **PM2**: `/home/ec2-user/ecosystem.config.js` (process definitions — root level)
- **Nginx**: `/etc/nginx/conf.d/nowoptimal.conf` (reverse proxy)
- **TypeScript**: `tsconfig.json` (TS compiler config)
- **Package**: `package.json` (dependencies, scripts)

### Key Source Files
- **Auth**: `lib/auth.ts` (sessions, cookies, roles)
- **Database**: `lib/db.ts` (Postgres pool)
- **Base Path**: `lib/basePath.ts` (withBasePath, getBasePath)
- **QuickBooks**: `lib/quickbooks.ts` (API client)
- **Healthie**: `lib/healthie.ts` (GraphQL client)
- **Main Dashboard**: `app/page.tsx` (composite data aggregation)
- **Layout**: `app/layout.tsx` (navigation, auth check)

### OAuth Routes (NEW Dec 28)
- **Initiation**: `app/api/auth/quickbooks/route.ts`
- **Callback**: `app/api/auth/quickbooks/callback/route.ts`

### Scribe System (NEW Dec 25-27)
**Location**: `/home/ec2-user/scripts/scribe/` (ROOT level, not in gmhdashboard)
- **Orchestrator**: `/home/ec2-user/scripts/scribe/scribe_orchestrator.py`
- **Telegram UI**: `/home/ec2-user/scripts/scribe/telegram_approver.py`
- **Document Gen**: `/home/ec2-user/scripts/scribe/document_generators.py`
- **Prompts**: `/home/ec2-user/scripts/scribe/prompts_config.yaml`
- **Receiver**: `/home/ec2-user/scripts/scribe/upload_receiver.js` (PM2 service)
- **Docs**: `/home/ec2-user/scripts/scribe/{SETUP,SAFETY_GUIDE,PROMPT_CUSTOMIZATION}.md`

### Sync Scripts
- **Healthie Ops**: `scripts/sync-healthie-ops.js` (every 6 hours)
- **Healthie Invoices**: `scripts/sync-healthie-invoices.ts`
- **Healthie Providers**: `scripts/sync-healthie-providers.ts`
- **Billing Items**: `scripts/ingest-healthie-financials.ts`
- **Scribe Sync**: `scripts/scribe/healthie_snowflake_sync.py` (hourly)

### Documentation
- **This file**: `ANTIGRAVITY_SOURCE_OF_TRUTH.md` (master reference)
- **Copilot**: `.github/copilot-instructions.md` (GitHub Copilot specific)
- **README**: Various MD files in root (architecture, deployment, etc.)

---

## 🎯 DEVELOPMENT GUIDELINES

### Code Style
- **Imports**: Use `@/` path alias (e.g., `@/lib/db`)
- **TypeScript**: Strict mode enabled, use types (but `ignoreBuildErrors: true` for now)
- **Components**: Prefer server components unless state/effects needed
- **API**: Use `lib/db.ts` `query()` helper, never open new pools
- **Auth**: Use `requireUser(role)` server-side, `userHasRole(user, role)` client-side

### Commit Messages
- Start with category: `[fix]`, `[feat]`, `[refactor]`, `[docs]`, `[deploy]`
- Be specific: `[fix] QuickBooks OAuth callback redirect to localhost`
- Include context: `[feat] AI Scribe Telegram approval workflow`

### Testing Before Deploy
1. **Local dev test**: `npm run dev` → Test at `http://localhost:3000/ops/` (dev uses port 3000; production uses 3011)
2. **Build test**: `npm run build` → Check for `Exit code: 0`
3. **Type check**: `npm run lint` (optional, we ignore TS errors in build)
4. **Env check**: Verify `.env.local` has all required vars
5. **Disk check**: `df -h /` → >2GB free

### Deployment Checklist
- [ ] Changes tested locally (`npm run dev`)
- [ ] Build succeeds (`npm run build`)
- [ ] No secrets in code (only in `.env.local`)
- [ ] PM2 working directory correct (`/home/ec2-user/gmhdashboard`)
- [ ] Disk space sufficient (`df -h /` → >2GB)
- [ ] Environment vars match production needs
- [ ] PM2 restarted (`pm2 restart gmh-dashboard`)
- [ ] Logs checked (`pm2 logs gmh-dashboard`)
- [ ] Public URL tested (`https://nowoptimal.com/ops/`)

---

## 🚀 QUICK COMMANDS REFERENCE

### Deployment
```bash
cd /home/ec2-user/gmhdashboard
npm run build
pm2 restart gmh-dashboard
pm2 logs gmh-dashboard --lines 20
```

### Check Status
```bash
pm2 list                                 # All services
df -h /                                  # Disk space
curl -I http://localhost:3011/ops/       # Local test
curl -I https://nowoptimal.com/ops/      # Public test
```

### View Logs
```bash
pm2 logs gmh-dashboard --lines 50        # Dashboard logs
tail -50 /tmp/scribe_orchestrator.log    # Scribe logs
tail -50 /home/ec2-user/logs/snowflake-sync.log  # Sync logs
sudo tail -50 /var/log/nginx/error.log   # Nginx errors
```

### Cleanup
```bash
rm -rf ~/.npm/_logs/*                                    # npm logs
find ~/.pm2/logs -name "*.log" -mtime +7 -delete         # Old PM2 logs
sudo docker system prune -f                              # Docker cleanup
```

### Nginx
```bash
sudo nginx -t                            # Test config
sudo systemctl reload nginx              # Apply changes
sudo systemctl status nginx              # Check status
```

### Snowflake
```bash
cd /home/ec2-user
node scripts/sync-healthie-ops.js        # Manual sync
tail -50 logs/snowflake-sync.log         # Check last sync
```

### Scribe
```bash
pm2 restart upload-receiver              # Restart receiver
tail -50 /tmp/scribe_*.log               # All scribe logs
cd /home/ec2-user/scripts/scribe && python3 scribe_orchestrator.py test.m4a
```

---

## 📞 INTEGRATION ENDPOINTS

### Healthie
- **GraphQL**: `https://api.gethealthie.com/graphql`
- **Auth**: `Authorization: Basic <raw API key>` (NOT Base64 encoded)
- **Headers**: `AuthorizationSource: API`
- **Rate Limiter**: `lib/healthieRateLimiter.ts` (5 req/s, 429 backoff) — see Critical Code Patterns

### QuickBooks
- **OAuth**: `https://appcenter.intuit.com/connect/oauth2`
- **Token**: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
- **API**: `https://quickbooks.api.intuit.com/v3/company/{realmId}/...`

### Snowflake
- **Account**: `KXWWLYZ-DZ83651`
- **Region**: `us-east-1`
- **Warehouse**: `GMH_WAREHOUSE`

### Telegram
- **API**: `https://api.telegram.org/bot{TOKEN}/...`
- **Webhook**: (not used, polling mode)

---

## 🔐 SECURITY NOTES

### Never Commit
- `.env.local` (secrets)
- PM2 config with env vars
- Database credentials
- API keys/tokens
- Session secrets

### Cookie Security
- Name: `gmh_session_v2`
- Flags: `httpOnly`, `secure` (prod), `sameSite: 'lax'`
- Path: `/ops/` (matches base path)
- Signing: HMAC with `SESSION_SECRET`

### OAuth Security
- State parameter (CSRF protection)
- Stored in httpOnly cookie
- Validated on callback
- 10-minute expiry

---

## 🎓 LEARNING RESOURCES

### Next.js 14 App Router
- **Docs**: https://nextjs.org/docs/app
- **Server Components**: Default, use `'use client'` only when needed
- **API Routes**: `app/api/**/route.ts`
- **Base Path**: https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath

### Healthie API
- **GraphQL Docs**: https://docs.gethealthie.com/reference/2024-06-01
- **Webhooks**: https://docs.gethealthie.com/docs/webhooks

#### Healthie API Behavior Notes (Updated Feb 19, 2026)

**Rate Limits** (CRITICAL):
- **General API**: 250 requests/second (official), but 39+ burst requests trigger 30-60 min lockout
- **Safe limit**: 5 requests/second (enforced by `lib/healthieRateLimiter.ts`)
- **API bans**: Credential-based (follows API key, not IP)
- **Portal bans**: IP-based (browser access to `secure.gethealthie.com`)
- **Recovery**: Wait 30-60 minutes, no workaround
- **Utility**: All code MUST use `healthieRateLimiter` — see Critical Code Patterns section

**Pagination Limits**:
- API returns max 10 patients per query
- Use keyword-based search (a-z, 0-9 patterns) to fetch all patients

**Location Field (CAUTION)**:
- `updateClient` mutation with `location` object **ADDS** new addresses, doesn't update existing
- This causes duplicate address entries (e.g., Fred Fernow had 5 identical addresses)
- **Workaround**: Skip Healthie address updates, sync addresses via GHL and GMH Dashboard instead

**Duplicate Patient Handling**:
- `mergeClients` mutation exists but consistently returns "Object not found" error
- **Workaround**: Use `updateClient(active: false)` to deactivate duplicates instead
- Keep patient with group assignment, deactivate ungrouped duplicate

**Patient Sync Script**: `/home/ec2-user/scripts/scribe/sync_jane_to_systems.py`
- Syncs patient data from Jane EMR import → Healthie, GHL, GMH Dashboard
- Uses `GHL_MENS_HEALTH_API_KEY` for Men's Health location access
- Fallback to `/contacts/upsert` for GHL duplicate contact errors

### QuickBooks API
- **OAuth 2.0**: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- **Accounting API**: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/account

### Snowflake
- **Docs**: https://docs.snowflake.com/
- **Snowpipe**: https://docs.snowflake.com/en/user-guide/data-load-snowpipe

---

## 📋 APPENDIX: COMMON QUERIES

### Find Patient in Healthie
```typescript
import { query } from '@/lib/db';

const patients = await query(
  `SELECT patient_id, patient_name, healthie_client_id 
   FROM patient_data_entry_v 
   WHERE patient_name ILIKE $1 
   LIMIT 10`,
  [`%${searchTerm}%`]
);
```

### Check QuickBooks Connection
```typescript
import { getQuickBooksClient } from '@/lib/quickbooks';

const qb = await getQuickBooksClient();
const companyInfo = await qb.getCompanyInfo();
// Returns: { CompanyName, LegalName, ... }
```

### Query Snowflake from Script
```python
import snowflake.connector
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
import os

with open(os.path.expanduser('~/.snowflake/rsa_key_new.p8'), 'rb') as f:
    p_key = serialization.load_pem_private_key(f.read(), password=None, backend=default_backend())
pkb = p_key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())

conn = snowflake.connector.connect(
    account='KXWWLYZ-DZ83651',
    user='JARVIS_SERVICE_ACCOUNT',
    private_key=pkb,
    warehouse='GMH_WAREHOUSE',
    database='GMH_CLINIC',
    schema='PATIENT_DATA'
)

cursor = conn.cursor()
cursor.execute("SELECT COUNT(*) FROM PATIENTS")
print(cursor.fetchone()[0])
```

---

**End of Source of Truth Document**

*For questions or clarifications, review this document first. If still unclear, check:*
1. *PM2 logs: `pm2 logs gmh-dashboard`*
2. *Scribe logs: `/tmp/scribe_*.log`*
3. *Sync logs: `/home/ec2-user/logs/snowflake-sync.log`*
4. *Nginx logs: `/var/log/nginx/error.log`*

*This document is maintained by AntiGravity AI Assistant and should be updated after major changes.*

---

## ⚠️ DEPRECATED / REMOVED SYSTEMS

### ClinicSync Integration (REMOVED Dec 28, 2025)
**Status**: Fully deprecated and removed  
**Reason**: API stopped working, inefficient system  
**Replaced By**: Healthie (primary clinical source) + Snowflake (data warehouse)

**What Was Removed**:
- API integration code (874 file references)
- Webhook endpoints (`/api/integrations/clinicsync`)
- Admin UI pages (`/app/admin/clinicsync`)
- Library files (`lib/clinicsync.ts`, `lib/clinicsyncConfig.ts`)

**What Was Preserved**:
- Patient data (307 patients in `patients` table - NOT affected)
- Historical mapping data (archived tables: `clinicsync_*` marked deprecated)

**Migration Path**: All clinical data now sourced from Healthie GraphQL API  
**Cleanup Log**: See `CLEANUP_LOG_DEC28_2025.md` for detailed removal process

---

### December 28, 2025: Emergency Fixes & Infrastructure Hardening

**Database Schema Emergency**: AWS CloudWatch detected 60 errors for missing objects. Created `quickbooks_connection_health` table and `created_at` column in `clinicsync_webhook_events`. Migration: `sql/migrations/20251228_fix_missing_schema_objects.sql`.

**Server Timeout Root Cause**: Memory exhaustion (88% used, no swap). Created 4GB swap file as safety net. Recommendation: upgrade to t3.large (16GB RAM).

**Snowflake Cost Optimization**: Warehouse was running 24/7 ($500-720/month). Set `AUTO_SUSPEND=60` and `AUTO_RESUME=TRUE`. Savings: $400-625/month (80-95% reduction). Current: $30-95/month.

**React Hydration Errors**: Fixed 12 components using `formatDateUTC()` instead of `toLocaleDateString()`. Created `lib/dateUtils.ts`.

**LabGen & InteliPACS Credentials**:
- LabGen: `pschafer` (see `.env.local` for password)
- InteliPACS: `phil.schafer` (see `.env.local` for password)

---

### Stale Snowflake Sync Incident (Jan 2026)

**Issue**: Patient missing from Snowflake, causing AI Scribe to fail patient identification.
**Root Cause**: `sync-healthie-ops.js` was crashing due to SQL column errors. Data stale since Dec 22, 2025.
**Fix**: Refactored sync script, created `scripts/import_specific_patient.ts` for surgical imports, added `AuthorizationSource: API` header.
**Current Status**: Resolved — unified Python sync (`sync-all-to-snowflake.py`) now handles all tables every 4 hours.

---

## 📱 Headless Mobile App (NOWOptimal Patient App)

**Full SOT**: `/home/ec2-user/.gemini/antigravity/scratch/nowoptimal-headless-app/HEADLESS_APP_SOURCE_OF_TRUTH.md` (704 lines)  
**Codebase**: `/home/ec2-user/.gemini/antigravity/scratch/nowoptimal-headless-app/`  
**Status**: Phase 14 Complete — Billing, Forms, Journal & Metrics Polish  
**Google Play**: Health declaration updated Feb 15, 2026  
**Deployed API**: `https://o6rhh3wva6.execute-api.us-east-2.amazonaws.com/prod/`

### Architecture Overview

React Native / Expo mobile app → API Gateway → AWS Lambda → Healthie GraphQL + Snowflake + GMH Dashboard APIs

```
Backend (4 Lambdas):
├── lambda-auth-node/     → Patient login via Healthie signIn + access-check gate
├── lambda-booking/       → 33 actions (booking, forms, chat, billing, metrics, etc.)
├── lambda-data-pipe-python/ → Webhook → Snowflake pipeline
└── lambda-ask-ai/        → RAG: Snowflake PATIENT_360_VIEW + Gemini 2.0 Flash

Frontend (React Native / Expo):
├── 18 screens, 5 components, Chameleon branding engine
├── Auth via SecureStore (token persistence)
└── Dynamic theming by Healthie group ID
```

### Critical Config IDs (from `config.js`)

| Config | Men's Health | Primary Care |
|--------|-------------|-------------|
| **Group ID** | `75522` | `75523` |
| **Location ID** | `13029260` | `13023235` |
| **Provider ID** | `12093125` (Dr. Whitten) | `12088269` (Phil Schafer NP) |
| **Brand** | Red/Black | Navy/Green |

### Authentication & Access Control Flow

1. Patient → API Gateway → `lambda-auth` → Healthie `signIn` mutation
2. Auth Lambda calls **`/api/headless/access-check?healthie_id=X`** on GMH Dashboard
3. If `allowed: false` (403) → login blocked with revoke/suspend message
4. If access-check unreachable → login proceeds (graceful fallback)
5. Token stored in `SecureStore`, sent as Bearer on all API calls

**Access-check URL**: `ACCESS_CHECK_URL = process.env.ACCESS_CHECK_URL || 'https://nowoptimal.com/ops/api/headless/access-check/'`

### Server-Side Endpoints (in this repo: `app/api/headless/`)

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/headless/access-check` | GET | Returns `{ allowed: true/false }` | Healthie ID |
| `/api/headless/lab-status` | GET | Returns next_lab_date, urgency | Healthie ID + access check |
| `/api/headless/update-avatar` | POST | Stores avatar URL from Lambda | None (Lambda only) |

**Access Control Library**: `lib/appAccessControl.ts` (441 lines)  
**DB Table**: `app_access_controls` (migration: `20260214_app_access_controls.sql`)

### Lambda Actions (33 in booking Lambda)

| Action | Purpose |
|--------|---------|
| `get_slots`, `create_appointment`, `confirm_appointment`, `cancel_appointment` | Booking |
| `get_pending_forms`, `get_form_schema`, `submit_form`, `get_form_history`, `get_form_answers` | Forms |
| `get_conversations`, `get_messages`, `send_message` | Chat |
| `get_profile`, `update_profile`, `get_upload_url`, `update_avatar` | Profile |
| `get_upcoming_appointments`, `get_appointment_types`, `get_documents` | Records |
| `get_journal_entries`, `create_journal_entry`, `update_journal_entry`, `delete_journal_entry` | Journal |
| `get_metrics`, `add_metric_entry` | Health Metrics |
| `get_billing_items`, `get_payment_methods`, `add_payment_method`, `delete_payment_method`, `set_default_payment_method` | Billing |
| `get_lab_status`, `get_dashboard_alerts`, `get_dashboard_stats` | Dashboard |

### Healthie API Gotchas (CRITICAL)

> **`client_id` vs `user_id`**: Healthie uses DIFFERENT argument names for the same patient ID. Using the wrong one **silently returns empty arrays**:
> - `entries()`, `documents()`, `conversationMemberships()` → `client_id`
> - `appointments()`, `requestedFormCompletions()` → `user_id`
> - `user()` → `id`

> **Date Format**: Healthie returns `"2026-01-30 12:15:00 -0700"` — does NOT work with `new Date()`. Convert to ISO: `${parts[0]}T${parts[1]}${parts[2]}`

> **GraphQL type quirk**: `$client_id: String` (NOT `ID`) for entries/metrics queries

> **createFormAnswerGroup**: Must include `finished: true` or submission stays as draft

> **createEntry** (journal): Uses `poster_id` (NOT `user_id`) in input

> **Slot availability**: Do NOT pass `location_id` to `availableSlotsForRange` — causes field error

### CDK vs. Live Infrastructure

| Lambda | CDK Timeout | Live Override |
|--------|------------|--------------|
| Auth | 10s | — |
| Booking | 15s | **30s / 256MB** |
| Data Pipe | 30s | — |
| Ask AI | 60s | — |

> ⚠️ Running `cdk deploy` will revert booking Lambda to 15s/128MB. Update CDK stack first.

### Known Issues

1. **Healthie sync can fail silently** — `healthie_synced` may be `false` while `access_status` shows `revoked`. Verify via Healthie API directly.
2. **Multiple Healthie IDs per patient** — 2 patients have duplicate active Healthie client mappings. Revoking one doesn't block the others.
3. **CDK stack out of sync** with live Lambda configuration (see table above).

### Journal & Metrics Formatting (Feb 26, 2026)

Healthie `entries` API returns raw `metric_stat` as a single number with no units or formatting. The app now applies smart formatting based on `category`:

| Category | Raw Value | Formatted Display |
|----------|-----------|------------------|
| Blood Pressure | `13686` | `136/86 mmHg` (split by digit count) |
| Weight | `190` | `190 lbs (86.2 kg)` |
| Height (in.) | `70` | `5'10" (177.8 cm)` |
| Sleep | `8.5` | `8.5 hours` |
| Steps | `10432` | `10,432 steps` |
| Heart Rate | `72` | `72 bpm` |

Formatting functions: `formatBloodPressure()`, `formatWeight()`, `formatHeight()`, `formatMetricValue()`, `safeParseDate()`

> **Height gotcha**: If Healthie returns a value ≤ 7, the formatter assumes it's in feet (not inches) and multiplies by 12. Values > 12 are treated as inches.

---

## 🌐 NOW Optimal Websites & Brand System

**Monorepo**: `/var/www/nowoptimal-websites/` (Git-managed)  
**Standalone NowPrimary**: `/home/ec2-user/nowprimarycare-website/`  
**Brand Data**: `/home/ec2-user/.tmp/brand-reports/` (JSON palette extractions)  
**All sites**: Next.js + Tailwind CSS, served via Nginx reverse proxy

### Website Portfolio

| Site | Domain | Port | PM2 Name | Stack |
|------|--------|------|----------|-------|
| NOW Optimal (Hub) | nowoptimal.com | 3000 | `nowoptimal` | Next.js |
| NOW Primary Care | nowprimary.care | 3001 | `nowprimary` | Next.js |
| NOW Men's Health | nowmenshealth.care | 3002 | `nowmenshealth` | Next.js |
| NOW Mental Health | nowmentalhealth.care | 3003 | `nowmentalhealth` | Next.js |

**Ecosystem Config**: `/var/www/nowoptimal-websites/ecosystem.config.js`  
**Deploy Script**: `/var/www/nowoptimal-websites/deploy.sh`

> [!WARNING]
> There is a **standalone NowPrimary.Care** at `/home/ec2-user/nowprimarycare-website/` — this is the version with Healthie booking integration (8 appointment types, BookingWidget). The one in `/var/www/nowoptimal-websites/nowprimary-website/` is the older static version. Be careful which one you're editing.

### Brand Color System (Extracted from Live Sites)

#### NOW Optimal Network (Hub)
| Role | Hex | CSS Variable | Description |
|------|-----|-------------|-------------|
| Primary | `#0C141D` | — | Dark navy background |
| Secondary | `#00D4FF` | `--brand-cyan` | Cyan accent |
| Surface | `#111827` | `--brand-surface` | Card/surface background |
| Card | `#1F2937` | `--brand-card` | Elevated card background |
| Purple | `#7C3AED` | `--brand-purple` | Feature accent |
| Navy | `#0A0E1A` | `--brand-navy` | Deep dark background |

#### NOW Men's Health
| Role | Hex | CSS Variable | Description |
|------|-----|-------------|-------------|
| Primary | `#0A1118` | — | Dark background |
| Brand Red | `#DC2626` | `--brand-red` | Primary action/accent |
| Red Dark | `#B91C1C` | `--brand-red-dark` | Hover states |
| Red Light | `#EF4444` | `--brand-red-light` | Highlights |
| Gray | `#1A1A1A` | `--brand-gray` | Surface |
| Black | `#000000` | `--brand-black` | Deep background |
| White | `#FFFFFF` | `--brand-white` | Text/contrast |

#### NOW Primary Care
| Role | Hex | CSS Variable | Description |
|------|-----|-------------|-------------|
| Primary | `#060F6A` | — | Deep navy blue (logo) |
| Green | `#00A550` | `--tw-gradient-from` | CTA gradient start |
| Light Blue | `#E8F0F5` | — | Background / light surface |
| Cyan | `#25C6CA` | — | Accent (from NOWOptimal logo) |

#### Mobile App Chameleon Themes (from `themes.ts`)

| Group ID | Brand | Primary | Background |
|----------|-------|---------|------------|
| `75522` | Men's Health | Red `#DC2626` | Black `#0A1118` |
| `75523` | Primary Care | Navy `#1E3A5F` | Light `#F8FAFC` |

### Website Directory Structure

```
/var/www/nowoptimal-websites/
├── nowoptimal-website/     → Hub site (nowoptimal.com)
│   └── app/                → page.tsx, layout.tsx, privacy/, terms/
├── nowprimary-website/     → Static version (in monorepo)
│   └── app/                → page.tsx + services/ + api/
├── nowmenshealth-website/  → Men's Health site
│   └── app/                → page.tsx, layout.tsx, privacy/, terms/
├── nowmentalhealth-website/ → Mental Health site
│   └── app/                → page.tsx, layout.tsx, privacy/, terms/
├── ecosystem.config.js     → PM2 config (ports 3000-3003)
├── deploy.sh               → Build + restart all sites
└── scripts/                → Shared utilities

/home/ec2-user/nowprimarycare-website/  → LIVE booking version
├── app/
│   ├── api/healthie/       → Booking API (slots + book)
│   ├── book/               → Booking page
│   ├── about/, contact/, services/
│   └── page.tsx            → Homepage
├── components/
│   ├── BookingWidget.tsx    → Healthie slot picker + booking
│   ├── HeroSection.tsx, FeaturesSection.tsx
│   ├── ProviderSection.tsx, LocationSection.tsx
│   ├── Header.tsx, Footer.tsx, CTASection.tsx
│   └── booking/            → Additional booking components
├── lib/
│   └── healthie-booking.ts → Healthie GraphQL client
└── .env.local              → API keys (HEALTHIE_API_KEY, etc.)
```

### NowPrimary.Care Healthie Booking Integration

**Provider**: Phil Schafer, NP (`12088269`)  
**Location ID**: `27565` (404 S. Montezuma, Prescott, AZ 86303)  
**Phone**: (928) 756-0070

| Appointment Type | Healthie ID | Duration | Price |
|-----------------|-------------|----------|-------|
| Sick Visit In-Person | `504715` | 30m | Custom |
| Sick Visit Telehealth | `505646` | 30m | Custom |
| Sports Physical | `504718` | 30m | $50 |
| TB Test | `504741` | 15m | $35 |
| Wound Care | `504716` | 30m | Custom |
| Weight Loss Consult | `504717` | 45m | Custom |
| Allergy Injection | `505648` | 15m | $25 |
| IV Therapy GFE | `505647` | 60m | Custom |

**Booking API Flow**:
```
BookingWidget → /api/healthie/slots (GET) → lib/healthie-booking.ts
  → Healthie GraphQL: availableSlotsForRange(provider_id, appt_type_id)
BookingWidget → /api/healthie/book (POST) → createClient + createAppointment
```

> [!IMPORTANT]
> Do NOT pass `appointment_location_id` to `availableSlotsForRange` — it causes a field error. Only pass `provider_id` and `appointment_type_id`.

---

## 🤖 GHL AI Agents (Jessica & Max)

**Full SOT**: `/home/ec2-user/gmhdashboard/scripts/ghl-integration/AI_PROMPTS_SOURCE_OF_TRUTH.md` (337 lines)  
**Prompt Directory**: `/home/ec2-user/gmhdashboard/scripts/ghl-integration/`

### AI Agents Overview

| Agent | Brand | Role | Phone | Hours |
|-------|-------|------|-------|-------|
| **Jessica** (Voice) | NowPrimary.Care | Front desk — scheduling, verification, refills, billing | (928) 756-0070 | M-F 9-5 |
| **Jessica** (Chat) | NowPrimary.Care | Same capabilities via SMS/website chat | SMS | 24/7 |
| **Max** (Voice) | NowMensHealth.Care | TRT specialist — scheduling, refills, labs | (928) 212-2772 | M 1-6, Tu-F 9-6, Sa 9-1 |
| **SMS Chatbot** | NowPrimary.Care | Full Jessica AI via SMS (Bedrock Claude 3.5 Sonnet) | SMS | 24/7 |
| **NOWJarvis** | Internal | Telegram ops bot — Snowflake/Healthie/GHL queries | Telegram | 24/7 |

### Webhook Servers

| Service | Port | PM2 Name | File |
|---------|------|----------|------|
| Jessica Voice AI | 3001 | `ghl-webhooks` | `webhook-server.js` |
| Jessica MCP | 3002 | `jessica-mcp` | MCP protocol server |
| SMS Chatbot | 3003 | `sms-chatbot` | `sms-chatbot-handler.js` |
| Max Voice AI | 3006 | `max-webhooks` | `max-webhook-server.js` |

**Ngrok Tunnel**: `https://nowoptimal.ngrok.app` → Port 3001

### Jessica's 13 Custom Actions

| # | Action | Endpoint | Purpose |
|---|--------|----------|---------|
| 1 | Verify Patient | `/api/ghl/verify-patient` | Name + DOB vs Healthie |
| 2 | Create Patient | `/api/ghl/create-new-patient` | New patient in Healthie |
| 3 | Send Registration | `/api/ghl/send-registration-link` | SMS registration info |
| 4 | Get Availability | `/api/ghl/get-availability` | Available appointment slots |
| 5 | Book Appointment | `/api/ghl/book-appointment` | Book in Healthie |
| 6 | Check Lab Results | `/api/ghl/check-lab-results` | Lab dates (never values) |
| 7 | Rx Refill | `/api/ghl/request-prescription-refill` | Submit refill request |
| 8 | Find Pharmacy | `/api/ghl/find-pharmacy` | Search by zip code |
| 9 | Provider Callback | `/api/ghl/send-provider-message` | Callback request |
| 10 | Check Balance | `/api/ghl/patient-balance` | Account balance |
| 11 | Send Payment Link | `/api/ghl/send-payment-link` | Stripe payment link |
| 12 | Transfer Call | `/api/ghl/transfer-call` | Transfer to human |

### Healthie Group Mapping

| Agent | Healthie Group | Group ID | Provider ID |
|-------|---------------|----------|-------------|
| Jessica | NowPrimary.Care | `75523` | `12088269` |
| Max | NowMensHealth.Care | `75522` | `12093125` |

### SMS Chatbot Architecture
```
Patient SMS → GHL → Webhook → Port 3001 (Proxy) → Port 3003 (Handler)
                                                       ↓
                                              AWS Bedrock Claude 3.5 Sonnet
                                                       ↓
                                              Execute Action (Port 3001)
                                                       ↓
                                              GHL API sendSMS → Patient
```

**AI Model**: `us.anthropic.claude-3-5-sonnet-20241022-v2:0` (inference profile)  
**Conversation TTL**: 30 minutes  
**AWS Auth**: EC2 IAM role (no API keys in .env)

### NOWJarvis Telegram Bot

**File**: `/home/ec2-user/gmhdashboard/scripts/telegram-ai-bot-v2.ts`  
**PM2**: `telegram-ai-bot-v2`

| Command | Purpose |
|---------|---------|
| `/help` | Show help |
| `/ghl` | Men's Health patients from GHL |
| `/dashboard [SQL]` | Query PostgreSQL |
| `/datasources` | List connected sources |
| `/status` | System status |
| `/schema-gaps` | Missing data requests |
| `/refresh-schema` | Re-discover Snowflake schema |

**Data Sources**: Snowflake (NLP queries), Healthie API (real-time financials), PostgreSQL (dashboard data), GHL (contacts)

### Key Deployment Notes

- Jessica/Max prompts use **STOK format** (Situation-Task-Objective-Knowledge)
- **Transfer number** (Primary Care): 928-277-0001
- **Never share**: Lab result values, testosterone levels — dates only
- **Rebranding**: Jessica knows "Granite Mountain Health Clinic" → "NOW Primary Care"
- **GHL AI Prompts SOT last updated**: January 4, 2026 (may need refresh)

---

## System Access Credentials (Updated Feb 19, 2026)

### Healthie EMR Login
- **URL**: https://healthie.com
- **Email**: admin@granitemountainhealth.com
- **Password**: (see `.env.local`)

### GoHighLevel CRM Login
- **URL**: https://app.gohighlevel.com
- **Email**: phil@tricitymenshealth.com
- **Password**: (see `.env.local`)

### Patient Creation Integration Status
- **Database**: ✅ IMPLEMENTED - Clinic field added, Healthie client ID field added
- **Form**: ✅ IMPLEMENTED - Clinic dropdown added (NOW Primary Care / NOW Men's Health)
- **Healthie Sync**: ✅ IMPLEMENTED - Auto-creates patients in correct group based on clinic
- **GHL Sync**: ✅ IMPLEMENTED - Auto-creates patients in correct location based on clinic
- **Men's Health Tag**: ✅ IMPLEMENTED - Automatically adds 'existing' tag to Men's Health patients in GHL

---

*Last Updated: February 19, 2026*
*Maintained by: AntiGravity AI Assistant + manual updates*
*Update this document after any significant system changes.*

