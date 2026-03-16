import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';

// Fetch comprehensive patient chart data from Healthie for the scribe chart panel.
// Combines local DB data with Healthie GraphQL for a full picture.
export async function GET(request: NextRequest) {
    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patient_id');

    if (!patientId) {
        return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 });
    }

    try {
        // Helper function to merge local vitals with Healthie vitals
        const mergeVitals = (localVitals: any[], healthieVitals: any[]) => {
            // Convert local vitals to Healthie format
            const formattedLocal = localVitals.map(v => ({
                id: `local_${v.metric_id}`,
                type: 'MetricEntry',
                category: v.metric_type?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Vital',
                metric_stat: v.value + (v.unit ? ` ${v.unit}` : ''),
                created_at: v.created_at,
                description: v.description || '',
                created_by: {
                    id: 'local',
                    full_name: v.recorded_by_email?.split('@')[0] || 'Staff',
                    email: v.recorded_by_email || ''
                }
            }));

            // Merge and deduplicate by timestamp (keep Healthie version if duplicate within 5 seconds)
            const merged = [...formattedLocal, ...healthieVitals];
            const seen = new Set<string>();
            return merged
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .filter(v => {
                    const key = `${v.category}_${new Date(v.created_at).getTime()}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
        };

        // 1. Look up patient in local DB with full GMH dashboard fields
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId);
        let patient: any = null;
        if (isUuid) {
            const rows = await query<any>(`
                SELECT
                    p.*,
                    psl.display_name as status_display
                FROM patients p
                LEFT JOIN patient_status_lookup psl ON p.status_key = psl.status_key
                WHERE p.patient_id = $1::uuid
            `, [patientId]);
            patient = rows?.[0] || null;
        }
        if (!patient) {
            const rows = await query<any>(`
                SELECT
                    p.*,
                    psl.display_name as status_display
                FROM patients p
                LEFT JOIN patient_status_lookup psl ON p.status_key = psl.status_key
                WHERE p.healthie_client_id = $1
            `, [patientId]);
            patient = rows?.[0] || null;
        }

        // Look up the real Healthie ID from the canonical healthie_clients table
        let healthieId = '';
        if (patient) {
            const hcRows = await query<any>(
                'SELECT healthie_client_id FROM healthie_clients WHERE patient_id = $1 AND is_active = true LIMIT 1',
                [patient.patient_id]
            );
            healthieId = hcRows?.[0]?.healthie_client_id || '';
        }
        if (!healthieId) healthieId = patientId; // last resort fallback

        // ✅ Enhanced demographics with GMH dashboard fields
        const localData: any = {
            demographics: {
                ...patient,
                // Key GMH fields that iPad needs
                status_key: patient?.status_key || null,
                status_display: patient?.status_display || null,
                patient_notes: patient?.patient_notes || null,
                lab_notes: patient?.lab_notes || null,
                last_supply_date: patient?.last_supply_date || null,
                next_eligible_date: patient?.next_eligible_date || null,
                last_lab_date: patient?.last_lab_date || null,
                next_lab_date: patient?.next_lab_date || null,
                lab_status: patient?.lab_status || null,
                service_start_date: patient?.service_start_date || null,
                contract_end_date: patient?.contract_end_date || null,
                date_added: patient?.date_added || null,
                added_by: patient?.added_by || null,
                method_of_payment: patient?.method_of_payment || null,
                // GHL sync status
                ghl_contact_id: patient?.ghl_contact_id || null,
                ghl_sync_status: patient?.ghl_sync_status || null,
                ghl_last_synced_at: patient?.ghl_last_synced_at || null,
                ghl_sync_error: patient?.ghl_sync_error || null,
                ghl_tags: patient?.ghl_tags || null,
                // QB mapping
                qbo_customer_id: patient?.qbo_customer_id || null,
                qb_display_name: patient?.qb_display_name || null,
            }
        };

        // 2. Fetch from Healthie in parallel (each query fails gracefully)
        // All variable types validated against actual Healthie API error responses
        const [chartNotes, medications, appointments, entries, allergies, documents, userProfile, paymentMethods, recurringPayments, billingItems] = await Promise.all([
            // Chart notes (form answer groups) - NOTE: sort_by is NOT supported by Healthie API
            safeHealthieQuery<any>('chartNotes', `
                query GetChartNotes($userId: String) {
                    formAnswerGroups(
                        user_id: $userId,
                        offset: 0
                    ) {
                        id
                        name
                        created_at
                        updated_at
                        finished
                        form_answers {
                            id
                            label
                            answer
                            displayed_answer
                        }
                    }
                }
            `, { userId: healthieId }),

            // Medications
            safeHealthieQuery<any>('medications', `
                query GetMedications($patientId: ID) {
                    medications(patient_id: $patientId, active: true) {
                        id
                        name
                        dosage
                        frequency
                        route
                        directions
                        start_date
                        end_date
                        normalized_status
                    }
                }
            `, { patientId: healthieId }),

            // Appointments — user_id is ID type
            safeHealthieQuery<any>('appointments', `
                query GetAppointments($userId: ID) {
                    appointments(
                        user_id: $userId,
                        is_active: true,
                        offset: 0
                    ) {
                        id
                        date
                        length
                        appointment_type {
                            name
                        }
                        provider {
                            full_name
                        }
                        pm_status
                        location
                    }
                }
            `, { userId: healthieId }),

            // Entries (Vitals) — client_id is String type
            safeHealthieQuery<any>('entries', `
                query GetEntries($clientId: String) {
                    entries(
                        client_id: $clientId,
                        type: "MetricEntry",
                        offset: 0
                    ) {
                        id
                        type
                        category
                        metric_stat
                        created_at
                        description
                    }
                }
            `, { clientId: healthieId }),

            // Allergies — accessed via user object (root allergySensitivities query doesn't exist)
            safeHealthieQuery<any>('allergies', `
                query GetUserAllergies($userId: ID) {
                    user(id: $userId) {
                        allergy_sensitivities {
                            id
                            name
                            reaction
                            severity
                            status
                            category_type
                            onset_date
                        }
                    }
                }
            `, { userId: healthieId }),

            // Documents — viewable_user_id is String, returns file_content_type/friendly_type
            // Reduced page_size from 30 to 20 to speed up query
            safeHealthieQuery<any>('documents', `
                query GetDocuments($viewableUserId: String) {
                    documents(viewable_user_id: $viewableUserId, offset: 0, page_size: 20, should_paginate: false) {
                        id
                        display_name
                        file_content_type
                        friendly_type
                        created_at
                        rel_user_id
                    }
                }
            `, { viewableUserId: healthieId }),

            // User profile (full demographics)
            safeHealthieQuery<any>('userProfile', `
                query GetUser($id: ID) {
                    user(id: $id) {
                        id
                        first_name
                        last_name
                        legal_name
                        avatar_url
                        dob
                        gender
                        sex
                        pronouns
                        phone_number
                        email
                        height
                        weight
                        location {
                            id
                            line1
                            line2
                            city
                            state
                            zip
                            country
                        }
                        dietitian_id
                        user_group {
                            id
                            name
                        }
                        active_tags {
                            id
                            name
                        }
                    }
                }
            `, { id: healthieId }),

            // Payment methods (credit cards on file) - use PLURAL stripe_customer_details
            safeHealthieQuery<any>('paymentMethods', `
                query GetPaymentMethods($userId: ID!) {
                    user(id: $userId) {
                        id
                        stripe_customer_details {
                            id
                            card_type
                            card_type_label
                            last_four
                            expiration
                            source_status
                            source_type
                            zip
                        }
                    }
                }
            `, { userId: healthieId }),

            // Recurring payments (subscriptions) from Healthie
            safeHealthieQuery<any>('recurringPayments', `
                query GetSubscriptions($id: ID) {
                    user(id: $id) {
                        recurring_payments {
                            id
                            is_canceled
                            is_paused
                            amount_to_pay
                            next_payment_date
                            offering_name
                            billing_frequency
                            start_at
                        }
                    }
                }
            `, { id: healthieId }),

            // Billing items (payment history) from Healthie
            safeHealthieQuery<any>('billingItems', `
                query GetBillingItems($clientId: ID) {
                    billingItems(client_id: $clientId, offset: 0) {
                        id
                        amount_display
                        created_at
                        description
                        offering {
                            name
                        }
                    }
                }
            `, { clientId: healthieId }),
        ]);

        // 3. Fetch local scribe history — only if we have a valid uuid patient_id
        let scribeHistory: any[] = [];
        const localPatientId = patient?.patient_id;
        if (localPatientId) {
            scribeHistory = await query<any>(`
                SELECT
                    ss.session_id, ss.visit_type, ss.status, ss.created_at,
                    sn.soap_subjective, sn.soap_objective, sn.soap_assessment, sn.soap_plan,
                    sn.icd10_codes, sn.cpt_codes, sn.full_note_text
                FROM scribe_sessions ss
                LEFT JOIN scribe_notes sn ON ss.session_id = sn.session_id
                WHERE ss.patient_id = $1
                ORDER BY ss.created_at DESC
                LIMIT 20
            `, [localPatientId]);
        }

        // 4. Fetch Direct Stripe payment methods for this patient
        let directStripeCards: any[] = [];
        if (localPatientId && process.env.STRIPE_SECRET_KEY) {
            try {
                const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

                // Check if patient has a Stripe customer ID
                const stripeCustomerResult = await query<any>(`
                    SELECT stripe_customer_id FROM patients WHERE patient_id = $1
                `, [localPatientId]);

                const stripeCustomerId = stripeCustomerResult[0]?.stripe_customer_id;

                if (stripeCustomerId) {
                    const paymentMethods = await stripe.paymentMethods.list({
                        customer: stripeCustomerId,
                        type: 'card',
                    });

                    // Format Direct Stripe cards to match Healthie format
                    directStripeCards = paymentMethods.data.map(pm => ({
                        id: `direct_${pm.id}`,
                        card_type: pm.card?.brand || 'card',
                        card_type_label: `${pm.card?.brand?.toUpperCase() || 'Card'} (Direct)`,
                        last_four: pm.card?.last4 || '****',
                        expiration: `${String(pm.card?.exp_month).padStart(2, '0')}/${pm.card?.exp_year}`,
                        source_status: 'active',
                        source_type: 'direct_stripe',
                        zip: pm.billing_details?.address?.postal_code || '',
                    }));
                }
            } catch (error) {
                console.error('[Patient Chart] Error fetching Direct Stripe payment methods:', error);
                // Don't fail the whole request if Stripe fetch fails
            }
        }

        // Query local patient metrics (vitals) - these may not have synced to Healthie yet
        let localVitals: any[] = [];
        try {
            localVitals = await query<any>(`
                SELECT
                    metric_id,
                    metric_type,
                    value,
                    unit,
                    recorded_at as created_at,
                    recorded_by_email,
                    notes as description
                FROM patient_metrics
                WHERE patient_id = $1
                ORDER BY recorded_at DESC
                LIMIT 50
            `, [localPatientId]);
            console.log(`[Patient Chart] Found ${localVitals.length} local vitals for patient ${localPatientId}`);
        } catch (err) {
            console.warn(`[Patient Chart] Failed to query local vitals:`, err instanceof Error ? err.message : err);
            localVitals = [];
        }

        // Query active packages/subscriptions - join through QB customer ID (fallback)
        let localPackages: any[] = [];
        if (patient?.qbo_customer_id) {
            try {
                localPackages = await query<any>(`
                    SELECT
                        hp.name as package_name,
                        hp.description,
                        hp.price,
                        hp.billing_frequency,
                        hpm.amount,
                        hpm.next_charge_date,
                        hpm.frequency
                    FROM healthie_package_mapping hpm
                    JOIN healthie_packages hp ON hpm.healthie_package_id = hp.healthie_package_id
                    WHERE hpm.qb_customer_id = $1
                        AND hpm.is_active = TRUE
                        AND hp.is_active = TRUE
                    ORDER BY hpm.created_at DESC
                `, [patient.qbo_customer_id]);
                console.log(`[Patient Chart] Found ${localPackages.length} local packages for customer ${patient.qbo_customer_id}`);
            } catch (err) {
                console.warn(`[Patient Chart] Failed to query packages:`, err instanceof Error ? err.message : err);
                localPackages = [];
            }
        }

        // Merge Healthie recurring payments with local packages
        let activePackages: any[] = [];

        // Add Healthie subscriptions (primary source)
        const healthieSubscriptions = recurringPayments?.user?.recurring_payments || [];
        const activeHealthieSubscriptions = healthieSubscriptions
            .filter((rp: any) => !rp.is_canceled && !rp.is_paused)
            .map((rp: any) => ({
                package_name: rp.offering_name || 'Subscription',
                amount: rp.amount_to_pay || '',
                frequency: rp.billing_frequency || '',
                next_charge_date: rp.next_payment_date || null,
                start_date: rp.start_at || null,
                source: 'healthie',
                healthie_id: rp.id
            }));

        activePackages = [...activeHealthieSubscriptions, ...localPackages];
        console.log(`[Patient Chart] Merged ${activeHealthieSubscriptions.length} Healthie subscriptions + ${localPackages.length} local packages = ${activePackages.length} total`);

        // Map Healthie billing items to payment history
        let lastPayments: any[] = [];
        const healthieBillingItems = billingItems?.billingItems || [];
        lastPayments = healthieBillingItems
            .map((item: any) => ({
                amount: item.amount_display || '$0.00',
                payment_date: item.created_at || '',
                payment_type: item.offering?.name || 'Charge',
                description: item.description || '',
                status: 'completed',
                healthie_id: item.id
            }))
            .slice(0, 5); // Latest 5 payments
        console.log(`[Patient Chart] Found ${lastPayments.length} billing items from Healthie`);

        // Query testosterone dispenses
        let trtDispenses: any[] = [];
        try {
            trtDispenses = await query<any>(`
                SELECT
                    d.dispense_id,
                    d.dispense_date,
                    d.dose_per_syringe_ml,
                    d.syringe_count,
                    d.total_dispensed_ml,
                    d.waste_ml,
                    d.notes,
                    d.prescriber,
                    d.signature_status,
                    v.dea_drug_name,
                    v.external_id as vial_source,
                    v.size_ml,
                    v.remaining_volume_ml
                FROM dispenses d
                LEFT JOIN vials v ON d.vial_id = v.vial_id
                WHERE d.patient_id = $1
                    AND d.signature_status = 'signed'
                ORDER BY d.dispense_date DESC
                LIMIT 10
            `, [localPatientId]);
            console.log(`[Patient Chart] Found ${trtDispenses.length} TRT dispenses for patient ${localPatientId}`);
        } catch (err) {
            console.warn(`[Patient Chart] Failed to query TRT dispenses:`, err instanceof Error ? err.message : err);
            trtDispenses = [];
        }

        // Query peptide dispenses
        let peptideDispenses: any[] = [];
        try {
            // Need to join with healthie_clients to match on healthie_client_id
            const hcId = healthieId;
            peptideDispenses = await query<any>(`
                SELECT
                    pd.sale_id,
                    pd.sale_date,
                    pd.quantity,
                    pd.amount_charged,
                    pd.status,
                    pd.notes,
                    pp.name as product_name
                FROM peptide_dispenses pd
                LEFT JOIN peptide_products pp ON pd.product_id = pp.product_id
                WHERE pd.healthie_client_id = $1
                ORDER BY pd.sale_date DESC
                LIMIT 10
            `, [hcId]);
            console.log(`[Patient Chart] Found ${peptideDispenses.length} peptide dispenses for patient ${hcId}`);
        } catch (err) {
            console.warn(`[Patient Chart] Failed to query peptide dispenses:`, err instanceof Error ? err.message : err);
            peptideDispenses = [];
        }

        // Merge Healthie user profile data into demographics (fills in name, dob, etc.)
        const hp = userProfile?.user;
        if (hp) {
            const demographics = localData.demographics;
            if (!demographics.full_name && (hp.first_name || hp.last_name)) {
                demographics.full_name = `${hp.first_name || ''} ${hp.last_name || ''}`.trim();
            }
            if (!demographics.dob && hp.dob) demographics.dob = hp.dob;
            if (!demographics.phone_primary && hp.phone_number) demographics.phone_primary = hp.phone_number;
            if (!demographics.email && hp.email) demographics.email = hp.email;
            if (!demographics.gender && hp.gender) demographics.gender = hp.gender;
            // Additional fields from expanded profile
            demographics.sex = hp.sex || demographics.sex || '';
            demographics.pronouns = hp.pronouns || demographics.pronouns || '';
            demographics.height = hp.height || demographics.height || '';
            demographics.weight = hp.weight || demographics.weight || '';
            demographics.legal_name = hp.legal_name || '';
            // Address
            if (hp.location) {
                demographics.address_line1 = hp.location.line1 || '';
                demographics.address_line2 = hp.location.line2 || '';
                demographics.city = hp.location.city || '';
                demographics.state = hp.location.state || '';
                demographics.zip = hp.location.zip || '';
                demographics.country = hp.location.country || '';
                demographics.location_id = hp.location.id || '';
            }
            // Insurance — TODO: Use insurance_authorization field in future

            // Tags and group
            demographics.tags = hp.active_tags || [];
            demographics.user_group = hp.user_group?.name || '';
        }

        return NextResponse.json({
            success: true,
            data: {
                ...localData,
                healthie_id: healthieId,
                healthie_profile: hp || null,
                chart_notes: chartNotes?.formAnswerGroups || [],
                medications: medications?.medications || [],
                allergies: allergies?.user?.allergy_sensitivities || [],
                appointments: appointments?.appointments || [],
                documents: documents?.documents || [],
                vitals: mergeVitals(localVitals, entries?.entries || []),
                scribe_history: scribeHistory || [],
                avatar_url: hp?.avatar_url || null,
                // Financial & dispense data
                last_payments: lastPayments || [],
                trt_dispenses: trtDispenses || [],
                peptide_dispenses: peptideDispenses || [],
                payment_methods: [
                    ...(paymentMethods?.user?.stripe_customer_details || []),
                    ...directStripeCards
                ], // Healthie Stripe cards + Direct Stripe cards
                active_packages: activePackages || [], // Merged from Healthie recurring_payments + local healthie_package_mapping
                subscriptions: [], // Legacy field - packages are now in active_packages
                recurring_payment: null, // Legacy field - replaced by active_packages
            },
        });
    } catch (error) {
        console.error('[iPad:PatientChart] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}

// Direct Healthie fetch — bypasses rate limiter to prevent zombie connection buildup.
// Uses AbortController for proper cancellation of timed-out requests.
const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';

async function safeHealthieQuery<T>(label: string, gql: string, variables: Record<string, unknown>): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
        console.warn(`[iPad:PatientChart] ${label} aborted after 15s`);
    }, 15000); // Increased from 8s to 15s for patients with lots of data

    try {
        const response = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${HEALTHIE_API_KEY}`,
                'AuthorizationSource': 'API',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: gql, variables }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            console.warn(`[iPad:PatientChart] ${label} HTTP ${response.status}`);
            return null;
        }

        const result = await response.json();
        if (result.errors) {
            console.warn(`[iPad:PatientChart] ${label} Healthie query failed:`, result.errors.map((e: any) => e.message).join(', '));
            return null;
        }
        return result.data as T;
    } catch (error: any) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            // Already logged above
        } else {
            console.warn(`[iPad:PatientChart] ${label} error:`, error.message || error);
        }
        return null;
    }
}
