# GHL Voice AI - YOUR Custom Actions Configuration

## ✅ Your ngrok URL
```
https://edgily-oesophageal-chara.ngrok-free.dev
```

## ✅ Your Webhook Secret
```
960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec
```

---

## Configure These 6 Custom Actions in GoHighLevel

Log into GHL → AI Agents → [Your Agent] → Actions → Add Custom Action

---

### 1. verify_patient

**Name**: `verify_patient`

**Webhook URL**: 
```
https://edgily-oesophageal-chara.ngrok-free.dev/api/ghl/verify-patient
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
  "phone": "{{contact.phone}}",
  "dob": "{{contact.customField.date_of_birth}}",
  "name": "{{contact.name}}",
  "ghl_contact_id": "{{contact.id}}"
}
```

---

### 2. get_availability

**Name**: `get_availability`

**Webhook URL**: 
```
https://edgily-oesophageal-chara.ngrok-free.dev/api/ghl/get-availability
```

**Method**: `POST`

**Headers**: (same as above)

**Body**:
```json
{
  "service_line": "MensHealth",
  "appointment_type": "Follow-up",
  "provider_name": "Dr. Whitten"
}
```

---

### 3. book_appointment

**Name**: `book_appointment`

**Webhook URL**: 
```
https://edgily-oesophageal-chara.ngrok-free.dev/api/ghl/book-appointment
```

**Method**: `POST`

**Headers**: (same as above)

**Body**:
```json
{
  "ghl_contact_id": "{{contact.id}}",
  "healthie_patient_id": "{{contact.customField.healthie_patient_id}}",
  "provider_id": "provider_123",
  "slot_date": "2025-01-02",
  "slot_time": "10:00 AM",
  "appointment_type": "Follow-up",
  "reason": "General checkup"
}
```

---

### 4. check_lab_results

**Name**: `check_lab_results`

**Webhook URL**: 
```
https://edgily-oesophageal-chara.ngrok-free.dev/api/ghl/check-lab-results
```

**Method**: `POST`

**Headers**: (same as above)

**Body**:
```json
{
  "ghl_contact_id": "{{contact.id}}",
  "healthie_patient_id": "{{contact.customField.healthie_patient_id}}"
}
```

---

### 5. patient_balance

**Name**: `patient_balance`

**Webhook URL**: 
```
https://edgily-oesophageal-chara.ngrok-free.dev/api/ghl/patient-balance
```

**Method**: `POST`

**Headers**: (same as above)

**Body**:
```json
{
  "ghl_contact_id": "{{contact.id}}"
}
```

---

### 6. send_payment_link

**Name**: `send_payment_link`

**Webhook URL**: 
```
https://edgily-oesophageal-chara.ngrok-free.dev/api/ghl/send-payment-link
```

**Method**: `POST`

**Headers**: (same as above)

**Body**:
```json
{
  "ghl_contact_id": "{{contact.id}}",
  "amount": 150.00
}
```

---

## Test Each Action

After configuring, test with curl:

```bash
curl -X POST https://edgily-oesophageal-chara.ngrok-free.dev/api/ghl/verify-patient \
  -H "X-Webhook-Secret: 960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+19282122772", "dob": "1990-01-15", "name": "Test Patient"}'
```

Expected response:
```json
{
  "verified": false,
  "message": "I couldn't find you in our system...",
  "action": "transfer_to_human"
}
```

---

## Sample Agent Instructions

Paste this into your Voice AI agent:

```
You are the AI receptionist for Tri-City Men's Health.

When a patient calls:
1. Greet: "Thank you for calling Tri-City Men's Health! How can I help you today?"
2. Listen to their request
3. For appointments:
   - Use verify_patient to authenticate
   - Use get_availability to show open slots
   - Use book_appointment when they choose
4. For lab results:
   - Use verify_patient first
   - Then check_lab_results
5. For billing:
   - Use patient_balance
   - Use send_payment_link if needed

Always be professional and HIPAA-compliant.
```

---

## Monitoring

**Check webhook logs**:
```bash
pm2 logs ghl-webhooks
```

**Check ngrok requests**:
Visit: http://localhost:4040

**Restart if needed**:
```bash
pm2 restart ghl-webhooks
```

---

## ✅ You're Ready!

1. ✅ ngrok running with your URL
2. ✅ Webhook server running in PM2
3. ✅ All endpoints ready
4. ⏳ Configure 6 actions in GHL (copy/paste from above)
5. ⏳ Test each action
6. ⏳ Make a test call!

Everything is ready on the backend. Just need the GHL UI configuration!
