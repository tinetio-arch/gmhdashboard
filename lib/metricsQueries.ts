import { query } from './db';

export type DashboardMetrics = {
  totalPatients: number;
  activePatients: number;
  holdPatients: number;
  upcomingLabs: number;
  controlledDispensesLast30: number;
  pendingSignatures: number;
  weeksSinceAudit: number;
  holdPaymentResearch: number;
  holdContractRenewal: number;
  inactivePatients: number;
};

export type RecentlyEditedPatient = {
  patientId: string;
  patientName: string;
  statusKey: string | null;
  alertStatus: string | null;
  lastModified: string | null;
  lastEditor: string | null;
};

export type RecentlyDispensedPatient = {
  dispenseId: string;
  patientId: string | null;
  patientName: string | null;
  dispensedAt: string | null;
  enteredBy: string | null;
  signedBy: string | null;
  medication: string | null;
  totalAmount: string | null;
};

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  try {
    const [counts] = await query<DashboardMetrics>(
      `
      SELECT
        -- Only count patients that are NOT inactive or deleted
        COUNT(*) FILTER (
          WHERE NOT (
            COALESCE(status_key, '') ILIKE 'inactive%'
            OR COALESCE(status_key, '') ILIKE 'discharg%'
            OR status_key IN ('inactive', 'inactive_patient', 'discharged')
          )
        ) AS "totalPatients",
        COUNT(*) FILTER (WHERE status_key = 'active') AS "activePatients",
        COUNT(*) FILTER (WHERE status_key LIKE 'hold_%') AS "holdPatients",
        COUNT(*) FILTER (
          WHERE next_lab IS NOT NULL 
            AND next_lab <= CURRENT_DATE + INTERVAL '30 days'
            AND NOT (
              COALESCE(status_key, '') ILIKE 'inactive%'
              OR COALESCE(status_key, '') ILIKE 'discharg%'
            )
        ) AS "upcomingLabs",
        COALESCE((
          SELECT COUNT(*)
          FROM dea_dispense_log_v
          WHERE transaction_time >= CURRENT_DATE - INTERVAL '30 days'
        ), 0) AS "controlledDispensesLast30",
        COALESCE((
          SELECT COUNT(*)
          FROM provider_signature_queue_v
          WHERE COALESCE(signature_status, 'awaiting_signature') <> 'signed'
        ), 0) AS "pendingSignatures",
        COALESCE((
          SELECT EXTRACT(EPOCH FROM (NOW() - MAX(audit_week))) / 604800
          FROM weekly_inventory_audits
        ), 0) AS "weeksSinceAudit",
        COUNT(*) FILTER (WHERE status_key = 'hold_payment_research') AS "holdPaymentResearch",
        COUNT(*) FILTER (WHERE status_key = 'hold_contract_renewal') AS "holdContractRenewal",
        COUNT(*) FILTER (
          WHERE status_key IN ('inactive', 'inactive_patient', 'discharged')
             OR status_key LIKE 'inactive%'
        ) AS "inactivePatients"
      FROM professional_patient_dashboard_v;
      `
    );

    return counts ?? {
      totalPatients: 0,
      activePatients: 0,
      holdPatients: 0,
      upcomingLabs: 0,
      controlledDispensesLast30: 0,
      pendingSignatures: 0,
      weeksSinceAudit: 0,
      holdPaymentResearch: 0,
      holdContractRenewal: 0,
      inactivePatients: 0
    };
  } catch (error: unknown) {
    // Handle missing views/tables gracefully
    console.error('Error fetching dashboard metrics:', error);
    // Try to get basic patient counts without the problematic views
    try {
      const [basicCounts] = await query<{
        totalPatients: number;
        activePatients: number;
        holdPatients: number;
        upcomingLabs: number;
        holdPaymentResearch: number;
        holdContractRenewal: number;
        inactivePatients: number;
      }>(
        `
        SELECT
          COUNT(*) AS "totalPatients",
          COUNT(*) FILTER (WHERE status_key = 'active') AS "activePatients",
          COUNT(*) FILTER (WHERE status_key LIKE 'hold_%') AS "holdPatients",
          COUNT(*) FILTER (WHERE next_lab IS NOT NULL AND next_lab <= CURRENT_DATE + INTERVAL '30 days') AS "upcomingLabs",
          COUNT(*) FILTER (WHERE status_key = 'hold_payment_research') AS "holdPaymentResearch",
          COUNT(*) FILTER (WHERE status_key = 'hold_contract_renewal') AS "holdContractRenewal",
          COUNT(*) FILTER (
            WHERE status_key IN ('inactive', 'inactive_patient', 'discharged')
               OR status_key LIKE 'inactive%'
          ) AS "inactivePatients"
        FROM professional_patient_dashboard_v;
        `
      );
      return {
        ...(basicCounts ?? {
          totalPatients: 0,
          activePatients: 0,
          holdPatients: 0,
          upcomingLabs: 0,
          holdPaymentResearch: 0,
          holdContractRenewal: 0,
          inactivePatients: 0
        }),
        controlledDispensesLast30: 0,
        pendingSignatures: 0,
        weeksSinceAudit: 0
      };
    } catch (fallbackError: unknown) {
      console.error('Error fetching basic metrics:', fallbackError);
      return {
        totalPatients: 0,
        activePatients: 0,
        holdPatients: 0,
        upcomingLabs: 0,
        controlledDispensesLast30: 0,
        pendingSignatures: 0,
        weeksSinceAudit: 0,
        holdPaymentResearch: 0,
        holdContractRenewal: 0,
        inactivePatients: 0
      };
    }
  }
}

export async function fetchRecentlyEditedPatients(limit = 5): Promise<RecentlyEditedPatient[]> {
  const rows = await query<RecentlyEditedPatient>(
    `
      SELECT
        patient_id AS "patientId",
        patient_name AS "patientName",
        status_key AS "statusKey",
        alert_status AS "alertStatus",
        to_char(last_modified, 'Mon DD, HH24:MI') AS "lastModified",
        added_by AS "lastEditor"
      FROM patient_data_entry_v
      WHERE last_modified IS NOT NULL
      ORDER BY last_modified DESC
      LIMIT $1
    `,
    [limit]
  );

  return rows;
}

export async function fetchRecentlyDispensedPatients(limit = 5): Promise<RecentlyDispensedPatient[]> {
  return query<RecentlyDispensedPatient>(
    `
      SELECT
        d.dispense_id AS "dispenseId",
        d.patient_id AS "patientId",
        COALESCE(p.full_name, d.patient_name) AS "patientName",
        to_char(COALESCE(dt.transaction_time, d.dispense_date::timestamp), 'Mon DD, HH24:MI') AS "dispensedAt",
        cu.display_name AS "enteredBy",
        su.display_name AS "signedBy",
        COALESCE(dt.dea_drug_name, v.dea_drug_name) AS "medication",
        d.total_amount::text AS "totalAmount"
      FROM dispenses d
      LEFT JOIN patients p ON p.patient_id = d.patient_id
      LEFT JOIN vials v ON v.vial_id = d.vial_id
      LEFT JOIN dea_transactions dt ON dt.dispense_id = d.dispense_id
      LEFT JOIN users cu ON cu.user_id = d.created_by
      LEFT JOIN users su ON su.user_id = d.signed_by
      ORDER BY COALESCE(dt.transaction_time, d.dispense_date::timestamp) DESC NULLS LAST, d.dispense_id DESC
      LIMIT $1
    `,
    [limit]
  );
}
