#!/bin/bash
# =============================================================================
# Auto-Remediation Agent
# Runs daily at 7:00 AM MST (14:00 UTC) — 13 min after morning intelligence
#
# Uses Claude Code CLI to investigate and fix errors found by the morning agent.
# Reads the prompt from auto-remediation.md and runs with constrained tools.
#
# Logs to: /home/ec2-user/logs/auto-remediation.log
# Actions logged to: agent_action_log table (agent_name='auto_remediation')
# =============================================================================

set -o pipefail

LOG_DIR="/home/ec2-user/logs"
LOG_FILE="$LOG_DIR/auto-remediation.log"
PROMPT_FILE="$HOME/gmhdashboard/scripts/agents/auto-remediation.md"
WORK_DIR="$HOME/gmhdashboard"

mkdir -p "$LOG_DIR"

echo "=========================================" >> "$LOG_FILE"
echo "[Auto-Remediation] Starting $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"

# Check if claude CLI is available
if ! command -v claude &> /dev/null; then
    echo "[Auto-Remediation] ERROR: claude CLI not found" >> "$LOG_FILE"
    exit 1
fi

# Check if prompt file exists
if [ ! -f "$PROMPT_FILE" ]; then
    echo "[Auto-Remediation] ERROR: Prompt file not found: $PROMPT_FILE" >> "$LOG_FILE"
    exit 1
fi

# Quick pre-check: are there even any errors to fix?
ENV_FILE="$WORK_DIR/.env.local"
DB_HOST=$(grep '^DATABASE_HOST=' "$ENV_FILE" | cut -d'=' -f2-)
DB_PORT=$(grep '^DATABASE_PORT=' "$ENV_FILE" | cut -d'=' -f2-)
DB_NAME=$(grep '^DATABASE_NAME=' "$ENV_FILE" | cut -d'=' -f2-)
DB_USER=$(grep '^DATABASE_USER=' "$ENV_FILE" | cut -d'=' -f2-)
DB_PASS=$(grep '^DATABASE_PASSWORD=' "$ENV_FILE" | cut -d'=' -f2-)

ERROR_COUNT=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "
    SELECT COUNT(*) FROM agent_action_log
    WHERE created_at > NOW() - INTERVAL '2 hours'
      AND (action_type = 'error' OR status = 'needs_decision')
" 2>/dev/null || echo "0")

# Also check PM2 for crashed services
CRASHED_COUNT=$(pm2 jlist 2>/dev/null | python3 -c 'import sys,json; print(sum(1 for p in json.load(sys.stdin) if p["pm2_env"]["status"] != "online"))' 2>/dev/null || echo "0")

TOTAL_ISSUES=$((ERROR_COUNT + CRASHED_COUNT))

if [ "$TOTAL_ISSUES" -eq 0 ]; then
    echo "[Auto-Remediation] No errors or crashes found — skipping Claude run" >> "$LOG_FILE"
    # Log clean status
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
        INSERT INTO agent_action_log (agent_name, action_type, category, summary, details, status)
        VALUES ('auto_remediation', 'info', 'daily_summary', 'No issues found — system healthy', '{\"errors\": 0, \"crashes\": 0}'::jsonb, 'completed')
    " >> "$LOG_FILE" 2>&1
    echo "[Auto-Remediation] Complete $(date '+%H:%M:%S')" >> "$LOG_FILE"
    exit 0
fi

echo "[Auto-Remediation] Found $ERROR_COUNT errors + $CRASHED_COUNT crashes — launching Claude" >> "$LOG_FILE"

# Read the prompt
PROMPT=$(cat "$PROMPT_FILE")

# Run Claude Code CLI with constrained tools and max turns
cd "$WORK_DIR"
timeout 600 claude -p "$PROMPT" \
    --allowedTools "Bash,Read,Write,Edit,Grep,Glob" \
    --max-turns 25 \
    >> "$LOG_FILE" 2>&1

EXIT_CODE=$?

if [ "$EXIT_CODE" -eq 0 ]; then
    echo "[Auto-Remediation] Claude completed successfully $(date '+%H:%M:%S')" >> "$LOG_FILE"
elif [ "$EXIT_CODE" -eq 124 ]; then
    echo "[Auto-Remediation] Claude timed out (10 min limit) $(date '+%H:%M:%S')" >> "$LOG_FILE"
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
        INSERT INTO agent_action_log (agent_name, action_type, category, summary, details, status)
        VALUES ('auto_remediation', 'error', 'system_health', 'Auto-remediation agent timed out after 10 minutes', '{\"exit_code\": 124}'::jsonb, 'completed')
    " >> "$LOG_FILE" 2>&1
else
    echo "[Auto-Remediation] Claude exited with code $EXIT_CODE $(date '+%H:%M:%S')" >> "$LOG_FILE"
fi

echo "=========================================" >> "$LOG_FILE"
