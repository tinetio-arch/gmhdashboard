/**
 * Critical Lab Alerts API
 *
 * GET  — List pending/acknowledged critical lab alerts
 * POST — Scan recent approved labs for critical values and create alerts
 * PATCH — Provider acknowledges or resolves an alert with action notes
 *
 * Critical thresholds:
 *   - Hematocrit > 54% (critical if > 60%)
 *   - PSA > 2.5
 *   - Testosterone > 1500 ng/dL
 *   - Hemoglobin > 18 g/dL
 *   - Potassium > 5.5 mEq/L or < 3.0
 *   - Creatinine > 1.5 mg/dL
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Critical thresholds: test_name_pattern → { threshold, operator, severity, units }
const CRITICAL_THRESHOLDS = [
  { pattern: /hematocrit/i, threshold: 54, op: '>', severity: 'high', criticalAt: 60 },
  { pattern: /\bpsa\b/i, threshold: 2.5, op: '>', severity: 'high', criticalAt: 4.0 },
  { pattern: /hemoglobin/i, threshold: 18, op: '>', severity: 'high', criticalAt: 20 },
  { pattern: /potassium/i, threshold: 5.5, op: '>', severity: 'high', criticalAt: 6.0 },
  { pattern: /potassium/i, threshold: 3.0, op: '<', severity: 'high', criticalAt: 2.5 },
  { pattern: /creatinine/i, threshold: 1.5, op: '>', severity: 'moderate', criticalAt: 2.0 },
  { pattern: /testosterone.*total/i, threshold: 1500, op: '>', severity: 'moderate', criticalAt: 2000 },
];

function extractLabValues(rawResult: any): Array<{ testName: string; value: number; valueStr: string; units: string; range: string; flag: string }> {
  const results: Array<{ testName: string; value: number; valueStr: string; units: string; range: string; flag: string }> = [];
  if (!rawResult?.['Ordered Codes']) return results;

  function extractFromComponents(components: any[]) {
    if (!Array.isArray(components)) return;
    for (const comp of components) {
      if (comp['Test Name'] && comp['Result']) {
        const val = parseFloat(comp['Result']);
        if (!isNaN(val)) {
          results.push({
            testName: comp['Test Name'],
            value: val,
            valueStr: comp['Result'],
            units: comp['Test Units'] || '',
            range: comp['Range'] || '',
            flag: comp['Abnormal Flag'] || '',
          });
        }
      }
      // Recurse into nested Components
      if (comp['Components']) extractFromComponents(comp['Components']);
    }
  }

  for (const code of rawResult['Ordered Codes']) {
    if (code['Components']) extractFromComponents(code['Components']);
  }
  return results;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiUser(request, 'read');
    const status = request.nextUrl.searchParams.get('status') || 'pending';

    const alerts = await query<any>(
      `SELECT * FROM critical_lab_alerts
       WHERE status = $1
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
                created_at DESC
       LIMIT 50`,
      [status]
    );

    return NextResponse.json({ success: true, alerts });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Critical Labs] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
  }
}

// POST — Scan approved labs from last 7 days for critical values
export async function POST(request: NextRequest) {
  try {
    await requireApiUser(request, 'write');

    // Get recently approved labs that haven't been scanned yet
    const recentLabs = await query<any>(
      `SELECT lrq.id, lrq.patient_name, lrq.raw_result, lrq.healthie_patient_id,
              p.patient_id
       FROM lab_review_queue lrq
       LEFT JOIN patients p ON p.healthie_client_id = lrq.healthie_patient_id
       WHERE lrq.status = 'approved'
         AND lrq.approved_at >= NOW() - INTERVAL '7 days'
         AND lrq.id NOT IN (SELECT DISTINCT lab_queue_id FROM critical_lab_alerts WHERE lab_queue_id IS NOT NULL)
       ORDER BY lrq.approved_at DESC
       LIMIT 50`
    );

    let alertsCreated = 0;
    for (const lab of recentLabs) {
      if (!lab.raw_result) continue;
      const values = extractLabValues(lab.raw_result);

      for (const val of values) {
        for (const rule of CRITICAL_THRESHOLDS) {
          if (!rule.pattern.test(val.testName)) continue;
          const isCritical = rule.op === '>' ? val.value > rule.threshold : val.value < rule.threshold;
          if (!isCritical) continue;

          const severity = rule.op === '>'
            ? (val.value >= rule.criticalAt ? 'critical' : 'high')
            : (val.value <= rule.criticalAt ? 'critical' : 'high');

          await query(
            `INSERT INTO critical_lab_alerts
             (lab_queue_id, patient_id, patient_name, test_name, test_value, test_units, reference_range, abnormal_flag, severity)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT DO NOTHING`,
            [lab.id, lab.patient_id || null, lab.patient_name, val.testName, val.valueStr, val.units, val.range, val.flag, severity]
          );
          alertsCreated++;
        }
      }
    }

    console.log(`[Critical Labs] Scanned ${recentLabs.length} labs, created ${alertsCreated} alerts`);
    return NextResponse.json({ success: true, scanned: recentLabs.length, alerts_created: alertsCreated });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Critical Labs] POST error:', error);
    return NextResponse.json({ error: 'Failed to scan labs' }, { status: 500 });
  }
}

// PATCH — Provider acknowledges or resolves a critical lab alert
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireApiUser(request, 'write');
    const body = await request.json();
    const { alert_id, action, provider_action, provider_notes } = body;

    if (!alert_id || !action) {
      return NextResponse.json({ error: 'alert_id and action required' }, { status: 400 });
    }

    if (action === 'acknowledge') {
      await query(
        `UPDATE critical_lab_alerts
         SET status = 'acknowledged', provider_action = $1, provider_notes = $2,
             acknowledged_by = $3, acknowledged_at = NOW()
         WHERE id = $4`,
        [provider_action || null, provider_notes || null, (user as any).email, alert_id]
      );
    } else if (action === 'resolve') {
      // Upload provider notes to Healthie chart (hidden from patient)
      let healthieDocId: string | null = null;
      const [alert] = await query<any>('SELECT * FROM critical_lab_alerts WHERE id = $1', [alert_id]);

      if (alert?.patient_id && provider_notes) {
        try {
          const [hc] = await query<any>(
            'SELECT healthie_client_id FROM healthie_clients WHERE patient_id = $1 AND is_active = true LIMIT 1',
            [alert.patient_id]
          );
          if (hc?.healthie_client_id) {
            const { healthieGraphQL } = await import('@/lib/healthieApi');
            const docResult = await healthieGraphQL(`
              mutation CreateDocument($input: createDocumentInput!) {
                createDocument(input: $input) { document { id } messages { field message } }
              }`, {
              input: {
                rel_user_id: hc.healthie_client_id,
                display_name: `Critical_Lab_Action_${alert.patient_name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.txt`,
                file_string: `data:text/plain;base64,${Buffer.from(
                  `CRITICAL LAB ALERT — Provider Action Note (INTERNAL)\n` +
                  `Patient: ${alert.patient_name}\n` +
                  `Test: ${alert.test_name} = ${alert.test_value} ${alert.test_units || ''}\n` +
                  `Reference Range: ${alert.reference_range || 'N/A'}\n` +
                  `Severity: ${alert.severity.toUpperCase()}\n\n` +
                  `Provider Action: ${provider_action || 'N/A'}\n` +
                  `Notes: ${provider_notes}\n\n` +
                  `Resolved by: ${(user as any).email}\n` +
                  `Date: ${new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' })}`
                ).toString('base64')}`,
                include_in_charting: true,
                share_with_rel: false, // HIDDEN from patient
                description: `Critical lab action note — ${alert.test_name} (INTERNAL)`,
              },
            });
            healthieDocId = docResult?.createDocument?.document?.id || null;
          }
        } catch (e) {
          console.warn('[Critical Labs] Healthie upload failed:', e);
        }
      }

      await query(
        `UPDATE critical_lab_alerts
         SET status = 'resolved', provider_action = $1, provider_notes = $2,
             resolved_by = $3, resolved_at = NOW(), healthie_document_id = $4
         WHERE id = $5`,
        [provider_action || alert?.provider_action, provider_notes || alert?.provider_notes,
         (user as any).email, healthieDocId, alert_id]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.status === 401) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[Critical Labs] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update alert' }, { status: 500 });
  }
}
