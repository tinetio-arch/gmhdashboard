# Jarvis Telegram Bot Documentation

> Consolidated documentation for GMH Telegram bot capabilities

## Quick Start

1. Message the bot directly on Telegram
2. Type `/start` to get the welcome menu
3. Use `/menu` for clickable quick actions
4. Or just ask questions in natural language

---

## Architecture

```
Active Components
├── telegram-ai-bot-v2.ts      # Main bot (PM2 process)
├── telegram_approver.py       # AI Scribe approval workflow
├── scribe_orchestrator.py     # Audio → SOAP → Healthie
└── morning-telegram-report.ts # Daily 7am cron report

Shared Libraries
├── gmhdashboard/lib/telegram-client.ts  # TypeScript API client
└── scripts/scribe/telegram_client.py    # Python API client
```

---

## Available Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + menu |
| `/menu` | Clickable quick action buttons |
| `/help` | Usage guide |
| `/status` | System health |
| `/capabilities` | Full tool list |
| `/clear` | Reset conversation |
| `1-9` | Numbered shortcuts |

## Quick Shortcuts

Type a single number for instant queries:

| # | Query |
|---|-------|
| 1 | Active patients |
| 2 | Monthly revenue |
| 3 | Inventory levels |
| 4 | Recent dispenses |
| 5 | At-risk patients |
| 6 | Appointments |
| 7 | Partial vials |
| 8 | Empty vials |
| 9 | Bot status |

---

## Capabilities

### 🗄️ Data Queries
- Natural language → SQL via Gemini
- Search patients, dispenses, inventory
- Snowflake + Healthie data fusion

### 💊 AI Scribe
- Process voice recordings → SOAP notes
- Interactive approval with edits
- Push to Healthie charts

### 🏥 Healthie Integration
- Search clients by name/email/phone
- Sync patient demographics
- Get payments and invoices
- View appointments

### 📞 GoHighLevel CRM
- Search contacts
- Sync patient data

### 📊 Analytics
- Churn risk calculation
- Revenue trends
- Patient LTV

### 📧 Actions
- Send emails via SES
- Create Healthie tasks

---

## Scheduled Reports

**Daily @ 7am MST:**
- System health status
- Inventory check compliance
- Testosterone stock levels
- Recent dispensing activity
- Financial snapshot
- Action items

---

## Security

- Authorization via `TELEGRAM_AUTHORIZED_CHAT_IDS`
- Webhook secured with HTTPS
- All queries parameterized

---

## Troubleshooting

**Bot not responding:**
```bash
pm2 logs telegram-ai-bot-v2 --lines 50
```

**Check bot status:**
```bash
pm2 status telegram-ai-bot-v2
```

**Restart bot:**
```bash
pm2 restart telegram-ai-bot-v2
```

---

## File Locations

| Purpose | Path |
|---------|------|
| Main bot | `/home/ec2-user/gmhdashboard/scripts/telegram-ai-bot-v2.ts` |
| Scribe approval | `/home/ec2-user/scripts/scribe/telegram_approver.py` |
| Scribe engine | `/home/ec2-user/scripts/scribe/scribe_orchestrator.py` |
| Morning report | `/home/ec2-user/gmhdashboard/scripts/morning-telegram-report.ts` |
| TS client lib | `/home/ec2-user/gmhdashboard/lib/telegram-client.ts` |
| Python client | `/home/ec2-user/scripts/scribe/telegram_client.py` |
| Archived files | `/home/ec2-user/archive/telegram/` |
