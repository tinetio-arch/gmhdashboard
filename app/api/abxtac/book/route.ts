/**
 * ABX TAC — Patient Booking API
 *
 * Public endpoint (no GMH auth required) for ABX TAC website.
 * Handles:
 *   GET  /api/abxtac/book?start_date=YYYY-MM-DD  — Get available slots
 *   POST /api/abxtac/book                         — Charge $99 + create patient + book appointment
 *
 * Under the hood, uses NOW Optimal providers (Dr. Whitten + Phil Schafer)
 * but never exposes provider identity to the patient.
 *
 * Payment: $99 charged via NOW Optimal Stripe account (server-side).
 * Email: confirmation sent from hello@abxtac.com via Gmail API.
 */

import { NextRequest, NextResponse } from 'next/server';
import { healthieGraphQL } from '@/lib/healthieApi';
import Stripe from 'stripe';
import { getPool } from '@/lib/db';
import { createGHLClientForABXTAC } from '@/lib/ghl';
import crypto from 'crypto';

function generateTempPassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' as any });

const ABXTAC_GROUP_ID = '82534';
const PROVIDERS = [
  { id: '12093125', name: 'Provider A' },
  { id: '12088269', name: 'Provider B' },
];
// TODO: Change back to 99 / 9900 after testing
const CONSULT_PRICE = 1;
const CONSULT_PRICE_CENTS = 100;
const ARIZONA_TZ = 'America/Phoenix';
const ABXTAC_APPOINTMENT_TYPE_ID = process.env.ABXTAC_APPOINTMENT_TYPE_ID || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://abxtac.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * GET /api/abxtac/book?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');

    if (!startDate) {
      return NextResponse.json({ error: 'start_date is required' }, { status: 400 });
    }

    const end = endDate || (() => {
      const d = new Date(startDate + 'T12:00:00');
      d.setDate(d.getDate() + 14);
      return d.toISOString().split('T')[0];
    })();

    if (!ABXTAC_APPOINTMENT_TYPE_ID) {
      return NextResponse.json({ error: 'ABX TAC appointment type not configured' }, { status: 500 });
    }

    const slotPromises = PROVIDERS.map(async (provider) => {
      try {
        const data = await healthieGraphQL<{
          availableSlotsForRange: Array<{ date: string }>;
        }>(`
          query GetSlots($provider_id: String, $appt_type_id: String, $start_date: String, $end_date: String, $timezone: String) {
            availableSlotsForRange(
              provider_id: $provider_id,
              appt_type_id: $appt_type_id,
              start_date: $start_date,
              end_date: $end_date,
              timezone: $timezone
            ) { date }
          }
        `, {
          provider_id: provider.id,
          appt_type_id: ABXTAC_APPOINTMENT_TYPE_ID,
          start_date: startDate,
          end_date: end,
          timezone: ARIZONA_TZ,
        });

        return (data.availableSlotsForRange || []).map(slot => ({
          ...slot,
          providerId: provider.id,
        }));
      } catch (err) {
        console.error(`[ABXTac Book] Failed to fetch slots for provider ${provider.id}:`, err);
        return [];
      }
    });

    const allSlots = (await Promise.all(slotPromises)).flat();

    const dayMap: Record<string, Set<string>> = {};
    for (const slot of allSlots) {
      if (!slot.date) continue;
      const d = new Date(slot.date);
      if (isNaN(d.getTime())) continue;

      const parts: Record<string, string> = {};
      new Intl.DateTimeFormat('en-US', {
        timeZone: ARIZONA_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(d).forEach(p => { parts[p.type] = p.value; });

      const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
      const timeKey = `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;

      if (!dayMap[dateKey]) dayMap[dateKey] = new Set();
      dayMap[dateKey].add(timeKey);
    }

    const availability = Object.keys(dayMap).sort().map(date => ({
      date,
      slots: [...dayMap[date]].sort(),
    }));

    return NextResponse.json({
      success: true,
      consultPrice: CONSULT_PRICE,
      availability,
    }, { headers: CORS_HEADERS });

  } catch (error) {
    console.error('[ABXTac Book] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 500 });
  }
}

/**
 * POST /api/abxtac/book
 *
 * Full booking flow:
 *   1. Validate inputs
 *   2. Charge $99 via Stripe (server-side, NOW Optimal account)
 *   3. Find or create Healthie patient in ABXTAC group
 *   4. Book appointment with first available provider
 *   5. Log to payment_transactions table
 *   6. Send ABXTAC branded confirmation email
 *
 * Body: { email, firstName, lastName, phone, dob, datetime, stripeToken }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, firstName, lastName, phone, dob, datetime, stripeToken } = body;

    if (!email || !firstName || !lastName || !datetime) {
      return NextResponse.json({ error: 'email, firstName, lastName, and datetime are required' }, { status: 400 });
    }

    if (!stripeToken) {
      return NextResponse.json({ error: 'Payment information is required' }, { status: 400 });
    }

    if (!ABXTAC_APPOINTMENT_TYPE_ID) {
      return NextResponse.json({ error: 'ABX TAC appointment type not configured' }, { status: 500 });
    }

    // ── STEP 1: Charge via Stripe (exact iPad/mobile pattern) ─────────
    // FIX(2026-04-19): Aligned with chargeViaDirectStripe() in ipad/billing/charge
    // - PaymentIntents (not charges API)
    // - automatic_payment_methods (not payment_method_types)
    // - Token → PaymentMethod → attach to customer → charge
    // - Customer reuse by email lookup
    // - Idempotency with charge: prefix
    // - NO receipt_email (we send our own branded email)
    // - Description: "NOWOptimal Service" to Stripe, internal desc for DB
    let stripePaymentIntentId: string | null = null;
    let stripeChargeId: string | null = null;
    let stripeCustomerId: string | null = null;
    const idempotencyKey = `nowoptimal-telehealth-${email.toLowerCase()}-${datetime.replace(/[^a-zA-Z0-9]/g, '')}`;
    const stripeDescription = 'NOWOptimal Service';
    const internalDescription = `Telehealth Consultation - ${firstName} ${lastName}`;

    try {
      // 1. Get or create Stripe customer (reuse existing by email)
      const existingCustomers = await stripe.customers.list({
        email: email.toLowerCase(),
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        stripeCustomerId = existingCustomers.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: email.toLowerCase(),
          name: `${firstName} ${lastName}`,
          phone: phone || undefined,
          metadata: {
            source: 'nowoptimal_telehealth',
          },
        });
        stripeCustomerId = customer.id;
      }

      // 2. Convert Stripe Elements token → PaymentMethod → attach to customer
      const paymentMethod = await stripe.paymentMethods.create({
        type: 'card',
        card: { token: stripeToken },
      });
      await stripe.paymentMethods.attach(paymentMethod.id, {
        customer: stripeCustomerId,
      });

      // 3. Create PaymentIntent (matches iPad chargeViaDirectStripe exactly)
      const paymentIntentParams: any = {
        amount: CONSULT_PRICE_CENTS,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethod.id,
        confirm: true,
        description: stripeDescription,
        metadata: {
          patient_name: `${firstName} ${lastName}`,
          source: 'nowoptimal_telehealth',
        },
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
      };

      const paymentIntent = await stripe.paymentIntents.create(
        paymentIntentParams,
        { idempotencyKey: `charge:${idempotencyKey}` }
      );

      stripePaymentIntentId = paymentIntent.id;
      stripeChargeId = paymentIntent.latest_charge as string || paymentIntent.id;

      console.log(`[ABXTac Book] Charged $${CONSULT_PRICE} to ${email} (pi: ${stripePaymentIntentId}, status: ${paymentIntent.status})`);
    } catch (stripeErr: any) {
      console.error('[ABXTac Book] Stripe charge failed:', stripeErr.message);
      const isCardError = stripeErr.type === 'StripeCardError';
      return NextResponse.json({
        error: isCardError
          ? `Card declined: ${stripeErr.message}`
          : 'Payment failed. Please check your card details and try again.',
        detail: stripeErr.message,
      }, { status: 402, headers: CORS_HEADERS });
    }

    // ── STEP 2: Find or create Healthie patient ──────────────────────
    let healthiePatientId: string | null = null;
    let isNewPatient = false;
    let generatedTempPassword: string | null = null;

    try {
      const searchData = await healthieGraphQL<{
        users: Array<{ id: string; first_name: string; last_name: string; email: string }>;
      }>(`
        query SearchPatient($keywords: String) {
          users(keywords: $keywords) { id first_name last_name email }
        }
      `, { keywords: email });

      const existingPatient = (searchData.users || []).find(
        u => u.email?.toLowerCase() === email.toLowerCase()
      );

      if (existingPatient) {
        healthiePatientId = existingPatient.id;
        isNewPatient = false;
      } else {
        isNewPatient = true;
        const createData = await healthieGraphQL<{
          createClient: {
            user: { id: string } | null;
            messages: Array<{ message: string }>;
          };
        }>(`
          mutation CreateClient($input: createClientInput!) {
            createClient(input: $input) {
              user { id }
              messages { message }
            }
          }
        `, {
          input: {
            first_name: firstName,
            last_name: lastName,
            email,
            phone_number: phone || '',
            dob: dob || undefined,
            user_group_id: ABXTAC_GROUP_ID,
            skipped_email: true,
            dont_send_welcome: true,
            // Clinic is Arizona (no DST). Without this, Healthie assigns its
            // practice default (Mountain/Denver) and reminders shift 1hr in DST.
            timezone: 'America/Phoenix',
          },
        });

        if (createData.createClient?.user?.id) {
          healthiePatientId = createData.createClient.user.id;
          console.log(`[ABXTac Book] Created new patient: ${firstName} ${lastName} (${healthiePatientId})`);

          // Generate temp password + set on Healthie so booking email can ship it
          try {
            const tempPw = generateTempPassword(12);
            const pwResult = await healthieGraphQL<{
              updateClient: { user: { id: string } | null; messages: Array<{ message: string }> };
            }>(`
              mutation UpdateClientPassword($input: updateClientInput!) {
                updateClient(input: $input) { user { id } messages { message } }
              }
            `, { input: { id: healthiePatientId, password: tempPw } });
            const pwMessages = pwResult.updateClient?.messages || [];
            if (pwMessages.length === 0 && pwResult.updateClient?.user?.id) {
              generatedTempPassword = tempPw;
              console.log(`[ABXTac Book] Temp password set for new patient ${healthiePatientId}`);
            } else {
              console.error('[ABXTac Book] Failed to set temp password:', pwMessages);
            }
          } catch (pwErr: any) {
            console.error('[ABXTac Book] Temp password set failed (non-fatal):', pwErr.message);
          }

          // Suppress ALL Healthie emails for this patient — ABXTAC sends its own
          try {
            await healthieGraphQL<any>(`
              mutation SuppressNotifications($input: updateNotificationSettingInput!) {
                updateNotificationSetting(input: $input) {
                  id
                }
              }
            `, {
              input: {
                id: healthiePatientId,
                send_email_before_appointment: false,
                send_email_on_appointment_book: false,
                send_email_on_appointment_cancel: false,
                send_email_on_appointment_reschedule: false,
                send_message_emails: false,
                send_comment_emails: false,
                send_entry_emails: false,
                send_goal_reminder_email: false,
                send_new_module_email: false,
                send_course_complete_email: false,
              },
            });
            console.log(`[ABXTac Book] Suppressed Healthie notifications for ${healthiePatientId}`);
          } catch (notifErr: any) {
            console.error('[ABXTac Book] Failed to suppress notifications (non-fatal):', notifErr.message);
          }
        } else {
          const errMsg = createData.createClient?.messages?.map(m => m.message).join(', ') || 'Unknown error';
          console.error(`[ABXTac Book] Failed to create patient: ${errMsg}`);
          // Refund Stripe since we can't complete the booking
          if (stripeChargeId) {
            await stripe.refunds.create({ payment_intent: stripePaymentIntentId! }).catch(e =>
              console.error('[ABXTac Book] Refund failed:', e.message)
            );
          }
          return NextResponse.json({ error: `Failed to create patient: ${errMsg}` }, { status: 400, headers: CORS_HEADERS });
        }
      }
    } catch (healthieErr: any) {
      console.error('[ABXTac Book] Healthie patient error:', healthieErr.message);
      if (stripePaymentIntentId) {
        await stripe.refunds.create({ payment_intent: stripePaymentIntentId }).catch(e =>
          console.error('[ABXTac Book] Refund failed:', e.message)
        );
      }
      return NextResponse.json({ error: 'Failed to register patient' }, { status: 500, headers: CORS_HEADERS });
    }

    // ── STEP 2b: Create/link patient in dashboard DB ────────────────
    let dashboardPatientId: string | null = null;
    try {
      const existingPatient = await getPool().query(
        `SELECT patient_id FROM patients WHERE healthie_client_id = $1 OR LOWER(email) = LOWER($2) LIMIT 1`,
        [healthiePatientId, email]
      );

      if (existingPatient.rows.length > 0) {
        dashboardPatientId = existingPatient.rows[0].patient_id;
        await getPool().query(
          `UPDATE patients SET
            healthie_client_id = COALESCE(healthie_client_id, $1),
            healthie_group_id = COALESCE(healthie_group_id, $3),
            healthie_group_name = COALESCE(healthie_group_name, $4),
            stripe_customer_id = COALESCE(stripe_customer_id, $5),
            updated_at = NOW()
          WHERE patient_id = $2`,
          [healthiePatientId, dashboardPatientId, ABXTAC_GROUP_ID, 'ABXTAC', stripeCustomerId]
        );
      } else {
        const today = new Date().toISOString().split('T')[0];
        const insertResult = await getPool().query(
          `INSERT INTO patients (
            full_name, email, dob, phone_primary,
            status, status_key, clinic, regimen,
            healthie_client_id, healthie_group_id, healthie_group_name,
            stripe_customer_id, patient_type,
            service_start_date, added_by, date_added, created_at
          ) VALUES (
            $1, $2, $3, $4,
            'active', 'active', 'abxtac', 'peptides',
            $5, $6, 'ABXTAC',
            $7, 'member',
            $8, 'ABXTAC Website', NOW(), NOW()
          ) RETURNING patient_id`,
          [
            `${firstName} ${lastName}`,
            email.toLowerCase(),
            dob || null,
            phone || null,
            healthiePatientId,
            ABXTAC_GROUP_ID,
            stripeCustomerId,
            today,
          ]
        );
        dashboardPatientId = insertResult.rows[0].patient_id;
        console.log(`[ABXTac Book] Created dashboard patient: ${dashboardPatientId}`);
      }

      await getPool().query(
        `INSERT INTO healthie_clients (healthie_client_id, patient_id, is_active)
         VALUES ($1, $2, true)
         ON CONFLICT (healthie_client_id) DO UPDATE SET patient_id = $2, is_active = true`,
        [healthiePatientId, dashboardPatientId]
      );
    } catch (dbErr: any) {
      console.error('[ABXTac Book] Dashboard patient creation failed (non-fatal):', dbErr.message);
    }

    // ── STEP 2c: Create/upsert contact in GHL ABXTAC sub-account ────
    // GHL handles ALL ABXTAC patient communications (email + SMS).
    // Tags trigger GHL workflows → branded emails from ABXTAC, not Healthie.
    let ghlContactId: string | null = null;
    try {
      const ghl = createGHLClientForABXTAC();
      if (ghl) {
        const ghlContact = await ghl.createContact({
          firstName,
          lastName,
          email: email.toLowerCase(),
          phone: phone || undefined,
          dateOfBirth: dob || undefined,
          tags: ['ABXTAC', 'Peptide Patient'],
          source: 'ABXTAC Website',
        });

        ghlContactId = ghlContact?.id || null;

        // Save GHL contact ID to dashboard patient
        if (ghlContactId && dashboardPatientId) {
          await getPool().query(
            `UPDATE patients SET ghl_contact_id = $1, ghl_sync_status = 'synced', ghl_last_synced_at = NOW() WHERE patient_id = $2`,
            [ghlContactId, dashboardPatientId]
          ).catch(() => {});
        }

        console.log(`[ABXTac Book] GHL contact created/upserted: ${ghlContactId} for ${email}`);
      }
    } catch (ghlErr: any) {
      console.error('[ABXTac Book] GHL sync failed (non-fatal):', ghlErr.message);
    }

    // ── STEP 3: Find available provider for this slot ────────────────
    let assignedProviderId: string | null = null;

    for (const provider of PROVIDERS) {
      try {
        const dateOnly = datetime.split('T')[0];
        const slotsData = await healthieGraphQL<{
          availableSlotsForRange: Array<{ date: string }>;
        }>(`
          query CheckSlot($provider_id: String, $appt_type_id: String, $start_date: String, $end_date: String, $timezone: String) {
            availableSlotsForRange(
              provider_id: $provider_id,
              appt_type_id: $appt_type_id,
              start_date: $start_date,
              end_date: $end_date,
              timezone: $timezone
            ) { date }
          }
        `, {
          provider_id: provider.id,
          appt_type_id: ABXTAC_APPOINTMENT_TYPE_ID,
          start_date: dateOnly,
          end_date: dateOnly,
          timezone: ARIZONA_TZ,
        });

        const hasSlot = (slotsData.availableSlotsForRange || []).some(slot => {
          const slotTime = slot.date?.substring(0, 16).replace('T', ' ');
          const requestedTime = datetime.replace('T', ' ');
          return slotTime === requestedTime || slot.date?.includes(datetime);
        });

        if (hasSlot) {
          assignedProviderId = provider.id;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!assignedProviderId) {
      assignedProviderId = PROVIDERS[0].id;
    }

    // Routing guardrail (Phil 2026-04-21): NOWMensHealth.Care patients must go to
    // Dr. Whitten at NowMensHealth.Care location. Pelleting types go to Longevity.
    // The ABXTAC site is a PUBLIC booking surface — no staff override available.
    let resolvedLocationId: string | null = null;
    try {
      const { resolveBookingAssignment } = await import('@/lib/appointmentRouting');
      const routing = await resolveBookingAssignment({
        patientHealthieId: healthiePatientId,
        appointmentTypeId: ABXTAC_APPOINTMENT_TYPE_ID,
        requestedProviderId: assignedProviderId,
        staffOverride: false
      });
      if (routing.rerouted) {
        console.log(`[ABXTac Book] Routing applied (${routing.rule}): provider ${assignedProviderId}→${routing.providerId}`);
        assignedProviderId = routing.providerId;
      }
      resolvedLocationId = routing.locationId || null;
    } catch (err) {
      console.warn('[ABXTac Book] Routing lib failed (using caller provider):', (err as Error).message);
    }

    // ── STEP 4: Create appointment ───────────────────────────────────
    const fixedDatetime = datetime.includes('-', 10) || datetime.includes('+') || datetime.includes('Z')
      ? datetime
      : `${datetime}:00-07:00`;

    let appointmentId: string | null = null;
    let appointmentDate: string | null = null;

    try {
      const apptData = await healthieGraphQL<{
        createAppointment: {
          appointment: { id: string; date: string } | null;
          messages: Array<{ field: string; message: string }>;
        };
      }>(`
        mutation CreateAppointment($input: createAppointmentInput!) {
          createAppointment(input: $input) {
            appointment { id date }
            messages { field message }
          }
        }
      `, {
        input: {
          user_id: healthiePatientId,
          other_party_id: assignedProviderId,
          providers: assignedProviderId,
          appointment_type_id: ABXTAC_APPOINTMENT_TYPE_ID,
          appointment_location_id: resolvedLocationId,
          datetime: fixedDatetime,
          contact_type: 'Healthie Video Call',
          timezone: ARIZONA_TZ,
          notes: `Booked via ABX TAC website - $99 consultation (Stripe: ${stripeChargeId})`,
        },
      });

      if (apptData.createAppointment?.messages?.length) {
        const errMsg = apptData.createAppointment.messages.map(m => m.message).join(', ');
        console.error(`[ABXTac Book] Appointment creation failed: ${errMsg}`);
        if (stripeChargeId) {
          await stripe.refunds.create({ charge: stripeChargeId }).catch(e =>
            console.error('[ABXTac Book] Refund failed:', e.message)
          );
        }
        return NextResponse.json({ error: errMsg }, { status: 400, headers: CORS_HEADERS });
      }

      appointmentId = apptData.createAppointment?.appointment?.id || null;
      appointmentDate = apptData.createAppointment?.appointment?.date || null;
    } catch (apptErr: any) {
      console.error('[ABXTac Book] Appointment error:', apptErr.message);
      if (stripeChargeId) {
        await stripe.refunds.create({ charge: stripeChargeId }).catch(e =>
          console.error('[ABXTac Book] Refund failed:', e.message)
        );
      }
      return NextResponse.json({ error: 'Failed to book appointment' }, { status: 500, headers: CORS_HEADERS });
    }

    console.log(`[ABXTac Book] Appointment created: ${appointmentId} for ${email} at ${fixedDatetime}`);

    // ── STEP 5: Log payment (exact iPad pattern — ON CONFLICT, internal desc) ──
    try {
      await getPool().query(
        `INSERT INTO payment_transactions (
          patient_id, amount, description, stripe_account,
          stripe_charge_id, stripe_customer_id, status, created_at, idempotency_key
        ) VALUES (
          (SELECT patient_id FROM patients WHERE healthie_client_id = $1 LIMIT 1),
          $2, $3, $4, $5, $6, $7, NOW(), $8
        )
        ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
        [
          healthiePatientId,
          CONSULT_PRICE,
          internalDescription,
          'direct',
          stripePaymentIntentId,
          stripeCustomerId,
          'succeeded',
          idempotencyKey,
        ]
      );
    } catch (dbErr: any) {
      console.error('[ABXTac Book] Payment log failed (non-fatal):', dbErr.message);
    }

    // ── STEP 6: Trigger GHL workflows via tags + custom fields ────────
    // GHL workflows handle ALL patient communications (email + SMS).
    // Adding the "Telehealth Consult Booked" tag triggers the confirmation workflow.
    // Custom fields pass appointment details to the email/SMS templates.
    try {
      const ghl = createGHLClientForABXTAC();
      if (ghl && ghlContactId) {
        const apptDt = appointmentDate ? new Date(appointmentDate) : new Date(fixedDatetime);
        const dateStr = apptDt.toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: ARIZONA_TZ,
        });
        const timeStr = apptDt.toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true, timeZone: ARIZONA_TZ,
        });

        // Set custom fields for GHL email/SMS templates
        await ghl.updateCustomField(ghlContactId, 'appointment_date', dateStr).catch(() => {});
        await ghl.updateCustomField(ghlContactId, 'appointment_time', timeStr).catch(() => {});
        await ghl.updateCustomField(ghlContactId, 'appointment_type', 'Telehealth Consultation').catch(() => {});
        await ghl.updateCustomField(ghlContactId, 'appointment_id', appointmentId || '').catch(() => {});
        await ghl.updateCustomField(ghlContactId, 'amount_paid', `$${CONSULT_PRICE}`).catch(() => {});

        // Password handoff — empty on returning patients so merge field renders blank
        await ghl.updateCustomField(ghlContactId, 'temp_password', generatedTempPassword || '').catch(() => {});

        // Route the booking-confirmation workflow by patient status.
        // The main trigger tag stays so downstream workflows (SMS, CRM) still fire.
        await ghl.addTag(ghlContactId, isNewPatient ? 'abxtac-new-patient' : 'abxtac-existing-patient');
        await ghl.addTag(ghlContactId, 'Telehealth Consult Booked');

        console.log(`[ABXTac Book] GHL workflows triggered for ${ghlContactId}: isNewPatient=${isNewPatient}, temp_password=${generatedTempPassword ? 'set' : 'none'}`);
      } else {
        console.warn('[ABXTac Book] GHL contact not available — skipping workflow trigger');
      }
    } catch (ghlErr: any) {
      console.error('[ABXTac Book] GHL workflow trigger failed (non-fatal):', ghlErr.message);
    }

    return NextResponse.json({
      success: true,
      appointment: { id: appointmentId, datetime: appointmentDate },
      consultPrice: CONSULT_PRICE,
      message: 'Consultation booked successfully. Check your email for confirmation.',
    }, { headers: CORS_HEADERS });

  } catch (error) {
    console.error('[ABXTac Book] Error:', error);
    return NextResponse.json({ error: 'Failed to book appointment' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
