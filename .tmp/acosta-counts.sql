WITH p AS (
  SELECT '04d0fe7d-2cd7-4e92-9ae3-acee8fd2e887'::uuid AS cris,
         '0d3bf4a6-940b-4b17-9727-01072039ed9c'::uuid AS jesus
)
SELECT 'dispenses' AS tbl,
       (SELECT COUNT(*) FROM dispenses, p WHERE patient_id = p.cris) AS cris_count,
       (SELECT COUNT(*) FROM dispenses, p WHERE patient_id = p.jesus) AS jesus_count
UNION ALL
SELECT 'dea_transactions',
       (SELECT COUNT(*) FROM dea_transactions, p WHERE patient_id = p.cris),
       (SELECT COUNT(*) FROM dea_transactions, p WHERE patient_id = p.jesus)
UNION ALL
SELECT 'payment_issues',
       (SELECT COUNT(*) FROM payment_issues, p WHERE patient_id = p.cris),
       (SELECT COUNT(*) FROM payment_issues, p WHERE patient_id = p.jesus)
UNION ALL
SELECT 'quickbooks_sales_receipts',
       (SELECT COUNT(*) FROM quickbooks_sales_receipts, p WHERE patient_id = p.cris),
       (SELECT COUNT(*) FROM quickbooks_sales_receipts, p WHERE patient_id = p.jesus)
UNION ALL
SELECT 'quickbooks_payments',
       (SELECT COUNT(*) FROM quickbooks_payments, p WHERE patient_id = p.cris),
       (SELECT COUNT(*) FROM quickbooks_payments, p WHERE patient_id = p.jesus)
UNION ALL
SELECT 'patient_qb_mapping',
       (SELECT COUNT(*) FROM patient_qb_mapping, p WHERE patient_id = p.cris),
       (SELECT COUNT(*) FROM patient_qb_mapping, p WHERE patient_id = p.jesus)
UNION ALL
SELECT 'clinicsync_memberships',
       (SELECT COUNT(*) FROM clinicsync_memberships, p WHERE patient_id = p.cris),
       (SELECT COUNT(*) FROM clinicsync_memberships, p WHERE patient_id = p.jesus);
