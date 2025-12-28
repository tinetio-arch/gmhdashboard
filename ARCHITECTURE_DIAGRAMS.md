# GMH Dashboard - System Architecture Diagrams

**Last Updated**: December 28, 2025  
**Purpose**: Visual documentation of system architecture, data flows, and integrations

---

## 🏗️ High-Level System Architecture

```mermaid
graph TB
    subgraph "External Services"
        HEALTHIE[Healthie EHR<br/>GraphQL API]
        QB[QuickBooks<br/>OAuth API]
        GHL[GoHighLevel<br/>Patient Comms]
        TELEGRAM[Telegram<br/>Bot API]
        DEEPGRAM[Deepgram<br/>Audio Transcription]
        CLAUDE[AWS Bedrock<br/>Claude AI]
    end

    subgraph "GMH Dashboard - EC2 Instance"
        subgraph "PM2 Services"
            DASH[gmh-dashboard<br/>Next.js 14<br/>Port 3000]
            BOT[telegram-ai-bot-v2<br/>Node.js]
            UPLOAD[upload-receiver<br/>Express<br/>Port 3005]
        end
        
        subgraph "Web Server"
            NGINX[Nginx<br/>Reverse Proxy<br/>Port 443/80]
        end
        
        subgraph "Databases"
            POSTGRES[("Postgres<br/>RDS<br/>clinic-pg")]
        end
        
        subgraph "AI Scribe System"
            SCRIBE[scribe_orchestrator.py<br/>Audio Processing]
            TELEGRAM_APPROVER[telegram_approver.py<br/>Human-in-Loop]
            DOC_GEN[document_generators.py<br/>AI Generation]
        end
    end

    subgraph "AWS Services"
        S3[S3 Bucket<br/>gmh-snowflake-stage]
        SNOWFLAKE[("Snowflake<br/>Data Warehouse<br/>GMH_CLINIC")]
    end

    subgraph "BI & Analytics"
        METABASE[Metabase<br/>Docker<br/>Port 3030]
    end

    %% External connections
    HEALTHIE --> DASH
    HEALTHIE --> SCRIBE
    QB --> DASH
    GHL --> DASH
    TELEGRAM --> BOT
    TELEGRAM --> TELEGRAM_APPROVER
    DEEPGRAM --> SCRIBE
    CLAUDE --> SCRIBE
    CLAUDE --> BOT

    %% Internal connections
    NGINX -.-> DASH
    DASH --> POSTGRES
    BOT --> POSTGRES
    BOT --> SNOWFLAKE
    SCRIBE --> TELEGRAM_APPROVER
    SCRIBE --> HEALTHIE
    UPLOAD --> S3
    
    %% Data warehouse flow
    POSTGRES --> S3
    HEALTHIE -.Sync Scripts.-> S3
    QB -.Sync Scripts.-> S3
    S3 -.Snowpipe.-> SNOWFLAKE
    SNOWFLAKE --> METABASE
    SNOWFLAKE --> BOT

    style DASH fill:#4A90E2
    style POSTGRES fill:#E27D60
    style SNOWFLAKE fill:#85D4E3
    style SCRIBE fill:#F49AC2
```

---

## 📊 Data Flow Architecture

```mermaid
flowchart LR
    subgraph "Clinical Sources"
        H[Healthie EHR]
        Q[QuickBooks]
        P[Postgres DB]
    end

    subgraph "Data Pipeline"
        SYNC[Sync Scripts<br/>Cron Jobs]
        S3[AWS S3<br/>gmh-snowflake-stage]
        PIPE[Snowpipe<br/>Auto-Ingest]
    end

    subgraph "Data Warehouse"
        SF[("Snowflake<br/>GMH_CLINIC")]
        PATIENT[PATIENT_DATA Schema]
        FINANCIAL[FINANCIAL_DATA Schema]
    end

    subgraph "Consumption"
        MB[Metabase<br/>BI Dashboards]
        TB[Telegram Bot<br/>AI Queries]
        DASH2[GMH Dashboard<br/>Ops Interface]
    end

    H -->|Every 6hr| SYNC
    Q -->|Every 3hr| SYNC
    P -->|Selective| SYNC
    SYNC --> S3
    S3 -->|Auto| PIPE
    PIPE --> SF
    SF --> PATIENT
    SF --> FINANCIAL
    PATIENT --> MB
    FINANCIAL --> MB
    SF --> TB
    SF --> DASH2
    P --> DASH2

    style SF fill:#85D4E3
    style S3 fill:#FFB6C1
    style SYNC fill:#98D8C8
```

