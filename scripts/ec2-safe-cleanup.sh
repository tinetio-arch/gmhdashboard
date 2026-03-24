#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# EC2 Safe Disk Cleanup Script
# Generated: March 24, 2026
# Purpose: Reclaim 5-10GB safely without breaking any services
# Usage: bash ec2-safe-cleanup.sh
# ═══════════════════════════════════════════════════════════════

set -e
echo "═══════════════════════════════════════════════════"
echo "  EC2 Safe Disk Cleanup — Starting"
echo "═══════════════════════════════════════════════════"
echo ""

# Record starting disk usage
echo "📊 BEFORE cleanup:"
df -h / | tail -1
BEFORE=$(df / | tail -1 | awk '{print $3}')
echo ""

# ─── PHASE 1: Zero-Risk (logs, caches, temp) ────────────────

echo "🧹 Phase 1: Clearing PM2 logs..."
PM2_BEFORE=$(du -sm ~/.pm2/logs 2>/dev/null | cut -f1 || echo 0)
pm2 flush 2>/dev/null
PM2_AFTER=$(du -sm ~/.pm2/logs 2>/dev/null | cut -f1 || echo 0)
echo "   PM2 logs: ${PM2_BEFORE}MB → ${PM2_AFTER}MB"

echo "🧹 Phase 1: Clearing npm cache..."
NPM_BEFORE=$(du -sm ~/.npm 2>/dev/null | cut -f1 || echo 0)
npm cache clean --force 2>/dev/null
NPM_AFTER=$(du -sm ~/.npm 2>/dev/null | cut -f1 || echo 0)
echo "   npm cache: ${NPM_BEFORE}MB → ${NPM_AFTER}MB"

echo "🧹 Phase 1: Clearing temp files older than 7 days..."
TMP_BEFORE=$(du -sm /tmp 2>/dev/null | cut -f1 || echo 0)
find /tmp -type f -mtime +7 -delete 2>/dev/null || true
TMP_AFTER=$(du -sm /tmp 2>/dev/null | cut -f1 || echo 0)
echo "   /tmp: ${TMP_BEFORE}MB → ${TMP_AFTER}MB"

echo "🧹 Phase 1: Rotating system journal..."
sudo journalctl --vacuum-time=7d 2>/dev/null || true

echo "🧹 Phase 1: Truncating log files..."
for f in /home/ec2-user/gmhdashboard/snowflake.log /home/ec2-user/gmhdashboard/nohup.out; do
  if [ -f "$f" ]; then
    SIZE=$(du -sh "$f" | cut -f1)
    > "$f"
    echo "   Truncated $f ($SIZE → 0)"
  fi
done
echo ""

# ─── PHASE 2: Archive old reports ────────────────────────────

echo "📦 Phase 2: Archiving old reports..."
cd /home/ec2-user/gmhdashboard
mkdir -p backups

