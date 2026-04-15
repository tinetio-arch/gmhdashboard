
**Next Steps**:
1. ✅ Webhook server deployed and tested
2. ✅ MCP server built (needs Postgres client)
3. ⏳ Add Postgres client to MCP (CRITICAL for data integrity)
4. ⏳ Deploy MCP server with PM2
5. ⏳ Expose MCP via ngrok (port 3002)
6. ⏳ Connect MCP to GHL Jessica agent
7. ⏳ Create NOW Primary Care sub-account
8. ⏳ Configure Ooma phone forwarding
9. ⏳ End-to-end testing with live calls

**Integration Safety Checklist**:
- [ ] MCP queries Postgres FIRST (not Snowflake)
- [ ] MCP never writes to Healthie directly (uses webhooks)
- [ ] MCP respects 6-hour Snowflake lag for analytics
- [ ] All patient IDs resolved from Postgres
- [ ] No PHI in voice responses (dates only)
- [ ] Google Chat notifications for all callback requests


  - Routing accuracy percentage
  - Number of corrections made
  - System uptime
- Alerts if accuracy drops below 80%

**Ooma Fax Integration** (Ready):
- Configure Ooma to forward faxes to `hello@nowoptimal.com`
- AI automatically routes lab/imaging faxes to Clinical Alerts
- PDF attachments extracted for future Healthie upload

**Future Enhancements**:
- PDF text extraction for better AI analysis
- Patient matching (fuzzy match by name/DOB)
- Automatic Healthie chart upload
- Snowflake logging for audit trail
- Email threading and conversation tracking

> [!IMPORTANT]
> **GHL Authentication: Private Integration Tokens (NOT OAuth)**
> GHL uses location-scoped Private Integration Tokens (PITs), NOT OAuth2. These tokens do NOT expire.
> - Men's Health: `GHL_MENS_HEALTH_API_KEY` (pit-d5e53eeb-***) → Location `0dpAFAovcFXbe0G5TUFr`
> - Primary Care: `GHL_PRIMARY_CARE_API_KEY` (pit-9383d96a-***) → Location `NyfcCiwUMdmXafnUMML8`
> Do NOT implement OAuth token refresh for GHL — it is unnecessary and will break things.
>
> **Automated GHL Sync (Added March 31, 2026)**
> Cron endpoint: `GET /api/cron/ghl-sync/` (x-cron-secret auth)
> Runs every 2 hours at :30 — syncs pending, stale, and error patients to GHL.
> Uses `getPatientsNeedingSync(200)` → `syncMultiplePatients()` with 200ms rate limiting.
> File: `app/api/cron/ghl-sync/route.ts`

---

## 🔔 Alert & Notification System

### AI Email Triage System
**Inbox**: `hello@nowoptimal.com` (Google Workspace)  
**Function**: AI-powered email classification and routing to appropriate Google Chat spaces

#### Google Chat Spaces & Webhooks

**1. NOW Ops & Billing**
- **Webhook**: `https://chat.googleapis.com/v1/spaces/AAQAuw3Rvdc/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=DXw_3jUF-tpu-IVQuL2bPj0fC-GuHXJAbwOkKCjGrSA`
