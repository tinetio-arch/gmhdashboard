import { query } from './db';
import { fetchDashboardMetrics } from './metricsQueries';

/**
 * Analytics domain module
 * -----------------------
 * Produces summaries (morning briefing, overdue labs, revenue snapshots, etc.)
 * by aggregating Postgres analytics queries with Healthie/GHL data.
 */

export type MorningBriefingSummary = {
  schedule: Array<{ patientId: string | null; name: string; startAt: string; reason?: string | null }>;
  urgentLabs: Array<{ patientId: string; name: string; daysOverdue: number }>;
  deaStatus: { totalDispenses: number; unsignedDispenses: number; lastAuditAt?: string | null };
  payments: Array<{ patientId: string | null; name: string; status: string; amount: number }>;
  keyMetrics: { activePatients: number; holdPatients: number; pendingSignatures: number; weeksSinceAudit: number };
};

export type OverdueLabReport = {
  total: number;
  entries: Array<{ patientId: string; name: string; daysOverdue: number }>;
};

export type RevenueSummary = {
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  breakdown: Record<string, number>;
};

export type DeaStatusSummary = {
  totalDispenses: number;
  unsignedDispenses: number;
  lastAuditAt?: string | null;
};

export interface AnalyticsService {
  getMorningBriefing(date: string): Promise<MorningBriefingSummary>;
  getOverdueLabs(limit?: number): Promise<OverdueLabReport>;
  getRevenueSummary(range: { start: string; end: string }): Promise<RevenueSummary>;
  getDeaStatus(): Promise<DeaStatusSummary>;
}

async function fetchScheduleForDate(date: string) {
  try {
    const rows = await query<{
      patient_id: string | null;
      patient_name: string;
      next_lab: string;
    }>(
      `
        SELECT
          patient_id,
          patient_name,
          next_lab::text AS next_lab
        FROM professional_patient_dashboard_v
        WHERE next_lab::date = $1::date
        ORDER BY next_lab ASC NULLS LAST
        LIMIT 15
      `,
      [date]
    );

    return rows.map((row) => ({
      patientId: row.patient_id,
      name: row.patient_name,
      startAt: row.next_lab,
      reason: 'Upcoming lab',
    }));
  } catch (error) {
    console.warn('[analytics] Failed to load schedule summary:', error);
    return [];
  }
}

async function fetchPendingPayments(limit = 10) {
  try {
    const rows = await query<{
      patient_id: string | null;
      patient_name: string;
      amount: number;
      status: string;
    }>(
      `
        SELECT
          hi.patient_id,
          COALESCE(p.full_name, hi.patient_id::text, 'Unknown Patient') AS patient_name,
          hi.amount::numeric AS amount,
          hi.status
        FROM healthie_invoices hi
        LEFT JOIN patients p ON p.patient_id = hi.patient_id
        WHERE hi.status IN ('sent', 'draft')
        ORDER BY hi.sent_at DESC NULLS LAST, hi.created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    return rows.map((row) => ({
      patientId: row.patient_id,
      name: row.patient_name,
      status: row.status,
      amount: Number(row.amount ?? 0),
    }));
  } catch (error) {
    console.warn('[analytics] Failed to load pending payments:', error);
    return [];
  }
}

async function fetchOverdueLabEntries(limit = 25) {
  const rows = await query<{
    patient_id: string;
    patient_name: string;
    days_overdue: number;
  }>(
    `
      SELECT
        patient_id,
        patient_name,
        GREATEST(0, (CURRENT_DATE - next_lab::date))::int AS days_overdue
      FROM professional_patient_dashboard_v
      WHERE next_lab IS NOT NULL
        AND next_lab::date < CURRENT_DATE
        AND COALESCE(lab_status, '') ILIKE 'overdue%'
      ORDER BY next_lab ASC
      LIMIT $1
    `,
    [limit]
  );

  return rows;
}

async function fetchRevenue(range: { start: string; end: string }) {
  const rows = await query<{ total: number }>(
    `
      SELECT COALESCE(SUM(amount), 0)::numeric AS total
      FROM healthie_invoices
      WHERE paid_at BETWEEN $1::timestamp AND $2::timestamp
    `,
    [range.start, range.end]
  );

  return rows[0]?.total ? Number(rows[0].total) : 0;
}

async function fetchDeaCounts(): Promise<DeaStatusSummary> {
  const [counts] = await query<{ total: number; unsigned: number }>(
    `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE COALESCE(signature_status, 'awaiting_signature') <> 'signed') AS unsigned
      FROM dispenses
    `
  );

  const [audit] = await query<{ last_audit: string | null }>(
    `SELECT MAX(created_at)::text AS last_audit FROM weekly_inventory_audits`
  );

  return {
    totalDispenses: counts?.total ?? 0,
    unsignedDispenses: counts?.unsigned ?? 0,
    lastAuditAt: audit?.last_audit ?? null,
  };
}

export const analyticsService: AnalyticsService = {
  async getMorningBriefing(date) {
    const [schedule, overdueReport, deaStatus, payments, metrics] = await Promise.all([
      fetchScheduleForDate(date),
      fetchOverdueLabEntries(10),
      fetchDeaCounts(),
      fetchPendingPayments(10),
      fetchDashboardMetrics(),
    ]);

    return {
      schedule,
      urgentLabs: overdueReport.slice(0, 5).map((row) => ({
        patientId: row.patient_id,
        name: row.patient_name,
        daysOverdue: row.days_overdue,
      })),
      deaStatus,
      payments,
      keyMetrics: {
        activePatients: metrics.activePatients,
        holdPatients: metrics.holdPatients,
        pendingSignatures: metrics.pendingSignatures,
        weeksSinceAudit: metrics.weeksSinceAudit,
      },
    };
  },

  async getOverdueLabs(limit = 25) {
    const entries = await fetchOverdueLabEntries(limit);
    return {
      total: entries.length,
      entries: entries.map((row) => ({
        patientId: row.patient_id,
        name: row.patient_name,
        daysOverdue: row.days_overdue,
      })),
    };
  },

  async getRevenueSummary(range) {
    const totalRevenue = await fetchRevenue(range);
    return {
      periodStart: range.start,
      periodEnd: range.end,
      totalRevenue,
      breakdown: {
        invoices: totalRevenue,
      },
    };
  },

  async getDeaStatus() {
    return fetchDeaCounts();
  },
};

