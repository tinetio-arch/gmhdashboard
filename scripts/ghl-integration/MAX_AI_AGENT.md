# Max - Voice AI Agent for NOW Men's Health Care

## Agent Profile
**Name**: Max  
**Service**: NOW Men's Health Care (NowMensHealth.Care)  
**Location**: 215 N McCormick St, Prescott, AZ 86301  
**Phone**: 928-212-2772  
**Personality**: Confident, knowledgeable, discreet, professional  
**Special Ability**: Expert in TRT, pellet therapy, and men's hormone optimization

---

## Max's Superpowers

### 1. Patient Verification
- Checks if caller exists in GHL
- Verifies identity with DOB
- If not found → offers to create account

### 2. New Patient Creation (AUTOMATIC!)
- Collects: Name, phone, email, DOB
- Creates patient in GHL with "NowMensHealth" tag
- Creates patient in Healthie **with MensHealth.Care group**
- Healthie auto-sends intake paperwork
- Sends welcome SMS via GHL

### 3. Men's Health Appointment Types
| Request | Appointment Type | Duration |
|---------|-----------------|----------|
| Start TRT | Male HRT Initial | 30 min |
| TRT refill/supplies | TRT Supply Refill | 20 min |
| Pellet therapy (new) | EvexiPEL Male Initial | 60 min |
| Pellet replacement | EvexiPEL Male Repeat | 45 min |
| 5-week labs | 5-Week Lab Draw | 15 min |
| 90-day labs | 90-Day Lab Draw | 20 min |
| Peptide info | Peptide Education | 20 min |
| TRT telemedicine | TRT Telemedicine | 30 min |

### 4. Intelligent Routing
When caller requests non-men's health services:
- General primary care → Transfer to NOW Primary Care
- Sick visits (non-hormone) → Transfer to NOW Primary Care
- Women's health → Transfer to NOW Primary Care

---

## Voice AI Configuration for Max

### Custom Actions

**Action 1: verify_patient**

**Webhook URL**: 
```
https://[ngrok-url]/api/ghl/max/verify-patient
```

**Method**: `POST`

**Headers**:
```
X-Webhook-Secret: [webhook_secret]
Content-Type: application/json
```

**Body**:
```json
{
  "phone": "{{contact.phone}}",
  "dob": "{{conversation.collected.dob}}",
  "name": "{{contact.first_name}} {{contact.last_name}}"
}
```

---

**Action 2: create_new_patient**

**Webhook URL**: 
```
https://[ngrok-url]/api/ghl/max/create-new-patient
```

**Body**:
```json
{
  "first_name": "{{conversation.collected.first_name}}",
  "last_name": "{{conversation.collected.last_name}}",
  "phone": "{{contact.phone}}",
  "email": "{{conversation.collected.email}}",
  "dob": "{{conversation.collected.dob}}",
  "service_line": "MensHealth"
}
```

---

**Action 3: get_availability**

**Webhook URL**: 
```
https://[ngrok-url]/api/ghl/max/get-availability
```

**Body**:
```json
{
  "service_line": "MensHealth",
  "appointment_type": "{{conversation.collected.appointment_type}}",
  "provider_id": "12093125"
}
```

---

**Action 4: book_appointment**

**Webhook URL**: 
```
https://[ngrok-url]/api/ghl/max/book-appointment
```

**Body**:
```json
{
  "ghl_contact_id": "{{contact.id}}",
  "healthie_patient_id": "{{contact.customField.healthie_patient_id}}",
  "appointment_type": "{{conversation.collected.appointment_type}}",
  "slot_id": "{{conversation.collected.slot_id}}",
  "reason": "{{conversation.collected.reason}}"
}
```

---

## Max's Conversation Flows

### Scenario 1: Existing TRT Patient Needing Refill

```
Caller: I need to get my testosterone refilled
Max: I'd be happy to help with that! Can I get your date of birth to pull up your account?
Caller: March 15th, 1978
Max: [uses verify_patient action]
Max: Great, I've got your record here, Mike. Let me schedule you for a supply refill visit. 
     I have openings on Thursday at 10am or Friday at 2pm. Which works better for you?
Caller: Thursday works
Max: [uses book_appointment action]
Max: Perfect! You're all set for Thursday at 10am. You'll get a confirmation text shortly.
     Anything else I can help you with?
```

### Scenario 2: New Patient Interested in TRT

