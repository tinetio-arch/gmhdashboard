import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { retireVial } from '@/lib/inventoryQueries';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    let user;
    try { user = await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const body = await request.json();
        if (!body.vialExternalId) {
            return NextResponse.json(
                { success: false, error: 'vialExternalId is required' }, { status: 400 }
            );
        }

        const result = await retireVial(
            body.vialExternalId,
            user.user_id,
            user.display_name || user.email || user.user_id
        );

        return NextResponse.json({
            success: true,
            wastedMl: result.wastedMl,
            vialId: result.vialId,
            details: result.details,
        });
    } catch (error) {
        console.error('[retire-vial] Error:', error);
        const message = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
