#!/bin/bash
# health-check.sh — KPI scoreboard with pass/warn/fail indicators
# Usage: bash ~/gmhdashboard/scripts/health-check.sh
# Output: ~/gmhdashboard/docs/KPI_CHECK.md + stdout summary

OUTPUT="$HOME/gmhdashboard/docs/KPI_CHECK.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')

# Load env vars safely
eval $(grep -E '^DATABASE_' $HOME/gmhdashboard/.env.local | while IFS='=' read -r key val; do echo "export $key=\"$val\""; done) 2>/dev/null || true
export PGPASSWORD="$DATABASE_PASSWORD"
export PGSSLMODE="$DATABASE_SSLMODE"
DB_CMD="psql -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USER -d $DATABASE_NAME -t -A"

RESULTS=""
add_result() {
  local name="$1" value="$2" target="$3" status="$4"
  RESULTS="${RESULTS}| $status | $name | $value | $target |\n"
}

echo "Running KPI health checks..."

# 1. Active patients
VAL=$($DB_CMD -c "SELECT COUNT(*) FROM patients WHERE status_key='active';" 2>/dev/null || echo '0')
if [ "$VAL" -ge 380 ] 2>/dev/null; then S="PASS"; elif [ "$VAL" -ge 345 ] 2>/dev/null; then S="WARN"; else S="FAIL"; fi
add_result "Active Patients" "$VAL" "380 (90d)" "$S"

# 2. Billing holds
VAL=$($DB_CMD -c "SELECT COUNT(*) FROM patients WHERE status_key='hold_payment_research';" 2>/dev/null || echo '0')
if [ "$VAL" -eq 0 ] 2>/dev/null; then S="PASS"; elif [ "$VAL" -le 3 ] 2>/dev/null; then S="WARN"; else S="FAIL"; fi
add_result "Billing Holds" "$VAL" "0" "$S"

# 3. GHL sync rate
SYNCED=$($DB_CMD -c "SELECT COUNT(*) FROM patients WHERE ghl_contact_id IS NOT NULL AND ghl_contact_id != '' AND status_key='active';" 2>/dev/null || echo '0')
TOTAL_ACT=$($DB_CMD -c "SELECT COUNT(*) FROM patients WHERE status_key='active';" 2>/dev/null || echo '1')
RATE=$(echo "scale=0; $SYNCED * 100 / $TOTAL_ACT" | bc 2>/dev/null || echo '0')
if [ "$RATE" -ge 100 ] 2>/dev/null; then S="PASS"; elif [ "$RATE" -ge 80 ] 2>/dev/null; then S="WARN"; else S="FAIL"; fi
add_result "GHL Sync Rate" "${RATE}%" "100%" "$S"

# 4. Pending labs
VAL=$($DB_CMD -c "SELECT COUNT(*) FROM lab_review_queue WHERE status='pending_review';" 2>/dev/null || echo '0')
if [ "$VAL" -eq 0 ] 2>/dev/null; then S="PASS"; elif [ "$VAL" -le 5 ] 2>/dev/null; then S="WARN"; else S="FAIL"; fi
add_result "Pending Lab Reviews" "$VAL" "0" "$S"

# 5. Peptide zero stock
VAL=$($DB_CMD -c "SELECT COUNT(*) FROM peptide_products pp LEFT JOIN (SELECT product_id, SUM(remaining_volume_ml) as total_stock FROM vials WHERE status='active' GROUP BY product_id) v ON pp.product_id=v.product_id WHERE pp.active=true AND (v.total_stock IS NULL OR v.total_stock <= 0);" 2>/dev/null || echo '0')
if [ "$VAL" -eq 0 ] 2>/dev/null; then S="PASS"; elif [ "$VAL" -le 5 ] 2>/dev/null; then S="WARN"; else S="FAIL"; fi
add_result "Peptide SKUs at Zero" "$VAL" "0" "$S"

# 6. Disk usage
DISK_PCT=$(df / | awk 'NR==2{gsub(/%/,""); print $5}')
if [ "$DISK_PCT" -le 65 ] 2>/dev/null; then S="PASS"; elif [ "$DISK_PCT" -le 75 ] 2>/dev/null; then S="WARN"; else S="FAIL"; fi
add_result "Disk Usage" "${DISK_PCT}%" "< 75%" "$S"

# 7. Dashboard restarts
DR=$(pm2 jlist 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const s=d.find(x=>x.name==='gmh-dashboard');console.log(s?s.pm2_env.restart_time:0)" 2>/dev/null || echo '0')
if [ "$DR" -le 5 ] 2>/dev/null; then S="PASS"; elif [ "$DR" -le 50 ] 2>/dev/null; then S="WARN"; else S="FAIL"; fi
add_result "Dashboard Restarts" "$DR" "< 5" "$S"

# 8. PM2 all online
OFF=$(pm2 jlist 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.filter(s=>s.pm2_env.status!=='online').length)" 2>/dev/null || echo '0')
if [ "$OFF" -eq 0 ] 2>/dev/null; then S="PASS"; else S="FAIL"; fi
add_result "PM2 All Online" "$OFF offline" "0" "$S"

# Build output
cat > "$OUTPUT" << REPORTEOF
# KPI Health Check

**Run at**: $TIMESTAMP

| Status | KPI | Current | Target |
|---|---|---|---|
$(echo -e "$RESULTS")

---
*Run: \`bash ~/gmhdashboard/scripts/health-check.sh\`*
REPORTEOF

echo ""
echo "=== KPI HEALTH CHECK ($TIMESTAMP) ==="
echo -e "$RESULTS"
echo "Saved to $OUTPUT"
