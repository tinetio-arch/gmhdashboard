import { query, getPool } from './db';

export type AuditRecord = {
  audit_id: string;
  audit_week: string;
  performed_by: string | null;
  performed_by_name: string | null;
  audit_notes: string | null;
  created_at: string;
};

export type AuditSummary = {
  last_audit_week: string | null;
  weeks_since: number;
};

export async function fetchAuditHistory(limit = 12): Promise<AuditRecord[]> {
  return query<AuditRecord>(
    `SELECT
        a.audit_id,
        a.audit_week::text,
        a.performed_by,
        u.display_name AS performed_by_name,
        a.audit_notes,
        a.created_at::text
     FROM weekly_inventory_audits a
     LEFT JOIN users u ON u.user_id = a.performed_by
     ORDER BY a.audit_week DESC
     LIMIT $1`,
    [limit]
  );
}

export async function fetchAuditSummary(): Promise<AuditSummary> {
  const [row] = await query<{ last_audit_week: string | null; weeks_since: string | null }>(
    `SELECT
        MAX(audit_week)::text AS last_audit_week,
        EXTRACT(WEEK FROM NOW()) - EXTRACT(WEEK FROM MAX(audit_week)) AS weeks_since
     FROM weekly_inventory_audits`
  );
  return {
    last_audit_week: row?.last_audit_week ?? null,
    weeks_since: row?.weeks_since ? Number(row.weeks_since) : 0
  };
}

export async function createOrUpdateAudit({
  performedBy,
  notes,
  auditWeek
}: {
  performedBy: string;
  notes: string | null;
  auditWeek?: string | null;
}): Promise<AuditRecord> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<AuditRecord>(
      `INSERT INTO weekly_inventory_audits (audit_week, performed_by, audit_notes)
       VALUES (COALESCE($2, date_trunc('week', NOW())::date), $1, $3)
       ON CONFLICT (audit_week)
       DO UPDATE SET performed_by = EXCLUDED.performed_by,
                     audit_notes = EXCLUDED.audit_notes,
                     created_at = NOW()
       RETURNING audit_id,
                 audit_week::text,
                 performed_by,
                 audit_notes,
                 created_at::text,
                 NULL::text AS performed_by_name`,
      [performedBy, auditWeek ?? null, notes]
    );
    const auditId = result.rows[0].audit_id;
    const enriched = await client.query<AuditRecord>(
      `SELECT
          a.audit_id,
          a.audit_week::text,
          a.performed_by,
          u.display_name AS performed_by_name,
          a.audit_notes,
          a.created_at::text
       FROM weekly_inventory_audits a
       LEFT JOIN users u ON u.user_id = a.performed_by
       WHERE a.audit_id = $1`,
      [auditId]
    );
    await client.query('COMMIT');
    return enriched.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
