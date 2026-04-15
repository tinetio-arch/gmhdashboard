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

### Critical System Facts
- **Active Directory**: `/home/ec2-user/gmhdashboard` ✅ (NOT `/apps/gmh-dashboard`)
- **Production URL**: `https://nowoptimal.com/ops/`
- **Base Path**: `/ops` (all routes prefixed with this)
- **Running On**: AWS EC2, Amazon Linux, PM2 process manager
- **Disk**: 50GB EBS volume (currently 71% used, 15GB free)
- **Database**: Postgres (operational writes) + Snowflake (analytics reads)

### Who Works Here?
- **Providers**: Aaron Whitten (243 patients), Phil Schafer NP (27 patients)
- **Operations**: You (via AI assistants)
- **Domains**: nowoptimal.com, nowprimary.care, nowmenshealth.care

### Admin Access
- **Dashboard URL**: `https://nowoptimal.com/ops/`
- **Admin Email**: `admin@nowoptimal.com`
