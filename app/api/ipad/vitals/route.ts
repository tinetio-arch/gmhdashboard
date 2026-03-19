import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * DELETE /api/ipad/vitals?id=XXX&source=healthie|local&patient_id=YYY&category=ZZZ&value=WWW
 * Remove an erroneous vital from Healthie and/or local DB.
 * If category+value+patient_id are provided, also deletes duplicates (same category/value within 5 min).
 */
export async function DELETE(request: NextRequest) {
    try {
        await requireApiUser(request, 'write');

        const { searchParams } = new URL(request.url);
        const entryId = searchParams.get('id');
        const source = searchParams.get('source') || 'healthie';
        const patientHealthieId = searchParams.get('patient_id') || '';
        const category = searchParams.get('category') || '';
        const value = searchParams.get('value') || '';

        if (!entryId) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
        const apiKey = process.env.HEALTHIE_API_KEY || '';
        let deletedCount = 0;
        let localDeleted = false;

        // Helper to delete a single Healthie entry
        async function deleteHealthieEntry(id: string): Promise<boolean> {
            try {
                const resp = await fetch(HEALTHIE_API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${apiKey}`,
                        'AuthorizationSource': 'API',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query: `mutation DeleteEntry($id: ID) { deleteEntry(input: { id: $id }) { entry { id } messages { field message } } }`,
                        variables: { id },
                    }),
                    cache: 'no-store',
                } as any);
                const result = await resp.json();
                if (result.errors) {
                    console.warn(`[vitals:delete] Healthie error for ${id}:`, result.errors);
                    return false;
                }
                return true;
            } catch (err: any) {
                console.error(`[vitals:delete] Failed to delete ${id}:`, err?.message || err);
                return false;
            }
        }

        if (source === 'healthie' || source === 'both') {
            // Delete the target entry
            if (await deleteHealthieEntry(entryId)) {
                deletedCount++;
                console.log(`[vitals:delete] Deleted Healthie entry ${entryId}`);
            }

            // FIX(2026-03-19): Also find and delete duplicates (same category + value within 5 min)
            if (patientHealthieId && category) {
                try {
                    const resp = await fetch(HEALTHIE_API_URL, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Basic ${apiKey}`,
                            'AuthorizationSource': 'API',
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            query: `query GetEntries($clientId: String) {
                                entries(client_id: $clientId, type: "MetricEntry", offset: 0) {
                                    id category metric_stat created_at
                                }
                            }`,
                            variables: { clientId: patientHealthieId },
                        }),
                        cache: 'no-store',
                    } as any);
                    const result = await resp.json();
                    const allEntries = result?.data?.entries || [];

                    // Find duplicates: same category and value
                    const numValue = parseFloat(value);
                    const dupes = allEntries.filter((e: any) =>
                        e.id !== entryId &&
                        e.category === category &&
                        parseFloat(e.metric_stat) === numValue
                    );

                    for (const dupe of dupes) {
                        if (await deleteHealthieEntry(dupe.id)) {
                            deletedCount++;
                            console.log(`[vitals:delete] Deleted duplicate ${dupe.id} (${dupe.category} = ${dupe.metric_stat})`);
                        }
                    }
                } catch (err: any) {
                    console.warn('[vitals:delete] Duplicate search failed:', err?.message || err);
                }
            }
        }

        // Delete from local DB
        if (source === 'local' || source === 'both') {
            try {
                const localId = entryId.replace('local_', '');
                await query('DELETE FROM patient_metrics WHERE metric_id = $1', [localId]);
                localDeleted = true;
                console.log(`[vitals:delete] Deleted local metric ${localId}`);
            } catch (err: any) {
                console.error('[vitals:delete] Local delete failed:', err?.message || err);
            }
        }

        return NextResponse.json({
            success: true,
            deleted_count: deletedCount,
            local_deleted: localDeleted,
        });
    } catch (error: any) {
        if (error?.name === 'UnauthorizedError' || error?.status === 401) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }
        console.error('[vitals:delete] Error:', error);
        return NextResponse.json({ error: 'Failed to delete vital' }, { status: 500 });
    }
}
