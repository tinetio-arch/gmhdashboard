# GMH Dashboard — AntiGravity Source of Truth

**Last Updated**: December 28, 2025, 02:35 UTC  
**Primary AI Assistant**: AntiGravity (Google Deepmind Agentic Coding)  
**Sprint Period**: December 25-28, 2025

> **Purpose**: This is the MASTER reference document for all AI assistants working on the GMH Dashboard system. When in doubt, refer to this file first. All critical system information, recent changes, and operational procedures are documented here.

---

## 📍 QUICK ORIENTATION

### What is This System?
**GMH Dashboard** is a Next.js 14 healthcare operations platform integrating:
- **Clinical**: Healthie EHR (patient records, appointments, billing)
- **Financial**: QuickBooks (payments, invoices, accounting)
- **Analytics**: Snowflake (data warehouse) + Metabase (BI dashboards)
- **Communications**: Telegram (ops notifications), GoHighLevel (patient comms)
- **AI Features**: Scribe (visit documentation), Telegram bot (data queries)

### Critical System Facts
- **Active Directory**: `/home/ec2-user/gmhdashboard` ✅ (NOT `/apps/gmh-dashboard`)
- **Production URL**: `https://nowoptimal.com/ops/`
- **Base Path**: `/ops` (all routes prefixed with this)
- **Running On**: AWS EC2, Amazon Linux, PM2 process manager
- **Disk**: 50GB EBS volume (currently 32% used, 35GB free)
- **Database**: Postgres (operational writes) + Snowflake (analytics reads)

### Who Works Here?
- **Providers**: Aaron Whitten (243 patients), Phil Schafer NP (27 patients)
- **Operations**: You (via AI assistants)
- **Domains**: nowoptimal.com, nowprimary.care, nowmenshealth.care

---

## 🚨 CRITICAL - READ FIRST

### Before Making ANY Changes
1. **Check disk space**: `df -h /` (must have >2GB free)
2. **Verify you're in the right directory**: `pwd` → should be `/home/ec2-user/gmhdashboard`
3. **Check PM2 working directory**: `pm2 describe gmh-dashboard | grep cwd` → should be `/home/ec2-user/gmhdashboard`
4. **Review recent changes**: Read the "Recent Changes" section below
5. **Test locally first**: `npm run dev` before deploying to production

### Emergency Contacts
- **If system is down**: Check PM2 logs first: `pm2 logs gmh-dashboard --lines 50`
- **If disk is full**: See "Disk Space Maintenance" section
- **If OAuth broken**: See "QuickBooks OAuth" section
- **If Scribe failing**: Check `/tmp/scribe_*.log`

---

## 📊 SYSTEM ARCHITECTURE

### Technology Stack
- **Frontend**: Next.js 14 (App Router), React 18, TypeScript
- **Backend**: Next.js API Routes, Postgres (via `lib/db.ts`)
- **Auth**: Session cookies (`gmh_session_v2`), HMAC signing
- **Deployment**: PM2 (`next start`), Nginx reverse proxy
- **AI**: AWS Bedrock (Claude), Deepgram (transcription)
- **Warehouse**: Snowflake (GMH_CLINIC database)

### Key URLs & Routes
- **Dashboard**: `https://nowoptimal.com/ops/` (requires login)
- **Login**: `https://nowoptimal.com/ops/login/`
- **QuickBooks OAuth**: `https://nowoptimal.com/ops/api/auth/quickbooks/`
- **API Base**: `https://nowoptimal.com/ops/api/...`

