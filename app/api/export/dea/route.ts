import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

function toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) {
        return '';
    }
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    for (const row of rows) {
        const values = headers.map((header) => {
            const value = row[header];
            if (value === null || value === undefined) {
                return '';
            }
            const str = String(value).replace(/"/g, '""');
            return str.includes(',') || str.includes('"') ? `"${str}"` : str;
        });
        lines.push(values.join(','));
    }
    return lines.join('\n');
}

export async function GET(request: Request) {
    await requireUser('write');

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let whereClause = '';
    const params: unknown[] = [];

    if (startDate && endDate) {
        whereClause = `WHERE log.transaction_time >= $1 AND log.transaction_time < ($2::date + 1)`;
        params.push(startDate, endDate);
    }

    const rows = await query<Record<string, unknown>>(
        `SELECT
        log.dispense_id,
        log.transaction_time,
        log.dea_drug_name,
        log.dea_drug_code,
        log.dea_schedule,
        log.quantity_dispensed,
        log.units,
        log.prescriber,
        log.patient_name,
        log.phone_primary,
        log.address_line1,
        log.city,
        log.state,
        log.postal_code,
        log.lot_number,
        log.expiration_date,
        log.notes,
        log.reporting_period,
        d.signature_status,
        d.signed_at,
        u.display_name AS signed_by_name
     FROM dea_dispense_log_v log
     LEFT JOIN dispenses d ON d.dispense_id = log.dispense_id
     LEFT JOIN users u ON u.user_id = d.signed_by
     ${whereClause}
     ORDER BY log.transaction_time ASC`,
        params
    );

    const csv = toCsv(rows);
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = startDate && endDate
        ? `dea-log-${startDate}-to-${endDate}.csv`
        : `dea-log-all-${dateStr}.csv`;

    return new NextResponse(csv, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="${filename}"`
        }
    });
}
