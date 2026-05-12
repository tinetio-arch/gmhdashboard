#!/bin/bash
# =============================================================================
# Morning Intelligence Agent (Combined)
# Runs daily at 6:47am MST (13:47 UTC)
#
# Does EVERYTHING in one pass:
#   - System health (PM2, disk, memory, endpoints, RDS)
#   - Data integrity (Healthie IDs, name sync, GHL sync, stale labs)
#   - Schedule + inventory + billing + patients
#   - Auto-fixes safe issues (max 10/run)
#
# Writes to agent_action_log for CEO iPad dashboard.
# Clears yesterday's completed entries so the CEO tab is always fresh.
# =============================================================================

set -o pipefail

ENV_FILE="$HOME/gmhdashboard/.env.local"
AGENT_NAME="morning_intelligence"
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

echo "[Morning Intelligence] Starting $(date '+%Y-%m-%d %H:%M:%S')"

# ─── 0. Clear yesterday's completed entries (keep pending decisions) ──
run_sql "DELETE FROM agent_action_log WHERE status IN ('completed','resolved','dismissed') AND created_at < (NOW() AT TIME ZONE 'America/Phoenix')::date" >/dev/null 2>&1

# ─── 1. Integration test gate ─────────────────────────────
TEST_RESULT=$(bash "$HOME/gmhdashboard/scripts/integration-test.sh" 2>&1)
FAIL_COUNT=$(echo "$TEST_RESULT" | grep -oP 'FAIL: \K[0-9]+' || echo "0")
if [ "$FAIL_COUNT" -gt 0 ]; then
    log_action "error" "system_health" "Morning agent aborted: $FAIL_COUNT integration test failures" '{"reason": "integration_test_failure"}'
    echo "[Morning Intelligence] ABORTED — integration tests failing"
    exit 1
fi

# ═══════════════════════════════════════════════════════════
# SECTION A: SYSTEM HEALTH
# ═══════════════════════════════════════════════════════════

ISSUES=0

