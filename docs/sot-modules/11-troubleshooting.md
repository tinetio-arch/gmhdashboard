
> **CRITICAL**: The staff app exists in TWO locations that MUST stay in sync:
> - **iPad**: `public/ipad/app.js` + `public/ipad/style.css` → served at `nowoptimal.com/ops/ipad/`
> - **Mobile**: `public/mobile/app.js` + `public/mobile/style.css` → served at `nowoptimal.com/mobile/`
>
> **After ANY change to `public/ipad/app.js`**, run:
> ```bash
> bash scripts/sync-mobile.sh
> ```
> This ONLY copies `app.js`. The mobile `style.css` and `index.html` are **phone-optimized and SEPARATE** — do NOT overwrite them.
>
> **NEVER edit `public/mobile/app.js` directly** — always edit `public/ipad/app.js` and sync.
> **NEVER copy `public/ipad/style.css` to `public/mobile/style.css`** — they are different files optimized for different screen sizes.
> Incident: April 9, 2026 — 28 features built on iPad but mobile was running March 18 code. Then CSS was incorrectly synced, breaking the phone layout.

### iPad app.js — Search Input Focus Loss Pattern (April 2026)

> **CRITICAL PATTERN**: When building search/filter UIs in `public/ipad/app.js`, NEVER re-render the entire modal innerHTML on each keystroke. This destroys and recreates the `<input>` element, causing focus loss — the user can only type one character at a time.
>
> **Correct pattern**: Build a static shell (header + search input) once, then only re-render the dynamic content (product grid, results list) into a child `<div>` using `getElementById().innerHTML`. Attach the `input` event listener via `addEventListener()` AFTER the element exists in the DOM.
>
> **Example** (from ship-to-patient peptide browser):
> ```javascript
> // Static shell with persistent input
> modal.innerHTML = `<div id="search-container"><input id="my-search" /></div><div id="results"></div>`;
> document.getElementById('my-search').addEventListener('input', (e) => renderResults(e.target.value));
> function renderResults(query) {
>     document.getElementById('results').innerHTML = /* filtered results */;
> }
> ```
>
> This pattern applies to ALL search modals in the iPad app. Incidents: patient name search (Feb 2026), peptide product search (Apr 2026).

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

## 🧩 CRITICAL CODE PATTERNS

### Patient Search — ALWAYS Use Healthie API (MANDATORY)

**Problem**: The local PostgreSQL `patients` table only contains patients that have been manually linked. Many Healthie patients don't exist in the local DB. Searching the local DB for patient selection will miss most patients.

**Rule**: Any UI that lets a user pick a patient (scheduling, messaging, new conversation, scribe, etc.) **MUST search Healthie directly** via the `users(keywords:)` GraphQL query. Never search only the local `patients` table for user-facing patient pickers.

**Correct pattern** (search Healthie users):
```typescript
// ✅ CORRECT — finds ALL Healthie patients
const data = await healthieGraphQL<{
    users: Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null }>;
}>(`
    query SearchUsers($keywords: String!) {
        users(keywords: $keywords, offset: 0, page_size: 20) {
            id first_name last_name email
        }
    }
`, { keywords: searchTerm });
```

**Wrong pattern** (local DB only):
```typescript
// ❌ WRONG — misses patients not in local DB
const patients = await query('SELECT * FROM patients WHERE full_name ILIKE $1', [`%${search}%`]);
```

**The returned `id` from Healthie `users` is the Healthie User ID.** Use this ID for:
- `createAppointment(input: { user_id: ... })`
- `createConversation(input: { simple_added_users: ... })`
- `createNote(input: { conversation_id: ... })` (conversation IDs are separate)
- Any other Healthie mutation that references a patient

**Existing endpoint**: `POST /api/ipad/messages/` with `action: 'search_patients'` already implements this correctly and can be reused from any frontend tab.

### Inactive Patient Status Guard (MANDATORY — April 1, 2026)

> [!CAUTION]
> **NEVER change an inactive patient's status to active, hold, or any other status. Inactive is a deliberate clinical/administrative decision. Only a human admin can reverse it via direct database access.**

**Code enforcement**: `lib/patientQueries.ts` → `updatePatient()` checks current `status_key` before any UPDATE. If the patient is `inactive` and the new status is anything other than `inactive`, the function throws an error.

**Rules:**
1. **No automated process** (cron, webhook, AI agent) may change `inactive` → any other status
2. **No dashboard user** (read/write role) may change `inactive` → any other status via the UI
3. **Only direct DB access** by an admin can reactivate a patient
