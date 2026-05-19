export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { query } from '@/lib/db';

// PHASE 3 (2026-05-19): SoT-enforcement surface. Lists demographic conflicts
// where an external system (Healthie today) reported a value that differs from
// the populated /ops value — /ops kept, external rejected and logged here.
// Read-only for now; resolution action buttons come later.

const SECTION: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '0.625rem',
  padding: '1rem 1.25rem',
  marginBottom: '1rem',
};
const TABLE: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' };
const TH: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.4rem 0.6rem',
  background: '#f1f5f9',
  color: '#334155',
  fontWeight: 600,
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const TD: React.CSSProperties = { padding: '0.45rem 0.6rem', borderTop: '1px solid #e2e8f0', color: '#0f172a' };
const PILL = (state: 'ok' | 'action'): React.CSSProperties => ({
  fontSize: '0.7rem',
  fontWeight: 700,
  padding: '0.15rem 0.5rem',
  borderRadius: '999px',
  background: state === 'ok' ? '#dcfce7' : '#fee2e2',
  color: state === 'ok' ? '#166534' : '#991b1b',
});

type ConflictRow = {
  id: string;
  patient_id: string;
  full_name: string | null;
  source_system: string;
  field_name: string;
  ops_value: string | null;
  external_value: string | null;
  detected_at: string;
  resolution_status: string;
};

type SkipRow = {
  reason: string;
  cnt: string;
};

export default async function SyncConflictsPage() {
  await requireUser('admin');

  const [conflicts, skipSummary] = await Promise.all([
    query<ConflictRow>(
      `SELECT sc.id, sc.patient_id, p.full_name, sc.source_system, sc.field_name,
              sc.ops_value, sc.external_value, sc.detected_at, sc.resolution_status
         FROM sync_conflicts sc
         LEFT JOIN patients p ON p.patient_id = sc.patient_id
        WHERE sc.resolution_status = 'pending'
        ORDER BY sc.detected_at DESC
        LIMIT 200`
    ),
    query<SkipRow>(
      `SELECT reason, COUNT(*)::text AS cnt
         FROM patient_sync_skips
        WHERE detected_at > NOW() - INTERVAL '7 days'
        GROUP BY reason
        ORDER BY COUNT(*) DESC`
    ),
  ]);

  const skipTotal = skipSummary.reduce((acc, r) => acc + Number(r.cnt), 0);

  return (
    <section style={{ padding: '2rem', maxWidth: '80rem', margin: '0 auto' }}>
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem' }}>Sync Conflicts</h1>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
            Demographic fields where an external system disagreed with a populated /ops value.
            /ops is the source of truth and was kept — the external value was rejected and logged.
            Read-only.
          </p>
        </div>
        <span style={PILL(conflicts.length === 0 ? 'ok' : 'action')}>
          {conflicts.length === 0 ? 'No pending conflicts' : `${conflicts.length} pending`}
        </span>
      </div>

      <div style={SECTION}>
        {conflicts.length === 0 ? (
          <p style={{ margin: 0, color: '#64748b' }}>No pending sync conflicts. Healthie has not disagreed with any populated /ops field.</p>
        ) : (
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>Patient</th>
                <th style={TH}>Source</th>
                <th style={TH}>Field</th>
                <th style={TH}>/ops value (kept)</th>
                <th style={TH}>External value (rejected)</th>
                <th style={TH}>Detected</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.id}>
                  <td style={TD}>
                    <Link href={`/patients/${c.patient_id}`}>{c.full_name ?? c.patient_id}</Link>
                  </td>
                  <td style={TD}>{c.source_system}</td>
                  <td style={TD}><code>{c.field_name}</code></td>
                  <td style={TD}>{c.ops_value ?? <em style={{ color: '#94a3b8' }}>—</em>}</td>
                  <td style={TD}>{c.external_value ?? <em style={{ color: '#94a3b8' }}>—</em>}</td>
                  <td style={TD}>{new Date(c.detected_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={SECTION}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: '#0f172a' }}>
          Sync skips (last 7 days): {skipTotal}
        </h2>
        {skipSummary.length === 0 ? (
          <p style={{ margin: 0, color: '#64748b' }}>No syncs were skipped in the last 7 days.</p>
        ) : (
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>Reason</th>
                <th style={TH}>Count</th>
              </tr>
            </thead>
            <tbody>
              {skipSummary.map((s) => (
                <tr key={s.reason}>
                  <td style={TD}><code>{s.reason}</code></td>
                  <td style={TD}>{s.cnt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
