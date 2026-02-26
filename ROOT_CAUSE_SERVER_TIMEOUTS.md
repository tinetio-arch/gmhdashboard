# ROOT CAUSE ANALYSIS - Server Timeouts & Resource Exhaustion
**Date**: December 28, 2025, 04:25 UTC  
**Incident**: User reports server timeouts requiring manual reboot  
**Status**: **CRITICAL - RESOURCE EXHAUSTION IDENTIFIED**

---

## 🚨 EXECUTIVE SUMMARY

Your server is running out of memory (88% used) with **NO SWAP configured**, causing system freezes and timeouts. The primary culprits are:

1. **TypeScript Language Server**: 3.1GB (39% of total RAM!)
2. **VS Code / AntiGravity Extension**: Multiple heavyweight processes
3. **Metabase**: 895MB of Java heap
4. **No swap space**: When RAM fills up, system crashes instead of swapping to disk

**IMMEDIATE DANGER**: Only **667MB of 7.6GB available**. System will freeze when this runs out.

---

## 📊CURRENT RESOURCE STATE

### Memory Usage (CRITICAL ⚠️)
```
Total RAM:     7.6 GB
Used:          6.7 GB (88%)
Available:     667 MB (8.6%)  ← DANGEROUSLY LOW
Swap:          0 GB          ← NO SAFETY NET!
```

### Top Memory Consumers:
| Process | Memory | % | PID | Purpose |
|---------|--------|---|-----|---------|
| **TypeScript Server #1** | 3.1 GB | 39% | 3172 | VS Code language analysis |
| **Metabase (Java)** | 895 MB | 11% | 2237 | BI Dashboard |
| **AntiGravity Language Server** | 812 MB | 10% | 2968 | AI coding assistant |
| **next-server** | 524 MB | 6.5% | 2077 | Dashboard (dev mode) |
| **VS Code Extension Host** | 481 MB | 6% | 2653 | VS Code extensions |
| **TypeScript Server #2** | 151 MB | 2% | 3171 | Partial semantic mode |

**TOTAL**: ~5.9 GB / 7.6 GB = **78% by these 6 processes alone**

### CPU Usage
- Load Average: 1.10 (11 min avg)
- TypeScript Server: 20.1% CPU
- VS Code Extension Host: 15.2% CPU
- AntiGravity Language Server: 12.6% CPU
- Metabase: 12.5% CPU

---

## 🔍 ROOT CAUSE ANALYSIS

### Why Is TypeScript Server Using 3.1GB?

**The Problem**:
The TypeScript language server is analyzing your **ENTIRE gmhdashboard codebase** including:
- All TypeScript/JavaScript files
- All `node_modules` (thousands of files)
- Multiple open files and projects
- Type checking the entire dependency tree

**Why It Grew So Large**:
1. **Large codebase**: gmhdashboard + all dependencies
2. **Multiple open files**: 5+ open documents in your editor
3. **No memory limit**: Default TypeScript server has no hard cap
4. **Memory leak potential**: Long-running TS server can accumulate memory

### Why Did System Timeout?

**The Fatal Sequence**:
1. TypeScript server grows to 3.1GB
2. Metabase + VS Code + Dashboard use another 2.8GB
3. Total memory hits ~7.0GB (92% of available)
4. **NO SWAP configured** - can't offload to disk
5. System tries to allocate more memory → **FAILS**
6. Kernel OOM (Out of Memory) killer activates
7. **System freezes/becomes unresponsive**
8. User forced to manual reboot

---

## ⚡ IMMEDIATE ACTIONS NEEDED

### 1. **ADD SWAP SPACE** (CRITICAL - Do This NOW)

Create a 4GB swap file for emergency memory:

```bash
# Create swap file
sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make it permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify
free -h
```

**This will prevent future crashes** by giving the system breathing room.

### 2. **Restart TypeScript Server** (Immediate Relief)

In VS Code:
- Press `Ctrl+Shift+P`
- Type: "TypeScript: Restart TS Server"
- Press Enter

This should drop memory from 3.1GB to ~500MB instantly.

### 3. **Limit TypeScript Server Memory**

Add to `gmhdashboard/.vscode/settings.json`:
```json
{
  "typescript.tsserver.maxTsServerMemory": 2048,
  "typescript.tsserver.experimental.enableProjectDiagnostics": false
}
```

### 4. **Exclude node_modules from TS Analysis**

Add to `gmhdashboard/tsconfig.json`:
```json
{
  "exclude": [
    "node_modules",
    ".next",
    "out",
    "build"
  ]
}
```

---

## 🛠️ LONG-TERM SOLUTIONS

### Option 1: Upgrade Instance (Recommended)
**Current**: t3.medium (8GB RAM, burst CPU)  
**Recommended**: t3.large (16GB RAM, sustained CPU)

**Cost**: ~$60/month → ~$120/month  
**Benefit**: 2x memory, handles all services comfortably

### Option 2: Optimize Current Instance

