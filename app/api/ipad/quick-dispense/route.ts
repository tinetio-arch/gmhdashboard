import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { createDispense } from '@/lib/inventoryQueries';
import type { NewDispenseInput } from '@/lib/inventoryQueries';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    let user;
    try { user = await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const body = await request.json();

        // Validate required fields
        const { vialExternalId, patientId, patientName, dispenseDate, syringeCount, dosePerSyringeMl } = body;

        if (!vialExternalId) {
            return NextResponse.json(
                { success: false, error: 'vialExternalId is required' }, { status: 400 }
            );
        }
        if (!dispenseDate) {
            return NextResponse.json(
                { success: false, error: 'dispenseDate is required' }, { status: 400 }
            );
        }
        if (!syringeCount || syringeCount < 1) {
            return NextResponse.json(
                { success: false, error: 'syringeCount must be at least 1' }, { status: 400 }
            );
        }
        if (!dosePerSyringeMl || dosePerSyringeMl <= 0) {
            return NextResponse.json(
                { success: false, error: 'dosePerSyringeMl must be positive' }, { status: 400 }
            );
        }

        // Build input for the existing createDispense function
        // This reuses the full transaction logic: vial FOR UPDATE, DEA tx, audit trail
        const input: NewDispenseInput = {
            vialExternalId: vialExternalId,
            dispenseDate: dispenseDate,
            transactionType: body.transactionType ?? 'dispense',
            patientId: patientId ?? null,
            patientName: patientName ?? null,
            syringeCount: parseInt(syringeCount, 10),
            dosePerSyringeMl: parseFloat(dosePerSyringeMl),
            totalDispensedMl: body.totalDispensedMl ?? null,
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
        };

        const result = await createDispense(input);

        return NextResponse.json({
            success: true,
            data: {
                dispense_id: result.dispenseId,
                dea_transaction_id: result.deaTransactionId,
                updated_remaining_ml: result.updatedRemainingMl,
            },
        });
    } catch (error) {
        console.error('[iPad QuickDispense] Error:', error);

        const message = error instanceof Error ? error.message : 'Internal server error';

        // Return 400 for business rule violations (morning check, empty vial, etc.)
        const is400 = message.includes('audit not completed') ||
            message.includes('0 mL remaining') ||
            message.includes('not found') ||
            message.includes('invalid');

        return NextResponse.json(
            { success: false, error: message },
            { status: is400 ? 400 : 500 }
        );
    }
}