### Important Files & Directories
```
/home/ec2-user/gmhdashboard/          # Active dashboard (PRODUCTION)
├── app/                              # Next.js app router
│   ├── api/                          # API routes
│   │   ├── auth/quickbooks/          # QuickBooks OAuth (NEW Dec 28)
│   │   └── admin/quickbooks/         # QuickBooks admin endpoints
│   ├── components/                   # React components
│   ├── login/                        # Login page
│   └── page.tsx                      # Main dashboard
├── lib/                              # Utility libraries
│   ├── auth.ts                       # Authentication (gmh_session_v2)
│   ├── db.ts                         # Postgres connection pool
│   ├── basePath.ts                   # Base path helpers (CRITICAL)
│   ├── quickbooks.ts                 # QuickBooks API client
│   └── healthie.ts                   # Healthie GraphQL client
├── scripts/                          # Background jobs
│   ├── scribe/                       # AI Scribe system (NEW Dec 25-27)
│   │   ├── scribe_orchestrator.py    # Main workflow
│   │   ├── telegram_approver.py      # Telegram approval UI
│   │   ├── document_generators.py    # AI document generation
│   │   ├── prompts_config.yaml       # Prompt templates
│   │   └── upload_receiver.js        # PM2 service (port 3001)
│   ├── prescribing/                  # E-prescribing automation
│   └── sync-healthie-*.ts            # Healthie → Snowflake sync
├── .env.local                        # Environment variables (CRITICAL)
├── next.config.js                    # Next.js config (trailingSlash: true)
├── pm2.config.js                     # PM2 process definitions
└── ANTIGRAVITY_SOURCE_OF_TRUTH.md    # This file

/home/ec2-user/scripts/               # Shared scripts (Snowflake sync, etc.)
/etc/nginx/conf.d/nowoptimal.conf     # Nginx configuration
```

---

## 🔥 RECENT MAJOR CHANGES (DEC 25-28, 2025)

### December 28: Infrastructure Hardening
**Disk Space Crisis & Resolution**
- Ran out of disk space (98% on 20GB volume)
- Cleaned 4GB (old duplicates, logs, n8n Docker)
- Expanded EBS volume 20GB → 50GB via AWS Console
- Commands: `sudo growpart /dev/nvme0n1 1 && sudo xfs_growfs -d /`
- Result: Now 32% usage (35GB free) ✅

**QuickBooks OAuth Routes Created**
- **Problem**: Routes never existed, returned 404
- **Solution**: Created from scratch:
  - `/app/api/auth/quickbooks/route.ts` - Initiates OAuth
  - `/app/api/auth/quickbooks/callback/route.ts` - Token exchange
  - Added `getPublicUrl()` helper for proper redirects
- **Database**: Stores tokens in `quickbooks_oauth_tokens` table
- **Flow**: User → QuickBooks → Callback → Tokens saved → Redirect to dashboard

**Redirect Loop Fixed**
- **Problem**: `ERR_TOO_MANY_REDIRECTS` on `/ops` ↔ `/ops/`
- **Root Cause**: Nginx forced `/` but Next.js stripped it
- **Solution**: 
  - Added `trailingSlash: true` to `next.config.js`
  - All URLs now end with `/` (standard)
  - Renamed cookie `gmh_session` → `gmh_session_v2` (invalidate old)

**Base Path Configuration Standardized**
- **ENV**: `NEXT_PUBLIC_BASE_PATH=/ops` (in `.env.local` AND `next.config.js`)
- **Helper**: `lib/basePath.ts` exports `withBasePath(path)` and `getBasePath()`
- **Rule**: ALL client-side fetches MUST use `withBasePath('/api/...')`
- **Example**: `fetch(withBasePath('/api/admin/quickbooks/sync'), ...)`

**Production Mode Fixed**
- **Problem**: PM2 was running `npm run dev` instead of `npm run start`
- **Solution**: 
  ```bash
  pm2 delete gmh-dashboard
  pm2 start npm --name "gmh-dashboard" -- run start
  pm2 save
  ```
- **Verify**: `pm2 logs gmh-dashboard` should show `next start` (not `next dev`)

**Type Safety & Hydration Fixes**
- **Hydration**: Added client-side guards to `AddPatientForm`, `LoginForm`
- **Pattern**: `useState(false)` + `useEffect(() => setMounted(true))` + early return
- **Formatters**: All `formatCurrency/formatNumber` now handle `number | string | null | undefined`
- **Dates**: Use UTC-based `safeDateFormat()` instead of `toLocaleString()`

