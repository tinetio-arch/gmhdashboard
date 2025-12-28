#!/bin/bash
# GMH Dashboard Health Check Script
# Created: Dec 28, 2025
# Purpose: Daily automated health monitoring
# Run via cron: 0 8 * * * /home/ec2-user/gmhdashboard/scripts/health-check.sh

LOG_FILE="/home/ec2-user/logs/gmh-health.log"
mkdir -p /home/ec2-user/logs
ALERT_THRESHOLD_DISK=85
ALERT_THRESHOLD_MEM=90

echo "=====================================" >> $LOG_FILE
echo "GMH Dashboard Health Check - $(date)" >> $LOG_FILE
echo "=====================================" >> $LOG_FILE

# 1. Disk Space Check
echo "[DISK] Checking disk usage..." >> $LOG_FILE
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
echo "Disk usage: ${DISK_USAGE}%" >> $LOG_FILE
if [ "$DISK_USAGE" -gt "$ALERT_THRESHOLD_DISK" ]; then
  echo "⚠️  ALERT: Disk usage ${DISK_USAGE}% exceeds threshold ${ALERT_THRESHOLD_DISK}%" >> $LOG_FILE
  # TODO: Send alert (Telegram/email)
fi

# 2. PM2 Processes Check
echo "[PM2] Checking PM2 processes..." >> $LOG_FILE
PM2_ONLINE=$(pm2 jlist | jq -r '.[] | select(.pm2_env.status=="online") | .name' | wc -l)
PM2_TOTAL=$(pm2 jlist | jq -r '.[].name' | wc -l)
echo "PM2 processes: ${PM2_ONLINE}/${PM2_TOTAL} online" >> $LOG_FILE
if [ "$PM2_ONLINE" -lt "$PM2_TOTAL" ]; then
  echo "⚠️  ALERT: Some PM2 processes are down" >> $LOG_FILE
  pm2 jlist | jq -r '.[] | select(.pm2_env.status!="online") | "\(.name): \(.pm2_env.status)"' >> $LOG_FILE
fi

# 3. Dashboard Response Check
echo "[HTTP] Checking dashboard response..." >> $LOG_FILE
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://localhost:3000/ops/ 2>/dev/null)
echo "HTTP status: ${HTTP_STATUS}" >> $LOG_FILE
if [ "$HTTP_STATUS" != "307" ] && [ "$HTTP_STATUS" != "200" ]; then
  echo "⚠️  ALERT: Dashboard not responding correctly (expected 307 or 200, got ${HTTP_STATUS})" >> $LOG_FILE
fi

# 4. Database Connection Check
echo "[DB] Checking Postgres connection..." >> $LOG_FILE
# Load env vars from .env.local
if [ -f "/home/ec2-user/gmhdashboard/.env.local" ]; then
  export $(grep -v '^#' /home/ec2-user/gmhdashboard/.env.local | grep 'DATABASE_' | xargs)
fi
DB_CHECK=$(PGPASSWORD="${DATABASE_PASSWORD}" psql -h "${DATABASE_HOST}" -U "${DATABASE_USER}" -d "${DATABASE_NAME}" -c "SELECT 1" 2>&1 | grep -c "1 row")
if [ "$DB_CHECK" -eq 1 ]; then
  echo "Database: Connected ✓" >> $LOG_FILE
else
  echo "⚠️  ALERT: Database connection failed" >> $LOG_FILE
fi

# 5. Memory Usage Check
echo "[MEM] Checking memory usage..." >> $LOG_FILE
MEM_USAGE=$(free | awk 'NR==2 {printf "%.0f", $3/$2 * 100}')
echo "Memory usage: ${MEM_USAGE}%" >> $LOG_FILE
if [ "$MEM_USAGE" -gt "$ALERT_THRESHOLD_MEM" ]; then
  echo "⚠️  ALERT: Memory usage ${MEM_USAGE}% exceeds threshold ${ALERT_THRESHOLD_MEM}%" >> $LOG_FILE
fi

# 6. Recent Errors Check
echo "[LOGS] Checking for recent errors..." >> $LOG_FILE
ERROR_COUNT=$(pm2 logs gmh-dashboard --lines 100 --nostream 2>/dev/null | grep -i "error\|failed\|exception" | wc -l)
echo "Recent errors in logs: ${ERROR_COUNT}" >> $LOG_FILE
if [ "$ERROR_COUNT" -gt 10 ]; then
  echo "⚠️  ALERT: High error count (${ERROR_COUNT}) in recent logs" >> $LOG_FILE
fi

# 7. ClinicSync Removal Verification (one-time check, will remove after confirmed)
echo "[CLEANUP] Verifying ClinicSync removal..." >> $LOG_FILE
CLINICSYNC_REF=$(grep -r "ClinicSync\|clinicsync" /home/ec2-user/gmhdashboard/app --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "removed\|deprecated\|DEPRECATED" | wc -l)
echo "ClinicSync references (excluding deprecation comments): ${CLINICSYNC_REF}" >> $LOG_FILE
if [ "$CLINICSYNC_REF" -gt 0 ]; then
  echo "⚠️  WARNING: Found ${CLINICSYNC_REF} ClinicSync references still in code" >> $LOG_FILE
fi

echo "Health check complete at $(date)" >> $LOG_FILE
echo "" >> $LOG_FILE

# Return exit code based on critical alerts
if grep -q "⚠️  ALERT:" $LOG_FILE | tail -50; then
  exit 1
else
  exit 0
fi
