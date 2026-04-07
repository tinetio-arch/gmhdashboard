## 🏢 Brand & Group Architecture (March 25, 2026 — Telehealth Restructure)

> [!IMPORTANT]
> **This section is the MASTER REFERENCE for how brands, groups, appointment types, and telehealth work together.**
> Previous group assignments treated services (Weight Loss, Pelleting) as groups. The new architecture treats BRANDS as groups and SERVICES as tags.

### Architecture Principle

| Layer | Controls | Examples |
|-------|----------|---------|
| **Groups** | Brand identity, default onboarding forms, mobile app theme | Men's Health, Primary Care, Mental Health, Longevity, ABX TAC |
| **Tags** | Service access, additional appointment types, cross-brand visibility | `pelleting`, `weight-loss`, `peptides`, `telehealth`, `iv-therapy` |
| **Requested Form Completions** | Service-specific forms sent per appointment | Pelleting consent, Weight Loss agreement (triggered by booking) |

**Key Rule**: A patient stays in their BRAND group. They get service-specific forms when they book service-specific appointments — NOT by moving between groups.

### Brand Registry (6 Brands)

| Brand | Domain | Healthie Group | Group ID | Primary Provider | Location | Mobile Theme |
|-------|--------|---------------|----------|-----------------|----------|-------------|
| **NOW Men's Health** | nowmenshealth.care | NowMensHealth.Care | `75522` | Dr. Aaron Whitten (12093125) | McCormick (13029260) | Red `#DC2626` |
| **NOW Primary Care** | nowprimary.care | NowPrimary.Care | `75523` | Phil Schafer NP (12088269) | Montezuma (13023235) | Navy `#060F6A` |
| **NOW Longevity** | nowlongevity.care | NowLongevity.Care | **TBD — CREATE** | Both providers | Both locations | Sage `#6B8F71` |
| **NOW Mental Health** | nowmentalhealth.care | NowMentalHealth.Care | **TBD — CREATE** | TBD (hire pending) | McCormick (13029260) | Purple `#7C3AED` |
| **ABX TAC** | abxtac.com | ABXTAC | **TBD — CREATE** | Dr. Whitten (12093125) | N/A (telehealth only) | Green `#3A7D32` |
| **NOW Optimal Wellness** | Mobile app only | NowOptimalWellness | `81103` | Dr. Whitten (12093125) | McCormick (13029260) | Cyan `#00D4FF` |

### Legacy Groups → Migration Plan (DO NOT EXECUTE WITHOUT APPROVAL)

These groups currently exist but should be converted to **tags** on patients in their brand groups:

| Legacy Group | ID | Patients | Migration Target | Tag to Apply |
|-------------|------|----------|-----------------|-------------|
| Weight Loss | 75976 | 6 | → NowLongevity.Care group | `weight-loss` tag |
| Female Pelleting | 75977 | 48 | → NowLongevity.Care group | `pelleting` tag |
| Male Pelleting | 78546 | 2 | → NowLongevity.Care group | `pelleting` tag |
| Sick Visit | 77894 | 11 | → NowPrimary.Care group | (already PC patients) |

> [!CAUTION]
> **DO NOT move patients between groups without explicit user approval.** Changing a patient's group in Healthie CLEARS their onboarding forms. Migration must be done carefully with form backup.

### Brand Color System

#### NOW Men's Health
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#DC2626` | Buttons, accents, mobile app |
| Dark | `#7F1D1D` | Nav, headers |
| Light | `#EF4444` | Hover states |
| Background | `#0A1118` | App dark theme |

#### NOW Primary Care
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#060F6A` | Buttons, nav, headers |
| Secondary | `#00A550` | Success states, accents |
| Accent | `#25C6CA` | CTAs, highlights |
| Background | `#F8FAFC` | App light theme |

