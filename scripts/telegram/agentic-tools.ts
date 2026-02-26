/**
 * Agentic Tools Module
 * 
 * Implements function calling tools for Gemini
 * All tool executions are logged for CEO dashboard tracking
 */

import { connectSnowflake } from './snowflake';
import { fetchHealthieGraphQL } from './healthie';

// ============================================================================
// TOOL EXECUTION DISPATCHER
// ============================================================================
export async function executeAgenticTool(
    toolName: string,
    args: Record<string, any>
): Promise<string> {
    console.log(`[Agentic] Executing tool: ${toolName}`, args);

    switch (toolName) {
        case 'search_patients':
            return await toolSearchPatients(args.query);
        case 'get_patient_labs':
            return await toolGetPatientLabs(args.patient_id);
        case 'send_email':
            return await toolSendEmail(args.to, args.subject, args.body);
        case 'create_healthie_task':
            return await toolCreateHealthieTask(args.patient_id, args.content, args.due_date);
        default:
            return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
}

// ============================================================================
// TOOL: Search Patients
// ============================================================================
async function toolSearchPatients(query: string): Promise<string> {
    console.log(`[Agentic] 🔍 Searching patients for: ${query}`);

    try {
        const conn = await connectSnowflake();
        const sql = `
      SELECT PATIENT_ID, PATIENT_NAME, EMAIL, PHONE_NUMBER, HEALTHIE_CLIENT_ID, STATUS
      FROM GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW
      WHERE PATIENT_NAME ILIKE ? OR EMAIL ILIKE ? OR PHONE_NUMBER ILIKE ?
      LIMIT 5
    `;

        const rows: any[] = await new Promise((resolve, reject) => {
            conn.execute({
                sqlText: sql,
                binds: [`%${query}%`, `%${query}%`, `%${query}%`],
                complete: (err: any, stmt: any, rows: any) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            });
        });

        conn.destroy(() => { });

        if (rows.length === 0) {
            console.log(`[Agentic] ❌ No patients found for: ${query}`);
            return JSON.stringify({ found: false, message: `No patients found matching "${query}"` });
        }

        console.log(`[Agentic] ✅ Found ${rows.length} patients`);
        return JSON.stringify({ found: true, patients: rows });
    } catch (error: any) {
        console.log(`[Agentic] ❌ Search failed: ${error.message}`);
        return JSON.stringify({ error: error.message });
    }
}

// ============================================================================
// TOOL: Get Patient Labs
// ============================================================================
async function toolGetPatientLabs(patientId: string): Promise<string> {
    console.log(`[Agentic] 🧪 Getting labs for patient: ${patientId}`);

    try {
        // First get the Healthie client ID from our database
        const conn = await connectSnowflake();
        const sql = `
      SELECT HEALTHIE_CLIENT_ID 
      FROM GMH_CLINIC.PATIENT_DATA.PATIENT_360_VIEW 
      WHERE PATIENT_ID = ? OR HEALTHIE_CLIENT_ID = ?
      LIMIT 1
    `;

        const rows: any[] = await new Promise((resolve, reject) => {
            conn.execute({
                sqlText: sql,
                binds: [patientId, patientId],
                complete: (err: any, stmt: any, rows: any) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            });
        });
        conn.destroy(() => { });

        const healthieId = rows[0]?.HEALTHIE_CLIENT_ID;
        if (!healthieId) {
            console.log(`[Agentic] ❌ Patient not found or no Healthie ID`);
            return JSON.stringify({ error: "Patient not found or no Healthie ID linked" });
        }

        // Query Healthie for lab orders
        const labQuery = `
      query GetLabOrders($user_id: ID!) {
        labOrders(user_id: $user_id, per_page: 5) {
          id
          created_at
          status
          lab { name }
          document { display_name }
        }
      }
    `;

        const labData = await fetchHealthieGraphQL<any>(labQuery, { user_id: healthieId });

        if (!labData?.labOrders?.length) {
            console.log(`[Agentic] ℹ️ No lab orders found`);
            return JSON.stringify({ message: "No lab orders found for this patient" });
        }

        console.log(`[Agentic] ✅ Found ${labData.labOrders.length} lab orders`);
        return JSON.stringify({ labs: labData.labOrders });
    } catch (error: any) {
        console.log(`[Agentic] ❌ Lab lookup failed: ${error.message}`);
        return JSON.stringify({ error: error.message });
    }
}

// ============================================================================
// TOOL: Send Email
// ============================================================================
async function toolSendEmail(to: string, subject: string, body: string): Promise<string> {
    console.log(`[Agentic] 📧 Sending email to: ${to}`);

    try {
        const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
        const ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-2' });

        const command = new SendEmailCommand({
            Source: process.env.SES_FROM_EMAIL || 'noreply@nowoptimal.com',
            Destination: { ToAddresses: [to] },
            Message: {
                Subject: { Data: subject },
                Body: {
                    Text: { Data: body },
                    Html: { Data: body.replace(/\n/g, '<br>') }
                }
            }
        });

        await ses.send(command);
        console.log(`[Agentic] ✅ Email sent successfully`);
        return JSON.stringify({ success: true, message: `Email sent to ${to}` });
    } catch (error: any) {
        console.log(`[Agentic] ❌ Email failed: ${error.message}`);
        return JSON.stringify({ error: error.message });
    }
}

// ============================================================================
// TOOL: Create Healthie Task
// ============================================================================
async function toolCreateHealthieTask(
    patientId: string,
    content: string,
    dueDate?: string
): Promise<string> {
    console.log(`[Agentic] ✅ Creating Healthie task for patient: ${patientId}`);

    try {
        const mutation = `
      mutation CreateTask($user_id: ID!, $content: String!, $due_date: String) {
        createTask(input: {
          user_id: $user_id
          content: $content
          due_date: $due_date
        }) {
          task {
            id
            content
            due_date
          }
          messages { field message }
        }
      }
    `;

        const result = await fetchHealthieGraphQL<any>(mutation, {
            user_id: patientId,
            content,
            due_date: dueDate
        });

        if (result?.createTask?.messages?.length) {
            console.log(`[Agentic] ❌ Task creation failed`);
            return JSON.stringify({ error: result.createTask.messages });
        }

        console.log(`[Agentic] ✅ Task created successfully`);
        return JSON.stringify({ success: true, task: result?.createTask?.task });
    } catch (error: any) {
        console.log(`[Agentic] ❌ Task creation failed: ${error.message}`);
        return JSON.stringify({ error: error.message });
    }
}
