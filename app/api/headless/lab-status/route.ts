// API endpoint to get patient lab status by Healthie client ID
// Used by the headless mobile app to show "Next Lab Due" dates

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getPatientAccessStatus } from '@/lib/appAccessControl'; // Import access control

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const healthieId = searchParams.get('healthie_id');

        if (!healthieId) {
            return NextResponse.json(
                { error: 'healthie_id parameter is required' },
                { status: 400 }
            );
        }

        const pool = getPool();

        // 1. First, find the patient ID to check access control
        const patientResult = await pool.query<{ patient_id: string }>(`
            SELECT patient_id FROM patients WHERE healthie_client_id = $1
            UNION
            SELECT patient_id::uuid FROM healthie_clients WHERE healthie_client_id = $1 AND is_active = true
            LIMIT 1
        `, [healthieId]);

        if (patientResult.rows.length === 0) {
            return NextResponse.json(
                { error: 'Patient not found', healthie_id: healthieId },
                { status: 404 }
            );
        }

        const patientId = patientResult.rows[0].patient_id;

        // 2. CHECK ACCESS CONTROL STATUS
        const accessCheck = await getPatientAccessStatus(patientId);

        if (accessCheck.status === 'revoked' || accessCheck.status === 'suspended') {
            console.warn(`[Headless API] Access blocked for revoked user: ${patientId} (Healthie ID: ${healthieId})`);
            return NextResponse.json(
                { error: 'Access denied: Account is revoked or suspended' },
                { status: 403 }
            );
        }

        // 3. Query labs table joined with patients by healthie_client_id
        // Note: patients table uses full_name, not patient_name
        const result = await pool.query(`
            SELECT 
                p.patient_id,
                p.full_name as patient_name,
                p.healthie_client_id,
                l.next_lab_date,
                l.last_lab_date,
                l.lab_status,
                CASE 
                    WHEN l.next_lab_date IS NULL THEN NULL
                    WHEN l.next_lab_date <= CURRENT_DATE THEN -(CURRENT_DATE - l.next_lab_date)::integer
                    ELSE (l.next_lab_date - CURRENT_DATE)::integer
                END as days_until_due,
                CASE 
                    WHEN l.next_lab_date IS NULL THEN 'unknown'
                    WHEN l.next_lab_date <= CURRENT_DATE THEN 'overdue'
                    WHEN l.next_lab_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'due_soon'
                    ELSE 'current'
                END as urgency
            FROM patients p
            LEFT JOIN labs l ON p.patient_id = l.patient_id
            WHERE p.patient_id = $1
            LIMIT 1
        `, [patientId]); // Use patientId now since we already looked it up

        if (result.rows.length === 0) {
            return NextResponse.json(
                { error: 'Patient not found (after access check)', healthie_id: healthieId },
                { status: 404 }
            );
        }

        const patient = result.rows[0];

        return NextResponse.json({
            healthie_id: healthieId,
            patient_name: patient.patient_name,
            next_lab_date: patient.next_lab_date,
            last_lab_date: patient.last_lab_date,
            lab_status: patient.lab_status,
            days_until_due: patient.days_until_due,
            urgency: patient.urgency // 'overdue', 'due_soon', 'current', 'unknown'
        });

    } catch (error) {
        console.error('Lab status API error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
