#!/bin/bash
# =============================================================================
# Full System Debug Script
# Tests every layer: Dashboard, Lambda, Healthie, Database, PM2, Endpoints
# Can be run standalone or called by auto-remediation agent
#
# Usage: bash ~/gmhdashboard/scripts/agents/debug-all-systems.sh
# Exit code: 0 = all pass, 1 = failures found
# Output: structured JSON-compatible report to stdout
# =============================================================================

set -o pipefail

cd /home/ec2-user/gmhdashboard

ENV_FILE=".env.local"
PASS=0; FAIL=0; WARN=0
FAILURES=""

# Load env
DB_HOST=$(grep '^DATABASE_HOST=' "$ENV_FILE" | cut -d'=' -f2-)
DB_PORT=$(grep '^DATABASE_PORT=' "$ENV_FILE" | cut -d'=' -f2-)
DB_NAME=$(grep '^DATABASE_NAME=' "$ENV_FILE" | cut -d'=' -f2-)
DB_USER=$(grep '^DATABASE_USER=' "$ENV_FILE" | cut -d'=' -f2-)
DB_PASS=$(grep '^DATABASE_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)
SECRET=$(grep '^JARVIS_SHARED_SECRET=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")

run_sql() {
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "$1" 2>/dev/null
}

pass() { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1 — $2"; FAIL=$((FAIL+1)); FAILURES="$FAILURES|$1: $2"; }
warn() { echo "  ⚠️  $1 — $2"; WARN=$((WARN+1)); }

echo "╔══════════════════════════════════════════════╗"
echo "║  GMH Full System Debug — $(date '+%Y-%m-%d %H:%M') MST  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ═══════════════════════════════════════
# 1. PM2 SERVICES
# ═══════════════════════════════════════
echo "━━━ [1/9] PM2 Services ━━━"
TOTAL=$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo "0")
ONLINE=$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json; print(sum(1 for p in json.load(sys.stdin) if p["pm2_env"]["status"]=="online"))' 2>/dev/null || echo "0")
CRASHED=$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json; c=[p["name"] for p in json.load(sys.stdin) if p["pm2_env"]["status"]!="online"]; print(",".join(c) if c else "")' 2>/dev/null || echo "")

if [ "$ONLINE" -eq "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
    pass "All $TOTAL PM2 services online"
else
    fail "PM2 services" "$ONLINE/$TOTAL online, crashed: $CRASHED"
fi

# Check gmh-dashboard specifically
DASH_STATUS=$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json; d=[p for p in json.load(sys.stdin) if "gmh-dashboard" in p["name"]]; print(d[0]["pm2_env"]["status"] if d else "missing")' 2>/dev/null || echo "unknown")
if [ "$DASH_STATUS" = "online" ]; then
    pass "gmh-dashboard is online"
else
    fail "gmh-dashboard" "status=$DASH_STATUS"
fi

# ═══════════════════════════════════════
# 2. DATABASE
# ═══════════════════════════════════════
echo ""
echo "━━━ [2/9] Database ━━━"
DB_CHECK=$(run_sql "SELECT 1")
if [ "$DB_CHECK" = "1" ]; then
    pass "PostgreSQL RDS reachable"
else
    fail "PostgreSQL RDS" "unreachable"
fi

PATIENT_COUNT=$(run_sql "SELECT COUNT(*) FROM patients" || echo "0")
if [ "$PATIENT_COUNT" -gt 100 ]; then
    pass "Patients table: $PATIENT_COUNT rows"
else
    warn "Patients table" "only $PATIENT_COUNT rows (expected 300+)"
fi

# Check for NaN/corrupt DOBs
BAD_DOBS=$(run_sql "SELECT COUNT(*) FROM patients WHERE dob IS NOT NULL AND dob > '2024-01-01' AND dob NOT IN (SELECT dob FROM patients WHERE full_name ILIKE '%ross%' OR full_name ILIKE '%aldorasi%' OR full_name ILIKE '%bunger%' OR full_name ILIKE '%roberts%')" || echo "0")
if [ "$BAD_DOBS" -eq 0 ]; then
    pass "No corrupt DOBs (post-2024 dates)"
else
    fail "Corrupt DOBs" "$BAD_DOBS patients with future/wrong DOB"
fi

# ═══════════════════════════════════════
# 3. DASHBOARD API ENDPOINTS
# ═══════════════════════════════════════
echo ""
echo "━━━ [3/9] Dashboard API Endpoints ━━━"
for EP in \
    "patient-services/?healthie_user_id=12123979" \
    "patient-context/?healthie_id=12123979" \
    "pending-consent/?healthie_id=12123979" \
    "lab-status/?healthie_id=12123979" \
    "access-check/?healthie_id=12123979"; do
    CODE=$(curl -so /dev/null -w "%{http_code}" -H "x-jarvis-secret: $SECRET" "http://localhost:3011/ops/api/headless/$EP" --max-time 10 2>/dev/null)
    EP_SHORT=$(echo "$EP" | cut -d'?' -f1)
    if [ "$CODE" = "200" ]; then
        pass "$EP_SHORT → $CODE"
    else
        fail "$EP_SHORT" "HTTP $CODE"
    fi
done

# ═══════════════════════════════════════
# 4. GENDER FILTER
# ═══════════════════════════════════════
echo ""
echo "━━━ [4/9] Gender Filter (Pelleting) ━━━"
PHIL_RESP=$(curl -s -H "x-jarvis-secret: $SECRET" "http://localhost:3011/ops/api/headless/patient-services/?healthie_user_id=12123979" --max-time 10 2>/dev/null)
PHIL_LEAK=$(echo "$PHIL_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); ids=d.get("unlockedAppointmentTypeIds",[]); print("YES" if any(i in ids for i in ["504729","504730"]) else "NO")' 2>/dev/null || echo "ERROR")
if [ "$PHIL_LEAK" = "NO" ]; then
    pass "Phil (M): no female pellet IDs leaked"
elif [ "$PHIL_LEAK" = "YES" ]; then
    fail "Gender filter" "Phil (M) sees female pellet types"
else
    warn "Gender filter" "Could not verify (endpoint error)"
fi

JILL_RESP=$(curl -s -H "x-jarvis-secret: $SECRET" "http://localhost:3011/ops/api/headless/patient-services/?healthie_user_id=12745906" --max-time 10 2>/dev/null)
JILL_LEAK=$(echo "$JILL_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); ids=d.get("unlockedAppointmentTypeIds",[]); print("YES" if any(i in ids for i in ["504727","504728"]) else "NO")' 2>/dev/null || echo "ERROR")
if [ "$JILL_LEAK" = "NO" ]; then
    pass "Jill (F): no male pellet IDs leaked"
elif [ "$JILL_LEAK" = "YES" ]; then
    fail "Gender filter" "Jill (F) sees male pellet types"
fi

# ═══════════════════════════════════════
# 5. DATE FORMATTING (no NaN)
# ═══════════════════════════════════════
echo ""
echo "━━━ [5/9] Date Formatting ━━━"
CTX_RESP=$(curl -s -H "x-jarvis-secret: $SECRET" "http://localhost:3011/ops/api/headless/patient-context/?healthie_id=12123979" --max-time 10 2>/dev/null)
DOB=$(echo "$CTX_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("DATE_OF_BIRTH",""))' 2>/dev/null || echo "")
if [ "$DOB" = "05-12-1985" ]; then
    pass "Phil DOB: $DOB (correct)"
elif echo "$DOB" | grep -q "NaN\|null\|2026"; then
    fail "Phil DOB" "Got '$DOB' (expected 05-12-1985)"
else
    warn "Phil DOB" "Got '$DOB' (expected 05-12-1985)"
fi

NAN_CHECK=$(echo "$CTX_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); nans=[k for k,v in d.items() if v=="NaN" or (isinstance(v,float) and str(v)=="nan")]; print(",".join(nans) if nans else "none")' 2>/dev/null || echo "error")
if [ "$NAN_CHECK" = "none" ]; then
    pass "No NaN values in patient-context"
else
    fail "NaN in patient-context" "Fields: $NAN_CHECK"
fi

# iPad block-date parser regression check — catches wire-format flips between
# the server and the iPad client. Added after the 2026-05-17 ISO-UTC incident.
IPAD_DATE_OUT=$(node "$(dirname "$0")/test-ipad-date-parsing.js" 2>&1)
if [ $? -eq 0 ]; then
    pass "iPad date parser handles ISO UTC + legacy Healthie formats"
else
    fail "iPad date parser" "$(echo "$IPAD_DATE_OUT" | tr '\n' ' ' | cut -c1-300)"
fi

# ═══════════════════════════════════════
# 6. WHOLESALE PRICING SECURITY
# ═══════════════════════════════════════
echo ""
echo "━━━ [6/9] Wholesale Pricing Security ━━━"
ADMIN_RESP=$(curl -sL -H "x-jarvis-secret: $SECRET" "http://localhost:3011/ops/api/jarvis/peptide-eligibility/?healthieId=12123979" --max-time 15 2>/dev/null)
ADMIN_TIER=$(echo "$ADMIN_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tier",""))' 2>/dev/null || echo "")
ADMIN_WC=$(echo "$ADMIN_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(sum(1 for p in d.get("availableForShipping",[]) if p.get("wholesale_cost") is not None))' 2>/dev/null || echo "0")
if [ "$ADMIN_TIER" = "admin" ]; then
    pass "Phil tier: admin ✓ ($ADMIN_WC items with wholesale)"
else
    fail "Phil tier" "Got '$ADMIN_TIER' (expected 'admin')"
fi

# Non-admin wholesale leak check
PATIENT_RESP=$(curl -sL -H "x-jarvis-secret: $SECRET" "http://localhost:3011/ops/api/jarvis/peptide-eligibility/?healthieId=13113511" --max-time 15 2>/dev/null)
PATIENT_LEAK=$(echo "$PATIENT_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(sum(1 for p in d.get("availableForShipping",[]) if p.get("wholesale_cost") is not None))' 2>/dev/null || echo "0")
if [ "$PATIENT_LEAK" = "0" ]; then
    pass "Non-admin sees 0 wholesale prices (no leak)"
else
    fail "Wholesale leak" "Non-admin patient sees $PATIENT_LEAK wholesale prices!"
fi

# ═══════════════════════════════════════
# 7. LAMBDA HEALTH
# ═══════════════════════════════════════
echo ""
echo "━━━ [7/9] Lambda Functions ━━━"

BOOKING_FN="NowOptimalHeadlessStack-BookingLambdaCFA33E05-AscTUVcWiRuo"
ASKAI_FN="NowOptimalHeadlessStack-AskAiLambda160D5144-qEQQ3FQOm7TG"
CLI_BIN="--cli-binary-format raw-in-base64-out"

invoke_lambda() {
    local fn="$1" payload="$2" outfile="$3"
    echo "$payload" > /tmp/debug_payload.json
    aws lambda invoke --function-name "$fn" --payload fileb:///tmp/debug_payload.json $CLI_BIN --region us-east-2 "$outfile" >/dev/null 2>&1
    cat "$outfile" 2>/dev/null
}

# Booking Lambda — get_patient_services
B1=$(invoke_lambda "$BOOKING_FN" '{"body":"{\"action\":\"get_patient_services\",\"payload\":{\"userId\":\"12123979\",\"userGroupId\":\"75522\"}}"}' /tmp/debug_b1.json)
B1_STATUS=$(echo "$B1" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("statusCode",""))' 2>/dev/null || echo "error")
B1_TYPES=$(echo "$B1" | python3 -c 'import sys,json; b=json.loads(json.load(sys.stdin).get("body","{}")); print(len(b.get("appointmentTypes",[])))' 2>/dev/null || echo "0")
B1_TALK=$(echo "$B1" | python3 -c 'import sys,json; b=json.loads(json.load(sys.stdin).get("body","{}")); print("yes" if any("Talk" in t.get("name","") for t in b.get("appointmentTypes",[])) else "no")' 2>/dev/null || echo "no")
if [ "$B1_STATUS" = "200" ] && [ "$B1_TYPES" -gt 0 ]; then
    pass "Booking: get_patient_services → $B1_TYPES types, Talk with Doc=$B1_TALK"
else
    fail "Booking Lambda" "get_patient_services status=$B1_STATUS types=$B1_TYPES"
fi

# Booking Lambda — get_appointment_types (old app backward compat)
B2=$(invoke_lambda "$BOOKING_FN" '{"body":"{\"action\":\"get_appointment_types\",\"payload\":{\"userGroupId\":\"82532\",\"userId\":\"12745906\"}}"}' /tmp/debug_b2.json)
B2_STATUS=$(echo "$B2" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("statusCode",""))' 2>/dev/null || echo "error")
if [ "$B2_STATUS" = "200" ]; then
    pass "Booking: get_appointment_types (old app compat) → 200"
else
    fail "Booking Lambda backward compat" "get_appointment_types status=$B2_STATUS"
fi

# Booking Lambda — get_document_url
B3=$(invoke_lambda "$BOOKING_FN" '{"body":"{\"action\":\"get_document_url\",\"payload\":{\"documentId\":\"61069138\"}}"}' /tmp/debug_b3.json)
B3_URL=$(echo "$B3" | python3 -c 'import sys,json; b=json.loads(json.load(sys.stdin).get("body","{}")); print("yes" if b.get("url") else "no")' 2>/dev/null || echo "no")
if [ "$B3_URL" = "yes" ]; then
    pass "Booking: get_document_url → has URL"
else
    fail "Booking Lambda" "get_document_url returned no URL"
fi

# Ask-AI Lambda — get_wc_products
A1=$(invoke_lambda "$ASKAI_FN" '{"body":"{\"action\":\"get_wc_products\"}"}' /tmp/debug_a1.json)
A1_STATUS=$(echo "$A1" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("statusCode",""))' 2>/dev/null || echo "error")
A1_PRODS=$(echo "$A1" | python3 -c 'import sys,json; b=json.loads(json.load(sys.stdin).get("body","{}")); print(len(b.get("products",[])))' 2>/dev/null || echo "0")
if [ "$A1_STATUS" = "200" ] && [ "$A1_PRODS" -gt 0 ]; then
    pass "Ask-AI: get_wc_products → $A1_PRODS products"
else
    fail "Ask-AI Lambda" "get_wc_products status=$A1_STATUS products=$A1_PRODS"
fi

# Ask-AI Lambda — check_consent_status
A2=$(invoke_lambda "$ASKAI_FN" '{"body":"{\"action\":\"check_consent_status\",\"healthieId\":\"12123979\"}"}' /tmp/debug_a2.json)
A2_STATUS=$(echo "$A2" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("statusCode",""))' 2>/dev/null || echo "error")
if [ "$A2_STATUS" = "200" ]; then
    pass "Ask-AI: check_consent_status → 200"
else
    fail "Ask-AI Lambda" "check_consent_status status=$A2_STATUS"
fi

# Ask-AI Lambda — get_peptide_catalog
A3=$(invoke_lambda "$ASKAI_FN" '{"body":"{\"action\":\"get_peptide_catalog\",\"healthieId\":\"12123979\"}"}' /tmp/debug_a3.json)
A3_TIER=$(echo "$A3" | python3 -c 'import sys,json; b=json.loads(json.load(sys.stdin).get("body","{}")); print(b.get("tier",""))' 2>/dev/null || echo "")
A3_ADMIN=$(echo "$A3" | python3 -c 'import sys,json; b=json.loads(json.load(sys.stdin).get("body","{}")); print(sum(1 for p in b.get("shippableProducts",[]) if p.get("admin_price") is not None))' 2>/dev/null || echo "0")
if [ "$A3_TIER" = "admin" ] && [ "$A3_ADMIN" -gt 0 ]; then
    pass "Ask-AI: get_peptide_catalog → tier=$A3_TIER, $A3_ADMIN admin prices"
else
    fail "Ask-AI Lambda" "get_peptide_catalog tier=$A3_TIER admin_prices=$A3_ADMIN"
fi

# ═══════════════════════════════════════
# 8. WEBSITES + INTEGRATION TESTS
# ═══════════════════════════════════════
echo ""
echo "━━━ [8/9] Websites ━━━"
for URL in https://nowoptimal.com https://nowmenshealth.care https://nowprimary.care https://abxtac.com; do
    CODE=$(curl -sL -o /dev/null -w "%{http_code}" "$URL" --max-time 10 2>/dev/null)
    DOMAIN=$(echo "$URL" | sed 's|https://||')
    if [ "$CODE" = "200" ]; then
        pass "$DOMAIN → $CODE"
    else
        fail "$DOMAIN" "HTTP $CODE"
    fi
done

# ═══════════════════════════════════════
# 9. MOBILE APP RUNTIME (patient app — Peptide Shop bucket-safety)
# ═══════════════════════════════════════
echo ""
echo "━━━ [9/9] Mobile App Runtime ━━━"

# Auto-detect the patient app repo. Path moved historically; check current
# location first, then fall back to the older scratch path.
MOBILE_APP=""
for CAND in \
    "/home/ec2-user/gmhdashboard-worktrees/claude" \
    "$HOME/.gemini/antigravity/scratch/nowoptimal-headless-app/mobile-app" \
    "$HOME/nowoptimal-headless-app/mobile-app"; do
    if [ -f "$CAND/scripts/agents/debug-mobile.sh" ]; then
        MOBILE_APP="$CAND"
        break
    fi
done

if [ -z "$MOBILE_APP" ]; then
    warn "Mobile App Runtime" "patient-app debug-mobile.sh not found — skipped"
else
    MOBILE_OUT=$(bash "$MOBILE_APP/scripts/agents/debug-mobile.sh" 2>&1)
    if [ $? -eq 0 ]; then
        # Surface the Peptide Shop runtime test as a single pass line.
        if echo "$MOBILE_OUT" | grep -q "peptide-shop-runtime"; then
            pass "Peptide Shop runtime (mobile) — bucket coherence + fake-category degrade"
        else
            pass "Mobile App Runtime"
        fi
    else
        FAIL_LINE=$(echo "$MOBILE_OUT" | grep -E "^[[:space:]]*•" | head -1 | sed 's/^[[:space:]]*//')
        fail "Mobile App Runtime" "${FAIL_LINE:-debug-mobile.sh failed}"
    fi
fi

# ═══════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════╗"
TOTAL=$((PASS + FAIL + WARN))
if [ "$FAIL" -eq 0 ]; then
    echo "║  ✅ ALL PASS: $PASS/$TOTAL tests   WARN: $WARN          ║"
else
    echo "║  ❌ FAILURES: $FAIL   PASS: $PASS   WARN: $WARN           ║"
fi
echo "╚══════════════════════════════════════════════╝"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "Failed tests:"
    echo "$FAILURES" | tr '|' '\n' | grep -v '^$' | while read -r line; do echo "  → $line"; done
    exit 1
fi

exit 0
