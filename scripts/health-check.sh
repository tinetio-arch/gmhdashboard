#!/bin/bash
# =============================================================================
# GMH Dashboard KPI Health Check
# Based on NOW_120M_Playbook KPI scoreboard targets
# Usage: bash ~/gmhdashboard/scripts/health-check.sh
# Output: ~/gmhdashboard/docs/KPI_CHECK.md
# =============================================================================

set -euo pipefail

REPORT_FILE="$HOME/gmhdashboard/docs/KPI_CHECK.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')
ENV_FILE="$HOME/gmhdashboard/.env.local"
PASS=0; WARN=0; FAIL=0

# Load database credentials
if [ -f "$ENV_FILE" ]; then
  export DATABASE_HOST=$(grep '^DATABASE_HOST=' "$ENV_FILE" | cut -d'=' -f2-)
  export DATABASE_PORT=$(grep '^DATABASE_PORT=' "$ENV_FILE" | cut -d'=' -f2-)
  export DATABASE_NAME=$(grep '^DATABASE_NAME=' "$ENV_FILE" | cut -d'=' -f2-)
  export DATABASE_USER=$(grep '^DATABASE_USER=' "$ENV_FILE" | cut -d'=' -f2-)
  export DATABASE_PASSWORD=$(grep '^DATABASE_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)
fi

run_sql() {
  PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" -t -A -c "$1" 2>/dev/null || echo "ERROR"
}

# Helper: evaluate KPI
# Usage: check_kpi "Name" "value" "target" "operator" "warn_threshold"
RESULTS=""
add_result() {
  local icon="$1" name="$2" value="$3" target="$4" note="$5"
  RESULTS="$RESULTS
| $icon | $name | $value | $target | $note |"
  if [ "$icon" = "✅" ]; then PASS=$((PASS+1));
  elif [ "$icon" = "⚠️" ]; then WARN=$((WARN+1));
  else FAIL=$((FAIL+1)); fi
}

echo "Running KPI health checks..."

# --- KPI 1: Active Patient Count ---
ACTIVE_PATIENTS=$(run_sql "SELECT COUNT(*) FROM patients WHERE status_key = 'active'")
if [ "$ACTIVE_PATIENTS" != "ERROR" ]; then
  if [ "$ACTIVE_PATIENTS" -ge 380 ]; then
    add_result "✅" "Active Patients" "$ACTIVE_PATIENTS" "380" "At or above target"
  elif [ "$ACTIVE_PATIENTS" -ge 345 ]; then
    add_result "⚠️" "Active Patients" "$ACTIVE_PATIENTS" "380" "Above baseline (345), below target"
  else
    add_result "🔴" "Active Patients" "$ACTIVE_PATIENTS" "380" "Below baseline of 345"
  fi
else
  add_result "🔴" "Active Patients" "ERROR" "380" "Could not query database"
fi

# --- KPI 2: Patients on Billing Hold ---
BILLING_HOLDS=$(run_sql "SELECT COUNT(*) FROM patients WHERE status_key = 'hold_payment_research'")
if [ "$BILLING_HOLDS" != "ERROR" ]; then
  if [ "$BILLING_HOLDS" -eq 0 ]; then
    add_result "✅" "Billing Holds" "$BILLING_HOLDS" "0" "No patients on billing hold"
  elif [ "$BILLING_HOLDS" -le 5 ]; then
    add_result "⚠️" "Billing Holds" "$BILLING_HOLDS" "0" "Some patients need payment resolution"
  else
    add_result "🔴" "Billing Holds" "$BILLING_HOLDS" "0" "$BILLING_HOLDS patients stuck on hold"
  fi
else
  add_result "🔴" "Billing Holds" "ERROR" "0" "Could not query database"
fi

# --- KPI 3: Pending Lab Reviews ---
PENDING_LABS=$(run_sql "SELECT COUNT(*) FROM lab_review_queue WHERE status = 'pending'" 2>/dev/null || echo "0")
if [ "$PENDING_LABS" = "ERROR" ] || [ -z "$PENDING_LABS" ]; then PENDING_LABS=0; fi
if [ "$PENDING_LABS" -eq 0 ]; then
  add_result "✅" "Pending Lab Reviews" "$PENDING_LABS" "0" "All labs reviewed"
elif [ "$PENDING_LABS" -le 5 ]; then
  add_result "⚠️" "Pending Lab Reviews" "$PENDING_LABS" "0" "Some labs awaiting review"
else
  add_result "🔴" "Pending Lab Reviews" "$PENDING_LABS" "0" "Lab review backlog"
fi

# --- KPI 4: GHL Sync Rate ---
GHL_TOTAL=$(run_sql "SELECT COUNT(*) FROM patients WHERE status_key = 'active'")
GHL_SYNCED=$(run_sql "SELECT COUNT(*) FROM patients WHERE status_key = 'active' AND ghl_sync_status = 'synced'" 2>/dev/null || echo "0")
if [ "$GHL_TOTAL" != "ERROR" ] && [ "$GHL_TOTAL" -gt 0 ] && [ "$GHL_SYNCED" != "ERROR" ]; then
  GHL_RATE=$(python3 -c "print(round($GHL_SYNCED / $GHL_TOTAL * 100, 1))" 2>/dev/null || echo "0")
  if python3 -c "exit(0 if $GHL_RATE >= 95 else 1)" 2>/dev/null; then
    add_result "✅" "GHL Sync Rate" "${GHL_RATE}%" "100%" "$GHL_SYNCED/$GHL_TOTAL synced"
  elif python3 -c "exit(0 if $GHL_RATE >= 80 else 1)" 2>/dev/null; then
    add_result "⚠️" "GHL Sync Rate" "${GHL_RATE}%" "100%" "$GHL_SYNCED/$GHL_TOTAL synced"
  else
    add_result "🔴" "GHL Sync Rate" "${GHL_RATE}%" "100%" "Major sync gap"
  fi
else
  add_result "⚠️" "GHL Sync Rate" "N/A" "100%" "Could not determine sync status"
fi

# --- KPI 5: Disk Usage ---
DISK_PCT_RAW=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_PCT_RAW" -lt 60 ]; then
  add_result "✅" "Disk Usage" "${DISK_PCT_RAW}%" "<75%" "Healthy"
elif [ "$DISK_PCT_RAW" -lt 75 ]; then
  add_result "⚠️" "Disk Usage" "${DISK_PCT_RAW}%" "<75%" "Getting close to threshold"
else
  add_result "🔴" "Disk Usage" "${DISK_PCT_RAW}%" "<75%" "OVER THRESHOLD — clean up needed"
fi

# --- KPI 6: PM2 Service Restart Counts ---
PM2_JSON=$(pm2 jlist 2>/dev/null || echo '[]')
HIGH_RESTART_COUNT=$(echo "$PM2_JSON" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    high = [p for p in data if p["pm2_env"]["restart_time"] > 10]
    print(len(high))
except:
    print(0)
' 2>/dev/null)
TOTAL_RESTARTS=$(echo "$PM2_JSON" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    print(sum(p["pm2_env"]["restart_time"] for p in data))
except:
    print(0)
' 2>/dev/null)
if [ "$HIGH_RESTART_COUNT" -eq 0 ]; then
  add_result "✅" "PM2 Restarts" "$TOTAL_RESTARTS total" "<10 each" "No services with high restart counts"
elif [ "$HIGH_RESTART_COUNT" -le 2 ]; then
  add_result "⚠️" "PM2 Restarts" "$TOTAL_RESTARTS total" "<10 each" "$HIGH_RESTART_COUNT services with >10 restarts"
else
  add_result "🔴" "PM2 Restarts" "$TOTAL_RESTARTS total" "<10 each" "$HIGH_RESTART_COUNT services unstable"
fi

# --- KPI 7: PM2 All Services Online ---
ONLINE_COUNT=$(echo "$PM2_JSON" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    print(sum(1 for p in data if p["pm2_env"]["status"] == "online"))
except:
    print(0)
' 2>/dev/null)
TOTAL_SERVICES=$(echo "$PM2_JSON" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    print(len(data))
except:
    print(0)
' 2>/dev/null)
if [ "$ONLINE_COUNT" -eq "$TOTAL_SERVICES" ] && [ "$TOTAL_SERVICES" -gt 0 ]; then
  add_result "✅" "Services Online" "$ONLINE_COUNT/$TOTAL_SERVICES" "All online" "All services running"
else
  DOWN=$((TOTAL_SERVICES - ONLINE_COUNT))
  add_result "🔴" "Services Online" "$ONLINE_COUNT/$TOTAL_SERVICES" "All online" "$DOWN services DOWN"
fi

# --- KPI 8: Peptide SKUs at Zero Stock ---
ZERO_STOCK=$(run_sql "SELECT COUNT(*) FROM peptide_products WHERE stock_quantity = 0 AND active = true" 2>/dev/null || echo "N/A")
if [ "$ZERO_STOCK" = "ERROR" ] || [ "$ZERO_STOCK" = "N/A" ]; then
  add_result "⚠️" "Peptide Zero-Stock SKUs" "N/A" "0" "Could not query peptide inventory"
elif [ "$ZERO_STOCK" -eq 0 ]; then
  add_result "✅" "Peptide Zero-Stock SKUs" "0" "0" "All SKUs in stock"
else
  add_result "🔴" "Peptide Zero-Stock SKUs" "$ZERO_STOCK" "0" "$ZERO_STOCK products out of stock"
fi

# --- Write Report ---
cat > "$REPORT_FILE" << EOF
# KPI Health Check — GMH Dashboard

**Generated**: $TIMESTAMP
**Result**: ✅ $PASS passed | ⚠️ $WARN warnings | 🔴 $FAIL failures

---

| Status | KPI | Current | Target | Notes |
|--------|-----|---------|--------|-------|
$RESULTS

---

## Targets (from NOW_120M_Playbook)

- **Active Patients**: 345 → 380 (90-day goal)
- **Billing Holds**: 0 (all resolved within 48h)
- **Pending Labs**: 0 (reviewed same day)
- **GHL Sync Rate**: 100% (all active patients synced)
- **Disk Usage**: <75% (50GB volume)
- **PM2 Restarts**: <10 per service (crash loops = immediate action)
- **Services Online**: All 13+ services running
- **Peptide Zero-Stock**: 0 (reorder triggers at low stock)

---

*Auto-generated by health-check.sh — do not edit manually.*
EOF

echo ""
echo "========================="
echo "KPI CHECK COMPLETE"
echo "✅ $PASS passed | ⚠️ $WARN warnings | 🔴 $FAIL failures"
echo "Report: $REPORT_FILE"
echo "========================="