```
Caller: Hi, I'm interested in testosterone therapy
Max: Welcome! I'd be glad to help you learn more about our TRT program. 
     Are you a new patient with us, or have you been seen before?
Caller: I'm new
Max: Perfect! Let me get you set up. I just need a few quick details.
     First, can I get your first and last name?
Caller: John Smith
Max: And your date of birth?
Caller: April 20th, 1982
Max: Great. What's the best email for you?
Caller: john.smith@email.com
Max: [uses create_new_patient action]
Max: Excellent, John! I've created your account. You'll receive an email shortly 
     with intake paperwork - takes about 10 minutes. Once completed, we can 
     schedule your initial consultation. Would you like to book that now?
Caller: Yes
Max: [uses get_availability action]
Max: I have initial consults available Monday at 9am, Wednesday at 2pm, or 
     Thursday at 11am. Which works for you?
```

### Scenario 3: Caller Needs Primary Care (Route Away)

```
Caller: I'm feeling sick, I think I have the flu
Max: I'm sorry to hear you're not feeling well. For general sick visits, 
     our NOW Primary Care team would be the best fit for you. They're 
     at 404 South Montezuma Street. Would you like me to transfer you 
     to them, or I can give you their number to call directly?
Caller: Transfer me please
Max: Absolutely. Let me connect you now. Feel better soon!
[Transfer to NOW Primary Care]
```

---

## Environment Variables Needed

Add to `.env.production`:

```bash
# Max AI - Men's Health
MAX_WEBHOOK_PORT=3004
HEALTHIE_MENS_HEALTH_GROUP_ID=TBD  # Query from Healthie
HEALTHIE_MENS_HEALTH_PROVIDER_ID=12093125

# Men's Health Appointment Type IDs (from Source of Truth)
HEALTHIE_APPT_TYPE_MALE_HRT_INITIAL=504725
HEALTHIE_APPT_TYPE_EVEXIPEL_MALE_INITIAL=504727
HEALTHIE_APPT_TYPE_EVEXIPEL_MALE_REPEAT=504728
HEALTHIE_APPT_TYPE_TRT_TELEMEDICINE=505645
HEALTHIE_APPT_TYPE_TRT_SUPPLY_REFILL=504735
HEALTHIE_APPT_TYPE_PEPTIDE_EDUCATION=504736
HEALTHIE_APPT_TYPE_5_WEEK_LAB=504732
HEALTHIE_APPT_TYPE_90_DAY_LAB=504734
```

---

## Testing Max

### Test New Patient Creation:

```bash
curl -X POST http://localhost:3004/api/ghl/max/create-new-patient \
  -H "X-Webhook-Secret: $GHL_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Test",
    "last_name": "TRTPatient",
    "phone": "+15555551234",
    "email": "test.trt@example.com",
    "dob": "03/15/1978",
    "service_line": "MensHealth"
  }'
```

Expected response:
```json
{
  "success": true,
  "ghl_contact_id": "abc123",
  "healthie_patient_id": "xyz789",
  "intake_sent": true,
  "message": "Welcome to NOW Men's Health Care, Test! You'll receive..."
}
```

---

## What Happens Automatically

When Max creates a patient:

1. **GHL Contact Created**:
   - Tagged: "NowMensHealth"
   - Custom fields populated
   - Receives welcome SMS

2. **Healthie Patient Created**:
   - Added to "MensHealth.Care" group
   - Welcome email sent with patient portal link
   - TRT-specific intake forms automatically sent
   - Workflow tracks completion

3. **Patient Receives**:
   - SMS: "Welcome to NOW Men's Health Care!"
   - Email: "Welcome to your patient portal"
   - Email: "Please complete these intake forms"
     - Demographics
     - Medical history (TRT-focused)
     - Consent forms
     - Lab history questionnaire

4. **Staff Notified**:
   - New TRT patient alert in Healthie
   - Can see form completion status

---

## PM2 Service

```bash
pm2 start scripts/ghl-integration/max-webhook-server.js --name max-webhooks
pm2 save
```

---

## Next Steps

1. ✅ Create Max documentation
2. ✅ Create Max GHL prompt
3. ⏳ Query Healthie for MensHealth.Care group ID
4. ⏳ Create max-webhook-server.js
5. ⏳ Add Max to PM2
6. ⏳ Expose via ngrok
7. ⏳ Configure in GHL
8. ⏳ Test with live calls

Max is ready to help men's health patients! 💪
