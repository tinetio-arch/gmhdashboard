-- healthie_clients link rows for both
SELECT 'healthie_clients_for_cris' AS q, * FROM healthie_clients WHERE patient_id='04d0fe7d-2cd7-4e92-9ae3-acee8fd2e887' OR healthie_client_id='12212961';
SELECT 'healthie_clients_for_jesus' AS q, * FROM healthie_clients WHERE patient_id='0d3bf4a6-940b-4b17-9727-01072039ed9c' OR healthie_client_id='12741471';

-- Healthie invoices for each
SELECT 'cris_invoices' AS q, COUNT(*) FROM healthie_invoices WHERE patient_id='04d0fe7d-2cd7-4e92-9ae3-acee8fd2e887' OR healthie_client_id='12212961';
SELECT 'jesus_invoices' AS q, COUNT(*) FROM healthie_invoices WHERE patient_id='0d3bf4a6-940b-4b17-9727-01072039ed9c' OR healthie_client_id='12741471';
