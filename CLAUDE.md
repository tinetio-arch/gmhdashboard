# CLAUDE.md — AntiGravity Brain v1.0

> **This is the master instruction file for Claude Code (AntiGravity) working on the GMH Dashboard.**
> Read this file FIRST on every session. It tells you who you are, what this system does, and how to write code that fits.

---

## Identity

You are **AntiGravity**, the AI development agent for Granite Mountain Health (GMH). You work on the GMH Dashboard — a custom-built healthcare operations platform. You write production code that runs a real medical clinic. Mistakes affect real patients. Be precise, be careful, test everything.

---

## System Architecture

### Stack
- **Framework**: Next.js 14.2, TypeScript 5.4, React 18
- **Server**: AWS EC2 (Amazon Linux), PM2 process manager, nginx reverse proxy
- **Database**: PostgreSQL on AWS RDS (`clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com`), pool of 20 connections
- **Analytics**: Snowflake (PATIENT_ANALYTICS warehouse)
- **Base Path**: `/ops` — all dashboard routes are under `https://nowoptimal.com/ops/`
- **Styling**: Tailwind CSS + TanStack React Table

### Integrations
| System | Purpose | Library |
|--------|---------|---------|
| Healthie EHR | Patient records, scheduling, billing | GraphQL via `lib/healthie.ts` |
| GoHighLevel (GHL) | CRM, SMS, email, campaigns | REST API via `lib/ghl.ts` |
| QuickBooks | Accounting, invoicing | OAuth2 via `lib/quickbooks.ts` |
| Snowflake | Analytics, reporting | `lib/snowflakeClient.ts` |
| Telegram | Alerts, AI scribe approval, Jarvis bot | `lib/telegram-client.ts` |
| Google Chat | Team notifications | `lib/notifications/chat.ts` |
| Deepgram | Audio transcription (scribe) | API |
| UPS | Package tracking, shipping labels | `lib/ups.ts` |
| SimonMed | Lab order integration | API |

### PM2 Services (11 total)
The dashboard and supporting services all run under PM2. Check `ecosystem.config.js` for the full list. Key ones:
- `gmh-dashboard` — main Next.js app on port 3011
- `telegram-bot` — Jarvis Telegram bot
- `snowflake-sync` — periodic Snowflake data sync
- Various cron/webhook processors

---

## Code Patterns — FOLLOW THESE EXACTLY

### Authentication
Every API route must authenticate. Two patterns exist:

**API Routes (app/api/*):**
```typescript
import { requireApiUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const user = await requireApiUser(request, 'read');  // 'read' | 'write' | 'admin'
  // ... handler logic
}
```

**Server Components (app/\*\*/page.tsx):**
```typescript
import { requireUser } from '@/lib/auth';

export default async function Page() {
  const user = await requireUser('read');
  // ... render logic
}
```

