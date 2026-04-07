## 🔍 TROUBLESHOOTING

### ⚠️ Node.js / npx Does NOT Work on This Server

**Symptom**: Running `node -e "..."` or `npx tsx ...` hangs indefinitely or produces no output.

**Cause**: The EC2 instance's Node.js installation is unreliable for ad-hoc CLI scripting. `npx` commands frequently hang.

**Solution**: **Use Python instead** for all ad-hoc scripts, database queries, and one-off tasks:
```bash
# ❌ DON'T — hangs or crashes
node -e "const fs = require('fs'); console.log(fs.readFileSync('file.txt','utf8'))"
npx tsx script.ts

# ✅ DO — works reliably
python3 -c "print(open('file.txt').read())"
python3 script.py
```

> **Note**: Node.js works fine inside PM2-managed services (gmh-dashboard, telegram-ai-bot, etc.) and for `npm run build`. It's only the ad-hoc CLI usage that hangs.

### Dashboard Not Accessible

**Symptom**: `https://nowoptimal.com/ops/` returns error

**Check**:
```bash
# 1. Is PM2 running?
pm2 list
# Should show: gmh-dashboard (online)

# 2. Is Next.js responding?
curl -I http://localhost:3011/ops/
# Should: 307 redirect to /ops/login/

# 3. Is Nginx running?
sudo systemctl status nginx
# Should: active (running)

# 4. Check PM2 logs
pm2 logs gmh-dashboard --lines 50
# Look for: errors, "next start", port 3011

# 5. Check Nginx logs
sudo tail -50 /var/log/nginx/error.log
```

**Common fixes**:
- PM2 stopped: `pm2 start gmh-dashboard`
- Build corrupted: See "Emergency Recovery" above
- Nginx misconfigured: `sudo nginx -t` then fix errors

### QuickBooks OAuth 404

**Symptom**: `/ops/api/auth/quickbooks/` returns 404

**Check**:
```bash
# 1. Do route files exist?
ls -la app/api/auth/quickbooks/route.ts
ls -la app/api/auth/quickbooks/callback/route.ts
# Should: both exist

# 2. Is build up-to-date?
ls -la .next/server/app/api/auth/quickbooks/
# Should: route.js exists

# 3. Test route
curl -I http://localhost:3011/ops/api/auth/quickbooks/
# Should: 307 redirect to appcenter.intuit.com
```

**Fix**: Rebuild application (`npm run build && pm2 restart gmh-dashboard`)

### iPad "Connection Failed" on POST Requests (308 Redirect)

**Symptom**: iPad Safari shows "connection failed" when submitting SOAP notes or other POST requests

**Cause**: Next.js `trailingSlash: true` returns HTTP 308 when a POST request lacks a trailing slash. iPad Safari drops the POST body during the 308 redirect, causing the request to fail silently on the client side. No server-side errors appear in logs because the request never reaches the route handler.

**Fix**: Always include trailing slashes in client-side `fetch()` URLs for POST endpoints:
```typescript
// ❌ WRONG — triggers 308 redirect, iPad drops POST body
fetch(`${basePath}/api/scribe/submit-to-healthie`, { method: 'POST', ... });

// ✅ CORRECT — goes directly to the route, no redirect
fetch(`${basePath}/api/scribe/submit-to-healthie/`, { method: 'POST', ... });
```

**History**: Same bug class as the Jan 28, 2026 Healthie webhook 308 fix (line 1593). Fixed in ScribeClient.tsx on March 24, 2026 for all 4 POST endpoints (transcribe, generate-note, generate-doc, submit-to-healthie).

### Redirect Loop (ERR_TOO_MANY_REDIRECTS)

**Symptom**: Browser shows "redirected too many times"

**Check**:
```bash
# 1. Verify trailingSlash setting
grep trailingSlash next.config.js
# Should: trailingSlash: true

# 2. Test redirect behavior
curl -I http://localhost:3011/ops
# Should: 308 redirect to /ops/

curl -I http://localhost:3011/ops/
# Should: 307 redirect to /ops/login/ (or 200 if logged in)

# 3. Check Nginx config
grep -A5 "location = /ops" /etc/nginx/conf.d/nowoptimal.conf
# Should: return 301 /ops/;
```

**Fix**: Ensure `trailingSlash: true` in `next.config.js`, rebuild

### Disk Space Full

**Symptom**: npm commands fail silently, builds corrupt

**Check**:
```bash
df -h /
# Usage should be <90%
```

**Clean**:
```bash
# npm logs (often 100s of MB)
rm -rf ~/.npm/_logs/*

# Old PM2 logs
find ~/.pm2/logs -name "*.log" -mtime +7 -delete

# Docker (if not using)
sudo docker system prune -f
```

**Expand** (if needed):
```bash
# AWS Console → EC2 → Volumes → Modify → Increase size → Save
# Then on server:
sudo growpart /dev/nvme0n1 1
sudo xfs_growfs -d /
df -h /
```

### Scribe System Not Processing

**Symptom**: Audio uploaded but no Telegram messages

**Check**:
```bash
# 1. Is receiver running?
pm2 list | grep upload-receiver
# Should: online

# 2. Check receiver logs
pm2 logs upload-receiver --lines 20

# 3. Check scribe logs
tail -50 /tmp/scribe_orchestrator.log
tail -50 /tmp/scribe_document_generation.log

# 4. Test Telegram bot
cd /home/ec2-user/scripts/scribe
python3 -c "import telegram; bot = telegram.Bot(token='$TELEGRAM_BOT_TOKEN'); print(bot.get_me())"
# Should: show bot info
```

**Common fixes**:
- Receiver crashed: `pm2 restart upload-receiver`
- Missing env vars: Check `scripts/scribe/.env`
- Telegram token invalid: Verify with BotFather

### Snowflake Sync Failing

**Symptom**: Stale data in Metabase dashboards

**Check**:
```bash
# 1. Check last sync
tail -50 /home/ec2-user/logs/snowflake-sync.log
# Look for: "✅ SYNC COMPLETE", errors

# 2. Test Snowflake connection (use key-pair auth)
python3 << 'EOF'
import snowflake.connector
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
with open('/home/ec2-user/.snowflake/rsa_key_new.p8', 'rb') as f:
    p_key = serialization.load_pem_private_key(f.read(), password=None, backend=default_backend())
pkb = p_key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
conn = snowflake.connector.connect(
    account='KXWWLYZ-DZ83651',
    user='JARVIS_SERVICE_ACCOUNT',
    private_key=pkb,
    warehouse='GMH_WAREHOUSE',
    database='GMH_CLINIC'
)
print("Connected:", conn.cursor().execute("SELECT CURRENT_USER()").fetchone())
EOF

# 3. Run manual sync
cd /home/ec2-user
node scripts/sync-healthie-ops.js
```

**Fix**: Check env vars, verify Snowflake credentials, review sync logs

---

