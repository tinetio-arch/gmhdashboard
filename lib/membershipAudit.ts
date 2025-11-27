import { query } from './db';
import { createQuickBooksClient } from './quickbooks';

type AuditBase = {
  patient_name: string;
  plan_name: string | null;
  status: string | null;
  remaining_cycles: string | null;
  contract_end_date: string | null;
  outstanding_balance: string | null;
  category: string | null;
  norm_name: string;
  purchase_date: string | null;
  service_start_date: string | null;
};

type ReadyRow = AuditBase & {
  patient_id: string;
  matched_patient: string;
  clinicsync_patient_id: string;
};

type NeedsDataRow = AuditBase & {
  issue: string;
  patient_id: string | null;
  matched_patient: string | null;
  clinicsync_patient_id: string | null;
  clinicsync_name: string | null;
};

type InactiveRow = AuditBase;

export type DuplicatePatientRecord = {
  patient_id: string;
  patient_name: string;
  email: string | null;
  phone_primary: string | null;
  status_key: string | null;
  payment_method_key: string | null;
  client_type_key: string | null;
  has_active_membership: boolean;
};

export type DuplicateMembershipGroup = {
  patient_name: string;
  norm_name: string;
  memberships: AuditBase[];
  // Actual patient records (if found)
  patients?: DuplicatePatientRecord[];
};

export type MembershipAuditData = {
  readyToMap: ReadyRow[];
  needsData: NeedsDataRow[];
  inactive: InactiveRow[];
  duplicates: DuplicateMembershipGroup[];
};

export type QuickBooksRecurringRow = {
  qbCustomerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  templateName: string | null;
  amount: number | null;
  nextChargeDate: string | null;
  active: boolean;
};

export type QuickBooksPatientRow = {
  patient_id: string;
  full_name: string;
  email: string | null;
  phone_primary: string | null;
  payment_method: string | null;
  status_key: string | null;
};

export type QuickBooksInvoiceRow = {
  qb_invoice_id: string;
  patient_id: string | null;
  patient_name: string | null;
  invoice_number: string | null;
  balance: number;
  days_overdue: number;
  payment_status: string | null;
  status_key: string | null;
};

export type QuickBooksAuditData = {
  connected: boolean;
  unmappedRecurring: QuickBooksRecurringRow[];
  unmappedPatients: QuickBooksPatientRow[];
  overdueInvoices: QuickBooksInvoiceRow[];
};

const NORMALIZE_PATIENT_SQL =
  "lower(regexp_replace(regexp_replace(full_name, '^(mr\\.?|mrs\\.?|ms\\.?|dr\\.?|miss)\\s+', '', 'i'), '\\s+', ' ', 'g'))";

const NORMALIZE_VALUE_TEMPLATE =
  "lower(regexp_replace(regexp_replace(VALUE_PLACEHOLDER, '^(mr\\.?|mrs\\.?|ms\\.?|dr\\.?|miss)\\s+', '', 'i'), '\\s+', ' ', 'g'))";

const NORMALIZE_CLINICSYNC_SQL = NORMALIZE_VALUE_TEMPLATE.replace('VALUE_PLACEHOLDER', "raw_payload->>'name'");

