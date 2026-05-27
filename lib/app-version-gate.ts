/**
 * App-version gate — server-side check for whether a patient's mobile app
 * can actually receive push (and therefore the push-delivered video-call
 * link) for an upcoming appointment.
 *
 * Phase 3 of project `untangling-healthie-communications-from-healthie`
 * (dispatch row `20260526-192910-191f`). Companion to:
 *   - migrations/20260526_patient_comms_preferences.sql
 *       (`patient_push_tokens.app_version` + `v_patient_comms_profile.app_version_max`)
 *   - lib/comms-profile.ts (`appState.versionMax`)
 *   - app/api/cron/app-version-nudge/route.ts (the writer that uses this)
 *
 * Goal: if a patient is heading into a telehealth/video appointment but
 * (a) has no app installed (no active push token) OR
 * (b) is running an app version below MIN_SUPPORTED_APP_VERSION,
 * push won't work — and the sibling Phase-3 "join your video" push
 * (claude-task-2907f4ba) won't reach them. We nudge them on a non-push
 * channel BEFORE the appointment so they can update / install.
 *
 * NULL handling (important):
 *   patient_push_tokens.app_version is currently NULL on every active token
 *   (50/50 as of 2026-05-26) because the mobile heartbeat that would write it
 *   isn't wired yet. Treating NULL as "outdated" would spam all 50 patients
 *   on day 1. So this gate treats NULL as `'unknown'` and returns
 *   `needsUpdate=false`. Once the mobile app is wired (separate task) and
 *   starts reporting versions, this gate begins firing organically — no code
 *   change here required.
 *
 * Channel-selection note: the gateway's normal priority is push → SMS →
 * email. For this nudge specifically push is *guaranteed* to fail (that's
 * the whole point of the nudge), so the cron caller passes
 * `preferredChannel: 'sms'` to skip push outright.
 */

/** Lowest app version that can reliably receive push + render the video link.
 *  Override via env `MIN_SUPPORTED_APP_VERSION` (e.g. when a regression is
 *  found in a shipped build and you need to nudge everyone below the patched
 *  release). Defaults to the same string the Lambda config currently treats
 *  as `LATEST` (2.2.0) — runtimeVersion.policy is `appVersion` so older
 *  `version`s can't OTA-update; they need a store update. */
export const MIN_SUPPORTED_APP_VERSION: string =
  process.env.MIN_SUPPORTED_APP_VERSION || '2.2.0';

/** Most recent published app version. Used for the human-readable nudge copy
 *  ("the latest is 2.3.0"). Defaults to MIN_SUPPORTED so messaging stays
 *  sensible when only one variable is set. */
export const LATEST_APP_VERSION: string =
  process.env.LATEST_APP_VERSION || MIN_SUPPORTED_APP_VERSION;

export const IOS_STORE_URL =
  process.env.IOS_STORE_URL ||
  'https://apps.apple.com/us/app/now-optimal/id6759345635';

export const ANDROID_STORE_URL =
  process.env.ANDROID_STORE_URL ||
  'https://play.google.com/store/apps/details?id=com.nowoptimal.patient';

/**
 * Compare two semver-ish strings (e.g. "2.2.0" vs "2.3.0").
 * Returns -1 if a<b, 0 if equal, 1 if a>b. Missing segments treated as 0.
 * Mirrors the mobile-side helper in
 * `~/.gemini/antigravity/scratch/nowoptimal-headless-app/mobile-app/src/hooks/useAppVersionCheck.ts`
 * so server + client agree on which version is "newer".
 *
 * Returns `null` when either input doesn't parse to at least one numeric
 * segment — caller decides what to do with malformed input (typically:
 * treat as `unknown`, do not nudge).
 */
