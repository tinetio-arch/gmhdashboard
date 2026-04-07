/**
 * ABX TAC — Patient Booking API
 *
 * Public endpoint (no GMH auth required) for ABX TAC website.
 * Handles:
 *   GET  /api/abxtac/book?date=YYYY-MM-DD  — Get available slots (merged from both providers)
 *   POST /api/abxtac/book                   — Create appointment in ABXTAC Healthie group
 *
 * Under the hood, uses NOW Optimal providers (Dr. Whitten + Phil Schafer)
 * but never exposes provider identity to the patient.
 */

import { NextRequest, NextResponse } from 'next/server';
import { healthieGraphQL } from '@/lib/healthieApi';

// ABX TAC Healthie configuration
const ABXTAC_GROUP_ID = '81103'; // NowOptimalWellness group (or create ABXTAC-specific)
const PROVIDERS = [
  { id: '12093125', name: 'Provider A' }, // Dr. Whitten
  { id: '12088269', name: 'Provider B' }, // Phil Schafer NP
];
const CONSULT_PRICE = 99;
const ARIZONA_TZ = 'America/Phoenix';

// Use a telehealth appointment type — find or create one for ABX TAC
// This should be a generic "ABX TAC Consultation" type
const ABXTAC_APPOINTMENT_TYPE_ID = process.env.ABXTAC_APPOINTMENT_TYPE_ID || '';

/**
 * GET /api/abxtac/book?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *
 * Returns available consultation slots merged from both providers.
 * Provider identity is hidden — patient just sees available times.
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
      return NextResponse.json({
        error: 'ABX TAC appointment type not configured. Set ABXTAC_APPOINTMENT_TYPE_ID in .env.local'
      }, { status: 500 });
    }

    // Fetch slots from both providers in parallel
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
            ) {
              date
            }
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
          providerId: provider.id, // Internal only — not exposed to patient
        }));
      } catch (err) {
        console.error(`[ABXTac Book] Failed to fetch slots for provider ${provider.id}:`, err);
        return [];
      }
    });

    const allSlots = (await Promise.all(slotPromises)).flat();

    // Parse and group by date, merge times, remove provider identity
    const dayMap: Record<string, Set<string>> = {};
    const slotProviderMap: Record<string, string> = {}; // time → providerId (pick first available)

    for (const slot of allSlots) {
      if (!slot.date) continue;
      const d = new Date(slot.date);
      if (isNaN(d.getTime())) continue;

      // Convert to Arizona time
      const parts: Record<string, string> = {};
      new Intl.DateTimeFormat('en-US', {
        timeZone: ARIZONA_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(d).forEach(p => { parts[p.type] = p.value; });

      const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
      const timeKey = `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
      const fullKey = `${dateKey}T${timeKey}`;

      if (!dayMap[dateKey]) dayMap[dateKey] = new Set();
      dayMap[dateKey].add(timeKey);

      // Track which provider has this slot (first come, first served)
      if (!slotProviderMap[fullKey]) {
        slotProviderMap[fullKey] = slot.providerId;
      }
    }

    // Build response — dates with available time slots (no provider info exposed)
    const availability = Object.keys(dayMap).sort().map(date => ({
      date,
      slots: [...dayMap[date]].sort(),
    }));

    return NextResponse.json({
      success: true,
      consultPrice: CONSULT_PRICE,
      availability,
      // Internal slot-to-provider mapping stored server-side for booking
      // NOT exposed to client
    }, {
      headers: {
        'Access-Control-Allow-Origin': 'https://abxtac.com',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });

  } catch (error) {
    console.error('[ABXTac Book] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 500 });
  }
}

/**
 * POST /api/abxtac/book
 *
 * Creates appointment for ABX TAC patient.
 * Automatically assigns to the first available provider for that slot.
 *
 * Body:
 *   { email, firstName, lastName, phone, datetime (YYYY-MM-DDTHH:mm) }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, firstName, lastName, phone, datetime } = body;

    if (!email || !firstName || !lastName || !datetime) {
      return NextResponse.json({
        error: 'email, firstName, lastName, and datetime are required'
      }, { status: 400 });
    }

    if (!ABXTAC_APPOINTMENT_TYPE_ID) {
      return NextResponse.json({
        error: 'ABX TAC appointment type not configured'
      }, { status: 500 });
    }

    // Step 1: Find or create patient in Healthie
    let healthiePatientId: string | null = null;

    // Search for existing patient by email
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
    } else {
      // Create new patient in ABXTAC group
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
          user_group_id: ABXTAC_GROUP_ID,
          skipped_email: false,
        },
      });

      if (createData.createClient?.user?.id) {
        healthiePatientId = createData.createClient.user.id;
        console.log(`[ABXTac Book] Created new patient: ${firstName} ${lastName} (${healthiePatientId})`);
      } else {
        const errMsg = createData.createClient?.messages?.map(m => m.message).join(', ') || 'Unknown error';
        return NextResponse.json({ error: `Failed to create patient: ${errMsg}` }, { status: 400 });
      }
    }

    // Step 2: Find available provider for this time slot
    // Check both providers for availability at the requested time
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

        // Check if the requested time is in this provider's available slots
        const requestedTime = datetime.replace('T', ' ');
        const hasSlot = (slotsData.availableSlotsForRange || []).some(slot => {
          const slotTime = slot.date?.substring(0, 16).replace('T', ' ');
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
      // Fallback to first provider
      assignedProviderId = PROVIDERS[0].id;
    }

    // Step 3: Create appointment
    // Append Arizona timezone offset
    const fixedDatetime = datetime.includes('-', 10) || datetime.includes('+') || datetime.includes('Z')
      ? datetime
      : `${datetime}:00-07:00`;

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
        datetime: fixedDatetime,
        contact_type: 'Healthie Video Call',
        timezone: ARIZONA_TZ,
        notes: 'Booked via ABX TAC website - $99 consultation',
      },
    });

    if (apptData.createAppointment?.messages?.length) {
      const errMsg = apptData.createAppointment.messages.map(m => m.message).join(', ');
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    const appointment = apptData.createAppointment?.appointment;

    console.log(`[ABXTac Book] Appointment created: ${appointment?.id} for ${email} at ${fixedDatetime}`);

    return NextResponse.json({
      success: true,
      appointment: {
        id: appointment?.id,
        datetime: appointment?.date,
      },
      consultPrice: CONSULT_PRICE,
      message: 'Consultation booked successfully. You will receive a confirmation email.',
    }, {
      headers: {
        'Access-Control-Allow-Origin': 'https://abxtac.com',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });

  } catch (error) {
    console.error('[ABXTac Book] Error:', error);
    return NextResponse.json({ error: 'Failed to book appointment' }, { status: 500 });
  }
}

/**
 * OPTIONS — CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://abxtac.com',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