export async function getMembershipAuditData(): Promise<MembershipAuditData> {
  const readyQuery = `
    WITH pkg AS (
      SELECT *, lower(norm_name) AS normalized_name
      FROM jane_packages_import
      WHERE COALESCE(status, '') <> ''
        AND lower(status) NOT LIKE 'inactive%'
        AND lower(status) NOT LIKE 'discharg%'
    ),
    patient_norm AS (
      SELECT
        patient_id,
        full_name,
        ${NORMALIZE_PATIENT_SQL} AS normalized_name,
        COUNT(*) OVER (PARTITION BY ${NORMALIZE_PATIENT_SQL}) AS name_count
      FROM patients
      WHERE COALESCE(payment_method,'') ILIKE '%jane%'
    ),
    cs_norm AS (
      SELECT
        clinicsync_patient_id,
        raw_payload->>'name' AS cs_name,
        ${NORMALIZE_CLINICSYNC_SQL} AS normalized_name,
        COUNT(*) OVER (PARTITION BY ${NORMALIZE_CLINICSYNC_SQL}) AS name_count
      FROM clinicsync_memberships
      WHERE COALESCE(membership_status,'') ILIKE 'active%'
    ),
    mapped AS (
      SELECT patient_id, clinicsync_patient_id FROM patient_clinicsync_mapping
    ),
    resolved AS (
      SELECT normalized_name FROM membership_audit_resolutions
    )
    SELECT
      pkg.patient_name,
      pkg.plan_name,
      pkg.status,
      pkg.remaining_cycles::text,
      pkg.contract_end_date::text,
      pkg.outstanding_balance::text,
      pkg.category,
      pkg.normalized_name AS norm_name,
      pkg.purchase_date::text,
      pkg.start_date::text AS service_start_date,
      pn.patient_id,
      pn.full_name AS matched_patient,
      cs.clinicsync_patient_id
    FROM pkg
    JOIN patient_norm pn ON pn.normalized_name = pkg.normalized_name
    JOIN cs_norm cs ON cs.normalized_name = pkg.normalized_name
    LEFT JOIN mapped m
      ON (m.patient_id = pn.patient_id OR m.clinicsync_patient_id = cs.clinicsync_patient_id)
    LEFT JOIN resolved r ON r.normalized_name = pkg.normalized_name
    WHERE pn.name_count = 1
      AND cs.name_count = 1
      AND m.patient_id IS NULL
      AND m.clinicsync_patient_id IS NULL
      AND r.normalized_name IS NULL
    ORDER BY pkg.patient_name;
  `;

  const needsDataQuery = `
    WITH pkg AS (
      SELECT *, lower(norm_name) AS normalized_name
      FROM jane_packages_import
      WHERE COALESCE(status, '') <> ''
        AND lower(status) NOT LIKE 'inactive%'
        AND lower(status) NOT LIKE 'discharg%'
    ),
    patient_norm AS (
      SELECT
        patient_id,
        full_name,
        ${NORMALIZE_PATIENT_SQL} AS normalized_name,
        COUNT(*) OVER (PARTITION BY ${NORMALIZE_PATIENT_SQL}) AS name_count
      FROM patients
      WHERE COALESCE(payment_method,'') ILIKE '%jane%'
    ),
    cs_norm AS (
      SELECT
        clinicsync_patient_id,
        raw_payload->>'name' AS cs_name,
        ${NORMALIZE_CLINICSYNC_SQL} AS normalized_name,
        COUNT(*) OVER (PARTITION BY ${NORMALIZE_CLINICSYNC_SQL}) AS name_count
      FROM clinicsync_memberships
      WHERE COALESCE(membership_status,'') ILIKE 'active%'
    ),
    mapped AS (
      SELECT patient_id, clinicsync_patient_id FROM patient_clinicsync_mapping
    ),
    resolved AS (
      SELECT normalized_name FROM membership_audit_resolutions
    )
    SELECT
      pkg.patient_name,
      pkg.plan_name,
      pkg.status,
      pkg.remaining_cycles::text,
      pkg.contract_end_date::text,
      pkg.outstanding_balance::text,
      pkg.category,
      pkg.normalized_name AS norm_name,
      pkg.purchase_date::text,
      pkg.start_date::text AS service_start_date,
      pn.patient_id,
      pn.full_name AS matched_patient,
      cs.clinicsync_patient_id,
      cs.cs_name AS clinicsync_name,
      CASE
        WHEN r.normalized_name IS NOT NULL THEN 'resolved'
        WHEN pn.patient_id IS NULL THEN 'no_gmh_match'
        WHEN pn.name_count > 1 THEN 'multiple_gmh_matches'
        WHEN cs.clinicsync_patient_id IS NULL THEN 'no_clinicsync_match'
        WHEN cs.name_count > 1 THEN 'multiple_clinicsync_matches'
        WHEN EXISTS (
          SELECT 1 FROM mapped m
          WHERE m.patient_id = pn.patient_id OR m.clinicsync_patient_id = cs.clinicsync_patient_id
        ) THEN 'already_mapped'
        ELSE 'unknown'
      END AS issue
    FROM pkg
    LEFT JOIN patient_norm pn ON pn.normalized_name = pkg.normalized_name
    LEFT JOIN cs_norm cs ON cs.normalized_name = pkg.normalized_name
    LEFT JOIN resolved r ON r.normalized_name = pkg.normalized_name
    WHERE
      (
        pn.patient_id IS NULL
        OR pn.name_count > 1
        OR cs.clinicsync_patient_id IS NULL
        OR cs.name_count > 1
        OR EXISTS (
          SELECT 1 FROM mapped m
          WHERE m.patient_id = pn.patient_id OR m.clinicsync_patient_id = cs.clinicsync_patient_id
        )
      )
      AND r.normalized_name IS NULL
    ORDER BY pkg.patient_name;
  `;

  const inactiveQuery = `
    SELECT
      patient_name,
      plan_name,
      status,
      remaining_cycles::text,
      contract_end_date::text,
      outstanding_balance::text,
      category,
      lower(norm_name) AS norm_name,
      purchase_date::text,
      start_date::text AS service_start_date
    FROM jane_packages_import
    WHERE COALESCE(status, '') = ''
      OR lower(status) LIKE 'inactive%'
      OR lower(status) LIKE 'discharg%'
    ORDER BY patient_name;
  `;

  // Enhanced duplicate query: Find both duplicate patients AND duplicate membership packages
  const duplicatesQuery = `
    WITH duplicate_packages AS (
      SELECT
        lower(norm_name) AS norm_name,
        MIN(patient_name) AS patient_name,
        json_agg(
          json_build_object(
            'patient_name', patient_name,
            'plan_name', plan_name,
            'status', status,
            'remaining_cycles', remaining_cycles::text,
            'contract_end_date', contract_end_date::text,
            'outstanding_balance', outstanding_balance::text,
            'category', category,
            'norm_name', lower(norm_name),
            'purchase_date', purchase_date::text,
            'service_start_date', start_date::text
          )
          ORDER BY plan_name
        ) AS memberships
      FROM jane_packages_import
      GROUP BY lower(norm_name)
      HAVING COUNT(*) > 1
    ),
    duplicate_patients AS (
      SELECT
        ${NORMALIZE_PATIENT_SQL} AS normalized_name,
        COUNT(*) AS patient_count,
        json_agg(
          json_build_object(
            'patient_id', patient_id::text,
            'patient_name', full_name,
            'email', email,
            'phone_primary', phone_primary,
            'status_key', status_key,
            'payment_method_key', payment_method_key,
            'client_type_key', client_type_key,
            'has_active_membership', EXISTS(
              SELECT 1 FROM jane_packages_import jpi
              WHERE lower(jpi.norm_name) = ${NORMALIZE_PATIENT_SQL}
                AND COALESCE(jpi.status, '') <> ''
                AND lower(jpi.status) NOT LIKE 'inactive%'
                AND lower(jpi.status) NOT LIKE 'discharg%'
            )
          )
          ORDER BY 
            CASE WHEN status_key = 'active' THEN 1 ELSE 2 END,
            full_name
        ) AS patients
      FROM patients
      WHERE status_key NOT IN ('inactive', 'discharged')
      GROUP BY ${NORMALIZE_PATIENT_SQL}
      HAVING COUNT(*) > 1
    ),
    combined_duplicates AS (
      SELECT
        COALESCE(dp.norm_name, dup.normalized_name) AS norm_name,
        COALESCE(dp.patient_name, (dup.patients->0->>'patient_name')) AS patient_name,
        COALESCE(dp.memberships, '[]'::json) AS memberships,
        COALESCE(dup.patients, '[]'::json) AS patients
      FROM duplicate_packages dp
      FULL OUTER JOIN duplicate_patients dup ON dp.norm_name = dup.normalized_name
      WHERE dp.norm_name IS NOT NULL OR dup.normalized_name IS NOT NULL
    )
    SELECT * FROM combined_duplicates
    ORDER BY patient_name;
  `;

  const [readyRows, needsRows, inactiveRows, duplicateRows] = await Promise.all([
    query<ReadyRow>(readyQuery),
    query<NeedsDataRow>(needsDataQuery),
    query<InactiveRow>(inactiveQuery),
    query<DuplicateMembershipGroup>(duplicatesQuery)
  ]);

  return {
    readyToMap: readyRows,
    needsData: needsRows,
    inactive: inactiveRows,
    duplicates: duplicateRows
  };
}

