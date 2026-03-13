# Testosterone Inventory & Controlled Substance System

**Last Updated**: March 12, 2026
**Owner**: GMH Clinical Operations
**Status**: Production

---

## Purpose

Tracks testosterone vials, patient dispenses, DEA compliance records, and controlled substance checks. Ensures regulatory compliance, inventory accuracy, and patient safety for Schedule III controlled substances.

---

## Database Schema

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `vials` | Testosterone inventory vials | `lot_number`, `vendor`, `size_ml`, `remaining_ml`, `expiration_date` |
| `dispenses` | Individual dispense transactions | `patient_id`, `vial_id`, `dose_ml`, `waste_ml`, `syringes`, `signature_status` |
| `dea_transactions` | DEA compliance records (preserved forever) | `drug_name`, `ndc`, `schedule`, `quantity_mg`, `patient_name_snapshot` |
| `staged_doses` | Prefilled syringes for upcoming visits | `patient_id`, `vial_id`, `dose_ml`, `syringes`, `staged_for_date` |
| `controlled_substance_checks` | Morning/EOD inventory counts | `check_type`, `expected_ml`, `actual_ml`, `discrepancy_ml` |
| `dispense_history` | Audit trail for all dispense events | `dispense_id`, `event_type`, `changed_by`, `timestamp` |

### SQL Views

| View | Purpose |
|------|---------|
| `dea_dispense_log_v` | Joins dispenses + dea_transactions + patients + vials for DEA reporting |
| `provider_signature_queue_v` | Unsigned dispenses awaiting provider signature (limited to 200 rows) |

---

## Business Rules

### 1. Waste Calculation
- **Fixed waste**: 0.1 mL per syringe
- **Constant**: `WASTE_PER_SYRINGE` in `lib/testosterone.ts`
- **Example**: 5 syringes = 0.5 mL waste

### 2. Vendors
- **Carrie Boyd**: 30 mL pre-filled syringes, Miglyol oil
- **TopRx**: 10 mL vials, cottonseed oil

### 3. Morning Check Requirement
- **When**: Required before ANY dispensing on a given day
- **Enforcement**: UI-level (TransactionForm checks last check date)
- **Purpose**: Catch discrepancies early, prevent inventory drift

### 4. Signature Flow
- **Initial state**: `awaiting_signature` (created after dispense)
- **Provider signs**: Status → `signed`
- **Can reopen**: Signature can be revoked if corrections needed
- **Query**: Provider signature queue shows unsigned dispenses (max 200)

### 5. Split-Vial Logic
- **Trigger**: When `dose_ml + waste_ml > vial.remaining_ml`
- **Behavior**: TransactionForm automatically splits dispense across 2 vials
- **Constraint**: `doseCurrent` is capped to actual vial remaining budget (no overfill)
- **Files**: `app/inventory/TransactionForm.tsx` L399-408

### 6. DEA Record Preservation
- **Rule**: DEA transactions are NEVER deleted, even if patient is deleted
- **Mechanism**: Patient info (name, DOB) is denormalized into `dea_transactions` table
- **Reason**: Federal regulatory requirement (records must be kept 2+ years)

### 7. QuickBooks Payment Gating
- **Rule**: Patients with QuickBooks payment method require override approval before dispensing
- **Enforcement**: UI blocks submit, requires admin confirmation
- **Reason**: Prevent dispensing to patients with billing issues

---

## Critical Constraints (NEVER VIOLATE)

### Constraint 1: No Silent Scaling
**Rule**: NEVER silently modify dispense values in the backend.

**Why**: Silent modifications create inventory discrepancies that compound over time and are extremely hard to debug.

**History**:
- Mar 4, 2026: Silent scaling guard added to prevent errors
- Mar 5, 2026: Removed after it caused 22mL discrepancy (89 NULL total_amount records)

**Implementation**:
```typescript
// lib/inventoryQueries.ts L810-820
if (totalDispensedMl + wasteMl > currentRemaining) {
  throw new Error(`Dispense exceeds vial remaining. Use split-vial flow.`);
  // DO NOT: Scale down silently
}
```

### Constraint 2: Row-Level Locking
**Rule**: ALWAYS use `FOR UPDATE` on vial row during dispense transaction.

**Why**: Prevent race conditions when multiple users dispense simultaneously.

**Implementation**:
```typescript
// lib/inventoryQueries.ts L450-470
await client.query('BEGIN');
const vialRow = await client.query(
  'SELECT * FROM vials WHERE id = $1 FOR UPDATE',
  [vialId]
);
// ... perform dispense ...
await client.query('COMMIT');
```

