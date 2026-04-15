- **If Scribe failing**: Check `/tmp/scribe_*.log`

---

## ⚙️ PM2 SERVICE CRITICAL RULES

> [!CAUTION]
> **Failure to follow these rules caused 106,000+ restart loops on jessica-mcp (Feb 2026)**

### Python Services (MANDATORY)

1. **Document Python version requirements** in code comments and README
   - MCP package requires **Python 3.10+**
   - Check package compatibility: `pip show <package> | grep Requires-Python`

2. **Use the correct Python interpreter in ecosystem.config.js**
   ```javascript
   // WRONG - defaults to Python 3.9 which lacks many packages
   interpreter: 'python3'
   
   // CORRECT - explicit version with required packages
   interpreter: 'python3.11'
   ```

3. **Virtual environments for Python projects** (recommended)
   ```bash
   cd /path/to/project
   python3.11 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

4. **Always install dependencies before starting PM2**
   ```bash
   pip install -r requirements.txt  # BEFORE pm2 start
   ```

### Crash Loop Prevention

The system has automatic crash loop detection via `uptime-monitor`:
- **Detection**: Checks restart counts every 60 seconds
- **Threshold**: >50 restarts triggers alert, >100 triggers auto-stop
- **Alert**: Instant Telegram notification with error details
- **Auto-Stop**: Prevents CPU meltdown from infinite restart loops

**If a service is in crash loop:**
```bash
pm2 stop <service>      # Stop it immediately
pm2 logs <service>      # Check the error
pm2 reset <service>     # Reset restart counter after fixing
```

### Current PM2 Services

| Service | Interpreter | Port | Purpose |
|---------|-------------|------|---------|
| gmh-dashboard | node (npm) | 3011 | Next.js Admin Panel |
| telegram-ai-bot-v2 | npx tsx | - | AI Query Bot |
| jessica-mcp | python3.11 | 3002 | MCP Server for GHL |
| upload-receiver | node | 3001 | AI Scribe Audio Receiver |
| email-triage | python3 | - | Email Processing |
| fax-processor | python3 | - | Incoming Fax Processor |
| ghl-webhooks | node | 3003 | GoHighLevel Integration |
| nowprimary-website | node | 3004 | Primary Care Website |
| nowmenshealth-website | node | 3005 | Men's Health Website |
| nowoptimal-website | node | 3008 | NOW Optimal Parent Website |
