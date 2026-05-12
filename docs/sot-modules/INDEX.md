# SOT Module Index

> **Purpose**: Load ONLY the module(s) relevant to your current task. This keeps AI context windows lean and prevents hallucination from information overload.
>
> **Original file**: `~/gmhdashboard/ANTIGRAVITY_SOURCE_OF_TRUTH.md` (5,733 lines as of 2026-04-22) — DO NOT MODIFY.
> **Index last refreshed**: 2026-05-12 — added 28 variants (v2 / v2-audit / v3) and confirmed 29 BioSCOPE module.

## Always-Read Modules (< 100 lines each)

| File | Purpose | When to Read |
|------|---------|-------------|
| `01-quick-orientation.md` | System overview, admin access, critical facts | **EVERY session** — read this first |
| `02-critical-read-first.md` | Patient workflows, SOPs, lab/scribe systems, emergency contacts | **EVERY session** — read second |

## Task-Specific Modules

| File | Purpose | When to Read |
|------|---------|-------------|
| `03-pm2-service-rules.md` | PM2 crash loop prevention, service registry, restart procedures | Managing PM2 services, ports, or crash loops |
| `04-clinic-setup.md` | Clinic locations, providers, intake flows, group IDs | Working with clinics, providers, or patient intake |
| `05-system-architecture.md` | File paths, URLs, directory structure, PM2 service registry | Working with file paths, URLs, or system layout |
| `06-recent-changes.md` | Features/fixes from Dec 2025 – Apr 2026 (largest module) | Understanding recent features, debugging recent changes |
| `07-previous-changes.md` | Foundational features: GHL, Scribe, Email, Dec 2025 | Understanding foundational features or historical context |
| `08-alert-notification-system.md` | Email triage, lab monitoring, health checks, alert tiers | Working with alerts, email routing, lab pipeline |
| `09-operational-procedures.md` | Build/deploy, Nginx config, PM2 operations, env vars | Deploying, configuring Nginx, managing PM2, changing env vars |
| `10-critical-code-patterns.md` | Base path, hydration, Healthie GraphQL gotchas, patient search | Writing code — MUST read before any code changes |
| `11-troubleshooting.md` | Dashboard, OAuth, redirects, disk, scribe, Snowflake issues | Debugging any system component |
| `12-file-locations.md` | Config, source, and script file reference | Looking for specific files |
| `13-development-guidelines.md` | Code style, commits, testing checklist | Writing new code |
| `14-quick-commands.md` | Copy-paste deployment, status, log, and cleanup commands | Quick reference during ops work |
| `15-integration-endpoints.md` | Healthie, QuickBooks, Snowflake, Telegram API details | Working with external API integrations |
| `16-security-notes.md` | Cookie security, OAuth, never-commit rules | Security-sensitive changes |
| `17-learning-resources.md` | Next.js, Healthie, QuickBooks, Snowflake docs + API notes | Learning system-specific APIs |
| `18-common-queries.md` | SQL/GraphQL snippets for patient lookup, QB, Snowflake | Writing queries or debugging data |
| `19-deprecated-systems.md` | ClinicSync removal, Dec 28 emergency fixes | Understanding what was removed and why |
| `20-headless-mobile-app.md` | Mobile app config, Lambda actions, API gotchas, access control | Working on the mobile app |
| `21-websites-brand-system.md` | 4 websites, ports, brand colors, booking integration | Working on any public website |
| `22-brand-group-architecture.md` | Brand/group restructure, appointment types, telehealth plan | **CRITICAL** — brand/group changes, telehealth, forms |
| `23-ghl-ai-agents.md` | Jessica/Max AI agents, webhook actions, SMS chatbot, Jarvis | Working on AI agents or GHL integration |
| `24-system-access-credentials.md` | Login URLs, credential references, UPS shipping | Looking up access credentials or UPS integration |
| `25-patient-classification-and-dashboard.md` | **DRAFT** Patient classification policy + dashboard redesign (Member/Intermittent/Visit, signal badges, intake defaults, dedup) | Adding patients, dashboard UX changes, classification rules, dedup work |
| `26-classification-audit.md` | **AUDIT** Read-only dry-run of all 491 patients — duplicates, orphan links, proposed classifications. Regenerate via `node scripts/generate-classification-audit.js` (or v3 variant) | Reviewing the one-time classification backlog before applying changes |
| `27-patient-flow-map.md` | **DRAFT** Stage-oriented patient lifecycle (Lead→Booked→Intake→Evaluated→Onboarded→Active→At-risk→Off-service); per-stage SOT/GHL/dashboard/staff roles | Designing new automations, crons, or webhooks; deciding which system owns what |
| `28-hardening-plan-v2.md` | **SUPERSEDED** Phase 2 hardening plan (3,162 lines) — kept for historical context | Reading why v3 chose the chokepoint approach |
| `28-hardening-plan-v2-audit.md` | **AUDIT** Post-v2 audit of writers found in the wild (366 lines) — inputs that informed v3 | Auditing patient_status writers; understanding the migration backlog v3 closed |
| `28-hardening-plan-v3.md` | **ACTIVE** Patient status chokepoint v3 (2,544 lines) — `lib/status-transitions.ts`, DB trigger, ESLint rule, 17/17 acceptance tests | Any change that touches `patients.status_key`. Phase 1.0–1.4 ✅ complete; 1.5 soak window |
| `29-bioscope-integration.md` | **NEW (Apr 29 2026)** BioSCOPE third-party API: allowlist (`bioscope_authorized_patients`), `BIOSCOPE_API_SECRET` + dedicated `BIOSCOPE_HEALTHIE_API_KEY`, admin UI at `/ops/admin/bioscope`, audit to `agent_action_log` | Working on BioSCOPE integration, adding/revoking BioSCOPE patients, building patient-scoped third-party APIs |

