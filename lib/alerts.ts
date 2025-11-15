import { query } from './db';
import {
  TESTOSTERONE_VENDORS,
  normalizeTestosteroneVendor
} from './testosterone';
import { sendInventoryAlert } from './notifications';

const DEFAULT_THRESHOLD = Number(process.env.CONTROLLED_VIAL_THRESHOLD ?? '10');
const ALERT_SILENCE_MS = 60 * 60 * 1000; // 1 hour

const lastAlertSent: Record<string, number> = {};

type ControlledVialRow = {
  dea_drug_name: string | null;
  remaining_volume_ml: string | null;
  status: string | null;
};

export async function evaluateInventoryThresholds(): Promise<void> {
  const rows = await query<ControlledVialRow>(
    `SELECT dea_drug_name, remaining_volume_ml::text, status
       FROM vials
      WHERE controlled_substance = TRUE`
  );

  const counts = new Map<string, { total: number; available: number }>();

  for (const vendor of TESTOSTERONE_VENDORS) {
    counts.set(vendor, { total: 0, available: 0 });
  }

  rows.forEach((row) => {
    const vendor = normalizeTestosteroneVendor(row.dea_drug_name) ?? 'Other';
    const bucket = counts.get(vendor) ?? { total: 0, available: 0 };
    bucket.total += 1;
    const remaining = Number.parseFloat(row.remaining_volume_ml ?? '0');
    if (!Number.isNaN(remaining) && remaining > 0.1) {
      bucket.available += 1;
    }
    counts.set(vendor, bucket);
  });

  await Promise.all(
    Array.from(counts.entries()).map(async ([vendor, stats]) => {
      if (vendor === 'Other') {
        return;
      }
      if (stats.available >= DEFAULT_THRESHOLD) {
        return;
      }
      const previous = lastAlertSent[vendor] ?? 0;
      const now = Date.now();
      if (now - previous < ALERT_SILENCE_MS) {
        return;
      }
      await sendInventoryAlert({
        vendor,
        available: stats.available,
        total: stats.total,
        threshold: DEFAULT_THRESHOLD
      });
      lastAlertSent[vendor] = now;
    })
  );
}

