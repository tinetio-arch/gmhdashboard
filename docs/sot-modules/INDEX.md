# SOT Module Index

> **Purpose**: Load ONLY the modules relevant to your current task. Do NOT read all files.
> The original monolithic SOT remains at ~/gmhdashboard/ANTIGRAVITY_SOURCE_OF_TRUTH.md

| # | File | Lines | When to Read |
|---|------|-------|-------------|
| 1 | 01-quick-orientation.md | ~30 | **ALWAYS** — system overview, admin access, critical facts |
| 2 | 02-critical-read-first.md | ~46 | **ALWAYS** — patient workflows, SOPs, lab/scribe systems |
| 3 | 03-pm2-service-rules.md | ~66 | When managing PM2 services, ports, or crash loops |
| 4 | 04-clinic-setup.md | ~35 | When working with clinic locations, providers, intake flows |
| 5 | 05-system-architecture.md | ~183 | When working with file paths, URLs, directory structure, PM2 registry |
| 6 | 06-recent-changes.md | ~2033 | When understanding recent features, bug fixes (Dec 2025-Apr 2026) |
| 7 | 07-previous-changes.md | ~712 | When understanding foundational features or GHL/Scribe/Email |
| 8 | 08-alert-notification-system.md | ~227 | When working with email triage, lab monitoring, health checks |
| 9 | 09-operational-procedures.md | ~185 | When deploying, configuring Nginx, managing PM2, env vars |
| 10 | 10-critical-code-patterns.md | ~306 | When writing code — base path, hydration, Healthie GraphQL |
| 11 | 11-troubleshooting.md | ~211 | When debugging dashboard, OAuth, redirects, disk, scribe |
| 12 | 12-file-locations.md | ~46 | When looking for specific config, source, or script files |
| 13 | 13-development-guidelines.md | ~34 | When writing new code — style, commits, testing checklist |
| 14 | 14-quick-commands.md | ~56 | Copy-paste deployment, status, log, and cleanup commands |
| 15 | 15-integration-endpoints.md | ~24 | Healthie, QuickBooks, Snowflake, Telegram API details |
| 16 | 16-security-notes.md | ~23 | Cookie security, OAuth, never-commit rules |
| 17 | 17-learning-resources.md | ~88 | Next.js, Healthie, QuickBooks, Snowflake docs + API notes |
| 18 | 18-common-queries.md | ~63 | SQL/GraphQL snippets for patient lookup, QB check, Snowflake |
| 19 | 19-deprecated-systems.md | ~47 | ClinicSync removal history, Dec 28 emergency fixes |
| 20 | 20-mobile-app.md | ~139 | Mobile app config IDs, Lambda actions, API gotchas |
| 21 | 21-websites-brand-system.md | ~203 | 4 sites, ports, brand colors, booking integration |
| 22 | 22-brand-group-architecture.md | ~275 | **CRITICAL** — Brand/group restructure, appointment types, telehealth |
| 23 | 23-ghl-ai-agents.md | ~133 | Jessica/Max, webhook actions, SMS chatbot, Jarvis |
| 24 | 24-system-access-credentials.md | ~66 | Login URLs and credential references |

## Task-Based Quick Reference

| If your task involves... | Read these modules |
|---|---|
| **Any code change** | 01, 02, 10, 13 |
| **Deployment** | 01, 09, 14 |
| **Patient data / Healthie** | 01, 02, 04, 15, 18 |
| **GHL / Marketing** | 01, 15, 23 |
| **Billing / Stripe / QuickBooks** | 01, 15, 18 |
| **Mobile app** | 01, 20 |
| **Websites** | 01, 21, 22 |
| **PM2 / Server issues** | 01, 03, 05, 11, 14 |
| **Debugging** | 01, 11, 14 |
| **Brand restructure / Telehealth** | 01, 22 |
| **Full system audit** | Read ALL (but start with 01, 02, 05) |

Also read: ~/gmhdashboard/docs/DEPENDENCIES.md before making cross-system changes.
