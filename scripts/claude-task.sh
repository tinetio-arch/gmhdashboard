#!/bin/bash
# claude-task.sh — Launch a Claude Code session with task context + remote control
# Usage: bash claude-task.sh <task-id> [user-input]
# Returns: JSON with session name and remote control URL

TASK_ID="${1:-general}"
USER_INPUT="${2:-}"
SESSION="claude-task-${TASK_ID}"
LOGFILE="/tmp/claude-task-${TASK_ID}.log"

# If session already exists, return info
if tmux has-session -t "$SESSION" 2>/dev/null; then
  # Try to capture the remote control URL from existing session
  RC_URL=$(tmux capture-pane -t "$SESSION" -p | grep -o 'https://claude.ai/code/session_[A-Za-z0-9_]*' | tail -1)
  echo "{\"status\":\"exists\",\"session\":\"$SESSION\",\"remote_control_url\":\"$RC_URL\"}"
  exit 0
fi

# Build the task prompt based on task ID
TASK_PROMPT=""
case "$TASK_ID" in
  disk-cleanup)
    TASK_PROMPT="TASK: Free disk space to below 75%. Current usage is 95%. Clean old logs (pm2 flush), /tmp files, old build artifacts. Do NOT delete anything in gmhdashboard/docs/ or gmhdashboard/scripts/. Run df -h before and after to verify. Read docs/sot-modules/11-troubleshooting.md for disk cleanup guidance."
    ;;
  dashboard-restarts)
    TASK_PROMPT="TASK: Investigate and fix the gmh-dashboard crash loop (268 restarts). Check pm2 logs for crash reasons, look for memory leaks or OOM kills. Read docs/sot-modules/03-pm2-service-rules.md and docs/DEPENDENCIES.md first. Do NOT restart other services."
    ;;
  billing-holds)
    TASK_PROMPT="TASK: Resolve billing hold patients. There are 10 patients on hold_payment_research: Kyle Dreher, Eric Allione, Christopher Lynn, Sean Dorrington, Mike Donaldson, Cris Acosta, Mark Williams, Rodney Courtney, Andrew Haywood, Cody Crane. Investigate each in Healthie, check for duplicate accounts, failed payments, missing payment methods. Read docs/sot-modules/02-critical-read-first.md first."
    ;;
  pending-labs)
    TASK_PROMPT="TASK: Clear the 26 pending lab reviews in lab_review_queue. Prioritize the 3 critical hematocrit patients: Donavon Connor (64.3%), Billy Garcia (61.0%), Jakob Woods (60.1% - 22 days overdue). These are clinical safety issues. Read docs/sot-modules/02-critical-read-first.md first."
    ;;
  ghl-sync)
    TASK_PROMPT="TASK: Fix the remaining 2 GHL sync issues (1 error, 1 pending). Current sync rate is 99% (258/260). Check the patients table for ghl_sync_status='error' and 'pending'. Read docs/sot-modules/05-system-architecture.md and docs/DEPENDENCIES.md Chain 4 (GHL CRM Sync)."
    ;;
  stripe-reconnect)
    TASK_PROMPT="TASK: Verify Stripe connection status. Keys exist in .env.local but blueprint says it was disconnected. Test the API connection, verify webhook endpoints, check if billing/subscription data is flowing. Read docs/sot-modules/15-integration-endpoints.md."
    ;;
  quickbooks-fix)
    TASK_PROMPT="TASK: Diagnose and fix QuickBooks integration. Health check was failing. Verify OAuth tokens, check QBO connection health table, test API calls. Read docs/sot-modules/11-troubleshooting.md and docs/sot-modules/15-integration-endpoints.md."
    ;;
  email-campaign)
    TASK_PROMPT="TASK: Prepare email marketing reactivation. Mailchimp has 2,829 GMH subscribers (40-51% open rate, dormant 12 months) and 542 Tri-City subscribers (156 never contacted). Plan the 'We're Back' campaign. Read docs/PROJECT_TRACKER.md for full context."
    ;;
  mobile-app-debug)
    TASK_PROMPT="TASK: Diagnose why 0 of 380 patients are verified in the mobile app. Check is_verified field in patients table, test the verification flow, check the mobile app Lambda functions. Read docs/sot-modules/20-mobile-app.md."
    ;;
  payment-issues)
    TASK_PROMPT="TASK: Investigate and resolve the 50 unresolved payment issues in the payment_issues table. Prioritize by amount, identify patterns (failed charges, missing payment methods, duplicate accounts). Read docs/sot-modules/02-critical-read-first.md and docs/DEPENDENCIES.md Chain 2 (Billing)."
    ;;
  ghl-pipelines)
    TASK_PROMPT="TASK: Build GHL pipelines and workflows. Start with Pipeline 1 (New Patient Acquisition) and Workflow 1 (Missed Call Text-Back). Read docs/sot-modules/23-ghl-ai-agents.md and the GHL section of docs/PROJECT_TRACKER.md."
    ;;
  longevity-launch)
    TASK_PROMPT="TASK: Prepare NOW Longevity soft launch. Set up waitlist, configure appointment types, plan Founders Circle tier (25 spots at \$750/mo). Read docs/sot-modules/22-brand-group-architecture.md and docs/PROJECT_TRACKER.md."
    ;;
  inventory-restock)
    TASK_PROMPT="TASK: Audit current inventory and identify what needs restocking. Check peptide_products, vials, supply_counts tables. Focus on zero-stock items, female pelleting kits (10 remaining, 36 upcoming procedures), IV saline, Tadalafil. Read docs/sot-modules/INDEX.md for relevant modules."
    ;;
  full-audit)
    TASK_PROMPT="TASK: Run a comprehensive system audit. Check all integrations, database health, service status, patient data integrity, financial data freshness. Run bash ~/gmhdashboard/scripts/health-check.sh and bash ~/gmhdashboard/scripts/generate-status-report.sh. Compare results against docs/PROJECT_TRACKER.md and update it."
    ;;
  *)
    TASK_PROMPT="TASK: General work session. Read docs/sot-modules/INDEX.md first, then docs/PROJECT_TRACKER.md to understand current priorities."
    ;;