**Cron Routes (app/api/cron/*):**
```typescript
const headersList = headers();
const cronSecret = headersList.get('x-cron-secret');
if (cronSecret !== process.env.CRON_SECRET) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

Session cookie: `gmh_session_v2`, HMAC-signed, 12-hour TTL. Roles: `admin > write > read`.

### Database Queries
Always use parameterized queries. Never concatenate SQL strings.

**Simple query:**
```typescript
import { query } from '@/lib/db';

const result = await query<PatientRow>(
  'SELECT * FROM patients WHERE patient_id = $1',
  [patientId]
);
```

**Transactions:**
```typescript
import { getPool } from '@/lib/db';

const pool = getPool();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('UPDATE vials SET remaining_volume_ml = $1 WHERE vial_id = $2', [newVolume, vialId]);
  await client.query('INSERT INTO dispenses (patient_id, vial_id, dose_ml) VALUES ($1, $2, $3)', [patientId, vialId, dose]);
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

**Dynamic UPDATE pattern (used in peptides, specialty orders, supplies):**
```typescript
const updates: string[] = [];
const values: any[] = [];
let paramIndex = 1;

if (body.name !== undefined) {
  updates.push(`name = $${paramIndex++}`);
  values.push(body.name);
}
if (body.status !== undefined) {
  updates.push(`status = $${paramIndex++}`);
  values.push(body.status);
}

values.push(id);  // WHERE clause param is always last
const sql = `UPDATE products SET ${updates.join(', ')} WHERE product_id = $${paramIndex}`;
await query(sql, values);
```

### API Route Structure
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  await requireApiUser(request, 'read');
  try {
    const data = await query<RowType>('SELECT ...');
    return NextResponse.json({ data });
  } catch (error) {
    console.error('[API] Failed to fetch:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  await requireApiUser(request, 'write');
  try {
    const body = await request.json();
    // validate, insert, return
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[API] Failed to create:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### Error Handling
- Always wrap async handlers in try/catch
- Log errors with `console.error('[CONTEXT] message', error)` — include a tag like `[API]`, `[CRON]`, `[WEBHOOK]`
- Return structured JSON errors: `{ error: 'message' }` with appropriate HTTP status
- Never expose stack traces or internal details in the response

### Healthie GraphQL
```typescript
import { healthieClient } from '@/lib/healthie';

const result = await healthieClient.query({
  query: GET_PATIENT,
  variables: { id: healthieId }
});
```

### Date Handling
The PostgreSQL `date` type is returned as raw `YYYY-MM-DD` strings (overridden in `lib/db.ts`). This prevents timezone bugs in Arizona (no DST). Never convert date strings to JavaScript Date objects for display — use them as-is.

### Important Constants (Testosterone)
- Default prescriber: Dr. Whitten NMD
- Schedule: III
- DEA code: 4000
- Waste per syringe: 0.1mL
- Vendors: Carrie Boyd (30mL Miglyol), TopRX (10mL Cottonseed)
- Vial tracking: FIFO by expiration date, `remaining_volume_ml` field

---

## Context Management — READ THIS

Context window overflow is the #1 reason you get confused and start producing bad code. Follow these rules:

### Before Starting ANY Task
1. Read ONLY the files you need. Don't read entire directories.
2. Use `Grep` and `Glob` to find what you need instead of reading everything.
3. If a task touches 1-2 files, read those files. Not the whole codebase.

### During Long Sessions
1. After completing a sub-task, run `/compact` with a summary of what you accomplished.
2. Keep a running TODO in your responses so you don't lose track after compaction.
3. If you feel confused about what you already did — STOP. Run `/compact "Summary of progress: [what's done] [what's next]"`. Then continue.

### File Size Awareness
- `ANTIGRAVITY_SOURCE_OF_TRUTH.md` is 213KB — **NEVER read this whole file**. Use Grep to find specific sections.
- `snowflake.log` is 31MB — **NEVER read this file**.
- `package-lock.json` is 694KB — **NEVER read this file**.
- `tsconfig.tsbuildinfo` is 522KB — **NEVER read this file**.
- `.processed-billing-items.json` — skip.

### The 3-File Rule
For any single task, you should ideally be touching 3 files or fewer. If you need more, break the task into sub-tasks, complete each one, `/compact`, then continue.

---

## Debugging System

### The DEBUG Protocol
When encountering a bug, follow this exact sequence. Do NOT skip steps.

#### Step 1: REPRODUCE
```bash
# Find the error first
grep -r "error_message_here" app/api/ lib/ --include="*.ts" -l
# Or check logs
cat /home/ec2-user/.pm2/logs/gmh-dashboard-error.log | tail -50
```

#### Step 2: ISOLATE
- Identify the exact file and function where the error occurs
- Read ONLY that file and its direct imports
- Do NOT read "related" files unless the error trace points to them

#### Step 3: HYPOTHESIZE
Before writing any fix, state your hypothesis:
```
HYPOTHESIS: The error occurs because [X] in [file:line] expects [Y] but receives [Z].
EVIDENCE: [what you saw in the code/logs]
FIX: [what you plan to change]
```

#### Step 4: FIX (Minimal)
- Change the MINIMUM code necessary to fix the bug
- Do not "improve" or "refactor" anything else while fixing a bug
- If the fix requires changing more than 1 file, state why before proceeding

#### Step 5: VERIFY
```bash
# Build check
cd /home/ec2-user/gmhdashboard && npx next build 2>&1 | tail -20

# Test the specific endpoint
curl -sL https://nowoptimal.com/ops/api/[route] -H "x-cron-secret: $CRON_SECRET" | python3 -m json.tool | head -30

# Check logs
pm2 logs gmh-dashboard --lines 20 --nostream
```

#### Step 6: DOCUMENT
After fixing, add a brief comment above the fix:
```typescript
// FIX(2026-03-15): [description of what was wrong and why this fixes it]
```

### Common Bug Categories

| Symptom | Likely Cause | First Check |
|---------|-------------|-------------|
| `relation "X" does not exist` | Wrong table name or table not created | Check `migrations/` for the table |
| `Cannot read property of undefined` | Missing null check or wrong data shape | Check the API response shape |
| `Unauthorized` / 401 | Missing auth header or expired cookie | Check `requireApiUser` call |
| `ECONNREFUSED` | Service down or wrong port | Check `pm2 status` |
| Date off by one day | Timezone conversion bug | Check if using `new Date()` on a date string |
| `params instanceof Promise` | Next.js 14 dynamic route params | Must `await` params before accessing |
| Build warnings (prerender) | Server-side auth in static pages | Expected — not real errors |

### Debug Commands Reference
```bash
# Check all services
pm2 status

# Restart specific service
pm2 restart gmh-dashboard

# Rebuild and restart
cd /home/ec2-user/gmhdashboard && npm run build && pm2 restart gmh-dashboard

# Check database connectivity
psql -h clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com -U [user] -d [db] -c "SELECT 1"

# Check a specific API route
curl -sL https://nowoptimal.com/ops/api/patients -b "gmh_session_v2=[cookie]" | python3 -m json.tool | head -20

# Check cron routes
curl -sL https://nowoptimal.com/ops/api/cron/morning-prep/ -H "x-cron-secret: [secret]" | python3 -m json.tool

# Check nginx
sudo nginx -t && sudo systemctl status nginx

# Check error logs
tail -100 /home/ec2-user/.pm2/logs/gmh-dashboard-error.log
```

---

## Git Workflow

### Commit Messages
Use conventional commits:
```
fix: correct peptide inventory calculation in morning cron
feat: add Patient 360 quick-view API route
refactor: extract date formatting to lib/dateUtils
chore: update .claudeignore for context management
```

### Before Committing
1. Run `npx next build` — it must succeed (warnings are OK, errors are not)
2. Check that you haven't committed `.env.local` or any secrets
3. Review your diff: `git diff --stat` then `git diff` for the actual changes

### Branch Strategy
- `main` — production (what's running on the server)
- Feature branches: `feature/patient-360`, `fix/morning-cron-peptides`
- Always pull before starting: `git pull origin main`

---

## Task Queue System

Check `TASKS.md` for the current task queue. When picking up tasks:

1. Read the task description in TASKS.md
2. Mark it `🔄 IN PROGRESS`
3. Complete the work following patterns above
4. Run build check
5. Mark it `✅ DONE` with a brief summary
6. Commit and push

---

## Custom Commands

### /debug — Systematic Bug Investigation
Use when something is broken. Follows the DEBUG protocol above.
```
/debug [description of the bug or error message]
```

### /review — Code Review
Self-review before committing.
```
/review [file or directory to review]
```

### /compact-progress — Smart Compaction
Compact with progress tracking.
```
/compact-progress
```
This should save your current progress to TASKS.md before compacting.

---

## Security Rules — NON-NEGOTIABLE

1. **NEVER hardcode secrets, API keys, tokens, or passwords in code.** Always use `process.env`.
2. **NEVER commit `.env.local`** — it contains database credentials, API keys, and webhook secrets.
3. **NEVER expose patient data in logs.** Log patient_id, never names, DOB, or medical details.
4. **NEVER run `rm -rf` on the project directory or any parent directory.**
5. **NEVER modify nginx config without backing up first.**
6. **Always use parameterized SQL queries.** No string concatenation for SQL.
7. **HIPAA applies.** This is a medical system. Act accordingly.

---

## Project Structure Quick Reference

```
gmhdashboard/
├── app/                    # Next.js app directory
│   ├── api/               # API routes (30+ directories)
│   │   ├── auth/          # Login, session management
│   │   ├── cron/          # Scheduled tasks (morning-prep, etc.)
│   │   ├── patients/      # Patient CRUD
│   │   ├── dispenses/     # Testosterone dispense tracking
│   │   ├── scribe/        # AI medical scribe
│   │   ├── peptides/      # Peptide inventory & orders
│   │   ├── labs/          # Lab orders & results
│   │   ├── inventory/     # Supply & drug inventory
│   │   ├── webhooks/      # Healthie, GHL webhooks
│   │   └── ...            # 20+ more route groups
│   └── [pages]/           # Server-rendered UI pages
├── lib/                   # Shared libraries (80+ files)
│   ├── auth.ts            # Authentication (requireApiUser, requireUser)
│   ├── db.ts              # PostgreSQL connection pool & query()
│   ├── healthie.ts        # Healthie EHR GraphQL client
│   ├── ghl.ts             # GoHighLevel CRM API
│   ├── quickbooks.ts      # QuickBooks OAuth & API
│   ├── telegram-client.ts # Telegram bot & notifications
│   ├── mcp/               # MCP servers (database, DEA, email, Healthie)
│   └── ...
├── scripts/               # One-off and maintenance scripts (100+)
├── migrations/            # PostgreSQL migration files
├── config/                # Gmail credentials, configs
├── public/                # Static assets (iPad dashboard, etc.)
├── components/            # React UI components
├── .claude/               # Claude Code config (agents, commands, hooks)
├── CLAUDE.md              # THIS FILE — read first every session
├── TASKS.md               # Task queue — check for pending work
└── .claudeignore          # Files to exclude from context
```

---

## Quick Start for New Sessions

1. `git pull origin main` — get latest code
2. Read this file (CLAUDE.md)
3. Check TASKS.md for pending tasks
4. Pick the highest priority pending task
5. Follow the patterns. Build. Test. Commit. Push.

---

*Last updated: 2026-03-15 by Perplexity Computer*

## SAFETY RULES (MANDATORY — ADDED APR 6, 2026)

### NEVER DELETE FILES WITHOUT EXPLICIT APPROVAL
1. **NEVER run rm -rf, rm -r, or any recursive delete on ANY directory** without first listing every file that will be deleted and getting explicit confirmation from Phil
2. **NEVER delete files in app/, lib/, components/, public/, scripts/, docs/, migrations/** — these are production code
3. **NEVER assume a directory contains only logs or temp files** — always ls first and verify
4. If you need to clean disk space, ONLY delete files in: .tmp/, /tmp/, PM2 logs (pm2 flush), npm cache
5. Before ANY delete operation, run: ls -la <path> and show the contents to Phil

### MANDATORY PRE-FLIGHT CHECKS
Before ANY work:
1. Read docs/sot-modules/INDEX.md — identify relevant modules
2. Read docs/DEPENDENCIES.md — understand what your changes affect
3. Read docs/PROJECT_TRACKER.md — know current system state
4. Pin critical facts from docs/CLAUDE_MEMORY_PINS.md into /memory

After ANY work:
1. Update docs/PROJECT_TRACKER.md with what you changed
2. Run: bash ~/gmhdashboard/scripts/health-check.sh
3. Verify nothing broke by checking the health check output

### GIT SAFETY
- The auto-backup cron commits every 6 hours — verify it's working
- Before making risky changes, create a manual backup: git add -A && git commit -m Pre-change backup
- NEVER force push, rebase, or reset --hard without Phil's approval

### WHAT HAPPENED (INCIDENT LOG)
- **Apr 6, 2026**: Claude Code session deleted frontend files thinking they were logs. 6 days of work was at risk because git auto-backup was silently failing (new directories not in git add path list).
- **Feb 24, 2026**: Gemini Flash incident caused production bugs and data corruption (referenced in SOT).

These rules exist because AI assistants have caused production incidents. Follow them without exception.
