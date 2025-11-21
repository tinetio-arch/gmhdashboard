# AWS EC2 Deployment Guide - Payment Integration

This guide outlines how to deploy the payment integration features (QuickBooks & Go-High-Level) to your AWS EC2 server.

## Current Server Setup

Based on your configuration:
- **Server Path**: `/home/ec2-user/apps/gmh-dashboard`
- **Port**: `3400` (proxied by Nginx)
- **Base Path**: `/ops`
- **Process Manager**: PM2
- **Database**: RDS PostgreSQL (`clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com`)
- **Nginx Config**: `/etc/nginx/sites-available/nowoptimal.conf` (or similar)

## Deployment Steps

### 1. SSH into AWS Server

```bash
ssh ec2-user@your-server-ip
# or
ssh ec2-user@nowoptimal.com
```

### 2. Navigate to Application Directory

```bash
cd /home/ec2-user/apps/gmh-dashboard
```

### 3. Pull Latest Code (or Copy Files)

**Option A: If using Git:**
```bash
git pull origin main  # or your branch name
```

**Option B: If copying files manually:**
- Copy the new files from your local machine:
  - `lib/quickbooks.ts`
  - `lib/ghl.ts`
  - `lib/paymentTracking.ts`
  - `app/api/auth/quickbooks/route.ts`
  - `app/api/auth/quickbooks/callback/route.ts`
  - `payment_integration_schema.sql`
  - `QUICKBOOKS_OAUTH_SETUP.md`
  - `PAYMENT_INTEGRATION_GUIDE.md`

### 4. Run Database Migrations

```bash
# Connect to your database
psql -h clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com \
     -U clinicadmin \
     -d postgres \
     -f payment_integration_schema.sql
```

Or if you have the database password in an environment variable:
```bash
PGPASSWORD='your-password' psql -h clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com \
     -U clinicadmin \
     -d postgres \
     -f payment_integration_schema.sql
```

**Verify migration:**
```bash
psql -h clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com \
     -U clinicadmin \
     -d postgres \
     -c "\dt payment*"
```

Should show:
- `payment_sync_log`
- `quickbooks_payments`
- `quickbooks_oauth_tokens`
- `patient_qb_mapping`
- `patient_ghl_mapping`
- `payment_issues`
- `payment_rules`
- `memberships`

### 5. Install Dependencies (if needed)

```bash
npm install
```

