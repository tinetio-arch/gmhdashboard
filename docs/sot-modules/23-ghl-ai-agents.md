## 🤖 GHL AI Agents (Jessica & Max)

**Full SOT**: `/home/ec2-user/gmhdashboard/scripts/ghl-integration/AI_PROMPTS_SOURCE_OF_TRUTH.md` (337 lines)  
**Prompt Directory**: `/home/ec2-user/gmhdashboard/scripts/ghl-integration/`

### AI Agents Overview

| Agent | Brand | Role | Phone | Hours |
|-------|-------|------|-------|-------|
| **Jessica** (Voice) | NowPrimary.Care | Front desk — scheduling, verification, refills, billing | (928) 756-0070 | M-F 9-5 |
| **Jessica** (Chat) | NowPrimary.Care | Same capabilities via SMS/website chat | SMS | 24/7 |
| **Max** (Voice) | NowMensHealth.Care | TRT specialist — scheduling, refills, labs | (928) 212-2772 | M 1-6, Tu-F 9-6, Sa 9-1 |
| **SMS Chatbot** | NowPrimary.Care | Full Jessica AI via SMS (Bedrock Claude 3.5 Sonnet) | SMS | 24/7 |
| **NOWJarvis** | Internal | Telegram ops bot — Snowflake/Healthie/GHL queries | Telegram | 24/7 |

### Webhook Servers

| Service | Port | PM2 Name | File |
|---------|------|----------|------|
| Jessica Voice AI | 3001 | `ghl-webhooks` | `webhook-server.js` |
| Jessica MCP | 3002 | `jessica-mcp` | MCP protocol server |
| SMS Chatbot | 3003 | `sms-chatbot` | `sms-chatbot-handler.js` |
| Max Voice AI | 3006 | `max-webhooks` | `max-webhook-server.js` |

**Ngrok Tunnel**: `https://nowoptimal.ngrok.app` → Port 3001

### Jessica's 13 Custom Actions

| # | Action | Endpoint | Purpose |
|---|--------|----------|---------|
| 1 | Verify Patient | `/api/ghl/verify-patient` | Name + DOB vs Healthie |
| 2 | Create Patient | `/api/ghl/create-new-patient` | New patient in Healthie |
| 3 | Send Registration | `/api/ghl/send-registration-link` | SMS registration info |
| 4 | Get Availability | `/api/ghl/get-availability` | Available appointment slots |
| 5 | Book Appointment | `/api/ghl/book-appointment` | Book in Healthie |
| 6 | Check Lab Results | `/api/ghl/check-lab-results` | Lab dates (never values) |
| 7 | Rx Refill | `/api/ghl/request-prescription-refill` | Submit refill request |
| 8 | Find Pharmacy | `/api/ghl/find-pharmacy` | Search by zip code |
| 9 | Provider Callback | `/api/ghl/send-provider-message` | Callback request |
| 10 | Check Balance | `/api/ghl/patient-balance` | Account balance |
| 11 | Send Payment Link | `/api/ghl/send-payment-link` | Stripe payment link |
| 12 | Transfer Call | `/api/ghl/transfer-call` | Transfer to human |

### Healthie Group Mapping

| Agent | Healthie Group | Group ID | Provider ID |
|-------|---------------|----------|-------------|
| Jessica | NowPrimary.Care | `75523` | `12088269` |
| Max | NowMensHealth.Care | `75522` | `12093125` |

### SMS Chatbot Architecture
```
Patient SMS → GHL → Webhook → Port 3001 (Proxy) → Port 3003 (Handler)
                                                       ↓
                                              AWS Bedrock Claude 3.5 Sonnet
                                                       ↓
                                              Execute Action (Port 3001)
                                                       ↓
                                              GHL API sendSMS → Patient
```

**AI Model**: `us.anthropic.claude-3-5-sonnet-20241022-v2:0` (inference profile)  
**Conversation TTL**: 30 minutes  
**AWS Auth**: EC2 IAM role (no API keys in .env)

### NOWJarvis Telegram Bot