### December 25-27: AI Scribe System Built
**Full Clinical Documentation Automation**
- **Location**: `/home/ec2-user/scripts/scribe/`
- **Workflow**:
  1. Audio recording uploaded → Deepgram transcription
  2. Claude analyzes visit → Classifies visit type
  3. Generates 4 documents: SOAP note, patient summary, prescription recs, lab orders
  4. Sends to Telegram for provider approval (inline buttons)
  5. Provider reviews/edits/approves
  6. Approved docs injected into Healthie chart

**Key Components**:
- `scribe_orchestrator.py` - Main coordinator
- `telegram_approver.py` - Human-in-the-loop approval UI
- `document_generators.py` - AI-powered generation
- `prompts_config.yaml` - Customizable prompt templates
- `upload_receiver.js` - PM2 service (listens on port 3001)

**Visit Types Detected**:
- Initial consultation
- Follow-up visit
- Prescription refill
- Medication adjustment
- Lab review

**Safety Features**:
- Telegram approval required (no auto-injection)
- Edit capability before approval
- Comprehensive logging
- Graceful error handling (Telegram failures don't crash workflow)

**Documentation**:
- Setup: `scripts/scribe/SETUP.md`
- Safety: `scripts/scribe/SAFETY_GUIDE.md`
- Customization: `scripts/scribe/PROMPT_CUSTOMIZATION.md`

### December 25-27: Snowflake "Mini-Bridge" Complete
**Infrastructure Provisioned**:
1. **AWS S3 Bucket**: `gmh-snowflake-stage` (us-east-2)
2. **IAM Role**: `snowflake-s3-access-role` (trust to Snowflake)
3. **Storage Integration**: S3 → Snowflake connection
4. **Snowpipe**: Auto-ingest on file upload

**Data Flow**:
```
Clinical Systems (Healthie, QB, Postgres)
  ↓ (Sync scripts)
AWS S3 (gmh-snowflake-stage)
  ↓ (Snowpipe)
Snowflake (GMH_CLINIC)
  ↓ (SQL views)
Metabase (BI)
```

**Active Syncs**:
- Every 6 hours: `scripts/sync-healthie-ops.js` → Snowflake
- Every hour: `scripts/scribe/healthie_snowflake_sync.py`
- On-demand: Invoice sync, provider sync, billing items

**Snowflake Details**:
- Account: `KXWWLYZ-DZ83651`
- User: `tinetio123`, Role: `ACCOUNTADMIN`
- Database: `GMH_CLINIC`
- Schemas: `FINANCIAL_DATA`, `PATIENT_DATA`, `INTEGRATION_LOGS`

**Key Tables** (as of Dec 28):
- `PATIENTS`: 305 rows
- `HEALTHIE_INVOICES`: 69
- `HEALTHIE_BILLING_ITEMS`: 20
- `QB_PAYMENTS`: 84
- `MEMBERSHIPS`: 102
- `DISPENSES`: 192

### December 25-27: Prescribing & Patient Engagement
**Pre-Staging E-Rx Orders**:
- AI Scribe generates prescription recommendations
- Creates Healthie tasks (tagged `erx-pending`)
- Provider reviews/approves via dashboard
- Approved scripts sent to pharmacy

**5th-Grade Patient Summaries**:
- AI generates patient-friendly visit summaries
- Written at 5th-grade reading level
- Posted to Healthie patient portal
- Improves patient understanding & engagement

---

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
curl -I http://localhost:3000/ops/        # Should: 307 redirect to /ops/login/
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
    proxy_pass http://127.0.0.1:3000;   # NO trailing slash here
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
- `gmh-dashboard` (port 3000) - Next.js dashboard
- `telegram-ai-bot-v2` - Conversational AI for data queries
- `upload-receiver` (port 3001) - Scribe audio file receiver

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

# Snowflake
SNOWFLAKE_ACCOUNT=KXWWLYZ-DZ83651
SNOWFLAKE_USER=tinetio123
SNOWFLAKE_PASSWORD=...
SNOWFLAKE_WAREHOUSE=GMH_WAREHOUSE
SNOWFLAKE_DATABASE=GMH_CLINIC
SNOWFLAKE_SCHEMA=FINANCIAL_DATA

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

## 🧩 CRITICAL CODE PATTERNS

### Base Path Usage (MANDATORY)

**Problem**: App runs at `/ops` prefix, not root `/`

**Solution**: Use helpers from `lib/basePath.ts`

**Client-side fetch (MUST use withBasePath)**:
```typescript
import { withBasePath } from '@/lib/basePath';

// ❌ WRONG - will 404
fetch('/api/admin/quickbooks/sync', { method: 'POST' });

// ✅ CORRECT
fetch(withBasePath('/api/admin/quickbooks/sync'), { method: 'POST' });
```

**Building public redirect URLs**:
```typescript
// In API routes (OAuth callback, etc.)
function getPublicUrl(path: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://nowoptimal.com';
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return `${baseUrl}${basePath}${path}`;
}

// ❌ WRONG - creates localhost URLs
return NextResponse.redirect(new URL('/admin/quickbooks', request.url));

// ✅ CORRECT
return NextResponse.redirect(getPublicUrl('/admin/quickbooks?success=true'));
```

**Server components & <Link>** (automatic):
```tsx
// These work automatically (Next.js handles basePath):
import Link from 'next/link';
<Link href="/admin/quickbooks">QuickBooks</Link>  // ✅ Works

import { redirect } from 'next/navigation';
redirect('/login');  // ✅ Works
```

### React Hydration Prevention

**Problem**: Browser extensions inject scripts, causing SSR/client mismatch

**Solution**: Client-side rendering guard

```typescript
'use client';
import { useState, useEffect } from 'react';

export default function MyForm() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Return placeholder during SSR
  if (!mounted) {
    return <div style={{ minHeight: '300px' }} />;
  }

  // Render actual content only on client
  return <form>...</form>;
}
```

### Type-Safe Data Formatting

**Problem**: API responses sometimes return numbers as strings

**Solution**: Defensive formatting

```typescript
// ❌ UNSAFE - crashes if val is string
function formatCurrency(val: number): string {
  return `$${val.toFixed(2)}`;
}

// ✅ SAFE
function formatCurrency(val: number | string | null | undefined): string {
  const num = Number(val);
  return Number.isFinite(num) ? `$${num.toFixed(2)}` : '$0.00';
}

function formatNumber(val: number | string | null | undefined): string {
  const num = Number(val);
  return Number.isFinite(num) ? num.toLocaleString() : '0';
}
```

### UTC Date Formatting (Hydration-Safe)

**Problem**: `toLocaleString()` varies by server/client timezone

**Solution**: UTC-based formatter

```typescript
function safeDateFormat(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'N/A';
  
  try {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(d.getTime())) return 'Invalid Date';
    
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    
    return `${mm}-${dd}-${yyyy}`;
  } catch {
    return 'Error';
  }
}
```

---

## 🔍 TROUBLESHOOTING

### Dashboard Not Accessible

**Symptom**: `https://nowoptimal.com/ops/` returns error

**Check**:
```bash
# 1. Is PM2 running?
pm2 list
# Should show: gmh-dashboard (online)

# 2. Is Next.js responding?
curl -I http://localhost:3000/ops/
# Should: 307 redirect to /ops/login/

# 3. Is Nginx running?
sudo systemctl status nginx
# Should: active (running)

# 4. Check PM2 logs
pm2 logs gmh-dashboard --lines 50
# Look for: errors, "next start", port 3000

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
curl -I http://localhost:3000/ops/api/auth/quickbooks/
# Should: 307 redirect to appcenter.intuit.com
```

**Fix**: Rebuild application (`npm run build && pm2 restart gmh-dashboard`)

### Redirect Loop (ERR_TOO_MANY_REDIRECTS)

**Symptom**: Browser shows "redirected too many times"

**Check**:
```bash
# 1. Verify trailingSlash setting
grep trailingSlash next.config.js
# Should: trailingSlash: true

# 2. Test redirect behavior
curl -I http://localhost:3000/ops
# Should: 308 redirect to /ops/

curl -I http://localhost:3000/ops/
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

# Old builds (if safe)
rm -rf /home/ec2-user/apps/gmh-dashboard/node_modules
rm -rf /home/ec2-user/apps/gmh-dashboard/.next
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

# 2. Test Snowflake connection
python3 << 'EOF'
import snowflake.connector
conn = snowflake.connector.connect(
    account='KXWWLYZ-DZ83651',
    user='tinetio123',
    password='...',  # From env
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

## 📚 REFERENCE: FILE LOCATIONS

### Configuration Files
- **Next.js**: `next.config.js` (trailingSlash, basePath, typescript ignore)
- **Env**: `.env.local` (all secrets)
- **PM2**: `pm2.config.js` (process definitions)
- **Nginx**: `/etc/nginx/conf.d/nowoptimal.conf` (reverse proxy)
- **TypeScript**: `tsconfig.json` (TS compiler config)
- **Package**: `package.json` (dependencies, scripts)

### Key Source Files
- **Auth**: `lib/auth.ts` (sessions, cookies, roles)
- **Database**: `lib/db.ts` (Postgres pool)
- **Base Path**: `lib/basePath.ts` (withBasePath, getBasePath)
- **QuickBooks**: `lib/quickbooks.ts` (API client)
- **Healthie**: `lib/healthie.ts` (GraphQL client)
- **Main Dashboard**: `app/page.tsx` (composite data aggregation)
- **Layout**: `app/layout.tsx` (navigation, auth check)

### OAuth Routes (NEW Dec 28)
- **Initiation**: `app/api/auth/quickbooks/route.ts`
- **Callback**: `app/api/auth/quickbooks/callback/route.ts`

### Scribe System (NEW Dec 25-27)
**Location**: `/home/ec2-user/scripts/scribe/` (ROOT level, not in gmhdashboard)
- **Orchestrator**: `/home/ec2-user/scripts/scribe/scribe_orchestrator.py`
- **Telegram UI**: `/home/ec2-user/scripts/scribe/telegram_approver.py`
- **Document Gen**: `/home/ec2-user/scripts/scribe/document_generators.py`
- **Prompts**: `/home/ec2-user/scripts/scribe/prompts_config.yaml`
- **Receiver**: `/home/ec2-user/scripts/scribe/upload_receiver.js` (PM2 service)
- **Docs**: `/home/ec2-user/scripts/scribe/{SETUP,SAFETY_GUIDE,PROMPT_CUSTOMIZATION}.md`

### Sync Scripts
- **Healthie Ops**: `scripts/sync-healthie-ops.js` (every 6 hours)
- **Healthie Invoices**: `scripts/sync-healthie-invoices.ts`
- **Healthie Providers**: `scripts/sync-healthie-providers.ts`
- **Billing Items**: `scripts/ingest-healthie-financials.ts`
- **Scribe Sync**: `scripts/scribe/healthie_snowflake_sync.py` (hourly)

### Documentation
- **This file**: `ANTIGRAVITY_SOURCE_OF_TRUTH.md` (master reference)
- **Copilot**: `.github/copilot-instructions.md` (GitHub Copilot specific)
- **README**: Various MD files in root (architecture, deployment, etc.)

---

## 🎯 DEVELOPMENT GUIDELINES

### Code Style
- **Imports**: Use `@/` path alias (e.g., `@/lib/db`)
- **TypeScript**: Strict mode enabled, use types (but `ignoreBuildErrors: true` for now)
- **Components**: Prefer server components unless state/effects needed
- **API**: Use `lib/db.ts` `query()` helper, never open new pools
- **Auth**: Use `requireUser(role)` server-side, `userHasRole(user, role)` client-side

### Commit Messages
- Start with category: `[fix]`, `[feat]`, `[refactor]`, `[docs]`, `[deploy]`
- Be specific: `[fix] QuickBooks OAuth callback redirect to localhost`
- Include context: `[feat] AI Scribe Telegram approval workflow`

### Testing Before Deploy
1. **Local dev test**: `npm run dev` → Test at `http://localhost:3000/ops/`
2. **Build test**: `npm run build` → Check for `Exit code: 0`
3. **Type check**: `npm run lint` (optional, we ignore TS errors in build)
4. **Env check**: Verify `.env.local` has all required vars
5. **Disk check**: `df -h /` → >2GB free

### Deployment Checklist
- [ ] Changes tested locally (`npm run dev`)
- [ ] Build succeeds (`npm run build`)
- [ ] No secrets in code (only in `.env.local`)
- [ ] PM2 working directory correct (`/home/ec2-user/gmhdashboard`)
- [ ] Disk space sufficient (`df -h /` → >2GB)
- [ ] Environment vars match production needs
- [ ] PM2 restarted (`pm2 restart gmh-dashboard`)
- [ ] Logs checked (`pm2 logs gmh-dashboard`)
- [ ] Public URL tested (`https://nowoptimal.com/ops/`)

---

## 🚀 QUICK COMMANDS REFERENCE

### Deployment
```bash
cd /home/ec2-user/gmhdashboard
npm run build
pm2 restart gmh-dashboard
pm2 logs gmh-dashboard --lines 20
```

### Check Status
```bash
pm2 list                                 # All services
df -h /                                  # Disk space
curl -I http://localhost:3000/ops/       # Local test
curl -I https://nowoptimal.com/ops/      # Public test
```

### View Logs
```bash
pm2 logs gmh-dashboard --lines 50        # Dashboard logs
tail -50 /tmp/scribe_orchestrator.log    # Scribe logs
tail -50 /home/ec2-user/logs/snowflake-sync.log  # Sync logs
sudo tail -50 /var/log/nginx/error.log   # Nginx errors
```

### Cleanup
```bash
rm -rf ~/.npm/_logs/*                                    # npm logs
find ~/.pm2/logs -name "*.log" -mtime +7 -delete         # Old PM2 logs
sudo docker system prune -f                              # Docker cleanup
```

### Nginx
```bash
sudo nginx -t                            # Test config
sudo systemctl reload nginx              # Apply changes
sudo systemctl status nginx              # Check status
```

### Snowflake
```bash
cd /home/ec2-user
node scripts/sync-healthie-ops.js        # Manual sync
tail -50 logs/snowflake-sync.log         # Check last sync
```

### Scribe
```bash
pm2 restart upload-receiver              # Restart receiver
tail -50 /tmp/scribe_*.log               # All scribe logs
cd /home/ec2-user/scripts/scribe && python3 scribe_orchestrator.py test.m4a
```

---

## 📞 INTEGRATION ENDPOINTS

### Healthie
- **GraphQL**: `https://api.gethealthie.com/graphql`
- **Auth**: `Basic <base64(API_KEY:)>`
- **Headers**: `authorizationsource: API`

### QuickBooks
- **OAuth**: `https://appcenter.intuit.com/connect/oauth2`
- **Token**: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
- **API**: `https://quickbooks.api.intuit.com/v3/company/{realmId}/...`

### Snowflake
- **Account**: `KXWWLYZ-DZ83651`
- **Region**: `us-east-1`
- **Warehouse**: `GMH_WAREHOUSE`

### Telegram
- **API**: `https://api.telegram.org/bot{TOKEN}/...`
- **Webhook**: (not used, polling mode)

---

## 🔐 SECURITY NOTES

### Never Commit
- `.env.local` (secrets)
- PM2 config with env vars
- Database credentials
- API keys/tokens
- Session secrets

### Cookie Security
- Name: `gmh_session_v2`
- Flags: `httpOnly`, `secure` (prod), `sameSite: 'lax'`
- Path: `/ops/` (matches base path)
- Signing: HMAC with `SESSION_SECRET`

### OAuth Security
- State parameter (CSRF protection)
- Stored in httpOnly cookie
- Validated on callback
- 10-minute expiry

---

## 🎓 LEARNING RESOURCES

### Next.js 14 App Router
- **Docs**: https://nextjs.org/docs/app
- **Server Components**: Default, use `'use client'` only when needed
- **API Routes**: `app/api/**/route.ts`
- **Base Path**: https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath

### Healthie API
- **GraphQL Docs**: https://docs.gethealthie.com/reference/2024-06-01
- **Webhooks**: https://docs.gethealthie.com/docs/webhooks

### QuickBooks API
- **OAuth 2.0**: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- **Accounting API**: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/account

### Snowflake
- **Docs**: https://docs.snowflake.com/
- **Snowpipe**: https://docs.snowflake.com/en/user-guide/data-load-snowpipe

---

## 📋 APPENDIX: COMMON QUERIES

### Find Patient in Healthie
```typescript
import { query } from '@/lib/db';

const patients = await query(
  `SELECT patient_id, patient_name, healthie_client_id 
   FROM patient_data_entry_v 
   WHERE patient_name ILIKE $1 
   LIMIT 10`,
  [`%${searchTerm}%`]
);
```

### Check QuickBooks Connection
```typescript
import { getQuickBooksClient } from '@/lib/quickbooks';

const qb = await getQuickBooksClient();
const companyInfo = await qb.getCompanyInfo();
// Returns: { CompanyName, LegalName, ... }
```

### Query Snowflake from Script
```python
import snowflake.connector
import os

conn = snowflake.connector.connect(
    account='KXWWLYZ-DZ83651',
    user='tinetio123',
    password=os.getenv('SNOWFLAKE_PASSWORD'),
    warehouse='GMH_WAREHOUSE',
    database='GMH_CLINIC',
    schema='PATIENT_DATA'
)

cursor = conn.cursor()
cursor.execute("SELECT COUNT(*) FROM PATIENTS")
print(cursor.fetchone()[0])
```

---

**End of Source of Truth Document**

*For questions or clarifications, review this document first. If still unclear, check:*
1. *PM2 logs: `pm2 logs gmh-dashboard`*
2. *Scribe logs: `/tmp/scribe_*.log`*
3. *Sync logs: `/home/ec2-user/logs/snowflake-sync.log`*
4. *Nginx logs: `/var/log/nginx/error.log`*

*This document is maintained by AntiGravity AI Assistant and should be updated after major changes.*

---

## ⚠️ DEPRECATED / REMOVED SYSTEMS

### ClinicSync Integration (REMOVED Dec 28, 2025)
**Status**: Fully deprecated and removed  
**Reason**: API stopped working, inefficient system  
**Replaced By**: Healthie (primary clinical source) + Snowflake (data warehouse)

**What Was Removed**:
- API integration code (874 file references)
- Webhook endpoints (`/api/integrations/clinicsync`)
- Admin UI pages (`/app/admin/clinicsync`)
- Library files (`lib/clinicsync.ts`, `lib/clinicsyncConfig.ts`)

**What Was Preserved**:
- Patient data (307 patients in `patients` table - NOT affected)
- Historical mapping data (archived tables: `clinicsync_*` marked deprecated)

**Migration Path**: All clinical data now sourced from Healthie GraphQL API  
**Cleanup Log**: See `CLEANUP_LOG_DEC28_2025.md` for detailed removal process

---
