import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateLabelPdf } from '@/lib/pdf/labelGenerator';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    await requireApiUser(request, 'read');

    const dispenseId = request.nextUrl.searchParams.get('dispense_id');
    if (!dispenseId) {
        return NextResponse.json({ error: 'dispense_id required' }, { status: 400 });
    }

    try {
        // FIX(2026-03-26): Pull label_directions from peptide_products for accurate dosing
        const result = await query<{
            sale_id: number;
            patient_name: string;
            patient_dob: string;
            sale_date: string;
            product_name: string;
            category: string;
            label_directions: string | null;
        }>(`
            SELECT
                d.sale_id, d.patient_name, d.patient_dob, d.sale_date,
                p.name as product_name, p.category, p.label_directions
            FROM peptide_dispenses d
            JOIN peptide_products p ON p.product_id = d.product_id
            WHERE d.sale_id = $1
        `, [dispenseId]);

        if (result.length === 0) {
            return NextResponse.json({ error: 'Dispense not found' }, { status: 404 });
        }

        const dispense = result[0];

        const pdfBuffer = await generateLabelPdf({
            type: 'peptide',
            patientName: dispense.patient_name,
            patientDob: dispense.patient_dob || '',
            medication: dispense.product_name,
            dosage: dispense.label_directions || '',
            lotNumber: 'N/A',
            volume: '',
            dateDispensed: dispense.sale_date
        });

        return new NextResponse(pdfBuffer, {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="label-${dispenseId}.pdf"`
            }
        });
    } catch (error: any) {
        console.error('[billing/label] Error:', error.message);
        return NextResponse.json({ error: 'Failed to generate label' }, { status: 500 });
    }
}
