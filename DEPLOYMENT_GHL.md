# Deploying GoHighLevel Integration to nowoptimal.com/ops

## Quick Deployment Guide

### Prerequisites
- SSH access: `ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8`
- GoHighLevel API credentials (API Key and Location ID)

## Deployment Steps

### 1. Upload Files to Server

From your local machine, upload the new files:

```bash
# Navigate to your local gmh-dashboard directory
cd /Users/philschafer/Phils\ Fun\ Stuff/gmh-dashboard

# Upload the new GHL integration files
scp -i ~/.ssh/nowserverk.pem \
  lib/patientGHLSync.ts \
  app/api/admin/ghl/sync/route.ts \
  app/api/cron/sync-ghl/route.ts \
  components/GHLSyncBadge.tsx \
  components/GHLBulkSync.tsx \
  migrations/20251122_add_ghl_sync.sql \
  migrations/20251122_update_patient_views_ghl.sql \
  scripts/run-ghl-migration.js \
  next.config.js \
  deploy-ghl.sh \
  ec2-user@3.141.49.8:~/gmh-dashboard/

# Or upload the entire directory
rsync -avz --exclude 'node_modules' --exclude '.next' \
  -e "ssh -i ~/.ssh/nowserverk.pem" \
  ./ ec2-user@3.141.49.8:~/gmh-dashboard/
```

### 2. SSH into Server

```bash
ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8
```

### 3. Configure Environment Variables

```bash
cd ~/gmh-dashboard

# Edit .env file to add GHL credentials
nano .env

# Add these lines (get values from GoHighLevel):
GHL_API_KEY=your_ghl_api_key_here
GHL_LOCATION_ID=your_location_id_here
GHL_BASE_URL=https://services.leadconnectorhq.com

# Ensure base path is set
NEXT_PUBLIC_BASE_PATH=/ops

# Save and exit (Ctrl+X, then Y, then Enter)
```

### 4. Run Deployment Script

```bash
# Make script executable
chmod +x deploy-ghl.sh

# Run deployment
./deploy-ghl.sh
```

The script will:
- ✅ Install dependencies
- ✅ Run database migrations
- ✅ Build the application
- ✅ Restart PM2 process

### 5. Verify Deployment

```bash
# Check PM2 status
pm2 status

# View logs
pm2 logs gmh-dashboard --lines 50

# Monitor in real-time
pm2 monit
```

### 6. Test the Integration

1. Open browser: **https://nowoptimal.com/ops/patients**
2. Look for the "Sync All Patients" button at the top
3. Click it to start the initial sync
4. Watch for success/error messages

## Manual Deployment (if script fails)

### Step 1: Install Dependencies
```bash
cd ~/gmh-dashboard
npm install
```

### Step 2: Run Migrations
```bash
node scripts/run-ghl-migration.js
```

### Step 3: Build Application
```bash
npm run build
```

### Step 4: Restart Service
```bash
pm2 restart gmh-dashboard
# or
pm2 restart all
```

## Setting Up Automatic Sync (Cron)

To enable hourly automatic sync:

```bash
# Edit crontab
crontab -e

# Add this line (runs every hour)
0 * * * * curl -X GET https://nowoptimal.com/ops/api/cron/sync-ghl

# Save and exit
```

Or set up with PM2 cron:

```bash
pm2 start npm --name "ghl-sync-cron" --cron "0 * * * *" -- run sync:ghl
```

## Troubleshooting

### Port Issues

Check if the app is running:
```bash
netstat -tulpn | grep :3000
ps aux | grep node
```

### Nginx Configuration

If using nginx reverse proxy, ensure it's configured for `/ops`:

```bash
sudo nano /etc/nginx/sites-available/nowoptimal.com

# Should have something like:
location /ops {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

# Restart nginx
sudo systemctl restart nginx
```

### Database Connection Issues

Test database connection:
```bash
cd ~/gmh-dashboard
node -e "require('dotenv').config(); const { Client } = require('pg'); const client = new Client({ host: process.env.DATABASE_HOST, port: process.env.DATABASE_PORT, database: process.env.DATABASE_NAME, user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, ssl: { rejectUnauthorized: false } }); client.connect().then(() => { console.log('✓ Database connected'); client.end(); }).catch(err => { console.error('✗ Database error:', err.message); });"
```

### View Application Logs

```bash
# PM2 logs
pm2 logs gmh-dashboard

# System logs
journalctl -u gmh-dashboard -f

# Nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

### Clear Build Cache

If you encounter strange build errors:
```bash
cd ~/gmh-dashboard
rm -rf .next
rm -rf node_modules
npm install
npm run build
pm2 restart gmh-dashboard
```

## Verification Checklist

After deployment, verify:

- [ ] App is accessible at https://nowoptimal.com/ops
- [ ] Can log in to dashboard
- [ ] Patients page loads
- [ ] "Sync All Patients" button is visible
- [ ] Environment variables are set correctly
- [ ] Database migrations completed
- [ ] PM2 process is running
- [ ] No errors in PM2 logs

## Rolling Back

If something goes wrong:

```bash
cd ~/gmh-dashboard

# Option 1: Restore from git (if using version control)
git reset --hard HEAD~1
npm install
npm run build
pm2 restart gmh-dashboard

# Option 2: Restore from backup
cd ~
tar -xzf gmh-dashboard-backup-YYYYMMDD.tar.gz
cd gmh-dashboard
pm2 restart gmh-dashboard
```

## Production URLs

- **Dashboard**: https://nowoptimal.com/ops
- **Patients Page**: https://nowoptimal.com/ops/patients
- **API Endpoint**: https://nowoptimal.com/ops/api/admin/ghl/sync
- **Cron Endpoint**: https://nowoptimal.com/ops/api/cron/sync-ghl

## Support Commands

```bash
# Check disk space
df -h

# Check memory usage
free -h

# Check PM2 processes
pm2 list

# Restart all PM2 apps
pm2 restart all

# Save PM2 configuration
pm2 save

# View environment variables
pm2 env gmh-dashboard
```
