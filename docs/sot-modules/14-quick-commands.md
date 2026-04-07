## 🚀 QUICK COMMANDS REFERENCE

### Deployment
```bash
cd /home/ec2-user/gmhdashboard
npm run build
pm2 restart gmh-dashboard
pm2 logs gmh-dashboard --lines 20
```

### Check Status
```bash
pm2 list                                 # All services
df -h /                                  # Disk space
curl -I http://localhost:3011/ops/       # Local test
curl -I https://nowoptimal.com/ops/      # Public test
```

### View Logs
```bash
pm2 logs gmh-dashboard --lines 50        # Dashboard logs
tail -50 /tmp/scribe_orchestrator.log    # Scribe logs
tail -50 /home/ec2-user/logs/snowflake-sync.log  # Sync logs
sudo tail -50 /var/log/nginx/error.log   # Nginx errors
```

### Cleanup
```bash
rm -rf ~/.npm/_logs/*                                    # npm logs
find ~/.pm2/logs -name "*.log" -mtime +7 -delete         # Old PM2 logs
sudo docker system prune -f                              # Docker cleanup
```

### Nginx
```bash
sudo nginx -t                            # Test config
sudo systemctl reload nginx              # Apply changes
sudo systemctl status nginx              # Check status
```

### Snowflake
```bash
cd /home/ec2-user
node scripts/sync-healthie-ops.js        # Manual sync
tail -50 logs/snowflake-sync.log         # Check last sync
```

### Scribe
```bash
pm2 restart upload-receiver              # Restart receiver
tail -50 /tmp/scribe_*.log               # All scribe logs
cd /home/ec2-user/scripts/scribe && python3 scribe_orchestrator.py test.m4a
```

---

