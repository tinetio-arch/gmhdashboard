# App-Version Gate + Update Nudge

**Project**: `untangling-healthie-communications-from-healthie`
**Phase**: 3 (dispatch row `20260526-192910-191f`)
**Status**: shipped 2026-05-26 — library + cron + push-token register write, **SHADOW (dry-run) by default**

## What it does

When a patient has an upcoming **telehealth/video** appointment but their
native app is **missing** or **outdated**, push (and therefore the sibling
Phase-3 "join your video" link from dispatch row `20260526-192907-f4ba`)
won't reach them. This cron nudges them on a **non-push channel** (SMS
preferred, email fallback) **before** the appointment so they can update or
install in time.

Replaces nothing on the Healthie side — this is **additive**. The patient may
still receive Healthie's native reminders until Phase 4 decommissions them.

## Pieces

| File | Role |
|---|---|
| `lib/app-version-gate.ts` | `evaluateAppVersion({appInstalled, versionMax})` → `{needsUpdate, status, recommendedAction, storeLinks, …}`. Also exports `compareSemver`, `MIN_SUPPORTED_APP_VERSION`, `LATEST_APP_VERSION`, store URLs. |
| `app/api/cron/app-version-nudge/route.ts` | Hourly-ish cron route. Joins `patients` + `v_patient_comms_profile`, fetches each candidate's Healthie appointments, filters to telehealth in the 36-48h window, evaluates the gate, builds an `app_version_nudge_pre_appt` `CommsEvent`, and calls `notifyPatient()` via the gateway with `preferredChannel='sms'`. |
| `app/api/headless/push-tokens/register/route.ts` | Now accepts an optional `appVersion` field and writes it to `patient_push_tokens.app_version` + bumps `last_heartbeat_at`. **Without this the gate has no signal to fire on** — every active token currently carries `app_version=NULL`. |
| `migrations/20260526_patient_comms_preferences.sql` (existing — Phase 1) | Already added the `patient_push_tokens.app_version` column and the `v_patient_comms_profile.app_version_max` view aggregate. No migration in this slice. |

## Gate logic

`evaluateAppVersion({appInstalled, versionMax})` returns one of four statuses:

| `appInstalled` | `versionMax` | status | `needsUpdate` | action |
|---|---|---|---|---|
| `false` | (any) | `no_app` | **true** | install |
| `true` | `null` (or unparsable) | `unknown` | `false` — do NOT nudge | none |
| `true` | `< MIN_SUPPORTED_APP_VERSION` | `outdated` | **true** | update |
| `true` | `>= MIN_SUPPORTED_APP_VERSION` | `ok` | `false` | none |

The `unknown` branch is a **safety valve**: until the mobile heartbeat that
writes `app_version` ships (separate future task), every active token carries
`app_version=NULL` and treating that as outdated would spam every existing
patient with a token on day 1. Once the mobile app starts reporting versions,
`unknown` shrinks and `outdated` becomes the live signal — no code change
here required.

Versions are configurable via env:

```
MIN_SUPPORTED_APP_VERSION=2.2.0   # bump to mass-nudge below a hotfix
LATEST_APP_VERSION=2.2.0          # appears in the email copy
IOS_STORE_URL=https://apps.apple.com/us/app/now-optimal/id6759345635
ANDROID_STORE_URL=https://play.google.com/store/apps/details?id=com.nowoptimal.patient
```

The mobile-side `useAppVersionCheck.ts` reads `latestVersion` from the Lambda
config (`APP_VERSION.LATEST` in
`~/.gemini/antigravity/scratch/nowoptimal-headless-app/backend/lambda-booking/src/config.js`,
currently `'2.2.0'`). Keep server + Lambda in lockstep when bumping.

## Cadence + channel

- **Window**: appointment starts in `[36h, 48h]` — gives the patient at least
  a day to install/update before the visit, well before the 24h appointment
  reminder and the ~1h "join your video" push.
- **Cron cadence**: every 30 minutes is fine (window is 12h wide). Not wired
  to crontab yet — Phil flips env flags AND adds the cron entry after
  reviewing dry-run output.
