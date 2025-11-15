import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { fetchRecentDeaLog } from '@/lib/deaQueries';

const CSV_HEADERS = [
  'transaction_time',
  'prescriber',
  'patient_name',
  'dea_drug_name',
  'dea_drug_code',
  'dea_schedule',
  'quantity_dispensed',
  'units',
  'lot_number',
  'expiration_date',
  'notes'
];

function toCsv(rows: Record<string, unknown>[]): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    const values = CSV_HEADERS.map((key) => {
      const value = row[key];
      if (value === null || value === undefined) {
        return '';
      }
      const escaped = String(value).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    lines.push(values.join(','));
  }
  return lines.join('\n');
}

export async function POST(request: NextRequest) {
  await requireApiUser(request, 'admin');
  try {
    const rows = await fetchRecentDeaLog(1000);
    const csvRows = rows.map((row) => ({
      transaction_time: row.transaction_time ?? '',
      prescriber: row.prescriber ?? '',
      patient_name: row.patient_name ?? '',
      dea_drug_name: row.dea_drug_name ?? '',
      dea_drug_code: row.dea_drug_code ?? '',
      dea_schedule: row.dea_schedule ?? '',
      quantity_dispensed:
        row.quantity_dispensed !== null && row.quantity_dispensed !== undefined
          ? row.quantity_dispensed
          : '',
      units: row.units ?? '',
      lot_number: row.lot_number ?? '',
      expiration_date: row.expiration_date ?? '',
      notes: row.notes ?? ''
    }));

    const csv = toCsv(csvRows as Record<string, unknown>[]);
    const filename = `dea-log-${Date.now()}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    console.error('Failed to export DEA log', error);
    return NextResponse.json({ error: 'Failed to export DEA log' }, { status: 500 });
  }
}
