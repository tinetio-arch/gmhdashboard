import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

/**
 * GET /api/ipad/kiosk/form-structure?form_id=XXX
 * Fetches form field definitions from Healthie for native rendering in kiosk mode.
 */
export async function GET(request: NextRequest) {
    try {
        await requireApiUser(request, 'read');

        const { searchParams } = new URL(request.url);
        const formId = searchParams.get('form_id');

        if (!formId) {
            return NextResponse.json({ error: 'form_id is required' }, { status: 400 });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                'AuthorizationSource': 'API',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: `
                    query GetFormStructure($formId: ID!) {
                        customModuleForm(id: $formId) {
                            id
                            name
                            custom_modules {
                                id
                                label
                                mod_type
                                required
                                options_array
                                sublabel
                            }
                        }
                    }
                `,
                variables: { formId },
            }),
            signal: controller.signal,
            cache: 'no-store',
        } as any);

        clearTimeout(timeout);

        if (!response.ok) {
            console.error(`[Kiosk FormStructure] Healthie HTTP ${response.status}`);
            return NextResponse.json({ error: 'Failed to fetch form from Healthie' }, { status: 502 });
        }

        const result = await response.json();

        if (result.errors) {
            console.error('[Kiosk FormStructure] Healthie errors:', result.errors);
            return NextResponse.json({ error: 'Healthie query error' }, { status: 502 });
        }

        const form = result.data?.customModuleForm;
        if (!form) {
            return NextResponse.json({ error: 'Form not found' }, { status: 404 });
        }

        // Map to a clean structure for the frontend
        const fields = (form.custom_modules || []).map((m: any) => ({
            id: m.id,
            label: m.label || '',
            type: m.mod_type || 'text',
            required: m.required || false,
            options: m.options_array || [],
            description: m.sublabel || '',
        }));

        return NextResponse.json({
            success: true,
            form: {
                id: form.id,
                name: form.name,
                fields,
            },
        });
    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.error('[Kiosk FormStructure] Request timed out');
            return NextResponse.json({ error: 'Request timed out' }, { status: 504 });
        }
        console.error('[Kiosk FormStructure] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
