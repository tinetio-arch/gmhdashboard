# ABXTAC Self-Serve Intake — Rollout Runbook

> Execute top-to-bottom. Phases 1 + 3 can be parallel; Phase 2 has a 1–3 day
> App-Store / Play-Store review window built in. Total wall-clock: ~1 week.
> Each step has a ☐ checkbox + a "done when" verification. Deep context is in
> `INTAKE_MIGRATION_PLAYBOOK.md` / `UNIVERSAL_LINKS_SETUP.md` /
> `ABXTAC_INTAKE_EMAIL_DRAFT.md` / `ABXTAC_PATIENT_COMMS_AUDIT.md`.

## Pre-flight

- ☐ Branches that ship this work:
  - **Dashboard:** `claude/claude-task-2254f5ef/healthie-intake-abxtac-deep-dive-safety-` (gmhdashboard worktree)
  - **Mobile app:** `claude/claude-task-2254f5ef/abxtac-intake-screen` (mobile-app worktree at `~/.gemini/antigravity/scratch/mobile-app-intake-wt`)
- ☐ Branches reviewed + ready to merge (or PRs opened).
- ☐ Healthie group 82534 still has **no onboarding flow attached** (verified silent — re-run `.tmp/probe-healthie-abxtac.ts` if you want to re-confirm).

## Phase 1 — Server-side (day 1, ~30 min)

### 1. Fill placeholders in the AASA + assetlinks files (dashboard branch)

- ☐ **Apple Team ID** (10 chars, Apple Developer → Membership → Team ID). Replace both `<APPLE_TEAM_ID>` in `public-static/.well-known/apple-app-site-association`.
- ☐ **Android SHA-256 fingerprints** — at least the upload key now (Play app-signing fingerprint can be added later from Play Console once the app is in review). In the mobile-app dir:
  ```bash
  cd ~/.gemini/antigravity/scratch/mobile-app-intake-wt
  eas credentials   # → Android → production → Keystore → show SHA-256
  ```
  Replace placeholders in `public-static/.well-known/assetlinks.json`.
- ☐ Commit: `git add public-static/.well-known && git commit -m "chore(intake): fill universal-link placeholders"`

**Done when:** both files contain real values; `python3 -m json.tool` parses them.

### 2. Merge dashboard branch + deploy

- ☐ Confirm pre-deploy gate is green:
  ```bash
  cd ~/gmhdashboard
  bash scripts/pre-deploy-check.sh
  ```
- ☐ Merge dashboard branch into `master` (locally; **do not push to origin/master** without explicit OK).
- ☐ Build + restart:
  ```bash
  cd ~/gmhdashboard && npm run build && pm2 restart gmh-dashboard && pm2 save
  ```
- ☐ Health-check:
  ```bash
  bash ~/gmhdashboard/scripts/health-check.sh
  ```

**Done when:** pre-deploy returns 0, build succeeds, `pm2 list` shows `gmh-dashboard` online, health-check report shows no new regressions.

### 3. Add the nginx alias for `.well-known/*`

- ☐ Back up first: `sudo cp /etc/nginx/conf.d/nowoptimal.conf /etc/nginx/conf.d/nowoptimal.conf.bak-$(date +%Y%m%d)`
- ☐ Add the **exact** location blocks from `docs/UNIVERSAL_LINKS_SETUP.md` §3 into the `server { listen 443 ssl; server_name nowoptimal.com www.nowoptimal.com; ... }` block, **before** the catch-all `location /`.
- ☐ Test + reload: `sudo nginx -t && sudo systemctl reload nginx`
- ☐ Verify:
  ```bash
  curl -sIL https://nowoptimal.com/.well-known/apple-app-site-association | grep -iE "HTTP|Content-Type"
  # expect: HTTP/2 200, Content-Type: application/json
  curl -sL https://nowoptimal.com/.well-known/apple-app-site-association | python3 -m json.tool
  # expect: parses cleanly, appID has the real Team ID
  curl -sIL https://nowoptimal.com/.well-known/assetlinks.json | grep -iE "HTTP|Content-Type"
  ```
- ☐ Run Apple's tester in a browser: `https://app-site-association.cdn-apple.com/a/v1/nowoptimal.com`

**Done when:** all four checks pass; Apple's CDN returns the file.

### 4. Verify the web hub is live

