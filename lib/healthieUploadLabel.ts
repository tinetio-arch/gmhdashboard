/**
 * Healthie Document Upload Utility
 * Pushes generated prescription labels directly to a patient's Healthie chart
 */
export async function uploadLabelToHealthie(patientId: string, pdfBuffer: Buffer, filename: string): Promise<string | null> {
    const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
    if (!HEALTHIE_API_KEY) {
        console.error('HEALTHIE_API_KEY not configured');
        return null; // Fail gracefully if API key is missing
    }

    const headers = {
        'Authorization': `Basic ${HEALTHIE_API_KEY}`,
        'AuthorizationSource': 'API',
        'Content-Type': 'application/json',
    };

    try {
        // Step 1: Find or Create the 'Prescriptions' folder
        let prescriptionsFolderId: string | null = null;
        const FOLDER_NAME = 'Prescriptions';

        const foldersQuery = `
            query getFolders($client_id: String) {
                folders(client_id: $client_id) {
                    id
                    name
                }
            }
        `;

        const foldersResponse = await fetch('https://api.gethealthie.com/graphql', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                query: foldersQuery,
                variables: { client_id: patientId }
            }),
        });

        const foldersData = await foldersResponse.json();

        if (!foldersData.errors && foldersData.data?.folders) {
            const existingFolder = foldersData.data.folders.find((f: any) => f.name === FOLDER_NAME);
            if (existingFolder) {
                prescriptionsFolderId = existingFolder.id;
            }
        }

        // Create folder if it doesn't exist
        if (!prescriptionsFolderId) {
            const createFolderMutation = `
                mutation CreateFolder($input: createFolderInput!) {
                    createFolder(input: $input) {
                        folder { id }
                        messages { field message }
                    }
                }
            `;

            const createFolderResponse = await fetch('https://api.gethealthie.com/graphql', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    query: createFolderMutation,
                    variables: {
                        input: {
                            name: FOLDER_NAME,
                            rel_user_id: patientId,
                            share_with_rel: false // Ensure the folder itself is hidden from the patient
                        }
                    }
                }),
            });

            const createFolderData = await createFolderResponse.json();
            if (!createFolderData.errors && createFolderData.data?.createFolder?.folder?.id) {
                prescriptionsFolderId = createFolderData.data.createFolder.folder.id;
            } else {
                console.error(`Failed to create ${FOLDER_NAME} folder:`, createFolderData.errors || createFolderData.data?.createFolder?.messages);
                // We don't abort here; we'll just upload to the root if folder creation fails
            }
        }

        // Step 2: Base64 encode the PDF with data URL prefix
        const base64Content = pdfBuffer.toString('base64');
        const dataUrl = `data:application/pdf;base64,${base64Content}`;

        // Step 3: Create document in Healthie attached to the folder
        const mutation = `
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
        `;

        const documentInput: any = {
            rel_user_id: patientId,
            display_name: filename,
            file_string: dataUrl,
            include_in_charting: true,
            share_with_rel: false, // Ensures patients cannot see the generated prescription pdf
            description: 'System-Generated Prescription Label',
        };

        if (prescriptionsFolderId) {
            documentInput.folder_id = prescriptionsFolderId;
        }

        const response = await fetch('https://api.gethealthie.com/graphql', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                query: mutation,
                variables: {
                    input: documentInput
                }
            }),
        });

        const result = await response.json();

        if (result.errors || result.data?.createDocument?.messages?.length > 0) {
            console.error('Healthie createDocument error:', result.errors || result.data?.createDocument?.messages);
            return null;
        }

        return result.data?.createDocument?.document?.id || null;
    } catch (err) {
        console.error('Network error uploading label to Healthie:', err);
        return null;
    }
}
