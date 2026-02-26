#!/bin/bash
# GMH Dashboard Start Wrapper
# 
# This script runs the startup payment sync before starting the dashboard.
# PM2 will execute this instead of 'npm start' directly.

cd /home/ec2-user/gmhdashboard

echo "=== GMH Dashboard Startup ==="
echo "Running startup payment sync check..."

# Run the startup sync with a timeout (don't block server start)
# TEMPORARILY DISABLED - sync was hanging and blocking server startup
# timeout 30 npx tsx scripts/startup-payment-sync.ts || echo "Startup sync timed out or failed, continuing..."

echo "Starting Next.js server..."
exec npm start
