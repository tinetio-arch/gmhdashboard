#!/bin/bash
# =============================================================================
# Data Integrity Agent
# Runs every 4 hours
# Audits Healthie IDs, patient reconciliation, GHL sync, payment sync
# Auto-fixes safe issues, escalates ambiguous ones to CEO dashboard
# =============================================================================

set -o pipefail

ENV_FILE="$HOME/gmhdashboard/.env.local"
AGENT_NAME="data_integrity"
MAX_FIXES=10
FIX_COUNT=0

export DATABASE_HOST=$(grep '^DATABASE_HOST=' "$ENV_FILE" | cut -d'=' -f2-)
export DATABASE_PORT=$(grep '^DATABASE_PORT=' "$ENV_FILE" | cut -d'=' -f2-)
export DATABASE_NAME=$(grep '^DATABASE_NAME=' "$ENV_FILE" | cut -d'=' -f2-)
export DATABASE_USER=$(grep '^DATABASE_USER=' "$ENV_FILE" | cut -d'=' -f2-)
export DATABASE_PASSWORD=$(grep '^DATABASE_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)
export CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d'=' -f2-)

run_sql() {
    PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" -t -A -c "$1" 2>/dev/null
}

log_action() {
    local action_type="$1" category="$2" summary="$3" details="$4" status="${5:-completed}"
    local escaped_summary escaped_details
    escaped_summary=$(echo "$summary" | sed "s/'/''/g")
    escaped_details=$(echo "$details" | sed "s/'/''/g")
    run_sql "INSERT INTO agent_action_log (agent_name, action_type, category, summary, details, status) VALUES ('$AGENT_NAME', '$action_type', '$category', '$escaped_summary', '$escaped_details'::jsonb, '$status')" >/dev/null 2>&1
}

echo "[Data Integrity] Starting $(date '+%Y-%m-%d %H:%M:%S')"

