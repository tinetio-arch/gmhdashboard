#!/bin/bash
# refresh-project-tracker.sh
# Regenerates the LIVE SYSTEM SNAPSHOT section of docs/PROJECT_TRACKER.md.
# OVERWRITES the block between <!-- AUTOGEN:START --> and <!-- AUTOGEN:END -->.
# Manual "Active Projects" sections beneath are left untouched.
#
# Usage:  bash ~/gmhdashboard/scripts/refresh-project-tracker.sh
# Cron:   wired live at 0 6 * * * via cron-alert.sh "Refresh Project Tracker" (installed 2026-05-12,
#         alongside morning intelligence). Confirm: crontab -l | grep refresh-project-tracker
#
# Designed to be idempotent and safe to run as often as desired.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TRACKER="$PROJECT_DIR/docs/PROJECT_TRACKER.md"
ENV_FILE="$PROJECT_DIR/.env.local"
TIMESTAMP=$(date '+%Y-%m-%d')
TIMESTAMP_LONG=$(date '+%Y-%m-%d %H:%M:%S %Z')
TMPFILE=$(mktemp -t project-tracker-block.XXXXXX)
trap 'rm -f "$TMPFILE"' EXIT

if [ ! -f "$TRACKER" ]; then
  echo "ERROR: tracker file not found at $TRACKER" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env.local not found at $ENV_FILE" >&2
  exit 1
fi

