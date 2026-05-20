import { NextRequest, NextResponse } from 'next/server';
import {
    getActiveFormDefinition,
    validateSubmission,
    submitIntake,
    type IntakeSubmissionInput,
} from '@/lib/intakeForms';

/**
 * Public self-serve intake API (no staff auth) — the "Google-facing" web form
 * and the iPhone/iPad app both render and post to this contract.
 *
 *   GET  /ops/api/intake/[brand]/[slug]  -> form structure for rendering
 *   POST /ops/api/intake/[brand]/[slug]  -> capture + provision (our DB -> Healthie)
 *
 * Anti-abuse: if INTAKE_TOKEN is set, POST requires a matching `token` (query or
 * x-intake-token header). The brand embeds the token in the link it sends. When
 * unset, POST is open (dev only) — set INTAKE_TOKEN in prod. See the playbook.
 */

// Next.js 14 dynamic route params must be awaited.
type RouteContext = { params: Promise<{ brand: string; slug: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
    const { brand, slug } = await context.params;
    try {
        const def = await getActiveFormDefinition(brand, slug);
        if (!def) {
            return NextResponse.json({ error: 'Form not found' }, { status: 404 });
        }
        // Expose only what the client needs to render — never Healthie internal ids.
        return NextResponse.json({
            form: {
                brand_key: def.brand_key,
                slug: def.slug,
                name: def.name,
                description: def.description,
                version: def.version,
                fields: def.fields.map((f) => ({
                    field_key: f.field_key,
                    label: f.label,
                    mod_type: f.mod_type,
                    required: f.required,
                    options: f.options,
                    description: f.description,
                })),
            },
        });
    } catch (error) {
        console.error('[Intake] Failed to load form:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(request: NextRequest, context: RouteContext) {
    const { brand, slug } = await context.params;
    try {
        // Optional token gate (fail-closed only when configured).
        const requiredToken = process.env.INTAKE_TOKEN;
        if (requiredToken) {
            const provided =
                request.nextUrl.searchParams.get('token') ||
                request.headers.get('x-intake-token');
            if (provided !== requiredToken) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        const def = await getActiveFormDefinition(brand, slug);
        if (!def) {
            return NextResponse.json({ error: 'Form not found' }, { status: 404 });
        }

        const body = await request.json();
        const answers: Record<string, string> = body.answers || {};
        const applicantName: string = (body.applicant_name || '').trim();
        const applicantEmail: string | null = body.applicant_email?.trim() || null;
        const applicantPhone: string | null = body.applicant_phone?.trim() || null;

        if (!applicantName) {
            return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
        }
        if (!applicantEmail && !applicantPhone) {
            return NextResponse.json(
                { error: 'An email or phone number is required to set up your account.' },
                { status: 400 }
            );
        }

        const validationErrors = validateSubmission(def, answers);
        if (validationErrors.length > 0) {
            return NextResponse.json({ error: 'Please correct the form.', details: validationErrors }, { status: 400 });
        }

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const userAgent = request.headers.get('user-agent') || 'unknown';
        const source = (body.source === 'ios' || body.source === 'ipad') ? body.source : 'web';

        const input: IntakeSubmissionInput = {
            answers,
            applicantName,
            applicantEmail,
            applicantPhone,
            dateOfBirth: body.date_of_birth || null,
            address: body.address || null,
            signatureDataUrl: answers.signature || body.signature_data_url || null,
            source,
            ip,
            userAgent,
            dryRun: body.dry_run === true,
        };

        const result = await submitIntake(def, input);

        if (result.status === 'error') {
            return NextResponse.json(
                { success: false, error: result.error || 'Provisioning failed', submission_id: result.submissionId },
                { status: 502 }
            );
        }

        return NextResponse.json({
            success: true,
            submission_id: result.submissionId,
            status: result.status, // 'provisioned' | 'healthie_unmapped'
        });
    } catch (error) {
        console.error('[Intake] Submission failed:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