## Quick Decision Tree

**"I need to fix a bug"** → Read: 01, 02, 10, 11  
**"I need to deploy"** → Read: 01, 09, 14 + run `scripts/pre-deploy-check.sh`  
**"I need to add a feature"** → Read: 01, 02, 05, 10, 13  
**"I need to work on integrations"** → Read: 01, 05, 15, 08  
**"I need to work on the mobile app"** → Read: 01, 20, 10  
**"I need to work on websites"** → Read: 01, 21, 22  
**"I need to work on AI agents"** → Read: 01, 23, 05  
**"PM2 is broken"** → Read: 01, 03, 11, 14  
**"I need to understand the data model"** → Read: 01, 05, 18  
**"I need to change patient.status_key"** → Read: 28-hardening-plan-v3 (FIRST), 10, 18  
**"I need to add/revoke a BioSCOPE patient"** → Read: 29  
**"I need to dedupe / classify patients"** → Read: 25, 26, 27  
**"I need to coordinate with other Claude sessions"** → Read top-level `~/.claude/CLAUDE.md` DISPATCH section + `claude-coord --help`  

## Module Sizes

Total: ~12,750 lines across 30 module files (01–29 + variants + INDEX) as of 2026-05-12.
Loading 01 + 02 = ~75 lines (fits any context window).
Loading all task-relevant modules for a typical task = 200-500 lines (vs. 5,733 for the full SOT).
**Largest modules** to be careful of:
- `28-hardening-plan-v2.md` — 3,162 lines (SUPERSEDED; read v3 unless doing v2 archaeology)
- `28-hardening-plan-v3.md` — 2,544 lines (ACTIVE)
- `06-recent-changes.md` — 1,059 lines (Feb–Apr 2026 history)
- `25-patient-classification-and-dashboard.md` — 843 lines (DRAFT spec)
- `07-previous-changes.md` — 699 lines (Dec 2025 foundations)
