#!/bin/bash
# generate-status-report.sh — Queries live systems and outputs a markdown status report
# Usage: bash ~/gmhdashboard/scripts/generate-status-report.sh
# Output: ~/gmhdashboard/docs/LIVE_STATUS.md

OUTPUT="$HOME/gmhdashboard/docs/LIVE_STATUS.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')

# Load env vars safely (handle special chars in values)
eval $(grep -E '^DATABASE_' $HOME/gmhdashboard/.env.local | while IFS='=' read -r key val; do echo "export $key=\"$val\""; done) 2>/dev/null || true
export PGPASSWORD="$DATABASE_PASSWORD"
export PGSSLMODE="$DATABASE_SSLMODE"
DB_CMD="psql -h $DATABASE_HOST -p $DATABASE_PORT -U $DATABASE_USER -d $DATABASE_NAME -t -A"

echo "Generating live status report..."

# ---- PM2 Status ----
PM2_ONLINE=$(pm2 jlist 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.filter(s=>s.pm2_env.status==='online').length)" 2>/dev/null || echo '?')
PM2_TOTAL=$(pm2 jlist 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.length)" 2>/dev/null || echo '?')
PM2_RESTARTS=$(pm2 jlist 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));d.forEach(s=>console.log(s.name+': '+s.pm2_env.restart_time+' restarts'))" 2>/dev/null || echo 'unable to query')

# ---- Disk Usage ----
DISK_USAGE=$(df -h / | awk 'NR==2{print $5}')
DISK_AVAIL=$(df -h / | awk 'NR==2{print $4}')
DISK_TOTAL=$(df -h / | awk 'NR==2{print $2}')

# ---- Memory ----
MEM_USED=$(free -m 2>/dev/null | awk 'NR==2{printf "%.0f", $3/1024}' || echo '?')
MEM_TOTAL=$(free -m 2>/dev/null | awk 'NR==2{printf "%.0f", $2/1024}' || echo '?')

# ---- CPU ----
CPU_LOAD=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}' || echo '?')

# ---- Database Queries ----
ACTIVE_PATIENTS=$($DB_CMD -c "SELECT COUNT(*) FROM patients WHERE status_key='active';" 2>/dev/null || echo '?')
INACTIVE_PATIENTS=$($DB_CMD -c "SELECT COUNT(*) FROM patients WHERE status_key='inactive';" 2>/dev/null || echo '?')
BILLING_HOLDS=$($DB_CMD -c "SELECT COUNT(*) FROM patients WHERE status_key='hold_payment_research';" 2>/dev/null || echo '?')
TOTAL_PATIENTS=$($DB_CMD -c "SELECT COUNT(*) FROM patients;" 2>/dev/null || echo '?')

GHL_SYNCED=$($DB_CMD -c "SELECT COUNT(*) FROM patients WHERE ghl_contact_id IS NOT NULL AND ghl_contact_id != '' AND status_key='active';" 2>/dev/null || echo '?')
GHL_PENDING=$($DB_CMD -c "SELECT COUNT(*) FROM patients WHERE (ghl_contact_id IS NULL OR ghl_contact_id='') AND status_key='active';" 2>/dev/null || echo '?')

PENDING_LABS=$($DB_CMD -c "SELECT COUNT(*) FROM lab_review_queue WHERE status='pending_review';" 2>/dev/null || echo '?')

ZERO_STOCK=$($DB_CMD -c "SELECT COUNT(*) FROM peptide_products pp LEFT JOIN (SELECT product_id, SUM(remaining_volume_ml) as total_stock FROM vials WHERE status='active' GROUP BY product_id) v ON pp.product_id=v.product_id WHERE pp.active=true AND (v.total_stock IS NULL OR v.total_stock <= 0);" 2>/dev/null || echo '?')

# ---- Build Report ----
cat > "$OUTPUT" << REPORTEOF
# Live System Status Report

**Generated**: $TIMESTAMP
**Server**: AWS EC2 (3.141.49.8)

---

## Infrastructure

| Metric | Value | Target |
|---|---|---|
| Disk Usage | $DISK_USAGE ($DISK_AVAIL free of $DISK_TOTAL) | < 75% |
| RAM | ${MEM_USED}GB / ${MEM_TOTAL}GB | < 80% |
| CPU Load | $CPU_LOAD | < 2.0 |
| PM2 Services | $PM2_ONLINE / $PM2_TOTAL online | All online |

### PM2 Service Restarts
\`\`\`
$PM2_RESTARTS
\`\`\`

## Patient Data

| Metric | Value | Target |
|---|---|---|
| Active Patients | $ACTIVE_PATIENTS | 345+ |
| Inactive Patients | $INACTIVE_PATIENTS | Reactivate 20 |
| Billing Holds | $BILLING_HOLDS | 0 |
| Total in System | $TOTAL_PATIENTS | — |

## Integrations

| Metric | Value | Target |
|---|---|---|
| GHL Synced (active) | $GHL_SYNCED | 100% of active |
| GHL Pending Sync | $GHL_PENDING | 0 |
| Pending Lab Reviews | $PENDING_LABS | 0 (same day) |
| Peptide SKUs at Zero | $ZERO_STOCK | 0 |

---
*Run: \`bash ~/gmhdashboard/scripts/generate-status-report.sh\`*
REPORTEOF

echo "Report saved to $OUTPUT"
