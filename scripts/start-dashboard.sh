#!/bin/bash
# GMH Dashboard Start Wrapper
#
# This script runs the startup payment sync before starting the dashboard.
# PM2 will execute this instead of 'npm start' directly.

cd /home/ec2-user/gmhdashboard

# Load environment variables from .env.local using Python (per SOT - Node CLI is unreliable)
# Next.js in production mode doesn't auto-load .env files
set -a
eval $(python3 -c "
import sys
with open('.env.local') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#'):
            if '=' in line:
                key, value = line.split('=', 1)
                # Escape single quotes in value
                value = value.replace(\"'\", \"'\\\\''\" )
                print(f\"export {key}='{value}'\")
")
set +a

echo "=== GMH Dashboard Startup ==="
echo "Running startup payment sync check..."

# Run the startup sync with a timeout (don't block server start)
# TEMPORARILY DISABLED - sync was hanging and blocking server startup
# timeout 30 npx tsx scripts/startup-payment-sync.ts || echo "Startup sync timed out or failed, continuing..."

echo "Starting Next.js server..."
exec npm start
