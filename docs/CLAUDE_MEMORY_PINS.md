# Claude Memory Pins — GMH Dashboard

> **Purpose**: Copy these into Claude Code `/memory` or session context. Each pin is a critical fact that prevents common AI mistakes on this codebase.

---

## System Identity

- GMH Dashboard is a Next.js 14 healthcare ops platform at `/home/ec2-user/gmhdashboard`
- Production URL: `https://nowoptimal.com/ops/` (base path is `/ops`)
- The MASTER reference document is `ANTIGRAVITY_SOURCE_OF_TRUTH.md` (5,350 lines). Use `docs/sot-modules/INDEX.md` to load only relevant sections.

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
- 88 tables total. Key tables: patients, healthie_clients, vials, dea_transactions, payment_transactions, lab_review_queue

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
- gmh-dashboard=3011, upload-receiver=3001, jessica-mcp=3002, ghl-webhooks=3003

## Deployment Rules (3-Layer Architecture)

1. `df -h /` — must have >2GB free disk
2. `pm2 stop gmh-dashboard`
3. `rm -rf .next && npm run build`
4. `pm2 start gmh-dashboard && pm2 save`
5. Verify: `curl -I http://localhost:3011/ops/`
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

## What NOT to Do

- DO NOT modify `ANTIGRAVITY_SOURCE_OF_TRUTH.md` without explicit approval
- DO NOT restart PM2 services without checking disk space first
- DO NOT hardcode credentials — always reference `.env.local`
- DO NOT use `/apps/gmh-dashboard` — that path does not exist
- DO NOT deploy without running `npm run build` first (type errors will break production)
- DO NOT use Snowflake for real-time patient lookups (6hr lag)
- DO NOT move patients between Healthie groups without approval (clears onboarding forms)

---

*Pin these into /memory at the start of every Claude Code session working on GMH Dashboard.*
