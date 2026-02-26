const fetch = require('node-fetch'); // Assuming node-fetch is available or using built-in in recent Node

const BASE_URL = 'http://localhost:3001';
const WEBHOOK_SECRET = '960dd12a02e4b618c81ae04b334b03094dc2edbb6d591b1fa3791711932e51ec';

async function testEndpoint(name, path, payload) {
    console.log(`\n--- Testing ${name} ---`);
    try {
        const response = await fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-webhook-secret': WEBHOOK_SECRET
            },
            body: JSON.stringify(payload)
        });

        const status = response.status;
        const text = await response.text();
        console.log(`Status: ${status}`);

        let json;
        try {
            json = JSON.parse(text);
            console.log('Response:', JSON.stringify(json, null, 2));
        } catch (e) {
            console.log('Raw Response:', text);
        }

        return { status, json };
    } catch (e) {
        console.error(`Error testing ${name}:`, e.message);
        return { error: e };
    }
}

async function runTests() {
    const timestamp = Date.now();
    const testPhone = `+1928555${timestamp.toString().slice(-4)}`; // Unique phone with +1
    const testEmail = `test${timestamp}@example.com`;

    console.log(`Test Phone: ${testPhone}`);

    // 1. Create Patient
    const createRes = await testEndpoint('Create Patient', '/api/ghl/create-new-patient', {
        first_name: "Harness",
        last_name: "TestUser",
        phone: testPhone,
        email: testEmail,
        dob: "1990-01-01",
        service_line: "PrimaryCare"
    });

    if (createRes.json && createRes.json.success) {
        const healthieId = createRes.json.healthie_patient_id;
        console.log(`\n✅ GHL Creation Success! Healthie ID: ${healthieId}`);

        if (!healthieId) {
            console.error('\n❌ CRITICAL: Healthie ID is missing! Healthie integration failed.');
            // Proceed anyway to see other failures
        }

        // 2. Verify Patient
        await testEndpoint('Verify Patient', '/api/ghl/verify-patient', {
            phone: testPhone,
            dob: "1990-01-01"
        });

        // 3. Get Availability
        await testEndpoint('Get Availability', '/api/ghl/get-availability', {
            service_line: "PrimaryCare",
            appointment_type: "Sick Visit"
        });

        // 4. Book Appointment (Only if Healthie ID exists?)
        console.log('\n⏳ Waiting 5s for GHL Indexing...');
        await new Promise(r => setTimeout(r, 5000));
        await testEndpoint('Book Appointment', '/api/ghl/book-appointment', {
            phone: testPhone,
            appointment_type: "Sick Visit",
            first_name: "Harness",
            last_name: "TestUser",
            email: testEmail,
            reason: "End-to-end test",
            slot_id: "2026-01-08_10:00" // Mock slot
        });

    } else {
        console.error('\n❌ GHL Creation Failed. Aborting dependent tests.');
    }

    // 5. Refill Request (Independent)
    await testEndpoint('Refill Request', '/api/ghl/request-prescription-refill', {
        patient_phone: testPhone,
        medication: "TestMeds",
        pharmacy: "TestRx",
        urgent: "true",
        notes: "Test Webhook"
    });

    // 6. Transfer (Independent)
    await testEndpoint('Transfer Call', '/api/ghl/transfer-call', {
        phone: testPhone,
        department: "MensHealth"
    });
}

runTests();
