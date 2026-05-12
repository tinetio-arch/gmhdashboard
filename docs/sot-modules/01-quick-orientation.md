| 24 | [System Access Credentials](#system-access-credentials-updated-feb-19-2026) | 4930+ | Login URLs and credential references |

---

## 📍 QUICK ORIENTATION

### What is This System?
**GMH Dashboard** is a Next.js 14 healthcare operations platform integrating:
- **Clinical**: Healthie EHR (patient records, appointments, billing)
- **Financial**: QuickBooks (payments, invoices, accounting)
- **Analytics**: Snowflake (data warehouse) + Metabase (BI dashboards)
- **Communications**: Telegram (ops notifications), GoHighLevel (patient comms)
- **AI Features**: Scribe (visit documentation), Telegram bot (data queries)

### Critical System Facts (verified live 2026-05-12)
- **Active Directory**: `/home/ec2-user/gmhdashboard` ✅ (NOT `/apps/gmh-dashboard`)
- **Production URL**: `https://nowoptimal.com/ops/`
- **Base Path**: `/ops` (all routes prefixed with this)
- **Running On**: AWS EC2, Amazon Linux, PM2 process manager
- **Disk**: 100GB EBS volume (49% used, 52GB free — `df -h /`)
- **Database**: Postgres on AWS RDS, 118 tables, **491 patients** (379 active, 30 active_pending, 74 inactive, 7 hold_payment_research, 1 inactive_payment_research)
- **PM2**: 14 app services + 1 module (pm2-logrotate). Added since April: **dispatch-mcp** (Cowork MCP for session coordination)
- **Crontab**: 33 active jobs
- **Snowflake**: analytics reads (~6hr lag — never use for real-time)

### Who Works Here?
- **Providers**: Aaron Whitten (Medical Director, Healthie ID 12093125 — bulk of Men's Health); Phil Schafer NP (Healthie ID 12088269 — both locations)
- **Operations**: You (via AI assistants, coordinated by `claude-coord`)
- **Domains**: nowoptimal.com, nowprimary.care, nowmenshealth.care, nowmentalhealth.care, abxtac.com

### Admin Access
- **Dashboard URL**: `https://nowoptimal.com/ops/`
- **Admin Email**: `admin@nowoptimal.com`
