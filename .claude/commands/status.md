# Status Command

Quick health check of the system.

## Usage
```
/status
```

## Steps

1. Check PM2 status: `pm2 status`
2. Check git status: `git status --short`
3. Check for pending tasks in TASKS.md
4. Check recent error logs: `tail -10 /home/ec2-user/.pm2/logs/gmh-dashboard-error.log`
5. Check disk usage: `df -h /`
6. Check database connectivity: quick SELECT 1 query

## Output Format
```
## System Status

### Services
[pm2 status output]

### Git
[uncommitted changes, current branch]

### Tasks
[pending tasks from TASKS.md]

### Errors (last 10 lines)
[error log excerpt]

### Health: ✅ HEALTHY / ⚠️ DEGRADED / ❌ DOWN
```
