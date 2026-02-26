# GHL Voice AI Custom Actions - Configuration Checklist

## Your ngrok URL
**Run this command to get your URL**:
```bash
curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url'
```

Or visit: http://localhost:4040 to see the ngrok web interface

## Webhook Secret
```
960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec
```

---

## GHL Configuration Steps

### 1. Log into GoHighLevel
- Go to: https://app.gohighlevel.com/
- Select your location: **Tri-City Men's Health** (0dpAFAovcFXbe0G5TUFr)

### 2. Navigate to AI Agents
- Look for: **Settings** → **AI** → **Voice AI** or **AI Agents**
- Or: **Automation** → **AI Agents**

### 3. Create/Edit Your Voice AI Agent
- Click on your agent (or create new one)
- Look for **Actions** or **Custom Actions** tab

---

## Custom Action #1: verify_patient

**Name**: `verify_patient`

**Webhook URL**: `https://YOUR-NGROK-URL/api/ghl/verify-patient`
(Replace YOUR-NGROK-URL with the URL from step above)

**Method**: `POST`

**Headers**:
```
X-Webhook-Secret: 960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec
Content-Type: application/json
```

**Body** (JSON):
```json
{
  "phone": "{{contact.phone}}",
  "dob": "{{contact.customField.date_of_birth}}",
  "name": "{{contact.name}}",
  "ghl_contact_id": "{{contact.id}}"
}
```

---

## Custom Action #2: get_availability

**Name**: `get_availability`

**Webhook URL**: `https://YOUR-NGROK-URL/api/ghl/get-availability`

**Method**: `POST`

**Headers**: (same as above)

**Body** (JSON):
```json
{
  "service_line": "MensHealth",
  "appointment_type": "Follow-up",
  "provider_name": "Dr. Whitten"
}
```

---

## Custom Action #3: book_appointment

**Name**: `book_appointment`

**Webhook URL**: `https://YOUR-NGROK-URL/api/ghl/book-appointment`

**Method**: `POST`

**Headers**: (same as above)

**Body** (JSON):
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

## Custom Action #4: check_lab_results

**Name**: `check_lab_results`

**Webhook URL**: `https://YOUR-NGROK-URL/api/ghl/check-lab-results`

**Method**: `POST`

**Headers**: (same as above)

**Body** (JSON):
```json
{
  "ghl_contact_id": "{{contact.id}}",
  "healthie_patient_id": "{{contact.customField.healthie_patient_id}}"
}
```

---

## Custom Action #5: patient_balance

**Name**: `patient_balance`

**Webhook URL**: `https://YOUR-NGROK-URL/api/ghl/patient-balance`

**Method**: `POST`

**Headers**: (same as above)

**Body** (JSON):
```json
{
  "ghl_contact_id": "{{contact.id}}"
}
```

---

## Custom Action #6: send_payment_link

**Name**: `send_payment_link`

**Webhook URL**: `https://YOUR-NGROK-URL/api/ghl/send-payment-link`

**Method**: `POST`

**Headers**: (same as above)

**Body** (JSON):
```json
{
  "ghl_contact_id": "{{contact.id}}",
  "amount": 150.00
}
```

---

## Testing After Configuration

### Test from GHL UI:
Most custom actions have a "Test" button - use it!

### Test from command line:
```bash
# Replace YOUR-NGROK-URL with your actual URL
NGROK_URL="https://YOUR-NGROK-URL"

curl -X POST $NGROK_URL/api/ghl/verify-patient \
  -H "X-Webhook-Secret: 960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+19282122772",
    "dob": "1990-01-15",
    "name": "Test Patient"
  }'
```

Expected response:
```json
{
  "verified": false,
  "message": "I couldn't find you in our system..."
}
```

---

## Sample Agent Instructions

Copy this into your Voice AI agent's instructions field:

```
You are the AI receptionist for Tri-City Men's Health.

When a patient calls:
1. Greet warmly: "Thank you for calling Tri-City Men's Health! How can I help you today?"
2. Listen to their request
3. For appointment scheduling:
   - Use verify_patient to authenticate them
   - If verified, use get_availability to show open slots
   - Use book_appointment when they choose a time
4. For lab results:
   - Use verify_patient first
   - Then use check_lab_results
   - Share status (never actual values)
5. For billing:
   - Use patient_balance to get their balance
   - Use send_payment_link if they want to pay

Always be professional, warm, and HIPAA-compliant.
Never share protected health information without verification.
```

---

## Troubleshooting

**Action not working?**
1. Check ngrok is still running: `ps aux | grep ngrok`
2. Check webhook server: `pm2 logs ghl-webhooks`
3. Verify webhook secret matches
4. Check ngrok URL hasn't changed (free tier changes on restart)

**ngrok URL changed?**
1. Update all 6 custom actions with new URL
2. Consider ngrok paid plan for static URL

---

## Next Steps

1. ✅ Get ngrok URL
2. ⏳ Configure all 6 custom actions in GHL
3. ⏳ Test each action
4. ⏳ Make a test call to your GHL number
5. ⏳ Iterate based on results!

Ready to configure!