export function compareSemver(a: string, b: string): number | null {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  const parse = (s: string): number[] | null => {
    const segs = s.trim().split('.').map((n) => parseInt(n, 10));
    if (segs.length === 0 || !Number.isFinite(segs[0])) return null;
    return segs.map((n) => (Number.isFinite(n) ? n : 0));
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export type AppVersionStatus = 'no_app' | 'outdated' | 'unknown' | 'ok';

export interface AppVersionEvaluation {
  /** True iff the gate thinks push (and therefore the push-delivered video
   *  link) cannot reach this patient and we should send an update/install
   *  nudge on a non-push channel. */
  needsUpdate: boolean;
  status: AppVersionStatus;
  /** The patient's current reported version, or null if unknown / no app. */
  currentVersion: string | null;
  /** The minimum we require — handy to surface in templates / logs. */
  minSupportedVersion: string;
  /** The latest published version — handy to surface in templates / logs. */
  latestVersion: string;
  /** What the patient should do. `'install'` means no app at all,
   *  `'update'` means app installed but below minimum, `'none'` means no
   *  action needed. */
  recommendedAction: 'install' | 'update' | 'none';
  storeLinks: { ios: string; android: string };
  /** Short machine-readable reason, useful in dry-run previews and logs. */
  reason: string;
}

export interface AppVersionInputs {
  /** Does the patient have at least one active push token? Sourced from
   *  `CommsProfile.appState.installed` or equivalent. */
  appInstalled: boolean;
  /** Highest version across the patient's active devices, or null if no
   *  device has reported a version yet. Sourced from
   *  `CommsProfile.appState.versionMax`. */
  versionMax: string | null;
}

/**
 * Decide whether this patient needs an app-version nudge.
 *
 *   no_app   →  appInstalled === false                       needsUpdate=true
 *   outdated →  appInstalled && versionMax < MIN_SUPPORTED   needsUpdate=true
 *   unknown  →  appInstalled && versionMax is null/unparsable needsUpdate=false (do NOT nudge)
 *   ok       →  appInstalled && versionMax >= MIN_SUPPORTED  needsUpdate=false
 *
 * The `unknown` branch is the safety valve: until the mobile heartbeat that
 * writes `app_version` is wired (separate future task), every active token
 * carries `app_version=NULL`. Nudging them all would spam 50+ patients on
 * day 1. Once mobile starts writing versions, `unknown` shrinks to a tail
 * and `outdated` becomes the live signal.
 */
export function evaluateAppVersion(inputs: AppVersionInputs): AppVersionEvaluation {
  const storeLinks = { ios: IOS_STORE_URL, android: ANDROID_STORE_URL };

  if (!inputs.appInstalled) {
    return {
      needsUpdate: true,
      status: 'no_app',
      currentVersion: null,
      minSupportedVersion: MIN_SUPPORTED_APP_VERSION,
      latestVersion: LATEST_APP_VERSION,
      recommendedAction: 'install',
      storeLinks,
      reason: 'no_active_push_token',
    };
  }

  if (!inputs.versionMax) {
    return {
      needsUpdate: false,
      status: 'unknown',
      currentVersion: null,
      minSupportedVersion: MIN_SUPPORTED_APP_VERSION,
      latestVersion: LATEST_APP_VERSION,
      recommendedAction: 'none',
      storeLinks,
      reason: 'version_not_reported_by_device',
    };
  }

  const cmp = compareSemver(inputs.versionMax, MIN_SUPPORTED_APP_VERSION);
  if (cmp === null) {
    return {
      needsUpdate: false,
      status: 'unknown',
      currentVersion: inputs.versionMax,
      minSupportedVersion: MIN_SUPPORTED_APP_VERSION,
      latestVersion: LATEST_APP_VERSION,
      recommendedAction: 'none',
      storeLinks,
      reason: 'version_unparsable',
    };
  }

  if (cmp < 0) {
    return {
      needsUpdate: true,
      status: 'outdated',
      currentVersion: inputs.versionMax,
      minSupportedVersion: MIN_SUPPORTED_APP_VERSION,
      latestVersion: LATEST_APP_VERSION,
      recommendedAction: 'update',
      storeLinks,
      reason: `version_below_min:${inputs.versionMax}<${MIN_SUPPORTED_APP_VERSION}`,
    };
  }

  return {
    needsUpdate: false,
    status: 'ok',
    currentVersion: inputs.versionMax,
    minSupportedVersion: MIN_SUPPORTED_APP_VERSION,
    latestVersion: LATEST_APP_VERSION,
    recommendedAction: 'none',
    storeLinks,
    reason: 'version_ok',
  };
}
