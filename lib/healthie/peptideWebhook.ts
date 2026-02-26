/**
 * Peptide Purchase Webhook Handler
 * 
 * Handles billing_item.created events from Healthie to auto-create
 * "Pending" dispense records when patients purchase peptides.
 * 
 * Workflow:
 * 1. Receive billing_item.created webhook (thin payload)
 * 2. Fetch full BillingItem details from Healthie GraphQL
 * 3. Check if offering/product is a peptide (by healthie_product_id)
 * 4. Create dispense with status="Pending", education_complete=false
 * 5. Staff marks Paid + Education when patient picks up
 */

import { query } from '@/lib/db';
import { HealthieClient } from '@/lib/healthie';

// Initialize Healthie client
function getHealthieClient() {
    const apiKey = process.env.HEALTHIE_API_KEY;
    if (!apiKey) throw new Error('HEALTHIE_API_KEY not set');
    return new HealthieClient({ apiKey });
}

/**
 * GraphQL query to fetch BillingItem details including offering (product) info
 */
const BILLING_ITEM_QUERY = `
  query GetBillingItem($id: ID!) {
    billingItem(id: $id) {
      id
      amount_paid
      created_at
      recipient {
        id
        first_name
        last_name
        email
      }
      offering {
        id
        name
        billing_frequency
      }
    }
  }
`;

interface BillingItemResponse {
    billingItem: {
        id: string;
        amount_paid: string;
        created_at: string;
        recipient: {
            id: string;
            first_name: string;
            last_name: string;
            email: string;
        } | null;
        offering: {
            id: string;
            name: string;
            billing_frequency: string;
        } | null;
    } | null;
}

/**
 * Process a billing_item.created webhook event
 * Creates a pending dispense if the item is a peptide product
 */
export async function handleBillingItemCreated(resourceId: string): Promise<{
    processed: boolean;
    dispenseCreated: boolean;
    productName?: string;
    patientName?: string;
    error?: string;
}> {
    try {
        // Fetch full billing item details from Healthie
        const client = getHealthieClient();
        const response = await client.graphql<BillingItemResponse>(BILLING_ITEM_QUERY, { id: resourceId });

        const billingItem = response?.billingItem;
        if (!billingItem) {
            return { processed: true, dispenseCreated: false, error: 'BillingItem not found' };
        }

        const offering = billingItem.offering;
        if (!offering) {
            return { processed: true, dispenseCreated: false, error: 'No offering attached' };
        }

        // Check if this offering is a peptide product by matching healthie_product_id
        const peptideMatch = await query<{ product_id: string; name: string }>(
            `SELECT product_id, name FROM peptide_products WHERE healthie_product_id = $1`,
            [offering.id]
        );

        if (!peptideMatch || peptideMatch.length === 0) {
            // Not a peptide product, skip
            return { processed: true, dispenseCreated: false };
        }

        const peptideProduct = peptideMatch[0];
        const recipient = billingItem.recipient;

        if (!recipient) {
            return { processed: true, dispenseCreated: false, error: 'No recipient on billing item' };
        }

        const patientName = `${recipient.first_name || ''} ${recipient.last_name || ''}`.trim();

        // Check for duplicate (same patient, product, on same day)
        const today = new Date().toISOString().split('T')[0];
        const existing = await query<{ sale_id: string }>(
            `SELECT sale_id FROM peptide_dispenses 
       WHERE product_id = $1 AND patient_name = $2 AND sale_date = $3`,
            [peptideProduct.product_id, patientName, today]
        );

        if (existing && existing.length > 0) {
            return {
                processed: true,
                dispenseCreated: false,
                productName: peptideProduct.name,
                patientName,
                error: 'Duplicate dispense for today'
            };
        }

        // Create pending dispense
        await query(
            `INSERT INTO peptide_dispenses (
        product_id, quantity, patient_name, sale_date, order_date,
        status, education_complete, paid, healthie_billing_item_id, notes
      ) VALUES ($1, 1, $2, $3, $3, 'Pending', false, false, $4, $5)`,
            [
                peptideProduct.product_id,
                patientName,
                today,
                resourceId,
                `Auto-created from Healthie purchase (Billing Item: ${resourceId})`
            ]
        );

        console.log(`[Peptide Webhook] Created pending dispense: ${patientName} - ${peptideProduct.name}`);

        return {
            processed: true,
            dispenseCreated: true,
            productName: peptideProduct.name,
            patientName,
        };

    } catch (error) {
        console.error('[Peptide Webhook] Error processing billing_item.created:', error);
        return {
            processed: false,
            dispenseCreated: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
