import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import Stripe from 'stripe';
import { resolvePatientId, isUUID } from '@/lib/ipad-patient-resolver';

export const dynamic = 'force-dynamic';

// Merge Healthie allergies with local patient_allergies table
async function mergeAllergies(healthieAllergies: any[], patientId: string | null): Promise<any[]> {
    let localAllergies: any[] = [];
    if (patientId) {
        try {
            localAllergies = await query<any>(
                `SELECT allergy_id as id, name, severity, reaction, category as category_type,
                        status, is_nkda, entered_by, created_at
                 FROM patient_allergies WHERE patient_id = $1::uuid ORDER BY created_at DESC`,
                [patientId]
            );
        } catch { /* table might not exist yet */ }
    }

    // If local has NKDA marker, show that
    const hasNKDA = localAllergies.some((a: any) => a.is_nkda);
    if (hasNKDA) {
        const nkdaEntry = localAllergies.find((a: any) => a.is_nkda);
        return [{
            id: nkdaEntry?.id || 'nkda',
            name: 'NKDA',
            severity: null,
            reaction: null,
            status: 'Active',
            category_type: null,
            is_nkda: true,
            entered_by: nkdaEntry?.entered_by || 'Staff',
            created_at: nkdaEntry?.created_at || new Date().toISOString(),
        }];
    }

    // Combine: local allergies + Healthie allergies (deduplicate by name)
    const seen = new Set<string>();
    const combined: any[] = [];
    for (const a of localAllergies) {
        const key = (a.name || '').toLowerCase();
        if (!seen.has(key)) { seen.add(key); combined.push(a); }
    }
    for (const a of healthieAllergies) {
        const key = (a.name || '').toLowerCase();
        if (!seen.has(key)) { seen.add(key); combined.push(a); }
    }
    return combined;
}

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
        // FIX(2026-03-19): Vitals were showing twice (local + Healthie copies).
        // Healthie is the source of truth. Only use local vitals as fallback when Healthie has none.
        const mergeVitals = (localVitals: any[], healthieVitals: any[]) => {
            // If Healthie has vitals, use those exclusively (they're synced from local anyway)
            if (healthieVitals.length > 0) {
                return healthieVitals
                    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            }

            // Fallback: use local vitals if Healthie has none
            return localVitals.map(v => ({
                id: `local_${v.metric_id}`,
                type: 'MetricEntry',
                category: v.metric_type?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Vital',
                metric_stat: v.value,
                created_at: v.created_at,
                description: v.description || '',
                created_by: {
                    id: 'local',
                    full_name: v.recorded_by_email?.split('@')[0] || 'Staff',
                    email: v.recorded_by_email || ''
                }
            })).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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

        // FIX(2026-04-07): Re-enabled auto-provision via shared resolver. Unlike the old approach
        // (which created sparse records), resolvePatientId fetches full demographics from Healthie
        // (name, email, DOB, gender, phone, address) before creating the local record.
        if (!patient && !isUUID(patientId)) {
            const autoResolvedId = await resolvePatientId(patientId);
            if (autoResolvedId) {
                const rows = await query<any>(`
                    SELECT p.*, psl.display_name as status_display
                    FROM patients p
                    LEFT JOIN patient_status_lookup psl ON p.status_key = psl.status_key
                    WHERE p.patient_id = $1::uuid
                `, [autoResolvedId]);
                patient = rows?.[0] || null;
                if (patient) {
                    const hcRows = await query<any>(
                        'SELECT healthie_client_id FROM healthie_clients WHERE patient_id = $1 AND is_active = true LIMIT 1',
                        [patient.patient_id]
                    );
                    healthieId = hcRows?.[0]?.healthie_client_id || healthieId;
                }
            }
        }

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
        const [chartNotes, medications, appointments, entries, allergies, documents, userProfile, paymentMethods, billingItems, pendingForms] = await Promise.all([
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
            // FIX(2026-03-19): Query all medications (not just active) — Healthie creates as inactive
            safeHealthieQuery<any>('medications', `
                query GetMedications($patientId: ID) {
                    medications(patient_id: $patientId) {
                        id
                        name
                        dosage
                        frequency
                        route
                        directions
                        start_date
                        end_date
                        active
                        normalized_status
                        comment
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

            // Billing items (payment history + package info) from Healthie
            // NOTE: User.recurring_payments does NOT exist in this Healthie API version.
            // Package/offering info is embedded in billingItems via offering + recurring_payment sub-objects.
            safeHealthieQuery<any>('billingItems', `
                query GetBillingItems($clientId: ID) {
                    billingItems(client_id: $clientId, offset: 0) {
                        id
                        amount_paid_string
                        state
                        created_at
                        is_recurring
                        shown_description
                        offering {
                            id
                            name
                            price
                            billing_frequency
                        }
                        recurring_payment {
                            id
                            is_canceled
                            is_paused
                            next_payment_date
                            amount_to_pay
                            start_at
                        }
                        user_package_selection {
                            id
                            offering {
                                id
                                name
                            }
                        }
                    }
                }
            `, { clientId: healthieId }),

            // Pending/requested forms (not started or in progress)
            safeHealthieQuery<any>('pendingForms', `
                query GetPendingForms($userId: ID) {
                    requestedFormCompletions(user_id: $userId) {
                        id
                        status
                        date_to_show
                        custom_module_form {
                            id
                            name
                        }
                        form_answer_group {
                            id
                            finished
                        }
                    }
                }
            `, { userId: healthieId }),
        ]);

        // 3. Fetch local scribe history — check both UUID and Healthie ID
        // FIX(2026-03-19): Scribe sessions created before auto-provision may use Healthie ID
        let scribeHistory: any[] = [];
        const localPatientId = patient?.patient_id;
        if (localPatientId || healthieId) {
            scribeHistory = await query<any>(`
                SELECT
                    ss.session_id, ss.visit_type, ss.status, ss.created_at,
                    sn.soap_subjective, sn.soap_objective, sn.soap_assessment, sn.soap_plan,
                    sn.icd10_codes, sn.cpt_codes, sn.full_note_text
                FROM scribe_sessions ss
                LEFT JOIN scribe_notes sn ON ss.session_id = sn.session_id
                WHERE ss.patient_id = $1 OR ss.patient_id = $2
                ORDER BY ss.created_at DESC
                LIMIT 20
            `, [localPatientId || '', healthieId || '']);
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
                WHERE patient_id = $1 OR patient_id = $2
                ORDER BY recorded_at DESC
                LIMIT 50
            `, [localPatientId || '', healthieId || '']);
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

        // Extract active packages from billing items' recurring_payment + offering data
        // In this Healthie API version, User.recurring_payments does NOT exist.
        // Instead, package info is embedded in billingItems.
        let activePackages: any[] = [];
        const seenRecurringPaymentIds = new Set<string>();

        const allBillingItems = billingItems?.billingItems || [];
        for (const item of allBillingItems) {
            const rp = item.recurring_payment;
            if (!rp) continue; // No recurring payment = one-time charge, not an active package
            if (rp.is_canceled || rp.is_paused) continue;
            if (seenRecurringPaymentIds.has(rp.id)) continue; // Deduplicate — multiple billing items share the same recurring_payment
            seenRecurringPaymentIds.add(rp.id);

            const offering = item.offering || item.user_package_selection?.offering;
            activePackages.push({
                package_name: offering?.name || item.shown_description || 'Package',
                description: item.shown_description || '',
                amount: rp.amount_to_pay || item.amount_paid_string || '',
                frequency: offering?.billing_frequency || 'Monthly',
                billing_frequency: offering?.billing_frequency || 'Monthly',
                next_charge_date: rp.next_payment_date || null,
                start_date: rp.start_at || null,
                source: 'healthie',
                healthie_id: rp.id,
                offering_id: offering?.id || null,
            });
        }

        // LOCAL DB fallback
        activePackages = [...activePackages, ...localPackages];
        console.log(`[Patient Chart] Extracted ${seenRecurringPaymentIds.size} active packages from ${allBillingItems.length} billing items + ${localPackages.length} local packages`);

        // Map Healthie billing items to payment history
        let lastPayments: any[] = [];
        lastPayments = allBillingItems
            .map((item: any) => ({
                amount: item.amount_paid_string ? `$${item.amount_paid_string}` : '$0.00',
                payment_date: item.created_at || '',
                payment_type: item.offering?.name || 'Charge',
                description: item.shown_description || '',
                status: item.state || 'completed',
                healthie_id: item.id
            }))
            .slice(0, 10); // Latest 10 payments
        // Also include Direct Stripe payments from local DB
        if (localPatientId) {
            try {
                const localPayments = await query<any>(
                    `SELECT transaction_id, amount, description, stripe_account, status, created_at, created_by
                     FROM payment_transactions
                     WHERE patient_id = $1
                     ORDER BY created_at DESC
                     LIMIT 10`,
                    [localPatientId]
                );
                for (const lp of localPayments) {
                    lastPayments.push({
                        amount: `$${parseFloat(lp.amount || 0).toFixed(2)}`,
                        payment_date: lp.created_at || '',
                        payment_type: lp.stripe_account === 'direct' ? 'Direct Stripe' : 'Healthie Stripe',
                        description: lp.description || '',
                        status: lp.status || 'completed',
                        local_id: lp.transaction_id,
                    });
                }
            } catch (err) {
                console.warn('[Patient Chart] Failed to query local payments:', err);
            }
        }
        // Sort all payments by date, newest first
        lastPayments.sort((a: any, b: any) => new Date(b.payment_date || 0).getTime() - new Date(a.payment_date || 0).getTime());
        lastPayments = lastPayments.slice(0, 10);
        console.log(`[Patient Chart] Found ${lastPayments.length} total payments (Healthie + Direct Stripe)`);

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
            `, [localPatientId || '00000000-0000-0000-0000-000000000000']);
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

        // FIX(2026-03-19): Healthie is the source of truth for demographics.
        // Always prefer Healthie data over stale local DB values for core fields.
        const hp = userProfile?.user;
        if (hp) {
            const demographics = localData.demographics;
            // Core demographics — Healthie wins (user enters data in Healthie directly)
            if (hp.first_name || hp.last_name) {
                demographics.full_name = `${hp.first_name || ''} ${hp.last_name || ''}`.trim();
                demographics.first_name = hp.first_name || '';
                demographics.last_name = hp.last_name || '';
            }
            if (hp.dob) demographics.dob = hp.dob;
            if (hp.phone_number) demographics.phone_primary = hp.phone_number;
            if (hp.email) demographics.email = hp.email;
            if (hp.gender) demographics.gender = hp.gender;
            // Additional fields from expanded profile
            demographics.sex = hp.sex || demographics.sex || '';
            demographics.pronouns = hp.pronouns || demographics.pronouns || '';
            demographics.height = hp.height || demographics.height || '';
            demographics.weight = hp.weight || demographics.weight || '';
            demographics.legal_name = hp.legal_name || '';
            demographics.preferred_name = hp.preferred_name || demographics.preferred_name || '';
            // Address — Healthie location is authoritative
            if (hp.location) {
                demographics.address_line_1 = hp.location.line1 || '';
                demographics.address_line1 = hp.location.line1 || '';
                demographics.address_line_2 = hp.location.line2 || '';
                demographics.address_line2 = hp.location.line2 || '';
                demographics.city = hp.location.city || '';
                demographics.state = hp.location.state || '';
                demographics.zip = hp.location.zip || '';
                demographics.country = hp.location.country || '';
                demographics.location_id = hp.location.id || '';
            }

            // Tags and group
            demographics.tags = hp.active_tags || [];
            demographics.user_group = hp.user_group?.name || '';

            // Save avatar_url to local DB so patient list can show photos
            if (hp.avatar_url && patient?.patient_id) {
                query('UPDATE patients SET avatar_url = $1 WHERE patient_id = $2 AND (avatar_url IS NULL OR avatar_url != $1)',
                    [hp.avatar_url, patient.patient_id]
                ).catch(() => {}); // fire-and-forget
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                ...localData,
                healthie_id: healthieId,
                healthie_profile: hp || null,
                chart_notes: chartNotes?.formAnswerGroups || [],
                pending_forms: (pendingForms?.requestedFormCompletions || []).map((f: any) => ({
                    id: f.id,
                    name: f.custom_module_form?.name || 'Unknown Form',
                    status: f.form_answer_group?.finished ? 'completed' : (f.form_answer_group ? 'in_progress' : 'not_started'),
                    date: f.date_to_show || null,
                })),
                medications: medications?.medications || [],
                allergies: await mergeAllergies(allergies?.user?.allergy_sensitivities || [], localPatientId),
                appointments: appointments?.appointments || [],
                documents: documents?.documents || [],
                vitals: mergeVitals(localVitals, entries?.entries || []),
                scribe_history: scribeHistory || [],
                removed_diagnoses: patient?.removed_diagnoses || [],
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
// FIX(2026-03-19): Read env vars at call time, not module load time
async function safeHealthieQuery<T>(label: string, gql: string, variables: Record<string, unknown>): Promise<T | null> {
    const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
    const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY || '';
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
            // FIX(2026-03-19): Disable Next.js fetch cache — stale cached responses were returning null for location/dob
            cache: 'no-store',
        } as any);

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
