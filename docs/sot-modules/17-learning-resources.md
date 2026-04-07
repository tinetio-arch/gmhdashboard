## 🎓 LEARNING RESOURCES

### Next.js 14 App Router
- **Docs**: https://nextjs.org/docs/app
- **Server Components**: Default, use `'use client'` only when needed
- **API Routes**: `app/api/**/route.ts`
- **Base Path**: https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath

### Healthie API
- **GraphQL Docs**: https://docs.gethealthie.com/reference/2024-06-01
- **Webhooks**: https://docs.gethealthie.com/docs/webhooks

#### Healthie API Behavior Notes (Updated March 14, 2026)

**COMPLETE API REFERENCE**: `/home/ec2-user/HEALTHIE_API_COMPLETE_REFERENCE.md` (comprehensive 700-line guide with verified queries and mutations)

**Rate Limits** (CRITICAL):
- **General API**: 250 requests/second (official), but 39+ burst requests trigger 30-60 min lockout
- **Safe limit**: 5 requests/second (enforced by `lib/healthieRateLimiter.ts`)
- **API bans**: Credential-based (follows API key, not IP)
- **Portal bans**: IP-based (browser access to `secure.gethealthie.com`)
- **Recovery**: Wait 30-60 minutes, no workaround
- **Utility**: All code MUST use `healthieRateLimiter` — see Critical Code Patterns section

**Pagination Limits**:
- API returns max 10 patients per query
- Use keyword-based search (a-z, 0-9 patterns) to fetch all patients

**Location Field (CAUTION)**:
- `updateClient` mutation with `location` object **ADDS** new addresses, doesn't update existing
- This causes duplicate address entries (e.g., Fred Fernow had 5 identical addresses)
- **Workaround**: Skip Healthie address updates, sync addresses via GHL and GMH Dashboard instead

**Duplicate Patient Handling**:
- `mergeClients` mutation exists but consistently returns "Object not found" error
- **Workaround**: Use `updateClient(active: false)` to deactivate duplicates instead
- Keep patient with group assignment, deactivate ungrouped duplicate

**Appointments Query - CRITICAL PARAMETERS** (March 14, 2026):
```graphql
# ✅ CORRECT - These work:
appointments(
  provider_id: "12093125"        # ✅ Filters by provider
  user_id: "12742276"            # ✅ Filters by patient
  filter: "all"                  # ✅ "all", "upcoming", "past"
  is_active: true                # ✅ Active only
  should_paginate: false         # ✅ Get all results
  startDate: "2026-03-01"        # ✅ Date range start
  endDate: "2026-03-31"          # ✅ Date range end
) {
  id
  date
  pm_status   # ✅ CORRECT field (NOT "status")
  provider { id full_name }
  user { id first_name last_name }
}

# ❌ WRONG - These cause GraphQL errors:
appointments(
  dietitian_id: "..."   # ❌ NOT SUPPORTED - use provider_id
  client_id: "..."      # ❌ NOT SUPPORTED - use user_id
  user_group_id: "..."  # ❌ NOT SUPPORTED
  date_from: "..."      # ❌ NOT SUPPORTED - use startDate
  date_to: "..."        # ❌ NOT SUPPORTED - use endDate
)
```

**Field Name Corrections**:
- `pm_status` (NOT `status`) for appointment status
- `user_id` (NOT `client_id`) for appointments query argument
- `client_id` for entries/documents queries (String type, NOT ID)
- `created_at` (NOT `date_received`) for lab orders

**Patient Sync Script**: `/home/ec2-user/scripts/scribe/sync_jane_to_systems.py`
- Syncs patient data from Jane EMR import → Healthie, GHL, GMH Dashboard
- Uses `GHL_MENS_HEALTH_API_KEY` for Men's Health location access
- Fallback to `/contacts/upsert` for GHL duplicate contact errors

### QuickBooks API
- **OAuth 2.0**: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- **Accounting API**: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/account

### Snowflake
- **Docs**: https://docs.snowflake.com/
- **Snowpipe**: https://docs.snowflake.com/en/user-guide/data-load-snowpipe

---

