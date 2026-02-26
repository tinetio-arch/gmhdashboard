# JESSICA SYSTEM DEEP DIVE AUDIT
## Created: 2026-01-04 18:42 MST

---

# PART 1: GHL API DEEP DIVE

## What GHL API Does (and Doesn't Do)

### GHL API Capabilities (Our GHL Client - ghl-client.js)

| Method | Endpoint | Purpose | Used By |
|--------|----------|---------|---------|
| `searchContacts` | `/contacts/?query=X` | Find contact by phone/email | All endpoints |
| `createContact` | `/contacts/` | Create new GHL contact | Registration, Create Patient |
| `updateContact` | `/contacts/:id` | Update contact fields | Various |
| `sendSMS` | `/conversations/messages` | Send SMS to contact | SMS responses, registration |
| `addTag` | `/contacts/:id/tags` | Add tags to contact | Tracking |

### GHL API Limitations

1. **GHL is NOT our patient database** - It's just a contact/messaging system
2. **GHL V2 API doesn't support custom field format** - We strip customField to avoid 422 errors
3. **GHL sendSMS requires valid contactId** - Can't SMS without finding/creating contact first
4. **Rate limiting** - Unknown limits, we added our own 60-second rate limiting

### Our GHL Client Configuration:
```javascript
API Base: https://services.leadconnectorhq.com  (V2)
Location ID: NyfcCiwUMdmXafnUMML8
Auth: Bearer token (GHL_V2_API_KEY)
```

---

# PART 2: GHL VOICE AI DEEP DIVE

## How GHL Voice AI Custom Actions Work

### The Flow:
```
1. Call comes in → GHL Voice AI answers
2. AI talks to caller using LLM (GPT-based)
3. AI decides to call a Custom Action
4. GHL sends POST request to our webhook URL
5. Our webhook processes and returns JSON response
6. AI (theoretically) reads response and speaks accordingly
```

### GHL Voice AI Limitations (CONFIRMED BY RESEARCH)

1. **No True Response Mapping** - GHL Voice AI can SEND webhook requests, but 
   "the ability to dynamically consume and fully map webhook *responses* back 
   into complex, real-time AI decision-making within the live conversation 
   appears to be a continually developing area"

2. **LLM Hallucination** - The AI may say "verified" even before calling the 
   action, or ignore the response completely

3. **Variable Substitution Issues** - `{{contact.phone}}` sometimes sent as 
   literal text instead of being substituted

4. **Multiple Action Calls** - AI may call same action multiple times in 
   quick succession

5. **Prompt Adherence** - LLM may not follow complex prompt instructions 
   (e.g., "read the response" or "say exactly this text")

### Custom Actions Configured in GHL

Per our Source of Truth, these are the expected actions:

| # | Action Name | Webhook Endpoint | Parameters |
|---|-------------|------------------|------------|
| 1 | Verify Patient | `/api/ghl/verify-patient` | phone, name, dob |
| 2 | Check Availability | `/api/ghl/get-availability` | appointment_type |
| 3 | Book Appointment | `/api/ghl/book-appointment` | phone, slot_id, appointment_type, first_name, last_name, email |
| 4 | Get Lab Status | `/api/ghl/check-lab-results` | phone |
| 5 | Create Patient | `/api/ghl/create-new-patient` | first_name, last_name, email, phone, dob |
| 6 | Request Prescription Refill | `/api/ghl/request-prescription-refill` | medication, pharmacy, urgency |
| 7 | Request Provider Callback | `/api/ghl/send-provider-message` | message_type, patient_phone |
| 8 | Check Patient Balance | `/api/ghl/patient-balance` | phone |
| 9 | Send Payment Link | `/api/ghl/send-payment-link` | phone, amount |
| 10 | Get Available Slots | `/api/ghl/get-availability` | appointment_type, service_line |
| 11 | Find Pharmacy | `/api/ghl/find-pharmacy` | zip_code |
| 12 | Send Registration Link | `/api/ghl/send-registration-link` | phone |
| 13 | Transfer Call | Built-in | destination |

---

# PART 3: OUR SYSTEM DEEP DIVE

## Architecture Overview

```
                    INBOUND CALL
                         │
                         ▼
              ┌──────────────────┐
              │   GHL Voice AI   │
              │   (LLM/GPT)      │
              └────────┬─────────┘
                       │ Custom Actions (POST)
                       ▼
              ┌──────────────────┐      ┌──────────────────┐
              │   ngrok tunnel   │ ──── │  Port 3001       │
              │ nowoptimal.app   │      │  webhook-server  │
              └──────────────────┘      └────────┬─────────┘
                                                 │
                       ┌─────────────────────────┼─────────────────┐
                       │                         │                  │
                       ▼                         ▼                  ▼
              ┌────────────────┐        ┌────────────────┐   ┌────────────────┐
              │   HEALTHIE     │        │   GHL API      │   │   SMS Chatbot  │
              │   GraphQL API  │        │   (sendSMS)    │   │   Port 3003    │
              └────────────────┘        └────────────────┘   └────────────────┘
                                                                    │
                                                                    ▼
                                                           ┌────────────────┐
                                                           │  AWS Bedrock   │
                                                           │  Claude 3.5    │
                                                           └────────────────┘
```

## Webhook Server Endpoints (Port 3001)

### File: webhook-server.js (1603 lines)

