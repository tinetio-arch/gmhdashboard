import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { query } from './db';

export type DeaLogExportOptions = {
  startDate?: string | null;
  endDate?: string | null;
  bucket?: string | null;
  prefix?: string | null;
};

const EXPORT_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

let s3Client: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (s3Client) {
    return s3Client;
  }
  const region = process.env.AWS_S3_REGION ?? process.env.AWS_REGION ?? process.env.S3_REGION;
  if (!region) {
    return null;
  }
  s3Client = new S3Client({ region });
  return s3Client;
}

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

export async function exportDeaLogToS3(options: DeaLogExportOptions = {}): Promise<{ key: string } | null> {
  const bucket = options.bucket ?? process.env.DEA_EXPORT_BUCKET ?? process.env.REPORT_BUCKET;
  if (!bucket) {
    console.warn('DEA export skipped: bucket not configured.');
    return null;
  }

  const startDate = options.startDate ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const endDate = options.endDate ?? new Date().toISOString();

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
     WHERE log.transaction_time BETWEEN $1 AND $2
     ORDER BY log.transaction_time ASC`,
    [startDate, endDate]
  );

  if (!rows.length) {
    console.warn('DEA export skipped: no records in range.');
    return null;
  }

  const csv = toCsv(rows);
  const now = new Date();
  const formatted = EXPORT_DATE_FORMAT.format(now).replace(/\//g, '-');
  const prefix = options.prefix ?? process.env.DEA_EXPORT_PREFIX ?? 'dea-exports';
  const key = `${prefix.replace(/\/$/, '')}/dea-log-${formatted}.csv`;

  const client = getS3Client();
  if (!client) {
    console.warn('DEA export skipped: S3 region not configured.');
    return null;
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: csv,
        ContentType: 'text/csv'
      })
    );
    return { key };
  } catch (error) {
    console.error('Failed to upload DEA export', error);
    return null;
  }
}