No new dependencies should be needed (we're using built-in `fetch` and existing `pg` library).

### 6. Update PM2 Configuration

Edit `/home/ec2-user/apps/gmh-dashboard/pm2.config.js` to add QuickBooks and GHL environment variables:

```javascript
module.exports = {
  apps: [
    {
      name: 'gmh-dashboard',
      cwd: '/home/ec2-user/apps/gmh-dashboard',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3400',
      interpreter: 'node',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        DATABASE_HOST: 'clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com',
        DATABASE_PORT: '5432',
        DATABASE_NAME: 'postgres',
        DATABASE_USER: 'clinicadmin',
        DATABASE_PASSWORD: 'or0p5g!JL65cY3Y-l6+V%&RC',
        DATABASE_SSLMODE: 'require',
        PGSSLMODE: 'require',
        NEXT_TELEMETRY_DISABLED: '1',
        SESSION_SECRET: 'change-me-session-secret',
        NEXT_PUBLIC_BASE_PATH: '/ops',
        
        // QuickBooks OAuth Credentials
        QUICKBOOKS_CLIENT_ID: 'your_client_id_here',
        QUICKBOOKS_CLIENT_SECRET: 'your_client_secret_here',
        QUICKBOOKS_REDIRECT_URI: 'https://nowoptimal.com/ops/api/auth/quickbooks/callback',
        QUICKBOOKS_ENVIRONMENT: 'production',
        
        // Go-High-Level API Credentials
        GHL_API_KEY: 'your_ghl_api_key_here',
        GHL_LOCATION_ID: 'your_location_id_here',
        GHL_BASE_URL: 'https://services.leadconnectorhq.com',
      },
      env_production: {
        // ... same as above
      },
      max_memory_restart: '512M',
      restart_delay: 5000
    }
  ]
};
```

**⚠️ Security Note**: Consider using AWS Secrets Manager or environment files instead of hardcoding secrets in PM2 config.

### 7. Build the Application

```bash
npm run build
```

This creates the production build in `.next/` directory.

### 8. Restart PM2 Process

```bash
pm2 restart gmh-dashboard
# or
pm2 reload gmh-dashboard
```

**Verify it's running:**
```bash
pm2 status
pm2 logs gmh-dashboard --lines 50
```

### 9. Test the Deployment

1. **Check OAuth endpoint:**
   ```
   https://nowoptimal.com/ops/api/auth/quickbooks
   ```
   Should redirect to QuickBooks authorization page.

2. **Verify database connection:**
   - Check PM2 logs for any database connection errors
   - Verify the app can query the new payment tables

3. **Test API endpoints:**
   - After OAuth is complete, test payment sync endpoints

### 10. Update QuickBooks OAuth Redirect URI

**Important**: In the Intuit Developer Portal, make sure your redirect URI is set to:
```
https://nowoptimal.com/ops/api/auth/quickbooks/callback
```

(Not `http://localhost:3000` - that's only for local development)

## Post-Deployment Checklist

- [ ] Database migrations completed successfully
- [ ] PM2 config updated with OAuth credentials
- [ ] Application built successfully
- [ ] PM2 process restarted
- [ ] OAuth redirect URI updated in Intuit Developer Portal
- [ ] QuickBooks OAuth flow tested
- [ ] Payment sync tested (after OAuth is complete)
- [ ] GHL integration tested (if configured)

## Troubleshooting

### PM2 Process Won't Start

```bash
# Check logs
pm2 logs gmh-dashboard --err

# Check if port is in use
lsof -i :3400

# Restart PM2
pm2 restart gmh-dashboard
```

### Database Connection Issues

```bash
# Test database connection
psql -h clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com \
     -U clinicadmin \
     -d postgres

# Check if tables exist
\dt payment*
```

### OAuth Callback Not Working

1. **Check redirect URI matches exactly** in Intuit Developer Portal
2. **Verify HTTPS is working** (OAuth requires HTTPS in production)
3. **Check Nginx proxy configuration** - make sure `/ops/api/auth/quickbooks/callback` is proxied correctly
4. **Check PM2 logs** for OAuth callback errors

### Token Storage Issues

```bash
# Check if tokens are being stored
psql -h clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com \
     -U clinicadmin \
     -d postgres \
     -c "SELECT realm_id, expires_at FROM quickbooks_oauth_tokens;"
```

## Security Considerations

1. **Don't commit secrets to Git** - Use environment variables or AWS Secrets Manager
2. **Rotate database password** - The password in pm2.config.js should be rotated
3. **Use HTTPS** - Already configured via Nginx/Let's Encrypt
4. **Token encryption** - Consider encrypting tokens in database (future enhancement)
5. **Access control** - Ensure only authorized users can trigger payment syncs

## Automated Deployment Script

You could create a deployment script (`deploy.sh`):

```bash
#!/bin/bash
set -e

echo "🚀 Deploying Payment Integration to AWS..."

# Navigate to app directory
cd /home/ec2-user/apps/gmh-dashboard

# Pull latest code
echo "📥 Pulling latest code..."
git pull origin main

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Run database migrations
echo "🗄️  Running database migrations..."
PGPASSWORD='your-password' psql -h clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com \
     -U clinicadmin \
     -d postgres \
     -f payment_integration_schema.sql

# Build application
echo "🔨 Building application..."
npm run build

# Restart PM2
echo "🔄 Restarting PM2..."
pm2 restart gmh-dashboard

echo "✅ Deployment complete!"
pm2 status
```

Make it executable:
```bash
chmod +x deploy.sh
```

## Monitoring

After deployment, monitor:

1. **PM2 logs:**
   ```bash
   pm2 logs gmh-dashboard --lines 100
   ```

2. **Payment sync logs:**
   ```sql
   SELECT * FROM payment_sync_log 
   ORDER BY started_at DESC 
   LIMIT 10;
   ```

3. **Payment issues:**
   ```sql
   SELECT COUNT(*) FROM payment_issues 
   WHERE resolved_at IS NULL;
   ```

## Next Steps After Deployment

1. Complete QuickBooks OAuth flow at: `https://nowoptimal.com/ops/api/auth/quickbooks`
2. Map patients to QuickBooks customers (via API or database)
3. Set up automated payment sync (cron job or scheduled task)
4. Configure payment rules (default is 30 days overdue)
5. Test end-to-end payment tracking

## Rollback Plan

If something goes wrong:

1. **Stop PM2 process:**
   ```bash
   pm2 stop gmh-dashboard
   ```

2. **Revert code:**
   ```bash
   git checkout HEAD~1  # or previous working commit
   npm run build
   pm2 restart gmh-dashboard
   ```

3. **Database rollback** (if needed):
   ```sql
   -- Drop new tables (be careful!)
   DROP TABLE IF EXISTS payment_issues CASCADE;
   DROP TABLE IF EXISTS payment_rules CASCADE;
   -- ... etc
   ```

## Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs gmh-dashboard`
2. Check database connection
3. Verify environment variables are set correctly
4. Test OAuth flow manually
5. Review Nginx proxy configuration




