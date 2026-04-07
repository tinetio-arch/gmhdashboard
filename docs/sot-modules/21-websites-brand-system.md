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

