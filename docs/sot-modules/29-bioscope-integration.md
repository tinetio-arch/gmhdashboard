# BioSCOPE Integration — Third-Party Patient API

**Created**: 2026-04-29
**Status**: Phase 1 complete (infrastructure only — no live patient endpoints yet)
**Direction**: Inbound (BioSCOPE → us). Future bidirectional planned.

## Why this exists

BioSCOPE needs API access to a small, controlled set of patients in our Healthie account. Healthie API keys cannot be patient-scoped (they are tenant-wide), so we cannot hand BioSCOPE a Healthie key directly. Instead, we proxy: BioSCOPE calls *us*, we enforce the patient allowlist, then we use a dedicated Healthie key to fulfill the request. This bounds the blast radius even if BioSCOPE's bearer token leaks — it can only ever access allowlisted patients.

## Architecture

```
BioSCOPE
  ──[POST/GET /api/bioscope/* with x-bioscope-secret + patient_id]──▶
    GMH Dashboard
      ├─ verifyBioscopeSecret()    ← timing-safe header check
      ├─ isPatientAuthorized()     ← bioscope_authorized_patients lookup
      ├─ auditBioscopeCall()       ← writes to agent_action_log
      └─ getBioscopeHealthieClient() ← uses BIOSCOPE_HEALTHIE_API_KEY
            │
            ▼
        Healthie API
```

## Components (Phase 1)

| File | Purpose |
|------|---------|
| `migrations/20260429_bioscope_authorized_patients.sql` | Allowlist table + Doug Dolan seed (12743455) |
| `lib/bioscope-auth.ts` | Secret verify, allowlist CRUD, audit logger, `authorizeBioscopeRequest()` |
| `lib/bioscope-healthie.ts` | Singleton Healthie client using `BIOSCOPE_HEALTHIE_API_KEY` |
| `app/admin/bioscope/page.tsx` | Server component, admin-only |
| `app/admin/BioscopeAdminClient.tsx` | Client UI for add/revoke patients |
| `app/api/admin/bioscope/route.ts` | GET/POST/DELETE for allowlist management |

## Auth model

- **Inbound auth**: `x-bioscope-secret` header. Token format `bsk_live_<32 bytes base64url>`. Compared with `crypto.timingSafeEqual`. Stored as `BIOSCOPE_API_SECRET` in `.env.local`.
- **Healthie auth (downstream)**: dedicated Healthie API key in `BIOSCOPE_HEALTHIE_API_KEY` (separate from the main `HEALTHIE_API_KEY`). Segregates BioSCOPE-driven activity in Healthie's audit log; rotatable independently.
- **Admin UI auth**: standard session cookie + `role === 'admin'` check.

## Patient allowlist

Table `bioscope_authorized_patients`:
- Active rows have `revoked_at IS NULL`.
- Unique partial index `uq_bioscope_active_patient` prevents duplicate active entries per Healthie ID.
- Revoked rows are kept for audit history (never deleted).

Manage at `/ops/admin/bioscope`. Adding a patient automatically fetches their name from Healthie via `getBioscopeHealthieClient().getClient(id)`.

## Audit trail

Every authorize check (success and rejection) writes to `agent_action_log` with:
- `agent_name = 'bioscope'`
- `action_type = <endpoint or 'allowlist_add'/'allowlist_revoke'>`
- `category = 'integration'`
- `details.healthie_patient_id = <id>`
- `status = 'completed' | 'rejected' | 'error'`

Query for monitoring:
```sql
SELECT created_at, action_type, summary, details, status
  FROM agent_action_log
 WHERE agent_name = 'bioscope'
 ORDER BY created_at DESC
 LIMIT 50;
```

## Environment variables

```
BIOSCOPE_API_SECRET=bsk_live_...        # Token BioSCOPE sends to us
BIOSCOPE_HEALTHIE_API_KEY=gh_live_...   # Dedicated Healthie key for proxy calls
```

## Phased rollout

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Allowlist table + auth middleware + admin UI + dedicated Healthie client | ✅ Complete (this commit) |
| 2 | Read endpoints — `/api/bioscope/patient/[id]` (demographics, labs, notes) | Pending — gated on BioSCOPE confirming required operations |
| 3 | Write endpoints — push lab results, push chart notes | Pending |
| 4 | Outbound — `lib/bioscope-client.ts` for *us* calling *them* | Future |

## Current allowlist seed

| Healthie ID | Patient | Added | Notes |
|---|---|---|---|
| 12743455 | Doug Dolan | 2026-04-29 | Initial seed — BioSCOPE pilot patient |

## Operational notes

- **Rotation**: To rotate the bearer token, generate a new one with `python3 -c "import secrets; print('bsk_live_' + secrets.token_urlsafe(32))"`, update `.env.local`, restart `gmh-dashboard`, send the new value to BioSCOPE.
- **Kill switch**: Setting `BIOSCOPE_API_SECRET` to an empty string disables all BioSCOPE access (every request returns 401).
- **Patient revocation**: Use the admin UI. Effect is immediate — next request from BioSCOPE for a revoked patient returns 403.
- **No `/api/bioscope/patient/*` endpoints exist yet.** Adding them requires BioSCOPE confirming the operation set so we can build a curated, scope-validated proxy (rather than an unbounded GraphQL passthrough that would be hard to scope-check safely).