### Constraint 3: Cap Restored Volume
**Rule**: When deleting a dispense, restored volume MUST NOT exceed `vial.size_ml`.

**Why**: Prevents vial overfill (e.g., restoring 15mL to a 10mL vial).

**Implementation**:
```typescript
// lib/inventoryQueries.ts L1005
const newRemaining = Math.min(
  currentRemaining + totalDispensedMl + wasteMl,
  vialSizeMl
);
```

### Constraint 4: Audit Trail for Deletes
**Rule**: ALL dispense deletions MUST be logged to `dispense_history`.

**Why**: Regulatory compliance, fraud prevention, troubleshooting.

**Implementation**:
```typescript
// lib/inventoryQueries.ts (in deleteDispense)
await recordDispenseEvent(dispenseId, 'deleted', userId);
```

### Constraint 5: Stale Staged Dose Warning
**Rule**: Staged doses past their `staged_for_date` show amber ⚠️ STALE warning.

**Why**: Prevent using prefilled syringes past their intended date.

**Implementation**: `app/inventory/StagedDosesManager.tsx` (visual indicator only, no hard block)

---

## Key Files

| File | Purpose | Critical Lines |
|------|---------|----------------|
| `lib/inventoryQueries.ts` | All DB queries | L450-470 (FOR UPDATE lock), L810-820 (no silent scaling), L1005 (cap restore) |
| `lib/deaQueries.ts` | DEA log queries | `fetchRecentDeaLog()` with date range filtering |
| `lib/testosterone.ts` | Shared constants | `WASTE_PER_SYRINGE = 0.1`, vendor names, DEA codes |
| `lib/exporters.ts` | S3 export functions | `exportDeaLogToS3()` for CSV export |
| `app/api/export/dea/route.ts` | DEA CSV download endpoint | GET endpoint for compliance reporting |
| `app/inventory/TransactionForm.tsx` | Dispense UI | L399-408 (split-vial logic), patient search, QBO gating |
| `app/inventory/StagedDosesManager.tsx` | Prefilled dose management | Stale warnings, bulk operations |
| `app/dea/page.tsx` | DEA log viewer | Date filtering, CSV export button |
| `app/provider/signatures/page.tsx` | Signature queue UI | Provider approval interface |

---

## Common Operations

### Dispense Testosterone
1. Complete morning check (if not done today)
2. Search patient by name
3. Enter dose (mL) and syringe count
4. System calculates waste (syringes × 0.1 mL)
5. If total > vial remaining, split-vial logic triggers
6. Submit → creates `dispenses` + `dea_transactions` records
7. Provider signs later via signature queue

### Morning Inventory Check
1. Navigate to `/inventory/check`
2. Count full vials, partial vials, prefilled syringes
3. System compares to expected values
4. Record discrepancies (if any)
5. Submit → creates `controlled_substance_checks` record

### Handle Prefilled Doses
1. Navigate to Staged Doses Manager
2. Create: Select patient, dose, syringe count, date
3. System deducts from source vial immediately
4. Mark complete: When patient picks up
5. Delete/unstage: Returns volume to source vial (capped at size_ml)

### DEA Compliance Reporting
1. Navigate to `/dea`
2. Set date range (default: last 30 days)
3. Export CSV → downloads from S3
4. Includes: Drug name, NDC, schedule, quantity, patient, provider, date

---

## Known Issues

**None** (as of March 12, 2026)

---

## Change History

| Date | Change | Reason |
|------|--------|--------|
| Mar 12, 2026 | Extracted to system design doc | SOT restructure |
| Mar 5, 2026 | Removed silent scaling guard | Caused inventory discrepancies |
| Feb 20, 2026 | 15-fix audit hardening | Inventory integrity improvements |
| Feb 24, 2026 | Added label printing | Provider workflow enhancement |
| Jan 13, 2026 | Initial controlled substance system | Regulatory compliance |

---

## Related Documentation

- [DEA Compliance Requirements](https://www.deadiversion.usdoj.gov/schedules/)
- [Morning Check SOP](SOP-Inventory-Check.md)
- [Prefilled Doses SOP](SOP-PreFilled-Doses.md)
- [Staff Dispensing Guide](STAFF_DISPENSING_GUIDE.md)
- [Full Changelog](ANTIGRAVITY_CHANGELOG.md)
