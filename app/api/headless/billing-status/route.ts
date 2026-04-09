// API endpoint to get patient billing/package status by Healthie client ID
// Used by the headless mobile app to show payment alerts on the dashboard
// Follows same pattern as /api/headless/lab-status/

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getPatientAccessStatus } from '@/lib/appAccessControl';

const HEALTHIE_API_URL = process.env.HEALTHIE_API_URL || 'https://api.gethealthie.com/graphql';
const HEALTHIE_API_KEY = process.env.HEALTHIE_API_KEY;
const PORTAL_URL = 'https://secure.gethealthie.com/go/nowoptimalnetwork';

export async function GET(request: NextRequest) {
    // FIX(2026-04-09): Added x-jarvis-secret auth — endpoint was previously unauthenticated
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const healthieId = searchParams.get('healthie_id');

        if (!healthieId) {
            return NextResponse.json(
                { error: 'healthie_id parameter is required' },
                { status: 400 }
            );
        }

        const pool = getPool();

        // 1. Find patient and check access
        const patientResult = await pool.query<{
            patient_id: string;
            full_name: string;
            status_key: string;
            payment_method_key: string;
            client_type_key: string;
            healthie_group_name: string | null;
        }>(`
            SELECT patient_id, full_name, status_key, payment_method_key, client_type_key, healthie_group_name
            FROM patients WHERE healthie_client_id = $1
            LIMIT 1
        `, [healthieId]);

        if (patientResult.rows.length === 0) {
            return NextResponse.json(
                { error: 'Patient not found', healthie_id: healthieId },
                { status: 404 }
            );
        }

        const patient = patientResult.rows[0];
        const patientId = patient.patient_id;
        const isProBono = patient.client_type_key === 'approved_disc_pro_bono_pt' || patient.payment_method_key === 'pro_bono';

        // 2. Check access control
        const accessCheck = await getPatientAccessStatus(patientId);
        if (accessCheck.status === 'revoked' || accessCheck.status === 'suspended') {
            return NextResponse.json(
                { error: 'Access denied: Account is revoked or suspended' },
                { status: 403 }
            );
        }

        // 3. Query Healthie for active package and next payment
        if (!HEALTHIE_API_KEY) {
            return NextResponse.json(
                { error: 'Healthie API not configured' },
                { status: 500 }
            );
        }

        const healthieRes = await fetch(HEALTHIE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                authorization: `Basic ${HEALTHIE_API_KEY}`,
                authorizationsource: 'API',
            },
            body: JSON.stringify({
                query: `query GetBillingStatus($id: ID) {
                    user(id: $id) {
                        id
                        next_recurring_payment {
                            amount_paid
                            start_at
                        }
                        upcoming_payments {
                            amount_paid
                        }
                        stripe_customer_detail {
                            card_type_label
                            last_four
                        }
                        offerings {
                            id
                            name
                            price
                            billing_frequency
                        }
                    }
                }`,
                variables: { id: healthieId },
            }),
        });

        const healthieData = await healthieRes.json() as any;
        const user = healthieData?.data?.user;

        if (!user) {
            return NextResponse.json({
                healthie_id: healthieId,
                patient_name: patient.full_name,
                package_name: null,
                package_amount: null,
                billing_frequency: null,
                next_payment_date: null,
                days_until_payment: null,
                has_card_on_file: false,
                card_info: null,
                payment_status: 'no_account',
                urgency: 'unknown',
                update_card_url: PORTAL_URL,
            });
        }

        // Extract package info from offerings (active subscriptions)
        const offerings = user.offerings || [];
        const activePackage = offerings.length > 0 ? offerings[0] : null;

        // Card info
        const card = user.stripe_customer_detail;
        const hasCard = !!card?.card_type_label;
        const cardInfo = hasCard ? `${card.card_type_label} ending ${card.last_four}` : null;

        // Next payment
        const nextRecurring = user.next_recurring_payment;
        let nextPaymentDate: string | null = null;
        let daysUntilPayment: number | null = null;
        let urgency = 'unknown';
        let paymentStatus = 'current';

        if (nextRecurring?.start_at) {
            // Parse date from Healthie format: "2026-03-25 12:00:00 -0700"
            const payDate = new Date(nextRecurring.start_at);
            nextPaymentDate = payDate.toISOString().split('T')[0];
            const now = new Date();
            const diffMs = payDate.getTime() - now.getTime();
            daysUntilPayment = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

            if (daysUntilPayment < 0) {
                urgency = 'overdue';
                paymentStatus = 'overdue';
            } else if (daysUntilPayment <= 5) {
                urgency = 'due_soon';
                paymentStatus = 'due_soon';
            } else {
                urgency = 'current';
                paymentStatus = 'current';
            }
        }

        // Check if patient is on payment hold in our DB
        if (patient.status_key === 'hold_payment_research') {
            paymentStatus = 'failed';
            urgency = 'overdue';
        }

        // Pro bono patients should never see payment alerts
        if (isProBono) {
            paymentStatus = 'pro_bono';
            urgency = 'current';
        } else if (!hasCard && !activePackage) {
            paymentStatus = 'needs_setup';
            urgency = 'overdue';
        } else if (!hasCard) {
            paymentStatus = 'no_card';
            urgency = 'overdue';
        } else if (!activePackage && !nextRecurring) {
            paymentStatus = 'no_package';
            urgency = 'current';  // Don't alarm patients with no package — could be transitional
        }

        return NextResponse.json({
            healthie_id: healthieId,
            patient_name: patient.full_name,
            package_name: activePackage?.name || null,
            package_amount: activePackage?.price || nextRecurring?.amount_paid || null,
            billing_frequency: activePackage?.billing_frequency || null,
            next_payment_date: nextPaymentDate,
            days_until_payment: daysUntilPayment,
            has_card_on_file: hasCard,
            card_info: cardInfo,
            payment_status: paymentStatus, // 'current', 'due_soon', 'overdue', 'failed', 'no_card', 'no_package', 'needs_setup', 'pro_bono'
            urgency: urgency, // 'current', 'due_soon', 'overdue', 'unknown'
            update_card_url: PORTAL_URL,
            is_pro_bono: isProBono,
            group_name: patient.healthie_group_name || null,
        });

    } catch (error) {
        console.error('[Headless API] Billing status error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
