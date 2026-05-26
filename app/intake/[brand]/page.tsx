import { headers } from 'next/headers';
import { query } from '@/lib/db';
import IntakeHub from './IntakeHub';

/**
 * Brand intake hub — the single URL we put in patient comms.
 *
 *   /ops/intake/abxtac
 *
 * On iOS/Android: render a "Open in app / Get the app" hero (the app is the
 * primary surface; this page is the bridge until adoption is solid).
 *
 * On desktop / "continue in browser": render an in-page wizard that walks the
 * patient through every active brand form one at a time, posting each to
 * /api/intake/[brand]/[slug]. The existing single-form route still works for
 * direct deep links (e.g. resending a specific form).
 */

// Fixed wizard order per brand. Per-brand because each brand has its own
// required intake set. Source-of-truth lives here; matches the order in
// docs/INTAKE_MIGRATION_PLAYBOOK.md and scripts/wire-abxtac-intake.ts.
const BRAND_ORDER: Record<string, string[]> = {
    abxtac: [
        'hipaa-agreement',
        'consent-to-treat',
        'telehealth-consent',
        'ai-scribe-consent',
        'financial-agreement',
        'patient-intake',
        'peptide-consent',
    ],
};

// Mobile deep-link target. The native app should register this URL scheme
// (iOS Info.plist `CFBundleURLSchemes`, Android `intent-filter` with
// `nowoptimal` host). Until it does, the deep-link attempt silently fails
// and the "Get the app" CTA stays visible — no broken state.
const APP_DEEP_LINK_BASE = 'nowoptimal://intake/';

interface FormSummary {
    slug: string;
    name: string;
    description: string | null;
    field_count: number;
}

async function loadBrandForms(brand: string): Promise<FormSummary[]> {
    const slugs = BRAND_ORDER[brand];
    if (!slugs) return [];
    const rows = await query<FormSummary>(
        `SELECT d.slug, d.name, d.description,
                (SELECT count(*)::int FROM form_fields f WHERE f.form_def_id = d.form_def_id) AS field_count
           FROM form_definitions d
          WHERE d.brand_key = $1 AND d.is_active = true AND d.slug = ANY($2::text[])`,
        [brand, slugs]
    );
    // Re-order to match BRAND_ORDER (the SQL doesn't guarantee order).
    return slugs.map((s) => rows.find((r) => r.slug === s)).filter((r): r is FormSummary => !!r);
}

export default async function IntakeBrandHubPage({ params }: { params: Promise<{ brand: string }> }) {
    const { brand } = await params;

    const headersList = await headers();
    const ua = headersList.get('user-agent') || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua) && !/Tablet|Foldable/.test(ua);
    const isMobile = isIOS || isAndroid;

    const forms = await loadBrandForms(brand);
    if (forms.length === 0) {
        return (
            <main className="mx-auto max-w-2xl p-8 text-center text-gray-700">
                <h1 className="mb-2 text-2xl font-semibold">Intake not available</h1>
                <p className="text-gray-500">This intake set isn&apos;t configured. If you reached this page from a link, please reply to the email and we&apos;ll sort it.</p>
            </main>
        );
    }

    return (
        <IntakeHub
            brand={brand}
            forms={forms}
            platform={{ isIOS, isAndroid, isMobile }}
            appDeepLink={`${APP_DEEP_LINK_BASE}${brand}`}
        />
    );
}
