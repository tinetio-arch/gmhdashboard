import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { deleteVial } from '@/lib/inventoryQueries';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory/vials/bulk-delete
 * Delete multiple vials by their external IDs or internal UUIDs.
 * Cascades to dispenses, DEA logs, and history.
 * Requires admin role.
 */
export async function POST(request: NextRequest) {
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

        const body = await request.json();
        const vialIds: string[] = body.vialIds;

        if (!Array.isArray(vialIds) || vialIds.length === 0) {
            return NextResponse.json(
                { error: 'vialIds must be a non-empty array.' },
                { status: 400 }
            );
        }

        if (vialIds.length > 200) {
            return NextResponse.json(
                { error: 'Cannot delete more than 200 vials at once.' },
                { status: 400 }
            );
        }

        const results: Array<{ id: string; success: boolean; error?: string }> = [];

        for (const id of vialIds) {
            try {
                // Resolve: could be an external_id or a vial_id (UUID)
                let vialId = id;
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

                if (!isUuid) {
                    // Look up by external_id
                    const rows = await query<{ vial_id: string }>(
                        `SELECT vial_id FROM vials WHERE external_id = $1`,
                        [id.trim()]
                    );
                    if (rows.length === 0) {
                        results.push({ id, success: false, error: `Vial "${id}" not found.` });
                        continue;
                    }
                    vialId = rows[0].vial_id;
                }

                await deleteVial(vialId, { removeLogs: true });
                results.push({ id, success: true });
            } catch (err: any) {
                results.push({ id, success: false, error: err.message || 'Unknown error' });
            }
        }

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;

        return NextResponse.json({
            success: failCount === 0,
            results,
            message: `Deleted ${successCount} of ${vialIds.length} vial(s).${failCount > 0 ? ` ${failCount} failed.` : ''}`
        });
    } catch (error: any) {
        console.error('[API] Error in bulk vial delete:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to delete vials.' },
            { status: 500 }
        );
    }
}