# PM2 services
PM2_JSON=$(pm2 jlist 2>/dev/null || echo '[]')
CRASHED=$(echo "$PM2_JSON" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    crashed = [p["name"] for p in data if p["pm2_env"]["status"] != "online"]
    print(",".join(crashed) if crashed else "")
except:
    print("")
' 2>/dev/null)

TOTAL_SERVICES=$(echo "$PM2_JSON" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo "0")
ONLINE_SERVICES=$(echo "$PM2_JSON" | python3 -c 'import sys,json; print(sum(1 for p in json.load(sys.stdin) if p["pm2_env"]["status"]=="online"))' 2>/dev/null || echo "0")

if [ -n "$CRASHED" ] && [ "$CRASHED" != "" ]; then
    IFS=',' read -ra CRASHED_ARRAY <<< "$CRASHED"
    for SVC in "${CRASHED_ARRAY[@]}"; do
        pm2 restart "$SVC" 2>/dev/null
        FIX_COUNT=$((FIX_COUNT + 1))
    done
    log_action "auto_fix" "system_health" "Restarted ${#CRASHED_ARRAY[@]} crashed services: $CRASHED" "{\"restarted\": \"$CRASHED\"}"
    sleep 5
fi

# Disk
DISK_PCT=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_PCT" -ge 85 ]; then
    ISSUES=$((ISSUES + 1))
    log_action "error" "system_health" "Disk usage critical: ${DISK_PCT}%" "{\"disk_pct\": $DISK_PCT}"
elif [ "$DISK_PCT" -ge 75 ]; then
    log_action "needs_decision" "system_health" "Disk usage at ${DISK_PCT}% — consider cleanup" "{\"disk_pct\": $DISK_PCT}" "needs_decision"
fi

# Memory
MEM_PCT=$(free | awk '/Mem:/ {printf "%.0f", $3/$2*100}')
if [ "$MEM_PCT" -ge 90 ]; then
    ISSUES=$((ISSUES + 1))
    log_action "error" "system_health" "Memory usage critical: ${MEM_PCT}%" "{\"memory_pct\": $MEM_PCT}"
fi

# RDS
DB_CHECK=$(run_sql "SELECT 1" 2>/dev/null)
if [ "$DB_CHECK" != "1" ]; then
    ISSUES=$((ISSUES + 1))
    log_action "error" "system_health" "PostgreSQL RDS unreachable" "{\"status\": \"unreachable\"}"
fi

# Endpoints
DOWN_SITES=""
for URL in https://nowoptimal.com https://nowmenshealth.care https://nowprimary.care https://abxtac.com; do
    HTTP_CODE=$(curl -sL -o /dev/null -w "%{http_code}" "$URL" --max-time 10 2>/dev/null)
    if [ "$HTTP_CODE" != "200" ]; then
        DOWN_SITES="$DOWN_SITES $URL"
        ISSUES=$((ISSUES + 1))
    fi
done
if [ -n "$DOWN_SITES" ]; then
    log_action "error" "system_health" "Websites down:$DOWN_SITES" "{\"down_sites\": \"$DOWN_SITES\"}"
fi

RDS_MS=$(run_sql "SELECT EXTRACT(MILLISECOND FROM clock_timestamp() - statement_timestamp())" 2>/dev/null || echo "0")
RDS_MS_INT=$(printf "%.0f" "$RDS_MS" 2>/dev/null || echo "0")

# Always log system status (this powers the green/red pill on CEO tab)
if [ "$ISSUES" -eq 0 ]; then
    log_action "info" "system_health" "All ${TOTAL_SERVICES} services online, disk ${DISK_PCT}%, memory ${MEM_PCT}%, RDS ${RDS_MS_INT}ms" "{\"services_online\": $ONLINE_SERVICES, \"services_total\": $TOTAL_SERVICES, \"disk_pct\": $DISK_PCT, \"memory_pct\": $MEM_PCT, \"rds_latency_ms\": $RDS_MS_INT, \"issues\": 0}"
else
    log_action "error" "system_health" "${ISSUES} system issues: ${ONLINE_SERVICES}/${TOTAL_SERVICES} services, disk ${DISK_PCT}%, memory ${MEM_PCT}%" "{\"services_online\": $ONLINE_SERVICES, \"services_total\": $TOTAL_SERVICES, \"disk_pct\": $DISK_PCT, \"memory_pct\": $MEM_PCT, \"issues\": $ISSUES}"
fi

# ═══════════════════════════════════════════════════════════
# SECTION B: DATA INTEGRITY
# ═══════════════════════════════════════════════════════════

# Orphan Healthie IDs
ORPHAN_IDS=$(run_sql "
    SELECT COUNT(*) FROM patients p
    WHERE LOWER(p.status_key) = 'active'
      AND p.healthie_client_id IS NOT NULL AND p.healthie_client_id != ''
      AND NOT EXISTS (SELECT 1 FROM healthie_clients hc WHERE hc.healthie_id = p.healthie_client_id)
" 2>/dev/null || echo "0")
if [ "$ORPHAN_IDS" -gt 0 ] 2>/dev/null && [ "$ORPHAN_IDS" != "0" ]; then
    log_action "needs_decision" "patient_sync" "$ORPHAN_IDS patients have Healthie IDs not found in healthie_clients" "{\"orphan_count\": $ORPHAN_IDS}" "needs_decision"
fi

# Name sync from Healthie (source of truth)
if [ "$FIX_COUNT" -lt "$MAX_FIXES" ]; then
    FIXED_NAMES=$(run_sql "
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
    if [ -n "$FIXED_NAMES" ] && [ "$FIXED_NAMES" != "" ]; then
        NAME_FIX_COUNT=$(echo "$FIXED_NAMES" | wc -l)
        FIX_COUNT=$((FIX_COUNT + NAME_FIX_COUNT))
        log_action "auto_fix" "patient_sync" "Synced $NAME_FIX_COUNT patient names from Healthie" "{\"count\": $NAME_FIX_COUNT}"
    fi
fi

# GHL sync
GHL_PENDING=$(run_sql "SELECT COUNT(*) FROM patients WHERE LOWER(status_key) = 'active' AND (ghl_sync_status IS NULL OR ghl_sync_status IN ('pending','error'))" 2>/dev/null || echo "0")
if [ "$GHL_PENDING" -gt 10 ] 2>/dev/null; then
    curl -sL "https://nowoptimal.com/ops/api/cron/ghl-sync/" -H "x-cron-secret: $CRON_SECRET" --max-time 30 >/dev/null 2>&1
    log_action "auto_fix" "ghl_sync" "Triggered GHL sync for $GHL_PENDING patients with pending/error status" "{\"pending_count\": $GHL_PENDING}"
    FIX_COUNT=$((FIX_COUNT + 1))
fi

# Prescription sync
SYNC_RESP=$(curl -sL "https://nowoptimal.com/ops/api/cron/sync-prescriptions/" -H "x-cron-secret: $CRON_SECRET" --max-time 30 2>/dev/null)
SYNC_OK=$(echo "$SYNC_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('success') else 'no')" 2>/dev/null || echo "unknown")
if [ "$SYNC_OK" = "no" ]; then
    log_action "error" "prescription_sync" "Prescription sync failed" "{\"response\": \"error\"}"
fi

# Orphan payment transactions
ORPHAN_TX=$(run_sql "SELECT COUNT(*) FROM payment_transactions WHERE patient_id IS NULL AND created_at >= NOW() - INTERVAL '7 days'" 2>/dev/null || echo "0")
if [ "$ORPHAN_TX" -gt 0 ] 2>/dev/null && [ "$ORPHAN_TX" != "0" ]; then
    log_action "needs_decision" "billing" "$ORPHAN_TX payment transactions (7d) have no patient linked" "{\"orphan_count\": $ORPHAN_TX}" "needs_decision"
fi

# Stale lab reviews
STALE_LABS=$(run_sql "SELECT COUNT(*) FROM lab_review_queue WHERE status = 'pending' AND created_at < NOW() - INTERVAL '3 days'" 2>/dev/null || echo "0")
if [ "$STALE_LABS" -gt 0 ] 2>/dev/null && [ "$STALE_LABS" != "0" ]; then
    log_action "needs_decision" "labs" "$STALE_LABS lab results pending review for 3+ days" "{\"stale_count\": $STALE_LABS}" "needs_decision"
fi

# ═══════════════════════════════════════════════════════════
# SECTION C: SCHEDULE + INVENTORY + BILLING
# ═══════════════════════════════════════════════════════════

# Today's schedule
MORNING_RESP=$(curl -sL "https://nowoptimal.com/ops/api/cron/morning-prep/" -H "x-cron-secret: $CRON_SECRET" --max-time 30 2>/dev/null)
APPT_COUNT=$(echo "$MORNING_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('appointmentCount', d.get('data',{}).get('appointmentCount', 0)))" 2>/dev/null || echo "0")

# Inventory
LOW_VIALS=$(run_sql "SELECT COUNT(*) FROM vials WHERE status = 'Active' AND remaining_volume_ml < 5" 2>/dev/null || echo "0")
TOTAL_ACTIVE_VIALS=$(run_sql "SELECT COUNT(*) FROM vials WHERE status = 'Active'" 2>/dev/null || echo "0")
ZERO_STOCK=$(run_sql "SELECT string_agg(name, ', ') FROM peptide_products WHERE active = true AND stock_quantity = 0" 2>/dev/null)
if [ -n "$ZERO_STOCK" ] && [ "$ZERO_STOCK" != "" ]; then
    log_action "needs_decision" "inventory" "Peptide products at zero stock: $ZERO_STOCK" "{\"products\": \"$ZERO_STOCK\"}" "needs_decision"
fi

# Failed charges
FAILED_CHARGES=$(run_sql "SELECT COUNT(*) FROM payment_transactions WHERE status IN ('failed','error','declined') AND created_at >= NOW() - INTERVAL '7 days'" 2>/dev/null || echo "0")
FAILED_OVER_100=$(run_sql "SELECT COUNT(*) FROM payment_transactions WHERE status IN ('failed','error','declined') AND amount > 100 AND created_at >= NOW() - INTERVAL '7 days'" 2>/dev/null || echo "0")
if [ "$FAILED_OVER_100" -gt 0 ] 2>/dev/null; then
    FAILED_DETAILS=$(run_sql "SELECT json_agg(json_build_object('patient', p.full_name, 'amount', pt.amount, 'desc', pt.description)) FROM payment_transactions pt JOIN patients p ON pt.patient_id = p.patient_id WHERE pt.status IN ('failed','error','declined') AND pt.amount > 100 AND pt.created_at >= NOW() - INTERVAL '7 days'" 2>/dev/null)
    log_action "needs_decision" "billing" "$FAILED_OVER_100 failed charges over \$100 (7d)" "${FAILED_DETAILS:-{}}" "needs_decision"
fi

# Patients without Healthie IDs — auto-link by email
MISSING_HEALTHIE=$(run_sql "SELECT COUNT(*) FROM patients WHERE LOWER(status_key) = 'active' AND (healthie_client_id IS NULL OR healthie_client_id = '')" 2>/dev/null || echo "0")
if [ "$MISSING_HEALTHIE" -gt 0 ] 2>/dev/null && [ "$FIX_COUNT" -lt "$MAX_FIXES" ]; then
    LINKED=$(run_sql "
        WITH matches AS (
            SELECT p.patient_id, p.full_name, hc.healthie_id
            FROM patients p
            JOIN healthie_clients hc ON LOWER(p.email) = LOWER(hc.email)
            WHERE LOWER(p.status_key) = 'active'
              AND (p.healthie_client_id IS NULL OR p.healthie_client_id = '')
              AND hc.healthie_id IS NOT NULL
            LIMIT $((MAX_FIXES - FIX_COUNT))
        )
        UPDATE patients p SET healthie_client_id = m.healthie_id
        FROM matches m WHERE p.patient_id = m.patient_id
        RETURNING p.full_name
    " 2>/dev/null)
    if [ -n "$LINKED" ] && [ "$LINKED" != "" ]; then
        LINK_COUNT=$(echo "$LINKED" | wc -l)
        FIX_COUNT=$((FIX_COUNT + LINK_COUNT))
        log_action "auto_fix" "patient_sync" "Auto-linked $LINK_COUNT patients to Healthie by email" "{\"count\": $LINK_COUNT}"
    fi
fi

# Duplicates
DUPE_COUNT=$(run_sql "
    SELECT COUNT(*) FROM (
        SELECT full_name, dob, COUNT(*) FROM patients
        WHERE LOWER(status_key) = 'active' AND dob IS NOT NULL
        GROUP BY full_name, dob HAVING COUNT(*) > 1
    ) d
" 2>/dev/null || echo "0")
if [ "$DUPE_COUNT" -gt 0 ] 2>/dev/null && [ "$DUPE_COUNT" != "0" ]; then
    DUPE_DETAILS=$(run_sql "
        SELECT json_agg(json_build_object('name', full_name, 'dob', dob, 'count', cnt))
        FROM (SELECT full_name, dob, COUNT(*) as cnt FROM patients
              WHERE LOWER(status_key) = 'active' AND dob IS NOT NULL
              GROUP BY full_name, dob HAVING COUNT(*) > 1 LIMIT 5) d
    " 2>/dev/null)
    log_action "needs_decision" "patient_sync" "$DUPE_COUNT potential duplicate patient groups (same name + DOB)" "${DUPE_DETAILS:-{}}" "needs_decision"
fi

STAGED_TODAY=$(run_sql "SELECT COUNT(*) FROM staged_doses WHERE status = 'staged' AND staged_for_date = (NOW() AT TIME ZONE 'America/Phoenix')::date" 2>/dev/null || echo "0")

# ═══════════════════════════════════════════════════════════
# SECTION D: DATA QUALITY + CRON HEALTH
# ═══════════════════════════════════════════════════════════

# Auto-fix NULL status_key patients (prevents them from being invisible)
NULL_STATUS=$(run_sql "SELECT COUNT(*) FROM patients WHERE status_key IS NULL OR status_key = ''" 2>/dev/null || echo "0")
if [ "$NULL_STATUS" -gt 0 ] 2>/dev/null && [ "$NULL_STATUS" != "0" ]; then
    run_sql "UPDATE patients SET status_key = CASE WHEN LOWER(status) = 'active' THEN 'active' WHEN LOWER(status) = 'inactive' THEN 'inactive' ELSE LOWER(COALESCE(status, 'unknown')) END WHERE status_key IS NULL OR status_key = ''" 2>/dev/null
    log_action "auto_fix" "patient_sync" "Fixed $NULL_STATUS patients with NULL status_key" "{\"count\": $NULL_STATUS}"
    FIX_COUNT=$((FIX_COUNT + 1))
fi

# Check Healthie revenue cache freshness
CACHE_FILE="/tmp/healthie-revenue-cache.json"
if [ -f "$CACHE_FILE" ]; then
    CACHE_AGE_HOURS=$(python3 -c "import os,time; print(int((time.time()-os.path.getmtime('$CACHE_FILE'))/3600))" 2>/dev/null || echo "999")
    if [ "$CACHE_AGE_HOURS" -gt 12 ] 2>/dev/null; then
        log_action "needs_decision" "billing" "Healthie revenue cache is ${CACHE_AGE_HOURS}h old — CEO revenue numbers may be stale" "{\"cache_age_hours\": $CACHE_AGE_HOURS}" "needs_decision"
    fi
else
    log_action "error" "billing" "Healthie revenue cache file missing — CEO revenue banner incomplete" "{\"file\": \"$CACHE_FILE\"}"
fi

# Check critical cron logs for recent failures
CRON_LOG_DIR="/home/ec2-user/logs/cron"
if [ -d "$CRON_LOG_DIR" ]; then
    FAILED_CRONS=""
    for LOG_FILE in "$CRON_LOG_DIR"/*.log; do
        [ -f "$LOG_FILE" ] || continue
        JOB_NAME=$(basename "$LOG_FILE" .log)
        LAST_LINE=$(tail -1 "$LOG_FILE" 2>/dev/null)
        if echo "$LAST_LINE" | grep -q "exit=[1-9]" 2>/dev/null; then
            FAILED_CRONS="$FAILED_CRONS $JOB_NAME"
        fi
    done
    if [ -n "$FAILED_CRONS" ]; then
        log_action "error" "system_health" "Cron jobs with recent failures:$FAILED_CRONS" "{\"failed_crons\": \"$FAILED_CRONS\"}"
    fi
fi

# ═══════════════════════════════════════════════════════════
# DAILY SUMMARY (one entry — this is what powers the CEO tab)
# ═══════════════════════════════════════════════════════════

SUMMARY="${APPT_COUNT} appts, ${STAGED_TODAY} staged, ${TOTAL_ACTIVE_VIALS} vials (${LOW_VIALS} low), ${FAILED_CHARGES} failed charges, ${FIX_COUNT} auto-fixes, ${ONLINE_SERVICES}/${TOTAL_SERVICES} services, disk ${DISK_PCT}%"
DETAILS="{\"appointments\": ${APPT_COUNT:-0}, \"staged_doses\": ${STAGED_TODAY:-0}, \"active_vials\": ${TOTAL_ACTIVE_VIALS:-0}, \"low_vials\": ${LOW_VIALS:-0}, \"failed_charges\": ${FAILED_CHARGES:-0}, \"missing_healthie\": ${MISSING_HEALTHIE:-0}, \"auto_fixes\": $FIX_COUNT, \"duplicates\": ${DUPE_COUNT:-0}, \"services_online\": ${ONLINE_SERVICES:-0}, \"disk_pct\": ${DISK_PCT:-0}, \"memory_pct\": ${MEM_PCT:-0}, \"ghl_pending\": ${GHL_PENDING:-0}, \"stale_labs\": ${STALE_LABS:-0}, \"orphan_healthie\": ${ORPHAN_IDS:-0}}"

log_action "info" "daily_summary" "$SUMMARY" "$DETAILS"

echo "[Morning Intelligence] Complete — $SUMMARY"
