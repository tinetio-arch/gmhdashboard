/**
 * Fax Patient Search API
 * Searches Healthie API for ACTIVE patients only
 * 
 * IMPORTANT: Only active Healthie patients should be returned.
 * Uses active_status: "Active" filter AND client-side active field check
 * because Healthie API has a known bug where active_status is ignored
 * when the keywords parameter is used.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';

// GET: Search ACTIVE patients via Healthie API
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
    const search = url.searchParams.get('q') || '';

    if (search.length < 2) {
        return NextResponse.json({ patients: [] });
    }

    const apiKey = process.env.HEALTHIE_API_KEY;
    if (!apiKey) {
        console.error('HEALTHIE_API_KEY not configured');
        return NextResponse.json({ error: 'API not configured', patients: [] }, { status: 500 });
    }

    try {
        // Query Healthie API with active_status filter
        // NOTE: Healthie has a known bug where active_status is ignored when keywords is used,
        // so we also request the 'active' field and filter client-side
        const query = `
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
                    active
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
                query,
                variables: { keywords: search },
            }),
        });

        if (!response.ok) {
            console.error('[Fax Patient Search] Healthie API error:', response.status);
            return NextResponse.json({ error: 'Search failed', patients: [] }, { status: 500 });
        }

        const result = await response.json();

        if (result.errors) {
            console.error('[Fax Patient Search] Healthie GraphQL errors:', result.errors);
            return NextResponse.json({ error: 'Search failed', patients: [] }, { status: 500 });
        }

        const users = result.data?.users || [];

        // CRITICAL: Filter out inactive patients client-side
        // Healthie API bug: active_status filter is ignored when keywords is used
        const activeUsers = users.filter((user: any) => user.active !== false);

        console.log(`[Fax Patient Search] Healthie returned ${users.length} total, ${activeUsers.length} active for "${search}"`);

        return NextResponse.json({
            patients: activeUsers.slice(0, 25).map((user: any) => ({
                id: user.id,
                name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
                email: user.email,
            })),
        });
    } catch (error) {
        console.error('[Fax Patient Search] Search failed:', error);
        return NextResponse.json({ error: 'Search failed', patients: [] }, { status: 500 });
    }
}
