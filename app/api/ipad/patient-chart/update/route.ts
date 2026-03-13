import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

/**
 * POST /api/ipad/patient-chart/update
 * Updates patient demographics in Healthie via updateClient mutation.
 */
export async function POST(request: NextRequest) {
    try { await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const body = await request.json();
        const { healthie_id, first_name, last_name, email, phone_number, dob, gender,
                height, weight, line1, line2, city, state, zip, country, location_id } = body;

        if (!healthie_id) {
            return NextResponse.json({ success: false, error: 'healthie_id is required' }, { status: 400 });
        }

        // Build the updateClient mutation input
        const input: Record<string, any> = { id: healthie_id };
        if (first_name !== undefined) input.first_name = first_name;
        if (last_name !== undefined) input.last_name = last_name;
        if (email !== undefined) input.email = email;
        if (phone_number !== undefined) input.phone_number = phone_number;
        if (dob !== undefined) input.dob = dob;
        if (gender !== undefined) input.gender = gender;
        if (height !== undefined) input.height = height;
        if (weight !== undefined) input.weight = weight;

        // Location (address) update
        if (line1 !== undefined || city !== undefined || state !== undefined || zip !== undefined) {
            input.location = {};
            if (location_id) input.location.id = location_id;
            if (line1 !== undefined) input.location.line1 = line1;
            if (line2 !== undefined) input.location.line2 = line2;
            if (city !== undefined) input.location.city = city;
            if (state !== undefined) input.location.state = state;
            if (zip !== undefined) input.location.zip = zip;
            if (country !== undefined) input.location.country = country || 'US';
        }

        const mutation = `
            mutation UpdateClient($input: updateClientInput!) {
                updateClient(input: $input) {
                    user {
                        id
                        first_name
                        last_name
                        email
                        phone_number
                        dob
                        gender
                        height
                        weight
                        location {
                            line1
                            line2
                            city
                            state
                            zip
                            country
                        }
                    }
                    messages {
                        field
                        message
                    }
                }
            }
        `;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                'AuthorizationSource': 'API',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: mutation, variables: { input } }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return NextResponse.json({ success: false, error: `Healthie HTTP ${response.status}` }, { status: 502 });
        }

        const result = await response.json();

        if (result.errors) {
            console.error('[iPad:UpdatePatient] Healthie errors:', result.errors);
            return NextResponse.json({
                success: false,
                error: result.errors.map((e: any) => e.message).join(', '),
            }, { status: 400 });
        }

        const messages = result.data?.updateClient?.messages;
        if (messages && messages.length > 0) {
            return NextResponse.json({
                success: false,
                error: messages.map((m: any) => `${m.field}: ${m.message}`).join(', '),
            }, { status: 400 });
        }

        console.log('[iPad:UpdatePatient] Updated patient', healthie_id);
        return NextResponse.json({
            success: true,
            user: result.data?.updateClient?.user || null,
        });
    } catch (error) {
        console.error('[iPad:UpdatePatient] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
