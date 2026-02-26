# GHL Voice AI Webhook Server

## Quick Start

### 1. Set Environment Variables
```bash
# Already in .env.production:
GHL_API_KEY=your-key-here
GHL_LOCATION_ID=your-location-id

# Add these:
GHL_WEBHOOK_SECRET=your-secret-key-for-security
GHL_WEBHOOK_PORT=3001
```

### 2. Start Server
```bash
cd /home/ec2-user/gmhdashboard/scripts/ghl-integration
node webhook-server.js
```

### 3. Deploy to PM2 (Production)
```bash
pm2 start webhook-server.js --name ghl-webhooks
pm2 save
```

### 4. Expose to Internet (for GHL to call)

**Option A: ngrok (Testing)**
```bash
ngrok http 3001
# Use the https URL in GHL Voice AI custom actions
```

**Option B: nginx reverse proxy (Production)**
```nginx
location /api/ghl/ {
    proxy_pass http://localhost:3001/api/ghl/;
}
```

## Available Endpoints

All endpoints require `X-Webhook-Secret` header for authentication.

### 1. Verify Patient
**POST** `/api/ghl/verify-patient`

**Request**:
```json
{
  "phone": "+19282122772",
  "dob": "1990-01-15",
  "name": "John Doe"
}
```

**Response**:
```json
{
  "verified": true,
  "ghl_contact_id": "abc123",
  "healthie_patient_id": "xyz789",
  "patient_name": "John Doe",
  "service_line": "MensHealth",
  "message": "Great! I've pulled up your record, John."
}
```

### 2. Get Availability
**POST** `/api/ghl/get-availability`

**Request**:
```json
{
  "service_line": "MensHealth",
  "appointment_type": "Follow-up",
  "date_range": "next_week"
}
```

**Response**:
```json
{
  "has_availability": true,
  "calendar_id": "cal_123",
  "available_slots": [
    { "date": "2025-01-02", "time": "10:00 AM", "slot_id": "slot_1" },
    { "date": "2025-01-02", "time": "2:00 PM", "slot_id": "slot_2" }
  ],
  "message": "I have openings on 2025-01-02, 2025-01-03."
}
```

### 3. Book Appointment
**POST** `/api/ghl/book-appointment`

**Request**:
```json
{
  "ghl_contact_id": "abc123",
  "healthie_patient_id": "xyz789",
  "calendar_id": "cal_123",
  "slot_id": "slot_1",
  "appointment_type": "Follow-up",
  "reason": "Lab results discussion"
}
```

**Response**:
```json
{
  "success": true,
  "appointment_id": "appt_456",
  "confirmation_code": "APT456",
  "message": "Perfect! Your appointment is booked."
}
```

### 4. Check Lab Results
**POST** `/api/ghl/check-lab-results`

**Request**:
```json
{
  "ghl_contact_id": "abc123",
  "healthie_patient_id": "xyz789"
}
```

**Response**:
```json
{
  "has_results": true,
  "needs_followup": false,
  "message": "Your lab results show all values within normal range."
}
```

### 5. Get Patient Balance
**POST** `/api/ghl/patient-balance`

**Request**:
```json
{
  "ghl_contact_id": "abc123"
}
```

**Response**:
```json
{
  "balance": 150.00,
  "message": "Your current balance is $150.00. Would you like me to send you a payment link?"
}
```

### 6. Send Payment Link
**POST** `/api/ghl/send-payment-link`

**Request**:
```json
{
  "ghl_contact_id": "abc123",
  "amount": 150.00
}
```

**Response**:
```json
{
  "success": true,
  "link_sent": true,
  "sms_sent": true,
  "message": "I just sent you a text with a secure payment link."
}
```

## Configuring in GHL Voice AI

### Step 1: Create Custom Action

1. In GHL, go to AI Agents → Select your agent
2. Click "Actions" → "Add Custom Action"
3. Name: "Verify Patient"
4. Webhook URL: `https://your-domain.com/api/ghl/verify-patient`
5. Method: POST
6. Headers:
   - `X-Webhook-Secret`: your-secret-key
   - `Content-Type`: application/json
7. Body Parameters:
   - `phone`: `{{contact.phone}}`
   - `dob`: `{{custom_field.date_of_birth}}`
   - `name`: `{{contact.name}}`

### Step 2: Use in Agent Instructions

```
When a caller wants to schedule an appointment:
1. Use the verify_patient action to authenticate them
2. If verified, use get_availability to show open slots
3. Once they choose a time, use book_appointment to confirm
4. End the call with a friendly confirmation
```

## Testing

```bash
# Test verify-patient endpoint
curl -X POST http://localhost:3001/api/ghl/verify-patient \
  -H "X-Webhook-Secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+19282122772","dob":"1990-01-15","name":"Test Patient"}'
```

## Next Steps

1. Set `GHL_WEBHOOK_SECRET` environment variable
2. Start server with PM2
3. Set up ngrok or reverse proxy
4. Configure custom actions in GHL Voice AI
5. Test with live calls!
