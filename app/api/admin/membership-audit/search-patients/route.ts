import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    await requireApiUser(req, 'read');

    const searchParams = req.nextUrl.searchParams;
    const searchTerm = searchParams.get('q') || '';

    if (!searchTerm || searchTerm.length < 2) {
      return NextResponse.json({ patients: [] });
    }

    // Search patients by name, email, or phone
    const patients = await query<{
      patient_id: string;
      full_name: string;
      email: string | null;
      phone_primary: string | null;
      status_key: string | null;
      payment_method_key: string | null;
      client_type_key: string | null;
    }>(`
      SELECT 
        patient_id,
        full_name,
        email,
        phone_primary,
        status_key,
        payment_method_key,
        client_type_key
      FROM patients
      WHERE 
        status_key NOT IN ('inactive', 'discharged')
        AND (
          full_name ILIKE $1
          OR email ILIKE $1
          OR phone_primary ILIKE $1
        )
      ORDER BY 
        CASE 
          WHEN full_name ILIKE $2 THEN 1
          WHEN email ILIKE $2 THEN 2
          ELSE 3
        END,
        full_name
      LIMIT 20
    `, [`%${searchTerm}%`, `${searchTerm}%`]);

    return NextResponse.json({ patients });
  } catch (error) {
    console.error('Error searching patients:', error);
    return NextResponse.json(
      { error: 'Failed to search patients' },
      { status: 500 }
    );
  }
}

