\set keep_id '04d0fe7d-2cd7-4e92-9ae3-acee8fd2e887'
\set merge_id '0d3bf4a6-940b-4b17-9727-01072039ed9c'

BEGIN;

-- 1. ghl_sync_history (24 rows)
UPDATE ghl_sync_history
   SET patient_id = :'keep_id'::uuid
 WHERE patient_id = :'merge_id'::uuid;

-- 2. patient_service_tags (text patient_id, UNIQUE on (patient_id,tag); Cris has 0 tags)
UPDATE patient_service_tags
   SET patient_id = :'keep_id'
 WHERE patient_id = :'merge_id';

-- 3. labs: Jesus row is empty 'No lab data', Cris row has full notes; UNIQUE on patient_id forces delete
DELETE FROM labs WHERE patient_id = :'merge_id'::uuid;

-- 4. patient_signals_cache: cache only, PK on patient_id
DELETE FROM patient_signals_cache WHERE patient_id = :'merge_id'::uuid;

-- 5. healthie_clients: keep both Healthie linkages on the surviving patient,
--    mark the archived-Healthie row inactive (Healthie 12741471 archived 2026-01-20)
UPDATE healthie_clients
   SET patient_id = :'keep_id', is_active = false
 WHERE patient_id = :'merge_id';

-- 6. The merge route also touches these (no-ops here, but kept for parity / safety)
UPDATE dispenses                  SET patient_id = :'keep_id'::uuid WHERE patient_id = :'merge_id'::uuid;
UPDATE dea_transactions           SET patient_id = :'keep_id'::uuid WHERE patient_id = :'merge_id'::uuid;
UPDATE payment_issues             SET patient_id = :'keep_id'::uuid WHERE patient_id = :'merge_id'::uuid;
UPDATE quickbooks_sales_receipts  SET patient_id = :'keep_id'::uuid WHERE patient_id = :'merge_id'::uuid;
UPDATE quickbooks_payments        SET patient_id = :'keep_id'::uuid WHERE patient_id = :'merge_id'::uuid;
UPDATE quickbooks_payment_transactions SET patient_id = :'keep_id'::uuid WHERE patient_id = :'merge_id'::uuid;

-- 7. Mark merged patient inactive (preserve the row for audit)
UPDATE patients
   SET status        = 'Inactive',
       status_key    = 'inactive',
       alert_status  = 'Inactive (Merged)',
       status_key_updated_at = NOW(),
       updated_at    = NOW()
 WHERE patient_id = :'merge_id'::uuid;

-- 8. Audit log
INSERT INTO patient_status_activity_log (
  patient_id, previous_status, new_status, change_source, change_reason, created_at
) VALUES (
  :'merge_id'::uuid, 'active', 'inactive', 'admin_merge',
  'Merged into Cris Acosta (04d0fe7d-2cd7-4e92-9ae3-acee8fd2e887). Healthie 12741471 was already archived; surviving record retains active Healthie 12212961 + recurring $140/mo subscription + card on file.',
  NOW()
);

-- Sanity checks before commit
SELECT 'after_keep' AS who, patient_id, full_name, healthie_client_id, status_key, alert_status
  FROM patients WHERE patient_id = :'keep_id'::uuid;
SELECT 'after_merge' AS who, patient_id, full_name, healthie_client_id, status_key, alert_status
  FROM patients WHERE patient_id = :'merge_id'::uuid;
SELECT 'healthie_clients_after' AS q, patient_id, healthie_client_id, is_active
  FROM healthie_clients WHERE patient_id IN (:'keep_id', :'merge_id');
SELECT 'remaining_jesus_rows' AS q,
       (SELECT COUNT(*) FROM ghl_sync_history WHERE patient_id = :'merge_id'::uuid) AS ghl,
       (SELECT COUNT(*) FROM labs WHERE patient_id = :'merge_id'::uuid) AS labs,
       (SELECT COUNT(*) FROM patient_signals_cache WHERE patient_id = :'merge_id'::uuid) AS signals,
       (SELECT COUNT(*) FROM patient_service_tags WHERE patient_id = :'merge_id') AS tags;

COMMIT;
