# NowPrimary.Care Chatbot - GHL Configuration Guide

Configure the Jessica Chatbot in GoHighLevel Conversation AI.

## Prerequisites

1. **Webhook Server Running** on port 3001:
   ```bash
   pm2 status ghl-webhooks
   ```

2. **Ngrok Tunnel Active**:
   ```bash
   curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url'
   ```

3. **Webhook Secret**:
   ```
   960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec
   ```

---

## Step 1: Create Conversation AI Bot

1. Log into GoHighLevel: https://app.gohighlevel.com/
2. Navigate to **Settings** → **Conversation AI** → **Bots**
3. Click **+ Create Bot**
4. Name: `Jessica - NOW Primary Care`
5. Type: **Conversation AI Bot**

---

## Step 2: Configure Bot Prompt

1. Open the bot settings
2. Go to **Instructions** or **Prompt** section
3. Copy entire contents of: `JESSICA_CHATBOT_PROMPT.md`
4. Paste into the instructions field
5. Save

---

## Step 3: Configure Custom Actions

For each action below, create a new Custom Action with:
- **Method**: POST
- **Headers**:
  ```
  X-Webhook-Secret: 960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec
  Content-Type: application/json
  ```

Replace `YOUR-NGROK-URL` with your actual ngrok URL.

### Action 1: Verify Patient
- **Name**: `Verify Patient`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/verify-patient`
- **Body**:
```json
{
  "phone": "{{contact.phone}}",
  "dob": "{{dob}}",
  "name": "{{name}}",
  "ghl_contact_id": "{{contact.id}}"
}
```

### Action 2: Create Patient
- **Name**: `Create Patient`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/create-new-patient`
- **Body**:
```json
{
  "first_name": "{{first_name}}",
  "last_name": "{{last_name}}",
  "phone": "{{contact.phone}}",
  "email": "{{email}}",
  "dob": "{{dob}}",
  "service_line": "PrimaryCare"
}
```

### Action 3: Find Appointment Availability
- **Name**: `Find Appointment Availability`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/get-availability`
- **Body**:
```json
{
  "service_line": "PrimaryCare",
  "appointment_type": "{{appointment_type}}"
}
```

### Action 4: Get Available Slots
- **Name**: `Get Available Slots`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/get-availability`
- **Body**:
```json
{
  "service_line": "PrimaryCare",
  "appointment_type": "{{appointment_type}}",
  "provider_name": "Phil Schafer"
}
```

### Action 5: Book Appointment Slot
- **Name**: `Book Appointment Slot`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/book-appointment`
- **Body**:
```json
{
  "ghl_contact_id": "{{contact.id}}",
  "phone": "{{contact.phone}}",
  "email": "{{email}}",
  "first_name": "{{contact.first_name}}",
  "last_name": "{{contact.last_name}}",
  "slot_id": "{{slot_id}}",
  "appointment_type": "{{appointment_type}}",
  "reason": "{{reason}}"
}
```

### Action 6: Book Appointment
- **Name**: `Book Appointment`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/book-appointment`
- **Body**:
```json
{
  "ghl_contact_id": "{{contact.id}}",
  "healthie_patient_id": "{{contact.customField.healthie_patient_id}}",
  "slot_id": "{{slot_id}}",
  "appointment_type": "{{appointment_type}}",
  "reason": "{{reason}}"
}
```

### Action 7: Lookup Lab Results
- **Name**: `Lookup Lab Results`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/check-lab-results`
- **Body**:
```json
{
  "ghl_contact_id": "{{contact.id}}",
  "healthie_patient_id": "{{contact.customField.healthie_patient_id}}"
}
```

### Action 8: Check Patient Balance
- **Name**: `Check Patient Balance`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/patient-balance`
- **Body**:
```json
{
  "ghl_contact_id": "{{contact.id}}"
}
```

### Action 9: Send Payment Link
- **Name**: `Send Payment Link`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/send-payment-link`
- **Body**:
```json
{
  "ghl_contact_id": "{{contact.id}}",
  "amount": "{{amount}}"
}
```

### Action 10: Request Prescription Refill
- **Name**: `Request Prescription Refill`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/request-prescription-refill`
- **Body**:
```json
{
  "phone": "{{contact.phone}}",
  "medication": "{{medication}}",
  "pharmacy": "{{pharmacy}}",
  "urgent": "{{urgent}}",
  "notes": "{{notes}}"
}
```

### Action 11: Request Provider Callback
- **Name**: `Request Provider Callback`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/send-provider-message`
- **Body**:
```json
{
  "ghl_contact_id": "{{contact.id}}",
  "patient_name": "{{contact.name}}",
  "phone": "{{contact.phone}}",
  "message_type": "{{message_type}}",
  "patient_type": "PrimaryCare"
}
```

### Action 12: Find Pharmacy
- **Name**: `Find Pharmacy`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/find-pharmacy`
- **Body**:
```json
{
  "search": "{{search_term}}"
}
```

### Action 13: Escalate to Human
- **Name**: `Escalate to Human`
- **URL**: `https://YOUR-NGROK-URL/api/ghl/transfer-call`
- **Body**:
```json
{
  "phone": "{{contact.phone}}",
  "department": "FrontDesk"
}
```

---

## Step 4: Configure Triggers

1. Go to **Triggers** section
2. Enable: **Website Chat Widget**
3. Enable: **SMS/Text Messages** (if desired)
4. Set response delay: 1-2 seconds (feels natural)

---

## Step 5: Deploy Chat Widget (Optional)

For nowprimary.care website:

1. Go to **Settings** → **Chat Widget**
2. Copy embed code
3. Add to website header/footer

---

## Testing

1. **In GHL**: Use the Test Chat feature in bot settings
2. **Test flows**:
   - "I need to schedule an appointment"
   - "I'm a new patient"
   - "I need a prescription refill"
   - "What's my balance?"

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Actions not responding | Check ngrok is running: `pm2 logs ghl-webhooks` |
| Unauthorized errors | Verify webhook secret matches |
| Bot not responding | Check bot is enabled and triggers are set |

---

Last Updated: 2026-01-03
