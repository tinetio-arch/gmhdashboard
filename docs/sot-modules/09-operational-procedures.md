
### January 4, 2026: Data Sync Recovery & Monitoring Improvements

**CRITICAL: Healthie → Snowflake Sync Fixed**
- **Problem**: Billing items sync had been silently failing since Dec 29 - Snowflake data was 6 days stale!
- **Root Cause**: Cron job using old Node.js path `/home/ec2-user/.local/share/nvm/v20.19.6/bin/npx` which no longer exists
- **Solution**: Updated cron to use `/usr/bin/npx`
- **Manual Sync Ran**: Data now current (last payment: January 4, 2026)

**Telegram Bot Improvements (NOWJarvis)**:
- **Date Format**: All dates now display as **MM-DD-YYYY** (not YYYY-MM-DD)
- **Time Range Clarification**: AI now asks for clarification when queries like "total" are ambiguous
- **"Total" Interpretation**: When user asks for "total" without date qualifier, queries ALL data (no date filter)
- **Year Updated**: AI prompts updated from 2025 to 2026
- **New Commands Added**:
  - `/ghl` - Show Men's Health existing patients from GoHighLevel
  - `/dashboard [SQL]` - Query PostgreSQL directly (SELECT only)
  - `/datasources` - List all connected data sources

**Data Staleness Monitoring Added**:
- Health monitor now checks Snowflake billing data freshness
- Alerts via Telegram if data is >2 days old (sync failure)
- Prevents silent data sync failures from recurring

**Healthie Payment Decline Alerts (UPDATED 2026-02-01)**:
- **File**: `scripts/process-healthie-webhooks.ts`
- **Detection**: Monitors for status containing `failed`, `declined`, `error`, `rejected`, `cancelled`, `card_error`
- **CRITICAL: Recent Payment Check**: Before alerting or setting Hold, system checks if patient has a more recent SUCCESSFUL payment. If they've paid since the failure, **NO ALERT is sent**.
- **Healthie API Semantics**:
  - `billingItems`: `sender` = PATIENT (who pays), `recipient` = PROVIDER (who receives)
  - `requestedPayments`: `recipient` = PATIENT, `sender` = PROVIDER (REVERSED!)
- **Alerts To** (only if no recent payment):
  1. **Telegram**: Immediate alert with patient name, amount, status
  2. **Google Spaces**: ops-billing space (requires `GOOGLE_CHAT_WEBHOOK_OPS_BILLING` env var)
- **Automatic Dashboard Update**:
  - Patient status set to **"Hold - Payment Research"** (red)
  - Note added with timestamp: `[MM/DD/YYYY HH:MM AM] PAYMENT DECLINED - Amount: $X, Due: MM/DD/YYYY. Status auto-set to Hold - Payment Research.`
  - **Staff must manually set to Inactive if needed** - system never sets Inactive
- **Auto Message to Patient** (via Healthie Chat - in-app messaging):
  - Uses Healthie's `createConversation` + `createNote` mutations
  - Message appears in patient's Healthie messaging/chat inbox
  - **NOT SMS** - this is in-app chat that patients see when they log into Healthie
  - Message: `Hi {FirstName}, we noticed your {clinic} payment didn't go through. Please update your card here: https://secureclient.gethealthie.com/users/sign_in (Log in → Settings ⚙️ → Update Payment Cards). Questions? Call {phone}. Thank you!`
  - **Phone Numbers**: Men's Health = **928-212-2772**, All Others = **928-277-0001**
  - **Payment Portal**: `https://secureclient.gethealthie.com/users/sign_in` - patients log in, go to Settings → Update Payment Cards
  - **IMPORTANT**: GHL SMS is NOT used - only Healthie Chat to prevent duplicate messages
  - **CRITICAL**: Only messages ACTIVE patients - archived patients are SKIPPED. System checks `user.active` field from Healthie API before sending.
- **Auto-Reactivation** (when patient pays after being on Hold):
  - Patient status → Active
  - Note added: `[timestamp] PAYMENT RECEIVED - Auto-reactivated from Hold - Payment Research.`
  - Telegram notification sent to staff
  - **Chat to Patient** (via Healthie): `Hi {FirstName}, thank you! Your {clinic} payment has been received. We appreciate you! - NOW Optimal`


**Patient Status Color Rules** (GMH Dashboard):
| Status | Key | Color | Description |
|--------|-----|-------|-------------|
| Active | `active` | Green (`#d9ead3`) | Current, no issues |
| Active - Pending | `active_pending` | Yellow (`#fff2cc`) | Labs due or pending action |
| **Hold - Payment Research** | `hold_payment_research` | Red (`#f4cccc`) | **AUTO-SET when Healthie payment declines** |
| Hold - Patient Research | `hold_patient_research` | Red (`#f4cccc`) | Manual investigation needed |
| Inactive | `inactive` | Red (`#f4cccc`) | **STAFF ONLY** - No longer active patient |


**Overdue Rule** (Red status trigger):
- Balance > $0.50, OR
- Status contains "past"/"due", OR
- > 3 days past charge date

**Cost Report Enhanced**:
- Now includes real Snowflake credit usage (not estimates)
- Added SaaS subscriptions: GHL ($97), Healthie ($149), Ngrok ($8)
- **Grand Total**: Displays complete monthly infrastructure cost (~$356/mo)

**PM2 Services Updated**:
- Added `fax-processor` and `uptime-monitor` to critical services monitoring list


---

### January 2, 2026: NOW Primary Care Website Deployed


