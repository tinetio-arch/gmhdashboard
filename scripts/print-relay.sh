#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Print Relay — runs on the clinic Mac with CUPS printers
# Polls the GMH Dashboard for pending print jobs and sends them
# to the local CUPS printer.
#
# Setup on Mac:
#   1. Copy this script to the Mac
#   2. Set PRINT_SECRET to match PRINT_RELAY_SECRET in .env.local
#   3. Run: bash print-relay.sh
#   4. Or add to launchd for auto-start
#
# Printers (configured in CUPS on Mac):
#   - Zebra_Technologies_ZTC_GK420d__EPL_  (dispensing labels)
#   - Zebra_Technologies_ZTC_GK420d__EPL__2 (backup labels)
#   - Brother_MFC_L5850DW_series (default, full-page)
# ═══════════════════════════════════════════════════════════════

DASHBOARD_URL="https://nowoptimal.com/ops/api/labels/print/"
PRINT_SECRET="${PRINT_RELAY_SECRET:-changeme}"
POLL_INTERVAL=5  # seconds
TEMP_DIR="/tmp/print-relay"

mkdir -p "$TEMP_DIR"

echo "═══════════════════════════════════════════"
echo "  NOW Optimal Print Relay"
echo "  Polling: $DASHBOARD_URL"
echo "  Interval: ${POLL_INTERVAL}s"
echo "═══════════════════════════════════════════"

while true; do
    # Fetch pending jobs
    RESPONSE=$(curl -s "$DASHBOARD_URL?status=pending" \
        -H "x-print-secret: $PRINT_SECRET" 2>/dev/null)

    # Check if we got valid JSON
    if ! echo "$RESPONSE" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
        sleep "$POLL_INTERVAL"
        continue
    fi

    # Extract jobs
    JOBS=$(echo "$RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
jobs = data.get('jobs', [])
for j in jobs:
    print(f\"{j['id']}|{j['printer']}|{j.get('label_type','')}|{j.get('pdf_base64','')}\")
" 2>/dev/null)

    if [ -z "$JOBS" ]; then
        sleep "$POLL_INTERVAL"
        continue
    fi

    # Process each job
    echo "$JOBS" | while IFS='|' read -r JOB_ID PRINTER LABEL_TYPE PDF_B64; do
        if [ -z "$JOB_ID" ] || [ -z "$PDF_B64" ]; then
            continue
        fi

        PDF_FILE="$TEMP_DIR/job_${JOB_ID}.pdf"
        echo "[$(date '+%H:%M:%S')] Job #$JOB_ID — $LABEL_TYPE → $PRINTER"

        # Decode base64 PDF to file
        echo "$PDF_B64" | base64 -d > "$PDF_FILE" 2>/dev/null

        if [ ! -s "$PDF_FILE" ]; then
            echo "  ERROR: Failed to decode PDF"
            curl -s -X PATCH "$DASHBOARD_URL" \
                -H "Content-Type: application/json" \
                -H "x-print-secret: $PRINT_SECRET" \
                -d "{\"id\": $JOB_ID, \"status\": \"failed\", \"error\": \"PDF decode failed\"}" >/dev/null 2>&1
            continue
        fi

        # Send to CUPS printer
        PRINT_RESULT=$(lp -d "$PRINTER" "$PDF_FILE" 2>&1)
        PRINT_EXIT=$?

        if [ $PRINT_EXIT -eq 0 ]; then
            echo "  PRINTED: $PRINT_RESULT"
            curl -s -X PATCH "$DASHBOARD_URL" \
                -H "Content-Type: application/json" \
                -H "x-print-secret: $PRINT_SECRET" \
                -d "{\"id\": $JOB_ID, \"status\": \"printed\"}" >/dev/null 2>&1
        else
            echo "  FAILED: $PRINT_RESULT"
            curl -s -X PATCH "$DASHBOARD_URL" \
                -H "Content-Type: application/json" \
                -H "x-print-secret: $PRINT_SECRET" \
                -d "{\"id\": $JOB_ID, \"status\": \"failed\", \"error\": \"$(echo "$PRINT_RESULT" | head -1)\"}" >/dev/null 2>&1
        fi

        # Cleanup
        rm -f "$PDF_FILE"
    done

    sleep "$POLL_INTERVAL"
done