# ─── 1. Healthie ID audit ─────────────────────────────────
# Find active patients whose healthie_client_id doesn't exist in healthie_clients
ORPHAN_IDS=$(run_sql "
    SELECT COUNT(*) FROM patients p
    WHERE LOWER(p.status_key) = 'active'
      AND p.healthie_client_id IS NOT NULL
      AND p.healthie_client_id != ''
      AND NOT EXISTS (SELECT 1 FROM healthie_clients hc WHERE hc.healthie_id = p.healthie_client_id)
")

if [ "$ORPHAN_IDS" -gt 0 ] 2>/dev/null && [ "$ORPHAN_IDS" != "0" ]; then
    log_action "needs_decision" "patient_sync" "$ORPHAN_IDS active patients have Healthie IDs not found in healthie_clients table" "{\"orphan_count\": $ORPHAN_IDS}" "needs_decision"
fi

# ─── 2. Name sync — fix mismatches between patients and healthie_clients
NAME_MISMATCHES=$(run_sql "
    SELECT COUNT(*) FROM patients p
    JOIN healthie_clients hc ON p.healthie_client_id = hc.healthie_id
    WHERE LOWER(p.status_key) = 'active'
      AND p.full_name IS NOT NULL
      AND hc.first_name IS NOT NULL
      AND LOWER(p.full_name) != LOWER(CONCAT(hc.first_name, ' ', hc.last_name))
" 2>/dev/null || echo "0")

if [ "$NAME_MISMATCHES" -gt 0 ] 2>/dev/null && [ "$NAME_MISMATCHES" != "0" ] && [ "$FIX_COUNT" -lt "$MAX_FIXES" ]; then
    FIXED=$(run_sql "
        WITH fixes AS (
            SELECT p.patient_id, CONCAT(hc.first_name, ' ', hc.last_name) as healthie_name
            FROM patients p
            JOIN healthie_clients hc ON p.healthie_client_id = hc.healthie_id
            WHERE LOWER(p.status_key) = 'active'
              AND p.full_name IS NOT NULL AND hc.first_name IS NOT NULL
              AND LOWER(p.full_name) != LOWER(CONCAT(hc.first_name, ' ', hc.last_name))
            LIMIT $((MAX_FIXES - FIX_COUNT))
        )
        UPDATE patients p SET full_name = f.healthie_name
        FROM fixes f WHERE p.patient_id = f.patient_id
        RETURNING p.patient_id
    " 2>/dev/null)

    if [ -n "$FIXED" ] && [ "$FIXED" != "" ]; then
        FIXED_COUNT=$(echo "$FIXED" | wc -l)
        FIX_COUNT=$((FIX_COUNT + FIXED_COUNT))
        log_action "auto_fix" "patient_sync" "Synced $FIXED_COUNT patient names from Healthie (source of truth)" "{\"count\": $FIXED_COUNT}"
    fi
fi

# ─── 3. GHL sync status ──────────────────────────────────
GHL_PENDING=$(run_sql "SELECT COUNT(*) FROM patients WHERE LOWER(status_key) = 'active' AND (ghl_sync_status IS NULL OR ghl_sync_status IN ('pending','error'))" 2>/dev/null || echo "0")

if [ "$GHL_PENDING" -gt 10 ] 2>/dev/null; then
    # Trigger GHL sync cron
    curl -sL "https://nowoptimal.com/ops/api/cron/ghl-sync/" -H "x-cron-secret: $CRON_SECRET" --max-time 30 >/dev/null 2>&1
    log_action "auto_fix" "ghl_sync" "Triggered GHL sync for $GHL_PENDING patients with pending/error status" "{\"pending_count\": $GHL_PENDING}"
    FIX_COUNT=$((FIX_COUNT + 1))
fi

# ─── 4. Prescription sync ────────────────────────────────
SYNC_RESP=$(curl -sL "https://nowoptimal.com/ops/api/cron/sync-prescriptions/" -H "x-cron-secret: $CRON_SECRET" --max-time 30 2>/dev/null)
SYNC_OK=$(echo "$SYNC_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('success') else 'no')" 2>/dev/null || echo "unknown")

if [ "$SYNC_OK" = "no" ]; then
    log_action "error" "prescription_sync" "Prescription sync failed" "{\"response\": \"error\"}"
fi

# ─── 5. Payment transaction integrity ─────────────────────
# Check for transactions with no patient link
ORPHAN_TX=$(run_sql "SELECT COUNT(*) FROM payment_transactions WHERE patient_id IS NULL AND created_at >= NOW() - INTERVAL '7 days'" 2>/dev/null || echo "0")

if [ "$ORPHAN_TX" -gt 0 ] 2>/dev/null && [ "$ORPHAN_TX" != "0" ]; then
    log_action "needs_decision" "billing" "$ORPHAN_TX payment transactions in last 7 days have no patient_id linked" "{\"orphan_count\": $ORPHAN_TX}" "needs_decision"
fi

# ─── 6. Lab review queue staleness ────────────────────────
STALE_LABS=$(run_sql "SELECT COUNT(*) FROM lab_review_queue WHERE status = 'pending' AND created_at < NOW() - INTERVAL '3 days'" 2>/dev/null || echo "0")

if [ "$STALE_LABS" -gt 0 ] 2>/dev/null && [ "$STALE_LABS" != "0" ]; then
    log_action "needs_decision" "labs" "$STALE_LABS lab results have been pending review for over 3 days" "{\"stale_count\": $STALE_LABS}" "needs_decision"
fi

# ─── 7. Summary ──────────────────────────────────────────
SUMMARY="Data integrity: $FIX_COUNT auto-fixes, orphan Healthie IDs: ${ORPHAN_IDS:-0}, GHL pending: ${GHL_PENDING:-0}, stale labs: ${STALE_LABS:-0}"
DETAILS="{\"auto_fixes\": $FIX_COUNT, \"orphan_healthie_ids\": ${ORPHAN_IDS:-0}, \"name_mismatches\": ${NAME_MISMATCHES:-0}, \"ghl_pending\": ${GHL_PENDING:-0}, \"orphan_transactions\": ${ORPHAN_TX:-0}, \"stale_labs\": ${STALE_LABS:-0}}"

log_action "info" "audit_summary" "$SUMMARY" "$DETAILS"

echo "[Data Integrity] Complete — $SUMMARY"
