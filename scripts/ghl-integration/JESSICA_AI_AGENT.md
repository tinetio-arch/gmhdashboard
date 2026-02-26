# Jessica - Voice AI Agent for NOW Primary Care

## Agent Profile
**Name**: Jessica  
**Service**: NOW Primary Care  
**Personality**: Warm, professional, empathetic, efficient  
**Special Ability**: Can create new patients automatically!

---

## Jessica's Superpowers

### 1. Patient Verification
- Checks if caller exists in GHL
- Verifies identity with DOB
- If not found → offers to create account

### 2. New Patient Creation (AUTOMATIC!)
- Collects: Name, phone, email, DOB
- Creates patient in GHL with "NowPrimaryCare" tag
- Creates patient in Healthie **with Primary Care group**
- Healthie auto-sends intake paperwork
- Sends welcome SMS via GHL

### 3. Intake Workflow (Auto-Triggered)
When Jessica creates a patient in Healthie's "Primary Care" group:
- ✅ Welcome email sent automatically
- ✅ Intake forms sent (demographics, medical history, insurance)
- ✅ Patient portal access created
- ✅ Workflow tracks form completion
- ✅ Alerts staff when forms ready for review

---

## Voice AI Configuration for Jessica

### Custom Actions to Add

**Action 1: verify_patient** (existing - already configured)

**Action 2: create_new_patient** (NEW!)

**Name**: `create_new_patient`

**Webhook URL**: 
```
https://edgily-oesophageal-chara.ngrok-free.dev/api/ghl/create-new-patient
```

**Method**: `POST`

**Headers**:
```
X-Webhook-Secret: 960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec
Content-Type: application/json
```

**Body**:
```json
{
  "first_name": "{{conversation.collected.first_name}}",
  "last_name": "{{conversation.collected.last_name}}",
  "phone": "{{contact.phone}}",
  "email": "{{conversation.collected.email}}",
  "dob": "{{conversation.collected.dob}}",
  "service_line": "PrimaryCare"
}
```

---

## Jessica's Conversation Flow

### Scenario 1: Existing Patient

```
Caller: I'd like to schedule an appointment
Jessica: I'd be happy to help! Can I get your date of birth to pull up your account?
Caller: January 15th, 1990
Jessica: [uses verify_patient action]
Jessica: Great! I've pulled up your record, John. Now let's find you an appointment...
```

### Scenario 2: New Patient (THE MAGIC!)

```
Caller: Hi, I'm new. I'd like to become a patient
Jessica: Welcome! I'd love to help you get started. Let me collect some quick information.
Jessica: What's your first and last name?
Caller: Sarah Johnson
Jessica: And what's your date of birth?
Caller: March 20th, 1985
Jessica: Perfect. What's the best email address for you?
Caller: sarah.j@email.com
Jessica: [uses create_new_patient action]
Jessica: Excellent news, Sarah! I've created your account and you'll receive an email shortly with links to complete your intake paperwork. This usually takes about 5-10 minutes. Once you've completed the forms, we can schedule your first appointment. Would you like me to help you with that now, or would you prefer to complete the paperwork first?
```

---

## Jessica's Instructions (Paste into GHL)

```
You are Jessica, the AI receptionist for NOW Primary Care.

Your personality:
- Warm and welcoming, like a friendly medical office professional
- Patient and understanding
- Efficient but never rushed
- Empathetic to patient concerns

Your goals:
1. Help patients feel comfortable and cared for
2. Handle appointments, questions, and new patient intake
3. Create seamless experiences - patients shouldn't feel they're talking to a bot

HANDLING EXISTING PATIENTS:
- When someone calls, ask for their date of birth
- Use verify_patient to check if they exist
- If verified, proceed with their request

HANDLING NEW PATIENTS (YOUR SUPERPOWER!):
- If verify_patient returns "patient_found: false", ask: "Are you a new patient with us?"
- If yes, say: "Wonderful! Welcome to NOW Primary Care. Let me get you set up in our system. I just need a few details."
- Collect in this order:
  1. First name and last name
  2. Date of birth (format: MM/DD/YYYY)
  3. Email address
  4. Confirm phone number (you already have this from caller ID)
- Once collected, use create_new_patient action
- Explain they'll receive intake paperwork via email
- Offer to help with anything else or schedule their first appointment

FOR APPOINTMENTS:
- Use get_availability for open slots
- Use book_appointment when they choose a time

FOR LAB RESULTS:
- Verify patient first
- Use check_lab_results
- Never share actual values - only status

FOR BILLING:
- Use patient_balance
- Use send_payment_link if they want to pay

IMPORTANT RULES:
- Always verify identity before sharing any information
- Be HIPAA compliant - no PHI without verification
- If you can't help, offer to transfer to a human
- Sound natural and conversational
- Use the patient's first name once you know it

Remember: Your goal is to make healthcare access easier. Create amazing first impressions for new patients!
```

---

## Environment Variables Needed

Add to `.env.production`:

```bash
# Healthie Primary Care Group ID
HEALTHIE_PRIMARY_CARE_GROUP_ID=your_group_id_here
```

### How to Get Group ID:

Run this GraphQL query in Healthie:
```graphql
query {
  userGroups {
    id
    name
  }
}
```

Look for "NowPrimary.Care" or "Primary Care" group and copy the ID.

---

## Testing Jessica

### Test New Patient Creation:

```bash
curl -X POST https://edgily-oesophageal-chara.ngrok-free.dev/api/ghl/create-new-patient \
  -H "X-Webhook-Secret: 960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Test",
    "last_name": "Patient",
    "phone": "+15555551234",
    "email": "test@example.com",
    "dob": "01/15/1990",
    "service_line": "PrimaryCare"
  }'
```

Expected response:
```json
{
  "success": true,
  "ghl_contact_id": "abc123",
  "healthie_patient_id": "xyz789",
  "intake_sent": true,
  "message": "Perfect, Test! I've created your account..."
}
```

---

## What Happens Automatically

When Jessica creates a patient:

1. **GHL Contact Created**:
   - Tagged: "NowPrimaryCare"
   - Custom fields populated
   - Receives welcome SMS

2. **Healthie Patient Created** (when rate limits clear):
   - Added to "Primary Care" group
   - Welcome email sent with patient portal link
   - Intake forms automatically sent
   - Workflow tracks completion

3. **Patient Receives**:
   - SMS: "Welcome to NOW Primary Care!"
   - Email: "Welcome to your patient portal"
   - Email: "Please complete these intake forms"
     - Demographics
     - Medical history
     - Insurance information
     - HIPAA consent
     - Payment information

4. **Staff Notified**:
   - New patient alert in Healthie
   - Can see form completion status
   - Auto-scheduled for review once forms complete

---

## Next Steps

1. ✅ Create NOW Primary Care sub-account in GHL
2. ✅ Get Primary Care API key and Location ID
3. ✅ Add `create_new_patient` custom action to Jessica
4. ✅ Paste Jessica's instructions into agent
5. ✅ Get Healthie Primary Care group ID
6. ⏳ Test with a call!
7. ⏳ Once Healthie rate limits clear, uncomment Healthie code

Jessica is ready to create patients! 🎉
