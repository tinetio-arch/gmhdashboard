# Patient Sync Status Columns (May 19, 2026)
#
# `patients` table has parallel status columns for the two upstream sync
# targets, both populated on every PATCH /api/patients/[id] and PUT
# /api/ipad/patient/[id]/demographics call:
#
#   ghl_sync_status       | 'ok' | 'error' | NULL
#   ghl_sync_error        | last failure message (truncated to 500 chars)
#   ghl_last_synced_at    | timestamp of last attempt (success OR failure)
#
#   healthie_sync_status  | 'ok' | 'error' | 'blocked_email_collision' | NULL
#   healthie_sync_error   | last failure message
#   healthie_last_synced_at | timestamp of last attempt
#
# 'blocked_email_collision' means Healthie rejected the email update because
# another Healthie user (typically a provider account) has it — do NOT retry
# until a human resolves the dedup. PATCH /api/patients/[id] short-circuits
# Healthie sync entirely for blocked rows.
#
# Index: idx_patients_healthie_sync_blocked (partial, status <> 'ok')
# /ops triage query:
#   SELECT patient_id, healthie_sync_status, healthie_sync_error,
#          healthie_last_synced_at
#   FROM patients
#   WHERE healthie_sync_status IS NOT NULL
#     AND healthie_sync_status <> 'ok'
#   ORDER BY healthie_last_synced_at DESC;
#
# Healthie sync gate (loosened May 19, 2026):
#   - Sync runs when method_of_payment ~ /healthie/i AND either
#     (client_type ∈ {NowMensHealth.Care, NowPrimary.Care})
#     OR (patient already has a linked healthie_clients row).
#   - Only the original allowlist reaches the create-by-sync path
#     (ensureHealthieClientId). Other types sync existing-link only.
#
# Healthie webhook divergence log (May 19, 2026):
#   POST /api/integrations/healthie/webhook writes one row to
#   agent_action_log per divergent field set BEFORE applying its
#   COALESCE update to patients. agent_name='healthie_webhook',
#   action_type='patient_divergence'. The COALESCE write still runs —
#   instrumentation is additive.

# Implementation: getGHLClientForPatient() in lib/ghl.ts
# - Routes based on client_type_key field
# - Primary Care types explicitly listed, all others default to Men's Health



# Healthie Provider IDs (for appointment routing)
HEALTHIE_MENS_HEALTH_PROVIDER_ID=12093125
HEALTHIE_PRIMARY_CARE_PROVIDER_ID=12088269  # Phil Schafer, NP

# ============================================
# NowMensHealth.Care Website Healthie Integration [NEW Jan 2026]
# ============================================
#
# Website: https://www.nowmenshealth.care
# Directory: /home/ec2-user/nowmenshealth-website/
# PM2 Service: nowmenshealth-website (port 3005)
#
# Healthie Configuration:
#   Location ID: 13029260 (215 N. McCormick St, Prescott)
#   Group ID: 75522 (NowMensHealth.Care)
#   Provider ID: 12093125 (Dr. Aaron Whitten)
#   Timezone: America/Phoenix
#
