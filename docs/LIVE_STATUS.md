# Live System Status Report

**Generated**: 2026-04-07 07:05:26 MST
**Server**: AWS EC2 (3.141.49.8)

---

## Infrastructure

| Metric | Value | Target |
|---|---|---|
| Disk Usage | 89% (5.9G free of 50G) | < 75% |
| RAM | 7GB / 31GB | < 80% |
| CPU Load | 1.00 1.00 1.01 | < 2.0 |
| PM2 Services | 14 / 14 online | All online |

### PM2 Service Restarts
```
pm2-logrotate: 0 restarts
upload-receiver: 5 restarts
telegram-ai-bot-v2: 1 restarts
email-triage: 0 restarts
fax-processor: 0 restarts
ghl-webhooks: 0 restarts
jessica-mcp: 0 restarts
uptime-monitor: 0 restarts
gmh-dashboard: 7 restarts
abxtac-website: 26 restarts
nowmentalhealth-website: 6 restarts
nowprimary-website: 3 restarts
nowoptimal-website: 8 restarts
nowmenshealth-website: 1 restarts
```

## Patient Data

| Metric | Value | Target |
|---|---|---|
| Active Patients | 260 | 345+ |
| Inactive Patients | 43 | Reactivate 20 |
| Billing Holds | 10 | 0 |
| Total in System | 364 | — |

## Integrations

| Metric | Value | Target |
|---|---|---|
| GHL Synced (active) | 258 | 100% of active |
| GHL Pending Sync | 2 | 0 |
| Pending Lab Reviews | 25 | 0 (same day) |
| Peptide SKUs at Zero | ? | 0 |

---
*Run: `bash ~/gmhdashboard/scripts/generate-status-report.sh`*
