# Email Triage System - Setup Guide

## Quick Start

### 1. Create Gmail Account
1. Log into Google Workspace Admin Console
2. Create user: `hello@nowoptimal.com`
3. Set a secure password

### 2. Enable Gmail API
1. Go to https://console.cloud.google.com
2. Select your project (or create one)
3. Enable **Gmail API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Application type: **Desktop app**
6. Download credentials JSON
7. Save as: `/home/ec2-user/gmhdashboard/config/gmail-credentials.json`

### 3. First-Time Authentication
```bash
cd /home/ec2-user/gmhdashboard/scripts/email-triage
python3 email-triage-system.py
```

This will:
- Open a browser for OAuth consent
- Ask you to log in as `hello@nowoptimal.com`
- Save token for future use

### 4. Test the System
Send a test email to `hello@nowoptimal.com`:

**Test 1 - Clinical**:
```
Subject: Lab Results - Abnormal Values
Body: Patient lab results show elevated creatinine requiring review.
```

**Test 2 - Ops/Billing**:
```
Subject: Payment Failed
Body: Credit card ending in 1234 was declined for patient appointment.
```

**Test 3 - Patient Outreach**:
```
Subject: Patient not responding
Body: Patient hasn't replied to our messages in 2 weeks, at risk of churning.
```

**Test 4 - Exec/Finance**:
```
Subject: Weekly Revenue Report
Body: This week's revenue is down 15% vs last week.
```

### 5. Deploy to PM2
Once working, add to PM2 for continuous monitoring:

```bash
pm2 start /home/ec2-user/gmhdashboard/scripts/email-triage/email-triage-system.py \
  --name email-triage \
  --interpreter python3 \
  --time

pm2 save
```

### 6. Monitor Logs
```bash
pm2 logs email-triage
```

## Configuration

### Environment Variables
All webhooks are hardcoded in `email-classifier.py`. To change:

Edit `/home/ec2-user/gmhdashboard/scripts/email-triage/email-classifier.py`:
```python
WEBHOOKS = {
    'OPS_BILLING': 'your-webhook-url',
    # ...
}
```

### Check Interval
Default: 2 minutes (120 seconds)

To change, edit `email-monitor.py`:
```python
CHECK_INTERVAL = 300  # 5 minutes
```

## Troubleshooting

### "Credentials file not found"
- Make sure you downloaded OAuth credentials from Google Cloud Console
- Save as `/home/ec2-user/gmhdashboard/config/gmail-credentials.json`

### "Authentication failed"
```bash
rm /home/ec2-user/gmhdashboard/config/gmail-token.pickle
python3 email-triage-system.py
```
This will force re-authentication.

### "Bedrock access denied"
```bash
aws bedrock list-foundation-models --region us-east-1
```
Verify you have Bedrock access in us-east-1.

### "Google Chat posting failed"
- Verify webhook URLs are correct
- Test webhook manually:
```bash
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"text": "Test message"}'
```

## Files

- `email-monitor.py` - Gmail API integration
- `email-classifier.py` - AI classification (Bedrock)
- `google-chat-poster.py` - Google Chat formatting
- `email-triage-system.py` - Main integrated system

## Next Steps

1. **Lab Fax Integration**: Configure Ooma to forward faxes to `hello@nowoptimal.com`
2. **PDF Analysis**: Add PDF text extraction for better classification
3. **Learning System**: Track routing accuracy and improve prompts
4. **SLA Tracking**: Monitor response times per category
5. **Healthie Integration**: Enrich emails with patient context

## Support

Check logs: `pm2 logs email-triage`
Stop system: `pm2 stop email-triage`
Restart: `pm2 restart email-triage`
