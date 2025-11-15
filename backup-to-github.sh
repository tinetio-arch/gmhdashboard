#!/bin/bash

# Automatic backup script for gmh-dashboard
# This script commits and pushes any changes to GitHub

# Set PATH to include common locations for git
export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"

PROJECT_DIR="/Users/philschafer/Phils Fun Stuff/gmh-dashboard"
LOG_FILE="$PROJECT_DIR/backup.log"

cd "$PROJECT_DIR" || exit 1

# Log the backup attempt
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup..." >> "$LOG_FILE"

# Check if there are any changes
if git diff --quiet && git diff --cached --quiet; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] No changes to commit." >> "$LOG_FILE"
    exit 0
fi

# Add all changes
git add . >> "$LOG_FILE" 2>&1

# Commit with timestamp
COMMIT_MSG="Auto-backup: $(date '+%Y-%m-%d %H:%M:%S')"
git commit -m "$COMMIT_MSG" >> "$LOG_FILE" 2>&1

# Push to GitHub
if git push origin master >> "$LOG_FILE" 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup successful!" >> "$LOG_FILE"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup failed! Check log for details." >> "$LOG_FILE"
    exit 1
fi

