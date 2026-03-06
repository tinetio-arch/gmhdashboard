import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET: List all service tag configs
// POST: Add a new tag-to-service mapping
// DELETE: Remove a mapping
export async function GET() {
    const configs = await query(
        `SELECT id, tag, appointment_type_id, form_id, label, active
     FROM service_tag_config ORDER BY tag, label`
    );

    // Also get distinct tags with labels aggregated
    const tags = await query(
        `SELECT DISTINCT tag, array_agg(label) as labels 
     FROM service_tag_config 
     WHERE active = true 
     GROUP BY tag ORDER BY tag`
    );

    return NextResponse.json({
        configs: configs.rows,
        tags: tags.rows
    });
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { tag, appointment_type_id, form_id, label } = body;

    if (!tag || !label) {
        return NextResponse.json({ error: 'tag and label required' }, { status: 400 });
    }

    const result = await query(
        `INSERT INTO service_tag_config (tag, appointment_type_id, form_id, label)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
        [tag, appointment_type_id || null, form_id || null, label]
    );

    return NextResponse.json({ success: true, id: result.rows[0].id });
}

export async function DELETE(req: NextRequest) {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
        return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    await query(`DELETE FROM service_tag_config WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
}
