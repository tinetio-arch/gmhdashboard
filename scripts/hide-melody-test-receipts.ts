#!/usr/bin/env npx tsx

/**
 * Script to hide/delete test receipts for Melody Smith
 * Makes them invisible to the patient
 */

import { healthieGraphQL } from '../lib/healthieApi';
import { query } from '../lib/db';

async function hideTestReceipts() {
    console.log('\n=== Hiding Test Receipts for Melody Smith ===\n');

    try {
        // Find Melody's Healthie client ID
        const patients = await query<{
            patient_id: string;
            full_name: string;
        }>(
            `SELECT p.patient_id, p.full_name, hc.healthie_client_id
             FROM patients p
             LEFT JOIN healthie_clients hc ON p.patient_id::text = hc.patient_id
             WHERE p.full_name ILIKE '%melody%smith%'
             LIMIT 1`
        );

        if (patients.length === 0) {
            console.log('Melody Smith not found');
            return;
        }

        const patient = patients[0];
        console.log(`Found: ${patient.full_name}`);
        console.log(`Healthie Client ID: ${patient.healthie_client_id || 'Not found'}`);

        // Known document IDs that were uploaded during testing
        const testDocumentIds = [
            '60345429',  // First incorrect test with peptides
            '60360152'   // Second test with pelleting (but still a test)
        ];

        console.log('\n=== Attempting to Update Document Visibility ===');

        for (const docId of testDocumentIds) {
            try {
                console.log(`\nUpdating document ${docId} to be invisible to patient...`);

                // Try to update the document to make it not visible to patient
                const updateResult = await healthieGraphQL(`
                    mutation UpdateDocument($input: updateDocumentInput!) {
                        updateDocument(input: $input) {
                            document {
                                id
                                display_name
                                shared_with_patient
                            }
                            messages {
                                field
                                message
                            }
                        }
                    }
                `, {
                    input: {
                        id: docId,
                        share_with_rel: false,  // Make it NOT visible to patient
                        display_name: `TEST_HIDDEN_Receipt_${docId}`
                    }
                });

                if (updateResult?.updateDocument?.document) {
                    console.log(`✅ Successfully updated document ${docId}`);
                    console.log(`   Name: ${updateResult.updateDocument.document.display_name}`);
                    console.log(`   Visible to patient: ${updateResult.updateDocument.document.shared_with_patient}`);
                } else if (updateResult?.updateDocument?.messages) {
                    console.log(`⚠️ Could not update document ${docId}:`);
                    console.log('   Messages:', updateResult.updateDocument.messages);
                } else {
                    console.log(`❌ Failed to update document ${docId}`);
                }
            } catch (error) {
                console.error(`Error updating document ${docId}:`, error.message);

                // If update fails, try to delete it
                console.log(`Attempting to delete document ${docId}...`);
                try {
                    const deleteResult = await healthieGraphQL(`
                        mutation DeleteDocument($input: deleteDocumentInput!) {
                            deleteDocument(input: $input) {
                                document {
                                    id
                                }
                                messages {
                                    field
                                    message
                                }
                            }
                        }
                    `, {
                        input: {
                            id: docId
                        }
                    });

                    if (deleteResult?.deleteDocument?.document) {
                        console.log(`✅ Successfully deleted document ${docId}`);
                    } else {
                        console.log(`❌ Could not delete document ${docId}`);
                        if (deleteResult?.deleteDocument?.messages) {
                            console.log('   Messages:', deleteResult.deleteDocument.messages);
                        }
                    }
                } catch (deleteError) {
                    console.error(`Error deleting document ${docId}:`, deleteError.message);
                }
            }
        }

        console.log('\n=== Summary ===');
        console.log('Test receipts have been processed.');
        console.log('If they could not be hidden or deleted, they may need manual removal in Healthie.');
        console.log('\nIMPORTANT: Future test receipts will use isTestReceipt: true to prevent visibility');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit(0);
    }
}

hideTestReceipts();