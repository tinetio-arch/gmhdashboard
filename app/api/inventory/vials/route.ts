import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { createVial, type NewVialInput } from '@/lib/inventoryQueries';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET: List active vials for inventory display
export async function GET(request: NextRequest) {
  try { await requireApiUser(request, 'read'); }
  catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    throw error;
  }

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // Return the next available vial ID (for auto-populating the bulk receive form)
    if (action === 'next-id') {
      const result = await query<{ external_id: string }>(`
        SELECT external_id FROM vials
        WHERE external_id ~ '^V\\d+$'
        ORDER BY external_id DESC
        LIMIT 1
      `);
      const lastId = result[0]?.external_id || 'V0000';
      const match = lastId.match(/^V(\d+)$/);
      const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
      const nextId = `V${nextNum.toString().padStart(4, '0')}`;
      return NextResponse.json({ success: true, nextId });
    }

    const status = url.searchParams.get('status') || 'Active';
    const limit = parseInt(url.searchParams.get('limit') || '100');

    const vials = await query<{
      vial_id: string;
      external_id: string;
      dea_drug_name: string;
      dea_drug_code: string;
      size_ml: string;
      remaining_volume_ml: string;
      lot_number: string | null;
      expiration_date: string | null;
      status: string;
      location: string | null;
      date_received: string | null;
    }>(`
            SELECT vial_id, external_id, dea_drug_name, dea_drug_code,
                   size_ml::text, remaining_volume_ml::text,
                   lot_number, expiration_date::text, status,
                   location, date_received::text
            FROM vials
            WHERE status = $1
            ORDER BY external_id ASC
            LIMIT $2
        `, [status, limit]);

    return NextResponse.json({
      success: true,
      data: vials.map(v => ({
        vial_id: v.vial_id,
        external_id: v.external_id,
        dea_drug_name: v.dea_drug_name || '',
        dea_drug_code: v.dea_drug_code || '',
        initial_volume_ml: parseFloat(v.size_ml || '10'),
        remaining_volume_ml: parseFloat(v.remaining_volume_ml || '0'),
        lot_number: v.lot_number,
        expiration_date: v.expiration_date,
        status: v.status,
        location: v.location,
        date_received: v.date_received,
      })),
    });
  } catch (error) {
    console.error('[Vials GET] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Generate sequential vial IDs starting from a base ID
 */
function generateSequentialIds(baseId: string, count: number): string[] {
  const match = baseId.match(/^([A-Za-z]*)(\d+)$/);
  if (!match) {
    // If no number found, append numbers
    return Array.from({ length: count }, (_, i) => `${baseId}${i + 1}`);
  }

  const [, prefix, numberStr] = match;
  const startNumber = Number.parseInt(numberStr, 10);
  return Array.from({ length: count }, (_, i) => {
    const num = startNumber + i;
    const padded = num.toString().padStart(numberStr.length, '0');
    return `${prefix}${padded}`;
  });
}

export async function POST(request: NextRequest) {
  try {
    // Parse body first to catch JSON errors early
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('[API] JSON parse error:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

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

    const {
      count,
      autoGenerate,
      externalId,
      sizeMl,
      lotNumber,
      expirationDate,
      dateReceived,
      controlledSubstance,
      deaDrugName,
      deaDrugCode,
      location,
      notes
    } = body;

    if (!count || count < 1) {
      return NextResponse.json({ error: 'Count must be at least 1' }, { status: 400 });
    }

    if (count > 100) {
      return NextResponse.json({ error: 'Cannot create more than 100 vials at once' }, { status: 400 });
    }

    const created: Array<{ vial_id: string; external_id: string | null }> = [];
    const errors: string[] = [];

    // If auto-generating, we need to get the next ID from the database
    // If a starting ID is provided, generate sequential IDs
    let vialIds: string[] = [];

    if (autoGenerate) {
      // Will be generated by createVial function
      vialIds = Array(count).fill('');
    } else if (externalId) {
      vialIds = generateSequentialIds(externalId, count);
    } else {
      return NextResponse.json({ error: 'Either autoGenerate must be true or externalId must be provided' }, { status: 400 });
    }

    // Create vials one by one (could be optimized with a transaction, but this is safer)
    for (let i = 0; i < count; i++) {
      try {
        const vialInput: NewVialInput = {
          externalId: vialIds[i] || undefined, // Empty string means auto-generate
          sizeMl: sizeMl ? Number(sizeMl) : undefined,
          lotNumber: lotNumber || undefined,
          expirationDate: expirationDate || undefined,
          dateReceived: dateReceived || undefined,
          controlledSubstance: controlledSubstance ?? true,
          deaDrugName: deaDrugName || undefined,
          deaDrugCode: deaDrugCode || undefined,
          location: location || undefined,
          notes: notes || undefined,
          status: 'Active',
          remainingVolumeMl: sizeMl ? Number(sizeMl) : undefined
        };

        const vial = await createVial(vialInput);
        created.push({
          vial_id: vial.vial_id,
          external_id: vial.external_id
        });
      } catch (error: any) {
        errors.push(`Vial ${i + 1}: ${error.message || 'Unknown error'}`);
      }
    }

    if (created.length === 0) {
      return NextResponse.json(
        {
          error: 'Failed to create any vials',
          errors
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      created,
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully created ${created.length} of ${count} vial${created.length === 1 ? '' : 's'}`
    });
  } catch (error: any) {
    console.error('[API] Error creating vials:', error);

    // Log full error details for debugging
    if (error instanceof Error) {
      console.error('[API] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
    }

    // Check if it's a JSON parse error
    if (error instanceof SyntaxError || error.message?.includes('JSON') || error.message?.includes('unexpected token')) {
      return NextResponse.json(
        { error: 'Invalid request format. Please check your input data.' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to create vials' },
      { status: 500 }
    );
  }
}

