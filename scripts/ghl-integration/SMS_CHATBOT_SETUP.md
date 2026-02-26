# SMS Chatbot - GHL Workflow Setup

Configure GHL to send inbound SMS messages to the chatbot handler.

## Prerequisites

1. **SMS Chatbot Handler Running**:
   ```bash
   pm2 start sms-chatbot-handler.js --name sms-chatbot
   pm2 status
   ```

2. **AWS Bedrock Access** (Already configured):
   - Uses EC2 IAM role for authentication
   - Model: `us.anthropic.claude-3-5-sonnet-20241022-v2:0`
   - No additional API keys needed

3. **Ngrok Tunnel Active**:
   - Chatbot uses port 3003 (proxied via port 3001)
   - Webhook URL: `https://nowoptimal.ngrok.app/api/ghl/inbound-message`

---

## Architecture

```
Patient SMS → GHL Workflow → Webhook → Port 3001 (Proxy) → Port 3003 (Handler)
                                                                    ↓
                                                          AWS Bedrock Claude
                                                                    ↓
                                                          Action Execution
                                                                    ↓
                                                          GHL sendSMS → Patient
```

---

## GHL Workflow Configuration

### Step 1: Create New Workflow

1. Go to **Automations** → **Workflows**
2. Click **+ Create Workflow**
3. Name: `SMS Chatbot Handler`

### Step 2: Add Trigger

1. Click **Add Trigger**
2. Select **Customer Reply** (or **Inbound Message**)
3. Filter: Message Type = **SMS**

### Step 3: Add Webhook Action

1. Click **+** to add action
2. Select **Webhook**
3. Configure:
   - **Method**: POST
   - **URL**: `https://nowoptimal.ngrok.app/api/ghl/inbound-message`
   - **Headers**:
     ```
     Content-Type: application/json
     ```
   - **Body** (Custom):
     ```json
     {
       "contactId": "{{contact.id}}",
       "phone": "{{contact.phone}}",
       "message": "{{message.body}}",
       "conversationId": "{{conversation.id}}",
       "contact": {
         "firstName": "{{contact.first_name}}",
         "lastName": "{{contact.last_name}}",
         "email": "{{contact.email}}"
       }
     }
     ```

### Step 4: Save and Activate

1. Click **Save**
2. Toggle workflow to **Active**

---

## Testing

### Test Handler Directly:
```bash
curl -X POST http://localhost:3003/api/ghl/inbound-message \
  -H "Content-Type: application/json" \
  -d '{
    "contactId": "test123",
    "phone": "+19281234567",
    "message": "Hi, I need to schedule an appointment"
  }'
```

### Check Health:
```bash
curl http://localhost:3003/health
```

### View Active Conversations:
```bash
curl http://localhost:3003/api/debug/conversations
```

---

## PM2 Management

```bash
# Start
pm2 start /home/ec2-user/gmhdashboard/scripts/ghl-integration/sms-chatbot-handler.js --name sms-chatbot

# View logs
pm2 logs sms-chatbot

# Restart
pm2 restart sms-chatbot

# Stop
pm2 stop sms-chatbot
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No response to SMS | Check `pm2 logs sms-chatbot` for errors |
| Bedrock errors | Check AWS credentials and IAM permissions |
| GHL webhook fails | Check ngrok is running: `pm2 status ngrok-tunnel` |
| Wrong intents | Review conversation at `/api/debug/conversations` |
| SMS not sending | Verify contactId is a real GHL contact ID |

---

## Supported Intents

| Intent | Description |
|--------|-------------|
| `greeting` | Hello/Hi messages |
| `schedule_appointment` | Booking requests |
| `verify_identity` | DOB/name verification |
| `new_patient` | New patient signup |
| `prescription_refill` | Medication refill requests |
| `billing_inquiry` | Balance/payment questions |
| `lab_results` | Lab result inquiries |
| `mens_health_referral` | TRT/testosterone → Men's Health |
| `human_request` | Request for human staff |
| `unknown` | Fallback for unclear requests |

---

Last Updated: 2026-01-04
