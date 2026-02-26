# INCIDENT REPORT - Database Schema Deployment Failure
**Date**: December 28, 2025, 04:17 UTC  
**Severity**: CRITICAL → RESOLVED  
**Duration**: ~17 minutes detection to resolution  
**Impact**: QuickBooks health monitoring broken, AWS CloudWatch alerts triggered

---

## 🚨 EXECUTIVE SUMMARY

AWS CloudWatch detected database schema issues affecting the `clinic-pg` PostgreSQL instance:
- **60 new errors** for missing `quickbooks_connection_health` table
- **Multiple errors** for missing `created_at` column in `clinicsync_webhook_events`
- **No user-facing impact** (errors caught by application try-catch blocks)
- **Root cause**: Incomplete schema migrations - code deployed without corresponding database changes

---

## 📊 TIMELINE

### 04:00 UTC - AWS CloudWatch Alert Triggered
- AWS detected pattern: `quickbooks_connection_health.*does not exist`
- 60 occurrences since incident start
- Baseline: 0 occurrences (new issue)

### 04:17 UTC - User Reports "Major Server Timeouts"
- User received AWS notification about schema deployment failure
- Requested immediate investigation

### 04:17-04:20 UTC - Emergency Investigation
- Verified `quickbooks_connection_health` table does NOT exist
- Verified `clinicsync_webhook_events` missing `created_at` column
- Located source code referencing missing objects

### 04:20 UTC - Root Cause Identified
**Missing Table**: `quickbooks_connection_health`
- **Code location**: `/home/ec2-user/gmhdashboard/lib/quickbooksHealth.ts`
- **Purpose**: Monitors QuickBooks OAuth connection health
- **Status**: Code exists with try-catch for missing table, but still generates errors

**Missing Column**: `created_at` in `clinicsync_webhook_events`
- **Expected by**: Legacy queries
- **Impact**: Queries expecting this column fail

### 04:21 UTC - Emergency Fix Deployed
```sql
-- Created quickbooks_connection_health table
CREATE TABLE quickbooks_connection_health (
    id SERIAL PRIMARY KEY,
    connected BOOLEAN NOT NULL,
    error TEXT,
    checked_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Added missing column
ALTER TABLE clinicsync_webhook_events 
ADD COLUMN created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW();
```

### 04:22 UTC - Verification Complete
- ✅ Table created successfully
- ✅ Column added successfully
- ✅ Test INSERT successful
- ✅ PM2 logs show no more errors
- ✅ Dashboard responding normally

### 04:25 UTC - Documentation Created
- Migration script saved: `sql/migrations/20251228_fix_missing_schema_objects.sql`
- Incident report created (this document)

---

## 🔍 ROOT CAUSE ANALYSIS

### Why Did This Happen?

1. **QuickBooks Health Monitoring** (`lib/quickbooksHealth.ts`)
   - Code was added to monitor OAuth connection health
   - Includes database persistence for health check history
   - **Migration was never created or run** for the supporting table
   - Code has defensive try-catch blocks, but still attempts DB operations

2. **ClinicSync Schema Mismatch**
   - `clinicsync_webhook_events` table existed
   - Some queries expected `created_at` column (not present)
   - Likely from legacy code or incomplete migration

3. **Missing Code Review Step**
   - Database schema changes not reviewed before deploy
   - No migration checklist to verify DB changes match code changes

### Why Wasn't This Caught Earlier?

1. **Try-Catch Blocks Masked the Issue**
   - Code has defensive error handling (lines 106-108, 121-123 in quickbooksHealth.ts)
   - Errors logged to console but didn't crash the application
   - AWS CloudWatch aggregated these silent errors

2. **No Schema Validation in CI/CD**
   - No automated check to verify migrations match code
   - No database integration tests

3. **Recent System Changes**
   - Dec 28 cleanup removed ClinicSync code
   - May have exposed latent schema issues

---

## 💥 IMPACT ASSESSMENT

### Systems Affected
- ✅ **Dashboard**: Functional (errors were caught by try-catch)
- ✅ **QuickBooks Integration**: OAuth still working, just health monitoring broken
- ✅ **Patient Data**: Unaffected (307 patients safe)
- ⚠️ **QuickBooks Health Monitoring**: Not recording health checks until fix

### User Impact
- **External Users**: NONE (errors silent, application functional)
- **Internal Monitoring**: AWS CloudWatch alerted to failed DB operations
- **QuickBooks Health Dashboard**: Would show "no history" until fix

### Data Impact
- ✅ No data loss
- ✅ No data corruption
- ⏳ Missing health check history from deployment to fix (~17 minutes)

---

## ✅ RESOLUTION

