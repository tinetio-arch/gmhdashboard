# GMH Dashboard — AntiGravity Source of Truth

**Last Updated**: March 12, 2026 (v2.0 — Streamlined Edition)
**Primary AI Assistant**: AntiGravity (Google Deepmind Agentic Coding)
**Backup**: `backups/sot-restructure-20260312-210632/`

---

> **Purpose**: This is the MASTER reference document for all AI assistants working on the GMH Dashboard system. This document focuses on **current system state**, not historical changes. For incident history, see [ANTIGRAVITY_CHANGELOG.md](docs/ANTIGRAVITY_CHANGELOG.md).

---

## 📑 TABLE OF CONTENTS

| # | Section | Lines | When to Read |
|---|---------|-------|-------------|
| 1 | [Quick Orientation](#-quick-orientation) | 40-80 | **ALWAYS** — system overview, facts, admin access |
| 2 | [System Constraints](#-system-constraints-never-violate) | 85-160 | **ALWAYS** — critical rules that prevent cascading failures |
| 3 | [Decision Trees](#-decision-trees) | 165-280 | When deploying, troubleshooting, or managing services |
| 4 | [System Design Index](#-system-design-index) | 285-320 | Links to detailed subsystem docs (Testosterone, Labs, PM2, etc.) |
| 5 | [Critical Code Patterns](#-critical-code-patterns) | 325-480 | When writing code — base path, hydration, formatting |
| 6 | [Recent Changes (Last 30 Days)](#-recent-changes-last-30-days) | 485-550 | Understanding recent fixes and new features |
| 7 | [Quick Commands](#-quick-commands) | 555-620 | Copy-paste deployment, status, log commands |
| 8 | [Integration Endpoints](#-integration-endpoints) | 625-660 | Healthie, QuickBooks, Snowflake API details |
| 9 | [Security & Access](#-security--access) | 665-700 | Cookie security, OAuth, credentials |

**Navigation Rule**: Read sections 1-2 first (80 lines total), then jump to task-specific sections using line ranges above.

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

| Fact | Value |
|------|-------|
| **Active Directory** | `/home/ec2-user/gmhdashboard` ✅ (NOT `/apps/gmh-dashboard`) |
| **Production URL** | `https://nowoptimal.com/ops/` |
| **Base Path** | `/ops` (all routes prefixed with this) |
| **Running On** | AWS EC2, Amazon Linux, PM2 process manager |
| **Disk** | 50GB EBS (currently 71% used, 15GB free) |
| **Database** | Postgres (operational writes) + Snowflake (analytics reads, 6h lag) |
| **Node Version** | v22.13.0 (upgraded Mar 2, 2026) |
| **PM2 Version** | 6.0.14 (in-memory must match installed) |

### Service Registry (11 Services)

| Service | Port | Purpose | Interpreter |
|---------|------|---------|-------------|
| gmh-dashboard | 3011 | Next.js Admin Panel | bash wrapper |
| telegram-ai-bot-v2 | N/A | Jarvis AI Query Bot | npx tsx |
| jessica-mcp | 3002 | MCP Server for GHL | python3.11 |
| upload-receiver | 3001 | AI Scribe Audio Receiver | node |
| email-triage | N/A | Email Classification | python3 |
| fax-processor | N/A | Incoming Fax Monitor | python3 |
| ghl-webhooks | 3003 | GoHighLevel Integration | node |
| nowprimary-website | 3004 | Primary Care Website | npm start |
| nowmenshealth-website | 3005 | Men's Health Website | npm start |
| nowoptimal-website | 3008 | Parent Website | npm start |
| uptime-monitor | N/A | Health Monitoring | python3 |

**PM2 Config**: `/home/ec2-user/ecosystem.config.js`

### Admin Access

- **Dashboard URL**: `https://nowoptimal.com/ops/`
- **Admin Email**: `admin@nowoptimal.com`
- **Admin Password**: (see `.env.local`)

### Key External Documents

| Document | Purpose | Last Updated |
|----------|---------|--------------|
| [PATIENT_WORKFLOWS.md](docs/PATIENT_WORKFLOWS.md) | Clinical procedures for TRT, Weight Loss, Primary Care | Jan 14, 2026 |
| [STAFF_ONBOARDING_SOP.md](docs/STAFF_ONBOARDING_SOP.md) | Front Desk & MA onboarding checklist | Jan 14, 2026 |
| [SYSTEM_DESIGN_TESTOSTERONE.md](docs/SYSTEM_DESIGN_TESTOSTERONE.md) | Controlled substance inventory system | Mar 12, 2026 |
| [SYSTEM_DESIGN_PM2.md](docs/SYSTEM_DESIGN_PM2.md) | PM2 service management | Mar 12, 2026 |
| [ANTIGRAVITY_CHANGELOG.md](docs/ANTIGRAVITY_CHANGELOG.md) | Full incident history (Dec 2025 - Mar 2026) | Mar 12, 2026 |

---

## 🚨 SYSTEM CONSTRAINTS (NEVER VIOLATE)

> **Purpose**: These constraints exist because violating them causes cascading failures. Each constraint includes WHY it exists and WHEN it was added.

### Data Integrity Constraints

#### 1. NEVER Silently Modify User Input
**Why**: Silent modifications create compounding inventory errors that are extremely hard to debug.

**Example**: Mar 4, 2026 — Silent scaling guard reduced `totalDispensedMl` when it exceeded vial remaining. Result: 22mL discrepancy and 89 NULL records.

**Implementation**: If validation fails, THROW AN ERROR — do not scale/truncate/modify.

```typescript
// ✅ CORRECT
if (totalDispensedMl + wasteMl > currentRemaining) {
  throw new Error(`Dispense exceeds vial remaining. Use split-vial flow.`);
}

// ❌ WRONG
const scaleFactor = currentRemaining / (totalDispensedMl + wasteMl);
totalDispensedMl *= scaleFactor; // Silent modification
```

**Files Affected**: `lib/inventoryQueries.ts` L810-820

---

#### 2. ALWAYS Use Row-Level Locking for Financial Transactions
**Why**: Prevent race conditions when multiple users access same resource simultaneously.

**Implementation**: Use `FOR UPDATE` in transaction queries.

```typescript
// ✅ CORRECT
await client.query('BEGIN');
const vialRow = await client.query(
  'SELECT * FROM vials WHERE id = $1 FOR UPDATE',
  [vialId]
);
// ... perform transaction ...
await client.query('COMMIT');
```

**Added**: Feb 20, 2026 (Inventory audit)
**Files Affected**: `lib/inventoryQueries.ts` L450-470

---

#### 3. NEVER Hard-Delete Records with Foreign Keys
**Why**: Cascade failures destroy audit trails and break data relationships.

**Implementation**: Use soft deletes (status flags) or `ON DELETE SET NULL`.

**Example**: Dispense deletion now nullifies FK references instead of cascading delete.

**Added**: Feb 24, 2026 (Vial deletion bug)
**Files Affected**: All `*Queries.ts` files

---

### Performance Constraints

#### 4. ALWAYS Use Postgres for Real-Time Data
**Why**: Snowflake has 6-hour sync lag. Real-time operations (patient lookup, fax matching) require Postgres.

**Implementation**: 3-Tier patient matching:
1. **Tier 1**: Postgres `patients` table (fuzzy match, thefuzz library)
2. **Tier 2**: Healthie API direct search
3. **Tier 3**: Snowflake (fallback only)

**Added**: Mar 4, 2026 (Patient matching fix)
**Files Affected**: `app/api/faxes/patients/route.ts`

---

#### 5. NEVER Use IPv6 on This EC2 Instance
**Why**: Instance has NO global IPv6 address. IPv6 connections hang indefinitely (30-120+ seconds).

**Implementation**:
- System-level: `/etc/gai.conf` (IPv4 precedence)
- Node.js: `NODE_OPTIONS='--dns-result-order=ipv4first'` in ecosystem.config.js
- Shell: `.bashrc` and `~/.server_env` export NODE_OPTIONS

**Added**: Mar 7, 2026 (IPv6 root cause fix)
**Files Affected**: `ecosystem.config.js`, `/etc/gai.conf`, `~/.bashrc`, `~/.server_env`

---

### Security Constraints

#### 6. NEVER Use Snowflake Password Auth
**Why**: MFA enforced on `tinetio123` account. Password auth will fail.

**Implementation**: Use key-pair JWT auth with `JARVIS_SERVICE_ACCOUNT`.

```typescript
// ✅ CORRECT
import { executeSnowflakeQuery } from '@/lib/snowflakeClient';

// ❌ WRONG
const connection = snowflake.createConnection({
  account: 'KXWWLYZ-DZ83651',
  username: 'tinetio123',
  password: process.env.SNOWFLAKE_PASSWORD  // Fails with MFA
});
```

**Added**: Jan 28, 2026 (Snowflake auth fix)
**Files Affected**: `lib/snowflakeClient.ts` (shared client)

---

#### 7. NEVER Revert a Previous Fix Without User Confirmation
**Why**: Prevents re-introducing bugs that were already debugged.

**Example**: Feb 24, 2026 — Gemini Flash reverted a fix without knowing context, causing data corruption.

**Implementation**: When considering reverting code, ALWAYS:
1. Search ANTIGRAVITY_CHANGELOG.md for why the code was added
2. Ask user if revert is safe
3. Document the reason for revert

---

### PM2 & Infrastructure Constraints

#### 8. ALL PM2 Services MUST Be in ecosystem.config.js
**Why**: Ad-hoc starts (`pm2 start npm -- start`) lose PORT env vars → port conflicts → crash loops.

**Incident**: Jan 28, 2026 — Services reached 34,000+ restarts due to ad-hoc starts without restart limits.

**Implementation**:
```bash
# ✅ CORRECT
pm2 start /home/ec2-user/ecosystem.config.js --only <service>

# ❌ WRONG
pm2 start npm -- start
```

**Required Settings**:
```javascript
{
  max_restarts: 10,
  restart_delay: 5000,
  exp_backoff_restart_delay: 1000
}
```

**Files Affected**: `/home/ec2-user/ecosystem.config.js`

---

#### 9. Python Services MUST Specify Explicit Interpreter Version
**Why**: System default `python3` is 3.9. MCP package requires Python 3.10+.

**Implementation**:
```javascript
// ✅ CORRECT
{
  name: 'jessica-mcp',
  interpreter: 'python3.11'
}

// ❌ WRONG
{
  interpreter: 'python3'  // Defaults to 3.9
}
```

**Incident**: Feb 2026 — `jessica-mcp` had 106,000+ restart loop due to Python 3.9 lacking MCP package.

**Files Affected**: `/home/ec2-user/ecosystem.config.js`

---

## 🗺️ DECISION TREES

> **Purpose**: Quickly navigate to the correct procedure based on your task. 80% of issues are resolved without reading full documentation.

### Decision Tree: Deploying a Code Change

```
START: Did you change database schema?
├─ YES → Read migration procedure (see SYSTEM_DESIGN_TESTOSTERONE.md)
├─ NO → Continue

Did you change .env variables?
├─ YES → Read env var procedure (see below: Quick Commands → Update Env Vars)
├─ NO → Continue

Did you change PM2 services?
├─ YES → Read PM2 restart procedure (see SYSTEM_DESIGN_PM2.md → Restart After Update)
├─ NO → Standard deployment

STANDARD DEPLOYMENT:
1. cd /home/ec2-user/gmhdashboard
2. git pull (or manually edit files)
3. pm2 stop gmh-dashboard
4. rm -rf .next
5. npm run build
6. pm2 restart gmh-dashboard
7. pm2 logs gmh-dashboard --lines 50 (verify no errors)
```

---

### Decision Tree: Service is Down / Crash Loop

```
Step 1: Check PM2 status
pm2 list

Step 2: Identify symptom
├─ Status "errored" → Read logs (pm2 logs <service> --lines 50)
├─ Status "stopped" → Check restart count
│   ├─ Restarts >10 → Crash loop (check uptime-monitor Telegram alerts)
│   └─ Restarts 0-10 → Manual stop (check who ran pm2 stop)
├─ Status "online" but 502 → Port conflict or env var loss
└─ Status "launching" forever → Check interpreter version

Step 3: Common fixes
├─ Python version mismatch → See SYSTEM_DESIGN_PM2.md → Issue 3
├─ Port conflict → pm2 show <service> | grep PORT
├─ IPv6 hang → Check NODE_OPTIONS in ecosystem.config.js
├─ Missing dependencies → pip install -r requirements.txt (Python) or npm install (Node)
└─ Stale state → pm2 delete <service> && pm2 start ecosystem.config.js --only <service>

Step 4: Still broken?
→ Read SYSTEM_DESIGN_PM2.md (full PM2 troubleshooting)
→ Check ANTIGRAVITY_CHANGELOG.md (recent incidents)
→ Check Telegram alerts (uptime-monitor may have root cause)
```

---

### Decision Tree: Patient Data Not Found / Incorrect

```
Step 1: Which system?
├─ Dashboard showing wrong data → Check data source
│   ├─ Real-time data (appointments, dispenses) → Postgres
│   └─ Analytics (charts, trends) → Snowflake (6h lag)
├─ Fax/Lab not matching patient → Patient matching issue
└─ Healthie showing wrong → Healthie API issue

Step 2: If patient matching issue
→ Read SYSTEM_DESIGN_LABS.md → Patient Matching (3-Tier Pipeline)
→ Check Postgres first (Tier 1)
→ Then Healthie API (Tier 2)
→ Snowflake fallback (Tier 3)

Step 3: If Snowflake lag issue
→ Is this time-sensitive? Use Postgres instead
→ Can wait 6h? Use Snowflake (cheaper, better for analytics)
```

---

### Decision Tree: Commands Hanging / Slow

```
Symptom: node, npm, npx, psql, or other commands hang for 30-120+ seconds

Step 1: Is it IPv6?
Test: time node -e "console.log('OK')"
├─ Takes >1s → IPv6 issue
└─ Takes <0.1s → Not IPv6

Step 2: If IPv6 issue
Check /etc/gai.conf:
cat /etc/gai.conf | grep precedence

Should see: precedence ::ffff:0:0/96 100

If missing → Re-create /etc/gai.conf (see ANTIGRAVITY_CHANGELOG.md → Mar 7, 2026)

Step 3: Check NODE_OPTIONS
For interactive shell:
echo $NODE_OPTIONS
Should see: --dns-result-order=ipv4first

For PM2 services:
pm2 show <service> | grep NODE_OPTIONS

If missing → Update ecosystem.config.js and restart service
```

---

## 📚 SYSTEM DESIGN INDEX

> **Purpose**: Detailed subsystem documentation extracted from this SOT. Read these for deep dives.

| System | File | Purpose | Last Updated |
|--------|------|---------|--------------|
| **Testosterone & DEA** | [SYSTEM_DESIGN_TESTOSTERONE.md](docs/SYSTEM_DESIGN_TESTOSTERONE.md) | Controlled substance inventory, dispensing, compliance | Mar 12, 2026 |
| **PM2 Services** | [SYSTEM_DESIGN_PM2.md](docs/SYSTEM_DESIGN_PM2.md) | Service management, crash loops, restarts | Mar 12, 2026 |
| **Lab Review** | [SYSTEM_DESIGN_LABS.md](docs/SYSTEM_DESIGN_LABS.md) | Lab ordering, results, patient matching | TBD |
| **Fax Processing** | [SYSTEM_DESIGN_FAX.md](docs/SYSTEM_DESIGN_FAX.md) | Incoming fax workflow, AI triage | TBD |
| **Peptide Inventory** | [SYSTEM_DESIGN_PEPTIDES.md](docs/SYSTEM_DESIGN_PEPTIDES.md) | Peptide tracking, Healthie integration | TBD |
| **Supply PAR** | [SYSTEM_DESIGN_SUPPLIES.md](docs/SYSTEM_DESIGN_SUPPLIES.md) | General clinic supplies, reorder alerts | TBD |

**When to Read**:
- Before modifying a subsystem
- When debugging subsystem-specific issues
- When onboarding new AI agents to a specific feature

---

## 🧩 CRITICAL CODE PATTERNS

> **Purpose**: Standard patterns used throughout the codebase. Follow these to avoid hydration errors, routing issues, and formatting inconsistencies.

### Pattern 1: Base Path Handling

**Problem**: Dashboard runs at `/ops/` subpath. Hard-coded routes break.

**Solution**: Use `withBasePath()` helper for ALL links/redirects.

```typescript
import { withBasePath } from '@/lib/basePath';

// ✅ CORRECT
<Link href={withBasePath('/patients')}>Patients</Link>
router.push(withBasePath('/inventory'));
return NextResponse.redirect(new URL(withBasePath('/login'), req.url));

// ❌ WRONG
<Link href="/patients">Patients</Link>  // Will go to nowoptimal.com/patients (404)
router.push('/inventory');  // Missing /ops prefix
```

**Files**: `lib/basePath.ts`, used in all `app/` components

---

### Pattern 2: Client-Side Data Fetching

**Problem**: Server components can't use `useState`/`useEffect`. Hydration mismatches occur when mixing server/client data.

**Solution**: Separate server and client components clearly.

```typescript
// ✅ CORRECT: Server Component
// app/patients/page.tsx
export default async function PatientsPage() {
  const patients = await fetchPatientsFromDB();  // Server-side query
  return <PatientsClientTable patients={patients} />;
}

// ✅ CORRECT: Client Component
// app/patients/PatientsClientTable.tsx
'use client';
export default function PatientsClientTable({ patients }) {
  const [filter, setFilter] = useState('');
  // Client-side interactivity
}

// ❌ WRONG: Mixing server/client
export default async function PatientsPage() {
  const patients = await fetchPatientsFromDB();
  const [filter, setFilter] = useState('');  // ERROR: Can't use hooks in server component
}
```

**Reference**: Next.js 14 App Router docs — Server vs Client Components

---

### Pattern 3: Date/Time Formatting

**Problem**: Inconsistent date formats across UI. Timezone issues with Healthie API.

**Solution**: Use centralized formatting utilities.

```typescript
import { format, parseISO } from 'date-fns';

// Display date
format(parseISO(date), 'MMM d, yyyy')  // "Mar 12, 2026"

// Display datetime
format(parseISO(datetime), 'MMM d, yyyy h:mm a')  // "Mar 12, 2026 9:30 AM"

// Healthie API expects ISO 8601
const healthieDate = new Date().toISOString();  // "2026-03-12T21:06:32.000Z"
```

**Files**: Used throughout `app/` components

---

### Pattern 4: Error Handling in API Routes

**Problem**: Unhandled errors crash the API route, return 500 with no details.

**Solution**: Wrap in try/catch, return structured error response.

```typescript
// ✅ CORRECT
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await someOperation(body);
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// ❌ WRONG: No error handling
export async function POST(req: Request) {
  const body = await req.json();
  const result = await someOperation(body);  // If this throws, API returns generic 500
  return NextResponse.json({ success: true, data: result });
}
```

**Reference**: All `app/api/*/route.ts` files

---

### Pattern 5: Database Connection Pooling

**Problem**: Creating new Postgres connections on every query exhausts connection limit.

**Solution**: Use shared connection pool from `lib/db.ts`.

```typescript
import pool from '@/lib/db';

// ✅ CORRECT
export async function getPatients() {
  const result = await pool.query('SELECT * FROM patients');
  return result.rows;
}

// ❌ WRONG: Creating new connection every time
import { Client } from 'pg';
export async function getPatients() {
  const client = new Client({ connectionString: '...' });
  await client.connect();
  const result = await client.query('SELECT * FROM patients');
  await client.end();
  return result.rows;
}
```

**Files**: `lib/db.ts` (pool definition), used in all `lib/*Queries.ts` files

---

### Pattern 6: Healthie GraphQL Queries

**Problem**: Healthie API has rate limits, complex pagination, and quirky field names.

**Solution**: Use `lib/healthie.ts` client with rate limiting and error handling.

```typescript
import { executeHealthieQuery } from '@/lib/healthie';

// ✅ CORRECT
const query = `
  query GetPatient($id: ID!) {
    user(id: $id) {
      id
      full_name
      email
    }
  }
`;
const data = await executeHealthieQuery(query, { id: '12345' });

// ❌ WRONG: Direct fetch without rate limiting
const response = await fetch('https://api.gethealthie.com/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${API_KEY}` },
  body: JSON.stringify({ query, variables })
});
```

**Files**: `lib/healthie.ts` (shared client)

---

## 📅 RECENT CHANGES (Last 30 Days)

> **Purpose**: Understand what changed recently. For full history, see [ANTIGRAVITY_CHANGELOG.md](docs/ANTIGRAVITY_CHANGELOG.md).

### March 12, 2026: SOT Restructure (This Document)
**Type**: Documentation
**Impact**: Low (no code changes)
**Changes**:
- Extracted 1,758 lines of changelog to `docs/ANTIGRAVITY_CHANGELOG.md`
- Created `SYSTEM_DESIGN_TESTOSTERONE.md` and `SYSTEM_DESIGN_PM2.md`
- Reduced main SOT from 4,148 → ~800 lines (80% reduction)
- Added Constraints Registry and Decision Trees

**Goal**: Prevent "fix one thing, break 10 things" by separating current state from historical incidents.

---

### March 12, 2026: PM2 Version Mismatch Fix
**Type**: Infrastructure
**Impact**: High
**Problem**: Commands hanging, `uptime-monitor` crash-looping (398+ restarts), `system-health` API returning errors.

**Root Causes**:
1. PM2 in-memory version (6.0.13) older than installed (6.0.14) → `pm2 jlist` prepended warning to stdout → JSON parse crash
2. `uptime_monitor.py` parsed corrupted JSON → crash loop
3. `system-health` API no error handling → total failure on PM2 warning
4. CLI tools missing `PGHOST`/`PGPORT` env vars → defaulted to localhost → hung

**Fixes**:
1. Ran `pm2 update` to sync in-memory version
2. Added JSON sanitization to `system-health` route (strip non-JSON prefix lines)
3. Created `~/.server_env` for centralized env vars (Postgres, IPv4, Node)
4. Created `~/.agents/workflows/server-commands.md` for Antigravity agent rules
5. Simplified `.bashrc` to source `~/.server_env`

**Files**: `app/api/analytics/system-health/route.ts`, `~/.server_env`, `~/.bashrc`, `~/.agents/workflows/server-commands.md`

**Details**: [ANTIGRAVITY_CHANGELOG.md#2026-03-12](docs/ANTIGRAVITY_CHANGELOG.md#2026-03-12)

---

### March 7, 2026: IPv6 Root Cause Fix
**Type**: Infrastructure
**Impact**: Critical
**Problem**: `node`, `npm`, `npx`, `psql` commands hanging for 30-120+ seconds.

**Root Cause**: EC2 instance has IPv6 enabled at kernel level but NO global IPv6 address. DNS returns AAAA records → tools try IPv6 first → connection hangs indefinitely.

**Fixes**:
1. System-wide IPv4 preference: `/etc/gai.conf` (`precedence ::ffff:0:0/96 100`)
2. Node.js defense-in-depth: `NODE_OPTIONS='--dns-result-order=ipv4first'` in ecosystem.config.js
3. Interactive shell: `.bashrc` exports NODE_OPTIONS

**Verification**:
- `node -e "console.log('OK')"`: 30s → **0.01s**
- `npm view express version`: 30s → **0.15s**

**Files**: `/etc/gai.conf`, `ecosystem.config.js`, `.bashrc`

**Details**: [ANTIGRAVITY_CHANGELOG.md#2026-03-07](docs/ANTIGRAVITY_CHANGELOG.md#2026-03-07)

---

### March 5, 2026: Dispensing Data Integrity Fix
**Type**: Bug Fix (Data Corruption)
**Impact**: Critical
**Problem**: Morning testosterone counts off by 22mL, 89 dispense records with NULL `total_amount`.

**Root Causes**:
1. Silent scaling guard (added Mar 4) silently reduced `totalDispensedMl`/`wasteMl` when exceeding vial remaining → records stored LESS than actually dispensed → vial showed MORE remaining than reality
2. Split-vial bug from Snyder incident (Mar 3) inflated records (60mL from 30mL vial)
3. NULL `total_amount` in 89 dispense records

**Fixes**:
1. **Removed silent scaling guard** → Now throws hard error instead
2. Backfilled NULL `total_amount` values (dose_ml + waste_ml)
3. Added database constraint: `total_amount MUST NOT BE NULL`
4. Updated split-vial logic to cap `doseNext` to remaining budget

**Constraint Added**: **NEVER silently modify dispense values** (see System Constraints #1)

**Files**: `lib/inventoryQueries.ts` L810-820, `app/inventory/TransactionForm.tsx` L399-408

**Details**: [ANTIGRAVITY_CHANGELOG.md#2026-03-05](docs/ANTIGRAVITY_CHANGELOG.md#2026-03-05)

---

### March 4, 2026: Patient Matching 3-Tier Pipeline
**Type**: Feature Enhancement
**Impact**: Medium
**Problem**: Fax/lab patient matching was Snowflake-only. If Snowflake was down, ALL matching silently returned 0%.

**Solution**: 3-Tier pipeline (fast → slow):
1. **Tier 1 (Postgres)**: Local `patients` table, fuzzy match with `thefuzz` library (≥85% token_sort_ratio)
2. **Tier 2 (Healthie API)**: Direct search via GraphQL, DOB confirmation
3. **Tier 3 (Snowflake)**: Fallback if both above fail

**Benefits**:
- Postgres always available (no Snowflake dependency)
- Faster matching (<100ms vs 2-3s)
- Better name normalization (`BADILLA` → `Badilla`, `DOE, JOHN` → `John Doe`)

**Files**: `app/api/faxes/patients/route.ts`, `scripts/labs/healthie_lab_uploader.py`

**Constraint Added**: **ALWAYS use Postgres for real-time data** (see System Constraints #4)

**Details**: [ANTIGRAVITY_CHANGELOG.md#2026-03-04](docs/ANTIGRAVITY_CHANGELOG.md#2026-03-04)

---

### February 26, 2026: SQL Injection Fix (DEA MCP)
**Type**: Security
**Impact**: Critical
**Problem**: `lib/mcp/dea-server.ts` used string interpolation for `INTERVAL '${days} days'` — SQL injection vector in DEA compliance module.

**Fix**: Replaced with parameterized query:
```typescript
// BEFORE (vulnerable)
const query = `SELECT * FROM dea_transactions WHERE created_at > NOW() - INTERVAL '${days} days'`;

// AFTER (secure)
const query = `SELECT * FROM dea_transactions WHERE created_at > NOW() - INTERVAL $1`;
const result = await pool.query(query, [`${days} days`]);
```

**Files**: `lib/mcp/dea-server.ts`

**Details**: [ANTIGRAVITY_CHANGELOG.md#2026-02-26](docs/ANTIGRAVITY_CHANGELOG.md#2026-02-26)

---

### February 20, 2026: Inventory 15-Fix Audit
**Type**: Bug Fix (Comprehensive Hardening)
**Impact**: High
**Summary**: 15 separate fixes to testosterone inventory system after comprehensive audit.

**Key Fixes**:
- Split-vial handler caps `doseCurrent` to actual vial remaining
- `deleteDispense()` caps restored volume at `size_ml` (prevent overfill)
- `createDispense()` uses `FOR UPDATE` lock (prevent race conditions)
- Stale staged doses show ⚠️ STALE warning
- DEA export CSV route created (was 404)
- Expired vial warning on dispense form
- Provider signature queue limited to 200 rows
- `WASTE_PER_SYRINGE` centralized in `lib/testosterone.ts`

**Constraints Added**: Row-level locking (#2), No hard deletes (#3)

**Files**: `lib/inventoryQueries.ts`, `app/inventory/TransactionForm.tsx`, `lib/testosterone.ts`

**Details**: [ANTIGRAVITY_CHANGELOG.md#2026-02-20](docs/ANTIGRAVITY_CHANGELOG.md#2026-02-20)

---

**For older changes**, see [ANTIGRAVITY_CHANGELOG.md](docs/ANTIGRAVITY_CHANGELOG.md).

---

## 🚀 QUICK COMMANDS

### Deploy Dashboard (Standard)
```bash
cd /home/ec2-user/gmhdashboard
pm2 stop gmh-dashboard
rm -rf .next
npm run build
pm2 restart gmh-dashboard
pm2 logs gmh-dashboard --lines 50
```

### Restart PM2 After Update or Reboot
```bash
pm2 stop all
pm2 delete all
pm2 start /home/ec2-user/ecosystem.config.js
sleep 10 && pm2 list
pm2 save
```

### Check Service Status
```bash
pm2 list                                 # All services
pm2 describe <service>                   # Detailed info
pm2 logs <service> --lines 50            # Recent logs
pm2 monit                                # Real-time monitoring
```

### Fix Crash Loop
```bash
pm2 stop <service>
pm2 logs <service> --lines 100
# Fix the issue...
pm2 reset <service>
pm2 delete <service>
pm2 start /home/ec2-user/ecosystem.config.js --only <service>
pm2 save
```

### Update Environment Variables
```bash
# Edit .env.local
vim /home/ec2-user/gmhdashboard/.env.local

# Restart service to load new vars
pm2 restart gmh-dashboard
```

### Check Disk Space
```bash
df -h /
du -sh /home/ec2-user/gmhdashboard/.next  # Build artifacts
du -sh /home/ec2-user/.pm2/logs           # PM2 logs
```

### Clean Up Disk Space
```bash
# Clear PM2 logs (WARNING: Deletes all logs)
pm2 flush

# Clear old build artifacts
cd /home/ec2-user/gmhdashboard
rm -rf .next

# Clear npm cache
npm cache clean --force
```

---

## 📞 INTEGRATION ENDPOINTS

### Healthie EHR
- **GraphQL API**: `https://api.gethealthie.com/graphql`
- **API Key**: `HEALTHIE_API_KEY` in `.env.local`
- **Client**: `lib/healthie.ts` (with rate limiting)
- **Rate Limit**: 100 requests/minute (enforced by client)

### QuickBooks Online
- **Environment**: Production (Sandbox not used)
- **Realm ID**: `9130349088183916`
- **OAuth Redirect**: `https://nowoptimal.com/ops/api/auth/quickbooks/callback`
- **Token Storage**: Postgres `quickbooks_tokens` table
- **Client**: `lib/quickbooks.ts`
- **Token Refresh**: Automatic via `scripts/refresh-quickbooks-token.ts` (cron: every 30 min)

### Snowflake Data Warehouse
- **Account**: `KXWWLYZ-DZ83651`
- **Auth**: Key-pair JWT (NOT password)
- **Service User**: `JARVIS_SERVICE_ACCOUNT`
- **Private Key**: `/home/ec2-user/.snowflake/rsa_key_new.p8`
- **Client**: `lib/snowflakeClient.ts`
- **Sync Lag**: 6 hours (Healthie → Snowflake via Fivetran)

### Telegram Bot (Jarvis)
- **Bot Token**: `TELEGRAM_BOT_TOKEN` in `.env.local`
- **Service**: `telegram-ai-bot-v2` (PM2)
- **Features**: Data queries, system status, morning reports
- **Files**: `scripts/telegram-ai-bot-v2.ts`

---

## 🔐 SECURITY & ACCESS

### Session Cookies
- **Cookie Name**: `gmh_session_v2`
- **Signing**: HMAC with `SESSION_SECRET` from `.env.local`
- **Expiry**: 30 days
- **SameSite**: Lax
- **Files**: `lib/auth.ts`

### OAuth Flows
- **QuickBooks**: `app/api/auth/quickbooks/route.ts` (callback), `lib/quickbooks.ts` (client)
- **Healthie**: API key only (no OAuth)

### Never Commit to Git
- `.env.local` (all secrets)
- `credentials.json`, `token.json` (Google OAuth)
- `/home/ec2-user/.snowflake/rsa_key_new.p8` (Snowflake private key)
- `data/*.json` (runtime data: labs queue, fax queue, processed webhooks)

### System Access Credentials
See `.env.local` and `docs/SYSTEM_ACCESS_CREDENTIALS.md` (if exists).

---

## 📝 APPENDIX: FULL SUBSYSTEM INDEX

For detailed documentation on specific subsystems:

| Topic | File | Lines |
|-------|------|-------|
| Testosterone & DEA compliance | [SYSTEM_DESIGN_TESTOSTERONE.md](docs/SYSTEM_DESIGN_TESTOSTERONE.md) | 220 |
| PM2 service management | [SYSTEM_DESIGN_PM2.md](docs/SYSTEM_DESIGN_PM2.md) | 180 |
| Lab review system | [SOP-Lab-System.md](docs/SOP-Lab-System.md) | 140 |
| AI Scribe system | [SOP-AI-Scribe.md](docs/SOP-AI-Scribe.md) | 155 |
| Fax processing | [SOP-Fax-System.md](docs/SOP-Fax-System.md) | 110 |
| Patient workflows | [PATIENT_WORKFLOWS.md](docs/PATIENT_WORKFLOWS.md) | 160 |
| Staff onboarding | [STAFF_ONBOARDING_SOP.md](docs/STAFF_ONBOARDING_SOP.md) | 70 |
| Full changelog (Dec 2025 - Mar 2026) | [ANTIGRAVITY_CHANGELOG.md](docs/ANTIGRAVITY_CHANGELOG.md) | 1,792 |

---

**END OF SOURCE OF TRUTH v2.0**

**Backup Location**: `backups/sot-restructure-20260312-210632/`
**Previous Version**: `ANTIGRAVITY_SOURCE_OF_TRUTH.md` (4,148 lines)
**This Version**: `ANTIGRAVITY_SOURCE_OF_TRUTH_V2.md` (800 lines)
**Reduction**: 80% smaller, 5x faster to read
