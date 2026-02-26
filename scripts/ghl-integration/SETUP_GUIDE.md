# GoHighLevel Voice AI - Step-by-Step Setup Guide

## ✅ Step 1: Generate Webhook Secret (COMPLETE)
```bash
Secret: 960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec
```
This has been added to `/home/ec2-user/.env.production`

## ✅ Step 2: Add to .env (COMPLETE)
Environment variables configured in `.env.production`

## ✅ Step 3: Start PM2 Server (COMPLETE)
```bash
pm2 list
# Should show: ghl-webhooks (online)
```

## 🔄 Step 4: Expose to Internet with ngrok

### Install ngrok (if not already installed):
```bash
# Download
wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz

# Extract
tar -xvzf ngrok-v3-stable-linux-amd64.tgz

# Move to bin
sudo mv ngrok /usr/local/bin/

# Verify
ngrok version
```

### Start ngrok tunnel:
```bash
ngrok http 3001
```

You'll see output like:
```
Forwarding  https://abc123.ngrok.io -> http://localhost:3001
```

**Copy the `https://` URL** - this is your webhook base URL!

### Keep ngrok running:
For production, consider:
1. **ngrok paid plan** - stable URLs that don't change
2. **nginx reverse proxy** - use your own domain
3. **Cloudflare Tunnel** - free alternative to ngrok

## 📝 Step 5: Configure in GHL Voice AI

### A. Create Custom Actions

Log into GoHighLevel → AI Agents → [Your Agent] → Actions

**Action 1: verify_patient**
- Name: `verify_patient`
- Webhook URL: `https://YOUR-NGROK-URL.ngrok.io/api/ghl/verify-patient`
- Method: `POST`
- Headers:
  - `X-Webhook-Secret`: `960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec`
  - `Content-Type`: `application/json`
- Body Parameters:
  ```json
  {
    "phone": "{{contact.phone}}",
    "dob": "{{contact.customField.date_of_birth}}",
    "name": "{{contact.name}}",
    "ghl_contact_id": "{{contact.id}}"
  }
  ```

**Action 2: get_availability**
- Name: `get_availability`
- Webhook URL: `https://YOUR-NGROK-URL.ngrok.io/api/ghl/get-availability`
- Method: `POST`
- Headers: Same as above
- Body Parameters:
  ```json
  {
    "service_line": "{{contact.tags}}",
    "appointment_type": "Follow-up",
    "provider_name": "Dr. Whitten"
  }
  ```

**Action 3: book_appointment**
- Name: `book_appointment`
- Webhook URL: `https://YOUR-NGROK-URL.ngrok.io/api/ghl/book-appointment`
- Method: `POST`
- Headers: Same as above
- Body Parameters:
  ```json
  {
    "ghl_contact_id": "{{contact.id}}",
    "healthie_patient_id": "{{contact.customField.healthie_patient_id}}",
    "provider_id": "TBD",
    "slot_date": "2025-01-02",
    "slot_time": "10:00 AM",
    "appointment_type": "Follow-up",
    "reason": "{{conversation.last_message}}"
  }
  ```

**Action 4: check_lab_results**
- Name: `check_lab_results`
- Webhook URL: `https://YOUR-NGROK-URL.ngrok.io/api/ghl/check-lab-results`
- Method: `POST`
- Headers: Same as above
- Body Parameters:
  ```json
  {
    "ghl_contact_id": "{{contact.id}}",
    "healthie_patient_id": "{{contact.customField.healthie_patient_id}}"
  }
  ```

**Action 5: patient_balance**
- Name: `patient_balance`
- Webhook URL: `https://YOUR-NGROK-URL.ngrok.io/api/ghl/patient-balance`
- Method: `POST`
- Headers: Same as above
- Body Parameters:
  ```json
  {
    "ghl_contact_id": "{{contact.id}}"
  }
  ```

**Action 6: send_payment_link**
- Name: `send_payment_link`
- Webhook URL: `https://YOUR-NGROK-URL.ngrok.io/api/ghl/send-payment-link`
- Method: `POST`
- Headers: Same as above
- Body Parameters:
  ```json
  {
    "ghl_contact_id": "{{contact.id}}",
    "amount": 150.00
  }
  ```

### B. Configure Agent Instructions

**Main Reception Agent**:
```
You are Alex, the AI receptionist for NowOptimal Network.

Your goal is to route callers efficiently:
1. Greet warmly: "Thank you for calling! How can I help you today?"
2. Listen to their needs
3. Route appropriately:
   - "schedule" or "appointment" → Transfer to Appointment Bot
   - "lab results" → Transfer to Lab Results Bot
   - "billing" or "payment" → Transfer to Billing Bot
   - "talk to someone" → Transfer to human staff

Always be professional, warm, and HIPAA-compliant.
```

**Appointment Booking Agent**:
```
You help patients schedule appointments.

Flow:
1. Use verify_patient action with their phone and DOB
2. If verified, ask what type of appointment they need
3. Use get_availability to check open slots
4. Offer 2-3 convenient times
5. When they choose, use book_appointment to confirm
6. End with: "You're all set! You'll receive a confirmation text."

Be conversational and patient-focused.
```

**Lab Results Agent**:
```
You help patients check lab results securely.

Flow:
1. Authenticate with verify_patient
2. Use check_lab_results to see if results are available
3. Provide status based on response
4. If results need discussion, offer to book follow-up

NEVER read actual lab values. Only provide general status.
```

## 🧪 Testing

### Test webhook locally:
```bash
curl -X POST http://localhost:3001/api/ghl/verify-patient \
  -H "X-Webhook-Secret: 960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+19282122772",
    "dob": "1990-01-15",
    "name": "Test Patient"
  }'
```

### Test through ngrok:
```bash
curl -X POST https://YOUR-NGROK-URL.ngrok.io/api/ghl/verify-patient \
  -H "X-Webhook-Secret: 960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+19282122772",
    "dob": "1990-01-15",
    "name": "Test Patient"
  }'
```

## 📊 Monitoring

### Check server logs:
```bash
pm2 logs ghl-webhooks
```

### Check server status:
```bash
pm2 status
```

### Restart if needed:
```bash
pm2 restart ghl-webhooks
```

## 🔐 Security Notes

- ✅ Webhook secret validates all incoming requests
- ✅ HTTPS via ngrok encrypts traffic
- ✅ Patient verification required before sharing info
- ✅ All actions logged to PM2 logs

## 📱 When Ready to Go Live

1. **Get stable URL**: ngrok paid plan or use your own domain
2. **Update webhook URLs** in GHL with permanent URL
3. **Configure Ooma forwarding** to GHL phone numbers
4. **Test live calls** with real patients
5. **Monitor and iterate** based on feedback

## 🎯 Current Status

- ✅ Webhook server running on port 3001
- ✅ PM2 managing process (auto-restart enabled)
- ⏳ **Waiting for ngrok setup**
- ⏳ **Waiting for GHL Voice AI configuration**
- ⏳ **Waiting for Healthie rate limits to clear**

Ready to expose with ngrok and configure in GHL!