---

## 🤖 AI Scribe Workflow

```mermaid
sequenceDiagram
    participant Provider
    participant iOS Shortcuts
    participant UploadReceiver
    participant S3
    participant Orchestrator
    participant Deepgram
    participant Claude
    participant TelegramApprover
    participant Healthie

    Provider->>iOS Shortcuts: Record visit audio
    iOS Shortcuts->>UploadReceiver: PUT /upload (audio file)
    UploadReceiver->>S3: Upload to S3
    UploadReceiver->>Orchestrator: Trigger scribe workflow
    
    Orchestrator->>Deepgram: Transcribe audio
    Deepgram-->>Orchestrator: Transcription text
    
    Orchestrator->>Claude: Analyze transcript
    Claude-->>Orchestrator: Visit classification
    
    Orchestrator->>Claude: Generate SOAP note
    Orchestrator->>Claude: Generate patient summary
    Orchestrator->>Claude: Generate Rx recommendations
    Orchestrator->>Claude: Generate lab orders
    Claude-->>Orchestrator: All documents
    
    Orchestrator->>TelegramApprover: Send for approval
    TelegramApprover->>Provider: Telegram message<br/>w/ inline buttons
    
    Provider->>TelegramApprover: Approve All
    TelegramApprover->>Healthie: Inject to chart
    Healthie-->>Provider: Documents in EHR
```

---

## 🔐 Authentication & Authorization Flow

```mermaid
flowchart TD
    START[User visits<br/>nowoptimal.com/ops/]
    
    START --> CHECK_SESSION{Session cookie<br/>gmh_session_v2<br/>exists?}
    
    CHECK_SESSION -->|No| REDIRECT_LOGIN[Redirect to<br/>/ops/login/]
    CHECK_SESSION -->|Yes| VALIDATE{Validate<br/>HMAC signature}
    
    VALIDATE -->|Invalid| REDIRECT_LOGIN
    VALIDATE -->|Valid| CHECK_ROLE{Check user role}
    
    CHECK_ROLE -->|read| DASHBOARD_READ[Dashboard<br/>Read-Only View]
    CHECK_ROLE -->|write| DASHBOARD_WRITE[Dashboard<br/>Write Access]
    CHECK_ROLE -->|admin| DASHBOARD_ADMIN[Dashboard<br/>Full Admin]
    
    REDIRECT_LOGIN --> LOGIN_FORM[Login Form]
    LOGIN_FORM --> SUBMIT{Submit credentials}
    SUBMIT -->|Invalid| LOGIN_FORM
    SUBMIT -->|Valid| SET_COOKIE[Set httpOnly cookie<br/>w/ HMAC signature]
    SET_COOKIE --> REDIRECT_DASHBOARD[Redirect to /ops/]
    REDIRECT_DASHBOARD --> CHECK_SESSION

    style CHECK_SESSION fill:#FFE5B4
    style VALIDATE fill:#E6E6FA
    style CHECK_ROLE fill:#98FB98
```

---

## 🔄 Request Flow (Nginx → Next.js)

```mermaid
sequenceDiagram
    participant Client
    participant Nginx
    participant NextJS
    participant API
    participant DB

    Client->>Nginx: HTTPS Request<br/>nowoptimal.com/ops/patients
    
    Note over Nginx: Check SSL certificate
    Note over Nginx: Apply security headers
    
    Nginx->>NextJS: Proxy to localhost:3000<br/>Include /ops prefix
    
    Note over NextJS: trailingSlash: true<br/>basePath: /ops
    
    NextJS->>NextJS: Check session cookie<br/>(gmh_session_v2)
    
    alt Not authenticated
        NextJS-->>Client: 307 Redirect to /ops/login/
    else Authenticated
        NextJS->>API: Call internal API<br/>withBasePath('/api/patients')
        API->>DB: Query Postgres
        DB-->>API: Patient data
        API-->>NextJS: JSON response
        NextJS-->>Client: Rendered HTML
    end

    style NextJS fill:#4A90E2
    style DB fill:#E27D60
```