- ☐ Visit `https://nowoptimal.com/ops/intake/abxtac` from a **desktop** browser → expect the multi-form wizard (identity step → 7 forms).
- ☐ Visit from an **iPhone/Android** browser → expect "Open in app / Get the app" hero (the app isn't installed yet, so "or continue in browser" is the path that works today).
- ☐ Confirm `customer_completed_order` + `customer_on_hold_order` are still disabled (was done 2026-05-26):
  ```bash
  wp --path=/var/www/abxtac eval 'foreach (WC()->mailer()->get_emails() as $e) { if (in_array($e->id, ["customer_completed_order","customer_on_hold_order"])) printf("%s=%s\n",$e->id,$e->is_enabled()?"yes":"no"); }'
  # expect both = no
  ```

## Phase 2 — Mobile app submission (day 1 → ~day 5)

### 5. EAS build for production

- ☐ Confirm `app.json` placeholders are real (App Store IDs in the **web hub** can stay placeholders for now; we update those once the app is approved). The mobile-app `app.json` should have:
  - `scheme: "nowoptimal"`
  - `ios.bundleIdentifier: "com.nowoptimal.patient"`
  - `ios.associatedDomains: ["applinks:nowoptimal.com", "webcredentials:nowoptimal.com"]`
  - `android.package: "com.nowoptimal.patient"`
  - `android.intentFilters` with `autoVerify: true` for `/ops/intake` + `/intake`
- ☐ Merge mobile branch into mobile-app `main` (or your trunk) **locally**.
- ☐ Build:
  ```bash
  cd ~/.gemini/antigravity/scratch/nowoptimal-headless-app/mobile-app
  eas build --platform all --profile production
  ```
- ☐ Wait for build to complete (~15–30 min).

**Done when:** EAS dashboard shows both iOS + Android builds green.

### 6. Submit to App Store + Play Console

- ☐ `eas submit --platform ios --profile production` (uses `ascAppId 6759345635` from `eas.json`).
- ☐ `eas submit --platform android --profile production` (uses `google-play-service-account.json`).
- ☐ In **App Store Connect**: complete the build metadata, "What's New" notes, submit for review.
- ☐ In **Play Console**: promote the new build to production track, submit for review.

### 7. Wait for review (typically 1–3 days)

- ☐ Monitor App Store Connect + Play Console for status. Address any rejections (most common: privacy questionnaire updates).

### 8. Once approved — drop in real store URLs

- ☐ Get the Apple App Store ID from the listing URL (the `id<digits>` part of `apps.apple.com/app/idNNN...`).
- ☐ Get the Play Console listing URL (`https://play.google.com/store/apps/details?id=com.nowoptimal.patient` — already correct).
- ☐ Edit `app/intake/[brand]/IntakeHub.tsx` in the dashboard:
  - Replace `idPLACEHOLDER` with the real Apple ID
  - Replace `com.nowoptimal.PLACEHOLDER` with `com.nowoptimal.patient` (or confirm)
- ☐ Commit, merge, deploy:
  ```bash
  cd ~/gmhdashboard && bash scripts/pre-deploy-check.sh && npm run build && pm2 restart gmh-dashboard && pm2 save
  bash scripts/health-check.sh
  ```

### 9. Add Play app-signing SHA-256 to assetlinks.json

- ☐ **Play Console → Setup → App integrity → App signing → SHA-256 certificate fingerprint** (this is the one Google issues; differs from the upload key).
- ☐ Replace `<PLAY_APP_SIGNING_SHA256_FROM_PLAY_CONSOLE>` in `public-static/.well-known/assetlinks.json`.
- ☐ Commit + deploy (same as step 2). No nginx change needed.
- ☐ Re-run Google's tester: `https://developers.google.com/digital-asset-links/tools/generator` — site `https://nowoptimal.com`, package `com.nowoptimal.patient`.

**Done when:** Google's tester returns "Verification successful." Apple's tester returned success earlier in step 3.

## Phase 3 — GHL workflow (parallel with Phase 2, after Phase 1)

### 10. Build the email in GHL

- ☐ GHL ABXTAC location → **Marketing → Emails → New Email** → paste HTML body from `docs/ABXTAC_INTAKE_EMAIL_DRAFT.md` §"Email 1".
- ☐ Subject: pick one of A/B/C from the doc (recommended: C — personalized).
- ☐ From: `ABXTAC Care Team <admin@granitemountainhealth.com>` (or your dedicated sender).
- ☐ Preheader: from the doc.
- ☐ Same for **Email 2** (48h reminder) — uses plain text only.

### 11. Build + publish the workflow

- ☐ Trigger: **contact tag added = "Telehealth Consult Booked"** AND not tagged "Intake Complete".
- ☐ Step 1: Send Email "Welcome / Complete Intake".
- ☐ Step 2: Wait 48 hours.
- ☐ Step 3: If tag "Intake Complete" → exit; else Send Email "Reminder".
- ☐ Step 4: Wait 24 hours.
- ☐ Step 5: If "Intake Complete" → exit; else create an internal task (Slack / Telegram).
- ☐ **Publish** the workflow.

**Done when:** workflow shows status **Published** (the other 10 lifecycle workflows for ABXTAC are all still draft today — that's expected, this is the first one we light up).

## Phase 4 — End-to-end smoke test with one real patient (you)

### 12. Self-test before going live

- ☐ Create a test contact in the ABXTAC GHL location with your own email/phone.
- ☐ Apply the tag `Telehealth Consult Booked` to that contact.
- ☐ Within a few minutes, the email arrives. Open it on your phone.
- ☐ Tap the link. **Expected:** app opens directly to the Intake screen (universal link working). If the app isn't installed yet, the hub renders with "Get the app" + the web fallback.
- ☐ Complete identity + all 7 forms.
- ☐ Verify on the dashboard side:
  ```bash
  PGPASSWORD="$DATABASE_PASSWORD" PGSSLMODE=require psql -h "$DATABASE_HOST" -U "$DATABASE_USER" -d "$DATABASE_NAME" -c "
    SELECT slug, count(*) FROM intake_submissions s
      JOIN form_definitions d USING (form_def_id)
     WHERE applicant_email = '<your-test-email>'
     GROUP BY slug ORDER BY slug;"
  # expect: 7 rows, all status = provisioned OR healthie_unmapped OR local_only
  ```
- ☐ Verify the GHL contact got the **`Intake Complete`** tag (GHL UI → contact → Tags).
- ☐ If `INTAKE_PUSH_TO_HEALTHIE` is still on (default), confirm the patient is in Healthie group 82534 with `dont_send_welcome` honored (the patient should NOT have received a Healthie email).

**Done when:** all 7 submissions captured, GHL tagged, no Healthie comms reached the customer.

### 13. Clean up the test contact

- ☐ Delete or archive the test GHL contact + the test rows in `intake_submissions` + `patients`.
- ☐ Delete the test patient in Healthie if `INTAKE_PUSH_TO_HEALTHIE` was on.

## Phase 5 — Migrate ABXTAC fully off Healthie intake (steady state, ~1 week later)

Run this once a few real ABXTAC patients have completed intake successfully with no operational hiccups.

- ☐ Add to the production `.env.local`: `INTAKE_PUSH_TO_HEALTHIE=false`
- ☐ Restart: `pm2 restart gmh-dashboard && pm2 save`
- ☐ Send a second test through (or watch the next real one). Verify the submission status is **`local_only`** and no Healthie chart was created.

**Done when:** new ABXTAC intakes land status=`local_only`, our DB is the system of record, Healthie sees nothing.

## Rollback playbook

| If… | Then… |
|---|---|
| Universal links broken / iOS not opening app | Revert step 3 (remove nginx alias) OR delete the AASA file. Patients fall back to the web hub or the custom-scheme link. |
| GHL workflow over-emailing | Pause the workflow in GHL UI. Email content already wrote the patient at most twice (initial + 48h). |
| Healthie kill-switch causes operational issues | Remove `INTAKE_PUSH_TO_HEALTHIE` from env, `pm2 restart`. New intakes resume pushing to Healthie chart. |
| Dashboard intake API broken | Disable the GHL workflow (so no new patients are sent the link). Patients with the link in hand can still complete via the web hub or app — the link points at our DB, not Healthie, so backend issues are isolated. |
| WC email trims caused a complaint | One-liner rollback in `ABXTAC_PATIENT_COMMS_AUDIT.md` re-enables the two disabled WC emails. |

---

**Other brands** (Now Men's Health, Primary Care, Longevity): once ABXTAC has been steady-state for a week or two, the same flow re-runs per brand:

1. Copy `scripts/wire-abxtac-intake.ts` → `wire-<brand>-intake.ts`, change the `BRAND_CONFIG` block (brand_key, client_type_key, 8 form names/IDs), run once.
2. Add the brand to `BRAND_FORMS` in `app/intake/[brand]/page.tsx` AND `src/screens/IntakeWizardScreen.tsx`.
3. Add the brand's GHL location to `getGHLClientForBrand()` in `lib/intakeGhlTagging.ts`.
4. Confirm the brand's Healthie group has no onboarding flow (or accept it).
5. Draft/build the GHL email + workflow at the brand's GHL location.
6. Test → flip the kill-switch when ready.
