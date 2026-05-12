SELECT patient_id, full_name, healthie_client_id, jane_id, stripe_customer_id, qbo_customer_id,
       healthie_group_id, healthie_group_name, payment_method, payment_method_key, regimen,
       service_start_date, contract_end_date
FROM patients
WHERE patient_id IN ('04d0fe7d-2cd7-4e92-9ae3-acee8fd2e887','0d3bf4a6-940b-4b17-9727-01072039ed9c');