# List of old one-time reports safe to archive
OLD_REPORTS=(
  comprehensive_duplicates_report.md
  active_duplicates_report.md
  safe_to_merge_report.md
  merge_execution_log.md
  merge_execution_output.txt
  CLEANUP_LOG_DEC28_2025.md
  DASHBOARD_FINANCIAL_OVERHAUL_PLAN.md
  GMH_DASHBOARD_EFFICIENCY_ANALYSIS.md
  GHL_JANE_FINANCIAL_EXTRACTION_PLAN.md
  GHL_JANE_INVESTIGATION_GUIDE.md
  GHL_INVESTIGATION_FINDINGS.md
  GHL_FIELD_MAPPING_AUDIT.md
  GHL_MAPPING_VERIFICATION.md
  CLINICSYNC_PRO_JANE_FINANCIAL_DATA.md
  CLINICSYNC_SETUP.md
  JANE_API_GUIDE.md
  JANE_FINANCIAL_DATA_INVESTIGATION_RESULTS.md
  JANE_TIME_BASED_METRICS_ANALYSIS.md
  DUPLICATE_RESOLUTION_COMPLETE.md
  EFFICIENCY_IMPROVEMENTS_APPLIED.md
  FINAL_MAPPING_DEPLOYED.md
  GMH_MASTER_GHL_MIRROR.md
  INCIDENT_DB_SCHEMA_DEC28_0417.md
  REMAINING_BUGS_FIX_PLAN.md
  ROOT_CAUSE_SERVER_TIMEOUTS.md
  SCRIBE_FIXES_IMPLEMENTED.md
  SCRIBE_SYSTEM_BUGS_AND_FIXES.md
  ALL_FIXES_COMPLETE_SUMMARY.md
  MEMBERSHIP_AUDIT_ACTIONS_SUMMARY.md
  MEMBERSHIP_AUDIT_ACTION_PLAN.md
  MEMBERSHIP_AUDIT_DEEP_DIVE.md
  MEMBERSHIP_AUDIT_READY.md
  MEMBERSHIP_AUDIT_STATUS.md
  METRICS_AUDIT.md
  DASHBOARD_COMPREHENSIVE_REVIEW.md
  DASHBOARD_REDESIGN_PLAN.md
  AGENTIC_SYSTEM_IMPLEMENTATION_PLAN.md
  AGENTIC_SYSTEM_PLAN.md
  AGENTIC_SYSTEM_PLATFORMS.md
  AGENTIC_SYSTEM_QUICKSTART.md
  ARCHITECTURE_DIAGRAMS.md
  ARCHITECTURE_EFFICIENCY.md
  SIMPLE_SYSTEM_EXPLANATION.md
  SYSTEM_REVIEW_RECOMMENDATIONS.md
  GRAPHQL_SETUP_GUIDE.md
  HEIDI_WIDGET_SETUP.md
  LANGCHAIN_SETUP_PLAN.md
  PAYMENT_INTEGRATION_GUIDE.md
  build_error.log
  build_log.txt
  output.json
  claude-code-ipad-improvements.md
)

# Build list of files that actually exist
EXISTING=()
for f in "${OLD_REPORTS[@]}"; do
  [ -f "$f" ] && EXISTING+=("$f")
done

if [ ${#EXISTING[@]} -gt 0 ]; then
  tar -czf backups/old-reports-20260324.tar.gz "${EXISTING[@]}" 2>/dev/null
  # Verify archive before deleting
  ARCHIVED=$(tar -tzf backups/old-reports-20260324.tar.gz 2>/dev/null | wc -l)
  if [ "$ARCHIVED" -gt 0 ]; then
    echo "   Archived $ARCHIVED files → backups/old-reports-20260324.tar.gz"
    rm -f "${EXISTING[@]}"
    echo "   Deleted $ARCHIVED original files"
  else
    echo "   ⚠️ Archive failed — skipping deletion"
  fi
else
  echo "   No old reports found to archive"
fi

# Remove .bak files from data directory
echo "🧹 Phase 2: Removing .bak files..."
for f in data/labs-review-queue.json.bak data/processed-faxes.json.bak; do
  if [ -f "$f" ]; then
    SIZE=$(du -sh "$f" | cut -f1)
    rm -f "$f"
    echo "   Removed $f ($SIZE)"
  fi
done
echo ""

# ─── VERIFICATION ────────────────────────────────────────────

echo "═══════════════════════════════════════════════════"
echo "  ✅ Cleanup Complete — Verification"
echo "═══════════════════════════════════════════════════"
echo ""
echo "📊 AFTER cleanup:"
df -h / | tail -1
AFTER=$(df / | tail -1 | awk '{print $3}')
echo ""

echo "🔍 Service health check:"
pm2 list
echo ""

echo "🌐 Dashboard health:"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" https://nowoptimal.com/ops/ 2>/dev/null || echo "FAIL")
echo "   https://nowoptimal.com/ops/ → HTTP $HTTP"
echo ""
echo "Done. All services should be running normally."
