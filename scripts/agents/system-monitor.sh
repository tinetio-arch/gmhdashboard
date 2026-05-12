#!/bin/bash
# =============================================================================
# System Monitor Agent (Silent Mode)
# Runs every hour. ONLY writes to agent_action_log if something is broken.
# Auto-restarts crashed PM2 services.
# No "all healthy" noise — the morning agent handles the daily status report.
# =============================================================================

set -o pipefail

ENV_FILE="$HOME/gmhdashboard/.env.local"
AGENT_NAME="system_monitor"

export DATABASE_HOST=$(grep '^DATABASE_HOST=' "$ENV_FILE" | cut -d'=' -f2-)
export DATABASE_PORT=$(grep '^DATABASE_PORT=' "$ENV_FILE" | cut -d'=' -f2-)
export DATABASE_NAME=$(grep '^DATABASE_NAME=' "$ENV_FILE" | cut -d'=' -f2-)
export DATABASE_USER=$(grep '^DATABASE_USER=' "$ENV_FILE" | cut -d'=' -f2-)
export DATABASE_PASSWORD=$(grep '^DATABASE_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)

run_sql() {
    PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" -t -A -c "$1" 2>/dev/null
}

log_action() {
    local action_type="$1" category="$2" summary="$3" details="$4" status="${5:-completed}"
    local escaped_summary=$(echo "$summary" | sed "s/'/''/g")
    local escaped_details=$(echo "$details" | sed "s/'/''/g")
    run_sql "INSERT INTO agent_action_log (agent_name, action_type, category, summary, details, status) VALUES ('$AGENT_NAME', '$action_type', '$category', '$escaped_summary', '$escaped_details'::jsonb, '$status')" >/dev/null 2>&1
}

# ─── Check PM2 — auto-restart crashed services ───────────
PM2_JSON=$(pm2 jlist 2>/dev/null || echo '[]')
CRASHED=$(echo "$PM2_JSON" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    print(",".join(p["name"] for p in data if p["pm2_env"]["status"] != "online") or "")
except:
    print("")
' 2>/dev/null)

if [ -n "$CRASHED" ] && [ "$CRASHED" != "" ]; then
    IFS=',' read -ra CRASHED_ARRAY <<< "$CRASHED"
    for SVC in "${CRASHED_ARRAY[@]}"; do
        pm2 restart "$SVC" 2>/dev/null
    done
    log_action "auto_fix" "system_health" "Restarted ${#CRASHED_ARRAY[@]} crashed services: $CRASHED" "{\"restarted\": \"$CRASHED\"}"

    sleep 5
    STILL_DOWN=$(pm2 jlist 2>/dev/null | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    print(",".join(p["name"] for p in data if p["pm2_env"]["status"] != "online") or "")
except:
    print("")
' 2>/dev/null)
    if [ -n "$STILL_DOWN" ] && [ "$STILL_DOWN" != "" ]; then
        log_action "error" "system_health" "Services still down after restart: $STILL_DOWN" "{\"still_down\": \"$STILL_DOWN\"}"
    fi
fi

# ─── Check disk — only alert if critical ──────────────────
DISK_PCT=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_PCT" -ge 85 ]; then
    log_action "error" "system_health" "Disk usage critical: ${DISK_PCT}%" "{\"disk_pct\": $DISK_PCT}"
fi

# ─── Check RDS — only alert if unreachable ────────────────
DB_CHECK=$(run_sql "SELECT 1" 2>/dev/null)
if [ "$DB_CHECK" != "1" ]; then
    log_action "error" "system_health" "PostgreSQL RDS unreachable" "{\"status\": \"unreachable\"}"
fi

# ─── Check dashboard — only alert if down ─────────────────
DASH_CODE=$(curl -sL -o /dev/null -w "%{http_code}" "https://nowoptimal.com/ops/login/" --max-time 10 2>/dev/null)
if [ "$DASH_CODE" != "200" ]; then
    log_action "error" "system_health" "Dashboard unreachable (HTTP $DASH_CODE)" "{\"http_code\": \"$DASH_CODE\"}"
fi
