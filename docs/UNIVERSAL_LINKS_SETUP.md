# Universal Links / App Links setup

> Makes `https://nowoptimal.com/ops/intake/abxtac` open the NOW Optimal app
> directly on iOS / Android, skipping the web hub interstitial. Drafted
> 2026-05-26; configuration is checked into git but **two placeholders + one
> nginx change need to land** before the linkage is live.

## What ships in this branch

| File | What it does |
|---|---|
| `public-static/.well-known/apple-app-site-association` | Apple's AASA file. Declares the app owns these URL paths: `/ops/intake/*`, `/intake/*`. Contains a `<APPLE_TEAM_ID>` placeholder. |
| `public-static/.well-known/assetlinks.json` | Google's Digital Asset Links file. Same idea for Android App Links. Contains two `<…SHA256…>` placeholders. |
| mobile-app `app.json` (separate repo, branch `claude/claude-task-2254f5ef/abxtac-intake-screen`) | `scheme: nowoptimal`, `ios.associatedDomains: [applinks:nowoptimal.com, webcredentials:nowoptimal.com]`, `android.intentFilters: [{autoVerify:true, pathPrefix:/ops/intake, /intake}]` |
| mobile-app `AppNavigator.tsx` linking config | prefixes `nowoptimal://`, `https://nowoptimal.com/ops`, `https://nowoptimal.com` (in that order; longest wins). Route `intake/:brand → Intake` |

## What Phil needs to fill in

### 1. Apple Team ID (in AASA)

Replace **both** `<APPLE_TEAM_ID>` occurrences in `public-static/.well-known/apple-app-site-association` with the 10-character Team ID.

To find it: <https://developer.apple.com/account> → Membership details → **Team ID**.

Result should look like (Team ID is 10 alphanumerics):
```json
"appID": "A1B2C3D4E5.com.nowoptimal.patient"
```

### 2. Android SHA-256 fingerprint(s) (in assetlinks.json)

Replace the two placeholders in `public-static/.well-known/assetlinks.json` with the SHA-256 fingerprints of the **upload key** and the **Play app-signing key** (Google's Play App Signing replaces the upload key when distributing — list both so internal/preview/EAS builds AND Play-store-signed builds both verify).

**To get them:**

```bash
# From the mobile-app project root:
eas credentials                              # interactive — pick Android → production → show credentials
# OR keytool if you have the .jks locally:
keytool -list -v -keystore <upload.jks> -alias <alias> | grep SHA256
```

For the Play app-signing fingerprint: **Google Play Console → Setup → App integrity → App signing → SHA-256 certificate fingerprint**.

Format expected: 64 hex chars, colon-separated bytes, e.g. `AB:CD:EF:01:23:...`.

### 3. nginx alias that serves the .well-known/ files at the root domain

The dashboard runs under basePath `/ops/`, so its `public/` is not served at `nowoptimal.com/.well-known/...` — and Apple + Google both fetch from the **exact** root path with **no redirects**. Add this block to `/etc/nginx/conf.d/nowoptimal.conf` inside the `server { listen 443 ssl; server_name nowoptimal.com www.nowoptimal.com; ... }` block, BEFORE the catch-all `location / { proxy_pass http://127.0.0.1:3008; }`:

```nginx
# Universal Link / App Link verification files. Apple + Google fetch these
# from the exact root path; must be served as application/json with no redirect.
location ^~ /.well-known/ {
    alias /home/ec2-user/gmhdashboard/public-static/.well-known/;
    default_type application/json;
    add_header Cache-Control "no-store, no-cache, must-revalidate";
    try_files $uri =404;
}

# Apple also accepts the legacy non-.well-known path; serve the same file.
location = /apple-app-site-association {
    alias /home/ec2-user/gmhdashboard/public-static/.well-known/apple-app-site-association;
    default_type application/json;
}
```

(The existing certbot `.well-known/acme-challenge/` location takes priority over our block when it exists during cert renewal, so this won't break renewals. If certbot's block is in a separate file, double-check ordering.)

After editing: `sudo nginx -t && sudo systemctl reload nginx`.

## Verification

```bash
# 1. AASA reachable + correct content-type
curl -sIL https://nowoptimal.com/.well-known/apple-app-site-association | grep -iE "HTTP|Content-Type"
# expect: HTTP/2 200, Content-Type: application/json

# 2. AASA body is valid JSON with the right appID
curl -sL https://nowoptimal.com/.well-known/apple-app-site-association | python3 -m json.tool

# 3. assetlinks.json reachable
curl -sIL https://nowoptimal.com/.well-known/assetlinks.json | grep -iE "HTTP|Content-Type"

# 4. Apple's tester  (paste into a browser):
https://app-site-association.cdn-apple.com/a/v1/nowoptimal.com

# 5. Google's tester:
https://developers.google.com/digital-asset-links/tools/generator
# enter site = https://nowoptimal.com, package = com.nowoptimal.patient
```

After the next mobile-app build is installed on a device with the new
`associatedDomains` / `intentFilters` baked in (an OTA update won't pick up
native config changes — needs a full EAS build + install), tapping
`https://nowoptimal.com/ops/intake/abxtac` should open the app directly
instead of the browser.

## Rollback

- Delete the AASA / assetlinks.json files (or set them to empty objects) →
  iOS/Android stop matching universal links. App still works via custom
  scheme `nowoptimal://` and via the web hub.
- Remove the nginx block → the same effect; files unreachable.
- Revert `app.json` `associatedDomains` / `intentFilters` → app stops
  claiming the URLs; next build only handles the custom scheme.
