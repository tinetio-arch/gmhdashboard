# PM2 Service Management System

**Last Updated**: March 12, 2026
**Owner**: GMH Infrastructure
**Status**: Production

---

## Purpose

Manages all Node.js, Python, and background services using PM2 process manager. Ensures high availability, automatic restarts, crash loop prevention, and centralized configuration.

---

## Service Registry

| Service | Interpreter | Port | Purpose |
|---------|-------------|------|---------|
| **gmh-dashboard** | bash (wrapper) | 3011 | Next.js Admin Panel (startup-payment-sync wrapper) |
| **telegram-ai-bot-v2** | npx tsx | N/A | Jarvis AI Query Bot (Telegram) |
| **jessica-mcp** | python3.11 | 3002 | MCP Server for GHL Jessica AI agent |
| **upload-receiver** | node | 3001 | AI Scribe Audio Upload Receiver |
| **email-triage** | python3 | N/A | AI Email Classification & Routing |
| **fax-processor** | python3 | N/A | Incoming Fax S3 Monitor (SES → Google Chat) |
| **ghl-webhooks** | node | 3003 | GoHighLevel Webhook Handler |
| **nowprimary-website** | npm start | 3004 | NOW Primary Care Public Website |
| **nowmenshealth-website** | npm start | 3005 | NOW Men's Health Public Website |
| **nowoptimal-website** | npm start | 3008 | NOW Optimal Parent Website |
| **uptime-monitor** | python3 | N/A | Real-time PM2 & Website Health Monitoring |

**Total Services**: 11

---

## Critical Rules

### Rule 1: Centralized Configuration
**ALL services MUST be defined in `/home/ec2-user/ecosystem.config.js`**

**Why**:
- Ad-hoc starts (`pm2 start npm -- start`) don't preserve PORT env vars
- Missing restart limits cause CPU meltdown (34,000+ restart incident on Jan 28)
- Ecosystem config ensures consistent settings across all services

**Correct**:
```bash
pm2 start /home/ec2-user/ecosystem.config.js --only <service-name>
```

**Wrong**:
```bash
pm2 start npm -- start  # ❌ Missing PORT, restart limits, env vars
```

---

### Rule 2: Mandatory Restart Limits
**Every service MUST have these settings:**

```javascript
{
  max_restarts: 10,              // Stop after 10 consecutive failures
  restart_delay: 5000,           // Wait 5 seconds between restarts
  exp_backoff_restart_delay: 1000 // Exponential backoff starting at 1s
}
```

**Why**: Prevents infinite crash loops that burn CPU and fill logs.

**Incident**: Jan 28, 2026 — `nowprimary-website` and `nowmenshealth-website` reached **34,000+ restarts** because they were started ad-hoc without restart limits. Port conflicts caused infinite CPU meltdown until fixed.

---

### Rule 3: Python Version Specificity
**Python services MUST specify explicit interpreter version**

**Correct**:
```javascript
{
  name: 'jessica-mcp',
  interpreter: 'python3.11'  // ✅ Explicit version
}
```

**Wrong**:
```javascript
{
  interpreter: 'python3'  // ❌ Defaults to 3.9 which lacks many packages
}
```

**Why**: MCP package requires Python 3.10+. System default `python3` is 3.9.

**How to Check**:
```bash
pip show <package> | grep Requires-Python
```

---

### Rule 4: IPv6 Mitigation
**All Node.js services MUST have NODE_OPTIONS for IPv4-first DNS**

```javascript
env: {
  NODE_OPTIONS: '--dns-result-order=ipv4first'
}
```

**Why**: This EC2 instance has NO global IPv6 address. IPv6 connections hang indefinitely (30-120+ seconds or forever).

**Layers of Defense**:
1. System-level: `/etc/gai.conf` (IPv4 precedence)
2. Node.js: `NODE_OPTIONS` in ecosystem.config.js (defense-in-depth)
3. Shell: `.bashrc` exports `NODE_OPTIONS` for interactive sessions

**Incident**: Mar 7, 2026 — Node/npm commands hung for 30-120s before IPv6 fix.

---

