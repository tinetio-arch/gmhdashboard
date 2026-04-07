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

**QuickBooks OAuth Routes Created**
- **Problem**: Routes never existed, returned 404
- **Solution**: Created from scratch:
  - `/app/api/auth/quickbooks/route.ts` - Initiates OAuth
  - `/app/api/auth/quickbooks/callback/route.ts` - Token exchange
  - Added `getPublicUrl()` helper for proper redirects
- **Database**: Stores tokens in `quickbooks_oauth_tokens` table
- **Flow**: User → QuickBooks → Callback → Tokens saved → Redirect to dashboard

**Redirect Loop Fixed**
- **Problem**: `ERR_TOO_MANY_REDIRECTS` on `/ops` ↔ `/ops/`
- **Root Cause**: Nginx forced `/` but Next.js stripped it
- **Solution**: 
  - Added `trailingSlash: true` to `next.config.js`
  - All URLs now end with `/` (standard)
  - Renamed cookie `gmh_session` → `gmh_session_v2` (invalidate old)

**Base Path Configuration Standardized**
- **ENV**: `NEXT_PUBLIC_BASE_PATH=/ops` (in `.env.local` AND `next.config.js`)
- **Helper**: `lib/basePath.ts` exports `withBasePath(path)` and `getBasePath()`
- **Rule**: ALL client-side fetches MUST use `withBasePath('/api/...')`
- **Example**: `fetch(withBasePath('/api/admin/quickbooks/sync'), ...)`

**Production Mode Fixed**
- **Problem**: PM2 was running `npm run dev` instead of `npm run start`
- **Solution**: 
  ```bash
  pm2 delete gmh-dashboard
  pm2 start npm --name "gmh-dashboard" -- run start
  pm2 save
  ```
- **Verify**: `pm2 logs gmh-dashboard` should show `next start` (not `next dev`)

**Type Safety & Hydration Fixes**
- **Hydration**: Added client-side guards to `AddPatientForm`, `LoginForm`
- **Pattern**: `useState(false)` + `useEffect(() => setMounted(true))` + early return
- **Formatters**: All `formatCurrency/formatNumber` now handle `number | string | null | undefined`
- **Dates**: Use UTC-based `safeDateFormat()` instead of `toLocaleString()`

### December 25-27: AI Scribe System Built
**Full Clinical Documentation Automation**
- **Location**: `/home/ec2-user/scripts/scribe/`
- **Workflow**:
  1. Audio recording uploaded → Deepgram transcription
  2. Claude analyzes visit → Classifies visit type
  3. Generates 4 documents: SOAP note, patient summary, prescription recs, lab orders
  4. Sends to Telegram for provider approval (inline buttons)
  5. Provider reviews/edits/approves
  6. Approved docs injected into Healthie chart

**Key Components**:
- `scribe_orchestrator.py` - Main coordinator
- `telegram_approver.py` - Human-in-the-loop approval UI
- `document_generators.py` - AI-powered generation
- `prompts_config.yaml` - Customizable prompt templates
- `upload_receiver.js` - PM2 service (listens on port 3001)

**Visit Types Detected**:
- Initial consultation
- Follow-up visit
- Prescription refill
- Medication adjustment
- Lab review

