| NowMentalHealth.Care | `#FBF7F4` cream | `#C2703E` terracotta | `#2D3A4A` navy | `#2D3A4A` navy | ✅ Live |
| NowPrimary.Care | `#F8FAFC` slate | `#00A550` green | `#060F6A` navy | `#060F6A` navy | ✅ Live |
| NowOptimal.com | `#F8FAFC` slate | `#0891B2` teal | `#0A0E1A` navy | `#0A0E1A` navy | ✅ Live |

**NowMentalHealth.Care** — `/home/ec2-user/nowmentalhealth-website/`
- Port: 3003, PM2: `nowmentalhealth-website`
- 11 visit types (no Spravato), real pricing in BookingWidget
- Terracotta warm color scheme, emotional photography
- Services: Initial Consult (Free), Therapy ($150), Medication Management ($99), Ketamine Consult (Free), Ketamine IV ($450), Group Screening (Free), Group Session ($75), Psychiatric Follow-Up Telehealth ($75)

**NowPrimary.Care** — `/home/ec2-user/nowprimarycare-website/`
- Port: 3008, PM2: `nowprimary-website`
- Navy/green color scheme, Healthie booking integration preserved
- Full editorial redesign with photos, journey section, service spotlights

**NowOptimal.com** — `/home/ec2-user/nowoptimal-website/`
- Port: 3007, PM2: `nowoptimal-website`
- Teal/gold accents on light background (was dark theme)
- Brand hub linking to all sub-brands with colored accent bars
- No booking — just brand navigation and network overview

**Files changed per site**: layout.tsx, globals.css, tailwind.config, page.tsx, Header.tsx, Footer.tsx, public/images/*

**PM2 Port Corrections** (actual live ports differ from old SOT):
| PM2 Name | Actual Port | Nginx Proxy |
|----------|-------------|-------------|
| nowmentalhealth-website | 3003 | nowmentalhealth.care |
| nowmenshealth-website | 3004 | nowmenshealth.care |
| nowoptimal-website | 3007 | nowoptimal.com |
| nowprimary-website | 3008 | nowprimary.care |
| abxtac-website | 3009 | abxtac.com |

---

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
