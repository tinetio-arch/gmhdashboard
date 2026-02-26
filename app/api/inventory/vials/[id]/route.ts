import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { deleteVial, updateVial } from '@/lib/inventoryQueries';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/inventory/vials/[id]
 * Delete a single vial and cascade to dispenses, DEA logs, and history.
 * Requires admin role.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        let user;
        try {
            user = await requireApiUser(request, 'write');
        } catch (authError: any) {
            if (authError instanceof UnauthorizedError || authError.status === 401) {
                return NextResponse.json(
                    { error: 'Unauthorized. Please log in.' },
                    { status: 401 }
                );
            }
            throw authError;
        }

        // Only admins can delete vials
        if (user.role !== 'admin') {
            return NextResponse.json(
                { error: 'Only administrators can delete vials.' },
                { status: 403 }
            );
        }

        const vialId = params.id;
        if (!vialId) {
            return NextResponse.json({ error: 'Vial ID is required.' }, { status: 400 });
        }

        await deleteVial(vialId, { removeLogs: true });

        return NextResponse.json({ success: true, deletedVialId: vialId });
    } catch (error: any) {
        console.error('[API] Error deleting vial:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to delete vial.' },
            { status: 500 }
        );
    }
}

/**
 * PATCH /api/inventory/vials/[id]
 * Update vial DEA drug/vendor info.
 * Requires write access.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        let user;
        try {
            user = await requireApiUser(request, 'write');
        } catch (authError: any) {
            if (authError instanceof UnauthorizedError || authError.status === 401) {
                return NextResponse.json(
                    { error: 'Unauthorized. Please log in.' },
                    { status: 401 }
                );
            }
            throw authError;
        }

        const vialId = params.id;
        if (!vialId) {
            return NextResponse.json({ error: 'Vial ID is required.' }, { status: 400 });
        }

        const body = await request.json();
        const vial = await updateVial(vialId, {
            deaDrugName: body.deaDrugName,
            deaDrugCode: body.deaDrugCode
        });

        return NextResponse.json({ success: true, vial });
    } catch (error: any) {
        console.error('[API] Error updating vial:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to update vial.' },
            { status: 500 }
        );
    }
}
