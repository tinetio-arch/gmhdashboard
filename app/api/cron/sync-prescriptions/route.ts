import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { healthieGraphQL } from '@/lib/healthieApi';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramAlert(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (err) {
    console.error('[CRON] Telegram alert failed:', err);
  }
}

const PRESCRIPTIONS_QUERY = `
  query($patient_id: ID!) {
    prescriptions(patient_id: $patient_id) {
      id product_name display_name dosage dose_form directions
      quantity unit refills days_supply status normalized_status
      drug_classification schedule ndc rxcui date_written effective_date
      date_inactive last_fill_date prescriber_name prescriber_id
      comment pharmacy_notes no_substitutions is_rx_renewal is_urgent
      error_ignored formulary otc route type rx_reference_number
      pharmacy { name line1 line2 city state zip phone_number }
      first_prescription_diagnosis { diagnosis_code diagnosis_description is_primary }
      second_prescription_diagnosis { diagnosis_code diagnosis_description is_primary }
    }
  }
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface PrescriptionData { prescriptions: any[] }
interface PatientRow { patient_id: string; healthie_client_id: string; full_name: string }

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 2000;

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('x-cron-secret');
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  let synced = 0;
  let errors = 0;
  const errorPatients: string[] = [];

  try {
    const patients = await query<PatientRow>(
      `SELECT p.patient_id, p.healthie_client_id, p.full_name
       FROM patients p
       WHERE p.healthie_client_id IS NOT NULL
         AND p.healthie_client_id != ''
         AND LOWER(p.status_key) = 'active'
         AND p.patient_id NOT IN (
           SELECT SPLIT_PART(details->>'patient_id', '', 1)::uuid
           FROM agent_action_log
           WHERE agent_name = 'prescription_sync'
             AND action_type = 'skip'
             AND created_at >= NOW() - INTERVAL '7 days'
         )
       ORDER BY p.full_name`
    ).catch(async () => {
      // Fallback if agent_action_log query fails (skip filter)
      return query<PatientRow>(
        `SELECT patient_id, healthie_client_id, full_name
         FROM patients
         WHERE healthie_client_id IS NOT NULL AND healthie_client_id != ''
           AND LOWER(status_key) = 'active'
         ORDER BY full_name`
      );
    });

    // Process in batches to avoid Healthie rate limits
    for (let i = 0; i < patients.length; i += BATCH_SIZE) {
      const batch = patients.slice(i, i + BATCH_SIZE);

      for (const patient of batch) {
        try {
          // E2: use healthieGraphQL from lib/healthieApi
          const data = await healthieGraphQL<PrescriptionData>(
            PRESCRIPTIONS_QUERY,
            { patient_id: patient.healthie_client_id }
          );

          const prescriptions = data.prescriptions || [];

          for (const rx of prescriptions) {
            await query(
              `INSERT INTO prescription_cache (
                healthie_patient_id, prescription_id, product_name, display_name,
                dosage, dose_form, directions, quantity, unit, refills, days_supply,
                status, normalized_status, drug_classification, schedule, ndc, rxcui,
                date_written, effective_date, date_inactive, last_fill_date,
                prescriber_name, prescriber_id, comment, pharmacy_notes,
                no_substitutions, is_rx_renewal, is_urgent, error_ignored,
                formulary, otc, route, type, rx_reference_number,
                pharmacy_name, pharmacy_address, pharmacy_city, pharmacy_state,
                pharmacy_zip, pharmacy_phone, pharmacy_fax,
                first_prescription_diagnosis, second_prescription_diagnosis,
                updated_at
              ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,
                $39,$40,$41,$42,$43,NOW()
              )
              ON CONFLICT (healthie_patient_id, prescription_id)
              DO UPDATE SET
                product_name=EXCLUDED.product_name, display_name=EXCLUDED.display_name,
                dosage=EXCLUDED.dosage, dose_form=EXCLUDED.dose_form,
                directions=EXCLUDED.directions, quantity=EXCLUDED.quantity,
                unit=EXCLUDED.unit, refills=EXCLUDED.refills,
                days_supply=EXCLUDED.days_supply, status=EXCLUDED.status,
                normalized_status=EXCLUDED.normalized_status,
                drug_classification=EXCLUDED.drug_classification,
                schedule=EXCLUDED.schedule, ndc=EXCLUDED.ndc, rxcui=EXCLUDED.rxcui,
                date_written=EXCLUDED.date_written, effective_date=EXCLUDED.effective_date,
                date_inactive=EXCLUDED.date_inactive, last_fill_date=EXCLUDED.last_fill_date,
                prescriber_name=EXCLUDED.prescriber_name, prescriber_id=EXCLUDED.prescriber_id,
                comment=EXCLUDED.comment, pharmacy_notes=EXCLUDED.pharmacy_notes,
                no_substitutions=EXCLUDED.no_substitutions, is_rx_renewal=EXCLUDED.is_rx_renewal,
                is_urgent=EXCLUDED.is_urgent, error_ignored=EXCLUDED.error_ignored,
                formulary=EXCLUDED.formulary, otc=EXCLUDED.otc,
                route=EXCLUDED.route, type=EXCLUDED.type,
                rx_reference_number=EXCLUDED.rx_reference_number,
                pharmacy_name=EXCLUDED.pharmacy_name,
                pharmacy_address=EXCLUDED.pharmacy_address,
                pharmacy_city=EXCLUDED.pharmacy_city,
                pharmacy_state=EXCLUDED.pharmacy_state,
                pharmacy_zip=EXCLUDED.pharmacy_zip,
                pharmacy_phone=EXCLUDED.pharmacy_phone,
                pharmacy_fax=EXCLUDED.pharmacy_fax,
                first_prescription_diagnosis=EXCLUDED.first_prescription_diagnosis,
                second_prescription_diagnosis=EXCLUDED.second_prescription_diagnosis,
                updated_at=NOW()`,
              [
                patient.healthie_client_id, rx.id, rx.product_name, rx.display_name,
                rx.dosage, rx.dose_form, rx.directions, rx.quantity, rx.unit,
                rx.refills, rx.days_supply, rx.status, rx.normalized_status || 'active',
                rx.drug_classification, rx.schedule, rx.ndc, rx.rxcui,
                rx.date_written, rx.effective_date, rx.date_inactive,
                rx.last_fill_date, rx.prescriber_name, rx.prescriber_id,
                rx.comment, rx.pharmacy_notes, rx.no_substitutions ?? false,
                rx.is_rx_renewal ?? false, rx.is_urgent ?? false, rx.error_ignored ?? false,
                rx.formulary, rx.otc ?? false, rx.route, rx.type, rx.rx_reference_number,
                rx.pharmacy?.name || null, rx.pharmacy?.address || null,
                rx.pharmacy?.city || null, rx.pharmacy?.state || null,
                rx.pharmacy?.zip || null, rx.pharmacy?.phone || null,
                rx.pharmacy?.fax || null,
                rx.first_prescription_diagnosis, rx.second_prescription_diagnosis,
              ]
            );
          }

          // Check for prescription errors
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rxErrors = prescriptions.filter((p: any) => p.normalized_status === 'error');
          if (rxErrors.length > 0) {
            errorPatients.push(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              `${patient.full_name}: ${rxErrors.length} error(s) — ${rxErrors.map((e: any) => e.product_name).join(', ')}`
            );
          }

          synced++;
        } catch (patientError) {
          errors++;
          const errMsg = patientError instanceof Error ? patientError.message : String(patientError);
          console.error(`[CRON] Failed to sync prescriptions for patient ${patient.patient_id}:`, patientError);
          if (errMsg.includes('Internal server error')) {
            query(
              `INSERT INTO agent_action_log (agent_name, action_type, category, summary, details, status)
               VALUES ('prescription_sync', 'skip', 'patient_sync', $1, $2, 'completed')`,
              [
                `Skipping ${patient.full_name} — Healthie returns 500 for prescriptions`,
                JSON.stringify({ patient_id: patient.patient_id, healthie_id: patient.healthie_client_id, error: errMsg.slice(0, 200) }),
              ]
            ).catch(() => {});
          }
        }
      }

      // Delay between batches to respect Healthie rate limits
      if (i + BATCH_SIZE < patients.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (errorPatients.length > 0) {
      await sendTelegramAlert(
        `⚠️ <b>Prescription Sync Alert</b>\n\n` +
        `${errorPatients.length} patient(s) with DoseSpot errors:\n\n` +
        errorPatients.map(e => `• ${e}`).join('\n') +
        `\n\nSync: ${synced} patients in ${duration}s`
      );
    }

    return NextResponse.json({
      success: true,
      synced,
      errors,
      error_patients: errorPatients,
      duration_seconds: parseFloat(duration),
    });
  } catch (error) {
    console.error('[CRON] sync-prescriptions failed:', error);
    await sendTelegramAlert(
      `🔴 <b>Prescription Sync FAILED</b>\n${String(error)}`
    );
    return NextResponse.json(
      { error: 'Sync failed', details: String(error) },
      { status: 500 }
    );
  }
}
