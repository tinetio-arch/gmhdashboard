import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { createDispense } from '@/lib/inventoryQueries';
import { query } from '@/lib/db';
import { generateLabelPdf } from '@/lib/pdf/labelGenerator';
import { uploadLabelToHealthie } from '@/lib/healthieUploadLabel';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'write');

    const body = await request.json();

    // Validate required fields
    if (!body.vialExternalId) {
      return NextResponse.json({ error: 'Vial external ID is required.' }, { status: 400 });
    }
    if (!body.dispenseDate) {
      return NextResponse.json({ error: 'Dispense date is required.' }, { status: 400 });
    }
    if (!body.patientName && !body.patientId) {
      return NextResponse.json({ error: 'Patient name or ID is required.' }, { status: 400 });
    }

    const result = await createDispense({
      vialExternalId: body.vialExternalId,
      dispenseDate: body.dispenseDate,
      transactionType: body.transactionType ?? 'Dispense',
      patientId: body.patientId ?? null,
      patientName: body.patientName ?? null,
      totalDispensedMl: body.totalDispensedMl ?? null,
      syringeCount: body.syringeCount ?? null,
      dosePerSyringeMl: body.dosePerSyringeMl ?? null,
      wasteMl: body.wasteMl ?? null,
      totalAmount: body.totalAmount ?? null,
      notes: body.notes ?? null,
      prescriber: body.prescriber ?? null,
      deaSchedule: body.deaSchedule ?? null,
      deaDrugName: body.deaDrugName ?? null,
      deaDrugCode: body.deaDrugCode ?? null,
      units: body.units ?? 'mL',
      recordDea: body.recordDea ?? true,
      createdByUserId: user.user_id,
      createdByRole: user.role,
      prescribingProviderId: body.prescribingProviderId ?? null,
      signatureStatus: body.signatureStatus ?? 'awaiting_signature',
      signatureNote: body.signatureNote ?? null,
    });

    // --- Automatic Healthie Label Upload ---
    if (result.dispenseId && body.transactionType === 'Dispense' && body.patientId) {
      // Fire-and-forget so we don't slow down the UI
      (async () => {
        try {
          const patientRes = await query(`SELECT patient_name, date_of_birth, regimen, healthie_client_id FROM patients WHERE patient_id = $1`, [body.patientId]);
          const patientData = patientRes.rows[0];

          const vialRes = await query(`SELECT lot_number, expiration_date FROM inventory_vials WHERE external_id = $1`, [body.vialExternalId]);
          const vialData = vialRes.rows[0];

          if (patientData && vialData && patientData.healthie_client_id) {
            const dosageString = patientData.regimen || `${body.totalDispensedMl}ml SUBQ Weekly`;
            const patientNameStr = body.patientName || patientData.patient_name;
            const expDateStr = vialData.expiration_date ? new Date(vialData.expiration_date).toISOString().split('T')[0] : '';

            const pdfBuffer = await generateLabelPdf({
              type: 'testosterone',
              patientName: patientNameStr,
              patientDob: patientData.date_of_birth || '',
              medication: body.deaDrugName || 'Testosterone Cypionate 200mg/ml',
              dosage: dosageString,
              lotNumber: vialData.lot_number || 'Unknown',
              volume: '10ml',
              vialNumber: body.vialExternalId,
              amountDispensed: body.totalDispensedMl ? String(body.totalDispensedMl) : '',
              provider: body.prescriber || 'Phil Schafer, NP',
              dateDispensed: new Date(body.dispenseDate).toLocaleDateString(),
              expDate: expDateStr
            });

            const filename = `Prescription_Label_Testosterone_${patientNameStr.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
            await uploadLabelToHealthie(patientData.healthie_client_id, pdfBuffer, filename);
            console.log(`[API] Successfully uploaded Testosterone Label to Healthie for ${patientNameStr} (Healthie ID: ${patientData.healthie_client_id})`);
          } else {
            console.warn(`[API] Skipping Healthie label upload for ${body.patientId} - missing vial data or healthie_client_id mapping`);
          }
        } catch (err) {
          console.error('[API] Background Label Upload Failed:', err);
        }
      })();
    }

    return NextResponse.json({
      success: true,
      dispenseId: result.dispenseId,
      deaTransactionId: result.deaTransactionId,
      updatedRemainingMl: result.updatedRemainingMl,
    });
  } catch (error: any) {
    console.error('[API] Error creating dispense transaction:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create dispense transaction.' },
      { status: 500 }
    );
  }
}
