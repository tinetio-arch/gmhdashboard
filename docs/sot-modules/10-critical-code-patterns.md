## 🧩 CRITICAL CODE PATTERNS

### Patient Search — ALWAYS Use Healthie API (MANDATORY)

**Problem**: The local PostgreSQL `patients` table only contains patients that have been manually linked. Many Healthie patients don't exist in the local DB. Searching the local DB for patient selection will miss most patients.

**Rule**: Any UI that lets a user pick a patient (scheduling, messaging, new conversation, scribe, etc.) **MUST search Healthie directly** via the `users(keywords:)` GraphQL query. Never search only the local `patients` table for user-facing patient pickers.

**Correct pattern** (search Healthie users):
```typescript
// ✅ CORRECT — finds ALL Healthie patients
const data = await healthieGraphQL<{
    users: Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null }>;
}>(`
    query SearchUsers($keywords: String!) {
        users(keywords: $keywords, offset: 0, page_size: 20) {
            id first_name last_name email
        }
    }
`, { keywords: searchTerm });
```

**Wrong pattern** (local DB only):
```typescript
// ❌ WRONG — misses patients not in local DB
const patients = await query('SELECT * FROM patients WHERE full_name ILIKE $1', [`%${search}%`]);
```

**The returned `id` from Healthie `users` is the Healthie User ID.** Use this ID for:
- `createAppointment(input: { user_id: ... })`
- `createConversation(input: { simple_added_users: ... })`
- `createNote(input: { conversation_id: ... })` (conversation IDs are separate)
- Any other Healthie mutation that references a patient

**Existing endpoint**: `POST /api/ipad/messages/` with `action: 'search_patients'` already implements this correctly and can be reused from any frontend tab.

### Inactive Patient Status Guard (MANDATORY — April 1, 2026)

> [!CAUTION]
> **NEVER change an inactive patient's status to active, hold, or any other status. Inactive is a deliberate clinical/administrative decision. Only a human admin can reverse it via direct database access.**

**Code enforcement**: `lib/patientQueries.ts` → `updatePatient()` checks current `status_key` before any UPDATE. If the patient is `inactive` and the new status is anything other than `inactive`, the function throws an error.

**Rules:**
1. **No automated process** (cron, webhook, AI agent) may change `inactive` → any other status
2. **No dashboard user** (read/write role) may change `inactive` → any other status via the UI
3. **Only direct DB access** by an admin can reactivate a patient
4. If you encounter an inactive patient during a batch operation, **skip them silently**

### Healthie GraphQL Type Rules (MANDATORY)

**Problem**: Healthie's GraphQL schema uses `String` (not `ID`) for most mutation input fields. Using `ID!` causes silent type-mismatch failures.

**Rule**: Always check input field types via schema introspection before writing mutations. Common gotchas:
- `createNote` → `conversation_id: String` (NOT `ID`)
- `createConversation` → `simple_added_users: String` (NOT `ID`)
- `createAppointment` → `user_id: String`, `other_party_id: String`, `appointment_type_id: String`
- `createAppointment` does NOT accept `length` or `pm_status` (removed from schema as of March 2025)
- `appointmentTypes` query: `is_visible` field does not exist (use `clients_can_book`)
- `conversationMemberships`: does NOT accept `conversation_id` or `provider_scope` args
- `Conversation` type: `includes_provider` field does not exist
- To fetch messages for a conversation, use top-level `notes(conversation_id:)` query
- Healthie dates are `"2026-03-25 11:11:36 -0700"` format — Safari cannot parse this; normalize to ISO 8601 before `new Date()`

**Contact type values** (exact strings required):
- `"In Person"` (NOT "In-Person")
- `"Phone Call"`
- `"Secure Videochat"` (NOT "Telehealth")
- `"Healthie Video Call"`

### Base Path Usage (MANDATORY)

**Problem**: App runs at `/ops` prefix, not root `/`

**Solution**: Use helpers from `lib/basePath.ts`

