# AI Agent Prompts - Official Current Version

## Jessica Voice AI (NOW Primary Care)

**File**: `/home/ec2-user/gmhdashboard/scripts/ghl-integration/JESSICA_CURRENT_PROMPT.md`

**Format**: Situation-Task-Objective-Knowledge (STOK)

**Hours**: Monday-Friday 9:00 AM - 5:00 PM (Closed weekends)

**Location**: 404 South Montezuma Street, Suite A, Prescott, AZ 86303

**Transfer to Human**: 928-277-0001

**Authentication**: Healthie-first verification
- Searches Healthie by phone number
- Requires caller name match against Healthie record
- Requires DOB match (if stored in Healthie)
- Fake names → transfer to human

**Key Features**:
- Rebranding awareness (formerly Granite Mountain Health Clinic)
- Caller ID intelligence
- Complete appointment scheduling workflow (Check Availability → Get Available Slots → Book Appointment Slot → Book Appointment)
- Prescription refill workflow with pharmacy search
- Lab/imaging results (dates only, never values)
- Routes TRT/men's health to NOW Men's Health Care (928-212-2772)

---

## Jessica Chatbot (NOW Primary Care - Text/SMS)

**File**: `/home/ec2-user/gmhdashboard/scripts/ghl-integration/JESSICA_CHATBOT_PROMPT.md`

**Format**: Situation-Task-Objective-Knowledge (STOK)

**Configuration Guide**: `/home/ec2-user/gmhdashboard/scripts/ghl-integration/CHATBOT_GHL_CONFIG.md`

**Channels**: Website Chat Widget, SMS

**Key Features**:
- Same capabilities as Voice AI (scheduling, verification, refills, billing)
- Text-optimized with emoji support
- Uses same webhook endpoints (port 3001)
- Reference prompt for GHL Conversation AI Bot

---

## SMS Chatbot Handler (Custom Integration)

**File**: `/home/ec2-user/gmhdashboard/scripts/ghl-integration/sms-chatbot-handler.js`

**Setup Guide**: `/home/ec2-user/gmhdashboard/scripts/ghl-integration/SMS_CHATBOT_SETUP.md`

**Port**: 3003 (proxied via port 3001 ngrok tunnel)

**Webhook URL**: `https://nowoptimal.ngrok.app/api/ghl/inbound-message`

**PM2 Service**: `sms-chatbot`

**Key Features**:
- Full Jessica AI capabilities via SMS/text
- AWS Bedrock Claude 3.5 Sonnet for intent classification
- Routes to existing webhook actions (port 3001)
- Conversation state management (30-minute TTL)
- Same Healthie/GHL integrations as Voice AI

**AI Model**: `us.anthropic.claude-3-5-sonnet-20241022-v2:0` (inference profile)

**Requires**: 
- AWS credentials configured (uses existing EC2 IAM role)
- GHL Workflow trigger for inbound SMS

**Architecture**:
```
Patient SMS → GHL → Inbound Webhook → Port 3001 (Proxy) → Port 3003 (Handler)
                                                                   ↓
                                                         AWS Bedrock Claude
                                                                   ↓
                                                         Execute Action (Port 3001)
                                                                   ↓
                                                         GHL API sendSMS → Patient
```

---

## Max (NOW Men's Health Care)

**File**: `/home/ec2-user/gmhdashboard/scripts/ghl-integration/MAX_CURRENT_PROMPT.md`

**Format**: Situation-Task-Objective-Knowledge (STOK)

**Hours**: 
- Monday: 1:00 PM - 6:00 PM
- Tuesday-Friday: 9:00 AM - 6:00 PM
- Saturday: 9:00 AM - 1:00 PM
- Sunday: Closed

**Location**: 215 North McCormick Street, Prescott, AZ 86301

**Phone**: 928-212-2772

**Key Features**:
- TRT and men's health specialist
- Creates patients in NowMensHealth.Care group (Healthie Group ID: 75522)
- 8 appointment types (TRT Initial, Refills, Pellets, Labs, Peptides)
- TRT prescription refill workflow
- Lab results (dates only, never testosterone levels)
- Routes primary care to NOW Primary Care
- Confident, discreet personality for sensitive topics

---

## Webhook Servers