const EMPTY_QB_AUDIT: QuickBooksAuditData = {
  connected: false,
  unmappedRecurring: [],
  unmappedPatients: [],
  overdueInvoices: []
};

export async function getQuickBooksAuditData(): Promise<QuickBooksAuditData> {
  const qbClient = await createQuickBooksClient();
  if (!qbClient) {
    console.log('[QuickBooks Audit] No QB client available - OAuth not completed or tokens expired');
    return EMPTY_QB_AUDIT;
  }

  console.log('[QuickBooks Audit] QB client created successfully, fetching data...');
  try {
    const [recurringTemplates, customers, mappedRows, unmappedPatients, overdueInvoices] = await Promise.all([
      qbClient.getActiveRecurringTransactions(),
      qbClient.getCustomers(),
      query<{ qb_customer_id: string }>(
        `SELECT qb_customer_id
         FROM patient_qb_mapping
         WHERE is_active = TRUE`
      ),
      query<QuickBooksPatientRow>(
        `SELECT
           p.patient_id,
           p.full_name,
           p.email,
           p.phone_primary,
           p.payment_method,
           p.status_key
         FROM patients p
         LEFT JOIN patient_qb_mapping pqm
           ON pqm.patient_id = p.patient_id
           AND pqm.is_active = TRUE
         WHERE (COALESCE(p.payment_method,'') ILIKE '%quickbook%' OR p.payment_method_key = 'quickbooks')
           AND pqm.patient_id IS NULL
         ORDER BY p.full_name
         LIMIT 100`
      ),
      query<QuickBooksInvoiceRow>(
        `SELECT
           q.qb_invoice_id,
           p.patient_id,
           p.full_name AS patient_name,
           q.invoice_number,
           COALESCE(q.balance, 0)::numeric AS balance,
           COALESCE(q.days_overdue, 0) AS days_overdue,
           q.payment_status,
           p.status_key
         FROM quickbooks_payments q
         LEFT JOIN patient_qb_mapping pqm
           ON pqm.qb_customer_id = q.qb_customer_id
           AND pqm.is_active = TRUE
         LEFT JOIN patients p
           ON p.patient_id = pqm.patient_id
         WHERE q.balance > 0
         ORDER BY COALESCE(q.days_overdue, 0) DESC, q.balance DESC
         LIMIT 50`
      )
    ]);

    const mappedCustomerIds = new Set(mappedRows.map((row) => row.qb_customer_id));
    const customerMap = new Map(customers.map((customer) => [customer.Id, customer]));

    const recurringRows: QuickBooksRecurringRow[] = [];

    const addRecurringRow = (
      customerId: string,
      customerName: string,
      email: string | null,
      phone: string | null,
      templateName: string | null,
      amount: number | null,
      nextChargeDate: string | null,
      active: boolean
    ) => {
      if (!customerId || mappedCustomerIds.has(customerId)) {
        return;
      }
      recurringRows.push({
        qbCustomerId: customerId,
        customerName,
        email,
        phone,
        templateName,
        amount,
        nextChargeDate,
        active
      });
    };

    // QuickBooks wraps SalesReceipt inside RecurringTransaction
    recurringTemplates.forEach((template) => {
      const customerId = template.CustomerRef?.value ?? '';
      const customer = customerMap.get(customerId);
      const templateName = template.Name ?? `${template.Type ?? 'Recurring'}`;
      const amount = template.TotalAmt ?? null;
      const nextDate = qbClient.calculateNextChargeDate(template)?.toISOString().split('T')[0] ?? null;
      
      addRecurringRow(
        customerId,
        customer?.DisplayName ?? template.CustomerRef?.name ?? 'Unknown customer',
        customer?.PrimaryEmailAddr?.Address ?? null,
        customer?.PrimaryPhone?.FreeFormNumber ?? null,
        templateName,
        amount,
        nextDate,
        template.Active === true
      );
    });

    const unmappedRecurring = recurringRows.slice(0, 100);

    return {
      connected: true,
      unmappedRecurring,
      unmappedPatients,
      overdueInvoices
    };
  } catch (error) {
    console.error('[QuickBooks Audit] Error fetching audit data:', error);
    // Even if data fetch fails, we're still connected (client was created)
    return {
      connected: true,
      unmappedRecurring: [],
      unmappedPatients: [],
      overdueInvoices: []
    };
  }
}