#### A. Reduce Metabase Memory
Edit Metabase startup to limit Java heap:
```bash
# In Metabase docker-compose or startup
-Xmx512m  # Limit to 512MB instead of default
```

#### B. Close Unused VS Code Sessions
- Each VS Code window = ~1GB overhead
- Close when not actively coding

#### C. Use Production Mode for Dashboard
```bash
# Build once
npm run build

# Run in production mode (uses less memory)
pm2 delete gmh-dashboard
pm2 start npm --name "gmh-dashboard" -- start
```
**Saves**: ~200-300MB vs dev mode

#### D. Disable AntiGravity Language Server When Not Needed
Settings → Extensions → Disable "AntiGravity" when doing admin work

---

## 📈 MONITORING RECOMMENDATIONS

### 1. Add Memory Alerts

Update the health check script to alert at 80% memory:

```bash
# In /home/ec2-user/gmhdashboard/scripts/health-check.sh
MEM_USAGE=$(free | awk 'NR==2 {printf "%.0f", $3/$2 * 100}')
if [ "$MEM_USAGE" -gt 80 ]; then
  echo "⚠️ ALERT: Memory usage ${MEM_USAGE}% - approaching limit!"
  # TODO: Send Telegram alert
fi
```

### 2. Track Historical Memory Usage

```bash
# Add to cron (every 5 minutes)
*/5 * * * * echo "$(date),$(free | grep Mem | awk '{print $3/$2 * 100.0}')" >> /home/ec2-user/logs/memory-history.csv
```

### 3. Set Up CloudWatch Alarms

- Memory > 85%: Warning
- Memory > 90%: Critical
- Swap usage > 50%: Investigate

---

## 🔢 PROCESS BREAKDOWN

### What's Running:
```
PM2 Services (Necessary):
- gmh-dashboard: 524MB
- telegram-ai-bot-v2: 115MB
- upload-receiver: (stopped)

Background Services (Necessary):
- Metabase: 895MB
- CloudWatch Agent: 98MB

VS Code / Development (OPTIONAL when not coding):
- TypeScript Server: 3.1GB (!!)
- AntiGravity Language Server: 812MB
- Extension Host: 481MB
- File Watcher: 136MB
- VS Code Server: 110MB

TOTAL DEV TOOLS: ~4.6GB
```

**The Problem**: Development tools are using **60% of total RAM**!

---

## ⚠️ WARNING SIGNS TO WATCH FOR

Before next timeout, you'll see:
1. **System becomes sluggish** (commands slow to respond)
2. **SSH connections lag** (typing delay)
3. **Free memory < 500MB** (check with `free -h`)
4. **Load average > 2.0** (check with `uptime`)
5. **VS Code becomes unresponsive**

**When you see these**: Restart TypeScript server immediately!

---

## 🎯 PRIORITY ACTIONS

**DO IMMEDIATELY** (Next 10 minutes):
1. [ ] Add 4GB swap space (commands above)
2. [ ] Restart TypeScript Server in VS Code
3. [ ] Verify swap active: `free -h`

**DO TODAY**:
4. [ ] Add memory limits to `tsconfig.json`
5. [ ] Configure Metabase memory limit
6. [ ] Update health check script with memory alerts
7. [ ] Consider instance upgrade

**DO THIS WEEK**:
8. [ ] Build dashboard in production mode
9. [ ] Set up memory usage tracking (cron job)
10. [ ] Configure CloudWatch memory alarms
11. [ ] Document when to close VS Code

---

## 📊 BEFORE vs AFTER (Expected)

### Current State:
```
Memory: 6.7GB / 7.6GB (88%) - DANGEROUS
Swap: 0GB - NO SAFETY NET
Risk: HIGH - will crash again
```

### After Swap + TS Restart:
```
Memory: 3.5GB / 7.6GB (46%) - HEALTHY
Swap: 0GB / 4GB - AVAILABLE
Risk: LOW - stable operation
```

### After Instance Upgrade:
```
Memory: 6.7GB / 16GB (42%) - COMFORTABLE
Swap: 0GB / 8GB - LARGE SAFETY NET
Risk: MINIMAL - plenty of headroom
```

---

## 🤔 WHY THIS WASN'T CAUGHT EARLIER

1. **No swap** - System crashes instead of gracefully degrading
2. **No memory monitoring** - We only added health checks today
3. **TypeScript server** - Grows gradually over hours/days
4. **Multiple reboots** - Masked the underlying issue (clears memory)

---

## ✅ SUCCESS CRITERIA

System is healthy when:
- [ ] Free memory > 2GB
- [ ] Swap configured (4GB+)
- [ ] TypeScript server < 1GB
- [ ] Load average < 1.5
- [ ] No "defunct" processes
- [ ] Commands respond instantly

---

**BOTTOM LINE**: Your server doesn't have enough RAM for development tools + production services. Either upgrade the instance OR close development tools when not actively coding.

**NEXT IMMEDIATE STEP**: Add swap space (4GB) to prevent crashes.
