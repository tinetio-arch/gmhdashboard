WITH pkg AS (
  SELECT *,
         lower(norm_name) AS normalized_name
  FROM jane_packages_import
  WHERE COALESCE(status, '') <> '' AND lower(status) NOT LIKE 'inactive%' AND lower(status) NOT LIKE 'discharg%'
),
patient_norm AS (
  SELECT
    patient_id,
    full_name,
    lower(regexp_replace(regexp_replace(full_name, '^(mr\.?|mrs\.?|ms\.?|dr\.?|miss)\s+', '', 'i'), '\s+', ' ', 'g')) AS normalized_name,
    COUNT(*) OVER (
      PARTITION BY lower(regexp_replace(regexp_replace(full_name, '^(mr\.?|mrs\.?|ms\.?|dr\.?|miss)\s+', '', 'i'), '\s+', ' ', 'g'))
    ) AS name_count
  FROM patients
  WHERE COALESCE(payment_method,'') ILIKE '%jane%'
),
unique_matches AS (
  SELECT pkg.*, pn.patient_id
  FROM pkg
  JOIN patient_norm pn ON pkg.normalized_name = pn.normalized_name
  WHERE pn.name_count = 1
),
display_pr AS (
  SELECT display_name FROM patient_status_lookup WHERE status_key = 'hold_payment_research'
)
UPDATE patients p
SET status_key = 'hold_payment_research',
    alert_status = (SELECT display_name FROM display_pr)
FROM unique_matches um
WHERE p.patient_id = um.patient_id
  AND um.status ILIKE 'active%'
  AND COALESCE(um.outstanding_balance, 0) > 0
  AND COALESCE(p.status_key, '') <> 'hold_payment_research';

WITH pkg AS (
  SELECT *,
         lower(norm_name) AS normalized_name
  FROM jane_packages_import
  WHERE COALESCE(status, '') <> '' AND lower(status) NOT LIKE 'inactive%' AND lower(status) NOT LIKE 'discharg%'
),
patient_norm AS (
  SELECT
    patient_id,
    full_name,
    lower(regexp_replace(regexp_replace(full_name, '^(mr\.?|mrs\.?|ms\.?|dr\.?|miss)\s+', '', 'i'), '\s+', ' ', 'g')) AS normalized_name,
    COUNT(*) OVER (
      PARTITION BY lower(regexp_replace(regexp_replace(full_name, '^(mr\.?|mrs\.?|ms\.?|dr\.?|miss)\s+', '', 'i'), '\s+', ' ', 'g'))
    ) AS name_count
  FROM patients
  WHERE COALESCE(payment_method,'') ILIKE '%jane%'
),
unique_matches AS (
  SELECT pkg.*, pn.patient_id
  FROM pkg
  JOIN patient_norm pn ON pkg.normalized_name = pn.normalized_name
  WHERE pn.name_count = 1
),
display_cr AS (
  SELECT display_name FROM patient_status_lookup WHERE status_key = 'hold_contract_renewal'
)
UPDATE patients p
SET status_key = 'hold_contract_renewal',
    alert_status = (SELECT display_name FROM display_cr)
FROM unique_matches um
WHERE p.patient_id = um.patient_id
  AND um.status ILIKE 'active%'
  AND (
    um.status ILIKE 'expired%'
    OR (um.contract_end_date IS NOT NULL AND um.contract_end_date < CURRENT_DATE)
  )
  AND COALESCE(p.status_key, '') NOT IN ('hold_contract_renewal', 'hold_payment_research');

