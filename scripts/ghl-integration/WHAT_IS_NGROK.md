# What is ngrok and Why Do We Need It?

## The Problem

Your webhook server (`ghl-webhooks`) is running on **localhost:3001**.

**localhost** = Only accessible from THIS server (your EC2 instance)

But GoHighLevel Voice AI is running in the cloud and needs to call your webhooks over the public internet!

## The Solution: ngrok

**ngrok** is a tunneling service that:
1. Creates a public URL (e.g., `https://abc123.ngrok.io`)
2. Forwards all requests from that URL to your localhost:3001

### Visual Flow:

```
┌─────────────────┐
│  GHL Voice AI   │  (Lives in GHL's cloud)
│  (Cloud)        │
└────────┬────────┘
         │
         │ Makes HTTP POST request
         ▼
┌─────────────────────────┐
│ https://abc123.ngrok.io │  ← This is your NGROK URL
│ (Public Internet)       │
└────────┬────────────────┘
         │
         │ ngrok tunnel (secure)
         ▼
┌─────────────────────────┐
│  localhost:3001         │  ← Your webhook server
│  (Your EC2 server)      │
└─────────────────────────┘
```

## How to Get Your ngrok URL

### Method 1: Command Line
```bash
curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url'
```

### Method 2: Web Interface
Open in browser: **http://localhost:4040**

You'll see something like:
```
Session Status: online
Forwarding: https://1a2b-3c4d-5e6f.ngrok.io -> http://localhost:3001
```

**That https URL is your ngrok URL!**

## What You Do With the ngrok URL

In GoHighLevel, when you configure custom actions, you'll use:

**Instead of**:
```
https://YOUR-NGROK-URL/api/ghl/verify-patient
```

**You'll use** (example):
```
https://1a2b-3c4d-5e6f.ngrok.io/api/ghl/verify-patient
```

## Important Notes

### Free ngrok has limits:
- ✅ URL changes every time you restart ngrok
- ✅ Limited requests per minute
- ✅ Free forever

### Paid ngrok ($8/month):
- ✅ **Fixed URL** that never changes
- ✅ More requests
- ✅ Custom domains (e.g., webhooks.nowoptimal.com)

For testing, free is perfect!
For production, paid is recommended so URLs don't change.

## Alternative to ngrok

Instead of ngrok, you could:
1. **Use your domain** with nginx reverse proxy
2. **Cloudflare Tunnel** (free alternative to ngrok)
3. **Direct public IP** with SSL certificate

But ngrok is fastest to get started!

## Is ngrok the "AI Agent URL"?

No! Here's the breakdown:

| Thing | What It Is | Example |
|-------|-----------|---------|
| **GHL Voice AI Agent** | The AI that answers calls in GoHighLevel | "Main Reception Agent" |
| **Webhook Server** | Your code running on localhost:3001 | `/api/ghl/verify-patient` |
| **ngrok URL** | Public tunnel to your webhook server | `https://abc123.ngrok.io` |
| **Custom Action** | Configured in GHL to call your webhook | `verify_patient` action |

### Full Flow:
1. Patient calls your GHL phone number
2. **GHL Voice AI Agent** answers the call
3. During conversation, AI needs to verify patient
4. AI triggers **Custom Action** "verify_patient"
5. Custom Action calls **ngrok URL**: `https://abc123.ngrok.io/api/ghl/verify-patient`
6. ngrok forwards to your **webhook server** at localhost:3001
7. Your code runs, checks patient in GHL/Healthie
8. Returns result to AI
9. AI continues conversation with result

## Next Steps

1. ✅ Get your ngrok URL (from command above)
2. ⏳ Copy that URL
3. ⏳ In GHL, configure 6 custom actions
4. ⏳ Replace `YOUR-NGROK-URL` with your actual URL
5. ⏳ Test!

Ngrok is just the bridge between GHL and your local server. That's it!