**Client-side fetch (MUST use withBasePath)**:
```typescript
import { withBasePath } from '@/lib/basePath';

// ❌ WRONG - will 404
fetch('/api/admin/quickbooks/sync', { method: 'POST' });

// ✅ CORRECT
fetch(withBasePath('/api/admin/quickbooks/sync'), { method: 'POST' });
```

**Building public redirect URLs**:
```typescript
// In API routes (OAuth callback, etc.)
function getPublicUrl(path: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://nowoptimal.com';
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return `${baseUrl}${basePath}${path}`;
}

// ❌ WRONG - creates localhost URLs
return NextResponse.redirect(new URL('/admin/quickbooks', request.url));

// ✅ CORRECT
return NextResponse.redirect(getPublicUrl('/admin/quickbooks?success=true'));
```

**Server components & <Link>** (automatic):
```tsx
// These work automatically (Next.js handles basePath):
import Link from 'next/link';
<Link href="/admin/quickbooks">QuickBooks</Link>  // ✅ Works

import { redirect } from 'next/navigation';
redirect('/login');  // ✅ Works
```

### React Hydration Prevention

**Problem**: Browser extensions inject scripts, causing SSR/client mismatch

**Solution**: Client-side rendering guard

```typescript
'use client';
import { useState, useEffect } from 'react';

export default function MyForm() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Return placeholder during SSR
  if (!mounted) {
    return <div style={{ minHeight: '300px' }} />;
  }

  // Render actual content only on client
  return <form>...</form>;
}
```

### Type-Safe Data Formatting

**Problem**: API responses sometimes return numbers as strings

**Solution**: Defensive formatting

```typescript
// ❌ UNSAFE - crashes if val is string
function formatCurrency(val: number): string {
  return `$${val.toFixed(2)}`;
}

// ✅ SAFE
function formatCurrency(val: number | string | null | undefined): string {
  const num = Number(val);
  return Number.isFinite(num) ? `$${num.toFixed(2)}` : '$0.00';
}

function formatNumber(val: number | string | null | undefined): string {
  const num = Number(val);
  return Number.isFinite(num) ? num.toLocaleString() : '0';
}
```

### UTC Date Formatting (Hydration-Safe)

**Problem**: `toLocaleString()` varies by server/client timezone

**Solution**: UTC-based formatter

```typescript
function safeDateFormat(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return 'N/A';
  
  try {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(d.getTime())) return 'Invalid Date';
    
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    
    return `${mm}-${dd}-${yyyy}`;
  } catch {
    return 'Error';
  }
}
```

### Healthie Rate Limiting (MANDATORY — Feb 19, 2026)

> [!CAUTION]
> **Healthie rate limits are CREDENTIAL-BASED (API) and IP-BASED (portal). Once triggered, ALL access fails for 30-60+ minutes. VPN does NOT help for API bans. There is NO workaround except waiting.**

**Two types of rate limits:**

| Type | Scope | Trigger | Duration | Affects |
|------|-------|---------|----------|--------|
| **API** | API key | 39+ rapid GraphQL requests | 30-60 min | All API calls with that key |
| **Portal/Website** | IP address | Rapid browser requests to `secure.gethealthie.com` | 30-60 min | Browser access from server |

**Incident (Feb 18, 2026)**: AI assistant's browser subagent opened Healthie portal pages repeatedly on the **local workstation** while debugging errors, triggering an IP-based ban on `secure.gethealthie.com` from the user's local IP (not the EC2 server). Ban persisted 24+ hours — may require Healthie support to lift.

**Mandatory Rules:**

1. **NEVER** use raw `fetch()` for Healthie GraphQL — use one of:
   - `HealthieClient` (automatically rate-limited via `lib/healthieRateLimiter.ts`)
   - `healthieGraphQL()` from `lib/healthieApi.ts` (standalone wrapper)
2. **NEVER** open Healthie portals (`secure.gethealthie.com`) in browser automation tools unless absolutely necessary
3. **For batch scripts**: Always add `await healthieRateLimiter.acquire()` before each request
4. **For new API routes**: Import from `@/lib/healthieApi` instead of hardcoding fetch calls