### Rule 5: Always Save After Changes
**After ANY PM2 operation, run `pm2 save`**

```bash
pm2 start ecosystem.config.js --only <service>
pm2 save  # ✅ CRITICAL - persist process list
```

**Why**: Without `pm2 save`, changes are lost after server reboot.

---

## Standard Procedures

### Restart After PM2 Update or System Reboot

**Problem**: PM2 updates can lose process env vars (like PORT). Services restart without PORT → default to port 3000 → port conflicts → cascading failures.

**Correct Procedure**:
```bash
# 1. Stop all services
pm2 stop all

# 2. Delete all processes (clears stale state)
pm2 delete all

# 3. Start ALL services from ecosystem config (restores PORT env vars)
pm2 start /home/ec2-user/ecosystem.config.js

# 4. Wait 10 seconds, verify all online
sleep 10 && pm2 list

# 5. Save the process list
pm2 save
```

**Incident**: Mar 4, 2026 — After PM2 update, `gmh-dashboard` lost PORT=3011 → started on 3000 → 502 Bad Gateway. `nowoptimal-website` also tried 3000 → EADDRINUSE. `jessica-mcp` failed because `psycopg2` wasn't installed for python3.11.

---

### Restart Single Service

**Safe Restart** (preserves env vars if started from ecosystem):
```bash
pm2 restart <service-name>
```

**Full Rebuild** (ensures correct config):
```bash
pm2 delete <service-name>
pm2 start /home/ec2-user/ecosystem.config.js --only <service-name>
pm2 save
```

---

### Check Service Status

```bash
# List all processes
pm2 list

# Detailed info for one service
pm2 describe <service-name>

# View logs (last 50 lines)
pm2 logs <service-name> --lines 50

# Real-time monitoring
pm2 monit
```

---

### Handle Crash Loop

**Detection**: Automatic via `uptime-monitor` service
- Checks restart counts every 60 seconds
- Alert at >50 restarts
- Auto-stop at >100 restarts (prevents CPU meltdown)

**Manual Fix**:
```bash
# 1. Stop the service immediately
pm2 stop <service>

# 2. Check the error
pm2 logs <service> --lines 100

# 3. Fix the issue (see Common Issues below)

# 4. Reset restart counter
pm2 reset <service>

# 5. Restart from ecosystem config
pm2 delete <service>
pm2 start /home/ec2-user/ecosystem.config.js --only <service>
pm2 save
```

---

## Common Issues & Fixes

### Issue 1: Service Status "Errored"

**Symptoms**: `pm2 list` shows status "errored", high restart count

**Check**:
```bash
pm2 logs <service> --lines 50
```

**Common Causes**:

| Error Message | Cause | Fix |
|---------------|-------|-----|
| `ModuleNotFoundError` | Missing Python packages | `pip install -r requirements.txt` |
| `EADDRINUSE` | Port conflict | Check PORT env var, kill conflicting process |
| `Permission denied` | File/socket permissions | Check file ownership, chmod/chown |
| `Cannot find module` | Missing npm packages | `npm install` in service directory |
| Command hangs | IPv6 issue | Check NODE_OPTIONS in ecosystem.config.js |

---

### Issue 2: Port Conflicts

**Symptoms**: Service shows "online" but returns 502, or EADDRINUSE error

**Diagnose**:
```bash
# Check what's on the port
lsof -i :3011

# Check PM2 env vars
pm2 show <service> | grep PORT
```

**Fix**:
```bash
# If PORT env var is missing:
pm2 delete <service>
pm2 start /home/ec2-user/ecosystem.config.js --only <service>
pm2 save
```

---

### Issue 3: Python Version Mismatch

**Symptoms**: Service crashes with `ModuleNotFoundError` despite package being installed

**Check**:
```bash
# See which interpreter PM2 is using
pm2 describe <service> | grep interpreter

# Check if package is installed for that version
python3.11 -m pip show <package>
```

**Fix**:
```bash
# Update ecosystem.config.js to use correct Python version
vim /home/ec2-user/ecosystem.config.js
# Change: interpreter: 'python3.11'

# Reinstall packages for correct version
python3.11 -m pip install -r requirements.txt

# Restart service
pm2 delete <service>
pm2 start /home/ec2-user/ecosystem.config.js --only <service>
pm2 save
```

