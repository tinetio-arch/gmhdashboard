/**
 * Test charge: $1.00 to Phil Schafer (philschafer7@gmail.com) with description "pelleting".
 * Exercises the real billing flow including the new cleanReceiptDescription helper.
 * Approved by user 2026-04-15.
 *
 * SAFETY: Hardcoded to email philschafer7@gmail.com — refuses to run otherwise.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/home/ec2-user/gmhdashboard/.env.local' });

import { healthieGraphQL } from '@/lib/healthieApi';
import { cleanReceiptDescription } from '@/lib/billing/cleanReceiptDescription';
import { uploadSimpleReceiptToHealthie } from '@/lib/pdf/simpleReceiptGenerator';

const HEALTHIE_ID = '12123979';   // Phillip Schafer
const REQUIRED_EMAIL = 'philschafer7@gmail.com';
const AMOUNT = 1.00;
const RAW_DESCRIPTION = 'pelleting';

async function main() {
    // Safety: confirm we're hitting the right account.
    const u = await healthieGraphQL<any>(
        `query GetUser($id: ID!) { user(id: $id) { id full_name email } }`,
        { id: HEALTHIE_ID }
    );
    const email = u?.user?.email || '';
    const name = u?.user?.full_name || '';
    if (email.toLowerCase() !== REQUIRED_EMAIL) {
        console.error(`SAFETY HALT: expected ${REQUIRED_EMAIL}, got "${email}" — aborting.`);
        process.exit(1);
    }
    console.log(`Target verified: ${name} (${email}) Healthie #${HEALTHIE_ID}`);

    // Confirm a card is on file (otherwise Healthie would just create an unpaid invoice)
    const cardCheck = await healthieGraphQL<any>(
        `query Cards($id: ID!) { user(id: $id) { stripe_customer_details { stripe_id } } }`,
        { id: HEALTHIE_ID }
    );
    const stripeId = cardCheck?.user?.stripe_customer_details?.[0]?.stripe_id || null;
    console.log(`Stripe customer: ${stripeId || '(none on file — billing item will be unpaid)'}`);

    const cleaned = cleanReceiptDescription(RAW_DESCRIPTION);
    console.log(`Description raw: ${JSON.stringify(RAW_DESCRIPTION)} → cleaned: ${JSON.stringify(cleaned)}`);

    // Step 1: Create the Healthie billing item via PRODUCTION lib (same path iPad uses)
    console.log(`\nCreating Healthie billing item for $${AMOUNT.toFixed(2)} via production lib...`);
    const { createHealthieClient } = await import('@/lib/healthie');
    const healthie = createHealthieClient();
    if (!healthie) { console.error('Healthie client not configured'); process.exit(1); }
    const billingItem = await healthie.createBillingItem({
        client_id: HEALTHIE_ID,
        amount: AMOUNT,
        description: RAW_DESCRIPTION,
    });
    console.log(`Billing item ${billingItem.id} created — state: ${billingItem.state}`);
    console.log(`  amount_paid: ${billingItem.amount_paid}`);

    // Step 2: Generate + upload receipt PDF
    const receiptNumber = `RCP-${Date.now()}-TEST${Math.random().toString(36).substring(7).toUpperCase()}`;
    console.log(`\nGenerating receipt ${receiptNumber}...`);
    const documentId = await uploadSimpleReceiptToHealthie({
        healthieClientId: HEALTHIE_ID,
        receiptNumber,
        date: new Date(),
        patientName: name,
        description: cleaned, // ← cleaned for patient display
        amount: AMOUNT,
        paymentMethod: 'Credit Card (Healthie)',
        clinicName: 'NOW Optimal Health',
        providerName: 'NOW Optimal Staff',
        isMensHealth: false,
    });
    console.log(`Receipt PDF uploaded to Healthie chart as document #${documentId}`);

    // Step 3: Pull the document back to confirm
    const doc = await healthieGraphQL<any>(
        `query Doc($id: ID!) { document(id: $id) { id display_name file_content_type expiring_url created_at shared } }`,
        { id: String(documentId) }
    );
    console.log('\nDocument record:');
    console.log(JSON.stringify(doc?.document, null, 2));

    console.log('\nDONE. Verify in Phil\'s Healthie chart that the receipt PDF appears with description "Pelleting" (cleaned from "pelleting").');
    process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
