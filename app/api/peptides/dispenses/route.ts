/**
 * Peptide Dispenses API
 * GET - Fetch dispense history (patient dispensing log)
 * POST - Record new patient dispense
 * PATCH - Update dispense status (paid, education complete, etc.)
 */

import { NextResponse } from 'next/server';
import { fetchPeptideDispenses, createPeptideDispense, updatePeptideDispense, deletePeptideDispense } from '@/lib/peptideQueries';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateLabelPdf } from '@/lib/pdf/labelGenerator';
import { uploadLabelToHealthie } from '@/lib/healthieUploadLabel';

export async function GET() {
    try {
        await requireUser('read');
        const dispenses = await fetchPeptideDispenses();
        return NextResponse.json(dispenses);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error fetching peptide dispenses:', errMsg);
        return NextResponse.json(
            { error: `Failed to fetch peptide dispenses: ${errMsg}` },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    try {
        await requireUser('write');
        const body = await request.json();

        // Validate required fields
        if (!body.product_id || !body.patient_name) {
            return NextResponse.json(
                { error: 'product_id and patient_name are required' },
                { status: 400 }
            );
        }

        const dispense = await createPeptideDispense({
            product_id: body.product_id,
            quantity: body.quantity ? Number(body.quantity) : 1,
            patient_name: body.patient_name,
            patient_dob: body.patient_dob || undefined,
            order_date: body.order_date || null,
            received_date: body.received_date || null,
            status: body.status || 'Pending',
            education_complete: body.education_complete || false,
            notes: body.notes,
        });

        // --- Automatic Healthie Label Upload ---
        if (dispense.dispense_id) {
            (async () => {
                try {
                    // Look up patient_id using the literal name string
                    const patientRes = await query(
                        `SELECT patient_id, dob, healthie_client_id FROM patients WHERE full_name ILIKE $1 LIMIT 1`,
                        [body.patient_name]
                    );
                    const patientData = patientRes.rows[0];

                    if (patientData && patientData.healthie_client_id) {
                        const pdfBuffer = await generateLabelPdf({
                            type: 'peptide',
                            patientName: dispense.patient_name,
                            patientDob: body.patient_dob || patientData.dob || 'Unknown',
                            medication: dispense.peptide_name,
                            dosage: '', // Logic inside generateLabelPdf automatically handles this now
                            lotNumber: 'Unknown',
                            volume: String(dispense.quantity || '1'),
                            vialNumber: '',
                            amountDispensed: '',
                            provider: 'ABXTAC',
                            dateDispensed: new Date().toLocaleDateString(),
                            expDate: ''
                        });

                        const filename = `Prescription_Label_ABXTAC_${dispense.peptide_name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
                        await uploadLabelToHealthie(patientData.healthie_client_id, pdfBuffer, filename);
                        console.log(`[API] Successfully uploaded Peptide Label to Healthie for ${dispense.patient_name} (Healthie ID: ${patientData.healthie_client_id})`);
                    } else {
                        console.warn(`[API] Could not find Patient ID for ${body.patient_name} - skipping Healthie upload`);
                    }
                } catch (err) {
                    console.error('[API] Background Peptide Label Upload Failed:', err);
                }
            })();
        }

        return NextResponse.json(dispense);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error creating peptide dispense:', { error: errMsg, body });
        return NextResponse.json(
            { error: `Failed to create peptide dispense: ${errMsg}` },
            { status: 500 }
        );
    }
}

export async function PATCH(request: Request) {
    try {
        await requireUser('write');
        const body = await request.json();

        if (!body.dispense_id) {
            return NextResponse.json(
                { error: 'dispense_id is required' },
                { status: 400 }
            );
        }

        await updatePeptideDispense(body.dispense_id, {
            status: body.status,
            education_complete: body.education_complete,
            order_date: body.order_date,
            received_date: body.received_date,
            notes: body.notes,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error updating peptide dispense:', { error: errMsg, body });
        return NextResponse.json(
            { error: `Failed to update peptide dispense: ${errMsg}` },
            { status: 500 }
        );
    }
}

export async function DELETE(request: Request) {
    try {
        await requireUser('write');
        const body = await request.json();

        if (!body.dispense_id) {
            return NextResponse.json(
                { error: 'dispense_id is required' },
                { status: 400 }
            );
        }

        const result = await deletePeptideDispense(body.dispense_id);
        return NextResponse.json(result);
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('Error deleting peptide dispense:', { error: errMsg, body });
        return NextResponse.json(
            { error: `Failed to delete peptide dispense: ${errMsg}` },
            { status: 500 }
        );
    }
}
