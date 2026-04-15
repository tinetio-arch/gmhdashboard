| Fix | File | Description |
|-----|------|-------------|
| **Allergy Healthie Sync** | `app/api/ipad/patient-data/route.ts` | Allergies now sync to Healthie via `createAllergySensitivity` mutation (was local-only). Categories: allergy, intolerance, sensitivity, preference. |
| **SQL Injection Fix** | `lambda-data-pipe-python/lambda_function.py` | Replaced f-string SQL with parameterized queries |
| **Token Validation** | `lambda-booking/src/validate-token.js`, `lambda-ask-ai/src/validate-token.js` | Validates Bearer token via Healthie `currentUser` query. 5-min cache. |
| **Auth Fail-Closed** | `lambda-auth-node/src/index.js` | Access-check failure now blocks login (was fail-open) |
| **Lab-Status Auth** | `app/api/headless/lab-status/route.ts` | Added x-jarvis-secret requirement |
| **Consent Hard Gate** | `mobile-app/src/screens/CartScreen.tsx` | Consent form MUST be signed before peptide checkout |
| **Forgot Password** | `mobile-app/src/screens/ForgotPasswordScreen.tsx` | Custom password reset UI (generates password via updateClient, no Healthie email) |
| **HealthKit Description** | `mobile-app/app.json` | Added NSHealthShareUsageDescription + NSHealthUpdateUsageDescription |
| **CORS Restriction** | `infra/lib/headless-app-stack.js` | Changed ALL_ORIGINS to specific allowed domains |
| **DB Migration** | `patient_allergies` table | Added `healthie_allergy_id` column |
| **Token Refresh (401)** | `mobile-app/src/api.ts`, `AuthContext.tsx` | apiCall auto-detects 401/403 and triggers session expiry → force logout |
| **Form Validation** | `mobile-app/src/screens/EditProfileScreen.tsx` | Email regex, phone auto-format (xxx) xxx-xxxx, DOB auto-format + past validation, state 2-char, ZIP 5-digit |
| **Chat Image Removed** | `mobile-app/src/screens/ChatRoomScreen.tsx` | Removed camera button that was sending text placeholders instead of images |
| **Rate Limiting** | `infra/lib/headless-app-stack.js` | Added API Gateway throttling: burst=50, rate=25 req/sec |
| **Form Date Auto-Format** | `mobile-app/src/components/NativeFormRenderer.tsx` | Date fields now auto-format as MM/DD/YYYY with number-pad keyboard |
| **Stripe Key Env Var** | `AddCardScreen.tsx`, `add-card.html` | Stripe publishable keys now configurable via env var / URL param |
| **Theme Color Cleanup** | 7 React Native screens | Replaced ~30 hardcoded `#10B981`/`#22c55e` with `theme.colors.success` |
| **Schedule Error Toast** | `public/ipad/app.js` | Shows "Schedule failed to load" warning when schedule fetch fails but other data loads |
| **Orphaned CSS Removed** | `public/mobile/style.css` | Deleted unused 113KB file (index.html references versioned style.3c56a1c1.css) |
| **PII Minimization** | `lambda-ask-ai/src/gemini.js`, `index.js` | Stripped EMAIL, PHONE from Gemini context; uses first name only instead of full name |
| **Webhook Signatures** | `lambda-data-pipe-python/lambda_function.py` | Added HMAC-SHA256 signature verification (requires HEALTHIE_WEBHOOK_SECRET env var) |
| **Debug Page Restricted** | `public/ipad/debug.html` | Admin-only access check — non-admin users see "Admin access required" |
| **Demographics Fix (CRITICAL)** | `app/api/ipad/patient/[id]/demographics/route.ts` | Removed `height`, `weight`, `preferred_name` from Healthie updateClient mutation — these invalid fields caused entire mutation to fail silently. Demographics now sync to Healthie correctly. |
| **Tier Discount Alignment** | `PeptideEducationScreen.tsx` | Fixed reversed discounts: heal=40%, optimize=30%, thrive=20% (was inverted) |
| **Primary Care Tier Access** | `app/api/jarvis/peptide-eligibility/route.ts` | Primary Care patients now get default Heal tier (was Men's Health only) |
| **Cart Dose Extraction** | `PeptideEducationScreen.tsx` | Cart items now show dose extracted from product name (was always empty) |
| **PII Minimization** | `lambda-ask-ai/src/gemini.js`, `index.js` | Stripped EMAIL, PHONE from Gemini context |

### Healthie API Gotchas (CRITICAL)

> **`client_id` vs `user_id`**: Healthie uses DIFFERENT argument names for the same patient ID. Using the wrong one **silently returns empty arrays**:
> - `entries()`, `documents()`, `conversationMemberships()` → `client_id`
> - `appointments()`, `requestedFormCompletions()` → `user_id`
> - `user()` → `id`

> **Date Format**: Healthie returns `"2026-01-30 12:15:00 -0700"` — does NOT work with `new Date()`. Convert to ISO: `${parts[0]}T${parts[1]}${parts[2]}`

> **GraphQL type quirk**: `$client_id: String` (NOT `ID`) for entries/metrics queries

> **createFormAnswerGroup**: Must include `finished: true` or submission stays as draft

> **createEntry** (journal): Uses `poster_id` (NOT `user_id`) in input

> **Slot availability**: Do NOT pass `location_id` to `availableSlotsForRange` — causes field error

> [!CAUTION]
> **`createAppointment` dual-provider bug (Fixed March 26, 2026)**:
> Healthie **auto-adds the API key owner as a provider** on every appointment created via API. If the API key belongs to Provider A and you create an appointment for Provider B using `providers: providerBId`, the appointment gets BOTH providers.
>
> **FIX**: Always use BOTH `other_party_id` AND `providers` in createAppointment:
> ```javascript
> input: {
>   user_id: patientId,           // The patient
>   other_party_id: providerId,   // Explicit single provider (from patient's perspective)
>   providers: providerId,        // Override to prevent API key owner auto-add
>   appointment_type_id: typeId,
>   // ... other fields
> }
> ```
> **Files fixed**: `lambda-booking/src/healthie.js`, `nowmenshealth-website/lib/healthie-booking.ts`
> **Files to check**: Any code that calls `createAppointment` mutation — verify it uses `other_party_id`.

### CDK vs. Live Infrastructure

| Lambda | CDK Timeout | Live Override |
|--------|------------|--------------|
| Auth | 10s | — |
| Booking | 15s | **30s / 256MB** |
| Data Pipe | 30s | — |
| Ask AI | 60s | — |

> ⚠️ Running `cdk deploy` will revert booking Lambda to 15s/128MB. Update CDK stack first.

### Known Issues

1. **Healthie sync can fail silently** — `healthie_synced` may be `false` while `access_status` shows `revoked`. Verify via Healthie API directly.
2. **Multiple Healthie IDs per patient** — 2 patients have duplicate active Healthie client mappings. Revoking one doesn't block the others.
3. **CDK stack out of sync** with live Lambda configuration (see table above).

### Journal & Metrics Formatting (Feb 26, 2026)

Healthie `entries` API returns raw `metric_stat` as a single number with no units or formatting. The app now applies smart formatting based on `category`:

| Category | Raw Value | Formatted Display |
|----------|-----------|------------------|
| Blood Pressure | `13686` | `136/86 mmHg` (split by digit count) |
| Weight | `190` | `190 lbs (86.2 kg)` |
| Height (in.) | `70` | `5'10" (177.8 cm)` |
| Sleep | `8.5` | `8.5 hours` |
| Steps | `10432` | `10,432 steps` |
| Heart Rate | `72` | `72 bpm` |

Formatting functions: `formatBloodPressure()`, `formatWeight()`, `formatHeight()`, `formatMetricValue()`, `safeParseDate()`

> **Height gotcha**: If Healthie returns a value ≤ 7, the formatter assumes it's in feet (not inches) and multiplies by 12. Values > 12 are treated as inches.

---

## 🌐 NOW Optimal Websites & Brand System

**Monorepo**: `/var/www/nowoptimal-websites/` (Git-managed)  
**Standalone NowPrimary**: `/home/ec2-user/nowprimarycare-website/`  
**Brand Data**: `/home/ec2-user/.tmp/brand-reports/` (JSON palette extractions)  
**All sites**: Next.js + Tailwind CSS, served via Nginx reverse proxy

### Website Portfolio

| Site | Domain | Port | PM2 Name | Stack |
|------|--------|------|----------|-------|
| NOW Optimal (Hub) | nowoptimal.com | 3000 | `nowoptimal` | Next.js |
| NOW Primary Care | nowprimary.care | 3001 | `nowprimary` | Next.js |
| NOW Men's Health | nowmenshealth.care | 3002 | `nowmenshealth` | Next.js |
| NOW Mental Health | nowmentalhealth.care | 3003 | `nowmentalhealth` | Next.js |
| ABX TAC | abxtac.com | 3009 | `abxtac-website` | Next.js (headless WooCommerce) |

**Ecosystem Config**: `/var/www/nowoptimal-websites/ecosystem.config.js`  
**Deploy Script**: `/var/www/nowoptimal-websites/deploy.sh`

> [!WARNING]
> There is a **standalone NowPrimary.Care** at `/home/ec2-user/nowprimarycare-website/` — this is the version with Healthie booking integration (8 appointment types, BookingWidget). The one in `/var/www/nowoptimal-websites/nowprimary-website/` is the older static version. Be careful which one you're editing.

### Brand Color System (Extracted from Live Sites)

#### NOW Optimal Network (Hub)
| Role | Hex | CSS Variable | Description |
|------|-----|-------------|-------------|
| Primary | `#0C141D` | — | Dark navy background |
| Secondary | `#00D4FF` | `--brand-cyan` | Cyan accent |
| Surface | `#111827` | `--brand-surface` | Card/surface background |
| Card | `#1F2937` | `--brand-card` | Elevated card background |
| Purple | `#7C3AED` | `--brand-purple` | Feature accent |
| Navy | `#0A0E1A` | `--brand-navy` | Deep dark background |

#### NOW Men's Health
| Role | Hex | CSS Variable | Description |
|------|-----|-------------|-------------|
| Primary | `#0A1118` | — | Dark background |
| Brand Red | `#DC2626` | `--brand-red` | Primary action/accent |
| Red Dark | `#B91C1C` | `--brand-red-dark` | Hover states |
| Red Light | `#EF4444` | `--brand-red-light` | Highlights |
| Gray | `#1A1A1A` | `--brand-gray` | Surface |
| Black | `#000000` | `--brand-black` | Deep background |
| White | `#FFFFFF` | `--brand-white` | Text/contrast |

#### NOW Primary Care
| Role | Hex | CSS Variable | Description |
|------|-----|-------------|-------------|
| Primary | `#060F6A` | — | Deep navy blue (logo) |
| Green | `#00A550` | `--tw-gradient-from` | CTA gradient start |
| Light Blue | `#E8F0F5` | — | Background / light surface |
| Cyan | `#25C6CA` | — | Accent (from NOWOptimal logo) |

#### ABX TAC (Peptide E-Commerce)
| Role | Hex | CSS Variable | Description |
|------|-----|-------------|-------------|
| Primary BG | `#050505` | `--bg-primary` | Deep black background |
| Secondary BG | `#0A0A0A` | `--bg-secondary` | Card/section background |
| Green | `#3A7D32` | `--green-primary` | Primary accent, tactical green |
| Green Dark | `#2D5A27` | `--green-dark` | Dosage bands, buttons |
| Green Light | `#4CAF50` | `--green-light` | Highlights, badges |
| Card BG | `#111111` | `--bg-card` | Elevated card surfaces |
| Text White | `#FFFFFF` | — | Primary text |
| Text Gray | `#D0D0D0` | — | Body text, descriptions |
| Text Muted | `#999999` | — | Secondary text |
| Fonts | Rajdhani (tactical) · Share Tech Mono (mono) · Inter (body) |

#### Mobile App Chameleon Themes (from `themes.ts`)

| Group ID | Brand | Primary | Background |
|----------|-------|---------|------------|
| `75522` | Men's Health | Red `#DC2626` | Black `#0A1118` |
| `75523` | Primary Care | Navy `#1E3A5F` | Light `#F8FAFC` |

### Website Directory Structure

```
/var/www/nowoptimal-websites/
├── nowoptimal-website/     → Hub site (nowoptimal.com)
│   └── app/                → page.tsx, layout.tsx, privacy/, terms/
├── nowprimary-website/     → Static version (in monorepo)
│   └── app/                → page.tsx + services/ + api/
├── nowmenshealth-website/  → Men's Health site
│   └── app/                → page.tsx, layout.tsx, privacy/, terms/
├── nowmentalhealth-website/ → Mental Health site
│   └── app/                → page.tsx, layout.tsx, privacy/, terms/
├── ecosystem.config.js     → PM2 config (ports 3000-3003)
├── deploy.sh               → Build + restart all sites
└── scripts/                → Shared utilities

/home/ec2-user/nowprimarycare-website/  → LIVE booking version
├── app/
│   ├── api/healthie/       → Booking API (slots + book)
│   ├── book/               → Booking page
│   ├── about/, contact/, services/
│   └── page.tsx            → Homepage
├── components/
│   ├── BookingWidget.tsx    → Healthie slot picker + booking
│   ├── HeroSection.tsx, FeaturesSection.tsx
│   ├── ProviderSection.tsx, LocationSection.tsx
│   ├── Header.tsx, Footer.tsx, CTASection.tsx
│   └── booking/            → Additional booking components
├── lib/
│   └── healthie-booking.ts → Healthie GraphQL client
└── .env.local              → API keys (HEALTHIE_API_KEY, etc.)

/home/ec2-user/abxtac-website/         → ABX TAC peptide store [NEW Mar 2026]
├── app/                               → Headless Next.js 14 (TypeScript + Tailwind)
│   ├── page.tsx                       → Homepage (hero, peptide explainer, stacks)
│   ├── shop/                          → 10 curated peptide stacks + à la carte
│   ├── peptides/                      → Peptide therapy info, FAQ
│   ├── about/                         → About, NOW Network links
│   └── globals.css                    → Dark tactical theme
├── components/                        → Header (wellness banner), Footer
├── lib/woocommerce.ts                 → WooCommerce REST API client
├── public/abxtac-logo-white.png       → Brand logo
├── .env.local                         → WooCommerce API keys (TBD)
└── Port: 3009                         → Nginx split: /* → Next.js, /wp-* → WordPress
```

### NowPrimary.Care Healthie Booking Integration

**Provider**: Phil Schafer, NP (`12088269`)  
**Location ID**: `27565` (404 S. Montezuma, Prescott, AZ 86303)  
**Phone**: (928) 756-0070

| Appointment Type | Healthie ID | Duration | Price |
|-----------------|-------------|----------|-------|
| Sick Visit In-Person | `504715` | 30m | Custom |
| Sick Visit Telehealth | `505646` | 30m | Custom |
| Sports Physical | `504718` | 30m | $50 |
| TB Test | `504741` | 15m | $35 |
| Wound Care | `504716` | 30m | Custom |
| Weight Loss Consult | `504717` | 45m | Custom |
| Allergy Injection | `505648` | 15m | $25 |
| IV Therapy GFE | `505647` | 60m | Custom |

**Booking API Flow**:
```
BookingWidget → /api/healthie/slots (GET) → lib/healthie-booking.ts
  → Healthie GraphQL: availableSlotsForRange(provider_id, appt_type_id)
BookingWidget → /api/healthie/book (POST) → createClient + createAppointment
```

> [!IMPORTANT]
> Do NOT pass `appointment_location_id` to `availableSlotsForRange` — it causes a field error. Only pass `provider_id` and `appointment_type_id`.

> [!WARNING]
> **Appointment Type Pricing CLEARED (March 31, 2026)**
> All 22 appointment types that had pricing values ($50–$450) were cleared to prevent Healthie from auto-generating invoices when patients are booked. This was discovered after patient Jacob McKenney was auto-charged $180 on top of his $140/month subscription when booked into "Male HRT Follow-Up - Telehealth".
>
> **Root cause**: Healthie's `pricing` field on appointment types triggers automatic `requested_payment` creation (invoice_type: "appointment") when a patient is booked. This is native Healthie behavior — not controlled by our code.
>
> **Rule**: Do NOT set pricing on appointment types unless you intentionally want Healthie to auto-invoice patients at booking. Subscription billing should be handled through offerings/packages, not appointment type pricing.

### Website Redesign — March 26, 2026 (Editorial Style)

> **Scope**: NowMentalHealth.Care, NowPrimary.Care, NowOptimal.com all redesigned to match an editorial, photography-driven style inspired by Recovery in the Pines. Consistent brand identity across all 3 sites.

**Design System (shared across all 3 sites):**
- **Fonts**: Playfair Display (serif, headings) + Inter (sans, body) via `next/font/google`
- **Layout**: Full-bleed hero images with overlays, journey/path sections, service cards with photos, dark testimonial sections, side-by-side content with images, dark navy footers
- **Photography**: Unsplash images (free commercial use) stored in `public/images/`
- **Light Theme**: All sites use light cream/white backgrounds with dark text
- **Responsive**: Mobile-first, glass-morphism sticky headers, mobile hamburger menus

| Site | Background | Primary Accent | Button Dark | Footer | Status |
|------|-----------|---------------|------------|--------|--------|
