import { query } from './db';

export type DeaLogRow = {
  transaction_time: string | null;
  dea_drug_name: string | null;
  dea_drug_code: string | null;
  dea_schedule: string | null;
  quantity_dispensed: number | null;
  units: string | null;
  prescriber: string | null;
  patient_name: string | null;
  phone_primary: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  lot_number: string | null;
  expiration_date: string | null;
  notes: string | null;
};

export async function fetchRecentDeaLog(options?: {
  limit?: number;
  startDate?: string;
  endDate?: string;
}): Promise<DeaLogRow[]> {
  const limit = options?.limit ?? 500;
  const startDate = options?.startDate;
  const endDate = options?.endDate;

  // NOTE: DEA log shows ALL historical dispenses, regardless of patient status.
  // This is critical for audit compliance - we must maintain complete records.
  let whereClause = '';
  const params: unknown[] = [limit];

  if (startDate && endDate) {
    whereClause = `WHERE transaction_time >= $2 AND transaction_time < ($3::date + 1)`;
    params.push(startDate, endDate);
  } else if (startDate) {
    whereClause = `WHERE transaction_time >= $2`;
    params.push(startDate);
  } else if (endDate) {
    whereClause = `WHERE transaction_time < ($2::date + 1)`;
    params.push(endDate);
  }

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM dea_dispense_log_v ${whereClause} ORDER BY transaction_time DESC NULLS LAST LIMIT $1`,
    params
  );
  return rows.map((row) => ({
    transaction_time: row.transaction_time as string | null,
    dea_drug_name: row.dea_drug_name as string | null,
    dea_drug_code: row.dea_drug_code as string | null,
    dea_schedule: row.dea_schedule as string | null,
    quantity_dispensed: row.quantity_dispensed !== null && row.quantity_dispensed !== undefined
      ? Number(row.quantity_dispensed)
      : null,
    units: row.units as string | null,
    prescriber: row.prescriber as string | null,
    patient_name: row.patient_name as string | null,
    phone_primary: row.phone_primary as string | null,
    address_line1: row.address_line1 as string | null,
    city: row.city as string | null,
    state: row.state as string | null,
    postal_code: row.postal_code as string | null,
    lot_number: row.lot_number as string | null,
    expiration_date: row.expiration_date as string | null,
    notes: row.notes as string | null
  }));
}
