-- Update patient views to include GHL sync fields

-- Drop existing views that depend on patient_data_entry_v
DROP VIEW IF EXISTS professional_patient_dashboard_v CASCADE;
DROP VIEW IF EXISTS patient_data_entry_v CASCADE;

-- Recreate patient_data_entry_v with GHL fields
CREATE VIEW patient_data_entry_v AS
SELECT
    p.patient_id,
    p.full_name AS patient_name,
    COALESCE(ps.display_name, p.alert_status) AS alert_status,
    p.status_key,
    COALESCE(ps.dashboard_row_hex_color, ps.row_hex_color) AS status_row_color,
    ps.dashboard_alert_hex AS status_alert_color,
    l.last_lab_date AS last_lab,
    l.next_lab_date AS next_lab,
    p.regimen,
    COALESCE(pm.display_name, p.payment_method) AS method_of_payment,
    p.payment_method_key,
    pm.hex_color AS payment_method_color,
    COALESCE(ct.display_name, p.client_type) AS type_of_client,
    p.client_type_key,
    ct.hex_color AS client_type_color,
    COALESCE(ct.is_primary_care, FALSE) AS is_primary_care,
    COALESCE(l.lab_status, p.lab_status) AS lab_status,
    p.notes AS patient_notes,
    l.lab_notes,
    p.service_start_date,
    p.contract_end_date AS contract_end,
    p.dob AS date_of_birth,
    p.dob AS dob,
    p.address_line1,
    p.city,
    p.state,
    p.postal_code,
    CONCAT_WS(', ', NULLIF(p.address_line1, ''), NULLIF(p.city, ''), NULLIF(p.state, ''), NULLIF(p.postal_code, '')) AS address,
    CONCAT_WS(', ', NULLIF(p.address_line1, ''), NULLIF(p.city, ''), NULLIF(p.state, ''), NULLIF(p.postal_code, '')) AS formatted_address,
    p.phone_primary AS phone_number,
    p.phone_primary AS phone_primary,
    p.added_by,
    p.date_added,
    p.last_modified,
    p.email,
    p.qbo_customer_email,
    p.regular_client,
    p.is_verified,
    p.membership_owes,
    p.prescribing_provider_id,
    -- GHL sync fields
    p.ghl_contact_id,
    p.ghl_sync_status,
    p.ghl_last_synced_at,
    p.ghl_sync_error
FROM patients p
LEFT JOIN labs l ON l.patient_id = p.patient_id
LEFT JOIN patient_status_lookup ps ON ps.status_key = p.status_key
LEFT JOIN payment_method_lookup pm ON pm.method_key = p.payment_method_key
LEFT JOIN client_type_lookup ct ON ct.type_key = p.client_type_key;

-- Recreate professional_patient_dashboard_v
CREATE VIEW professional_patient_dashboard_v AS
WITH entry AS (
    SELECT * FROM patient_data_entry_v
), latest_membership AS (
    SELECT DISTINCT ON (m.patient_id)
        m.patient_id,
        m.program_name,
        m.status,
        m.balance_owed,
        m.fee_amount,
        m.next_charge_date,
        m.last_charge_date
    FROM memberships m
    ORDER BY m.patient_id, m.updated_at DESC NULLS LAST
),
latest_supply AS (
    SELECT DISTINCT ON (s.patient_id)
        s.patient_id,
        s.request_date,
        s.last_supply_date,
        s.eligible_date,
        s.status AS supply_status
    FROM supply_requests s
    ORDER BY s.patient_id, s.request_date DESC NULLS LAST
),
latest_dea AS (
    SELECT DISTINCT ON (dt.patient_id)
        dt.patient_id,
        dt.transaction_time,
        dt.quantity_dispensed,
        dt.dea_drug_name
    FROM dea_transactions dt
    ORDER BY dt.patient_id, dt.transaction_time DESC NULLS LAST
)
SELECT
    entry.patient_id,
    entry.patient_name,
    entry.date_of_birth,
    entry.regimen,
    entry.last_lab,
    entry.next_lab,
    ls.last_supply_date,
    ls.eligible_date AS eligible_for_next_supply,
    entry.address,
    entry.phone_number,
    entry.method_of_payment,
    entry.type_of_client,
    entry.service_start_date,
    entry.contract_end,
    entry.regular_client,
    entry.is_verified,
    COALESCE(entry.membership_owes, lm.balance_owed) AS membership_owes,
    COALESCE(entry.email, entry.qbo_customer_email) AS patient_email,
    entry.prescribing_provider_id,
    entry.alert_status,
    entry.status_key,
    entry.status_row_color,
    entry.status_alert_color,
    entry.payment_method_key,
    entry.payment_method_color,
    entry.client_type_key,
    entry.client_type_color,
    entry.is_primary_care,
    entry.lab_status,
    entry.patient_notes,
    entry.lab_notes,
    entry.address_line1,
    entry.city,
    entry.state,
    entry.postal_code,
    entry.phone_number AS contact_phone,
    entry.added_by,
    entry.date_added,
    entry.last_modified,
    lm.program_name AS membership_program,
    lm.status AS membership_status,
    lm.balance_owed AS membership_balance,
    lm.next_charge_date,
    lm.last_charge_date,
    CASE
        WHEN ls.supply_status IS NOT NULL THEN ls.supply_status
        WHEN ls.last_supply_date IS NOT NULL AND ls.eligible_date IS NULL THEN 'Awaiting Eligibility'
        ELSE NULL
    END AS supply_status,
    ld.transaction_time AS last_controlled_dispense_at,
    ld.dea_drug_name AS last_dea_drug,
    -- GHL sync fields
    entry.ghl_contact_id,
    entry.ghl_sync_status,
    entry.ghl_last_synced_at,
    entry.ghl_sync_error
FROM entry
LEFT JOIN latest_membership lm ON lm.patient_id = entry.patient_id
LEFT JOIN latest_supply ls ON ls.patient_id = entry.patient_id
LEFT JOIN latest_dea ld ON ld.patient_id = entry.patient_id;
