└── PATIENT_WORKFLOW_GUIDE.md   # Routing logic

/home/ec2-user/mcp-server/
├── server.py                   # MCP HTTP/SSE server (port 3002)
├── clients/
│   ├── postgres_client.py      # Postgres queries (SOURCE OF TRUTH)
│   ├── snowflake_client.py     # Analytics queries
│   ├── healthie_client.py      # Healthie GraphQL API
│   ├── ghl_client.py           # GHL REST API
│   └── bedrock_client.py       # AWS AI reasoning
├── tools/
│   ├── snowflake.py            # Snowflake MCP tools
│   ├── healthie.py             # Healthie MCP tools
│   ├── ghl.py                  # GHL MCP tools
│   └── composite.py            # Multi-system intelligent tools
└── GHL_MCP_CONFIG.md           # How to connect MCP to GHL
```

**PM2 Services**:
```bash
pm2 list
├── ghl-webhooks     # Webhook server (port 3001)
└── jessica-mcp      # MCP server (port 3002) [TO BE DEPLOYED]
```

**Environment Variables** (`.env.production`):
```bash
# GHL API (V2 - Primary Integration)
GHL_V2_API_KEY=pit-f38c02ee-...       # V2 Private Integration Token (PIT)
GHL_API_VERSION=v2                     # Forces V2 API usage
GHL_LOCATION_ID=NyfcCiwUMdmXafnUMML8  # NOW Primary Care location
GHL_WEBHOOK_SECRET=960dd12...         # Webhook authentication
GHL_WEBHOOK_PORT=3003