---

## 📦 PM2 Process Architecture

```mermaid
graph TB
    subgraph "PM2 Process Manager"
        subgraph "gmh-dashboard (id: 4)"
            D1[npm run dev]
            D2[next dev]
            D3[Port 3000]
            D1 --> D2
            D2 --> D3
        end
        
        subgraph "telegram-ai-bot-v2 (id: 1)"
            T1[node telegram-ai-bot-v2.ts]
            T2[AWS Bedrock Client]
            T3[Snowflake Connector]
            T1 --> T2
            T1 --> T3
        end
        
        subgraph "upload-receiver (id: 2)"
            U1[node upload_receiver.js]
            U2[Express Server]
            U3[Port 3005]
            U1 --> U2
            U2 --> U3
        end
        
        subgraph "pm2-logrotate (module)"
            L1[Log Rotation]
            L2[Keep last 30 days]
            L1 --> L2
        end
    end

    AUTO[PM2 Startup<br/>Auto-restart on reboot]
    SAVE[pm2 save<br/>Persist state]
    
    AUTO -.-> D1
    AUTO -.-> T1
    AUTO -.-> U1
    SAVE -.-> AUTO

    style D1 fill:#4A90E2
    style T1 fill:#F49AC2
    style U1 fill:#98D8C8
```

---

## 🗄️ Database Schema (Simplified)

```mermaid
erDiagram
    PATIENTS ||--o{ DEA_TRANSACTIONS : has
    PATIENTS ||--o{ DISPENSES : receives
    PATIENTS ||--o{ PRESCRIPTIONS : has
    PATIENTS ||--o{ HEALTHIE_CLIENTS : maps_to
    PATIENTS ||--o{ PATIENT_CLINICSYNC_MAPPING : "deprecated_maps_to"
    
    PATIENTS {
        int patient_id PK
        string patient_name
        string email
        string phone
        string payment_method
        string ghl_contact_id
        timestamp created_at
    }
    
    HEALTHIE_CLIENTS {
        int id PK
        int patient_id FK
        string healthie_client_id
        boolean is_active
        string match_method
        timestamp created_at
    }
    
    DEA_TRANSACTIONS {
        int id PK
        int patient_id FK
        string medication_name
        float quantity_ml
        timestamp dispensed_at
    }
    
    DISPENSES {
        int id PK
        int patient_id FK
        int vial_id FK
        float quantity_ml
        timestamp dispensed_at
    }
    
    VIALS ||--o{ DISPENSES : contains
    
    VIALS {
        int vial_id PK
        string medication_name
        string vendor
        float total_ml
        float remaining_ml
        timestamp received_date
    }
```

---

## 🔄 Cron Job Schedule

```mermaid
gantt
    title GMH Dashboard Cron Jobs
    dateFormat HH:mm
    axisFormat %H:%M
    
   section Cleanup
    Backup cleanup (2 AM)           :02:00, 1m
    
    section QuickBooks
    QB Sync (every 3hr)             :00:00, 1m
    QB Sync                         :03:00, 1m
    QB Sync                         :06:00, 1m
    QB Sync                         :09:00, 1m
    QB Sync                         :12:00, 1m
    QB Sync                         :15:00, 1m
    QB Sync                         :18:00, 1m
    QB Sync                         :21:00, 1m
    
    section Healthie
    Healthie→Snowflake (every 6hr)  :00:00, 1m
    Healthie→Snowflake              :06:00, 1m
    Healthie→Snowflake              :12:00, 1m
    Healthie→Snowflake              :18:00, 1m
    
    section Scribe
    Scribe sync (hourly)            :00:00, 1m
    Scribe sync                     :01:00, 1m
    Scribe sync                     :02:00, 1m
    
    section Health Checks
    Health check (8 AM daily)       :08:00, 1m
```