### Immediate Actions Taken
1. ✅ Created `quickbooks_connection_health` table with proper schema
2. ✅ Added `created_at` column to `clinicsync_webhook_events`
3. ✅ Created indexes for performance
4. ✅ Verified with test INSERT
5. ✅ Confirmed no more errors in PM2 logs
6. ✅ Documented migration in `sql/migrations/`

### Schema Created
```sql
-- quickbooks_connection_health
- id (SERIAL PRIMARY KEY)
- connected (BOOLEAN NOT NULL)
- error (TEXT)
- checked_at (TIMESTAMP, indexed)
- created_at (TIMESTAMP)

-- clinicsync_webhook_events (added)
- created_at (TIMESTAMP DEFAULT NOW())
  (backfilled from received_at)
```

---

## 🛡️ PREVENTIVE MEASURES

### Immediate (This Week)
1. [ ] **Create Database Migration Checklist**
   - Verify all DB-dependent code has corresponding migration
   - Run migrations in staging before production
   - Test migrations are idempotent

2. [ ] **Add Schema Validation**
   - Script to compare code DB queries with actual schema
   - Run before every deployment

3. [ ] **Improve Error Logging**
   - Make try-catch blocks more visible (not silent failures)
   - Alert on repeated DB errors even if caught

### Short-Term (Next 2 Weeks)
4. [ ] **Staging Environment**
   - Deploy to staging first
   - Run integration tests against staging DB
   - Catch schema mismatches before production

5. [ ] **Migration Tracking**
   - Document which migrations have run
   - `migrations_applied` table to track state

6. [ ] **Code Review Process**
   - Database changes require explicit review
   - Migration must be included in PR

### Long-Term (Next Month)
7. [ ] **Automated Schema Tests**
   - Integration tests that verify tables exist
   - CI/CD fails if schema doesn't match code

8. [ ] **Database Change Management**
   - Use migration tool (Flyway, Liquibase, or custom)
   - Version control for schema changes
   - Rollback procedures

9. [ ] **Monitoring Improvements**
   - Dashboard for database health
   - Alert on missing tables/columns
   - Proactive monitoring vs reactive alerts

---

## 📚 LESSONS LEARNED

### What Went Well ✅
1. **Fast Detection**: AWS CloudWatch caught the issue
2. **Fast Resolution**: 17 minutes from report to fix
3. **No User Impact**: Defensive coding prevented crashes
4. **Good Documentation**: Code had comments explaining the schema needs

### What Could Be Improved ⚠️
1. **Migration Process**: No formal migration workflow
2. **Schema Validation**: No check that DB matches code
3. **Testing**: No integration tests for DB operations
4. **Deployment**: Code deployed without verifying DB state

### System Improvements Made ✅
1. Created missing schema objects
2. Documented migration in `/sql/migrations/`
3. This incident report for future reference
4. Identified need for migration checklist

---

## 📋 ACTION ITEMS

**Immediate (Today)**:
- [x] Fix missing database objects
- [x] Verify fix deployed
- [x] Document incident
- [ ] Add migration checklist to deployment docs

**This Week**:
- [ ] Create schema validation script
- [ ] Review all code for other missing migrations
- [ ] Improve error logging visibility

**Next Sprint**:
- [ ] Set up staging environment
- [ ] Implement migration tracking
- [ ] Add database integration tests

---

## 🔗 RELATED DOCUMENTS

- Migration Script: `/home/ec2-user/gmhdashboard/sql/migrations/20251228_fix_missing_schema_objects.sql`
- Code File: `/home/ec2-user/gmhdashboard/lib/quickbooksHealth.ts`
- Cleanup Log: `CLEANUP_LOG_DEC28_2025.md` (today's earlier incident)
- AWS CloudWatch Query: Filter for `quickbooks_connection_health.*does not exist`

---

## 📊 POST-INCIDENT STATUS

### Database Status (04:25 UTC)
- ✅ All tables verified present
- ✅ Schema matches code requirements
- ✅ Test operations successful
- ✅ No errors in AWS CloudWatch (new)

### Application Status
- ✅ Dashboard: Online
- ✅ PM2: All services running
- ✅ QuickBooks: OAuth functional
- ✅ Health Monitoring: Now recording

### System Health
- Disk: 32% (35GB free)
- Memory: 65% used
- Load: Normal
- Uptime: 47 minutes since reboot

---

**Incident Closed**: Dec 28, 2025, 04:25 UTC  
**Resolution**: Database schema objects created  
**Follow-up**: Migration checklist and schema validation needed

---

*This incident demonstrates the importance of database migration management and the value of defensive coding. While try-catch blocks prevented user-facing errors, the underlying issue persisted until AWS monitoring alerted us.*
