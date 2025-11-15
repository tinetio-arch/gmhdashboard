import { query } from './db';

export type DashboardMetrics = {
  totalPatients: number;
  activePatients: number;
  holdPatients: number;
  upcomingLabs: number;
  controlledDispensesLast30: number;
  pendingSignatures: number;
  weeksSinceAudit: number;
};

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const [counts] = await query<DashboardMetrics>(
    `
    SELECT
      COUNT(*) AS "totalPatients",
      COUNT(*) FILTER (WHERE status_key = 'active') AS "activePatients",
      COUNT(*) FILTER (WHERE status_key LIKE 'hold_%') AS "holdPatients",
      COUNT(*) FILTER (WHERE next_lab IS NOT NULL AND next_lab <= CURRENT_DATE + INTERVAL '30 days') AS "upcomingLabs",
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
      ), 0) AS "weeksSinceAudit"
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
    weeksSinceAudit: 0
  };
}