#### NOW Longevity (Soft Sage / Earthy Calm)
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#6B8F71` | Buttons, accents, mobile app |
| Dark | `#4A6B50` | Nav, headers, status bar |
| Light | `#A3C4A8` | CTAs, highlights, hover |
| Background | `#1E2E20` | App dark theme |
| Text on dark | `#A3C4A8` | Headings on dark bg |
| Text on light | `#2D3B2E` | Text on light surfaces |

> **Theme Preview**: `/home/ec2-user/.tmp/longevity-theme-preview.html`

#### NOW Mental Health (Website updated March 26, 2026)
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#C2703E` | Buttons, accents, website terracotta |
| Dark | `#9A5530` | CTAs, gradients |
| Light | `#E8A87C` | Hover, highlights |
| Navy | `#2D3A4A` | Footer, quote sections, dark buttons |
| Background | `#FBF7F4` | Website light theme (editorial) |
| Mobile Primary | `#7C3AED` | Mobile app stays purple |

> **Website redesign**: Editorial style with Playfair Display serif headings, Unsplash photography, warm terracotta accents on light cream background. Footer uses dark navy `#2D3A4A`. All 11 visit types with real pricing. No Spravato.

#### ABX TAC
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#3A7D32` | Buttons, accents, mobile app |
| Dark | `#2D5A27` | Nav, headers |
| Light | `#4CAF50` | Hover, highlights |
| Background | `#050505` | App dark theme |

#### NOW Optimal Wellness (Hub)
| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#00D4FF` | Buttons, accents |
| Secondary | `#FFD700` | Gold accent |
| Background | `#0A0E1A` | App dark theme |

### Master Appointment Type Registry (Live in Healthie — 28 Types)

> **Queried from Healthie API on March 25, 2026.** These are the REAL IDs.

#### Video-Enabled Types (Telehealth already works)
| ID | Name | Duration | Price | Contact Types |
|----|------|----------|-------|--------------|
| `505645` | NMH General TRT Telemedicine | 30 min | — | Healthie Video Call |
| `505646` | Telemedicine Sick Consult | 30 min | $79 | Healthie Video Call |
| `504715` | In-Person Sick Visit | 50 min | $129 | Video Call + In Person |
| `504717` | Weight Loss Consult | 45 min | $99 | Video Call + In Person |

#### In-Person Only Types (24 Types)
| ID | Name | Duration | Price | Brand |
|----|------|----------|-------|-------|
| `504725` | Initial Male Hormone Replacement Consult | 30 min | — | Men's Health |
| `504726` | Initial Female Hormone Replacement Therapy Consult | 30 min | — | Primary Care |
| `504727` | EvexiPel Initial Pelleting Male | 60 min | — | Longevity |
| `504728` | EvexiPel Repeat Pelleting Male | 45 min | — | Longevity |
| `504730` | EvexiPel Initial Pelleting Female | 60 min | — | Longevity |
| `504729` | EvexiPel Repeat Pelleting Female | 45 min | — | Longevity |
| `504731` | Weight Loss Education & Measurements | 45 min | — | Longevity |
| `504732` | 5 Week Lab Draw | 15 min | — | Men's Health |
| `504734` | 90 Day Lab Draw | 20 min | — | Men's Health |
| `504735` | NMH TRT Supply Refill | 20 min | — | Men's Health |
| `504736` | NMH Peptide Education & Pickup | 20 min | — | Men's Health |
| `504716` | Skin Laceration & Wound Care | 60 min | — | Primary Care |
| `504718` | Sports Physical | 45 min | — | Primary Care |
| `504719` | Medical Clearance Physical | 45 min | — | Primary Care |
| `504741` | TB Test Administration | 15 min | — | Primary Care |
| `504743` | Initial Primary Care Consult | 60 min | — | Primary Care |
| `505647` | IV Therapy Good Faith Exam | 15 min | $50 | Longevity |
| `505648` | Allergy Injection Consult | 20 min | $55 | Primary Care |
| `505649` | Injection | 25 min | — | Primary Care |
| `504759` | Elite Membership Initial PC Consult | 30 min | $250 | Primary Care |
| `504760` | Premier Membership Initial PC Consult | 30 min | $250 | Primary Care |
| `511049` | NMH Mens Health Annual Lab Draw | 15 min | — | Men's Health |
| `511050` | NowPrimary.Care Annual Lab Draw | 15 min | — | Primary Care |
| `511073` | Migrated Appointment | 15 min | — | System (hidden) |
| `520702` | Male HRT Follow-Up | 30 min | — | Men's Health |
| `520703` | PC Follow-Up | 30 min | — | Primary Care |

