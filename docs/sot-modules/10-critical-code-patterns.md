- S3 storage: ~$1/month (500MB)
- **Total**: ~$135/month (use pdf-parse instead of Textract to save $30)

**Status**: Planning complete, ready for implementation (4 weeks)
**Location**: `/home/ec2-user/.gemini/antigravity/brain/.../document_automation_plan.md`

### Access Labs API Integration ✅ ACTIVE (Jan 2026)

**Purpose**: Direct API integration with Access Medical Labs for real-time lab result retrieval and review.

**API Credentials** (stored in `~/.env.production`):
- `ACCESS_LABS_USERNAME`: pschafer@nowoptimal.com
- `ACCESS_LABS_PASSWORD`: (encrypted)
- **Base URL**: `https://api.accessmedlab.com/apigateway/`

**Scripts** (`/home/ec2-user/scripts/labs/`):
| File | Purpose |
|------|---------|
| `access_labs_client.py` | API client (auth, results, orders) |
| `fetch_results.py` | Cron job - fetches new results every 30 min |
| `generate_lab_pdf.py` | PDF generation using reportlab |
| `lab_s3_storage.py` | S3 upload/download with presigned URLs |
| `healthie_lab_uploader.py` | Uploads PDFs to Healthie patient charts |

**Cron Schedule**: Every 30 minutes
```cron
*/30 * * * * cd /home/ec2-user/scripts/labs && /usr/bin/python3 fetch_results.py >> /var/log/access-labs.log 2>&1
```

**Data Flow**:
1. **Fetch**: Cron polls Access Labs API for new results
2. **Match Patient**: Fuzzy match (Snowflake cache → Healthie direct search)
3. **Generate PDF**: `generate_lab_pdf.py` creates professional PDF with critical value highlighting
4. **Upload to S3**: `gmh-clinical-data-lake/labs/pending/{accession}_{name}.pdf`
5. **Queue for Review**: Inserted into `lab_review_queue` PostgreSQL table (migrated from `data/labs-review-queue.json` on Feb 26, 2026)
6. **Provider Review**: Dashboard at `/ops/labs` shows pending labs
7. **Approve**: PDF uploaded to Healthie (initially hidden), then made visible on approval

**Patient Matching Logic** (Updated March 4, 2026 — 3-Tier Pipeline):
1. **Tier 1 (Postgres)**: Query local `patients` table for all patients with `healthie_client_id`, fuzzy match using `thefuzz` (token_sort_ratio ≥85%)
2. **Tier 2 (Healthie API)**: Direct search via `users(keywords: "...")` GraphQL query, filter active patients, DOB confirmation
3. **Tier 3 (Snowflake)**: Query `PATIENT_360_VIEW` as bonus/fallback if both above fail
- **Name normalization**: `_normalize_name()` converts `BADILLA` → `Badilla`, `DOE, JOHN` → `John Doe`
- **DOB normalization**: `_normalize_dob()` handles `MM/DD/YYYY`, `YYYY-MM-DD`, etc.

> [!IMPORTANT]
> **Previously** matching was Snowflake-only. If Snowflake was down, ALL matching silently returned 0%. The new Tier 1 (Postgres) is always available.

**Zero-Results Alerting** (Added March 4, 2026):
- State file: `/home/ec2-user/data/last-lab-results-seen.json`
- Sends Telegram alert if no new lab results for **48+ hours**
- Only fires once per drought period (resets when new results arrive)

**Key Fields from Snowflake** (`GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW`):
- `HEALTHIE_CLIENT_ID` → used as `healthie_id`
- `PATIENT_NAME` → fuzzy match target
- `DATE_OF_BIRTH` → DOB boost for confidence

**S3 Storage**:
- **Bucket**: `gmh-clinical-data-lake`
- **Pending**: `labs/pending/{accession}_{name}_{uuid}.pdf`
- **Approved**: `labs/approved/{accession}_{name}_{uuid}.pdf`

