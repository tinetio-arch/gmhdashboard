import { query } from './db';

/**
 * Audit logging domain module
 * ---------------------------
 * Every significant side effect (messages, prescriptions, dispenses, etc.)
 * should pass through this helper so we maintain a consistent audit trail.
 */

export type AuditEvent = {
  actorId: string;
  patientId?: string;
  action: string;
  system: 'HEALTHIE' | 'GHL' | 'DEA' | 'DB' | 'EMAIL' | 'TELEGRAM';
  payload?: Record<string, unknown>;
  createdAt?: string;
};

export interface AuditService {
  logEvent(event: AuditEvent): Promise<void>;
}

let auditTableEnsured = false;

async function ensureAuditTable(): Promise<void> {
  if (auditTableEnsured) {
    return;
  }
  await query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actor_id TEXT NOT NULL,
      patient_id TEXT NULL,
      system TEXT NOT NULL,
      action TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_patient ON audit_events(patient_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_system ON audit_events(system);
  `);
  auditTableEnsured = true;
}

export const auditService: AuditService = {
  async logEvent(event) {
    try {
      await ensureAuditTable();
      await query(
        `
          INSERT INTO audit_events (actor_id, patient_id, system, action, payload)
          VALUES ($1, $2, $3, $4, $5::jsonb)
        `,
        [
          event.actorId,
          event.patientId ?? null,
          event.system,
          event.action,
          event.payload ? JSON.stringify(event.payload) : null,
        ]
      );
    } catch (error) {
      console.error('[audit] Failed to log event:', error);
    }
  },
};

