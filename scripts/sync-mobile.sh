#!/bin/bash
# Sync mobile app with iPad app — run after any iPad changes
# ONLY syncs app.js — style.css and index.html are phone-optimized and SEPARATE
# Creates ONLY the versioned file — no plain app.js (prevents stale cache)

rm -f /home/ec2-user/gmhdashboard/public/mobile/app.*.js 2>/dev/null
rm -f /home/ec2-user/gmhdashboard/public/mobile/app.js 2>/dev/null

HASH=$(md5sum /home/ec2-user/gmhdashboard/public/ipad/app.js | cut -c1-8)
cp /home/ec2-user/gmhdashboard/public/ipad/app.js "/home/ec2-user/gmhdashboard/public/mobile/app.${HASH}.js"
sed -i "s|app\.[a-f0-9]*\.js|app.${HASH}.js|g" /home/ec2-user/gmhdashboard/public/mobile/index.html

echo "$(date): Mobile synced — app.${HASH}.js (no plain app.js)"
