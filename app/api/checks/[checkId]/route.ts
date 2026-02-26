import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

// DELETE /api/checks/:checkId — admin-only deletion of EOD checks
export async function DELETE(
    request: NextRequest,
    { params }: { params: { checkId: string } }
) {
    try {
        const user = await requireUser('admin');
        const { checkId } = params;

        if (!checkId || typeof checkId !== 'string') {
            return NextResponse.json({ error: 'Missing checkId' }, { status: 400 });
        }

        // Only allow deleting evening (EOD) checks — morning checks are DEA-required
        const existing = await query(
            `SELECT check_id, check_type, check_date, performed_by_name
         FROM controlled_substance_checks
        WHERE check_id = $1`,
            [checkId]
        );

        if (existing.rowCount === 0) {
            return NextResponse.json({ error: 'Check not found' }, { status: 404 });
        }

        const check = existing.rows[0];

        if (check.check_type === 'morning') {
            return NextResponse.json(
                { error: 'Cannot delete morning checks — they are required for DEA compliance' },
                { status: 403 }
            );
        }

        await query(
            `DELETE FROM controlled_substance_checks WHERE check_id = $1`,
            [checkId]
        );

        console.log(
            `[DEA] Admin ${user.displayName} deleted EOD check ${checkId} ` +
            `(date: ${check.check_date}, performed by: ${check.performed_by_name})`
        );

        return NextResponse.json({ success: true });
    } catch (err: any) {
        if (err?.message?.includes('Unauthorized') || err?.message?.includes('Forbidden')) {
            return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
        }
        console.error('[DEA] Error deleting check:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