| Service | Port | PM2 Name | Purpose |
|---------|------|----------|---------|
| Jessica Voice AI | 3001 | `ghl-webhooks` | Voice AI custom actions |
| Max Voice AI | 3006 | `max-webhooks` | Men's Health voice actions |
| SMS Chatbot | 3003 | `sms-chatbot` | SMS/Chat AI processing |
| Jessica MCP | 3002 | `jessica-mcp` | MCP protocol server |

**Ngrok Tunnel**: `https://nowoptimal.ngrok.app` → Port 3001

---

## Deployment Instructions

### For GHL Voice AI Configuration:

1. **Jessica Voice AI**:
   - Copy entire contents of `JESSICA_CURRENT_PROMPT.md`
   - Paste into GHL → AI Agents → Jessica → Instructions
   - Configure 13 custom actions (webhooks to `https://nowoptimal.ngrok.app`)
   - Link to primary care phone number
   - Set transfer number to 928-277-0001

2. **Max Voice AI**:
   - Copy entire contents of `MAX_CURRENT_PROMPT.md`
   - Paste into GHL → AI Agents → Max → Instructions
   - Configure 13 custom actions (webhooks to port 3006)
   - Link to phone 928-212-2772

### For SMS Chatbot:

1. **Ensure services running**:
   ```bash
   pm2 status  # Verify sms-chatbot and ghl-webhooks online
   ```

2. **AWS Credentials** (uses EC2 IAM Role - no key config needed):
   ```bash
   # Verify IAM role is attached to EC2 instance
   # Role needs: bedrock:InvokeModel permission
   ```

3. **Create GHL Workflow**:
   - Trigger: Customer Reply (SMS)
   - Action: Webhook POST to `https://nowoptimal.ngrok.app/api/ghl/inbound-message`
   - Payload: See `SMS_CHATBOT_SETUP.md`

---

## Healthie Integration

| Agent | Healthie Group | Group ID | Provider ID |
|-------|----------------|----------|-------------|
| **Jessica** | NowPrimary.Care | 75523 | 12088269 |
| **Max** | NowMensHealth.Care | 75522 | 12093125 |

---

## Custom Actions Mapping

Jessica Voice AI has **13 webhook endpoints** for custom actions:

| # | Action | Endpoint | Purpose |
|---|--------|----------|---------|
| 1 | Verify Patient | `/api/ghl/verify-patient` | Verify identity (name + DOB) vs Healthie |
| 2 | Create Patient | `/api/ghl/create-new-patient` | Create new patient in Healthie |
| 3 | Send Registration Link | `/api/ghl/send-registration-link` | SMS registration info to new patients |
| 4 | Get Availability | `/api/ghl/get-availability` | Get available appointment slots |
| 5 | Book Appointment | `/api/ghl/book-appointment` | Book appointment in Healthie |
| 6 | Check Lab Results | `/api/ghl/check-lab-results` | Check lab dates (never values) |
| 7 | Request Prescription Refill | `/api/ghl/request-prescription-refill` | Submit refill request |
| 8 | Find Pharmacy | `/api/ghl/find-pharmacy` | Search pharmacies by zip code |
| 9 | Request Provider Callback | `/api/ghl/send-provider-message` | Provider callback request |
| 10 | Check Patient Balance | `/api/ghl/patient-balance` | Check account balance |
| 11 | Send Payment Link | `/api/ghl/send-payment-link` | Send Stripe payment link |
| 12 | Transfer Call | `/api/ghl/transfer-call` | Transfer to human (front desk/men's health) |

**Internal Endpoints (not GHL Voice AI actions):**
| Endpoint | Purpose |
|----------|---------|
| `/api/ghl/inbound-message` | Proxies SMS to Chatbot handler (port 3003) |
| `/health` | Health check endpoint |



---

## Environment Variables

Key variables in `/home/ec2-user/.env.production`:

```bash
# GHL Integration
GHL_V2_API_KEY=pit-...
GHL_LOCATION_ID=NyfcCiwUMdmXafnUMML8
GHL_WEBHOOK_SECRET=960dd12a...

# Healthie
HEALTHIE_API_KEY=gh_live_...
HEALTHIE_PRIMARY_CARE_GROUP_ID=75523
HEALTHIE_PRIMARY_CARE_PROVIDER_ID=12088269

# SMS Chatbot (uses AWS Bedrock Claude - no separate API key needed)
SMS_CHATBOT_PORT=3003
WEBHOOK_BASE_URL=http://localhost:3001
# AWS credentials via EC2 IAM role (no keys in .env)
```

---

## File Locations Summary

```
/home/ec2-user/gmhdashboard/scripts/ghl-integration/
├── AI_PROMPTS_SOURCE_OF_TRUTH.md    # This file
├── JESSICA_CURRENT_PROMPT.md        # Voice AI prompt
├── JESSICA_CHATBOT_PROMPT.md        # Chat prompt (reference)
├── MAX_CURRENT_PROMPT.md            # Max Voice AI prompt
├── webhook-server.js                # Jessica webhooks (port 3001)
├── max-webhook-server.js            # Max webhooks (port 3006)
├── sms-chatbot-handler.js           # SMS chatbot (port 3003)
├── ghl-client.js                    # GHL API client
├── SMS_CHATBOT_SETUP.md             # SMS setup guide
├── CHATBOT_GHL_CONFIG.md            # Conversation AI config
└── GHL_CONFIG_CHECKLIST.md          # Original checklist
```

---

## Telegram AI Bot (NOWJarvis)

**File**: `/home/ec2-user/gmhdashboard/scripts/telegram-ai-bot-v2.ts`  
**PM2 Process**: `telegram-ai-bot-v2`

### Connected Data Sources:
| Source | Access Method |
|--------|---------------|
| Snowflake | Natural language queries via AI |
| Healthie API | Real-time patient financial data |
| PostgreSQL | Dashboard data via `/dashboard` command |
| GoHighLevel | Men's Health contacts via `/ghl` command |

### Commands:
- `/help` - Show help menu
- `/ghl` - Show Men's Health existing patients from GHL
- `/dashboard [SQL]` - Query PostgreSQL directly
- `/datasources` - List connected data sources
- `/status` - System status
- `/schema-gaps` - Show missing data requests
- `/refresh-schema` - Re-discover Snowflake schema

### Formatting Rules:
- Dates: **MM-DD-YYYY** format
- Currency: **$X.XX** format
- Testosterone/Vials: **mL** (not dollars!)
- AI asks for clarification when time ranges are ambiguous

---

## Healthie Payment Alerts

**File**: `/home/ec2-user/gmhdashboard/scripts/process-healthie-webhooks.ts`

### Declined Payment Detection:
When a payment has status containing: `failed`, `declined`, `error`, `rejected`, `cancelled`, `card_error`

**Alerts sent to:**
1. **Telegram** - Immediate notification to configured chat
2. **Google Spaces** - ops-billing space (requires `GOOGLE_CHAT_WEBHOOK_OPS_BILLING` env var)

### Required Environment Variables:
```
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_APPROVAL_CHAT_ID=your_chat_id
GOOGLE_CHAT_WEBHOOK_OPS_BILLING=https://chat.googleapis.com/v1/spaces/xxx/messages?key=xxx
```

---

## Infrastructure Monitoring

**File**: `/home/ec2-user/scripts/monitoring/health_monitor.py`  
**Cron**: Every 5 minutes

### Monitors:
- PM2 service status (crash loops, down services)
- CPU/Memory usage
- **Snowflake data freshness** (alerts if billing data >2 days old)

### Alerts Via Telegram When:
- Service down or crashing
- High CPU (>80%) or Memory (>85%)
- Snowflake billing data is stale (sync failure)

---

## Cost Reporting

**File**: `/home/ec2-user/scripts/monitoring/daily_cost_report.py`  
**Cron**: Daily at 8 AM

### Reports Include:
- AWS costs (EC2, RDS, Bedrock AI, etc.)
- Snowflake credit usage
- SaaS subscriptions (GHL $97, Healthie $149, Ngrok $8)
- **Total monthly cost estimate**

---

## Data Sync (Healthie → Snowflake)

**Cron Job**: Every 6 hours at :30
```bash
30 */6 * * * cd /home/ec2-user/gmhdashboard && /usr/bin/npx tsx scripts/sync-healthie-billing-items.ts
```

**Log**: `/home/ec2-user/logs/billing-sync.log`

---

Last Updated: 2026-01-04