# Load DB creds from .env.local without sourcing the file (which can blow up on special chars in passwords)
DB_HOST=$(grep '^DATABASE_HOST=' "$ENV_FILE" | head -1 | cut -d= -f2-)
DB_PORT=$(grep '^DATABASE_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2-)
DB_NAME=$(grep '^DATABASE_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2-)
DB_USER=$(grep '^DATABASE_USER=' "$ENV_FILE" | head -1 | cut -d= -f2-)
DB_PASS=$(grep '^DATABASE_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)

run_sql() {
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "$1" 2>/dev/null || echo "ERROR"
}

# ─── Probe live state ─────────────────────────────────────────────────────────

DISK_USE=$(df -h / | awk 'NR==2 {print $5}')
DISK_FREE=$(df -h / | awk 'NR==2 {print $4}')
DISK_TOTAL=$(df -h / | awk 'NR==2 {print $2}')

PM2_JSON=$(pm2 jlist 2>/dev/null || echo '[]')
PM2_COUNT=$(echo "$PM2_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo 0)
PM2_ONLINE=$(echo "$PM2_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for s in d if s.get('pm2_env',{}).get('status')=='online'))" 2>/dev/null || echo 0)

CRON_COUNT=$(crontab -l 2>/dev/null | grep -v '^\s*#' | grep -v '^\s*$' | grep -vE '^(SHELL|PATH|HOME)=' | wc -l | tr -d ' ')

GIT_BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo unknown)
GIT_HEAD=$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)
GIT_DIRTY=$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
ORPHAN_BRANCHES=$(git -C "$PROJECT_DIR" branch --list 'claude/*' 2>/dev/null | wc -l | tr -d ' ')

COORD_REGISTRY="$HOME/.claude/coord/registry.json"
if [ -f "$COORD_REGISTRY" ]; then
  ACTIVE_SESSIONS=$(python3 -c "
import json, sys
try:
    d = json.load(open('$COORD_REGISTRY'))
    sessions = d.get('sessions', d) if isinstance(d, dict) else d
    if isinstance(sessions, dict):
        items = list(sessions.values())
    else:
        items = sessions
    print(sum(1 for s in items if isinstance(s, dict) and s.get('status','active') not in ('checked_out','done')))
except Exception:
    print(0)
" 2>/dev/null || echo 0)
else
  ACTIVE_SESSIONS=0
fi

# Database probes (each guarded — DB outage doesn't break the script)
total_patients=$(run_sql "SELECT COUNT(*) FROM patients;")
active=$(run_sql "SELECT COUNT(*) FROM patients WHERE status_key='active';")
active_pending=$(run_sql "SELECT COUNT(*) FROM patients WHERE status_key='active_pending';")
inactive=$(run_sql "SELECT COUNT(*) FROM patients WHERE status_key='inactive';")
hold_payment=$(run_sql "SELECT COUNT(*) FROM patients WHERE status_key='hold_payment_research';")
inactive_payment=$(run_sql "SELECT COUNT(*) FROM patients WHERE status_key='inactive_payment_research';")
healthie_clients=$(run_sql "SELECT COUNT(*) FROM healthie_clients;")
qb_mapping=$(run_sql "SELECT COUNT(*) FROM patient_qb_mapping;")
ghl_mapping=$(run_sql "SELECT COUNT(*) FROM patients WHERE ghl_contact_id IS NOT NULL;")
memberships_active=$(run_sql "SELECT COUNT(*) FROM memberships WHERE status='active';")
lab_orders=$(run_sql "SELECT COUNT(*) FROM lab_orders;")
lab_pending=$(run_sql "SELECT COUNT(*) FROM lab_review_queue WHERE status IN ('pending','for_review');")
dispenses=$(run_sql "SELECT COUNT(*) FROM dispenses;")
dea_tx=$(run_sql "SELECT COUNT(*) FROM dea_transactions;")
staged=$(run_sql "SELECT COUNT(*) FROM staged_doses WHERE status='staged';")
payment_open=$(run_sql "SELECT COUNT(*) FROM payment_issues WHERE resolved_at IS NULL;")
bioscope=$(run_sql "SELECT COUNT(*) FROM bioscope_authorized_patients WHERE revoked_at IS NULL;")
tables=$(run_sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")

# Client type distribution
client_dist=$(run_sql "SELECT COALESCE(client_type_key,'(null)') || '|' || COUNT(*) FROM patients GROUP BY client_type_key ORDER BY COUNT(*) DESC;")

# ─── Build replacement block ──────────────────────────────────────────────────

{
  echo "<!-- AUTOGEN:START — do not edit between these markers; overwritten by scripts/refresh-project-tracker.sh -->"
  echo "## LIVE SYSTEM SNAPSHOT (verified ${TIMESTAMP})"
  echo ""
  echo "_Auto-regenerated ${TIMESTAMP_LONG} by \`scripts/refresh-project-tracker.sh\`._"
  echo ""
  echo "| Metric | Value | Source |"
  echo "|---|---|---|"
  echo "| Total patients | **${total_patients}** | \`SELECT COUNT(*) FROM patients\` |"
  echo "| ↳ active | ${active} | \`status_key='active'\` |"
  echo "| ↳ active_pending | ${active_pending} | \`status_key='active_pending'\` |"
  echo "| ↳ inactive | ${inactive} | \`status_key='inactive'\` |"
  echo "| ↳ hold_payment_research | ${hold_payment} | \`status_key='hold_payment_research'\` |"
  echo "| ↳ inactive_payment_research | ${inactive_payment} | \`status_key='inactive_payment_research'\` |"
  echo "| healthie_clients rows | ${healthie_clients} | (>patients because legacy duplicate links exist) |"
  echo "| patient_qb_mapping rows | ${qb_mapping} | QuickBooks mappings |"
  echo "| patients w/ ghl_contact_id | ${ghl_mapping} | \`ghl_contact_id IS NOT NULL\` (legacy mapping table dropped 2026-05-19) |"
  echo "| memberships (active) | ${memberships_active} | \`status='active'\` |"
  echo "| lab_orders (total) | ${lab_orders} | — |"
  echo "| lab_review_queue (pending) | ${lab_pending} | — |"
  echo "| dispenses (total) | ${dispenses} | — |"
  echo "| dea_transactions | ${dea_tx} | — |"
  echo "| staged_doses (staged) | ${staged} | — |"
  echo "| payment_issues (open) | ${payment_open} | \`resolved_at IS NULL\` |"
  echo "| bioscope_authorized (active) | ${bioscope} | \`revoked_at IS NULL\` |"
  echo "| Postgres tables (public) | **${tables}** | \`information_schema.tables\` |"
  echo "| PM2 services | **${PM2_COUNT}** total, **${PM2_ONLINE}** online | \`pm2 jlist\` |"
  echo "| Cron jobs (active) | **${CRON_COUNT}** | \`crontab -l\` (non-comment, non-blank) |"
  echo "| Disk used | **${DISK_USE}** (${DISK_FREE} free of ${DISK_TOTAL}) | \`df -h /\` |"
  echo "| Git branch | \`${GIT_BRANCH}\` @ \`${GIT_HEAD}\` (${GIT_DIRTY} dirty file(s)) | \`git status --porcelain\` |"
  echo "| Orphan Claude branches | ${ORPHAN_BRANCHES} | \`git branch --list 'claude/*'\` |"
  echo "| Active coordinator sessions | ${ACTIVE_SESSIONS} | \`~/.claude/coord/registry.json\` |"
  echo ""
  echo "### Patient distribution by \`client_type_key\`"
  echo "| Type | Count |"
  echo "|---|---|"
  echo "$client_dist" | awk -F'|' 'NF==2 {printf "| %s | %s |\n", $1, $2}'
  echo ""
  echo "<!-- AUTOGEN:END -->"
} > "$TMPFILE"

# ─── Splice into tracker (atomic) ─────────────────────────────────────────────

python3 - "$TRACKER" "$TMPFILE" <<'PY'
import sys, re, pathlib, tempfile, os
tracker = pathlib.Path(sys.argv[1])
block = pathlib.Path(sys.argv[2]).read_text()
src = tracker.read_text()
pattern = re.compile(
    r"<!-- AUTOGEN:START.*?-->.*?<!-- AUTOGEN:END -->",
    re.DOTALL,
)
if not pattern.search(src):
    sys.stderr.write(
        "ERROR: AUTOGEN markers not found in tracker. "
        "Add them around the LIVE SYSTEM SNAPSHOT section before running this script.\n"
    )
    sys.exit(2)
new_src = pattern.sub(block, src, count=1)
fd, tmp = tempfile.mkstemp(dir=str(tracker.parent), prefix=".tracker.", suffix=".tmp")
os.close(fd)
pathlib.Path(tmp).write_text(new_src)
os.replace(tmp, tracker)
PY

echo "✅ refreshed $TRACKER"