**Safety Features**:
- Telegram approval required (no auto-injection)
- Edit capability before approval
- **Change Patient feature** (Jan 21, 2026): When fuzzy matching assigns wrong patient, tap "🔄 Change Patient" to search and reassign to correct patient
- Comprehensive logging
- Graceful error handling (Telegram failures don't crash workflow)

**Documentation**:
- Setup: `scripts/scribe/SETUP.md`
- Safety: `scripts/scribe/SAFETY_GUIDE.md`
- Customization: `scripts/scribe/PROMPT_CUSTOMIZATION.md`

### December 25-27: Snowflake "Mini-Bridge" Complete
**Infrastructure Provisioned**:
1. **AWS S3 Bucket**: `gmh-snowflake-stage` (us-east-2)
2. **IAM Role**: `snowflake-s3-access-role` (trust to Snowflake)
3. **Storage Integration**: S3 → Snowflake connection
4. **Snowpipe**: Auto-ingest on file upload

**Data Flow**:
```
Clinical Systems (Healthie, QB, Postgres)
  ↓ (Sync scripts)
AWS S3 (gmh-snowflake-stage)
  ↓ (Snowpipe)
Snowflake (GMH_CLINIC)
  ↓ (SQL views)
Metabase (BI)
```

**Active Syncs**:
- Every 6 hours: `scripts/sync-healthie-ops.js` → Snowflake
- Every hour: `scripts/scribe/healthie_snowflake_sync.py`
- On-demand: Invoice sync, provider sync, billing items

**Snowflake Details**:
- Account: `KXWWLYZ-DZ83651`
- User: `JARVIS_SERVICE_ACCOUNT` (key-pair auth) — see Snowflake Auth section above
- Database: `GMH_CLINIC`
- Schemas: `FINANCIAL_DATA`, `PATIENT_DATA`, `INTEGRATION_LOGS`

**Key Tables** (as of Dec 28):
- `PATIENTS`: 305 rows
- `HEALTHIE_INVOICES`: 69
- `HEALTHIE_BILLING_ITEMS`: 20
- `QB_PAYMENTS`: 84
- `MEMBERSHIPS`: 102
- `DISPENSES`: 192

### December 25-27: Prescribing & Patient Engagement
**Pre-Staging E-Rx Orders**:
- AI Scribe generates prescription recommendations
- Creates Healthie tasks (tagged `erx-pending`)
- Provider reviews/approves via dashboard
- Approved scripts sent to pharmacy

**5th-Grade Patient Summaries**:
- AI generates patient-friendly visit summaries
- Written at 5th-grade reading level
- Posted to Healthie patient portal
- Improves patient understanding & engagement

### December 28-29: AI Email Triage System ✅ DEPLOYED

**Email**: `hello@nowoptimal.com` (Google Workspace)  
**Status**: Running 24/7 in PM2 as `email-triage`  
**Purpose**: Intelligent AI-powered routing of all incoming emails to appropriate Google Chat spaces

**Architecture**:
```
Incoming Email → Gmail API (every 2 min) → AI Classification (Bedrock Claude) 
→ Google Chat Post → Feedback Learning → Improved Accuracy
```

**Google Chat Spaces & Webhooks**:

1. **NOW Ops & Billing** (`OPS_BILLING`)
   - Webhook: `https://chat.googleapis.com/v1/spaces/AAQAuw3Rvdc/messages?key=...`
   - Routes: Billing, payments, insurance, claims, no-shows, cancellations
   - Keywords: billing, payment, insurance, card on file, balance, claim

2. **NOW Exec/Finance** (`EXEC_FINANCE`)
   - Webhook: `https://chat.googleapis.com/v1/spaces/AAQARw60cl0/messages?key=...`
   - Routes: KPIs, revenue, patient complaints, leadership decisions
   - Keywords: KPI, revenue, complaint, reconciliation, QuickBooks

3. **NOW Patient Outreach** (`PATIENT_OUTREACH`)
   - Webhook: `https://chat.googleapis.com/v1/spaces/AAQAR7R9T3w/messages?key=...`
   - Routes: Retention, engagement, human follow-up needed
   - Keywords: retention, outreach, churn risk, follow-up

4. **NOW Clinical Alerts** (`CLINICAL`)
   - Webhook: `https://chat.googleapis.com/v1/spaces/AAQANhoAdgo/messages?key=...`
   - Routes: Lab results, vitals, medications, clinical follow-ups, faxed reports
   - Keywords: lab, vital, medication, abnormal, out of range, clinical

**AI Learning System**:
- Every Google Chat message includes "Reroute" buttons
- User corrections automatically tracked in `/home/ec2-user/gmhdashboard/data/email-triage-feedback.json`
- System extracts patterns (keywords, sender domains) from corrections
- Future classifications incorporate learned patterns
- Accuracy tracking: Shows current routing accuracy with each email

**Files**:
- `/home/ec2-user/gmhdashboard/scripts/email-triage/email-monitor.py` - Gmail API monitoring
- `/home/ec2-user/gmhdashboard/scripts/email-triage/email-classifier.py` - AI classification with Bedrock
- `/home/ec2-user/gmhdashboard/scripts/email-triage/google-chat-poster.py` - Google Chat formatting
- `/home/ec2-user/gmhdashboard/scripts/email-triage/feedback-tracker.py` - Learning system
- `/home/ec2-user/gmhdashboard/config/gmail-credentials.json` - OAuth credentials
- `/home/ec2-user/gmhdashboard/config/gmail-token.pickle` - Saved authentication token

**PM2 Management**:
```bash
pm2 list                    # View status
pm2 logs email-triage       # View logs
pm2 restart email-triage    # Restart service
pm2 stop email-triage       # Stop service
```

**Daily Monitoring**:
- Integrated into `/home/ec2-user/scripts/telegram_monitor.py`
- Daily Telegram report includes:
  - Emails processed count
  - Routing accuracy percentage
  - Corrections made count

---

### December 28-29: GoHighLevel (GHL) Communication System 🚀 IN PROGRESS

**GHL Account**: HIPAA-approved  
**Purpose**: Centralized patient communication platform with AI Voice agents  
**Status**: Voice AI webhook server deployed, MCP server in development

**Architecture Overview**:
```
Patient Communication Flow:
Ooma Phone System → GHL Phone Numbers → Jessica Voice AI
    ↓
MCP Server (Real-time data access)
    ├→ Postgres (Patient IDs)
    ├→ Healthie (Appointments, Forms)
    ├→ Snowflake (Historical Data)
    └→ AWS Bedrock (AI Decisions)
    ↓
Actions: Book appointments, Send SMS, Update tags, Trigger workflows
```

**GHL Sub-Accounts** (Multi-brand strategy):

1. **NOW Men's Health Care**
   - Location ID: `0dpAFAovcFXbe0G5TUFr`
   - Phone: 928-212-2772
   - Voice AI: **Max** (TRT/Men's health specialist)
   - Address: 215 N. McCormick St, Prescott, AZ 86301
   - Hours: Mon 1pm-6pm, Tue-Fri 9am-6pm, Sat 9am-1pm

2. **NOW Primary Care**
   - Location ID: TBD (to be created)
   - Phone: TBD (Ooma forwarding)
   - Voice AI: **Jessica** (Primary care receptionist)
   - Address: 404 S. Montezuma St, Suite A, Prescott, AZ 86303
   - Hours: Mon-Fri 9am-5pm
   - Fax: 928-350-6228

**Max Voice AI Agent** (NEW - Jan 2, 2026):
- **Role**: Men's health receptionist for NOW Men's Health Care
- **Port**: 3006
- **PM2 Process**: `max-webhooks`
- **Healthie Group**: NowMensHealth.Care (ID: 75522)
- **Provider ID**: 12093125
- **Capabilities**:
  - Patient verification (DOB check)
  - New patient intake (creates in GHL + Healthie MensHealth.Care group)
  - TRT appointment scheduling (Initial, Refill, Labs)
  - EvexiPEL pellet therapy booking
  - Peptide education scheduling
  - Lab/imaging results requests (date only, NO PHI)
  - Billing inquiries
  - SMS confirmations
- **HIPAA Compliance**: Never discusses actual lab values or diagnoses
- **Intelligent Routing**: Transfers primary care requests to NOW Primary Care
- **Personality**: Confident, knowledgeable, discreet about sensitive topics

**Max Custom Actions** (Webhook endpoints on port 3006):
- `POST /api/ghl/max/verify-patient` - Authenticate caller
- `POST /api/ghl/max/create-new-patient` - Create in GHL + Healthie (MensHealth.Care)
- `POST /api/ghl/max/get-availability` - Query TRT appointment slots
- `POST /api/ghl/max/book-appointment` - Create Healthie appointment
- `POST /api/ghl/max/check-lab-results` - Get lab date (HIPAA safe)
- `POST /api/ghl/max/send-provider-message` - Notify Google Chat
- `POST /api/ghl/max/patient-balance` - Check balance
- `POST /api/ghl/max/send-payment-link` - SMS payment link

**Max Appointment Types** (Prices verified via Healthie GraphQL - Jan 2026):
| Type | Healthie ID | Duration | Price | Pricing Option |
|------|-------------|----------|-------|----------------|
| Male HRT Initial | 504725 | 30 min | Free | custom |
| TRT Supply Refill | 504735 | 20 min | Custom | custom |
| EvexiPEL Male Initial | 504727 | 60 min | Custom | custom |
| EvexiPEL Male Repeat | 504728 | 45 min | Custom | N/A |
| TRT Telemedicine | 505645 | 30 min | Custom | custom |
| Peptide Education | 504736 | 20 min | Custom | custom |
| 5-Week Lab | 504732 | 15 min | Free | N/A |
| 90-Day Lab | 504734 | 20 min | Free | N/A |
| Weight Loss Consult | 504717 | 45 min | $99 | custom |
| IV Therapy GFE | 505647 | 15 min | $50 | custom |

**Healthie GraphQL Query for Appointment Type Pricing**:
```graphql
query {
  appointmentTypes(page_size: 50) {
    id
    client_display_name
    length
    pricing              # String: displays as "$99.00" or "$" for custom
    pricing_option       # String: "custom" or "N/A"
    pricing_info {
      price              # String: actual price in cents/dollars  
      cpt_code { code }
    }
    clients_can_book
    user_group { id name }
  }
}
```
Note: "Custom" pricing means the patient pays at checkout based on actual supplies/services provided.

**Jessica Voice AI Agent**:
- **Role**: Primary care receptionist for NOW Primary Care
- **Capabilities**:
  - Patient verification (DOB check)
  - New patient intake (creates in GHL + Healthie)
  - Appointment scheduling (via Healthie API)
  - Lab/imaging results requests (date only, NO PHI)
  - Prescription refill routing
  - Billing inquiries
  - SMS confirmations
- **HIPAA Compliance**: Never discusses actual lab values or diagnoses
- **Intelligent Routing**: Transfers testosterone/men's health calls to NOW Men's Health (928-212-2772)
- **Caller ID Recognition**: Tailors greeting for known vs unknown callers

**GHL Custom Actions** (Webhooks - Tested Jan 3, 2026):
Server: `https://nowoptimal.ngrok.app` (Static Ngrok Domain)

| # | Endpoint | Status | Description |
|---|----------|--------|-------------|
| 1 | `verify_patient` | ✅ PASS | Authenticate caller by DOB |
| 2 | `create_new_patient` | ✅ PASS | Create in GHL + Healthie |
| 3 | `get_availability` | ✅ PASS | Query Healthie for slots (60+ returned) |
| 4 | `book_appointment` | ✅ PASS | Create in Healthie (ID: 529416766 confirmed) |
| 5 | `check_lab_results` | ✅ PASS | Get last lab date (HIPAA safe) |
| 6 | `patient_balance` | ✅ PASS | Returns balance + payment history |
| 7 | `send_payment_link` | ⚠️ CONFIG | Needs GHL payment integration setup |
| 8 | `send_provider_message` | ⚠️ CONFIG | Needs Google Chat webhook URL |
| 9 | `transfer_call` (FrontDesk) | ✅ PASS | Tags contact for workflow transfer |
| 10 | `transfer_call` (MensHealth) | ✅ PASS | Tags contact for workflow transfer |
| 11 | `request_prescription_refill` | ✅ PASS | Sends to Google Chat clinical |
| 12 | `find_pharmacy` | 🔲 TODO | Google Places API integration |
| 13 | `get_available_slots` | ✅ PASS | Returns specific time slots |


**MCP Server Integration** (CRITICAL):
- **Port**: 3002 (HTTP/SSE mode)
- **GHL Native Support**: Jessica connects via MCP protocol
- **Real-Time Data Access**: Sub-2 second queries across all systems
- **Tools Exposed**:
  - `get_patient_context` - Complete patient overview (Postgres + Snowflake + Healthie + GHL)
  - `lookup_patient` - Search by phone/email/name
  - `check_availability` - Provider appointment slots
  - `book_appointment` - Create appointment with constraint checking
  - `get_recent_labs` - Lab dates (NO values - HIPAA)
  - `check_form_status` - Intake paperwork completion
  - `trigger_patient_workflow` - Start Healthie workflows
  - `send_sms` - Send text via GHL
  - `notify_team` - Google Chat notifications
  - `summarize_patient_for_call` - AI-powered patient summary (Bedrock)

**Data Flow - Patient Lookup** (Critical for integration):
```
Jessica receives call from (928) 555-1234
    ↓
MCP: get_patient_context(phone="9285551234")
    ↓
1. Postgres Query (REAL-TIME - source of truth for IDs)
   SELECT patient_id, healthie_client_id, ghl_contact_id
   FROM patient_data_entry_v + healthie_clients + patients
    ↓
2. If patient found in Postgres:
   ├→ Snowflake: Get visit history, lab dates (ANALYTICS - 6hr lag OK)
   ├→ Healthie API: Get forms completion status (REAL-TIME)
   ├→ GHL API: Get tags, custom fields (REAL-TIME)
   └→ Bedrock AI: Summarize for natural conversation
    ↓
3. Return combined context to Jessica (<2 sec)
    ↓
Jessica: "Hi Sarah! I see you're due for your annual physical..."
```

**Patient Workflows** (Auto-triggered via Healthie):
- **Sick Visit**: Urgent care intake forms
- **Primary Care**: Annual exam paperwork
- **Pelleting**: Hormone pellet therapy forms
- **Weight Loss**: GLP-1/weight management intake
- **Men's Health**: TRANSFER to NOW Men's Health clinic

**GHL ↔ Healthie Sync**:
- Patient created in GHL → GHL custom field `healthie_patient_id` stored
- Patient created in Healthie → Postgres `healthie_clients` table updated
- Appointment booked → GHL workflow triggered (SMS confirmation)
- Forms completed in Healthie → GHL tag updated (`paperwork_complete`)

**GHL ↔ Postgres Sync**:
- **Source of Truth**: Postgres for all patient IDs
- **GHL Field**: `ghl_contact_id` stored in Postgres `patients` table
- **Healthie ID**: `healthie_client_id` stored in Postgres `healthie_clients` table
- **Critical**: MCP server MUST query Postgres first, NOT Snowflake (6hr lag)

**GHL Workflows Required** (Must be created in GHL UI - API doesn't support workflow creation):
| Workflow Name | Trigger | Action | Target Number |
|---------------|---------|--------|---------------|
| Transfer to Front Desk | Tag `transfer_front_desk` added | Forward Call | +1 (928) 277-0001 |
| Transfer to Men's Health | Tag `transfer_mens_health` added | Forward Call | +1 (928) 212-2772 |
| SMS Appointment Confirmation | Appointment Created | Send SMS | (Patient phone) |


**Files & Locations**:
```
/home/ec2-user/gmhdashboard/scripts/ghl-integration/
├── webhook-server.js          # Express server for custom actions (port 3001)
├── ghl-client.js               # GHL API wrapper
├── JESSICA_AI_AGENT.md         # Jessica documentation
├── JESSICA_GHL_PROMPT.md       # Copy-paste prompt for GHL
├── JESSICA_QUICK_REFERENCE.md  # Quick decision trees
├── YOUR_GHL_CONFIG.md          # ngrok URL and setup
└── PATIENT_WORKFLOW_GUIDE.md   # Routing logic

/home/ec2-user/mcp-server/
├── server.py                   # MCP HTTP/SSE server (port 3002)
├── clients/
│   ├── postgres_client.py      # Postgres queries (SOURCE OF TRUTH)
│   ├── snowflake_client.py     # Analytics queries
│   ├── healthie_client.py      # Healthie GraphQL API
│   ├── ghl_client.py           # GHL REST API
│   └── bedrock_client.py       # AWS AI reasoning
├── tools/
│   ├── snowflake.py            # Snowflake MCP tools
│   ├── healthie.py             # Healthie MCP tools
│   ├── ghl.py                  # GHL MCP tools
│   └── composite.py            # Multi-system intelligent tools
└── GHL_MCP_CONFIG.md           # How to connect MCP to GHL
```

**PM2 Services**:
```bash
pm2 list
├── ghl-webhooks     # Webhook server (port 3001)
└── jessica-mcp      # MCP server (port 3002) [TO BE DEPLOYED]
```

**Environment Variables** (`.env.production`):
```bash
# GHL API (V2 - Primary Integration)
GHL_V2_API_KEY=pit-f38c02ee-...       # V2 Private Integration Token (PIT)
GHL_API_VERSION=v2                     # Forces V2 API usage
GHL_LOCATION_ID=NyfcCiwUMdmXafnUMML8  # NOW Primary Care location
GHL_WEBHOOK_SECRET=960dd12...         # Webhook authentication
GHL_WEBHOOK_PORT=3003

# GHL V2 API Notes (CRITICAL - Updated Jan 8, 2026):
# - V2 Base URL: https://services.leadconnectorhq.com
# - V1 Base URL: https://rest.gohighlevel.com/v1 (legacy)
# - V2 Header: "Version: 2021-07-28" required
# - Contact Search: Use "query=" param (NOT "email=" or "phone=")
# - Workflows: CANNOT be created via API - must use GHL UI
# - SMS: POST /conversations/messages (works with PIT token)
#
# **CRITICAL - Private Integration Token Scoping (Updated Jan 9, 2026):**
# - V2 Private Integration Tokens (PIT) are SUB-ACCOUNT SCOPED by default
# - When you create a PIT from within a GHL sub-account (e.g., NOW Men's Health),
#   the token is AUTOMATICALLY associated with that sub-account for AUTHENTICATION
# - The token "knows" which location it belongs to and enforces this in auth
#
# **HOWEVER** - locationId still needed in API request bodies:
# - Certain GHL API operations (like /contacts/search, /tags) REQUIRE locationId
#   IN THE REQUEST BODY, even when using a sub-account-scoped token
# - This is a quirk of GHL API v2 design - the token is scoped, but the API
#   still wants locationId explicitly in certain request payloads
# - Solution: Pass locationId to GHLClient constructor, which will include it
#   in request bodies where needed
# - The token's sub-account scope is still enforced - passing a different
#   locationId will result in "token does not have access" errors
#
# Current setup:
# - Token: pit-cb1c18dd-... (scoped to NOW Men's Health sub-account)
# - GHL_MENS_HEALTH_LOCATION_ID=0dpAFAovcFXbe0G5TUFr (used in request bodies)
# - These MUST match or you'll get "token does not have access" errors
#
# **DUAL LOCATION SETUP (Updated Jan 15, 2026):**
# Two separate tokens are needed, one for each GHL sub-account:
#
# Men's Health Location:
#   - Token: GHL_MENS_HEALTH_API_KEY=pit-d5e53eeb-...
#   - Location ID: 0dpAFAovcFXbe0G5TUFr
#
# Primary Care Location:
#   - Token: GHL_PRIMARY_CARE_API_KEY=pit-9383d96a-...
#   - Location ID: NyfcCiwUMdmXafnUMML8
#
# ==== GHL PATIENT ROUTING RULES (CRITICAL - Updated Jan 15, 2026) ====
#
# MEN'S HEALTH Location (default for most patients):
#   - QBO TCMH $180/Month (qbo_tcmh_180_month)
#   - QBO F&F/FR/Veteran $140/Month (qbo_f_f_fr_veteran_140_month)
#   - Jane TCMH $180/Month (jane_tcmh_180_month)
#   - Jane F&F/FR/Veteran $140/Month (jane_f_f_fr_veteran_140_month)
#   - Approved Disc / Pro-Bono PT (approved_disc_pro_bono_pt)
#   - NowMensHealth.Care (nowmenshealth)
#   - Ins. Supp. $60/Month (ins_supp_60_month)
#
# PRIMARY CARE Location (only these 3 client types):
#   - NowPrimary.Care (nowprimarycare)
#   - PrimeCare Premier $50/Month (primecare_premier_50_month)
#   - PrimeCare Elite $100/Month (primecare_elite_100_month)
#
# Implementation: getGHLClientForPatient() in lib/ghl.ts
# - Routes based on client_type_key field
# - Primary Care types explicitly listed, all others default to Men's Health



# Healthie Provider IDs (for appointment routing)
HEALTHIE_MENS_HEALTH_PROVIDER_ID=12093125
HEALTHIE_PRIMARY_CARE_PROVIDER_ID=12088269  # Phil Schafer, NP

# ============================================
# NowMensHealth.Care Website Healthie Integration [NEW Jan 2026]
# ============================================
#
# Website: https://www.nowmenshealth.care
# Directory: /home/ec2-user/nowmenshealth-website/
# PM2 Service: nowmenshealth-website (port 3005)
#
# Healthie Configuration:
#   Location ID: 13029260 (215 N. McCormick St, Prescott)
#   Group ID: 75522 (NowMensHealth.Care)
#   Provider ID: 12093125 (Dr. Aaron Whitten)
#   Timezone: America/Phoenix
#
# Appointment Types Available for Online Booking:
#   TRT_INITIAL: 504725 (Initial TRT Consultation, 30 min, Free)
#   TRT_SUPPLY_REFILL: 504735 (TRT Supply Refill, 20 min, $79)
#   EVEXIPEL_MALE_INITIAL: 504727 (Pellet Therapy Initial, 60 min, $499)
#   EVEXIPEL_MALE_REPEAT: 504728 (Pellet Therapy Repeat, 45 min, $399)
#   WEIGHT_LOSS_CONSULT: 504717 (Weight Loss Consultation, 45 min, Free)
#   IV_THERAPY_GFE: 505647 (IV Therapy Consultation, 15 min, $50)
#
# API Routes:
#   POST /api/healthie/slots - Fetch available slots
#   POST /api/healthie/book - Book appointment & create patient
#
# Key Files:
#   lib/healthie-booking.ts - Healthie client with config
#   components/BookingWidget.tsx - Multi-step booking UI
#   app/book/page.tsx - Booking page
# ============================================


# Healthie Appointment Types (26 total - queried Dec 31, 2024)
# === URGENT/SICK VISITS ===
HEALTHIE_APPT_TYPE_SICK_VISIT_INPERSON=504715     # 50 min, In Person+Video, $129
HEALTHIE_APPT_TYPE_SICK_VISIT_TELE=505646         # 30 min, Video, $79
HEALTHIE_APPT_TYPE_WOUND_CARE=504716              # 60 min, In Person
HEALTHIE_APPT_TYPE_SPORTS_PHYSICAL=504718         # 45 min, In Person
HEALTHIE_APPT_TYPE_MEDICAL_CLEARANCE=504719       # 45 min, In Person
HEALTHIE_APPT_TYPE_TB_TEST=504741                 # 15 min, In Person
HEALTHIE_APPT_TYPE_ALLERGY_INJECTION=505648       # 20 min, In Person, $55
HEALTHIE_APPT_TYPE_IV_THERAPY_GFE=505647          # 15 min, In Person, $50
HEALTHIE_APPT_TYPE_INJECTION=505649               # 25 min, In Person

# === WEIGHT LOSS ===
HEALTHIE_APPT_TYPE_WEIGHT_LOSS_CONSULT=504717     # 45 min, Video+In Person, $99
HEALTHIE_APPT_TYPE_WEIGHT_LOSS_EDUCATION=504731   # 45 min, In Person

# === HORMONE REPLACEMENT THERAPY ===
HEALTHIE_APPT_TYPE_MALE_HRT_INITIAL=504725        # 30 min, In Person
HEALTHIE_APPT_TYPE_FEMALE_HRT_INITIAL=504726      # 30 min, In Person
HEALTHIE_APPT_TYPE_EVEXIPEL_MALE_INITIAL=504727   # 60 min, In Person
HEALTHIE_APPT_TYPE_EVEXIPEL_MALE_REPEAT=504728    # 45 min, In Person
HEALTHIE_APPT_TYPE_EVEXIPEL_FEMALE_INITIAL=504730 # 60 min, In Person
HEALTHIE_APPT_TYPE_EVEXIPEL_FEMALE_REPEAT=504729  # 45 min, In Person
HEALTHIE_APPT_TYPE_TRT_TELEMEDICINE=505645        # 30 min, Video (staff booking only)
HEALTHIE_APPT_TYPE_TRT_SUPPLY_REFILL=504735       # 20 min, In Person
HEALTHIE_APPT_TYPE_PEPTIDE_EDUCATION=504736       # 20 min, In Person

# === LAB DRAWS ===
HEALTHIE_APPT_TYPE_5_WEEK_LAB=504732              # 15 min, In Person
HEALTHIE_APPT_TYPE_90_DAY_LAB=504734              # 20 min, In Person (staff booking only)

# === PRIMARY CARE ===
HEALTHIE_APPT_TYPE_INITIAL_PC_CONSULT=504743      # 60 min, In Person (staff booking only)
HEALTHIE_APPT_TYPE_ELITE_MEMBERSHIP=504759        # 30 min, In Person, $250 (staff booking only)
HEALTHIE_APPT_TYPE_PREMIER_MEMBERSHIP=504760      # 30 min, In Person, $250 (staff booking only)

# === ABX TACTICAL ===
HEALTHIE_APPT_TYPE_ABX_TACTICAL_TELE=505650       # 25 min, Video

# Phil Schafer Availability (Created Jan 2, 2026 via API)
# Location assignment must be done manually in Healthie UI (API limitation)
#
# NowPrimary.Care Schedule:
#   Monday-Friday: 9:00 AM - 5:00 PM
#
# NowMensHealth Schedule:  
#   Monday: 1:00 PM - 6:00 PM
#   Saturday: 9:00 AM - 1:00 PM

# Healthie Workflow Groups
HEALTHIE_PRIMARY_CARE_GROUP_ID=TBD
HEALTHIE_SICK_VISIT_GROUP_ID=TBD
HEALTHIE_PELLETING_GROUP_ID=TBD
HEALTHIE_WEIGHT_LOSS_GROUP_ID=TBD
```

**Next Steps**:
1. ✅ Webhook server deployed and tested
2. ✅ MCP server built (needs Postgres client)
3. ⏳ Add Postgres client to MCP (CRITICAL for data integrity)
4. ⏳ Deploy MCP server with PM2
5. ⏳ Expose MCP via ngrok (port 3002)
6. ⏳ Connect MCP to GHL Jessica agent
7. ⏳ Create NOW Primary Care sub-account
8. ⏳ Configure Ooma phone forwarding
9. ⏳ End-to-end testing with live calls

**Integration Safety Checklist**:
- [ ] MCP queries Postgres FIRST (not Snowflake)
- [ ] MCP never writes to Healthie directly (uses webhooks)
- [ ] MCP respects 6-hour Snowflake lag for analytics
- [ ] All patient IDs resolved from Postgres
- [ ] No PHI in voice responses (dates only)
- [ ] Google Chat notifications for all callback requests


  - Routing accuracy percentage
  - Number of corrections made
  - System uptime
- Alerts if accuracy drops below 80%

**Ooma Fax Integration** (Ready):
- Configure Ooma to forward faxes to `hello@nowoptimal.com`
- AI automatically routes lab/imaging faxes to Clinical Alerts
- PDF attachments extracted for future Healthie upload

**Future Enhancements**:
- PDF text extraction for better AI analysis
- Patient matching (fuzzy match by name/DOB)
- Automatic Healthie chart upload
- Snowflake logging for audit trail
- Email threading and conversation tracking

> [!IMPORTANT]
> **GHL Authentication: Private Integration Tokens (NOT OAuth)**
> GHL uses location-scoped Private Integration Tokens (PITs), NOT OAuth2. These tokens do NOT expire.
> - Men's Health: `GHL_MENS_HEALTH_API_KEY` (pit-d5e53eeb-***) → Location `0dpAFAovcFXbe0G5TUFr`
> - Primary Care: `GHL_PRIMARY_CARE_API_KEY` (pit-9383d96a-***) → Location `NyfcCiwUMdmXafnUMML8`
> Do NOT implement OAuth token refresh for GHL — it is unnecessary and will break things.
>
> **Automated GHL Sync (Added March 31, 2026)**
> Cron endpoint: `GET /api/cron/ghl-sync/` (x-cron-secret auth)
> Runs every 2 hours at :30 — syncs pending, stale, and error patients to GHL.
> Uses `getPatientsNeedingSync(200)` → `syncMultiplePatients()` with 200ms rate limiting.
> File: `app/api/cron/ghl-sync/route.ts`

---

