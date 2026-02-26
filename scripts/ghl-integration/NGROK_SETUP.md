# ngrok Setup - Quick Start

## ngrok Requires (Free) Account

ngrok needs authentication. Here's how to set it up (takes 2 minutes):

### Step 1: Sign Up (FREE)
Go to: **https://dashboard.ngrok.com/signup**
- Sign up with Google/GitHub or email
- It's completely free!

### Step 2: Get Your Authtoken
After signing in, you'll see your authtoken at:
**https://dashboard.ngrok.com/get-started/your-authtoken**

It looks like: `2abc123def456ghi789jkl_0mnoPQRstuVwxyZ1234567890`

### Step 3: Configure ngrok
Run this command (replace YOUR_TOKEN with your actual token):

```bash
ngrok config add-authtoken YOUR_TOKEN_HERE
```

Example:
```bash
ngrok config add-authtoken 2abc123def456ghi789jkl_0mnoPQRstuVwxyZ1234567890
```

### Step 4: Start ngrok
```bash
ngrok http 3001
```

You'll see:
```
Forwarding  https://abc123-def456.ngrok-free.app -> http://localhost:3001
```

**Copy that https URL!** That's your ngrok URL for GHL configuration.

---

## Alternative: Use Your Own Domain

Don't want to use ngrok? You can expose the server directly:

### Option 1: Public IP with nginx

Already configured in your nginx:
```nginx
# Add to /etc/nginx/sites-available/default:

location /api/ghl/ {
    proxy_pass http://localhost:3001/api/ghl/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

Then GHL would call: `https://your-ec2-public-ip/api/ghl/verify-patient`

### Option 2: Use Cloudflare Tunnel (Free ngrok alternative)

```bash
# Install cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared

# Start tunnel
cloudflared tunnel --url http://localhost:3001
```

---

## Recommended: Just Use ngrok (Free)

For testing, ngrok free tier is perfect:
- ✅ Takes 2 minutes to set up
- ✅ HTTPS automatically
- ✅ No server configuration needed
- ✅ Works behind firewalls

Once you sign up and add your authtoken, you're done!

---

## After ngrok is Running

1. Copy the https URL from ngrok output
2. Open: `/home/ec2-user/gmhdashboard/scripts/ghl-integration/GHL_CONFIG_CHECKLIST.md`
3. Replace every instance of `YOUR-NGROK-URL` with your actual URL
4. Configure the 6 custom actions in GHL
5. Test!

**That's it!**
