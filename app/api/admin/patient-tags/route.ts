import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { createHealthieClient } from '@/lib/healthie';

// GET: List tags for a patient, or all tag configs
// POST: Add/remove a tag
export async function GET(req: NextRequest) {
    const patientId = req.nextUrl.searchParams.get('patient_id');

    // If no patient_id, return all tag configs (for admin UI)
    if (!patientId) {
        const configs = await query(
            `SELECT DISTINCT tag, array_agg(label) as labels FROM service_tag_config WHERE active = true GROUP BY tag ORDER BY tag`
        );
        return NextResponse.json({ availableTags: configs.rows });
    }

    const tags = await query(
        `SELECT tag, added_by, added_at FROM patient_service_tags WHERE patient_id = $1 ORDER BY tag`,
        [patientId]
    );

    const allConfigs = await query(
        `SELECT DISTINCT tag, array_agg(label) as labels FROM service_tag_config WHERE active = true GROUP BY tag ORDER BY tag`
    );

    return NextResponse.json({
        patientTags: tags.rows,
        availableTags: allConfigs.rows
    });
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { patient_id, healthie_user_id, tag, action, admin_name } = body;

    if (!patient_id || !tag || !action) {
        return NextResponse.json({ error: 'patient_id, tag, and action required' }, { status: 400 });
    }

    if (action === 'add') {
        await query(
            `INSERT INTO patient_service_tags (patient_id, healthie_user_id, tag, added_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (patient_id, tag) DO NOTHING`,
            [patient_id, healthie_user_id || '', tag, admin_name || 'admin']
        );

        // Auto-assign linked forms via Healthie
        if (healthie_user_id) {
            const formConfigs = await query(
                `SELECT form_id FROM service_tag_config WHERE tag = $1 AND form_id IS NOT NULL AND active = true`,
                [tag]
            );

            if (formConfigs.rows.length > 0) {
                const healthie = createHealthieClient();
                if (healthie) {
                    for (const row of formConfigs.rows) {
                        try {
                            await healthie.requestFormCompletion(healthie_user_id, row.form_id);
                        } catch (err: any) {
                            console.error(`Failed to assign form ${row.form_id}:`, err.message);
                        }
                    }
                }
            }
        }

        return NextResponse.json({ success: true, action: 'added', tag });
    }

    if (action === 'remove') {
        await query(
            `DELETE FROM patient_service_tags WHERE patient_id = $1 AND tag = $2`,
            [patient_id, tag]
        );
        return NextResponse.json({ success: true, action: 'removed', tag });
    }

    return NextResponse.json({ error: 'action must be add or remove' }, { status: 400 });
}
