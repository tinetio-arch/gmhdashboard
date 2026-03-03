
import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { writeFile, unlink } from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

export async function POST(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        try {
            await requireApiUser(req, 'write'); // Any user with write access can approve restricted labs
        } catch (error) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // In a real app, check for admin role here

        const orderId = params.id;
        if (!orderId) {
            return NextResponse.json({ error: "Missing order ID" }, { status: 400 });
        }

        const client = await getPool().connect();

        try {
            // Fetch order
            const res = await client.query(`SELECT * FROM lab_orders WHERE id = $1`, [orderId]);
            if (res.rows.length === 0) {
                return NextResponse.json({ error: "Order not found" }, { status: 404 });
            }

            const order = res.rows[0];

            if (order.status !== 'pending_approval') {
                return NextResponse.json({ error: `Order status is ${order.status}, cannot approve.` }, { status: 400 });
            }

            // Prepare JSON for python script
            const orderData = {
                clinic_id: order.clinic_id,
                external_id: `GMH-${orderId}`,
                patient: {
                    first_name: order.patient_first_name,
                    last_name: order.patient_last_name,
                    dob: order.patient_dob,
                    gender: order.patient_gender,
                    address: order.patient_address,
                    city: order.patient_city,
                    state: order.patient_state,
                    zip: order.patient_zip,
                    phone: order.patient_phone,
                    email: order.patient_email
                },
                tests: (() => {
                    try {
                        const raw = order.test_codes || '[]';
                        return typeof raw === 'string' ? JSON.parse(raw) : raw;
                    } catch {
                        // test_codes is not valid JSON — treat as comma-separated string
                        console.warn(`[LabApprove] test_codes not valid JSON: ${String(order.test_codes).substring(0, 100)}`);
                        return (order.test_codes || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                    }
                })(),
                notes: (order.custom_codes ? `Custom Codes: ${order.custom_codes}. ` : "") + (order.notes || ""),
                provider: {
                    name: order.ordering_provider || 'Phil Schafer NP',
                    npi: order.ordering_provider_npi
                }
            };

            const tempFile = path.join('/tmp', `lab_order_approve_${orderId}.json`);
            await writeFile(tempFile, JSON.stringify(orderData));

            console.log(`Approving and submitting order ${orderId}...`);

            // Execute script
            const { stdout, stderr } = await execAsync(`python3 /home/ec2-user/scripts/labs/order_lab.py --from-json ${tempFile}`, { maxBuffer: 10 * 1024 * 1024 }); // 10MB buffer for base64 PDF

            // Cleanup
            await unlink(tempFile);

            console.log("Script output:", stdout?.substring(0, 500));
            let result;
            try {
                // Script may print log lines before JSON — find the JSON object
                const jsonStart = stdout.indexOf('{');
                const jsonStr = jsonStart >= 0 ? stdout.substring(jsonStart) : stdout;
                result = JSON.parse(jsonStr);
            } catch (e) {
                console.error("Failed to parse script output:", stdout?.substring(0, 300));
                throw new Error(`Invalid output from order script: ${String(e).substring(0, 100)}`);
            }

            if (result.success) {
                // Update DB with success and store requisition PDF if available
                await client.query(
                    `UPDATE lab_orders SET status = 'submitted', submitted_at = NOW(), external_order_id = $1, approved_at = NOW(), approved_by = $2, requisition_pdf = $3 WHERE id = $4`,
                    [result.external_id || result.order_number || `GMH-${orderId}`, 'Admin', result.requisition_pdf || null, orderId]
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
                await client.query(
                    `UPDATE lab_orders SET status = 'failed', submission_error = $1 WHERE id = $2`,
                    [result.error, orderId]
                );
                return NextResponse.json({ success: false, error: result.error }, { status: 500 });
            }

        } finally {
            client.release();
        }

    } catch (error: any) {
        console.error("API Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
