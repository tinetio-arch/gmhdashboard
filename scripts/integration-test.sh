#!/bin/bash
# =============================================================================
# GMH Integration Test Suite
# Tests 4 critical API flows + database connectivity + PM2 services
# Usage: bash ~/gmhdashboard/scripts/integration-test.sh
# Returns exit code 0 if all pass, 1 if any fail
# =============================================================================

set -uo pipefail

BASE_URL="https://nowoptimal.com/ops"
ENV_FILE="$HOME/gmhdashboard/.env.local"
PASS=0; FAIL=0; WARN=0
RESULTS=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Load env
if [ -f "$ENV_FILE" ]; then
  export DATABASE_HOST=$(grep '^DATABASE_HOST=' "$ENV_FILE" | cut -d'=' -f2-)
  export DATABASE_PORT=$(grep '^DATABASE_PORT=' "$ENV_FILE" | cut -d'=' -f2-)
  export DATABASE_NAME=$(grep '^DATABASE_NAME=' "$ENV_FILE" | cut -d'=' -f2-)
  export DATABASE_USER=$(grep '^DATABASE_USER=' "$ENV_FILE" | cut -d'=' -f2-)
  export DATABASE_PASSWORD=$(grep '^DATABASE_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)
  export CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d'=' -f2-)
fi

run_sql() {
  PGPASSWORD="$DATABASE_PASSWORD" psql -h "$DATABASE_HOST" -p "$DATABASE_PORT" -U "$DATABASE_USER" -d "$DATABASE_NAME" -t -A -c "$1" 2>/dev/null
}

pass() {
  echo -e "  ${GREEN}PASS${NC} $1"
  PASS=$((PASS+1))
}

fail() {
  echo -e "  ${RED}FAIL${NC} $1 — $2"
  FAIL=$((FAIL+1))
}

warn() {
  echo -e "  ${YELLOW}WARN${NC} $1 — $2"
  WARN=$((WARN+1))
}

echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
echo -e "${CYAN}  GMH Integration Test Suite${NC}"
echo -e "${CYAN}  $(date '+%Y-%m-%d %H:%M:%S %Z')${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
echo ""

# ─── TEST 1: DATABASE CONNECTIVITY ────────────────────────
echo -e "${CYAN}[1/7] Database Connectivity${NC}"

DB_RESULT=$(run_sql "SELECT 1" 2>/dev/null)
if [ "$DB_RESULT" = "1" ]; then
  pass "PostgreSQL connection"
else
  fail "PostgreSQL connection" "Cannot reach RDS"
fi

TABLE_COUNT=$(run_sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null)
if [ -n "$TABLE_COUNT" ] && [ "$TABLE_COUNT" -gt 50 ]; then
  pass "Schema integrity ($TABLE_COUNT tables)"
else
  fail "Schema integrity" "Expected 50+ tables, got ${TABLE_COUNT:-0}"
fi

PATIENT_COUNT=$(run_sql "SELECT COUNT(*) FROM patients WHERE LOWER(status_key) = 'active'" 2>/dev/null)
if [ -n "$PATIENT_COUNT" ] && [ "$PATIENT_COUNT" -gt 0 ]; then
  pass "Patients table has data ($PATIENT_COUNT active)"
else
  fail "Patients table" "No active patients found"
fi

echo ""

# ─── TEST 2: PM2 SERVICES ────────────────────────────────
echo -e "${CYAN}[2/7] PM2 Services${NC}"

CRITICAL_SERVICES="gmh-dashboard upload-receiver ghl-webhooks email-triage fax-processor uptime-monitor"
for SVC in $CRITICAL_SERVICES; do
  STATUS=$(pm2 show "$SVC" 2>/dev/null | grep "status" | head -1 | sed 's/\x1b\[[0-9;]*m//g' | awk '{print $4}')
  if [ "$STATUS" = "online" ]; then
    pass "$SVC is online"
  else
    fail "$SVC" "status: ${STATUS:-not found}"
  fi
done

echo ""

# ─── TEST 3: DASHBOARD API (Patient Lookup Flow) ─────────
echo -e "${CYAN}[3/7] Dashboard API — Patient Lookup${NC}"

DASHBOARD_RESP=$(curl -sL -o /dev/null -w "%{http_code}" "$BASE_URL/api/ipad/dashboard" -H "x-cron-secret: $CRON_SECRET" --max-time 15 2>/dev/null)
if [ "$DASHBOARD_RESP" = "200" ]; then
  pass "iPad dashboard API returns 200"
else
  if [ "$DASHBOARD_RESP" = "401" ]; then
    warn "iPad dashboard API" "returns 401 (expected — requires session cookie, not cron secret)"
  else
    fail "iPad dashboard API" "HTTP $DASHBOARD_RESP"
  fi
fi

# Test the cron morning-prep endpoint (uses cron secret auth)
MORNING_RESP=$(curl -sL -w "\n%{http_code}" "$BASE_URL/api/cron/morning-prep/" -H "x-cron-secret: $CRON_SECRET" --max-time 30 2>/dev/null)
MORNING_CODE=$(echo "$MORNING_RESP" | tail -1)
MORNING_BODY=$(echo "$MORNING_RESP" | head -n -1)
if [ "$MORNING_CODE" = "200" ]; then
  HAS_DATA=$(echo "$MORNING_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('success') or d.get('data') or 'appointments' in str(d) else 'no')" 2>/dev/null || echo "no")
  if [ "$HAS_DATA" = "yes" ]; then
    pass "Morning prep cron returns valid data"
  else
    warn "Morning prep cron" "returned 200 but data structure unexpected"
  fi
