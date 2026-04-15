# SOT Module Index

> **Purpose**: Load ONLY the module(s) relevant to your current task. This keeps AI context windows lean and prevents hallucination from information overload.
>
> **Original file**: `~/gmhdashboard/ANTIGRAVITY_SOURCE_OF_TRUTH.md` (5,350 lines) — DO NOT MODIFY.

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

## Quick Decision Tree

**"I need to fix a bug"** → Read: 01, 02, 10, 11  
**"I need to deploy"** → Read: 01, 09, 14  
**"I need to add a feature"** → Read: 01, 02, 05, 10, 13  
**"I need to work on integrations"** → Read: 01, 05, 15, 08  
**"I need to work on the mobile app"** → Read: 01, 20, 10  
**"I need to work on websites"** → Read: 01, 21, 22  
**"I need to work on AI agents"** → Read: 01, 23, 05  
**"PM2 is broken"** → Read: 01, 03, 11, 14  
**"I need to understand the data model"** → Read: 01, 05, 18  

## Module Sizes

Total: 5,350 lines across 24 modules. Loading 01 + 02 = ~75 lines (fits any context window).
Loading all task-relevant modules for a typical task = 200-500 lines (vs. 5,350 for the full SOT).
