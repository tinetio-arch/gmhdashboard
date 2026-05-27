#!/bin/bash
# Sync mobile app with iPad app — run after any iPad changes.
# ONLY syncs app.js — style.css and index.html are phone-optimized and SEPARATE.
# Mobile: ONLY the versioned file (no plain app.js — prevents stale cache).
# iPad: keeps app.js as the source-of-truth AND stamps app.<HASH>.js for the
# index.html script tag so iOS Safari / home-screen PWAs cache-invalidate on
# every deploy (the bare ?v=Date.now() was getting ignored in PWA mode).

# ── Mobile bundle ──────────────────────────────────────────────────────────
rm -f /home/ec2-user/gmhdashboard/public/mobile/app.*.js 2>/dev/null
rm -f /home/ec2-user/gmhdashboard/public/mobile/app.js 2>/dev/null

HASH=$(md5sum /home/ec2-user/gmhdashboard/public/ipad/app.js | cut -c1-8)
cp /home/ec2-user/gmhdashboard/public/ipad/app.js "/home/ec2-user/gmhdashboard/public/mobile/app.${HASH}.js"
sed -i "s|app\.[a-f0-9]*\.js|app.${HASH}.js|g" /home/ec2-user/gmhdashboard/public/mobile/index.html

# ── iPad cache-bust ────────────────────────────────────────────────────────
# Drop any stale hashed copies (regex-bounded so the canonical app.js stays
# put — debug scripts and the sync-mobile chain both read from app.js).
find /home/ec2-user/gmhdashboard/public/ipad -maxdepth 1 -type f \
    -regex '.*/app\.[a-f0-9]+\.js' -delete 2>/dev/null
cp /home/ec2-user/gmhdashboard/public/ipad/app.js \
   "/home/ec2-user/gmhdashboard/public/ipad/app.${HASH}.js"
# Match either the placeholder (app.00000000.js) or any prior hash.
sed -i "s|app\.[a-f0-9]\+\.js|app.${HASH}.js|g" \
    /home/ec2-user/gmhdashboard/public/ipad/index.html

echo "$(date): Mobile + iPad synced — app.${HASH}.js"
