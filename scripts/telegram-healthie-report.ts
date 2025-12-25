import 'dotenv/config';
import snowflake from 'snowflake-sdk';
import fetch from 'node-fetch';

type RollupRow = {
  TOTAL_INVOICED: number | null;
  TOTAL_PAID_ON_INVOICES: number | null;
  TOTAL_INVOICE_BALANCE: number | null;
  DIRECT_PAYMENTS: number | null;
  BILLING_ITEM_PAID: number | null;
  PACKAGE_PAID: number | null;
  PACKAGE_REMAINING: number | null;
  LAST_PAYMENT_ACTIVITY: string | null;
  UNPAID_HEALTHIE_PATIENTS: number | null;
  UNPAID_PATIENTS_ALL: number | null;
  PATIENTS: number | null;
};

const {
  SNOWFLAKE_ACCOUNT,
  SNOWFLAKE_USER,
  SNOWFLAKE_PASSWORD,
  SNOWFLAKE_WAREHOUSE = 'GMH_WAREHOUSE',
  SNOWFLAKE_DATABASE = 'GMH_CLINIC',
  SNOWFLAKE_SCHEMA = 'FINANCIAL_DATA',
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
} = process.env;

function assertEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function fetchRollup(): Promise<RollupRow> {
  const connection = snowflake.createConnection({
    account: assertEnv('SNOWFLAKE_ACCOUNT', SNOWFLAKE_ACCOUNT),
    username: assertEnv('SNOWFLAKE_USER', SNOWFLAKE_USER),
    password: assertEnv('SNOWFLAKE_PASSWORD', SNOWFLAKE_PASSWORD),
    warehouse: SNOWFLAKE_WAREHOUSE,
    database: SNOWFLAKE_DATABASE,
    schema: SNOWFLAKE_SCHEMA,
  });

  await new Promise<void>((resolve, reject) => {
    connection.connect((err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const sql = `
with payment_methods as (
  select patient_id,
         card_brand || ' ' || card_last4 as default_card,
         synced_at as last_method_synced,
         count(*) over (partition by patient_id) as method_count,
         sum(iff(is_default,1,0)) over (partition by patient_id) as default_count,
         row_number() over (partition by patient_id order by is_default desc, synced_at desc) as rn
  from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PAYMENT_METHODS
  qualify rn = 1
), invoices as (
  select patient_id, invoice_id, amount, paid_amount, remaining_balance, status, invoice_date
  from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_INVOICES
), payments as (
  select i.patient_id, sum(p.amount_dollars) as direct_payments, max(p.created_at) as last_direct_payment
  from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PAYMENTS p
  join invoices i on p.invoice_id = i.invoice_id
  group by i.patient_id
), billing as (
  select patient_id, sum(coalesce(amount_paid,0)) as billing_item_paid, max(payment_date) as last_billing_payment
  from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_BILLING_ITEMS
  group by patient_id
), packages as (
  select patient_id,
         sum(coalesce(amount_paid,0)) as package_paid,
         sum(coalesce(amount_remaining,0)) as package_remaining,
         max(created_at) as last_package_purchase
  from GMH_CLINIC.FINANCIAL_DATA.HEALTHIE_PACKAGE_PURCHASES
  group by patient_id
), rollup as (
  select pat.patient_id, pat.patient_name, pat.email, pat.payment_method,
         pm.default_card, (pm.default_count > 0) as has_default_method, pm.method_count, pm.last_method_synced,
         sum(coalesce(inv.amount,0)) as total_invoiced,
         sum(coalesce(inv.paid_amount,0)) as total_paid_on_invoices,
         sum(coalesce(inv.remaining_balance,0)) as total_invoice_balance,
         pay.direct_payments,
         bill.billing_item_paid,
         pkg.package_paid,
         pkg.package_remaining,
         coalesce(pay.direct_payments,0) + coalesce(bill.billing_item_paid,0) + coalesce(pkg.package_paid,0) as total_all_payments,
         greatest(coalesce(pay.last_direct_payment, to_timestamp_ltz(0)), coalesce(bill.last_billing_payment, to_timestamp_ltz(0)), coalesce(pkg.last_package_purchase, to_timestamp_ltz(0))) as last_payment_activity
  from GMH_CLINIC.PATIENT_DATA.PATIENTS pat
  left join payment_methods pm on pat.patient_id = pm.patient_id
  left join invoices inv on pat.patient_id = inv.patient_id
  left join payments pay on pat.patient_id = pay.patient_id
  left join billing bill on pat.patient_id = bill.patient_id
  left join packages pkg on pat.patient_id = pkg.patient_id
  group by pat.patient_id, pat.patient_name, pat.email, pat.payment_method,
           pm.default_card, pm.default_count, pm.method_count, pm.last_method_synced,
           pay.direct_payments, bill.billing_item_paid, pkg.package_paid, pkg.package_remaining,
           pay.last_direct_payment, bill.last_billing_payment, pkg.last_package_purchase
)
select
  sum(coalesce(total_invoiced,0)) as total_invoiced,
  sum(coalesce(total_paid_on_invoices,0)) as total_paid_on_invoices,
  sum(coalesce(total_invoice_balance,0)) as total_invoice_balance,
  sum(coalesce(direct_payments,0)) as direct_payments,
  sum(coalesce(billing_item_paid,0)) as billing_item_paid,
  sum(coalesce(package_paid,0)) as package_paid,
  sum(coalesce(package_remaining,0)) as package_remaining,
  max(last_payment_activity) as last_payment_activity,
  sum(iff(payment_method ilike '%healthie%' and coalesce(total_invoice_balance,0) > 0, 1, 0)) as unpaid_healthie_patients,
  sum(iff(coalesce(total_invoice_balance,0) > 0, 1, 0)) as unpaid_patients_all,
  count(*) as patients
from rollup;
`;

  const result: RollupRow = await new Promise((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      complete: (err, _stmt, rows) => {
        if (err) return reject(err);
        resolve((rows ?? [])[0] as RollupRow);
      },
    });
  });

  connection.destroy((err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error('Error destroying Snowflake connection', err);
    }
  });
  return result;
}

function formatCurrency(n: number | null) {
  const val = Number(n || 0);
  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function sendTelegram(text: string) {
  const token = assertEnv('TELEGRAM_BOT_TOKEN', TELEGRAM_BOT_TOKEN);
  const chatId = assertEnv('TELEGRAM_CHAT_ID', TELEGRAM_CHAT_ID);
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram send failed: ${res.status} ${body}`);
  }
}

function buildMessage(row: RollupRow) {
  const lines = [
    '*Healthie Payments Snapshot*',
    `Total collected (all channels): ${formatCurrency(row.DIRECT_PAYMENTS)}`,
    `Invoice totals: ${formatCurrency(row.TOTAL_INVOICED)} invoiced | ${formatCurrency(row.TOTAL_PAID_ON_INVOICES)} paid | ${formatCurrency(row.TOTAL_INVOICE_BALANCE)} open`,
    `Recurring billing collected: ${formatCurrency(row.BILLING_ITEM_PAID)}`,
    `Packages: ${formatCurrency(row.PACKAGE_PAID)} paid | ${formatCurrency(row.PACKAGE_REMAINING)} remaining`,
    `Patients with open balances (Healthie-labeled): ${row.UNPAID_HEALTHIE_PATIENTS ?? 0}`,
    `Patients with open balances (all): ${row.UNPAID_PATIENTS_ALL ?? 0}`,
    `Patients counted: ${row.PATIENTS ?? 0}`,
    `Last payment activity: ${row.LAST_PAYMENT_ACTIVITY ?? 'n/a'}`,
  ];
  return lines.join('\n');
}

async function main() {
  const row = await fetchRollup();
  const msg = buildMessage(row);
  await sendTelegram(msg);
  // eslint-disable-next-line no-console
  console.log('Sent Telegram snapshot');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to send Telegram report', err);
  process.exitCode = 1;
});
