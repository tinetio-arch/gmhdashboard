> **Pellet vs Injection Rule**: EvexiPel Pellets are **ONLY** done at Primary Care (Montezuma). Testosterone Injections are done at Men's Health (McCormick). **Do not send injection patients to Montezuma.**

---

## 📊 SYSTEM ARCHITECTURE

### Technology Stack
- **Frontend**: Next.js 14 (App Router), React 18, TypeScript
- **Backend**: Next.js API Routes, Postgres (via `lib/db.ts`)
- **Auth**: Session cookies (`gmh_session_v2`), HMAC signing
- **Deployment**: PM2 (`next start`), Nginx reverse proxy
- **AI**: AWS Bedrock (Claude), Deepgram (transcription)
- **Warehouse**: Snowflake (GMH_CLINIC database)

### Key URLs & Routes
- **Dashboard**: `https://nowoptimal.com/ops/` (requires login)
- **Login**: `https://nowoptimal.com/ops/login/`
- **QuickBooks OAuth**: `https://nowoptimal.com/ops/api/auth/quickbooks/`
- **API Base**: `https://nowoptimal.com/ops/api/...`

### Important Files & Directories
```
/home/ec2-user/gmhdashboard/          # Active dashboard (PRODUCTION)
├── app/                              # Next.js app router
│   ├── api/                          # API routes
│   │   ├── auth/quickbooks/          # QuickBooks OAuth (NEW Dec 28)
│   │   └── admin/quickbooks/         # QuickBooks admin endpoints
│   ├── components/                   # React components
│   ├── login/                        # Login page
│   └── page.tsx                      # Main dashboard
├── lib/                              # Utility libraries
│   ├── auth.ts                       # Authentication (gmh_session_v2)
│   ├── db.ts                         # Postgres connection pool
│   ├── basePath.ts                   # Base path helpers (CRITICAL)
│   ├── quickbooks.ts                 # QuickBooks API client
│   └── healthie.ts                   # Healthie GraphQL client
├── scripts/                          # Background jobs
│   ├── scribe/                       # AI Scribe system (NEW Dec 25-27)
│   │   ├── scribe_orchestrator.py    # Main workflow
│   │   ├── telegram_approver.py      # Telegram approval UI
│   │   ├── document_generators.py    # AI document generation
│   │   ├── prompts_config.yaml       # Prompt templates
│   │   └── upload_receiver.js        # PM2 service (port 3001)
│   ├── prescribing/                  # E-prescribing automation
│   └── sync-healthie-*.ts            # Healthie → Snowflake sync
├── .env.local                        # Environment variables (CRITICAL)
├── next.config.js                    # Next.js config (trailingSlash: true)
└── ANTIGRAVITY_SOURCE_OF_TRUTH.md    # This file

/home/ec2-user/ecosystem.config.js        # PM2 master config (ALL 11 services)

/home/ec2-user/scripts/               # Shared scripts (Snowflake sync, etc.)
/etc/nginx/conf.d/nowoptimal.conf     # Nginx configuration

/home/ec2-user/nowprimarycare-website/  # NOW Primary Care public website
├── app/                              # Next.js app router
│   ├── page.tsx                      # Home page
│   ├── about/page.tsx                # About clinic & provider
│   ├── services/page.tsx             # All 26 appointment types
│   ├── contact/page.tsx              # Contact form & location
│   └── book/page.tsx                 # Appointment booking
├── components/                       # React components (Header, Footer, etc.)
├── public/logo.png                   # NOW Primary Care logo
└── globals.css                       # Design system (navy #00205B, green #00A550)

/home/ec2-user/nowmenshealth-website/   # NOW Men's Health public website [NEW Jan 2026]
├── app/                               # Next.js 14 app router
│   ├── page.tsx                       # Home - hero, 4 service sections, CTAs
│   ├── services/testosterone/         # TRT service page
│   ├── services/sexual-health/        # ED & Sexual Health page
│   ├── services/weight-loss/          # Medical Weight Loss page
│   ├── services/iv-therapy/           # IV Hydration page
│   ├── low-t-checklist/               # Interactive Low-T symptom quiz
│   ├── book/page.tsx                  # Booking page with services
│   ├── contact/page.tsx               # Contact info & map
│   ├── sitemap.ts                     # Dynamic SEO sitemap
│   └── globals.css                    # Design system (black/white/gradient)
├── components/Header.tsx              # Nav with gradient CTA
├── components/Footer.tsx              # Contact, address, hours
├── public/robots.txt                  # SEO robots.txt
├── .env.local                         # Healthie config (Location 13029260)
└── Port: 3005                         # Nginx proxy to nowmenshealth.care

/home/ec2-user/abxtac-website/            # ABX TAC peptide site [NEW Mar 2026]
├── app/                                # Next.js 14 app router
│   ├── page.tsx                        # Home - hero, peptide explainer, stacks
│   ├── shop/page.tsx                   # 10 peptide stacks + à la carte
│   ├── peptides/page.tsx               # Peptide therapy deep dives, FAQ
│   ├── about/page.tsx                  # About, NOW Optimal Network
│   ├── cart/page.tsx                   # Cart (WooCommerce integration TBD)
│   └── globals.css                     # Dark tactical theme (#050505, #3A7D32)
├── components/Header.tsx               # Nav + wellness banner
├── components/Footer.tsx               # Quality promise, network links
├── lib/woocommerce.ts                  # WooCommerce REST API client
├── public/abxtac-logo-white.png        # Snake X logo (white-on-transparent)
├── .env.local                          # WooCommerce API keys
└── Port: 3009                          # Nginx proxy to abxtac.com
```

