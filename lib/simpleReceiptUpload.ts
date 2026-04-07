import { healthieGraphQL } from './healthieApi';
import { generateSimpleReceipt, type SimpleReceiptParams } from './pdf/simpleReceiptGenerator';

export interface SimpleReceiptUploadParams {
    healthieClientId: string;
    receiptNumber: string;
    date: Date;
    patientName: string;
    description: string;  // ACTUAL service description from the charge
    amount: number;
    paymentMethod: string;
    clinicName?: string;
    providerName?: string;
    isMensHealth?: boolean;  // Determines which clinic address to use
    isTestReceipt?: boolean;  // If true, receipt is NOT visible to patient (for testing)
}

/**
 * Generates a simple single-page receipt PDF and uploads it to patient's Healthie documents
 *
 * CRITICAL: The description parameter MUST contain the ACTUAL service purchased:
 * - For pelleting: "Pelleting Service"
 * - For peptides: The actual peptide product names
 * - For other services: Their specific descriptions
 *
 * DO NOT use hardcoded test data or default to peptide products
 */
export async function uploadSimpleReceiptToHealthie(params: SimpleReceiptUploadParams): Promise<string | null> {
    try {
        // Validate that we have an actual description (not hardcoded test data)
        if (!params.description || params.description.trim().length === 0) {
            console.error('[Simple Receipt Upload] ERROR: No description provided for receipt');
            return null;
        }

        // Log what we're actually putting on the receipt for audit trail
        console.log(`[Simple Receipt Upload] Creating receipt for ${params.patientName}`);
        console.log(`[Simple Receipt Upload] Service description: "${params.description}"`);
        console.log(`[Simple Receipt Upload] Amount: $${params.amount.toFixed(2)}`);
        if (params.isTestReceipt) {
            console.log(`[Simple Receipt Upload] ⚠️ TEST RECEIPT - Will NOT be visible to patient`);
        }

        // Generate the simple single-page receipt PDF
        const receiptParams: SimpleReceiptParams = {
            receiptNumber: params.receiptNumber,
            date: params.date,
            patientName: params.patientName,
            description: params.description,  // ACTUAL service from charge
            amount: params.amount,
            paymentMethod: params.paymentMethod,
            clinicName: params.clinicName || 'NOW Optimal Health',
            providerName: params.providerName,
            isMensHealth: params.isMensHealth || false
        };

        const pdfBuffer = await generateSimpleReceipt(receiptParams);

        // Convert to base64 data URL for Healthie
        const base64Content = pdfBuffer.toString('base64');
        const dataUrl = `data:application/pdf;base64,${base64Content}`;

        // Format filename
        const dateStr = params.date.toISOString().split('T')[0];
        const patientNameSafe = params.patientName.replace(/[^a-zA-Z0-9]/g, '_');
        const testPrefix = params.isTestReceipt ? 'TEST_' : '';
        const filename = `${testPrefix}Receipt_${params.receiptNumber}_${patientNameSafe}_${dateStr}.pdf`;

        // Upload to Healthie - TEST receipts are NOT visible to patients
        const result = await healthieGraphQL(`
            mutation CreateDocument($input: createDocumentInput!) {
                createDocument(input: $input) {
                    document {
                        id
                        display_name
                    }
                    messages {
                        field
                        message
                    }
                }
            }
        `, {
            input: {
                rel_user_id: String(params.healthieClientId),
                display_name: filename,
                file_string: dataUrl,
                include_in_charting: true,
                share_with_rel: !params.isTestReceipt,  // TEST receipts NOT visible to patient
                description: `${params.isTestReceipt ? 'TEST - ' : ''}Payment Receipt - ${params.date.toLocaleDateString('en-US')} - Total: $${params.amount.toFixed(2)}`
            }
        });

        const documentId = result?.createDocument?.document?.id;

        if (documentId) {
            console.log(`[Simple Receipt Upload] SUCCESS: Uploaded receipt ${params.receiptNumber} to Healthie document ${documentId}`);
            console.log(`[Simple Receipt Upload] Patient: ${params.patientName}, Service: "${params.description}"`);
            return documentId;
        } else {
            const errors = result?.createDocument?.messages || [];
            console.error('[Simple Receipt Upload] Failed to upload receipt:', errors);
            return null;
        }
    } catch (error) {
        console.error('[Simple Receipt Upload] Error uploading receipt to Healthie:', error);
        return null;
    }
}