**File**: `/home/ec2-user/gmhdashboard/scripts/telegram-ai-bot-v2.ts`  
**PM2**: `telegram-ai-bot-v2`

| Command | Purpose |
|---------|---------|
| `/help` | Show help |
| `/ghl` | Men's Health patients from GHL |
| `/dashboard [SQL]` | Query PostgreSQL |
| `/datasources` | List connected sources |
| `/status` | System status |
| `/schema-gaps` | Missing data requests |
| `/refresh-schema` | Re-discover Snowflake schema |

**Data Sources**: Snowflake (NLP queries), Healthie API (real-time financials), PostgreSQL (dashboard data), GHL (contacts)

### JARVIS Mobile App (Patient-Facing AI Assistant) — Updated April 6, 2026

**Architecture**: React Native (Expo) → API Gateway → Lambda (`lambda-ask-ai`) → Gemini 2.5 Flash + Snowflake
**AI Model**: Google Gemini 2.5 Flash (migrated from 2.0 Flash on April 6, 2026 — Google deprecated 2.0)
**API Gateway**: `https://o6rhh3wva6.execute-api.us-east-2.amazonaws.com/prod`
**Lambda**: `NowOptimalHeadlessStack-AskAiLambda160D5144-qEQQ3FQOm7TG`

**Source files** (`/home/ec2-user/.gemini/antigravity/scratch/nowoptimal-headless-app/backend/lambda-ask-ai/src/`):

| File | Lines | Purpose |
|------|-------|---------|
| `index.js` | 170 | Router orchestrator — classifies intent, routes to handler |
| `gemini.js` | 285 | Gemini 2.5 Flash integration — intent classification + answer generation |
| `snowflake.js` | 301 | Snowflake PATIENT_360_VIEW queries with JWT key-pair auth |
| `router.js` | 143 | Intent routing, suggested actions, loading messages |
| `booking-handler.js` | 425 | Multi-turn booking flow with conversation history recovery |
| `peptide-bot.js` | 440 | Peptide info/ordering with pickup vs ship channels |
| `trt-bot.js` | 340 | TRT education + personal supply status calculation |
| `share-handler.js` | 60 | Share conversation with care team (Google Chat + Healthie chart note) |

**13 Intents**: greeting, health_data, billing_inquiry, trt_question, trt_status, peptide_info, peptide_order, book_appointment, check_availability, cancel_appointment, refill_request, general

**Key fixes (April 6, 2026)**:
- Gemini 2.0 Flash → 2.5 Flash (Google deprecated 2.0)
- Secrets Manager `GOOGLE_AI_API_KEY` updated (old key was revoked)
- Secrets Manager `JARVIS_SHARED_SECRET` created (was missing — broke share + peptide ordering)
- Booking flow: conversation history recovery for multi-turn state (was losing appointment type between turns)
- Peptide eligibility: fixed SQL crash (`first_name`/`last_name` → `full_name`)
- All dates formatted to Phoenix (Arizona) time
- General questions: clinic hours, phone numbers, and service info added to system prompt
- Cancel appointment: now fetches and shows upcoming appointments
- `createAppointment` dual-provider bug: `other_party_id` fix applied to booking Lambda

**Dashboard endpoints used by Jarvis** (`/api/jarvis/`):
- `share/` — Share conversation (Google Chat + Healthie chart note)
- `peptide-eligibility/` — Check pickup/ship eligibility
- `peptides/` — Peptide product catalog
- `peptide-order/` — Submit peptide order
- `balance/` — Patient account balance
- `payment-link/` — Generate payment link

### Key Deployment Notes

- Jessica/Max prompts use **STOK format** (Situation-Task-Objective-Knowledge)
- **Transfer number** (Primary Care): 928-277-0001
- **Never share**: Lab result values, testosterone levels — dates only
- **Rebranding**: Jessica knows "Granite Mountain Health Clinic" → "NOW Primary Care"
- **GHL AI Prompts SOT last updated**: January 4, 2026 (may need refresh)

---

