export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { fetchExceptions } from '@/lib/exceptions';

const SECTION: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '0.625rem',
  padding: '1rem 1.25rem',
  marginBottom: '1rem'
};
const SECTION_H: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 700,
  margin: '0 0 0.5rem',
  color: '#0f172a',
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem'
};
const COUNT_PILL = (state: 'ok' | 'attention' | 'action'): React.CSSProperties => ({
  fontSize: '0.7rem',
  fontWeight: 700,
  padding: '0.15rem 0.5rem',
  borderRadius: '999px',
  background: state === 'ok' ? '#dcfce7' : state === 'attention' ? '#fef3c7' : '#fee2e2',
  color: state === 'ok' ? '#166534' : state === 'attention' ? '#92400e' : '#991b1b'
});
const TABLE: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.85rem'
};
const TH: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.4rem 0.6rem',
  background: '#f1f5f9',
  color: '#334155',
  fontWeight: 600,
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em'
};
const TD: React.CSSProperties = {
  padding: '0.45rem 0.6rem',
  borderTop: '1px solid #e2e8f0',
  color: '#0f172a'
};

export default async function ExceptionsPage() {
  const user = await requireUser('admin');
  const data = await fetchExceptions();

  const totalIssues = data.duplicates.length + data.orphans.length + data.trtHardFlags.length + data.abxtacLifecycle.length;

  return (
    <section style={{ padding: '2rem', maxWidth: '80rem', margin: '0 auto' }}>
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem' }}>Exceptions Queue</h1>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
            Data-integrity issues needing staff review. Read-only — no changes are applied from this page.
            Generated {new Date(data.generatedAt).toLocaleString()}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={COUNT_PILL(totalIssues === 0 ? 'ok' : totalIssues < 20 ? 'attention' : 'action')}>
            {totalIssues === 0 ? 'All clear' : `${totalIssues} items`}
          </span>
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <SummaryCard label="Duplicates" count={data.duplicates.length} tone={data.duplicates.length > 0 ? 'attention' : 'ok'} />
        <SummaryCard label="Orphan Links" count={data.orphans.length} tone={data.orphans.length > 0 ? 'attention' : 'ok'} />
        <SummaryCard label="TRT Hard Flags" count={data.trtHardFlags.length} tone={data.trtHardFlags.length > 0 ? 'action' : 'ok'} />
        <SummaryCard label="ABXTAC Lifecycle" count={data.abxtacLifecycle.length} tone={data.abxtacLifecycle.length > 0 ? 'attention' : 'ok'} />
        <SummaryCard label="Unclassified" count={data.unclassifiedCount} tone={data.unclassifiedCount > 0 ? 'attention' : 'ok'} />
      </div>

      {/* TRT Hard Flags — highest priority */}
      <div style={SECTION}>
        <h2 style={SECTION_H}>
          🚨 TRT Hard Flags
          <span style={COUNT_PILL(data.trtHardFlags.length > 0 ? 'action' : 'ok')}>{data.trtHardFlags.length}</span>
        </h2>
        <p style={{ margin: '0 0 0.75rem', color: '#64748b', fontSize: '0.8rem' }}>
          Non-male patients with testosterone dispense history. Almost always means a dispense was misattributed to the wrong chart (e.g., Keira Gannon's dispenses actually given to Greg Gannon). Resolve via §7.6 Dispense Misattribution Correction workflow.
        </p>
        {data.trtHardFlags.length === 0 ? (
          <p style={{ color: '#16a34a', fontSize: '0.85rem', margin: 0 }}>✓ None. Clear.</p>
        ) : (
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>Patient</th>
                <th style={TH}>Gender</th>
                <th style={TH}>Dispenses</th>
                <th style={TH}>Last Dispense</th>
                <th style={TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.trtHardFlags.map(f => (
                <tr key={f.patient_id}>
                  <td style={TD}>
                    <Link href={`/patients/${f.patient_id}`} style={{ color: '#0369a1', fontWeight: 600 }}>
                      {f.full_name}
                    </Link>
                  </td>
                  <td style={TD}>{f.gender || '(unset)'}</td>
                  <td style={TD}>{f.dispense_count}</td>
                  <td style={TD}>{f.last_dispense_date || '—'}</td>
                  <td style={TD}>
                    <Link href={`/patients/${f.patient_id}`} style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 600 }}>
                      Open chart →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Duplicates */}
      <div style={SECTION}>
        <h2 style={SECTION_H}>
          🔀 Duplicate Candidates
          <span style={COUNT_PILL(data.duplicates.length > 0 ? 'attention' : 'ok')}>{data.duplicates.length}</span>
        </h2>
        <p style={{ margin: '0 0 0.75rem', color: '#64748b', fontSize: '0.8rem' }}>
          Likely duplicate patient records. Per policy §7.3, never auto-merged. Staff picks the keeper (usually the row with most dispenses/memberships/scribe notes) and manually merges. Family members sharing email/phone but with different DOBs are filtered out.
        </p>
        {data.duplicates.length === 0 ? (
          <p style={{ color: '#16a34a', fontSize: '0.85rem', margin: 0 }}>✓ None detected.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {data.duplicates.map((group, i) => (
              <div key={i} style={{ background: '#f8fafc', borderRadius: '0.4rem', padding: '0.75rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem' }}>
                  Match on <strong style={{ color: '#0f172a' }}>{group.kind}</strong>: <code style={{ fontSize: '0.75rem' }}>{group.match_value}</code>
                </div>
                <table style={{ ...TABLE, background: '#ffffff', borderRadius: '0.25rem', overflow: 'hidden' }}>
                  <thead>
                    <tr>
                      <th style={TH}>Patient</th>
                      <th style={TH}>Gender</th>
                      <th style={TH}>DOB</th>
                      <th style={TH}>Client Type</th>
                      <th style={TH}>Dispenses</th>
                      <th style={TH}>Memberships</th>
                      <th style={TH}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.patients.map(p => (
                      <tr key={p.patient_id}>
                        <td style={TD}>
                          <Link href={`/patients/${p.patient_id}`} style={{ color: '#0369a1', fontWeight: 600 }}>
                            {p.full_name}
                          </Link>
                          <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                            {p.patient_id.slice(0, 8)}…
                          </div>
                        </td>
                        <td style={TD}>{p.gender || '—'}</td>
                        <td style={TD}>{p.dob || '—'}</td>
                        <td style={TD}>{p.client_type || '—'}</td>
                        <td style={TD}>{p.dispense_count}</td>
                        <td style={TD}>{p.membership_count}</td>
                        <td style={TD}>
                          <Link href={`/patients/${p.patient_id}`} style={{ fontSize: '0.75rem' }}>Open →</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Orphan Healthie Links */}
      <div style={SECTION}>
        <h2 style={SECTION_H}>
          🔗 Orphan Healthie Links
          <span style={COUNT_PILL(data.orphans.length > 0 ? 'attention' : 'ok')}>{data.orphans.length}</span>
        </h2>
        <p style={{ margin: '0 0 0.75rem', color: '#64748b', fontSize: '0.8rem' }}>
          Local patient row has <code>healthie_client_id</code> set, but no matching row in <code>healthie_clients</code>. Most often the Healthie user was archived/inactive. Options: relink to the correct Healthie user, or archive the local row.
        </p>
        {data.orphans.length === 0 ? (
          <p style={{ color: '#16a34a', fontSize: '0.85rem', margin: 0 }}>✓ None.</p>
        ) : (
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>Patient</th>
                <th style={TH}>Email</th>
                <th style={TH}>Healthie ID</th>
                <th style={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.orphans.map(o => (
                <tr key={o.patient_id}>
                  <td style={TD}>
                    <Link href={`/patients/${o.patient_id}`} style={{ color: '#0369a1', fontWeight: 600 }}>
                      {o.full_name}
                    </Link>
                  </td>
                  <td style={TD}>{o.email || '—'}</td>
                  <td style={TD}><code style={{ fontSize: '0.75rem' }}>{o.healthie_client_id}</code></td>
                  <td style={TD}>{o.status_key || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ABXTAC Lifecycle */}
      <div style={SECTION}>
        <h2 style={SECTION_H}>
          💊 ABXTAC Lifecycle Review
          <span style={COUNT_PILL(data.abxtacLifecycle.length > 0 ? 'attention' : 'ok')}>{data.abxtacLifecycle.length}</span>
        </h2>
        <p style={{ margin: '0 0 0.75rem', color: '#64748b', fontSize: '0.8rem' }}>
          ABXTAC memberships in <code>payment_hold</code> or <code>inactive</code> state. Per policy §8.6.9, only staff transitions these — never automatic. Payment_hold blocks mobile app login when <code>ABXTAC_LOCKOUT_ENABLED=true</code>.
        </p>
        {data.abxtacLifecycle.length === 0 ? (
          <p style={{ color: '#16a34a', fontSize: '0.85rem', margin: 0 }}>✓ No ABXTAC memberships currently in review state.</p>
        ) : (
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>Patient</th>
                <th style={TH}>Email</th>
                <th style={TH}>Tier</th>
                <th style={TH}>Status</th>
                <th style={TH}>Expires</th>
              </tr>
            </thead>
            <tbody>
              {data.abxtacLifecycle.map(a => (
                <tr key={a.patient_id || a.healthie_client_id || a.email || a.full_name}>
                  <td style={TD}>
                    {a.patient_id ? (
                      <Link href={`/patients/${a.patient_id}`} style={{ color: '#0369a1', fontWeight: 600 }}>
                        {a.full_name}
                      </Link>
                    ) : (
                      <span style={{ color: '#64748b' }}>{a.full_name}</span>
                    )}
                  </td>
                  <td style={TD}>{a.email || '—'}</td>
                  <td style={TD}>{a.tier}</td>
                  <td style={TD}>
                    <span style={{
                      padding: '0.15rem 0.5rem', borderRadius: '0.25rem',
                      background: a.membership_status === 'payment_hold' ? '#fef3c7' : '#f1f5f9',
                      color: a.membership_status === 'payment_hold' ? '#92400e' : '#475569',
                      fontSize: '0.75rem', fontWeight: 600
                    }}>
                      {a.membership_status}
                    </span>
                  </td>
                  <td style={TD}>{a.tier_expires_at || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Unclassified count */}
      <div style={SECTION}>
        <h2 style={SECTION_H}>
          📋 Unclassified Patients
          <span style={COUNT_PILL(data.unclassifiedCount > 0 ? 'attention' : 'ok')}>{data.unclassifiedCount}</span>
        </h2>
        <p style={{ margin: '0 0 0.75rem', color: '#64748b', fontSize: '0.8rem' }}>
          Patients with no <code>client_type</code> assigned. Work these via the Unclassified tab on the Patients page.
        </p>
        {data.unclassifiedCount > 0 && (
          <Link href="/patients/?tab=unclassified" style={{ fontSize: '0.85rem', color: '#0369a1', fontWeight: 600 }}>
            Open Unclassified tab →
          </Link>
        )}
      </div>

      <p style={{ marginTop: '1.5rem', color: '#94a3b8', fontSize: '0.75rem' }}>
        Signed in as {user.email}. This is a read-only view. Merges and reassignments still require the underlying admin actions on each patient record.
      </p>
    </section>
  );
}

function SummaryCard({ label, count, tone }: { label: string; count: number; tone: 'ok' | 'attention' | 'action' }) {
  const color = tone === 'ok' ? '#16a34a' : tone === 'attention' ? '#d97706' : '#dc2626';
  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderLeft: `4px solid ${color}`,
      borderRadius: '0.5rem',
      padding: '0.75rem 1rem'
    }}>
      <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: count === 0 ? '#16a34a' : '#0f172a' }}>{count}</div>
    </div>
  );
}
