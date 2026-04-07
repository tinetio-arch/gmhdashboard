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