### PM2 Services

> [!CAUTION]
> **CRITICAL - PM2 MANAGEMENT RULES**
>
> 1. **ALL services MUST be defined in `/home/ec2-user/ecosystem.config.js`**
> 2. **NEVER start services with `pm2 start npm -- start`** - use `pm2 start ecosystem.config.js --only <service-name>`
> 3. **All services MUST have these settings to prevent CPU meltdown:**
>    - `max_restarts: 10` - Stop after 10 consecutive failures
>    - `restart_delay: 5000` - Wait 5 seconds between restarts
>    - `exp_backoff_restart_delay: 1000` - Exponential backoff
> 4. **After any PM2 changes, always run:** `pm2 save`
>
> **Incident**: On Jan 28, 2026, `nowprimary-website` and `nowmenshealth-website` reached **34,000+ restarts** because they were started ad-hoc without restart limits. Port conflicts caused infinite restart loops, burning CPU until fixed.

**Service Registry:**
| Service | Port | In Ecosystem | Description |
|---------|------|:------------:|-------------|
| gmh-dashboard | 3011 | ✅ | Ops Dashboard (nowoptimal.com/ops/) |
| upload-receiver | 3001 | ✅ | Scribe upload service |
| jessica-mcp | 3002 | ✅ | MCP server for Jessica AI |
| ghl-webhooks | 3003 | ✅ | GoHighLevel webhook handler |
| nowprimary-website | 3004 | ✅ | NOW Primary Care public site (nowprimary.care) |
| nowmenshealth-website | 3005 | ✅ | NOW Men's Health public site (nowmenshealth.care) |
| nowoptimal-website | 3008 | ✅ | NOW Optimal parent site (nowoptimal.com) |
| telegram-ai-bot-v2 | N/A | ✅ | Jarvis Telegram bot |
| email-triage | N/A | ✅ | Email classification service |
| fax-processor | N/A | ✅ | Incoming fax processor (S3 → Google Chat + Dashboard) |
| uptime-monitor | N/A | ✅ | PM2 service + website health monitoring |
| abxtac-website | 3009 | ✅ | ABX TAC peptide e-commerce (abxtac.com) — headless Next.js + WooCommerce |