---

## 📁 Directory Structure

```
/home/ec2-user/
├── gmhdashboard/                    # Main Next.js application (ACTIVE)
│   ├── app/                         # Next.js 14 App Router
│   │   ├── api/                     # API routes
│   │   │   ├── auth/quickbooks/    # QuickBooks OAuth (NEW Dec 28)
│   │   │   ├── admin/              # Admin endpoints
│   │   │   └── integrations/       # Integration webhooks
│   │   ├── components/             # React components
│   │   ├── login/                  # Login page
│   │   ├── patients/               # Patient management
│   │   ├── inventory/              # Inventory tracking
│   │   └── page.tsx                # Main dashboard
│   ├── lib/                        # Utilities & helpers
│   │   ├── auth.ts                 # Session management
│   │   ├── db.ts                   # Postgres connection
│   │   ├── basePath.ts             # Base path helpers (CRITICAL)
│   │   ├── quickbooks.ts           # QuickBooks API client
│   │   └── healthie.ts             # Healthie GraphQL client
│   ├── scripts/                    # Background jobs
│   │   ├── health-check.sh         # Daily monitoring (NEW Dec 28)
│   │   ├── sync-healthie-*.ts      # Healthie sync scripts
│   │   └── sync-healthie-ops.js    # Main 6-hour sync
│   ├── .env.local                  # Environment variables
│   ├── next.config.js              # Next.js config (trailingSlash: true)
│   ├── ANTIGRAVITY_SOURCE_OF_TRUTH.md   # Master documentation
│   └── CLEANUP_LOG_DEC28_2025.md   # Cleanup documentation
├── scripts/                        # Shared scripts
│   └── scribe/                     # AI Scribe system (ROOT level!)
│       ├── scribe_orchestrator.py  # Main workflow
│       ├── telegram_approver.py    # Human approval UI
│       ├── document_generators.py  # AI document generation
│       ├── upload_receiver.js      # PM2 service (port 3005)
│       ├── prompts_config.yaml     # Prompt templates
│       ├── healthie_snowflake_sync.py  # Hourly sync
│       ├── package.json            # Node dependencies (NEW Dec 28)
│       └── node_modules/           # Installed packages
├── logs/                           # Application logs
│   ├── gmh-health.log              # Health check logs
│   └── snowflake-sync.log          # Sync logs
└── apps/                           # OLD directory (DO NOT USE)
    └── gmh-dashboard/              # Archived (23MB)

/etc/nginx/
└── conf.d/
    └── nowoptimal.conf             # Nginx reverse proxy config

/home/ec2-user/.pm2/
├── dump.pm2                        # PM2 saved state
└── logs/                           # PM2 logs
    ├── gmh-dashboard-out.log
    ├── gmh-dashboard-error.log
    ├── telegram-ai-bot-v2-out.log
    └── upload-receiver-out.log
```

---

## ✅ POST-CLEANUP STATUS (Dec 28, 2025)

### Services Running
- ✅ gmh-dashboard (dev mode, stable)
- ✅ telegram-ai-bot-v2 (online)
- ✅ upload-receiver (fixed & online)
- ✅ Nginx (reverse proxy)
- ✅ Metabase (Docker, port 3030)

### Integrations Active
- ✅ Healthie (GraphQL, 6-hour sync)
- ✅ QuickBooks (OAuth working, 3-hour sync)
- ✅ Snowflake (data warehouse, auto-ingest)
- ✅ Telegram (bot queries, scribe approvals)
- ⚠️ GoHighLevel (placeholder config, needs real credentials)
- ❌ ClinicSync (REMOVED - deprecated as of Dec 28)

### Data Flow
- ✅ Healthie → S3 → Snowflake → Metabase
- ✅ QuickBooks → Dashboard → Snowflake
- ✅ Scribe: Audio → Deepgram → Claude → Telegram → Healthie
- ✅ Patient data: Postgres (307 patients safe)

---

**For updates to these diagrams**, edit this file and regenerate using Mermaid visualization tools or online editors like https://mermaid.live/
