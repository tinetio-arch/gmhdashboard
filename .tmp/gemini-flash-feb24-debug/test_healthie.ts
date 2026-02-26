import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config({ path: '.env.local' });

const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
if (!HEALTHIE_API_KEY) {
    console.error('HEALTHIE_API_KEY not configured');
    process.exit(1);
}

const headers = {
    'Authorization': `Basic ${HEALTHIE_API_KEY}`,
    'AuthorizationSource': 'API',
    'Content-Type': 'application/json',
};

async function testUpload(patientId: string) {
    try {
        console.log(`Testing with patient ID: ${patientId}`);
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

        console.log('Fetching existing folders...');
        const foldersResponse = await fetch('https://api.gethealthie.com/graphql', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                query: foldersQuery,
                variables: { client_id: patientId }
            }),
        });

        const foldersData = await foldersResponse.json();
        console.log('Folders response:', JSON.stringify(foldersData, null, 2));

        if (!foldersData.errors && foldersData.data?.folders) {
            const existingFolder = foldersData.data.folders.find((f: any) => f.name === FOLDER_NAME);
            if (existingFolder) {
                console.log(`Found existing folder: ${existingFolder.id}`);
                prescriptionsFolderId = existingFolder.id;
            }
        }

        // Create folder if it doesn't exist
        if (!prescriptionsFolderId) {
            console.log('Folder not found, attempting to create...');
            const createFolderMutation = `
                mutation CreateFolder($input: createFolderInput!) {
                    createFolder(input: $input) {
                        folder { id name }
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
                            share_with_rel: false
                        }
                    }
                }),
            });

            const createFolderData = await createFolderResponse.json();
            console.log('Create folder response:', JSON.stringify(createFolderData, null, 2));

            if (!createFolderData.errors && createFolderData.data?.createFolder?.folder?.id) {
                prescriptionsFolderId = createFolderData.data.createFolder.folder.id;
            } else {
                console.error(`Failed to create ${FOLDER_NAME} folder:`, createFolderData.errors || createFolderData.data?.createFolder?.messages);
            }
        }

        // Step 3: Create document in Healthie attached to the folder
        console.log('Attempting to create document...');
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

        // Create a dummy PDF base64 (empty PDF)
        const dummyPdfBase64 = "JVBERi0xLjcKCjEgMCBvYmogICUgZW50cnkgcG9pbnQKPDwKICAvVHlwZSAvQ2F0YWxvZwogIC9QYWdlcyAyIDAgUgo+PgplbmRvYmoKCjIgMCBvYmoKPDwKICAvVHlwZSAvUGFnZXMKICAvTWVkaWFCb3ggWyAwIDAgMjAwIDIwMCBdCiAgL0NvdW50IDEKICAvS2lkcyBbIDMgMCBSIF0KPj4KZW5kb2JqCgozIDAgb2JqCjwwCiAgL1R5cGUgL1BhZ2UKICAvUGFyZW50IDIgMCBSCiAgL1Jlc291cmNlcyA8PAogICAgL0ZvbnQgPDwKICAgICAgL0YxIDQgMCBSCj4+Cj4+CiAgL0NvbnRlbnRzIDUgMCBSCj4+CmVuZG9iagoKNCAwIG9iago8PAogIC9UeXBlIC9Gb250CiAgL1N1YnR5cGUgL1R5cGUxCiAgL0Jhc2VGb250IC9UaW1lcy1Sb21hbgo+PgplbmRvYmoKCjUgMCBvYmoKPDwgL0xlbmd0aCAzNiA+PgpzdHJlYW0KICBCVAogICAgL0YxIDE4IFRmCiAgICAwIDAgVGQKICAgIChUZXN0KSBUagogIEVUCmVuZHN0cmVhbQplbmRvYmoKCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxMCAwMDAwMCBuIAowMDAwMDAwMDYwIDAwMDAwIG4gCjAwMDAwMDAxNDkgMDAwMDAgbiAKMDAwMDAwMDI1OCAwMDAwMCBuIAowMDAwMDAwMzU0IDAwMDAwIG4gCnRyYWlsZXIKPDwKICAvU2l6ZSA2CiAgL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjQ0MgolJUVPRgo=";
        const dataUrl = `data:application/pdf;base64,${dummyPdfBase64}`;

        const documentInput: any = {
            rel_user_id: patientId,
            display_name: "test_upload.pdf",
            file_string: dataUrl,
            include_in_charting: true,
            share_with_rel: false,
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
        console.log('Create document response:', JSON.stringify(result, null, 2));

    } catch (err) {
        console.error('Error:', err);
    }
}

// Pass patient ID as arg, or use a default one for test (adjust as valid)
const pid = process.argv[2] || "34384";
testUpload(pid);
