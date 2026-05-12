DO $$
DECLARE
  t RECORD;
  k INT;
  m INT;
BEGIN
  FOR t IN
    SELECT table_name
    FROM information_schema.columns
    WHERE column_name='patient_id' AND table_schema='public'
      AND table_name NOT IN ('patient_data_entry_v','patient_ghl_sync_v','payment_status_summary_v','professional_patient_dashboard_v','provider_signature_queue_v','patients')
    ORDER BY table_name
  LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE patient_id = %L', t.table_name, '04d0fe7d-2cd7-4e92-9ae3-acee8fd2e887') INTO k;
    EXECUTE format('SELECT COUNT(*) FROM %I WHERE patient_id = %L', t.table_name, '0d3bf4a6-940b-4b17-9727-01072039ed9c') INTO m;
    IF k > 0 OR m > 0 THEN
      RAISE NOTICE '%-40s  cris=%  jesus=%', t.table_name, k, m;
    END IF;
  END LOOP;
END$$;
