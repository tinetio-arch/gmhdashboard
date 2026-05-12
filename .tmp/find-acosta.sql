SELECT patient_id, full_name, preferred_name, dob, email, phone_primary, healthie_client_id, ghl_contact_id, alert_status, status, status_key, created_at, updated_at
FROM patients
WHERE LOWER(full_name) LIKE '%acosta%'
ORDER BY full_name;