- **Channel**: push is by definition broken for these patients (that's why
  we're nudging), so the cron passes `preferredChannel: 'sms'` to skip push
  outright. The gateway's normal priority then resolves SMS → email.
- **Idempotency**: `event.idempotencyKey = 'app-version-nudge:<appt_id>'` —
  exactly one nudge per appointment, ever, even across retries and clock
  skew. `dedupWindowMinutes: 0` because the hard idempotency key already
  carries that guarantee.

## Telehealth detection

Healthie's `contact_type` is free-text-ish. The cron normalizes to lowercase
and matches against:

```
telehealth, video, video chat, videochat, video call, phone call
```

In-person visits don't depend on the app, so they're skipped.

## Shadow mode (default — Phil's hard rule)

```
APP_VERSION_NUDGE_DRY_RUN=1   # default — composes message, logs preview, NO notifyPatient call
APP_VERSION_NUDGE_DRY_RUN=0   # live — calls notifyPatient → real ledger row + real send
APP_VERSION_NUDGE_ENABLED=0   # kill switch — cron returns { success: true, disabled: true }
```

Dry-run mode returns the full preview list in the response so the operator
can `curl` the route and audit who *would* be nudged before flipping the
flag:

```bash
curl -s "https://nowoptimal.com/ops/api/cron/app-version-nudge" \
     -H "x-cron-secret: $CRON_SECRET" | jq '.previews[0]'
# { patient_id, healthie_client_id, appointment_id, appointment_at,
#   contact_type, account_key, idempotency_key, gate_status, gate_reason,
#   current_version, min_supported_version, recommended_action,
#   title, sms_body, email_subject, email_body, preferred_channel }
```

## Read API

```ts
import {
  evaluateAppVersion,
  compareSemver,
  MIN_SUPPORTED_APP_VERSION,
  LATEST_APP_VERSION,
} from '@/lib/app-version-gate';

const evaluation = evaluateAppVersion({
  appInstalled: profile.appState.installed,
  versionMax: profile.appState.versionMax,
});

if (evaluation.needsUpdate) {
  // send nudge — recommendedAction is 'install' or 'update'
}
```

## Hard rules (Phase 3)

- **SHADOW mode on every clinic until Phil verifies.** Phase 4's gate rule:
  "shipped + tested in shadow → cutover (ours ON + Healthie OFF in one
  window) → never both-on (spam) or both-off (silence)".
- **`unknown` never fires.** Do not change this without explicit Phil
  approval — it's the day-1 safety net.
- **No clinical content in the nudge.** This is operational ("update your
  app"), not clinical, so it can ride the gateway. Lab/clinical results
  remain phone-only (Phil 2026-05-26).

## Verification (2026-05-26)

- **Typecheck**: 148 baseline errors in master = 148 with these files added
  (zero new errors from `lib/app-version-gate.ts` + cron + register-route
  edit).
- **Gate library smoke** (`.tmp/gate-smoke.ts`, since deleted): all 7
  evaluation cases + 5 `compareSemver` cases PASS.
- **Live candidate SQL on RDS**: 396 candidate patients (active, reachable on
  SMS or email, `allow_appointments=TRUE`); 353 with no app, 43 with app
  installed but `app_version_max=NULL`. Query runs in ~8ms.
- **No-spam day-1**: with mobile heartbeat unwired, the gate's `unknown`
  branch protects all 43 app-installed patients. Only the 353 no-app
  patients would see a nudge — and only those with a telehealth appt
  landing in the 36-48h window.

## Related artifacts

- Gateway: `lib/comms-gateway.ts` (`notifyPatient`)
- Ledger: `migrations/20260526_patient_communications.sql` + `lib/comms-ledger.ts`
- Profile view: `migrations/20260526_patient_comms_preferences.sql` (`v_patient_comms_profile.app_version_max`)
- Profile API: `lib/comms-profile.ts` (`appState.versionMax`)
- Mobile-side version check: `~/.gemini/antigravity/scratch/nowoptimal-headless-app/mobile-app/src/hooks/useAppVersionCheck.ts`
- Mobile-side latest-version source: `~/.gemini/antigravity/scratch/nowoptimal-headless-app/backend/lambda-booking/src/config.js` (`APP_VERSION.LATEST`)
- Sibling Phase 3 task: video-call gateway push (dispatch row `20260526-192907-f4ba`) — `lib/video-call-event.ts`, `app/api/video/notify-join/route.ts` (separate worktree, no file overlap)
- Reminder cadence standard: `docs/COMMS_REMINDER_STANDARD.md`
