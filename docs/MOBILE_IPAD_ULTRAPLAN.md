# MOBILE & iPAD ULTRAPLAN — Complete Audit & Fix Roadmap

**Created**: April 9, 2026 (Overnight Autonomous Session)  
**Author**: AntiGravity (Claude Code)  
**Scope**: Mobile app, Headless APIs, Jarvis APIs, iPad APIs  
**Safety**: No deletes. No dashboard changes outside api/headless, api/ipad, api/jarvis.

---

## TABLE OF CONTENTS

| # | Section | Priority |
|---|---------|----------|
| 1 | [System Inventory](#1-system-inventory) | Reference |
| 2 | [P0 — Security Issues (Fix Immediately)](#2-p0--security-issues) | CRITICAL |
| 3 | [P1 — Broken Functionality](#3-p1--broken-functionality) | HIGH |
| 4 | [P2 — Bugs & Data Issues](#4-p2--bugs--data-issues) | MEDIUM |
| 5 | [P3 — Missing Features & Polish](#5-p3--missing-features--polish) | LOW |
| 6 | [Dependency Chain](#6-dependency-chain) | Planning |
| 7 | [Fix Execution Order](#7-fix-execution-order) | Action |

---

## 1. SYSTEM INVENTORY

### Mobile App — 21 Screens
**Location**: `/home/ec2-user/.gemini/antigravity/scratch/nowoptimal-headless-app/mobile-app/`

| Screen | File | Status | Notes |
|--------|------|--------|-------|
| Login | `LoginScreen.tsx` | OK | Animated, brand-aware |
| Dashboard | `DashboardScreen.tsx` | Minor issues | See P2-01, P2-02 |
| Booking | `BookingScreen.tsx` | Bug | See P1-02 |
| Forms | `FormsScreen.tsx` | OK | Not Started/Pending badges |
| FormViewer | `FormViewerScreen.tsx` | OK | WebView + CSS injection |
| ChatList | `ChatListScreen.tsx` | OK | Conversations list |
| ChatRoom | `ChatRoomScreen.tsx` | OK | Message thread |
| Jarvis | `JarvisScreen.tsx` | OK | AI chat with routing |
| Profile | `ProfileScreen.tsx` | OK | Patient profile |
| EditProfile | `EditProfileScreen.tsx` | OK | Profile editing |
| Appointments | `AppointmentsScreen.tsx` | OK | Video call button |
| Documents | `DocumentsScreen.tsx` | OK | Shared docs filter |
| Journal | `JournalScreen.tsx` | OK | CRUD via entries API |
| Metrics | `MetricsScreen.tsx` | OK | Dynamic categories |
| Billing | `BillingScreen.tsx` | OK | Invoices |
| PaymentMethods | `PaymentMethodsScreen.tsx` | OK | Card management |
| AddCard | `AddCardScreen.tsx` | OK | Pure JS Stripe tokenization |
| PeptideEducation | `PeptideEducationScreen.tsx` | Minor | See P2-03 |
| **Cart** | `CartScreen.tsx` | Bug | See P1-01 (NEW, not in SOT) |
| **ConsentForm** | `ConsentFormScreen.tsx` | OK | Signature pad works (NEW) |
| **VideoCall** | `VideoCallScreen.tsx` | OK | WebView video (NEW) |

### Supporting Files
| File | Purpose | Issues |
|------|---------|--------|
| `src/api.ts` | API client (fetch wrapper) | OK — hardcoded prod URL |
| `src/lib/woocommerce.ts` | WooCommerce client | **P0-01: API KEYS IN SOURCE** |
| `src/context/AuthContext.tsx` | Auth + access check | OK — periodic 5min checks |
| `src/context/ThemeContext.tsx` | Chameleon branding | OK |
| `src/context/CartContext.tsx` | Shopping cart state | OK (NEW) |
| `src/utils/dateUtils.ts` | Arizona timezone dates | OK — robust parsing |
| `src/config/booking.ts` | Booking config | OK |
| `src/constants/peptides.ts` | Peptide education data | OK |
| `src/constants/themes.ts` | Theme definitions | OK |
| `src/navigation/AppNavigator.tsx` | Stack + Tab nav | OK — all 21 screens registered |

### Headless API Endpoints (10)
**Location**: `gmhdashboard/app/api/headless/`

| Endpoint | Method | Auth | Status | Issues |
|----------|--------|------|--------|--------|
| `/access-check` | GET | None (by design — public) | OK | Defaults to allowed if patient not found |
| `/lab-status` | GET | Access control check | OK | |
| `/checkout` | POST | x-jarvis-secret | OK | Stripe + WooCommerce + ShipStation |
| `/consent` | POST | x-jarvis-secret | OK | PDF generation + Healthie upload |
| `/pending-consent` | GET, POST | **NONE** | **P0-02** | Patient data exposed |
| `/billing-status` | GET | Needs audit | Needs review | |
| `/patient-context` | GET | x-jarvis-secret | OK | |
| `/patient-services` | GET | Needs audit | Needs review | |
| `/record-app-login` | POST | Needs audit | Needs review | |
| `/update-avatar` | POST | None (Lambda only) | OK | SOT says no auth needed |

### Jarvis API Endpoints (6)
**Location**: `gmhdashboard/app/api/jarvis/`

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/balance` | GET | Needs audit | Patient balance lookup |
| `/payment-link` | POST | Needs audit | Generate payment link |
| `/peptide-eligibility` | GET | Needs audit | Check tier eligibility |
| `/peptide-order` | POST | Needs audit | Process peptide order |
| `/peptides` | GET | Needs audit | List available peptides |
| `/share` | POST | Needs audit | Share conversation with provider |

### iPad API Endpoints (20 directories)
**Location**: `gmhdashboard/app/api/ipad/`

| Directory | Purpose |
|-----------|---------|
| `appointment-status` | Appointment status management |
| `billing` | In-clinic billing |
| `ceo` | CEO dashboard data |
| `critical-labs` | Critical lab alerts |
| `dashboard` | iPad dashboard stats |
| `document` | Document management |
| `icd10-search` | ICD-10 code search |
| `kiosk` | Kiosk check-in mode |
| `me` | Current user info |
| `messages` | Messaging |
| `patient` | Patient lookup/CRUD |
| `patient-chart` | Chart data |
| `patient-data` | Patient data aggregation |
| `previsit-tasks` | Pre-visit task list |
| `quick-dispense` | Quick testosterone dispense |
| `schedule` | Schedule view |
| `staff-tasks` | Staff task management |
| `stage-dose` | TRT dose staging |
| `tasks` | General task management |
| `vitals` | Vitals recording |

### Lambda Functions (4)
| Lambda | Purpose | Timeout | Memory |
|--------|---------|---------|--------|
| `lambda-auth-node` | Healthie login + access check | 10s | 128MB |
| `lambda-booking` | 33 actions (booking, forms, chat, etc.) | **30s** (live override) | **256MB** (live override) |
| `lambda-data-pipe-python` | Webhook -> Snowflake | 30s | 128MB |
| `lambda-ask-ai` | RAG + Peptide bot + Checkout routing | 60s | 128MB |

---

## 2. P0 — SECURITY ISSUES

### P0-01: WooCommerce API Keys Hardcoded in Mobile App Source

**File**: `mobile-app/src/lib/woocommerce.ts:8-9`
```
const WC_KEY = 'ck_e78fc234e51d5e38d2d000353af1a27cb7f1f16e';
const WC_SECRET = 'cs_c84a7c3631856255ff98cbfc65d2861052d4ba03';
```

**Risk**: CRITICAL. These are live WooCommerce REST API keys with read/write access to the ABXTac store. Anyone who decompiles the APK/IPA can extract them and:
- Read all orders and customer data
- Create/modify/delete products and orders
- Access customer billing information

**Fix**: 
1. Create a new Lambda action `get_products` in `lambda-ask-ai` that proxies WooCommerce product fetches
2. Remove `woocommerce.ts` from the mobile app entirely
3. Rotate the WC API keys immediately after deploying the proxy
4. The `createOrder` function is already unused in the mobile app (checkout goes through the dashboard's `/api/headless/checkout`)

**Affected files**:
- `mobile-app/src/lib/woocommerce.ts` — Remove keys, route through Lambda
- `mobile-app/src/screens/PeptideEducationScreen.tsx` — Update to use Lambda proxy
- `mobile-app/src/screens/CartScreen.tsx` — Uses `getProductImageUrl` only (images are public URLs, OK)
- `backend/lambda-ask-ai/src/index.js` — Add `get_products` action
- `backend/lambda-ask-ai/src/peptide-bot.js` — Add WC product fetch function

### P0-02: pending-consent Endpoint Has No Authentication

**File**: `gmhdashboard/app/api/headless/pending-consent/route.ts`

**Risk**: HIGH. Both GET and POST have zero authentication:
- `GET /api/headless/pending-consent?healthie_id=12345` — Anyone can query any patient's pending consent data (items, order details)
- `POST /api/headless/pending-consent` — Anyone can mark a consent as signed without actually signing it

**Fix**:
1. Add `x-jarvis-secret` header validation (same pattern as `/checkout` and `/consent`)
2. The mobile app currently calls this endpoint directly via `fetch()` in `ConsentFormScreen.tsx:225` — must route through Lambda instead
3. The `DashboardScreen.tsx` gets consent data through the `get_dashboard_alerts` Lambda action (already proxied correctly)

**Affected files**:
- `gmhdashboard/app/api/headless/pending-consent/route.ts` — Add x-jarvis-secret auth
- `mobile-app/src/screens/ConsentFormScreen.tsx:225` — Route POST through Lambda
- `backend/lambda-ask-ai/src/index.js` — Add `mark_consent_signed` action

---

## 3. P1 — BROKEN FUNCTIONALITY

### P1-01: Cart -> Consent -> Cart Flow Broken (consentSigned never passed back)

**File**: `mobile-app/src/screens/CartScreen.tsx:26-43`

**Bug**: When a user taps "Checkout" without prior consent:
1. CartScreen checks `consentSigned` from route params (line 26) — always false on first visit
2. Checks SecureStore for `peptide_consent_{userId}` (line 37)
3. If no stored consent, navigates to `ConsentForm` (line 40)
4. After signing, ConsentFormScreen calls `navigation.goBack()` (line 245)
5. Cart remounts but `route.params.consentSigned` is still false/undefined
6. SecureStore IS updated by ConsentFormScreen (line 217), so the SECOND checkout attempt works

**Impact**: User must tap "Checkout" TWICE after signing consent. First tap after signing does nothing visible (checks SecureStore, finds it, but the flow feels broken because the checkout confirmation dialog doesn't appear immediately).

**Fix**: ConsentFormScreen should navigate back with params: `navigation.navigate('Cart', { consentSigned: true })` instead of `navigation.goBack()`.

**Affected files**:
- `mobile-app/src/screens/ConsentFormScreen.tsx:245` — Change goBack to navigate with params

### P1-02: BookingScreen Uses Raw Date() Instead of dateUtils (Arizona Timezone Bug)

**File**: `mobile-app/src/screens/BookingScreen.tsx:69-76`

**Bug**: `formatLabDate()` at line 69 uses `new Date(dateStr)` directly, then `getMonth()`, `getDate()`, `getFullYear()`. This returns the date in the user's LOCAL timezone, not Arizona time. For patients in other timezones (or if the device timezone is wrong), the lab due date shows incorrectly.

The app has a robust `dateUtils.ts` with `formatDate()` that uses `America/Phoenix` timezone — it's already imported on line 14 as `formatDateTime` but `formatLabDate` is a separate local function that doesn't use it.

**Fix**: Replace the local `formatLabDate` function with the imported `formatDate` from `dateUtils.ts`.

**Affected files**:
- `mobile-app/src/screens/BookingScreen.tsx:14,69-76` — Use formatDate from dateUtils

### P1-03: Stripe PK Hardcoded in AddCardScreen (Not a Secret, But Needs Env)

**File**: `mobile-app/src/screens/AddCardScreen.tsx` (confirmed in SOT line 485)

**Issue**: `pk_live_WzFpsrfurxhcz0HJspt9nbnn` is hardcoded. Stripe publishable keys are NOT secrets (they're meant for client-side use), but hardcoding them means you can't switch between test/live environments without a code change.

**Fix**: Move to a config constant or environment variable. Lower priority than P0 issues.

---

## 4. P2 — BUGS & DATA ISSUES

### P2-01: Dashboard Peptide Quick Action Missing

**File**: `mobile-app/src/screens/DashboardScreen.tsx:116-181`

**Issue**: The Dashboard has 9 quick actions but no "Peptide Shop" button. Users must navigate: Profile > (somewhere?) > PeptideEducation. The PeptideEducation screen is only reachable via the navigation stack, not from any visible button on the dashboard.

**Fix**: Add a "Peptide Shop" quick action to the dashboard grid that navigates to `PeptideEducation`. Also add a cart badge indicator.

### P2-02: Dashboard Doesn't Show Cart Badge

**File**: `mobile-app/src/screens/DashboardScreen.tsx`

**Issue**: If a user has items in their cart and navigates away from PeptideEducation, there's no indication anywhere that they have an active cart. The cart count is available via `useCart().itemCount` but isn't displayed on the Dashboard or in the tab bar.

**Fix**: Add cart badge to the header or as a floating action button.

### P2-03: PeptideEducation findEducation() Matching is Fragile

**File**: `mobile-app/src/screens/PeptideEducationScreen.tsx:72-78`

**Issue**: `findEducation()` does a simple substring match between WooCommerce product names and the peptides.ts catalog. WooCommerce names like "Wolverine Blend - BPC-157 (10mg) / TB500 (10mg)" won't match peptides.ts entries like "BPC-157 / TB-500 (10mg/10mg)". The ConsentFormScreen has a much more robust `findAllPeptideInfo()` with compound extraction — but PeptideEducation uses a simpler version.

**Fix**: Extract the `extractCompounds()` + `findAllPeptideInfo()` logic from ConsentFormScreen into a shared utility, use it in both screens.

### P2-04: `opentok-react-native` Dependency Unused

**File**: `mobile-app/package.json:32`

**Issue**: `"opentok-react-native": "^2.31.2"` is listed as a dependency but never imported anywhere. The VideoCallScreen uses WebView-based video, not OpenTok/Vonage. This adds unnecessary native dependencies and can cause build issues.

**Fix**: Remove from package.json.

### P2-05: Navigation Has Duplicate Screen Names

**File**: `mobile-app/src/navigation/AppNavigator.tsx`

**Issue**: `Documents` and `Appointments` appear both as Tab screens (lines 73-79) AND as Stack screens (lines 155-163). This can cause navigation confusion — `navigation.navigate('Documents')` might go to the tab or the stack depending on context.

**Fix**: Rename the stack versions to `DocumentsStack` and `AppointmentsStack`, or remove the duplicate stack entries since they're already accessible via tabs.

### P2-06: ConsentFormScreen Direct fetch() to Dashboard (Bypasses Lambda)

**File**: `mobile-app/src/screens/ConsentFormScreen.tsx:225`

**Issue**: Line 225 makes a direct `fetch()` call to `https://nowoptimal.com/ops/api/headless/pending-consent/` — bypassing the Lambda proxy that adds the `x-jarvis-secret` header. This call will fail once P0-02 is fixed (adding auth to pending-consent).

**Fix**: Route through Lambda (covered in P0-02 fix).

### P2-07: CDK Stack Out of Sync with Live Lambda Config

**Issue** (from SOT): CDK stack still has booking Lambda at 15s/128MB. Live overrides are 30s/256MB. Running `cdk deploy` will revert these settings.

**Fix**: Update `backend/infra/lib/headless-app-stack.js` to match live config before any CDK deployment.

### P2-08: Unread Message Count Hardcoded to 0

**Issue** (from SOT Known Issues): Real unread message count is not implemented. The app always shows 0 unread messages. The Lambda `get_conversations` action returns conversations but doesn't track read state.

**Fix**: Implement unread tracking — either via Healthie's read receipts or local storage of last-read message timestamps.

---

## 5. P3 — MISSING FEATURES & POLISH

### P3-01: No Peptide Shop in Tab Bar or Dashboard
Users have no obvious way to reach the peptide shop. It should be prominently accessible.

### P3-02: No Order History Screen
After checkout, patients can't see their past peptide orders. The data exists in `peptide_dispenses` and `payment_transactions` tables but there's no mobile screen to display it.

### P3-03: No Push Notifications
SOT lists this as a nice-to-have. Critical for: appointment reminders, lab due alerts, new messages, consent form requests.

### P3-04: No Offline Mode Detection
App shows generic errors when offline instead of a clear "No internet connection" message.

### P3-05: No Biometric Authentication
SOT lists this. Would improve UX significantly for returning users.

### P3-06: Video Call — No Join Button on Upcoming Appointments
The `AppointmentsScreen` has a "Join Video" button but it only appears for appointments that already have a `videoUrl`. There's no mechanism to fetch the video URL from Healthie when the appointment starts — it relies on the URL being present in the appointment data at load time.

### P3-07: Real Branding Assets Still Placeholder
SOT notes "Real branding icons (still using placeholder)". The app uses default Expo icons.

### P3-08: Healthie Package -> Tier Assignment Webhook Missing
SOT notes this is needed. Currently tier assignment is manual. When a patient purchases a Healthie package (Heal/Optimize/Thrive), there should be a webhook that auto-assigns their peptide pricing tier.

### P3-09: iPad/Mobile Sync Script Verification
Per memory `feedback_ipad_mobile_sync.md`, public/ipad/ and public/mobile/ are separate copies. After any iPad API changes, `sync-mobile.sh` must run.

---

## 6. DEPENDENCY CHAIN

```
P0-01 (WC keys) ─── standalone, no dependencies
    |
    └── Requires: Lambda deploy after code change

P0-02 (pending-consent auth) ─── depends on Lambda update
    |
    ├── Must fix ConsentFormScreen.tsx FIRST (P2-06)
    │   to route through Lambda before adding auth
    |
    └── Then add x-jarvis-secret to pending-consent endpoint

P1-01 (Cart flow) ─── standalone
    └── Simple navigation fix

P1-02 (BookingScreen dates) ─── standalone
    └── Simple import fix

P2-01 (Dashboard peptide action) ─── standalone
P2-02 (Cart badge) ─── standalone
P2-03 (Peptide matching) ─── standalone, extract shared utility
P2-04 (Remove opentok) ─── standalone
P2-05 (Nav duplicates) ─── standalone but needs testing
P2-07 (CDK sync) ─── standalone, infra only
```

---

## 7. FIX EXECUTION ORDER

### Phase 1: Security (Do First)
1. **P0-02 + P2-06**: Add auth to pending-consent + route ConsentFormScreen through Lambda
2. **P0-01**: Proxy WooCommerce through Lambda, remove hardcoded keys

### Phase 2: Broken Flows
3. **P1-01**: Fix Cart -> Consent -> Cart navigation flow
4. **P1-02**: Fix BookingScreen timezone bug

### Phase 3: Quality
5. **P2-01**: Add Peptide Shop to Dashboard quick actions
6. **P2-02**: Add cart badge indicator
7. **P2-03**: Extract shared peptide matching utility
8. **P2-04**: Remove unused opentok-react-native dependency
9. **P2-05**: Fix duplicate navigation screen names

### Phase 4: Polish (If Time Permits)
10. **P2-07**: Update CDK stack to match live config
11. **P2-08**: Implement unread message count
12. **P3-01+**: Remaining P3 features

---

## SAFETY NOTES

- **No file deletions** — only edits and new files
- **No dashboard changes** outside `api/headless/`, `api/ipad/`, `api/jarvis/`
- **No database modifications** without documenting
- **Git commit after each fix** for easy rollback
- **Build check** (`npx next build`) after any dashboard API changes
- **Mobile app changes** don't require build — they're in the Expo dev workflow

---

*Generated by AntiGravity (Claude Code) — April 9, 2026 overnight session*
