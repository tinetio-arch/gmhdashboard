#!/bin/bash
# Sync mobile app with iPad app — run after any iPad changes
# ONLY syncs app.js — style.css and index.html are phone-optimized and SEPARATE
cp /home/ec2-user/gmhdashboard/public/ipad/app.js /home/ec2-user/gmhdashboard/public/mobile/app.js
echo "$(date): Mobile app.js synced with iPad (style.css + index.html are phone-specific, NOT synced)"