### Telehealth Appointment Types — TO CREATE

> [!CAUTION]
> **These types do NOT exist yet.** They need to be created in Healthie via `createAppointmentType` mutation. DO NOT create without user approval.

#### Men's Health Telehealth (New)
| Name | Duration | Price | Contact Type |
|------|----------|-------|-------------|
| Initial Male HRT Consult - Telehealth | 30 min | Free | Healthie Video Call |
| Male HRT Consult - Telehealth | 30 min | $180 | Healthie Video Call |
| Lab Review Telemedicine | 30 min | Included | Healthie Video Call |
| Annual Lab Review Telemedicine | 30 min | Included | Healthie Video Call |
| 90-Day Lab Review Telemedicine | 30 min | Included | Healthie Video Call |

#### Primary Care Telehealth (New)
| Name | Duration | Price | Contact Type |
|------|----------|-------|-------------|
| Initial PC Consult - Telehealth | 45 min | $150 | Healthie Video Call |
| PC Follow-Up - Telehealth | 30 min | $99 | Healthie Video Call |
| Elite Membership Consult - Telehealth | 30 min | $250 | Healthie Video Call |
| Premier Membership Consult - Telehealth | 30 min | $250 | Healthie Video Call |
| Female HRT Consult - Telehealth | 30 min | $250 | Healthie Video Call |
| Medication Management - Telehealth | 20 min | $75 | Healthie Video Call |

#### Longevity Telehealth (New)
| Name | Duration | Price | Contact Type |
|------|----------|-------|-------------|
| Longevity Consultation | 45 min | $199 | Video Call + In Person |
| Longevity Follow-Up - Telehealth | 30 min | $99 | Healthie Video Call |
| Peptide Therapy Consult - Telehealth | 30 min | $99 | Healthie Video Call |
| Weight Loss Follow-Up - Telehealth | 20 min | $75 | Healthie Video Call |

#### Mental Health (All New — In-Person + Telehealth)
| Name | Duration | Price | Contact Type |
|------|----------|-------|-------------|
| Initial Mental Health Consultation | 60 min | Free | Video Call + In Person |
| Individual Therapy Session | 50 min | $150 | Video Call + In Person |
| Medication Management (Psychiatric) | 30 min | $99 | Video Call + In Person |
| Psychiatric Follow-Up - Telehealth | 20 min | $75 | Healthie Video Call |
| Ketamine Therapy Consultation | 45 min | Free | In Person only |
| Ketamine IV Infusion | 90 min | $450 | In Person only |
| Group Therapy Screening | 30 min | Free | In Person only |
| Group Therapy Session | 60 min | $75 | In Person only |
| Crisis Assessment - Telehealth | 30 min | Free | Healthie Video Call |

#### ABX TAC (New)
| Name | Duration | Price | Contact Type |
|------|----------|-------|-------------|
| ABX TAC Peptide Consultation - Telehealth | 25 min | Free | Healthie Video Call |

### Telehealth Video Architecture

**Technology**: Healthie Native Video (OpenTok / Vonage WebRTC)
**Cost**: $0 (included in Healthie Enterprise plan)

**How it works (fully headless — no Healthie portal required):**

1. Appointment created with `contact_type = "Healthie Video Call"`
2. Healthie generates an OpenTok video session for that appointment
3. Query appointment via GraphQL to get:
   - `session_id` — OpenTok session identifier
   - `generated_token` — One-time auth token