---

### Issue 4: IPv6 Hanging

**Symptoms**: Node/npm commands hang for 30-120+ seconds, or service takes forever to start

**Check**:
```bash
# Test Node.js startup time
time node -e "console.log('OK')"
# Should be <0.1s, not 30s+

# Check if NODE_OPTIONS is set
pm2 show <service> | grep NODE_OPTIONS
```

**Fix**:
```bash
# Ensure NODE_OPTIONS is in ecosystem.config.js
env: {
  NODE_OPTIONS: '--dns-result-order=ipv4first'
}

# Restart service
pm2 delete <service>
pm2 start /home/ec2-user/ecosystem.config.js --only <service>
pm2 save
```

---

## Monitoring & Alerts

### Crash Loop Detection
**Service**: `uptime-monitor` (PM2 service)
**Frequency**: Every 60 seconds
**Thresholds**:
- >50 restarts → Telegram warning
- >100 restarts → Auto-stop + alert

**Alert Includes**:
- Service name
- Restart count
- Last error message
- Suggested fix

---

### Health Monitoring
**Endpoint**: `https://nowoptimal.com/ops/api/analytics/system-health`

**Checks**:
- PM2 service status (all 11 services)
- CPU usage (alert >80%)
- Memory usage (alert >85%)
- Disk usage (alert >90%)
- Snowflake connectivity

**Used By**:
- CEO Dashboard (real-time status cards)
- `uptime-monitor` service (automated alerts)
- Morning Telegram report (8:00 AM MST)

---

## Files & Configuration

### Master Config
**File**: `/home/ec2-user/ecosystem.config.js`
**Format**: JavaScript module.exports
**Sections**: 11 service definitions

**Template**:
```javascript
{
  name: '<service-name>',
  script: '<entry-file>',
  cwd: '/home/ec2-user/<project-dir>',
  interpreter: 'node|python3|python3.11|npx|bash',
  max_restarts: 10,
  restart_delay: 5000,
  exp_backoff_restart_delay: 1000,
  max_memory_restart: '500M',
  env: {
    NODE_ENV: 'production',
    PORT: 3011,
    NODE_OPTIONS: '--dns-result-order=ipv4first'
  }
}
```

---

### Environment Variables (Dashboard)
**File**: `/home/ec2-user/gmhdashboard/.env.local`
**Key Vars**:
- `PORT=3011` (Dashboard port)
- `NODE_ENV=production`
- `NEXT_PUBLIC_BASE_PATH=/ops`

**Note**: These are ONLY loaded if service is started from ecosystem.config.js. Ad-hoc starts won't have them.

---

## Related Documentation

- [Operational Procedures](../ANTIGRAVITY_SOURCE_OF_TRUTH.md#operational-procedures) (deploy, restart, env vars)
- [Troubleshooting Guide](../ANTIGRAVITY_SOURCE_OF_TRUTH.md#troubleshooting) (PM2, OAuth, redirects)
- [System Architecture](../ANTIGRAVITY_SOURCE_OF_TRUTH.md#system-architecture) (URLs, ports, tech stack)
- [Uptime Monitor Source](/home/ec2-user/scripts/uptime_monitor.py)
- [Full Changelog](ANTIGRAVITY_CHANGELOG.md)

---

## Change History

| Date | Change | Reason |
|------|--------|--------|
| Mar 12, 2026 | Extracted to system design doc | SOT restructure |
| Mar 12, 2026 | PM2 version mismatch fix | In-memory (6.0.13) vs installed (6.0.14) |
| Mar 7, 2026 | Added NODE_OPTIONS IPv4-first | IPv6 hanging fix |
| Mar 4, 2026 | Port conflict documentation | After PM2 update incident |
| Feb 2026 | Crash loop auto-stop added | Prevent CPU meltdown (106k restart incident) |
| Jan 28, 2026 | Created uptime-monitor service | Real-time monitoring with Telegram alerts |
