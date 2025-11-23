# How to Access GoHighLevel and Get API Credentials

## Step 1: Access Your GoHighLevel Account

1. Go to **https://app.gohighlevel.com** (or your custom domain if you have one)
2. Log in with your GoHighLevel credentials
3. Select your location/sub-account if prompted

## Step 2: Get Your API Key

### Method 1: Agency API Key (Recommended)

1. In GoHighLevel, click on **Settings** (gear icon) in the left sidebar
2. Navigate to **Company Settings** → **Integrations**
3. Look for the **API** section
4. Click **Create API Key** or view existing keys
5. Give it a name like "GMH Dashboard Integration"
6. **Important**: Copy the API key immediately - you won't be able to see it again!
7. Save this as your `GHL_API_KEY`

### Method 2: OAuth (More Secure but Complex)

If you want to use OAuth instead:
1. Go to https://marketplace.gohighlevel.com
2. Create a new app
3. Configure OAuth credentials
4. Use the OAuth flow (more setup required)

## Step 3: Get Your Location ID

Your Location ID identifies which GoHighLevel location/sub-account to sync with.

### Option A: From the URL
1. In GoHighLevel, navigate to **Contacts**
2. Look at your browser's URL bar
3. It should look like: `https://app.gohighlevel.com/location/{LOCATION_ID}/contacts`
4. Copy the `{LOCATION_ID}` part (it's a long string of letters and numbers)

### Option B: From Settings
1. Go to **Settings** → **Business Profile**
2. Your Location ID should be displayed somewhere on this page
3. Or check **Settings** → **Integrations** → **API** section

### Option C: Using the API
Once you have your API key, you can query for your location ID:
```bash
curl -X GET 'https://services.leadconnectorhq.com/locations/' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Version: 2021-07-28'
```

## Step 4: Configure Your Environment

Add these to your `.env` file:

```bash
# Go-High-Level API Credentials
GHL_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example...
GHL_LOCATION_ID=xYz123AbC456def789
GHL_BASE_URL=https://services.leadconnectorhq.com
```

## Step 5: Verify the Connection

After setting up your credentials, you can test the connection:

1. Make sure your `.env` file is properly configured
2. Restart your application: `npm run dev` or restart your server
3. Go to your patients page in the GMH dashboard
4. Click "Sync All Patients" and watch for any errors

## API Permissions Required

Your API key needs the following permissions in GoHighLevel:
- **Contacts**: Read, Write
- **Tags**: Read, Write
- **Custom Fields**: Read, Write

## Troubleshooting

### "GHL client not configured"
- Make sure `GHL_API_KEY` is set in your `.env` file
- Restart your application after adding the variable
- Check that the variable name is exactly `GHL_API_KEY` (no typos)

### "Unauthorized" or 401 errors
- Your API key might be expired or invalid
- Regenerate a new API key in GoHighLevel
- Make sure you're using the correct API version (2021-07-28)

### "Location not found"
- Double-check your `GHL_LOCATION_ID`
- Make sure you're using the location ID, not the location name
- Try getting all locations first to find the correct ID

### Rate Limiting
- GoHighLevel has rate limits on API calls
- The integration includes delays to prevent hitting limits
- For large syncs, be patient and let it complete

## Testing Your Setup

### Quick API Test
You can test your API credentials with curl:

```bash
# Test API key (should return your user info)
curl -X GET 'https://services.leadconnectorhq.com/users/me' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Version: 2021-07-28'

# Test location access
curl -X GET 'https://services.leadconnectorhq.com/contacts/?limit=1' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Location-Id: YOUR_LOCATION_ID' \
  -H 'Version: 2021-07-28'
```

## Security Best Practices

1. **Never commit your `.env` file** to version control
2. **Rotate API keys** periodically (every 90 days recommended)
3. **Use environment-specific keys** (different keys for dev/staging/production)
4. **Limit permissions** to only what's needed
5. **Monitor API usage** in GoHighLevel's dashboard

## Next Steps

Once your credentials are configured:
1. Run the database migration: `node scripts/run-ghl-migration.js`
2. Sync your first patient to test the connection
3. If successful, run "Sync All Patients" to link all existing contacts
4. Set up the hourly cron job for automatic syncing

## Need Help?

- GoHighLevel API Documentation: https://highlevel.stoplight.io/docs/integrations
- GoHighLevel Support: https://help.gohighlevel.com
- API Status: https://status.gohighlevel.com