| Endpoint | Function | Data Source | Key Logic |
|----------|----------|-------------|-----------|
| `/api/ghl/verify-patient` | Verify identity | **HEALTHIE** | Search by phone, match name/DOB |
| `/api/ghl/get-availability` | Get slots | **HEALTHIE** | Filter by location, date >= Jan 13 |
| `/api/ghl/book-appointment` | Book appt | **HEALTHIE** | Verification gate, date gate |
| `/api/ghl/send-registration-link` | Send text | GHL SMS | Rate limited (60s) |
| `/api/ghl/create-new-patient` | Create patient | **HEALTHIE** | Creates in Healthie first |
| `/api/ghl/check-lab-results` | Lab dates | **HEALTHIE** | Dates only, never values |
| `/api/ghl/patient-balance` | Get balance | **HEALTHIE** | Balance lookup |
| `/api/ghl/send-payment-link` | Payment link | GHL SMS | Sends Stripe link |
| `/api/ghl/request-prescription-refill` | Refill request | **HEALTHIE** | Creates task |
| `/api/ghl/send-provider-message` | Message provider | **HEALTHIE** | Healthie messaging |
| `/api/ghl/find-pharmacy` | Find pharmacy | Google Places | Zip code search |
| `/api/ghl/inbound-message` | SMS handler | Proxy | Forwards to port 3003 |

## SMS Chatbot Handler (Port 3003)

### File: sms-chatbot-handler.js (727 lines)

| Function | Purpose |
|----------|---------|
| `findPatientByPhone` | Search HEALTHIE for patient |
| `createPatient` | Create patient in HEALTHIE |
| `verifyPatientIdentity` | Match name/DOB against HEALTHIE |
| `processWithAI` | Call AWS Bedrock Claude |
| `sendSMS` | Send response via GHL |

### Key Safety Gates in SMS Chatbot:

1. **Healthie-First Lookup** (line 494-510): Always search Healthie by phone
2. **Verification Override** (line 548): If AI says "verified" but Healthie check fails, OVERRIDE the response
3. **Medical Action Gate** (line 555-580): Block appointment/lab/refill actions if not verified

---

# PART 4: VERIFICATION FLOW ANALYSIS

## Voice AI Verification (verify-patient endpoint)

```
1. Receive: phone, name, dob
2. Normalize phone to E.164
3. Query HEALTHIE for all patients under provider
4. Filter to find patient matching phone
5. If no match: return verified:false, patient_found:false
6. If match found:
   - Compare provided name vs HEALTHIE name (fuzzy match)
   - Compare provided DOB vs HEALTHIE DOB
   - If both match: verified:true
   - If mismatch: verified:false, instruction to transfer
```

## SMS Verification Flow

```
1. Receive SMS from GHL workflow
2. Search HEALTHIE for patient by phone
3. If found: Store patient in state, await name/DOB
4. Claude AI generates response
5. If Claude's action is "verify_identity":
   - Extract name/DOB from params
   - Call verifyPatientIdentity() against HEALTHIE
   - If FAILS: Override Claude's response with failure message
   - If SUCCESS: Allow Claude's response through
6. Before any medical action: Check state.verified
```

---

# PART 5: IDENTIFIED ISSUES

## Critical Issues

| # | Issue | Impact | Status |
|---|-------|--------|--------|
| 1 | GHL Voice AI doesn't read webhook responses | AI says "verified" without checking | **PLATFORM LIMITATION** |
| 2 | GHL variable substitution fails | `{{contact.phone}}` sent as literal | **WORKAROUND**: Collect from conversation |
| 3 | GHL calls actions multiple times | Duplicate SMS, confusing UX | **FIXED**: Rate limiting added |
| 4 | Claude AI hallucinated "verified" | Told user verified before actual check | **FIXED**: Code-level override in place |

## Working Features

| Feature | Status | Details |
|---------|--------|---------|
| Healthie patient lookup | ✅ WORKING | All verification uses Healthie API |
| Healthie appointment booking | ✅ WORKING | Creates appointments in Healthie |
| Name/DOB verification | ✅ WORKING | Code-level gates prevent false verification |
| Date restriction (Jan 13+) | ✅ WORKING | Backend blocks earlier dates |
| SMS chatbot verification | ✅ WORKING | Overrides AI hallucination |
| Rate limiting | ✅ WORKING | 60-second block on duplicate registration texts |

---

# PART 6: RECOMMENDATIONS

## Short-Term (GHL Platform)

1. **For phone parameter** - Configure custom action to collect from conversation, not use {{contact.phone}}
2. **For verification** - Accept that LLM may not read responses; rely on backend gates
3. **For prompt** - Keep it SHORT and simple; long prompts increase likelihood of LLM ignoring parts

## Long-Term (Platform Migration)

Consider migrating Voice AI to a platform with true tool calling:
- **Retell AI** - Enforced tool calling before speech
- **Vapi** - Better webhook integration
- **Bland AI** - More control over conversation flow

These platforms treat webhooks as blocking operations, meaning the AI MUST wait for and use the response.

---

# PART 7: SOURCE OF TRUTH DISCREPANCIES

Comparing AI_PROMPTS_SOURCE_OF_TRUTH.md to actual implementation:

| Source of Truth Says | Actual Status |
|---------------------|---------------|
| "Get Patient Context" action (line 180) | Points to verify-patient, RARELY called |
| 13 custom actions | ✅ All endpoints exist |
| Healthie-first verification | ✅ Implemented |
| SMS Chatbot uses OpenAI | ❌ Actually uses AWS Bedrock Claude |

**Recommendation**: Update AI_PROMPTS_SOURCE_OF_TRUTH.md to reflect:
- SMS Chatbot uses AWS Bedrock Claude (not OpenAI)
- Remove "Get Patient Context" as separate action (duplicate of Verify Patient)
- Add "Send Registration Link" action