4. Initialize video with **Vonage API Key: `45624682`** (Healthie's public key)
5. Both patient (mobile app) and provider (iPad) connect to same session
6. Audio can be captured from MediaStream for Scribe (Phase 2)

**Patient app (iPhone/Android):**
- `opentok-react-native` or `@vonage/client-sdk-video` package
- New `VideoCallScreen.tsx` — fully native, NOW Optimal branded
- "Join Video Call" button on `AppointmentsScreen.tsx` (active 15 min before)
- Requires custom Expo dev client (not Expo Go) for native camera/mic

**Provider app (iPad):**
- Vonage Web SDK (`@vonage/client-sdk-video` for browser)
- "Start Video Call" button on schedule tab for telehealth appointments
- Opens in modal overlay within iPad app
- Scribe runs on iPad mic simultaneously (Phase 1)

**Lambda changes:**
- New action: `get_video_session` — queries `session_id` + `generated_token` from appointment
- Returns: `{ sessionId, token, apiKey: "45624682" }`
- Security gate: only works within 15 min of appointment start time

### Form Architecture (Groups + Services)

| Form Type | Trigger | Scope |
|-----------|---------|-------|
| **Onboarding Flow** (group-level) | Auto-sent when patient joins group | HIPAA, Consent, AI Disclosure, brand-specific medical history |
| **Requested Form Completion** | Sent when specific appointment booked | Pelleting consent, Weight Loss agreement, Mental Health screening |
| **Appointment-linked forms** | Auto-attached to appointment type | Pre-visit questionnaire, follow-up survey |

**Onboarding Flows by Brand:**
| Brand | Flow Contents |
|-------|--------------|
| Men's Health | HIPAA + Consent + AI Disclosure + Men's Health History + HRT Intake |
| Primary Care | HIPAA + Consent + AI Disclosure + Medical History |
| Longevity | HIPAA + Consent + AI Disclosure + Wellness Questionnaire |
| Mental Health | HIPAA + Consent + AI Disclosure + PHQ-9 + GAD-7 + Mental Health Screening |
| ABX TAC | HIPAA + Consent + AI Disclosure + Peptide Health Screening |

**Service-Specific Forms (triggered by appointment booking):**
| Service | Form | Trigger |
|---------|------|---------|
| EvexiPel Pelleting | Pelleting Consent Form | Books EvexiPel appointment |
| Weight Loss | Weight Loss Program Agreement | Books Weight Loss Consult |
| Ketamine | Ketamine Informed Consent | Books Ketamine Consultation |
| IV Therapy | IV Therapy Consent | Books IV Therapy GFE |

### Tag → Appointment Type Mapping

| Tag | Unlocks Appointment Types | Cross-Brand? |
|-----|--------------------------|-------------|
| `pelleting` | EvexiPel Male/Female Initial + Repeat | Yes — MH patients can book pellets |
| `weight-loss` | Weight Loss Consult, WL Education, WL Follow-Up Tele | Yes |
| `peptides` | Peptide Education & Pickup, Peptide Therapy Consult Tele | Yes |
| `iv-therapy` | IV Therapy Good Faith Exam | Yes |
| `telehealth` | (Deprecated — all groups get telehealth types natively) | N/A |

### Provider Telehealth Capability

| Provider | Healthie ID | Telehealth? | Brands |
|----------|------------|------------|--------|
| Dr. Aaron Whitten, NMD | 12093125 | Yes | Men's Health, Longevity, Wellness, ABX TAC |
| Phil Schafer, FNP-C | 12088269 | Yes | Primary Care, Longevity |
| Mental Health Provider (TBD) | TBD | Yes | Mental Health |

### Arizona-First Telehealth

Initial telehealth launch is **Arizona patients only**. Multi-state expansion requires:
- Provider licensure in patient's state (NLC for Phil, IMLC for Dr. Whitten)
- DEA registration in patient's state for controlled substances (testosterone = Schedule III)
- State validation in booking flow (future feature)

---

