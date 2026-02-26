import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import {
    getAllPatientAccessSummaries,
    getAccessControlStats,
    revokePatientAccess,
    restorePatientAccess,
    getPatientAccessStatus,
    getAccessControlHistory,
    type ReasonCategory,
} from '@/lib/appAccessControl';

/**
 * GET /api/app-access/
 * 
 * Query params:
 *   ?action=stats        → Get aggregate stats
 *   ?action=history&patientId=xxx  → Get audit history for a patient
 *   (default)            → Get all patient access summaries
 */
export async function GET(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'admin');
        const { searchParams } = new URL(request.url);
        const action = searchParams.get('action');

        if (action === 'stats') {
            const stats = await getAccessControlStats();
            return NextResponse.json(stats);
        }

        if (action === 'history') {
            const patientId = searchParams.get('patientId');
            if (!patientId) {
                return NextResponse.json({ error: 'patientId required' }, { status: 400 });
            }
            const history = await getAccessControlHistory(patientId);
            const current = await getPatientAccessStatus(patientId);
            return NextResponse.json({ current_status: current.status, history });
        }

        const summaries = await getAllPatientAccessSummaries();
        return NextResponse.json({ patients: summaries });
    } catch (err: any) {
        if (err?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[AppAccess API] GET error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

/**
 * POST /api/app-access/
 * 
 * Body:
 *   { action: 'revoke' | 'restore', patientId, reason, reasonCategory?, notes?, expiresAt? }
 */
export async function POST(request: NextRequest) {
    try {
        const user = await requireApiUser(request, 'admin');
        const body = await request.json();

        const { action, patientId, reason, reasonCategory, notes, expiresAt } = body;

        if (!action || !patientId || !reason) {
            return NextResponse.json(
                { error: 'Missing required fields: action, patientId, reason' },
                { status: 400 }
            );
        }

        if (action === 'revoke') {
            const validCategories: ReasonCategory[] = ['payment', 'policy_violation', 'discharged', 'administrative', 'other'];
            const category = validCategories.includes(reasonCategory) ? reasonCategory : 'other';

            const record = await revokePatientAccess({
                patientId,
                reason,
                reasonCategory: category,
                changedBy: user.user_id,
                notes,
                expiresAt,
            });

            return NextResponse.json({
                success: true,
                message: `Access ${expiresAt ? 'suspended' : 'revoked'} for patient`,
                record,
            });
        }

        if (action === 'restore') {
            const record = await restorePatientAccess({
                patientId,
                reason,
                changedBy: user.user_id,
                notes,
            });

            return NextResponse.json({
                success: true,
                message: 'Access restored for patient',
                record,
            });
        }

        return NextResponse.json({ error: 'Invalid action. Use "revoke" or "restore"' }, { status: 400 });
    } catch (err: any) {
        if (err?.status === 401) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        console.error('[AppAccess API] POST error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