**Dashboard APIs** (`/app/api/labs/`):
- `GET /api/labs/review-queue` - List pending reviews
- `POST /api/labs/review-queue` - Approve/reject with Healthie upload
- `GET /api/labs/pdf/[id]` - Serve PDF from S3 (presigned URL)

**Critical Value Handling**:
- Severity levels 1-5 based on test abnormality flags
- Critical tests highlighted in PDF
- Google Chat alert for severity ≥4

### Service Health Monitoring (PM2)

**Purpose**: Automatic monitoring of critical PM2 services with Telegram alerts on down/recovery.

**Cron Schedule** (all times MST — cron runs in local timezone):
```cron
# Morning Telegram Report - 8:00am MST
0 8 * * * /home/ec2-user/scripts/cron-alert.sh "Morning Report" "cd /home/ec2-user/gmhdashboard && npx tsx scripts/morning-telegram-report.ts"

# Infrastructure Monitoring - 8:30am MST
30 8 * * * /home/ec2-user/scripts/cron-alert.sh "Infrastructure Monitor" "/usr/bin/python3 /home/ec2-user/scripts/unified_monitor.py"

# Website health check (every 5 min)
*/5 * * * * /home/ec2-user/scripts/website-monitor.sh >> /home/ec2-user/logs/website-monitor.log 2>&1
```

> [!IMPORTANT]
> **Cron uses MST** on this server (`/etc/localtime` → `America/Phoenix`). Use MST hours directly — do NOT convert from UTC.

**Monitored Services**:
- `gmh-dashboard` - Main Next.js app
- `telegram-ai-bot-v2` - Jarvis data query bot
- `upload-receiver` - Scribe audio receiver
- `email-triage` - AI email routing
- `ghl-webhooks` - GHL integration
- `jessica-mcp` - GHL MCP server

**Alerts Sent**:
- 🔴 **Service Down**: When any service status ≠ "online"
- ✅ **Service Recovered**: When previously-down service comes back
- 🔄 **Crash Loop**: When restart count > 5
- 🔥 **High CPU**: When CPU load > 80%
- 💾 **High Memory**: When memory usage > 85%

**Webhook Health Monitoring** (via `uptime-monitor` PM2 service):
- Checks every 60 seconds via system-health API
- **Threshold**: Warning only when `pending > 50` webhooks (normal queue is <30)
- **Grace period**: 10 minutes of continuous degradation before alerting
- **"Payment alerts" warning**: Only shown for actual `error` status (no webhooks in 24h+)
- **Recovery messages**: Only sent if an alert was actually fired (no noise from grace-period clears)

**Resource Thresholds**:
- CPU: 80% (based on load avg / cores)
- Memory: 85%
- Alerts have cooldown - only fire once until recovered

**Daily Reports** (8:00 AM MST):
- **Morning Report** (8:00 AM): Patient overview, revenue, appointments via `morning-telegram-report.ts`
- **Infrastructure Monitor** (8:30 AM): System stats, Snowflake health, AWS costs via `unified_monitor.py`

**Jarvis Bot System Queries**:
Ask the Telegram bot anytime:
- `/status` or `server status` or `system status`
- `cpu usage` / `memory usage` / `disk usage`
- `how's the server` / `check server`

Response includes CPU %, memory %, disk %, swap, PM2 service count, and uptime with color-coded indicators.

**Testing the Monitor**:
```bash
# Manual run
cd /home/ec2-user && python3 scripts/monitoring/health_monitor.py

# Simulate outage (will trigger alert in ~5 min)
pm2 stop telegram-ai-bot-v2
# Wait for alert, then restart
pm2 start telegram-ai-bot-v2
```

**Fix History**:
- **Jan 1, 2026**: Fixed cron log path from `/var/log/` (permission denied) to `/home/ec2-user/logs/`
- **Jan 1, 2026**: Added CPU/memory monitoring with Telegram alerts (80%/85% thresholds)
- **Jan 1, 2026**: Added daily system stats to morning report
- **Jan 1, 2026**: Added Jarvis query capability (`/status`, `cpu usage`, etc.)

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

### MANDATORY: iPad + Mobile App Sync (April 2026)
