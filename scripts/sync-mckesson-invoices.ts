/**
 * Pulls invoice IDs from McKesson and upserts skeleton rows. Walks N 31-day
 * windows backwards from today.
 *
 *   tsx scripts/sync-mckesson-invoices.ts            # last 90 days, 3 windows
 *   tsx scripts/sync-mckesson-invoices.ts --days 365 # last year
 *
 * Detail fetch is a separate concern (see app/api/mckesson/invoices/[id]/details/route.ts)
 * because McKesson's detail endpoints currently 404 for our account — manual
 * line-item entry from the portal is the workaround until they fix it.
 */
import 'dotenv/config';
import {
  getInvoiceIds,
  getMcKessonAccountId,
  getMcKessonShipToAccountId,
  upsertInvoiceSkeleton,
} from '../lib/mckesson';

const args = process.argv.slice(2);
const daysIdx = args.indexOf('--days');
const totalDays = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : 90;
const WINDOW = 28;  // McKesson allows up to 31, use 28 for safety

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

async function main() {
  const billTo = getMcKessonAccountId();
  const shipTo = getMcKessonShipToAccountId();
  if (!billTo) throw new Error('MCKESSON_ACCOUNT_ID not set');

  console.log(`Sync: bill-to=${billTo}, ${totalDays} days back, ${WINDOW}-day windows.\n`);

  const today = new Date();
  let inserted = 0, updated = 0, totalSeen = 0;
  const allIds = new Set<string>();

  for (let offset = 0; offset < totalDays; offset += WINDOW) {
    const end = new Date(today);
    end.setDate(end.getDate() - offset);
    const start = new Date(end);
    start.setDate(start.getDate() - WINDOW);
    const startStr = ymd(start);
    const endStr = ymd(end);

    let pageOffset = 0;
    let hasNext = true;
    while (hasNext) {
      let res;
      try {
        res = await getInvoiceIds(billTo, { startDate: startStr, endDate: endStr, pageOffset, pageSize: 100 });
      } catch (e: any) {
        console.log(`  ${startStr}..${endStr} pg${pageOffset}: ERROR — ${e.message?.slice(0, 100)}`);
        break;
      }
      console.log(`  ${startStr}..${endStr} pg${pageOffset}: returned ${res.invoiceId.length} of ${res.totalElements}`);
      for (const invId of res.invoiceId) {
        if (allIds.has(invId)) continue;
        allIds.add(invId);
        totalSeen++;
        const r = await upsertInvoiceSkeleton({
          invoiceId: invId, accountId: billTo, shipToId: shipTo,
          windowStart: startStr, windowEnd: endStr,
        });
        if (r.inserted) inserted++; else updated++;
      }
      hasNext = res.hasNextPage;
      pageOffset++;
    }
  }
  console.log(`\nDone. Unique invoices seen: ${totalSeen}. Inserted: ${inserted}. Updated: ${updated}.`);
  process.exit(0);
}

main().catch((e) => { console.error('[INVOICE SYNC]', e); process.exit(1); });
