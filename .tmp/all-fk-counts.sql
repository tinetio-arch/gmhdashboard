-- Find every table that references patient_id, count rows for both UUIDs
WITH p AS (
  SELECT '04d0fe7d-2cd7-4e92-9ae3-acee8fd2e887'::uuid AS keep_id,
         '0d3bf4a6-940b-4b17-9727-01072039ed9c'::uuid AS merge_id
)
SELECT table_name
FROM information_schema.columns
WHERE column_name = 'patient_id'
  AND table_schema = 'public'
ORDER BY table_name;
