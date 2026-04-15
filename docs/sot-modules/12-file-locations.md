   ├→ Snowflake: Get visit history, lab dates (ANALYTICS - 6hr lag OK)
   ├→ Healthie API: Get forms completion status (REAL-TIME)
   ├→ GHL API: Get tags, custom fields (REAL-TIME)
   └→ Bedrock AI: Summarize for natural conversation
    ↓
3. Return combined context to Jessica (<2 sec)
    ↓
Jessica: "Hi Sarah! I see you're due for your annual physical..."
```

**Patient Workflows** (Auto-triggered via Healthie):
- **Sick Visit**: Urgent care intake forms
- **Primary Care**: Annual exam paperwork
- **Pelleting**: Hormone pellet therapy forms
- **Weight Loss**: GLP-1/weight management intake
- **Men's Health**: TRANSFER to NOW Men's Health clinic

**GHL ↔ Healthie Sync**:
- Patient created in GHL → GHL custom field `healthie_patient_id` stored
- Patient created in Healthie → Postgres `healthie_clients` table updated
- Appointment booked → GHL workflow triggered (SMS confirmation)
- Forms completed in Healthie → GHL tag updated (`paperwork_complete`)

**GHL ↔ Postgres Sync**:
- **Source of Truth**: Postgres for all patient IDs
- **GHL Field**: `ghl_contact_id` stored in Postgres `patients` table
- **Healthie ID**: `healthie_client_id` stored in Postgres `healthie_clients` table
- **Critical**: MCP server MUST query Postgres first, NOT Snowflake (6hr lag)

**GHL Workflows Required** (Must be created in GHL UI - API doesn't support workflow creation):
| Workflow Name | Trigger | Action | Target Number |
|---------------|---------|--------|---------------|
| Transfer to Front Desk | Tag `transfer_front_desk` added | Forward Call | +1 (928) 277-0001 |
| Transfer to Men's Health | Tag `transfer_mens_health` added | Forward Call | +1 (928) 212-2772 |
| SMS Appointment Confirmation | Appointment Created | Send SMS | (Patient phone) |


**Files & Locations**:
```
/home/ec2-user/gmhdashboard/scripts/ghl-integration/
├── webhook-server.js          # Express server for custom actions (port 3001)
├── ghl-client.js               # GHL API wrapper
├── JESSICA_AI_AGENT.md         # Jessica documentation
├── JESSICA_GHL_PROMPT.md       # Copy-paste prompt for GHL
├── JESSICA_QUICK_REFERENCE.md  # Quick decision trees
├── YOUR_GHL_CONFIG.md          # ngrok URL and setup
