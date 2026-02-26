import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';

/**
 * GET /api/patients/search?q=name - Search for ACTIVE patients by name
 * Uses Healthie API directly to ensure only active patients are returned.
 * 
 * IMPORTANT: Only active Healthie patients should be returned.
 * Uses active_status: "Active" filter AND client-side active field check
 * because Healthie API has a known bug where active_status is ignored
 * when the keywords parameter is used.
 */
export async function GET(request: NextRequest): Promise<Response> {
    try {
        await requireApiUser(request, 'read');
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        throw error;
    }

    const url = new URL(request.url);
    const query = url.searchParams.get('q');

    if (!query || query.length < 2) {
        return NextResponse.json({
            success: false,
            error: 'Query must be at least 2 characters',
            patients: []
        });
    }

    const apiKey = process.env.HEALTHIE_API_KEY;
    if (!apiKey) {
        console.error('HEALTHIE_API_KEY not configured');
        return NextResponse.json({ success: false, error: 'API not configured', patients: [] }, { status: 500 });
    }

    try {
        // Query Healthie API with active_status filter
        // NOTE: Healthie has a known bug where active_status is ignored when keywords is used,
        // so we also request the 'active' field and filter client-side
        const gqlQuery = `
            query SearchPatients($keywords: String) {
                users(
                    keywords: $keywords
                    active_status: "Active"
                    sort_by: "LAST_NAME_ASC"
                ) {
                    id
                    first_name
                    last_name
                    email
                    dob
                    gender
                    phone_number
                    active
                    location {
                        line1
                        city
                        state
                        zip
                    }
                }
            }
        `;

        const response = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${apiKey}`,
                'AuthorizationSource': 'API',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: gqlQuery,
                variables: { keywords: query },
            }),
        });

        if (!response.ok) {
            console.error('[Patient Search] Healthie API error:', response.status);
            return NextResponse.json({ success: false, error: 'Search failed', patients: [] }, { status: 500 });
        }

        const result = await response.json();

        if (result.errors) {
            console.error('[Patient Search] Healthie GraphQL errors:', result.errors);
            return NextResponse.json({ success: false, error: 'Search failed', patients: [] }, { status: 500 });
        }

        const users = result.data?.users || [];

        // CRITICAL: Filter out inactive patients client-side
        // Healthie API bug: active_status filter is ignored when keywords is used
        const activeUsers = users.filter((user: any) => user.active !== false);

        console.log(`[Patient Search] Healthie returned ${users.length} total, ${activeUsers.length} active for "${query}"`);

        return NextResponse.json({
            success: true,
            patients: activeUsers.slice(0, 25).map((user: any) => ({
                id: user.id,
                healthie_id: user.id,
                first_name: user.first_name || '',
                last_name: user.last_name || '',
                dob: user.dob || '',
                gender: user.gender || '',
                email: user.email || '',
                phone: user.phone_number || '',
                address_line1: user.location?.line1 || '',
                city: user.location?.city || '',
                state: user.location?.state || '',
                postal_code: user.location?.zip || ''
            }))
        });
    } catch (error) {
        console.error('[Patient Search] Search failed:', error);
        return NextResponse.json({
            success: false,
            error: 'Search failed',
            patients: []
        }, { status: 500 });
    }
}