**Rate Limiter Utility** (`lib/healthieRateLimiter.ts`):
- Token-bucket: 5 requests/second (well under 250/s limit)
- Queue-based: requests wait their turn, never dropped
- 429 auto-backoff: 60-second pause on HTTP 429
- Singleton: one limiter per process, all callers share it

```typescript
// In HealthieClient — already integrated, no action needed
// graphql() method calls healthieRateLimiter.acquire() before every request

// For standalone API routes — use the shared wrapper:
import { healthieGraphQL } from '@/lib/healthieApi';

const data = await healthieGraphQL<{ users: User[] }>(
  `query { users(offset: 0, limit: 10) { id first_name } }`
);

// For batch scripts — acquire manually:
import { healthieRateLimiter } from '@/lib/healthieRateLimiter';

for (const item of items) {
  await healthieRateLimiter.acquire();
  await fetch(...);
}
```

**Key Files:**
| File | Purpose |
|------|---------|
| `lib/healthieRateLimiter.ts` | Token-bucket singleton (5 req/s, 429 backoff) |
| `lib/healthieApi.ts` | Shared `healthieGraphQL()` wrapper (auth + rate limit + errors) |
| `lib/healthie.ts` | `HealthieClient.graphql()` — integrated with rate limiter |

### Healthie GraphQL Performance Optimization (CRITICAL — March 13, 2026)

> [!CAUTION]
> **ALWAYS filter large datasets at the GraphQL query level, NOT client-side. Fetching all records and filtering in JavaScript causes massive performance issues.**

**Incident (March 13, 2026)**: iPad schedule API was timing out after 45 seconds because it fetched ALL 4,970 appointments from Healthie (29.3s response time), then filtered client-side for the provider's appointments.

**The Problem:**
```typescript
// ❌ WRONG — Fetches 4,970 appointments in 29 seconds, then filters client-side
const query = `query {
  appointments(filter: "all", should_paginate: false) {
    id date provider { id full_name } user { id first_name last_name }
  }
}`;
const response = await fetch(HEALTHIE_API_URL, { body: JSON.stringify({ query }) });
const allAppointments = response.data.appointments;
const filtered = allAppointments.filter(a => a.provider?.id === providerId); // Client-side filtering
```

**The Solution:**
```typescript
// ✅ CORRECT — Fetches only 379 provider appointments in 3.3 seconds
const query = `query GetAppointments($providerId: ID!) {
  appointments(
    filter: "all",
    provider_id: $providerId,
    should_paginate: false
  ) {
    id date provider { id full_name } user { id first_name last_name }
  }
}`;
const variables = { providerId };
const response = await fetch(HEALTHIE_API_URL, {
  body: JSON.stringify({ query, variables })
});
// No client-side filtering needed!
```

**Performance Impact:**
| Method | Records Fetched | Response Time | Speed Improvement |
|--------|----------------|---------------|-------------------|
| ❌ Client-side filter | 4,970 appointments | 29.3 seconds | Baseline |
| ✅ GraphQL `provider_id` filter | 379 appointments | 3.3 seconds | **9x faster** |

**GraphQL Parameters That Support Filtering:**
- `appointments`: `provider_id`, `user_id`, `filter` (all/upcoming/past), date ranges
- `users`: `include_all_organizations`, `active_status`, `dietitian_id`
- `form_answer_groups`: `custom_module_form_id`, `finished`, `user_id`
- `metric_entries`: `user_id`, `category`, date ranges

**Golden Rule**: If Healthie API docs show a filter parameter exists, ALWAYS use it in the query rather than fetching everything.

**Key Files:**
| File | What Was Fixed |
|------|----------------|
| `app/api/ipad/schedule/route.ts` | Added `provider_id` GraphQL variable, removed client-side filtering |
| `HEALTHIE_API_COMPLETE_REFERENCE.md` | Documents all supported Healthie GraphQL parameters |

---

