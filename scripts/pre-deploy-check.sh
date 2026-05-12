#!/bin/bash
# pre-deploy-check.sh — Mandatory gatekeeper before any PM2 restart
# Usage: bash ~/gmhdashboard/scripts/pre-deploy-check.sh
# Exit code 0 = safe to deploy, non-zero = BLOCKED
#
# This script MUST pass before any pm2 restart gmh-dashboard.
# Add to CLAUDE.md as mandatory. Wire into the agent dashboard.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPORT_FILE="$PROJECT_DIR/docs/DEPLOY_CHECK.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
RESULTS=""

check_pass() { PASS=$((PASS + 1)); RESULTS="${RESULTS}\n${GREEN}✅ PASS${NC}: $1"; echo -e "${GREEN}✅ PASS${NC}: $1"; }
check_fail() { FAIL=$((FAIL + 1)); RESULTS="${RESULTS}\n${RED}🔴 FAIL${NC}: $1"; echo -e "${RED}🔴 FAIL${NC}: $1"; }
check_warn() { WARN=$((WARN + 1)); RESULTS="${RESULTS}\n${YELLOW}⚠️ WARN${NC}: $1"; echo -e "${YELLOW}⚠️ WARN${NC}: $1"; }

echo "================================================"
echo "  PRE-DEPLOY GATEKEEPER — $TIMESTAMP"
echo "================================================"
echo ""

# 1. TypeScript build check
echo "--- Check 1: TypeScript Build ---"
cd "$PROJECT_DIR"
BUILD_OUTPUT=$(npm run build 2>&1)
BUILD_EXIT=$?
if [ $BUILD_EXIT -eq 0 ]; then
    check_pass "Next.js build succeeded"
else
    check_fail "Next.js build FAILED — do not deploy"
    echo "$BUILD_OUTPUT" | tail -20
fi

# 2. TypeScript strict check (no ignoreBuildErrors bypass)
echo ""
echo "--- Check 2: TypeScript Type Check ---"
TSC_OUTPUT=$(npx tsc --noEmit 2>&1 | grep -c "error TS" || true)
if [ "$TSC_OUTPUT" -eq 0 ]; then
    check_pass "TypeScript: 0 errors"
elif [ "$TSC_OUTPUT" -lt 20 ]; then
    check_warn "TypeScript: $TSC_OUTPUT errors (pre-existing, review before deploy)"
else
    check_fail "TypeScript: $TSC_OUTPUT errors — too many to deploy safely"
fi

# 3. Uncommitted changes check
echo ""
echo "--- Check 3: Git Status ---"
UNCOMMITTED=$(git status --short | wc -l | tr -d ' ')
if [ "$UNCOMMITTED" -eq 0 ]; then
    check_pass "No uncommitted changes"
else
    check_warn "$UNCOMMITTED uncommitted files — commit before deploying"
fi

# 4. Branch check — should be on master for production
echo ""
echo "--- Check 4: Branch ---"
BRANCH=$(git branch --show-current)
if [ "$BRANCH" = "master" ] || [ "$BRANCH" = "main" ]; then
    check_pass "On $BRANCH branch (production)"
else
    check_warn "On branch '$BRANCH' — not master. Merge to master before production deploy."
fi

# 5. Health check — run existing health check and verify no regressions
echo ""
echo "--- Check 5: System Health ---"
if [ -f "$SCRIPT_DIR/health-check.sh" ]; then
    HEALTH_OUTPUT=$(bash "$SCRIPT_DIR/health-check.sh" 2>&1)
    HEALTH_FAILS=$(echo "$HEALTH_OUTPUT" | grep -c "FAIL" || true)
    HEALTH_PASS=$(echo "$HEALTH_OUTPUT" | grep -c "PASS\|passed" || true)
    if [ "$HEALTH_FAILS" -eq 0 ]; then
        check_pass "Health check: 0 failures"
    else
        check_warn "Health check: $HEALTH_FAILS failures — review before deploy"
    fi
else
    check_warn "Health check script not found"
fi

# 6. Disk space
echo ""
echo "--- Check 6: Disk Space ---"
DISK_PCT=$(df / | awk 'NR==2{gsub(/%/,""); print $5}')
if [ "$DISK_PCT" -le 75 ]; then
    check_pass "Disk: ${DISK_PCT}% used"
elif [ "$DISK_PCT" -le 85 ]; then
    check_warn "Disk: ${DISK_PCT}% used — getting tight"
else
    check_fail "Disk: ${DISK_PCT}% used — too full to deploy safely"
fi

# 7. Check for dangerous patterns in staged changes
echo ""
echo "--- Check 7: Dangerous Patterns ---"
DANGEROUS=$(git diff HEAD~1 --unified=0 2>/dev/null | grep -c "DROP TABLE\|DELETE FROM patients\|rm -rf\|status_key.*inactive.*WHERE\|TRUNCATE" || true)
if [ "$DANGEROUS" -eq 0 ]; then
    check_pass "No dangerous SQL/commands in recent changes"
else
    check_fail "DANGEROUS patterns detected in recent changes — review manually"
fi

# 8. Dependencies check — did we touch high-risk files?
echo ""
echo "--- Check 8: High-Risk File Changes ---"
HIGH_RISK_CHANGED=$(git diff master --name-only 2>/dev/null | grep -cE "lib/db\.ts|lib/auth\.ts|middleware\.ts|ecosystem\.config|\.env" || true)
if [ "$HIGH_RISK_CHANGED" -eq 0 ]; then
    check_pass "No high-risk infrastructure files changed"
else
    check_warn "$HIGH_RISK_CHANGED high-risk files changed — verify DEPENDENCIES.md impact"
fi

# Summary
echo ""
echo "================================================"
echo "  DEPLOY CHECK SUMMARY"
echo "  ✅ $PASS passed | ⚠️ $WARN warnings | 🔴 $FAIL failures"
echo "================================================"

if [ $FAIL -gt 0 ]; then
    echo -e "${RED}❌ DEPLOYMENT BLOCKED — fix failures before deploying${NC}"
    # Write report
    cat > "$REPORT_FILE" << EOF
# Deploy Check — BLOCKED
**Time**: $TIMESTAMP
**Result**: ❌ BLOCKED ($FAIL failures, $WARN warnings, $PASS passed)
**Action**: Fix failures before running pm2 restart
EOF
    exit 1
else
    echo -e "${GREEN}✅ SAFE TO DEPLOY${NC}"
    if [ $WARN -gt 0 ]; then
        echo -e "${YELLOW}  ($WARN warnings — review recommended)${NC}"
    fi
    # Write report
    cat > "$REPORT_FILE" << EOF
# Deploy Check — PASSED
**Time**: $TIMESTAMP
**Result**: ✅ PASSED ($PASS passed, $WARN warnings, $FAIL failures)
**Action**: Safe to run pm2 restart gmh-dashboard
EOF
    exit 0
fi
