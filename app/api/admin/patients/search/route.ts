import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

const NORMALIZE_SQL =
  "lower(regexp_replace(regexp_replace(full_name, '^(mr\\.?|mrs\\.?|ms\\.?|dr\\.?|miss)\\s+', '', 'i'), '\\s+', ' ', 'g'))";

export async function POST(request: NextRequest) {
  await requireApiUser(request, 'admin');
  try {
    const body = await request.json();
    const queryText: string = body?.query ?? '';
    const normName: string = body?.normName ?? '';
    const normalized = (normName || queryText).trim().toLowerCase();
    if (!normalized) {
      return NextResponse.json({ data: [] });
    }
    const likeTerm = `%${normalized.replace(/\s+/g, ' ')}%`;
    const matches = await query(
      `
      SELECT
        patient_id,
        full_name,
        status_key,
        alert_status,
        phone_primary,
        service_start_date,
        contract_end AS contract_end_date,
        dob
      FROM patient_data_entry_v
      WHERE ${NORMALIZE_SQL} LIKE $1
      ORDER BY full_name
      LIMIT 25
      `,
      [likeTerm]
    );
    return NextResponse.json({ data: matches });
  } catch (error) {
    console.error('Patient search error', error);
    return NextResponse.json({ error: 'Failed to search patients' }, { status: 500 });
  }
}