esac

# Add user input if provided
if [ -n "$USER_INPUT" ]; then
  TASK_PROMPT="${TASK_PROMPT} ADDITIONAL INSTRUCTIONS FROM PHIL: ${USER_INPUT}"
fi

# Add standard preamble
PREAMBLE="Before starting: (1) Read docs/sot-modules/INDEX.md (2) Read docs/DEPENDENCIES.md (3) Read docs/CLAUDE_MEMORY_PINS.md and pin critical facts to /memory. After completing work: update docs/PROJECT_TRACKER.md and run bash ~/gmhdashboard/scripts/health-check.sh."

FULL_PROMPT="${PREAMBLE} ${TASK_PROMPT}"

# Create tmux session and launch claude
tmux new-session -d -s "$SESSION"
tmux send-keys -t "$SESSION" "claude --dangerously-skip-permissions" Enter

# Wait for Claude to initialize
sleep 5

# Send the task prompt
tmux send-keys -t "$SESSION" "$FULL_PROMPT" Enter

# Wait for Claude to start processing, then enable remote control
sleep 3
tmux send-keys -t "$SESSION" "/remote-control" Enter

# Wait for remote control URL to appear
sleep 5
RC_URL=$(tmux capture-pane -t "$SESSION" -p | grep -o 'https://claude.ai/code/session_[A-Za-z0-9_]*' | tail -1)

# If we didn't get the URL, wait a bit more
if [ -z "$RC_URL" ]; then
  sleep 5
  RC_URL=$(tmux capture-pane -t "$SESSION" -p | grep -o 'https://claude.ai/code/session_[A-Za-z0-9_]*' | tail -1)
fi

echo "{\"status\":\"created\",\"session\":\"$SESSION\",\"task_id\":\"$TASK_ID\",\"remote_control_url\":\"$RC_URL\"}"
