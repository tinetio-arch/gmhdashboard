
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
- All date comparisons use **Mountain Time** (`America/Phoenix`), NOT UTC
- PostgreSQL queries use: `(NOW() AT TIME ZONE 'America/Phoenix')::DATE`
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
