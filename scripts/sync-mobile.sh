#!/bin/bash
# Sync mobile app with iPad app — run after any iPad changes
# ONLY syncs app.js — style.css and index.html are phone-optimized and SEPARATE

# Copy iPad JS to mobile (both plain and versioned)
cp /home/ec2-user/gmhdashboard/public/ipad/app.js /home/ec2-user/gmhdashboard/public/mobile/app.js

# Update versioned JS copy
HASH=$(md5sum /home/ec2-user/gmhdashboard/public/mobile/app.js | cut -c1-8)
rm -f /home/ec2-user/gmhdashboard/public/mobile/app.*.js 2>/dev/null
cp /home/ec2-user/gmhdashboard/public/mobile/app.js "/home/ec2-user/gmhdashboard/public/mobile/app.${HASH}.js"
sed -i "s|app\.[a-f0-9]*\.js|app.${HASH}.js|g" /home/ec2-user/gmhdashboard/public/mobile/index.html

echo "$(date): Mobile synced — app.${HASH}.js"
