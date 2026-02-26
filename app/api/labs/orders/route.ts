
import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { writeFile, unlink } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

// Restricted codes that require approval
const RESTRICTED_CODES = ['L509', '202'];

// GET: List orders
export async function GET(req: NextRequest) {
    try {
        try {
            await requireApiUser(req);
        } catch (error) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Check for filters
        const { searchParams } = new URL(req.url);
        const status = searchParams.get("status");

        const client = await getPool().connect();
        try {
            let query = `SELECT * FROM lab_orders`;
            const values = [];

            if (status) {
                query += ` WHERE status = $1`;
                values.push(status);
            }

            query += ` ORDER BY created_at DESC LIMIT 100`;

            const result = await client.query(query, values);
            return NextResponse.json(result.rows);
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("API Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// POST: Create order
export async function POST(req: NextRequest) {
    try {
        try {
            await requireApiUser(req, 'write'); // Require write access for creating orders
        } catch (error) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const {
            clinic_id,
            patient_id, // UUID from GMH DB
            patient,    // Object with demographics
            tests,      // Array of codes
            custom_codes,
            diagnosis_codes,
            notes,
            provider_name,
            provider_npi
        } = body;

        if (!clinic_id || !patient) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Validate required patient fields
        const missingFields: string[] = [];
        if (!patient.first_name) missingFields.push('First Name');
        if (!patient.last_name) missingFields.push('Last Name');
        if (!patient.dob) missingFields.push('Date of Birth');
        if (missingFields.length > 0) {
            return NextResponse.json({
                error: `Missing required patient info: ${missingFields.join(', ')}`
            }, { status: 400 });
        }

        // Check for restricted tests
        const hasRestrictedCode = tests.some((code: string) => RESTRICTED_CODES.includes(code));
        const hasCustomCodes = !!custom_codes && custom_codes.trim().length > 0;
        const approvalRequired = hasRestrictedCode || hasCustomCodes;
        const status = approvalRequired ? 'pending_approval' : 'submitted';

        // Insert into DB
        const client = await getPool().connect();
        let orderId;

        // Fix for patient_id coming as Healthie ID (integer) instead of UUID 
        // If patient_id is provided but not a valid UUID, look it up
        let internalPatientId = patient_id;
        if (patient_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patient_id)) {
            console.log(`[LabOrder] patient_id ${patient_id} is not a UUID, looking up by Healthie ID...`);
            try {
                // First try direct ID match on patients table
                const patResult = await client.query('SELECT patient_id FROM patients WHERE patient_id::text = $1', [patient_id]);
                if (patResult.rows.length > 0) {
                    internalPatientId = patResult.rows[0].patient_id;
                } else {
                    // Look up via healthie_clients join table (canonical Healthie→Patient mapping)
                    const patResult2 = await client.query(
                        'SELECT p.patient_id FROM patients p JOIN healthie_clients hc ON p.patient_id = hc.patient_id WHERE hc.healthie_client_id = $1 AND hc.is_active = true',
                        [patient_id]
                    );
                    if (patResult2.rows.length > 0) {
                        internalPatientId = patResult2.rows[0].patient_id;
                        console.log(`[LabOrder] Found internal UUID ${internalPatientId} for Healthie ID ${patient_id}`);
                    } else {
                        console.warn(`[LabOrder] Could not find patient with Healthie ID ${patient_id} in patients or healthie_clients`);
                        internalPatientId = null;
                    }
                }
            } catch (err) {
                console.error('[LabOrder] Error resolving patient ID:', err);
                internalPatientId = null;
            }
        } else if (!patient_id && patient.email) {
            // Try to find by email if no ID provided
            try {
                const patResult = await client.query('SELECT id FROM patients WHERE email = $1', [patient.email]);
                if (patResult.rows.length > 0) {
                    internalPatientId = patResult.rows[0].id;
                    console.log(`[LabOrder] Found internal UUID ${internalPatientId} by email ${patient.email}`);
                }
            } catch (e: any) {
                console.error('[LabOrder] Email lookup failed:', e.message);
            }
        }

        // Sync only originally-missing fields back to Healthie (fire-and-forget)
        const healthieId = patient_id || patient.healthie_id;
        const healthieFieldUpdates = body.healthie_field_updates; // Only fields that were missing from Healthie, filled in by user
        if (healthieId && healthieFieldUpdates && Object.keys(healthieFieldUpdates).length > 0) {
            (async () => {
                try {
                    const { HealthieClient } = await import('@/lib/healthie');
                    const healthie = new HealthieClient({
                        apiKey: process.env.HEALTHIE_API_KEY || ''
                    });
                    const updatePayload: Record<string, any> = {};

                    // Build location object only from fields that were originally missing
                    const locationFields: Record<string, string> = {};
                    if (healthieFieldUpdates.address) locationFields.line1 = healthieFieldUpdates.address;
                    if (healthieFieldUpdates.city) locationFields.city = healthieFieldUpdates.city;
                    if (healthieFieldUpdates.state) locationFields.state = healthieFieldUpdates.state;
                    if (healthieFieldUpdates.zip) locationFields.zip = healthieFieldUpdates.zip;
                    if (Object.keys(locationFields).length > 0) updatePayload.location = locationFields;

                    // Sync DOB/gender only if they were originally missing
                    if (healthieFieldUpdates.dob) updatePayload.dob = healthieFieldUpdates.dob;
                    if (healthieFieldUpdates.gender) updatePayload.gender = healthieFieldUpdates.gender;

                    await healthie.updateClient(healthieId, updatePayload);
                    console.log(`[LabOrder] ✅ Synced missing fields to Healthie for ${healthieId}:`, Object.keys(healthieFieldUpdates).join(', '));
                } catch (syncErr: any) {
                    console.error(`[LabOrder] ⚠️ Failed to sync patient info to Healthie:`, syncErr.message);
                }
            })();
        }

        try {
            const insertQuery = `
        INSERT INTO lab_orders (
          clinic_id,
          patient_id,
          patient_first_name,
          patient_last_name,
          patient_dob,
          patient_gender,
          patient_address,
          patient_city,
          patient_state,
          patient_zip,
          patient_phone,
          patient_email,
          ordering_provider,
          ordering_provider_npi,
          test_codes,
          custom_codes,
          diagnosis_codes,
          status,
          approval_required,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
        RETURNING id
      `;

            const values = [
                clinic_id,
                internalPatientId || null, // handle empty string as null
                patient.first_name || null,
                patient.last_name || null,
                patient.dob || null,       // empty string → null (date column)
                patient.gender || null,
                patient.address || null,
                patient.city || '',
                patient.state || '',
                patient.zip || '',
                patient.phone || null,
                patient.email || null,
                provider_name || 'Phil Schafer NP',
                provider_npi,
                JSON.stringify(tests),
                custom_codes,
                JSON.stringify(diagnosis_codes || []),
                status,
                approvalRequired
            ];

            const res = await client.query(insertQuery, values);
            orderId = res.rows[0].id;

        } finally {
            client.release();
        }

        // If approval required, return success (pending)
        if (approvalRequired) {
            return NextResponse.json({
                success: true,
                order_id: orderId,
                status: 'pending_approval',
                message: 'Order created and pending admin approval'
            });
        }

        // If no approval required, submit immediately
        try {
            // Prepare JSON for python script
            const orderData = {
                clinic_id: clinic_id,
                external_id: `GMH-${orderId}`, // Generate a temporary ID or use DB ID
                patient: {
                    first_name: patient.first_name,
                    last_name: patient.last_name,
                    dob: patient.dob,
                    gender: patient.gender,
                    address: patient.address,
                    city: patient.city,
                    state: patient.state,
                    zip: patient.zip,
                    phone: patient.phone,
                    email: patient.email
                },
                tests: tests,
                notes: notes || custom_codes, // Add custom codes to notes if any
                provider: {
                    name: provider_name || 'Phil Schafer NP',
                    npi: provider_npi
                }
            };

            const tempFile = path.join('/tmp', `lab_order_${orderId}.json`);
            await writeFile(tempFile, JSON.stringify(orderData));

            console.log(`Submitting order ${orderId} via script for clinic ${clinic_id}...`);
            const { stdout, stderr } = await execAsync(`python3 /home/ec2-user/scripts/labs/order_lab.py --from-json ${tempFile}`, { maxBuffer: 10 * 1024 * 1024 }); // 10MB buffer for base64 PDF

            // Cleanup
            await unlink(tempFile);

            console.log("Script output:", stdout);
            let result;
            try {
                result = JSON.parse(stdout);
            } catch (e) {
                console.error("Failed to parse script output", stdout);
                throw new Error("Invalid output from order script");
            }

            if (result.success) {
                // Update DB with success and store requisition PDF if available
                await getPool().query(
                    `UPDATE lab_orders SET status = 'submitted', submitted_at = NOW(), external_order_id = $1, requisition_pdf = $2 WHERE id = $3`,
                    [result.external_id || result.order_number || `GMH-${orderId}`, result.requisition_pdf || null, orderId]
                );

                return NextResponse.json({
                    success: true,
                    order_id: orderId,
                    status: 'submitted',
                    external_id: result.external_id || result.order_number,
                    requisition_pdf_available: !!result.requisition_pdf
                });
            } else {
                // Update DB with failure
                await getPool().query(
                    `UPDATE lab_orders SET status = 'failed', submission_error = $1 WHERE id = $2`,
                    [result.error, orderId]
                );
                return NextResponse.json({ success: false, error: result.error }, { status: 500 });
            }

        } catch (err: any) {
            console.error("Submission error:", err);
            await getPool().query(
                `UPDATE lab_orders SET status = 'failed', submission_error = $1 WHERE id = $2`,
                [err.message, orderId]
            );
            return NextResponse.json({ success: false, error: "Submission failed" }, { status: 500 });
        }

    } catch (error: any) {
        console.error("API Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
