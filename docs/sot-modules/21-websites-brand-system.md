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
