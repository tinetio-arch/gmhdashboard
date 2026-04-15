|------|-----|-------|
| Primary | `#060F6A` | Buttons, nav, headers |
| Secondary | `#00A550` | Success states, accents |
| Accent | `#25C6CA` | CTAs, highlights |
| Background | `#F8FAFC` | App light theme |

#### NOW Longevity (Soft Sage / Earthy Calm)
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#6B8F71` | Buttons, accents, mobile app |
| Dark | `#4A6B50` | Nav, headers, status bar |
| Light | `#A3C4A8` | CTAs, highlights, hover |
| Background | `#1E2E20` | App dark theme |
| Text on dark | `#A3C4A8` | Headings on dark bg |
| Text on light | `#2D3B2E` | Text on light surfaces |

> **Theme Preview**: `/home/ec2-user/.tmp/longevity-theme-preview.html`

#### NOW Mental Health (Website updated March 26, 2026)
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#C2703E` | Buttons, accents, website terracotta |
| Dark | `#9A5530` | CTAs, gradients |
| Light | `#E8A87C` | Hover, highlights |
| Navy | `#2D3A4A` | Footer, quote sections, dark buttons |
| Background | `#FBF7F4` | Website light theme (editorial) |
| Mobile Primary | `#7C3AED` | Mobile app stays purple |

> **Website redesign**: Editorial style with Playfair Display serif headings, Unsplash photography, warm terracotta accents on light cream background. Footer uses dark navy `#2D3A4A`. All 11 visit types with real pricing. No Spravato.

#### ABX TAC
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#3A7D32` | Buttons, accents, mobile app |
| Dark | `#2D5A27` | Nav, headers |
| Light | `#4CAF50` | Hover, highlights |
| Background | `#050505` | App dark theme |

#### NOW Optimal Wellness (Hub)
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#00D4FF` | Buttons, accents |
| Secondary | `#FFD700` | Gold accent |
| Background | `#0A0E1A` | App dark theme |

### Master Appointment Type Registry (Live in Healthie — 28 Types)

> **Queried from Healthie API on March 25, 2026.** These are the REAL IDs.

#### Video-Enabled Types (Telehealth already works)
| ID | Name | Duration | Price | Contact Types |
|----|------|----------|-------|--------------|
| `505645` | NMH General TRT Telemedicine | 30 min | — | Healthie Video Call |
| `505646` | Telemedicine Sick Consult | 30 min | $79 | Healthie Video Call |
| `504715` | In-Person Sick Visit | 50 min | $129 | Video Call + In Person |
| `504717` | Weight Loss Consult | 45 min | $99 | Video Call + In Person |

#### In-Person Only Types (24 Types)
| ID | Name | Duration | Price | Brand |
|----|------|----------|-------|-------|
| `504725` | Initial Male Hormone Replacement Consult | 30 min | — | Men's Health |
| `504726` | Initial Female Hormone Replacement Therapy Consult | 30 min | — | Primary Care |
| `504727` | EvexiPel Initial Pelleting Male | 60 min | — | Longevity |
| `504728` | EvexiPel Repeat Pelleting Male | 45 min | — | Longevity |
| `504730` | EvexiPel Initial Pelleting Female | 60 min | — | Longevity |
| `504729` | EvexiPel Repeat Pelleting Female | 45 min | — | Longevity |
| `504731` | Weight Loss Education & Measurements | 45 min | — | Longevity |
| `504732` | 5 Week Lab Draw | 15 min | — | Men's Health |
| `504734` | 90 Day Lab Draw | 20 min | — | Men's Health |
| `504735` | NMH TRT Supply Refill | 20 min | — | Men's Health |
| `504736` | NMH Peptide Education & Pickup | 20 min | — | Men's Health |
| `504716` | Skin Laceration & Wound Care | 60 min | — | Primary Care |
| `504718` | Sports Physical | 45 min | — | Primary Care |
| `504719` | Medical Clearance Physical | 45 min | — | Primary Care |
| `504741` | TB Test Administration | 15 min | — | Primary Care |
| `504743` | Initial Primary Care Consult | 60 min | — | Primary Care |
| `505647` | IV Therapy Good Faith Exam | 15 min | $50 | Longevity |
| `505648` | Allergy Injection Consult | 20 min | $55 | Primary Care |
| `505649` | Injection | 25 min | — | Primary Care |
| `504759` | Elite Membership Initial PC Consult | 30 min | $250 | Primary Care |
| `504760` | Premier Membership Initial PC Consult | 30 min | $250 | Primary Care |
| `511049` | NMH Mens Health Annual Lab Draw | 15 min | — | Men's Health |
| `511050` | NowPrimary.Care Annual Lab Draw | 15 min | — | Primary Care |
| `511073` | Migrated Appointment | 15 min | — | System (hidden) |
| `520702` | Male HRT Follow-Up | 30 min | — | Men's Health |
| `520703` | PC Follow-Up | 30 min | — | Primary Care |

