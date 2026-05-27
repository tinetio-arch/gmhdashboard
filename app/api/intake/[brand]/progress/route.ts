import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /ops/api/intake/[brand]/progress
 *
 * Returns the list of form slugs the applicant has ALREADY successfully
 * submitted for this brand, so the wizard can skip ahead instead of making
 * them restart. POST (not GET) so emails don't leak into nginx access logs
 * or browser history. Token-gated like the submit endpoint.
 *
 * Lookup is intentionally narrow:
 *   - by patient_id when we can find one via lowercase-email match (cheap +
 *     covers the linking case the rest of the intake flow already uses)
 *   - by lowercased `applicant_email` directly against `intake_submissions`
 *     as a fallback for submissions made before a patient_id was attached
 *     (early provisioning failures, dry-runs, etc.).
 *
 * Per SOT module 25, email alone is NOT enough to declare two records the
 * same patient (parent/minor shared-email pattern). This endpoint deliberately
 * does NOT mutate patient data — it just reads completion progress and is
 * safe to be permissive on lookup keys.
 *
 * Body: { applicant_email?: string, applicant_phone?: string }
 * Returns: { completed: ["hipaa-agreement", ...] }  (always returns 200 even if no match)
 */

const COMPLETE_STATUSES = ['provisioned', 'healthie_unmapped', 'local_only'];

type RouteContext = { params: Promise<{ brand: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
    const { brand } = await context.params;
    try {
        // Token gate — same as the submit endpoint.
        const requiredToken = process.env.INTAKE_TOKEN;
        if (requiredToken) {
            const provided =
                request.nextUrl.searchParams.get('token') ||
                request.headers.get('x-intake-token');
            if (provided !== requiredToken) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        const body = await request.json().catch(() => ({}));
        const email: string | null = (body.applicant_email || '').trim().toLowerCase() || null;
        const phone: string | null = (body.applicant_phone || '').trim() || null;

        if (!email && !phone) {
            // Always return shape, never leak presence — empty progress for empty input.
            return NextResponse.json({ completed: [] });
        }

        // Pull all completed slugs for this brand whose submission either:
        //   (a) links to a patient row whose lowercased email matches, OR
        //   (b) has a matching applicant_email (case-insensitive), OR
        //   (c) has a matching applicant_phone (exact).
        // Status must be one of the "complete" states (excludes error / provisioning / dry_run).
        const rows = await query<{ slug: string }>(
            `SELECT DISTINCT d.slug
               FROM intake_submissions s
               JOIN form_definitions d ON d.form_def_id = s.form_def_id
               LEFT JOIN patients p ON p.patient_id = s.patient_id
              WHERE d.brand_key = $1
                AND d.is_active = true
                AND s.status = ANY($2::text[])
                AND (
                       ($3::text IS NOT NULL AND lower(s.applicant_email) = $3)
                    OR ($3::text IS NOT NULL AND lower(p.email)            = $3)
                    OR ($4::text IS NOT NULL AND s.applicant_phone         = $4)
                    OR ($4::text IS NOT NULL AND p.phone_primary           = $4)
                )`,
            [brand, COMPLETE_STATUSES, email, phone]
        );

        return NextResponse.json({ completed: rows.map((r) => r.slug) });
    } catch (error) {
        console.error('[Intake] progress lookup failed:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
