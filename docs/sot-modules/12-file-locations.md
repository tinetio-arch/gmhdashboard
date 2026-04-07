## 📚 REFERENCE: FILE LOCATIONS

### Configuration Files
- **Next.js**: `next.config.js` (trailingSlash, basePath, typescript ignore)
- **Env**: `.env.local` (all secrets)
- **PM2**: `/home/ec2-user/ecosystem.config.js` (process definitions — root level)
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

