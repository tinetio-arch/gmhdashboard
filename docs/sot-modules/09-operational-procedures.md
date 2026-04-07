## 🔧 OPERATIONAL PROCEDURES

### Build & Deploy to Production

**Standard Deployment**:
```bash
# 1. Verify preconditions
df -h /                                    # Check disk space (>2GB free)
pwd                                        # Should be /home/ec2-user/gmhdashboard
pm2 describe gmh-dashboard | grep cwd     # Verify working directory

# 2. Stop application
pm2 stop gmh-dashboard

# 3. Clean build artifacts
rm -rf .next

# 4. Install dependencies (if package.json changed)
npm install

# 5. Build production bundle
npm run build
# Look for "Exit code: 0" at end (ignore TS warnings if ignoreBuildErrors: true)

# 6. Start application
pm2 start gmh-dashboard
# OR if deleted: pm2 start npm --name "gmh-dashboard" -- run start

# 7. Save PM2 state
pm2 save

# 8. Verify deployment
curl -I http://localhost:3011/ops/        # Should: 307 redirect to /ops/login/
pm2 logs gmh-dashboard --lines 10         # Should: show "next start" (not "next dev")
curl -I https://nowoptimal.com/ops/       # Test public URL

# 9. Monitor for errors
pm2 logs gmh-dashboard --lines 50
```

**Emergency Recovery** (if completely broken):
```bash
pm2 stop gmh-dashboard
cd /home/ec2-user/gmhdashboard
rm -rf .next node_modules/.cache
npm install
npm run build
pm2 start gmh-dashboard
pm2 logs gmh-dashboard --lines 50
```

### Nginx Configuration Changes

**Edit config**:
```bash
sudo nano /etc/nginx/conf.d/nowoptimal.conf
```

**Test & reload**:
```bash
sudo nginx -t                  # Test config syntax
sudo systemctl reload nginx    # Apply changes (no downtime)
# OR
sudo systemctl restart nginx   # Full restart (brief downtime)
```

**Key sections**:
```nginx
# Force trailing slash on /ops
location = /ops {
    return 301 /ops/;
}

# Proxy to Next.js (preserve /ops prefix)
location /ops/ {
    proxy_pass http://127.0.0.1:3011;   # NO trailing slash here
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### PM2 Operations

**Check process status**:
```bash
pm2 list                                 # All processes
pm2 describe gmh-dashboard               # Detailed info
pm2 logs gmh-dashboard --lines 50        # Recent logs
pm2 monit                                # Real-time monitoring
```

**Restart specific service**:
```bash
pm2 restart gmh-dashboard
pm2 restart telegram-ai-bot-v2
pm2 restart upload-receiver
```

**Save state** (persist after reboot):
```bash
pm2 save
pm2 startup                              # Generate startup script
```

**Current services**:
- `gmh-dashboard` (port 3011) - Next.js dashboard
- `telegram-ai-bot-v2` - Conversational AI for data queries
- `upload-receiver` (port 3001) - Scribe audio file receiver
- `ghl-webhooks` (port 3003) - GoHighLevel integration
- `jessica-mcp` (port 3002) - MCP server
- `email-triage` - AI email routing
- `fax-processor` - Incoming fax processor
- `nowprimary-website` (port 3004) - Primary Care site
- `nowmenshealth-website` (port 3005) - Men's Health site
- `nowoptimal-website` (port 3008) - NowOptimal parent site
- `abxtac-website` (port 3009) - ABX TAC peptide e-commerce (abxtac.com)
- `uptime-monitor` - PM2 service and website health monitoring

### Environment Variables

**Location**: `/home/ec2-user/gmhdashboard/.env.local`

**Critical vars**:
```bash
# Next.js
NEXT_PUBLIC_BASE_PATH=/ops
NODE_ENV=production

# Healthie
HEALTHIE_API_KEY=gh_live_...
HEALTHIE_API_URL=https://api.gethealthie.com/graphql
NEXT_PUBLIC_HEALTHIE_TOKEN=gh_live_...   # For client components

# QuickBooks
QUICKBOOKS_CLIENT_ID=...
QUICKBOOKS_CLIENT_SECRET=...
QUICKBOOKS_REDIRECT_URI=https://nowoptimal.com/ops/api/auth/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=production
QUICKBOOKS_REALM_ID=9130349088183916

# Database
DATABASE_HOST=clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com
DATABASE_PORT=5432
DATABASE_NAME=postgres
DATABASE_USER=clinicadmin
DATABASE_PASSWORD=...
DATABASE_SSLMODE=require

# Snowflake (use JARVIS_SERVICE_ACCOUNT — key-pair auth)
SNOWFLAKE_ACCOUNT=KXWWLYZ-DZ83651
SNOWFLAKE_SERVICE_USER=JARVIS_SERVICE_ACCOUNT
SNOWFLAKE_PRIVATE_KEY_PATH=/home/ec2-user/.snowflake/rsa_key_new.p8
SNOWFLAKE_WAREHOUSE=GMH_WAREHOUSE
SNOWFLAKE_DATABASE=GMH_CLINIC
SNOWFLAKE_SCHEMA=FINANCIAL_DATA
# NOTE: Old user 'tinetio123' is blocked by MFA — do NOT use password auth

# Auth
SESSION_SECRET=...                       # HMAC signing key

# Telegram (for bots)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
TELEGRAM_AUTHORIZED_CHAT_IDS=...

# AWS (for Scribe)
AWS_REGION=us-east-1
ANTHROPIC_API_KEY=...
DEEPGRAM_API_KEY=...
```

**After changing env vars**:
```bash
pm2 restart gmh-dashboard
# PM2 reloads .env.local automatically
```

---

