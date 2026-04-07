import { healthieGraphQL } from './healthieApi';
import { generateReceiptPdf, type ReceiptPdfParams } from './pdf/receiptPdfGenerator';

export interface ReceiptUploadParams {
    healthieClientId: string;
    receiptData: ReceiptPdfParams;
}

/**
 * Generates a receipt PDF and uploads it to the patient's Healthie documents
 * Returns the Healthie document ID if successful
 */
export async function uploadReceiptToHealthie(params: ReceiptUploadParams): Promise<string | null> {
    try {
        // Generate the receipt PDF
        const pdfBuffer = await generateReceiptPdf(params.receiptData);

        // Convert to base64 data URL for Healthie
        const base64Content = pdfBuffer.toString('base64');
        const dataUrl = `data:application/pdf;base64,${base64Content}`;

        // Format filename
        const dateStr = params.receiptData.transactionDate.toISOString().split('T')[0];
        const patientNameSafe = params.receiptData.patientName.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `Receipt_${params.receiptData.receiptNumber}_${patientNameSafe}_${dateStr}.pdf`;

        // Upload to Healthie as a patient-visible document
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
                share_with_rel: true, // Makes it visible to the patient
                description: `Payment Receipt - ${params.receiptData.transactionDate.toLocaleDateString('en-US')} - Total: $${params.receiptData.total.toFixed(2)}`
            }
        });

        const documentId = result?.createDocument?.document?.id;

        if (documentId) {
            console.log(`[Receipt Upload] Successfully uploaded receipt ${params.receiptData.receiptNumber} to Healthie document ${documentId} for patient ${params.receiptData.patientName}`);
            return documentId;
        } else {
            const errors = result?.createDocument?.messages || [];
            console.error('[Receipt Upload] Failed to upload receipt:', errors);
            return null;
        }
    } catch (error) {
        console.error('[Receipt Upload] Error uploading receipt to Healthie:', error);
        return null;
    }
}

/**
 * Helper function to format receipt items from product data
 */
export function formatReceiptItems(products: Array<{
    name: string;
    quantity: number;
    price: number;
}>): Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
}> {
    return products.map(product => ({
        name: product.name,
        quantity: product.quantity,
        unitPrice: product.price,
        total: product.price * product.quantity
    }));
}