### Telehealth Appointment Types — TO CREATE

> [!CAUTION]
> **These types do NOT exist yet.** They need to be created in Healthie via `createAppointmentType` mutation. DO NOT create without user approval.

#### Men's Health Telehealth (New)
| Name | Duration | Price | Contact Type |
|------|----------|-------|-------------|
| Initial Male HRT Consult - Telehealth | 30 min | Free | Healthie Video Call |
| Male HRT Consult - Telehealth | 30 min | $180 | Healthie Video Call |
| Lab Review Telemedicine | 30 min | Included | Healthie Video Call |
| Annual Lab Review Telemedicine | 30 min | Included | Healthie Video Call |
| 90-Day Lab Review Telemedicine | 30 min | Included | Healthie Video Call |

#### Primary Care Telehealth (New)
| Name | Duration | Price | Contact Type |
|------|----------|-------|-------------|
| Initial PC Consult - Telehealth | 45 min | $150 | Healthie Video Call |
| PC Follow-Up - Telehealth | 30 min | $99 | Healthie Video Call |
| Elite Membership Consult - Telehealth | 30 min | $250 | Healthie Video Call |
| Premier Membership Consult - Telehealth | 30 min | $250 | Healthie Video Call |
| Female HRT Consult - Telehealth | 30 min | $250 | Healthie Video Call |
| Medication Management - Telehealth | 20 min | $75 | Healthie Video Call |

#### Longevity Telehealth (New)
| Name | Duration | Price | Contact Type |
|------|----------|-------|-------------|
| Longevity Consultation | 45 min | $199 | Video Call + In Person |
| Longevity Follow-Up - Telehealth | 30 min | $99 | Healthie Video Call |
| Peptide Therapy Consult - Telehealth | 30 min | $99 | Healthie Video Call |
| Weight Loss Follow-Up - Telehealth | 20 min | $75 | Healthie Video Call |

#### Mental Health (All New — In-Person + Telehealth)
| Name | Duration | Price | Contact Type |
|------|----------|-------|-------------|
| Initial Mental Health Consultation | 60 min | Free | Video Call + In Person |
| Individual Therapy Session | 50 min | $150 | Video Call + In Person |
| Medication Management (Psychiatric) | 30 min | $99 | Video Call + In Person |
| Psychiatric Follow-Up - Telehealth | 20 min | $75 | Healthie Video Call |
| Ketamine Therapy Consultation | 45 min | Free | In Person only |
| Ketamine IV Infusion | 90 min | $450 | In Person only |
| Group Therapy Screening | 30 min | Free | In Person only |
| Group Therapy Session | 60 min | $75 | In Person only |
| Crisis Assessment - Telehealth | 30 min | Free | Healthie Video Call |

#### ABX TAC (New)
| Name | Duration | Price | Contact Type |
|------|----------|-------|-------------|
| ABX TAC Peptide Consultation - Telehealth | 25 min | Free | Healthie Video Call |

### Telehealth Video Architecture