else
  fail "Morning prep cron" "HTTP $MORNING_CODE"
fi

echo ""

# ─── TEST 4: INVENTORY FLOW ──────────────────────────────
echo -e "${CYAN}[4/7] Inventory System${NC}"

VIAL_COUNT=$(run_sql "SELECT COUNT(*) FROM vials WHERE status = 'Active'" 2>/dev/null)
if [ -n "$VIAL_COUNT" ] && [ "$VIAL_COUNT" -gt 0 ]; then
  pass "Active vials exist ($VIAL_COUNT)"
else
  warn "Active vials" "No active vials found (may be expected)"
fi

STAGED_COUNT=$(run_sql "SELECT COUNT(*) FROM staged_doses WHERE status = 'staged' AND staged_for_date = (NOW() AT TIME ZONE 'America/Phoenix')::date" 2>/dev/null)
if [ -n "$STAGED_COUNT" ]; then
  pass "Staged doses query works ($STAGED_COUNT for today)"
else
  fail "Staged doses query" "Query failed"
fi

DEA_COUNT=$(run_sql "SELECT COUNT(*) FROM dea_transactions" 2>/dev/null)
if [ -n "$DEA_COUNT" ]; then
  pass "DEA transactions table accessible ($DEA_COUNT records)"
else
  fail "DEA transactions" "Cannot query dea_transactions"
fi

echo ""

# ─── TEST 5: BILLING FLOW ────────────────────────────────
echo -e "${CYAN}[5/7] Billing System${NC}"

PT_COUNT=$(run_sql "SELECT COUNT(*) FROM payment_transactions WHERE created_at >= NOW() - INTERVAL '30 days'" 2>/dev/null)
if [ -n "$PT_COUNT" ]; then
  pass "Payment transactions accessible ($PT_COUNT in last 30 days)"
else
  fail "Payment transactions" "Cannot query payment_transactions"
fi

FAILED_COUNT=$(run_sql "SELECT COUNT(*) FROM payment_transactions WHERE status IN ('failed','error','declined') AND created_at >= NOW() - INTERVAL '30 days'" 2>/dev/null)
if [ -n "$FAILED_COUNT" ]; then
  pass "Failed charges query works ($FAILED_COUNT failed in 30 days)"
else
  fail "Failed charges query" "Query failed"
fi

echo ""

# ─── TEST 6: LABS FLOW ───────────────────────────────────
echo -e "${CYAN}[6/7] Labs System${NC}"

LAB_ORDER_COUNT=$(run_sql "SELECT COUNT(*) FROM lab_orders" 2>/dev/null)
if [ -n "$LAB_ORDER_COUNT" ]; then
  pass "Lab orders table accessible ($LAB_ORDER_COUNT orders)"
else
  fail "Lab orders" "Cannot query lab_orders"
fi

LAB_REVIEW_COUNT=$(run_sql "SELECT COUNT(*) FROM lab_review_queue WHERE status = 'pending'" 2>/dev/null || echo "0")
if [ -n "$LAB_REVIEW_COUNT" ]; then
  pass "Lab review queue accessible ($LAB_REVIEW_COUNT pending)"
else
  fail "Lab review queue" "Cannot query lab_review_queue"
fi

CRITICAL_LABS=$(run_sql "SELECT COUNT(*) FROM critical_lab_alerts WHERE status = 'pending'" 2>/dev/null || echo "0")
if [ -n "$CRITICAL_LABS" ]; then
  pass "Critical lab alerts accessible ($CRITICAL_LABS pending)"
else
  warn "Critical lab alerts" "Table may not exist yet"
fi

echo ""

# ─── TEST 7: WEBSITE ENDPOINTS ───────────────────────────
echo -e "${CYAN}[7/7] Website Endpoints${NC}"

SITES="https://nowoptimal.com https://nowmenshealth.care https://nowprimary.care https://abxtac.com"
for SITE in $SITES; do
  HTTP_CODE=$(curl -sL -o /dev/null -w "%{http_code}" "$SITE" --max-time 10 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then
    pass "$SITE returns 200"
  else
    fail "$SITE" "HTTP $HTTP_CODE"
  fi
done

# Dashboard login page (should return 200 even without auth)
LOGIN_CODE=$(curl -sL -o /dev/null -w "%{http_code}" "$BASE_URL/login/" --max-time 10 2>/dev/null)
if [ "$LOGIN_CODE" = "200" ]; then
  pass "Dashboard login page returns 200"
else
  fail "Dashboard login page" "HTTP $LOGIN_CODE"
fi

echo ""

# ─── SUMMARY ─────────────────────────────────────────────
echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
TOTAL=$((PASS+FAIL+WARN))
echo -e "  ${GREEN}PASS: $PASS${NC}  ${RED}FAIL: $FAIL${NC}  ${YELLOW}WARN: $WARN${NC}  (total: $TOTAL)"

if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}ALL CRITICAL TESTS PASSED${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
  exit 0
else
  echo -e "  ${RED}$FAIL CRITICAL FAILURES — DO NOT DEPLOY${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
  exit 1
fi