**New Website Live at https://www.nowprimary.care**
- **Purpose**: Professional public-facing website for NOW Primary Care clinic
- **Technology**: Next.js 14, vanilla CSS design system
- **Port**: 3004 (Nginx proxies nowprimary.care to localhost:3004)
- **PM2 Service**: `nowprimary-website`
- **Directory**: `/home/ec2-user/nowprimarycare-website/`

**Pages Created**:
- Home: Hero, features, provider spotlight, location, CTA
- About: Mission, values, Phil Schafer bio
- Services: All 26 Healthie appointment types organized by category
- Contact: Location map, contact form
- Book: Interactive service selection widget → Healthie portal

**Design System**:
- Navy Blue: `#00205B` (primary, from logo)
- Green: `#00A550` (accent, from logo compass)
- Inter font (Google Fonts)
- Responsive, mobile-first design

**Nginx Config Updated**:
- Changed `nowprimary.care` proxy from port 3001 to 3004
- Port 3001 remains for upload-receiver (Scribe service)

**postcss.config.mjs Relocated**:
- Moved from `/home/ec2-user/postcss.config.mjs` to `/home/ec2-user/gmhdashboard/postcss.config.mjs`
- Prevents conflict when building nowprimarycare-website (which doesn't use Tailwind)

---

## 🔥 PREVIOUS MAJOR CHANGES (DEC 25-30, 2025)

### December 30: Dashboard Hydration Fix & Jarvis Bot Improvements

**PatientTable Hydration Error Fixed**
- **Problem**: React hydration error on `/ops/patients/` - server rendered "Bruce French" but client expected "Travis Gonzales"
- **Root Cause**: Client-side sorting with `comparePatients()` produced different order than server SQL ORDER BY
- **Solution**: Added `mounted` state guard pattern to `PatientTable.tsx` (same pattern already in `AddPatientForm.tsx`)
- **Pattern Used**:
  ```typescript
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <LoadingPlaceholder />;
  ```

**PM2 Production Mode Fixed**
- **Problem**: PM2 was running `npm run dev` instead of `npm run start`
- **Impact**: Dev mode causes slower hydration, extra React strict mode renders
- **Solution**: 
  ```bash
  pm2 delete gmh-dashboard
  pm2 start npm --name "gmh-dashboard" -- run start
  pm2 save
  ```
- **Verification**: `pm2 describe gmh-dashboard | grep "script args"` → should show "run start"

**Jarvis Telegram Bot Response Formatting Improved**
- **Problem**: Bot giving verbose, padded responses with unnecessary emojis and filler text
- **Solution**: Updated `formatAnswer()` prompt in `scripts/telegram-ai-bot-v2.ts`:
  - Reduced `max_tokens` from 800 to 300
  - Reduced `temperature` from 0.3 to 0.1
  - Added explicit instructions: "Be EXTREMELY BRIEF - 1-3 sentences max"
  - Added good/bad examples to guide response style
- **File**: `/home/ec2-user/gmhdashboard/scripts/telegram-ai-bot-v2.ts` (lines 1103-1145)

**CRITICAL FIX: Healthie Billing Items Sync Gap**
- **Problem**: Jarvis bot reporting $0 revenue when Healthie showed $1,280 for Dec 29
- **Root Cause**: `HEALTHIE_BILLING_ITEMS` table in Snowflake had NO automated sync from Healthie API
  - The existing `sync-healthie-ops.js` syncs from Postgres (dashboard data), NOT from Healthie API
  - Billing items table was stuck with data from Dec 23
- **Solution**: 
  1. Created `/home/ec2-user/gmhdashboard/scripts/sync-healthie-billing-items.ts` 
  2. Added hourly cron job to sync billing items from Healthie API to Snowflake
  3. Ran manual sync - now shows Dec 29: 8 transactions = $1,280 ✅
- **Cron Added**: `0 * * * *` (every hour at minute 0)

**Removed Rogue PM2 Process**
- `upload-receiver` had 1481 restart attempts and was in stopped state
- Deleted with `pm2 delete upload-receiver && pm2 save`

**Snowflake Sync System Overview** (Updated Feb 2026)
| Sync Job | Schedule | What It Syncs | Script Location |
|----------|----------|---------------|-----------------|
| Unified Python Sync | Every 4 hrs at :00 | patients, invoices, vials, dispenses, memberships, qb_payments, prescriptions → Snowflake | `/home/ec2-user/scripts/sync-all-to-snowflake.py` |
| QuickBooks | Every 3 hrs | QB payments/transactions | `/home/ec2-user/quickbooks-sync.sh` |
| Revenue Cache | Every 6 hrs at :40 | Healthie revenue data | `/home/ec2-user/scripts/cache-healthie-revenue.py` |

**Rate Limiting Measures** (added Dec 30):
- Billing items sync reduced from hourly to every 6 hours
- Staggered at :30 to avoid collision with scribe sync at :00
- Added 500ms delay between paginated API requests

**Important**: The Jarvis bot queries `HEALTHIE_BILLING_ITEMS` for financial data.

### December 28: Infrastructure Hardening
**Disk Space Crisis & Resolution**
- Ran out of disk space (98% on 20GB volume)
- Cleaned 4GB (old duplicates, logs, n8n Docker)
- Expanded EBS volume 20GB → 50GB via AWS Console
- Commands: `sudo growpart /dev/nvme0n1 1 && sudo xfs_growfs -d /`
- Result: Now 32% usage (35GB free) ✅