**Technology**: Healthie Native Video (OpenTok / Vonage WebRTC)
**Cost**: $0 (included in Healthie Enterprise plan)

**How it works (fully headless — no Healthie portal required):**

1. Appointment created with `contact_type = "Healthie Video Call"`
2. Healthie generates an OpenTok video session for that appointment
3. Query appointment via GraphQL to get:
   - `session_id` — OpenTok session identifier
   - `generated_token` — One-time auth token
4. Initialize video with **Vonage API Key: `45624682`** (Healthie's public key)
5. Both patient (mobile app) and provider (iPad) connect to same session
6. Audio can be captured from MediaStream for Scribe (Phase 2)

**Patient app (iPhone/Android):**
- `opentok-react-native` or `@vonage/client-sdk-video` package
- New `VideoCallScreen.tsx` — fully native, NOW Optimal branded
- "Join Video Call" button on `AppointmentsScreen.tsx` (active 15 min before)
- Requires custom Expo dev client (not Expo Go) for native camera/mic

**Provider app (iPad):**
- Vonage Web SDK (`@vonage/client-sdk-video` for browser)
- "Start Video Call" button on schedule tab for telehealth appointments
- Opens in modal overlay within iPad app
- Scribe runs on iPad mic simultaneously (Phase 1)

**Lambda changes:**
- New action: `get_video_session` — queries `session_id` + `generated_token` from appointment
- Returns: `{ sessionId, token, apiKey: "45624682" }`
- Security gate: only works within 15 min of appointment start time

### Form Architecture (Groups + Services)

| Form Type | Trigger | Scope |
|-----------|---------|-------|
| **Onboarding Flow** (group-level) | Auto-sent when patient joins group | HIPAA, Consent, AI Disclosure, brand-specific medical history |
| **Requested Form Completion** | Sent when specific appointment booked | Pelleting consent, Weight Loss agreement, Mental Health screening |
| **Appointment-linked forms** | Auto-attached to appointment type | Pre-visit questionnaire, follow-up survey |

**Onboarding Flows by Brand:**
| Brand | Flow Contents |
|-------|--------------|
| Men's Health | HIPAA + Consent + AI Disclosure + Men's Health History + HRT Intake |
| Primary Care | HIPAA + Consent + AI Disclosure + Medical History |
| Longevity | HIPAA + Consent + AI Disclosure + Wellness Questionnaire |
| Mental Health | HIPAA + Consent + AI Disclosure + PHQ-9 + GAD-7 + Mental Health Screening |
| ABX TAC | HIPAA + Consent + AI Disclosure + Peptide Health Screening |

**Service-Specific Forms (triggered by appointment booking):**
| Service | Form | Trigger |
|---------|------|---------|
| EvexiPel Pelleting | Pelleting Consent Form | Books EvexiPel appointment |
| Weight Loss | Weight Loss Program Agreement | Books Weight Loss Consult |
| Ketamine | Ketamine Informed Consent | Books Ketamine Consultation |
| IV Therapy | IV Therapy Consent | Books IV Therapy GFE |

### Tag → Appointment Type Mapping

| Tag | Unlocks Appointment Types | Cross-Brand? |
|-----|--------------------------|-------------|
| `pelleting` | EvexiPel Male/Female Initial + Repeat | Yes — MH patients can book pellets |
| `weight-loss` | Weight Loss Consult, WL Education, WL Follow-Up Tele | Yes |
| `peptides` | Peptide Education & Pickup, Peptide Therapy Consult Tele | Yes |
| `iv-therapy` | IV Therapy Good Faith Exam | Yes |
| `telehealth` | (Deprecated — all groups get telehealth types natively) | N/A |

### Provider Telehealth Capability

| Provider | Healthie ID | Telehealth? | Brands |
|----------|------------|------------|--------|
| Dr. Aaron Whitten, NMD | 12093125 | Yes | Men's Health, Longevity, Wellness, ABX TAC |
| Phil Schafer, FNP-C | 12088269 | Yes | Primary Care, Longevity |
| Mental Health Provider (TBD) | TBD | Yes | Mental Health |

### Arizona-First Telehealth

Initial telehealth launch is **Arizona patients only**. Multi-state expansion requires:
- Provider licensure in patient's state (NLC for Phil, IMLC for Dr. Whitten)
- DEA registration in patient's state for controlled substances (testosterone = Schedule III)
- State validation in booking flow (future feature)

---

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

## System Access Credentials (Updated Feb 19, 2026)

### Healthie EMR Login
- **URL**: https://healthie.com
- **Email**: admin@granitemountainhealth.com
- **Password**: (see `.env.local`)

### GoHighLevel CRM Login
- **URL**: https://app.gohighlevel.com
- **Email**: phil@tricitymenshealth.com
- **Password**: (see `.env.local`)

### Patient Creation Integration Status
- **Database**: ✅ IMPLEMENTED - Clinic field added, Healthie client ID field added
- **Form**: ✅ IMPLEMENTED - Clinic dropdown added (NOW Primary Care / NOW Men's Health)
- **Healthie Sync**: ✅ IMPLEMENTED - Auto-creates patients in correct group based on clinic
- **GHL Sync**: ✅ IMPLEMENTED - Auto-creates patients in correct location based on clinic
- **Men's Health Tag**: ✅ IMPLEMENTED - Automatically adds 'existing' tag to Men's Health patients in GHL

---

## 📦 UPS Shipping Integration (March 5, 2026)

**Purpose**: Ship medical supplies (TRT kits, syringes, etc.) to patients directly from the patient profile page.

### UPS Developer Account
- **Client ID**: `UPS_CLIENT_ID` in `.env.local`
- **Account Number**: `158V7K`
- **Billing**: Account #158V7K
- **API Products Enabled**: Rating, Address Validation, Authorization (OAuth), Tracking, Shipping, Locator, Time In Transit, Smart Pickup, UPS SCS Transportation

### Verified API Endpoints (Production: `https://onlinetools.ups.com`)
| API | Method | Path | Status |
|-----|--------|------|--------|
| OAuth | POST | `/security/v1/oauth/token` | ✅ |
| Address Validation | POST | `/api/addressvalidation/v1/3` | ✅ |
| Rating | POST | `/api/rating/v2403/Rate` (or `/Shop`) | ✅ |
| Shipping | POST | `/api/shipments/v2409/ship` | ✅ |
| Tracking | GET | `/api/track/v1/details/{trackingNumber}` | ✅ |
| Void | DELETE | `/api/shipments/v2409/void/cancel/{id}` | ✅ |

### Files
- **API Client**: `lib/ups.ts` — OAuth2 token management, address validation, rating, shipping, tracking, void
- **DB Queries**: `lib/upsShipmentQueries.ts` — CRUD for `ups_shipments` table
- **API Routes**: `app/api/ups/` — validate-address, rate, ship, track, shipments, void
- **Frontend**: `app/patients/[id]/ShippingPanel.tsx` — shipping UI component in patient profile
- **Migration**: `migrations/20260305_ups_shipments.sql`

### Default Package Settings
- **Weight**: 0.4 lbs
- **Dimensions**: 12" × 8" × 3"
- **Service**: UPS Ground (code `03`)
- **Shipper**: NOW Men's Health, 215 N McCormick, Prescott AZ 86301

### Environment Variables
`UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER`, `UPS_SHIPPER_NAME`, `UPS_SHIPPER_PHONE`, `UPS_SHIPPER_ADDRESS_LINE1`, `UPS_SHIPPER_CITY`, `UPS_SHIPPER_STATE`, `UPS_SHIPPER_POSTAL`, `UPS_SHIPPER_COUNTRY`

### Database
Table: `ups_shipments` (24 columns, 3 indexes on patient_id, tracking_number, status)

---

*Last Updated: March 5, 2026*
*Maintained by: AntiGravity AI Assistant + manual updates*
*Update this document after any significant system changes.*

