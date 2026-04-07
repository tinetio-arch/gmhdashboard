import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/headless/patient-context?healthie_id=12345
 *
 * Returns comprehensive patient context for Jarvis AI — replaces Snowflake queries.
 * Data comes directly from Postgres (the source of truth), avoiding Snowflake warehouse costs.
 *
 * Auth: x-jarvis-secret header
 */
export async function GET(request: NextRequest) {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const healthieId = request.nextUrl.searchParams.get('healthie_id');
    if (!healthieId) {
        return NextResponse.json({ error: 'Missing healthie_id' }, { status: 400 });
    }

    try {
        // 1. Patient basics
        const [patient] = await query<any>(`
            SELECT
                patient_id,
                full_name as "PATIENT_NAME",
                preferred_name as "PREFERRED_NAME",
                email as "EMAIL",
                phone_primary as "PHONE_NUMBER",
                dob as "DATE_OF_BIRTH",
                gender as "GENDER",
                regimen as "REGIMEN",
                alert_status as "ALERT_STATUS",
                status_key as "STATUS",
                service_start_date as "SERVICE_START_DATE",
                contract_end_date as "CONTRACT_END_DATE",
                client_type as "CLIENT_TYPE",
                payment_method_key as "PAYMENT_METHOD",
                last_lab_date as "LAST_LAB_DATE",
                next_lab_date as "NEXT_LAB_DATE",
                lab_status as "LAB_STATUS",
                healthie_client_id as "HEALTHIE_CLIENT_ID",
                date_added as "DATE_ADDED"
            FROM patients
            WHERE healthie_client_id = $1
            LIMIT 1
        `, [healthieId]);

        if (!patient) {
            return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
        }

        const patientId = patient.patient_id;

        // Calculate derived fields
        if (patient.CONTRACT_END_DATE) {
            const endDate = new Date(patient.CONTRACT_END_DATE + 'T12:00:00-07:00');
            patient.DAYS_UNTIL_CONTRACT_ENDS = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        }
        if (patient.NEXT_LAB_DATE) {
            const labDate = new Date(patient.NEXT_LAB_DATE + 'T12:00:00-07:00');
            patient.DAYS_UNTIL_NEXT_LAB = Math.ceil((labDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            patient.LAB_ALERT_STATUS = patient.DAYS_UNTIL_NEXT_LAB < 0 ? 'OVERDUE'
                : patient.DAYS_UNTIL_NEXT_LAB <= 7 ? 'DUE_SOON' : 'CURRENT';
        }

        // 2. Dispense data
        const dispenseData = await query<any>(`
            SELECT
                COUNT(*) as total_dispenses,
                COALESCE(SUM(total_dispensed_ml), 0) as total_ml,
                MAX(dispense_date) as last_dispense_date
            FROM dispenses
            WHERE patient_id = $1
        `, [patientId]);

        if (dispenseData.length > 0) {
            patient.TOTAL_DISPENSES = parseInt(dispenseData[0].total_dispenses);
            patient.TOTAL_ML_DISPENSED = parseFloat(dispenseData[0].total_ml);
            patient.LAST_DISPENSE_DATE = dispenseData[0].last_dispense_date;
        }

        // 3. Medications — derived from regimen + active vials
        // The regimen field (e.g., "0.5 q4d") is the primary medication data in Postgres.
        // Detailed medication names come from Healthie (synced to Snowflake only).
        // For Jarvis, regimen is sufficient.

        // 4. Billing, payment issues, membership — in parallel
        const [billingRows, issueRows, membershipRows] = await Promise.all([
            query<any>(`
                SELECT COUNT(*) as total_payments, COALESCE(SUM(amount), 0) as total_paid, MAX(paid_at) as last_payment_date
                FROM healthie_invoices
                WHERE patient_id = $1 AND paid_at IS NOT NULL
            `, [patientId]).catch(() => []),
            query<any>(`
                SELECT issue_type, issue_severity, amount_owed, days_overdue, status_changed_to
                FROM payment_issues
                WHERE patient_id = $1 AND status_changed_to != 'resolved'
                ORDER BY issue_severity DESC
                LIMIT 3
            `, [patientId]).catch(() => []),
            query<any>(`
                SELECT program_name, fee_amount, status
                FROM memberships
                WHERE patient_id = $1 AND status = 'active'
                LIMIT 1
            `, [patientId]).catch(() => []),
        ]);

        if (billingRows.length > 0 && billingRows[0].total_payments > 0) {
            patient.BILLING = {
                total_payments: parseInt(billingRows[0].total_payments),
                total_paid: billingRows[0].total_paid,
                last_payment_date: billingRows[0].last_payment_date,
            };
        }
        if (issueRows.length > 0) {
            patient.PAYMENT_ISSUES = issueRows.map(r => ({
                ISSUE_TYPE: r.issue_type,
                DESCRIPTION: `${r.issue_type}: $${r.amount_owed || 0} owed, ${r.days_overdue || 0} days overdue`,
                SEVERITY: r.issue_severity,
                STATUS: r.status_changed_to,
            }));
        }
        if (membershipRows.length > 0) {
            patient.MEMBERSHIP = {
                PROGRAM_NAME: membershipRows[0].program_name,
                FEE_AMOUNT: membershipRows[0].fee_amount,
                STATUS: membershipRows[0].status,
            };
        }

        // Remove internal field
        delete patient.patient_id;

        return NextResponse.json(patient);

    } catch (error) {
        console.error('[Headless API] Patient context error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
