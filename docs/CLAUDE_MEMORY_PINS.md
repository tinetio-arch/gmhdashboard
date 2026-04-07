# Claude Memory Pins

> **Purpose**: Pin each of these into every new Claude Code session via `/memory`.
> These are the critical facts that prevent the most common AI mistakes on this codebase.

## How to Use
In each Claude Code session, run `/memory` and add the relevant pins below. Copy-paste the text after each bullet.

---

## ALWAYS Pin (Every Session)

- **Healthie is source of truth for patient data. When Healthie and Postgres conflict, Healthie wins. Never update Healthie from Postgres — only sync Postgres FROM Healthie.**

- **Active codebase directory: /home/ec2-user/gmhdashboard (NOT /apps/gmh-dashboard). Production URL: https://nowoptimal.com/ops/ with base path /ops.**

- **Before ANY code change, read the relevant SOT module from ~/gmhdashboard/docs/sot-modules/ (see INDEX.md). Before cross-system changes, read ~/gmhdashboard/docs/DEPENDENCIES.md.**

- **3-layer architecture: Layer 1 (Directives) = markdown SOPs in directives/. Layer 2 (Orchestration) = you, the AI. Layer 3 (Execution) = deterministic scripts in execution/. Never bypass layers.**

- **Database: Postgres for operational writes, Snowflake for analytics reads. Snowflake uses key-pair auth via JARVIS_SERVICE_ACCOUNT. Old user tinetio123 is MFA-blocked — never use password auth.**

- **Two GHL sub-accounts with separate tokens: Men's Health (most patients) and Primary Care (3 client types only). Routing is in lib/ghl.ts getGHLClientForPatient(). Tokens are sub-account scoped — mismatched locationId = auth errors.**

## Pin When Working on Websites

- **5 website services on separate ports: abxtac (3003), nowmentalhealth (3004), nowmenshealth (3005), nowoptimal (3006), nowprimary (3007). All behind Nginx reverse proxy. Booking widget on nowmenshealth uses Healthie API directly.**

## Pin When Working on Billing

- **CRITICAL REVERSAL: In Healthie billingItems, 'sender' = PATIENT (who pays), 'recipient' = PROVIDER. In requestedPayments it's REVERSED. This has caused bugs before.**

- **Stripe is currently disconnected. QuickBooks health check is failing. 11 patients on billing hold need resolution.**

## Pin When Working on Mobile App

- **Mobile app: 0 of 380 patients verified. is_verified field shows false for everyone. Either sync broken or onboarding flow confusing. Test verification flow before making changes.**

## Pin When Deploying

- **Deployment steps: pm2 stop → rm -rf .next → npm install (if needed) → npm run build → pm2 start → pm2 save. NEVER skip pm2 save. Check build exit code before starting.**

- **Server disk was at 96% (now improving). Before deploying, check disk with df -h. If above 85%, clean logs first: pm2 flush && find /tmp -mtime +7 -delete.**

## Pin When Working on Labs

- **3 patients have critically elevated hematocrit (>60%): Donavon Connor (64.3%), Billy Garcia (61.0%), Jakob Woods (60.1% — 22 days overdue). These are clinical safety issues.**

## Pin When Working on Inventory

- **22 peptide SKUs at zero stock including Retatrutide 12mg/24mg, HCG, PT 141, BPC-157 5mg. Female pelleting kits: 10 remaining with 36 upcoming procedures — reorder needed.**

## Pin for Context Management

- **SOT is split into 24 modules in ~/gmhdashboard/docs/sot-modules/. Read INDEX.md first, then load ONLY the modules relevant to your task. Do NOT read the full 5,273-line monolithic SOT.**

- **After completing work, update the relevant SOT module file AND run: bash ~/gmhdashboard/scripts/health-check.sh to verify KPIs weren't degraded.**

---

## Anti-Pattern Reminders

- **NEVER dump debug scripts in project root — use .tmp/ for intermediates**
- **NEVER make direct DB modifications without documenting in SOT**
- **NEVER revert a previous fix without confirming with Phil first**
- **NEVER use /ops as a file path — it's a URL base path handled by Next.js config**
- **NEVER create web pages for SOPs — generate PDFs in public/menshealth/**
