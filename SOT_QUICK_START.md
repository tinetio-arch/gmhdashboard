# SOT v2.0 Quick Start Guide

**For AI Agents**: Read this first, then jump to specific sections as needed.

---

## 🚀 What Changed (TL;DR)

Old SOT: **4,148 lines** of mixed changelog + reference docs
New SOT: **889 lines** focused on current system state

**Result**: 80% reduction, 5x faster to read, prevents "fix one thing break 10 things"

---

## 📖 How to Use ANTIGRAVITY_SOURCE_OF_TRUTH_V2.md

### Step 1: Always Read First (80 lines, 2 minutes)
1. **Quick Orientation** (lines 40-80)
   - System overview, critical facts, service registry, admin access

2. **System Constraints** (lines 85-160)
   - 9 rules that MUST NOT be violated
   - Each includes WHY it exists (prevents X failure)

### Step 2: Use Decision Trees for Common Tasks
Before reading full docs, check if your task has a decision tree:
- Deploying code? → Deployment Decision Tree
- Service down? → Crash Loop Decision Tree
- Patient data wrong? → Data Source Decision Tree
- Commands hanging? → IPv6 Decision Tree

**80% of tasks are resolved here without deep reading.**

### Step 3: Deep Dive (Only When Needed)
If decision trees don't resolve your issue, read detailed docs:
- [SYSTEM_DESIGN_TESTOSTERONE.md](docs/SYSTEM_DESIGN_TESTOSTERONE.md) — Controlled substances
- [SYSTEM_DESIGN_PM2.md](docs/SYSTEM_DESIGN_PM2.md) — Service management
- [ANTIGRAVITY_CHANGELOG.md](docs/ANTIGRAVITY_CHANGELOG.md) — Historical incidents

---

## 🎯 Key Sections (Line Numbers)

| Section | Lines | When to Read |
|---------|-------|-------------|
| Quick Orientation | 40-80 | ALWAYS (system overview) |
| System Constraints | 85-160 | ALWAYS (critical rules) |
| Decision Trees | 165-280 | When deploying, troubleshooting, or managing services |
| Critical Code Patterns | 325-480 | When writing code |
| Recent Changes (30 days) | 485-550 | Understanding recent fixes |
| Quick Commands | 555-620 | Copy-paste deployment/status commands |

**Total Must-Read**: Lines 40-160 (120 lines, ~3 minutes)

---

## ⚡ Quick Commands (Copy-Paste Ready)

### Deploy Dashboard
```bash
cd /home/ec2-user/gmhdashboard
pm2 stop gmh-dashboard
rm -rf .next
npm run build
pm2 restart gmh-dashboard
pm2 logs gmh-dashboard --lines 50
```

### Fix Crash Loop
```bash
pm2 stop <service>
pm2 logs <service> --lines 100
# Fix the issue...
pm2 delete <service>
pm2 start /home/ec2-user/ecosystem.config.js --only <service>
pm2 save
```

### Check Health
```bash
python3 scripts/sot-health-check.py
```

---

## 🚨 Top 3 Constraints (Never Violate)

### 1. NEVER Silently Modify User Input
**Why**: Silent modifications create compounding inventory errors
**Example**: Mar 5 incident — 22mL discrepancy, 89 NULL records

### 2. ALL PM2 Services MUST Be in ecosystem.config.js
**Why**: Ad-hoc starts lose PORT env vars → port conflicts → crash loops
**Example**: Jan 28 incident — 34,000+ restarts

### 3. ALWAYS Use Postgres for Real-Time Data
**Why**: Snowflake has 6-hour lag
**Example**: Mar 4 fix — 3-tier patient matching (Postgres → Healthie → Snowflake)

---

## 🗺️ Decision Tree Example: Service is Down

```
Step 1: pm2 list

Step 2: Identify symptom
├─ Status "errored" → pm2 logs <service> --lines 50
├─ Status "stopped" → Check restart count
│   ├─ Restarts >10 → Crash loop (check Telegram alerts)
│   └─ Restarts 0-10 → Manual stop
├─ Status "online" but 502 → Port conflict or env var loss
└─ Status "launching" forever → Check interpreter version

Step 3: Common fixes
├─ Python version mismatch → Check ecosystem.config.js interpreter
├─ Port conflict → pm2 show <service> | grep PORT
├─ IPv6 hang → Check NODE_OPTIONS in ecosystem.config.js
└─ Missing deps → pip install -r requirements.txt

Step 4: Still broken?
→ Read SYSTEM_DESIGN_PM2.md (full troubleshooting)
```

---

## 📂 File Locations

| File | Purpose | Lines |
|------|---------|-------|
| [ANTIGRAVITY_SOURCE_OF_TRUTH_V2.md](ANTIGRAVITY_SOURCE_OF_TRUTH_V2.md) | Main SOT (current system state) | 889 |
| [docs/SYSTEM_DESIGN_TESTOSTERONE.md](docs/SYSTEM_DESIGN_TESTOSTERONE.md) | Controlled substance system | 221 |
| [docs/SYSTEM_DESIGN_PM2.md](docs/SYSTEM_DESIGN_PM2.md) | PM2 service management | 420 |
| [docs/ANTIGRAVITY_CHANGELOG.md](docs/ANTIGRAVITY_CHANGELOG.md) | Incident history (Dec 2025 - Mar 2026) | 1,792 |
| [SOT_RESTRUCTURE_SUMMARY.md](SOT_RESTRUCTURE_SUMMARY.md) | This restructure summary | 319 |
| [scripts/sot-health-check.py](scripts/sot-health-check.py) | Automated validation | 319 |

---

## ✅ Validation Checklist

Before starting any task:

- [ ] Read Quick Orientation (lines 40-80)
- [ ] Check System Constraints (lines 85-160) for relevant rules
- [ ] Try Decision Tree first (if task matches)
- [ ] Read deep-dive docs only if needed
- [ ] After work: Update Recent Changes if significant

**Time Required**: 3-5 minutes (vs 45 minutes for old SOT)

---

## 🛡️ Safety Notes

- Original ANTIGRAVITY_SOURCE_OF_TRUTH.md is **untouched** (still at 4,148 lines)
- V2 files use "_V2" suffix (no overwrites)
- Backups: `backups/sot-restructure-20260312-210632/`
- Rollback: Just delete V2 files

---

## 📈 Success Metrics (Track This)

| Metric | Target |
|--------|--------|
| Time to onboard new AI | <5 min |
| "Fix one thing, break 10" incidents | 0 per month |
| SOT line count | 700-900 |
| Recent Changes entries | ≤10 |
| Health check | 8/8 passing |

Run weekly: `python3 scripts/sot-health-check.py`

---

## 🔗 External SOPs (Referenced by SOT)

| SOP | Purpose |
|-----|---------|
| [PATIENT_WORKFLOWS.md](docs/PATIENT_WORKFLOWS.md) | Clinical procedures (TRT, Weight Loss, Primary Care) |
| [STAFF_ONBOARDING_SOP.md](docs/STAFF_ONBOARDING_SOP.md) | Front Desk & MA checklist |
| [SOP-Lab-System.md](docs/SOP-Lab-System.md) | Lab ordering, review, critical alerts |
| [SOP-AI-Scribe.md](docs/SOP-AI-Scribe.md) | AI-assisted clinical documentation |

---

**Quick Start Complete** — Start with ANTIGRAVITY_SOURCE_OF_TRUTH_V2.md lines 40-160!
