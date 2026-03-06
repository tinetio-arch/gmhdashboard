import { NextRequest, NextResponse } from 'next/server';
import { createHealthieClient } from '@/lib/healthie';

// POST: Change a patient's Healthie group
export async function POST(req: NextRequest) {
    const body = await req.json();
    const { healthie_user_id, group_id } = body;

    if (!healthie_user_id || !group_id) {
        return NextResponse.json({ error: 'healthie_user_id and group_id required' }, { status: 400 });
    }

    // Valid groups
    const VALID_GROUPS: Record<string, string> = {
        '75522': "NOW Men's Health",
        '75523': 'NOW Primary Care',
        '81103': 'NOWOptimal Wellness',
    };

    if (!VALID_GROUPS[group_id]) {
        return NextResponse.json({ error: `Invalid group_id. Valid: ${Object.keys(VALID_GROUPS).join(', ')}` }, { status: 400 });
    }

    try {
        const healthie = createHealthieClient();
        if (!healthie) {
            return NextResponse.json({ error: 'Healthie not configured' }, { status: 500 });
        }
        await healthie.updateClient(healthie_user_id, { user_group_id: group_id });

        return NextResponse.json({
            success: true,
            healthie_user_id,
            group_id,
            group_name: VALID_GROUPS[group_id]
        });
    } catch (err: any) {
        console.error('Failed to update Healthie group:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
