# Pre-Deployment Checklist - GoHighLevel Integration

Use this checklist before deploying to **nowoptimal.com/ops**

## ✅ Pre-Deployment Requirements

### 1. Access & Credentials
- [ ] SSH access verified: `ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8`
- [ ] GoHighLevel account access confirmed
- [ ] GHL API Key obtained
- [ ] GHL Location ID obtained
- [ ] Database credentials available

### 2. GoHighLevel Setup
- [ ] Logged into https://app.gohighlevel.com
- [ ] Navigated to Settings → Integrations → API
- [ ] Created API key with full permissions
- [ ] Copied API key immediately (stored securely)
- [ ] Location ID identified from URL or settings
- [ ] Verified you can view contacts in GHL
- [ ] Confirmed patients already exist in GHL

### 3. Local Environment
- [ ] All new files created successfully
- [ ] Scripts are executable (`chmod +x *.sh`)
- [ ] No linting errors in TypeScript files
- [ ] Documentation files reviewed

### 4. Production Environment
- [ ] Current database backed up
- [ ] Current application running without errors
- [ ] PM2 process status checked
- [ ] Disk space verified (`df -h`)
- [ ] Memory usage checked (`free -h`)

### 5. Testing Plan
- [ ] Plan to test single patient sync first
- [ ] List of 2-3 test patients identified
- [ ] Email/phone verified for test patients
- [ ] Rollback plan prepared

## 📋 Deployment Steps Checklist

### Phase 1: Preparation (Local Machine)
```bash
cd "/Users/philschafer/Phils Fun Stuff/gmh-dashboard"
```

- [ ] Run `./prepare-deployment.sh`
- [ ] Review generated deployment package
- [ ] Upload package to server:
```bash
scp -i ~/.ssh/nowserverk.pem ghl-deployment-*.tar.gz ec2-user@3.141.49.8:~/
```

### Phase 2: Server Configuration
```bash
ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8
```

- [ ] Extract deployment package
- [ ] Navigate to `~/gmh-dashboard`
- [ ] Edit `.env` file
- [ ] Add `GHL_API_KEY`
- [ ] Add `GHL_LOCATION_ID`
- [ ] Add `GHL_BASE_URL=https://services.leadconnectorhq.com`
- [ ] Verify `NEXT_PUBLIC_BASE_PATH=/ops` is set
- [ ] Save and exit

### Phase 3: Database Migration
- [ ] Run `node scripts/run-ghl-migration.js`
- [ ] Check for migration success message
- [ ] Verify no database errors
- [ ] Check new tables created:
  - `ghl_sync_history`
  - `ghl_tag_mappings`
- [ ] Verify new columns in patients table
- [ ] Check new views created

### Phase 4: Application Deployment
- [ ] Run `npm install`
- [ ] Run `npm run build`
- [ ] Check build completed successfully
- [ ] Run `pm2 restart gmh-dashboard`
- [ ] Verify PM2 status: `pm2 status`
- [ ] Check logs: `pm2 logs gmh-dashboard --lines 50`
- [ ] No errors in logs

### Phase 5: Initial Testing
- [ ] Open browser: https://nowoptimal.com/ops
- [ ] Login successful
- [ ] Navigate to patients page
- [ ] "Sync All Patients" button visible
- [ ] Test sync single patient first
- [ ] Verify sync status indicator appears
- [ ] Check sync success message
- [ ] Verify in GHL contact was updated

### Phase 6: Bulk Sync
- [ ] Click "Sync All Patients"
- [ ] Monitor progress
- [ ] Note succeeded count
- [ ] Note failed count
- [ ] Review error messages
- [ ] Fix any email/phone mismatches
- [ ] Re-sync failed patients

### Phase 7: Verification
- [ ] Check GHL for "existing" tags on Men's Health patients
- [ ] Verify contact info updated in GHL
- [ ] Verify multiple tags applied correctly
- [ ] Check database: `SELECT * FROM ghl_sync_history ORDER BY created_at DESC LIMIT 10;`
- [ ] Verify sync status in dashboard
- [ ] Test individual patient sync button
- [ ] Click GHL link icon to view contact

### Phase 8: Automation Setup
- [ ] Set up cron job for hourly sync:
```bash
crontab -e
# Add: 0 * * * * curl -X GET https://nowoptimal.com/ops/api/cron/sync-ghl
```
- [ ] Save crontab
- [ ] Verify cron will run: `crontab -l`
- [ ] Test cron endpoint manually:
```bash
curl -X GET https://nowoptimal.com/ops/api/cron/sync-ghl
```

## 🔍 Post-Deployment Verification

### Application Health
- [ ] App accessible at https://nowoptimal.com/ops
- [ ] Login page loads
- [ ] Patients page loads
- [ ] No console errors in browser
- [ ] No 404 errors for static assets
- [ ] API endpoints responding

### GHL Integration
- [ ] Can sync individual patients
- [ ] Can sync all patients
- [ ] Sync status indicators working
- [ ] Tags visible in GHL
- [ ] Contact info updated in GHL
- [ ] GHL link icons functional

### Database
- [ ] New tables exist
- [ ] Sync history recording
- [ ] No orphaned records
- [ ] Views returning data
- [ ] Indexes created

### Performance
- [ ] Page load times acceptable
- [ ] Sync completes within reasonable time
- [ ] No memory leaks (check PM2 monit)
- [ ] No excessive CPU usage
- [ ] No database connection issues

## 📊 Success Metrics

After deployment, verify these metrics:

- [ ] **Sync Success Rate**: > 95% of patients synced successfully
- [ ] **Tag Application**: All Men's Health patients have "existing" tag
- [ ] **Data Accuracy**: Contact info matches between systems
- [ ] **Performance**: Bulk sync completes in < 5 minutes for 100 patients
- [ ] **Uptime**: Application remains stable after deployment
- [ ] **Error Rate**: < 5% sync errors (mostly due to missing email/phone)

## 🚨 Rollback Criteria

Rollback if:
- [ ] Sync fails completely
- [ ] Database errors prevent app startup
- [ ] Application becomes unstable
- [ ] More than 50% of syncs fail
- [ ] Critical functionality broken
- [ ] Performance severely degraded

## 🔄 Rollback Procedure

If needed:
```bash
cd ~/gmh-dashboard
git reset --hard HEAD~1  # If using git
# OR restore from backup
npm install
npm run build
pm2 restart gmh-dashboard
```

## 📝 Documentation Completed
- [ ] All team members briefed
- [ ] Documentation accessible
- [ ] Credentials stored securely
- [ ] Monitoring set up
- [ ] Support plan established

## ✅ Sign-Off

- [ ] Technical review complete
- [ ] Testing complete
- [ ] All checks passed
- [ ] Ready for production deployment

**Deployed by**: ___________________
**Date**: ___________________
**Time**: ___________________
**Version**: GHL Integration v1.0

---

## Quick Reference Commands

```bash
# SSH into server
ssh -i ~/.ssh/nowserverk.pem ec2-user@3.141.49.8

# Check PM2 status
pm2 status

# View logs
pm2 logs gmh-dashboard

# Restart app
pm2 restart gmh-dashboard

# Test database connection
cd ~/gmh-dashboard && node scripts/run-ghl-migration.js

# View sync history
psql -h $DATABASE_HOST -U $DATABASE_USER -d $DATABASE_NAME \
  -c "SELECT * FROM ghl_sync_history ORDER BY created_at DESC LIMIT 10;"

# Test cron endpoint
curl -X GET https://nowoptimal.com/ops/api/cron/sync-ghl
```
