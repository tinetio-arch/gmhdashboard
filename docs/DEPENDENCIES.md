# System Dependency Map

> **Purpose**: Before changing ANY system, check this map. If you touch X, verify Y and Z still work.
> Last generated: April 6, 2026

## Critical Dependency Chains

### Chain 1: Patient Data Flow
```
Healthie EHR (source of truth)
  → sync-healthie-demographics.ts → Postgres patients table
    → Dashboard patient list/charts → GHL contact sync
    → Snowflake analytics (via unified sync)
    → Mobile app patient lookup (Lambda)
```
**If you change**: Healthie patient fields, sync script, or Postgres patient schema
**Also verify**: Dashboard patient pages load, GHL contacts match, Snowflake patient counts, mobile app patient lookup

### Chain 2: Billing & Revenue
```
Healthie (billing items, invoices, subscriptions)
  → ingest-healthie-financials.ts → Postgres billing tables
  → cache-healthie-revenue.ts → Revenue cache
    → Dashboard revenue widgets
    → Morning Telegram report
  → Stripe (payment processing - CURRENTLY DISCONNECTED)
  → Snowflake (financial analytics)
```
**If you change**: Billing ingestion, revenue cache, Postgres billing schema
**Also verify**: Dashboard revenue numbers, Telegram morning report accuracy, Snowflake financial tables

### Chain 3: Appointment & Scheduling
```
Healthie (appointment types, availability)
  → NowMensHealth.care booking widget (lib/healthie-booking.ts)
  → Dashboard schedule view
  → GHL appointment workflows
  → Morning Telegram report (upcoming count)
```
**If you change**: Healthie appointment types, booking widget, schedule API
**Also verify**: Website booking works, dashboard schedule accurate, GHL triggers fire

### Chain 4: GHL CRM Sync
```
Postgres patients table (with client_type_key)
  → lib/ghl.ts (getGHLClientForPatient routes by type)
    → Men's Health sub-account (most patients)
    → Primary Care sub-account (3 client types only)
  → GHL webhooks → ghl-webhooks PM2 service
  → GHL AI Agents (Jessica/Max) → SMS responses
```
**If you change**: GHL sync, client_type routing, OAuth tokens
**Also verify**: Correct patients in correct GHL location, webhooks receiving, AI agents responding

### Chain 5: Lab Management
```
Lab orders (Healthie)
  → Access Labs auto-upload (cron every 30min)
  → Lab results → Postgres lab_results table
  → Dashboard lab review queue
  → Critical hematocrit alerts → Telegram notifications
  → Lab status refresh (daily cron)
```
**If you change**: Lab upload script, lab review UI, alert thresholds
**Also verify**: Auto-upload still running, alerts firing for critical values, review queue populating

### Chain 6: Inventory & Dispensing
```
Postgres inventory tables (vials, peptides, supplies)
  → Dashboard inventory page
  → Controlled substance tracking (DEA compliance)
  → Dispensing flow (lib/dispenseHistory.ts)
  → Peptide sales tracking → Revenue reports
  → Testosterone check script
```
**If you change**: Inventory schema, dispensing logic, stock calculations
**Also verify**: DEA compliance unbroken, dispensing flow works, stock counts accurate

### Chain 7: Website Ecosystem
```
4 PM2 website services (ports 3004-3007):
  → nowmenshealth-website (3005) — booking widget uses Healthie API
  → nowoptimal-website (3006) — brand parent site
  → nowmentalhealth-website (3004) — mental health
  → nowprimary-website (3007) — primary care
  → abxtac-website (3003) — peptide e-commerce
All behind Nginx reverse proxy
```
**If you change**: Any website, Nginx config, Healthie booking IDs
**Also verify**: All 5 sites respond (uptime-monitor checks this), booking flow end-to-end, SSL certs valid

### Chain 8: Notification System
```
Multiple cron jobs → event triggers
  → Telegram bot (telegram-ai-bot-v2)
  → Email triage service
  → Morning report aggregation
  → Health check alerts
```
**If you change**: Cron schedules, Telegram bot, alert thresholds
**Also verify**: Morning report sends, health checks fire, email triage processes

## High-Risk Change Matrix

| If you touch... | Risk Level | Must verify... |
|---|---|---|
| Postgres schema (ALTER TABLE) | **CRITICAL** | Every service that reads that table, all sync scripts, dashboard pages |
| Healthie API calls | **HIGH** | Rate limits not exceeded, sync scripts, booking widget, lab upload |
| GHL OAuth/tokens | **HIGH** | Both locations authenticate, webhook delivery, AI agents |
| PM2 ecosystem.config.js | **HIGH** | All services start correctly, env vars preserved, ports not conflicting |
| Nginx config | **HIGH** | All websites accessible, SSL working, /ops/ base path routing |
| .env.local | **HIGH** | Every service that reads env vars (restart PM2 after changes) |
| Dashboard UI components | **MEDIUM** | Hydration errors (check 10-critical-code-patterns.md), mobile responsiveness |
| Sync scripts (scripts/*.ts) | **MEDIUM** | Data integrity in Postgres, Snowflake freshness, no duplicate records |
| Cron schedules | **LOW** | No overlapping heavy jobs, logs rotating properly |

## The #1 Rule
> **Healthie is the source of truth for patient data.** When Healthie and Postgres conflict, Healthie wins. Update Postgres to match, never the reverse. This caused the Doug Dolan incident (Healthie ID changed, local record not updated).
