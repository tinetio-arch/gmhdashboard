import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try { var user = await requireApiUser(request, 'read'); }
  catch (error) {
    if (error instanceof UnauthorizedError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    throw error;
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'CEO access only' }, { status: 403 });
  }

  const card = request.nextUrl.searchParams.get('card');
  if (!card) return NextResponse.json({ error: 'card parameter required' }, { status: 400 });

  let data: any[] = [];
  let title = '';

  switch (card) {
    case 'peptides_inhouse':
      title = 'In-House Peptide Sales (30 days)';
      data = await query<any>(`
        SELECT p.full_name as patient_name, pt.amount::numeric(10,2) as amount,
               pt.description, pt.created_at::date as date
        FROM payment_transactions pt
        LEFT JOIN patients p ON pt.patient_id = p.patient_id
        WHERE pt.status = 'succeeded'
          AND pt.description ~* '(bpc|tb.?500|cjc|ipamorelin|tesamorelin|semaglutide|tirzepatide|retatrutide|liraglutide|aod|ghk|semax|selank|dsip|mots|wolverine|peptide|blend|glp)'
          AND pt.description NOT ILIKE '%ship-to-patient%'
          AND pt.created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date - INTERVAL '30 days'
        ORDER BY pt.created_at DESC
      `);
      break;

    case 'peptides_shipped':
      title = 'Shipped Peptide Orders (30 days)';
      data = await query<any>(`
        SELECT p.full_name as patient_name, pt.amount::numeric(10,2) as amount,
               pt.description, pt.created_at::date as date
        FROM payment_transactions pt
        LEFT JOIN patients p ON pt.patient_id = p.patient_id
        WHERE pt.status = 'succeeded'
          AND pt.description ILIKE '%ship-to-patient%'
          AND pt.created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date - INTERVAL '30 days'
        ORDER BY pt.created_at DESC
      `);
      break;

    case 'retention_expiring':
      title = 'Contracts Expiring Within 30 Days';
      data = await query<any>(`
        SELECT full_name as patient_name, contract_end_date::date as date,
               phone_primary as phone, email, client_type_key as type
        FROM patients
        WHERE LOWER(status_key) = 'active'
          AND contract_end_date IS NOT NULL
          AND contract_end_date::date BETWEEN (NOW() AT TIME ZONE 'America/Phoenix')::date
                                        AND (NOW() AT TIME ZONE 'America/Phoenix')::date + 30
        ORDER BY contract_end_date
      `);
      break;

    case 'retention_expired':
      title = 'Expired Contracts (Still Active Status)';
      data = await query<any>(`
        SELECT full_name as patient_name, contract_end_date::date as date,
               phone_primary as phone, email, client_type_key as type
        FROM patients
        WHERE LOWER(status_key) = 'active'
          AND contract_end_date IS NOT NULL
          AND contract_end_date::date < (NOW() AT TIME ZONE 'America/Phoenix')::date
        ORDER BY contract_end_date DESC
      `);
      break;

    case 'retention_no_lab':
      title = 'No Lab in 90+ Days';
      data = await query<any>(`
        SELECT full_name as patient_name, last_lab_date::date as date,
               phone_primary as phone, email, client_type_key as type
        FROM patients
        WHERE LOWER(status_key) = 'active'
          AND last_lab_date IS NOT NULL
          AND last_lab_date::date < (NOW() AT TIME ZONE 'America/Phoenix')::date - 90
        ORDER BY last_lab_date
      `);
      break;

    case 'testosterone_vials':
      title = 'All Active Testosterone Vials';
      data = await query<any>(`
        SELECT external_id as vial_id, dea_drug_name as vendor,
               remaining_volume_ml::numeric(10,1) as remaining_ml,
               expiration_date::date as expires, status
        FROM vials
        WHERE status = 'Active' AND controlled_substance = true
        ORDER BY remaining_volume_ml ASC
      `);
      break;

    case 'stripe_transactions':
      title = 'iPad Stripe Transactions (30 days)';
      data = await query<any>(`
        SELECT p.full_name as patient_name, pt.amount::numeric(10,2) as amount,
               pt.description, pt.status, pt.created_at::date as date
        FROM payment_transactions pt
        LEFT JOIN patients p ON pt.patient_id = p.patient_id
        WHERE pt.created_at >= (NOW() AT TIME ZONE 'America/Phoenix')::date - INTERVAL '30 days'
          AND pt.status = 'succeeded'
        ORDER BY pt.created_at DESC
      `);
      break;

    case 'healthie_succeeded': {
      title = 'Healthie Recurring Payments (30 days)';
      try {
        const fs = require('fs');
        const cache = JSON.parse(fs.readFileSync('/tmp/healthie-revenue-cache.json', 'utf8'));
        if (cache.succeeded_items && cache.succeeded_items.length > 0) {
          data = cache.succeeded_items.map((s: any) => ({
            patient_name: s.patient_name,
            amount: s.amount,
            description: 'Healthie recurring billing',
            date: s.date,
          }));
        } else {
          data = (cache.daily || []).map((d: any) => ({
            patient_name: `Daily total for ${d.day}`,
            amount: d.amount,
            description: 'Run cache refresh for patient detail',
            date: d.day,
          }));
        }
      } catch {
        data = [{ note: 'Healthie revenue cache unavailable' }];
      }
      break;
    }

    case 'healthie_failed': {
      title = 'Healthie Failed Billing Items (30 days)';
      try {
        const fs = require('fs');
        const cache = JSON.parse(fs.readFileSync('/tmp/healthie-revenue-cache.json', 'utf8'));
        data = (cache.failed_items || []).map((f: any) => ({
          patient_name: f.patient_name,
          amount: f.amount,
          description: 'Healthie recurring billing — failed',
          date: f.date,
        }));
      } catch {
        data = [{ note: 'Healthie revenue cache unavailable' }];
      }
      break;
    }

    case 'provider_patients': {
      const provider = request.nextUrl.searchParams.get('provider') || '';
      title = `Patients Seen by ${provider} (Today)`;
      data = [{ note: 'Patient list loaded from Healthie schedule — see Schedule tab for details' }];
      break;
    }

    default:
      return NextResponse.json({ error: `Unknown card: ${card}` }, { status: 400 });
  }

  return NextResponse.json({ success: true, title, data, count: data.length });
}
