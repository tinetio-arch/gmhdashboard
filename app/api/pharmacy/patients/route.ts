/**
 * Pharmacy Patient Search API
 * Searches Healthie patients directly via GraphQL API
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';

const HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql';

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
        return NextResponse.json({ error: 'Healthie not configured', patients: [] }, { status: 500 });
    }

    try {
        // Use Healthie's users query with keywords filter
        // Note: Healthie API doesn't accept is_patient or first parameters
        const query = `
            query SearchPatients($keywords: String) {
                users(keywords: $keywords, active_status: "Active", sort_by: "LAST_NAME_ASC") {
                    id
                    first_name
                    last_name
                    email
                }
            }
        `;

        const response = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${apiKey}`,
                'AuthorizationSource': 'API',
            },
            body: JSON.stringify({
                query,
                variables: { keywords: search },
            }),
        });

        if (!response.ok) {
            console.error('Healthie API error:', response.status, await response.text());
            return NextResponse.json({ error: 'Healthie API error', patients: [] }, { status: 500 });
        }

        const data = await response.json();

        if (data.errors) {
            console.error('Healthie GraphQL errors:', data.errors);
            return NextResponse.json({ error: 'Healthie query error', patients: [] }, { status: 500 });
        }

        const users = data.data?.users || [];

        // Limit to 25 results (Healthie API doesn't support 'first' parameter)
        return NextResponse.json({
            patients: users.slice(0, 25).map((u: { id: string; first_name: string; last_name: string; email: string }) => ({
                id: u.id,
                name: `${u.first_name} ${u.last_name}`.trim(),
                email: u.email,
            })),
        });
    } catch (error) {
        console.error('Healthie patient search failed:', error);
        return NextResponse.json({ error: 'Search failed', patients: [] }, { status: 500 });
    }
}
