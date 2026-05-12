'use client';

import { useState, useEffect, useCallback } from 'react';
import { withBasePath } from '@/lib/basePath';

type Session = { name: string; rc_url: string; rcActive: boolean; taskName: string; tokens: string; lastLine: string; attached: boolean };
type GitState = { branch: string; uncommitted: number; aheadOfMaster: number; lastCommit: string; staleBranches: number; onMaster: boolean; warnings: string[] };
type PM2State = { totalServices: number; online: number; crashLooping: { name: string; restarts: number; uptime: number }[]; dashboardRestarts: number; dashboardUptime: number };
type AgentHealth = { timestamp: string; healthScore: number; issues: string[]; sessions: Session[]; git: GitState; pm2: PM2State; deployReadiness: { status: string; lastCheck: string } };
type KPIData = { kpi: string; status: string; tracker: string };
type LaunchResult = { status: string; session?: string; remote_control_url?: string; task_id?: string; error?: string };

const TASKS = [
  { id: 'disk-cleanup', label: 'Disk Cleanup', group: 'Infrastructure' },
  { id: 'dashboard-restarts', label: 'Fix Dashboard Crashes', group: 'Infrastructure' },
  { id: 'billing-holds', label: 'Resolve Billing Holds', group: 'Clinical' },
  { id: 'pending-labs', label: 'Clear Pending Labs', group: 'Clinical' },
  { id: 'ghl-sync', label: 'Fix GHL Sync Errors', group: 'Marketing' },
  { id: 'ghl-pipelines', label: 'Build GHL Pipelines', group: 'Marketing' },
  { id: 'email-campaign', label: 'Email Campaign', group: 'Marketing' },
  { id: 'mobile-app-debug', label: 'Mobile App Debug', group: 'Apps' },
  { id: 'inventory-restock', label: 'Inventory Audit', group: 'Clinical' },
  { id: 'longevity-launch', label: 'NOW Longevity Launch', group: 'Projects' },
  { id: 'full-audit', label: 'Full System Audit', group: 'Infrastructure' },
  { id: 'stripe-reconnect', label: 'Verify Stripe', group: 'Billing' },
  { id: 'quickbooks-fix', label: 'Fix QuickBooks', group: 'Billing' },
  { id: 'payment-issues', label: 'Resolve Payment Issues', group: 'Billing' },
];

const scoreColor = (s: number) => s >= 80 ? '#22c55e' : s >= 50 ? '#f59e0b' : '#ef4444';

export default function AgentsDashboard({ userEmail }: { userEmail: string }) {
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState<string | null>(null);
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);
  const [launchInput, setLaunchInput] = useState('');
  const [showLaunch, setShowLaunch] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'sessions' | 'deploy' | 'tasks'>('overview');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(withBasePath('/api/code/agent-health/'));
      if (res.ok) setHealth(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const i = setInterval(refresh, 20000); return () => clearInterval(i); }, [refresh]);

  const launchTask = async (taskId: string) => {
    setLaunching(taskId);
    try {
      const res = await fetch(withBasePath('/api/code/launch-task/'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, user_input: launchInput }),
      });
      const data = await res.json();
      setLaunchResult(data);
      setShowLaunch(null);
      setLaunchInput('');
      setTimeout(refresh, 5000);
    } catch (e: any) { setLaunchResult({ status: 'error', error: e.message }); }
    setLaunching(null);
  };

  const killSession = async (name: string) => {
    if (!confirm('Stop session ' + name + '?')) return;
    await fetch(withBasePath('/api/code/kill-session/?session=' + name));
    setTimeout(refresh, 2000);
  };

  const S = (props: any) => <span {...props} />;
  const h = health;
  const g = h?.git;
  const p = h?.pm2;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0b10', color: '#e4e4e7', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif', maxWidth: 800, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #1f2133', position: 'sticky', top: 0, background: '#0a0b10', zIndex: 50 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>NOW Optimal Agents</div>
            <div style={{ fontSize: 10, color: '#52525b' }}>{h?.timestamp ? new Date(h.timestamp).toLocaleString() : 'Loading...'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {h && <div style={{ width: 36, height: 36, borderRadius: '50%', background: scoreColor(h.healthScore), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#000' }}>{h.healthScore}</div>}
            <button onClick={refresh} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: '#1f2133', color: '#a1a1aa' }}>{loading ? '...' : 'Refresh'}</button>
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
          {(['overview', 'sessions', 'deploy', 'tasks'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: tab === t ? '#22c55e' : '#1f2133', color: tab === t ? '#000' : '#71717a' }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </div>

      {/* Issues Banner */}
      {h && h.issues.length > 0 && (
        <div style={{ margin: '10px 16px 0', padding: '10px 12px', background: '#1c1017', borderRadius: 8, border: '1px solid #7f1d1d' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fca5a5', marginBottom: 4 }}>ISSUES ({h.issues.length})</div>
          {h.issues.map((issue, i) => (
            <div key={i} style={{ fontSize: 12, color: '#fca5a5', lineHeight: 1.5 }}>{issue}</div>
          ))}
        </div>
      )}

      <div style={{ padding: '12px 16px' }}>

        {/* OVERVIEW TAB */}
        {tab === 'overview' && h && (
          <>
            {/* Health Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
              <div style={{ background: '#12131a', borderRadius: 10, padding: 12, textAlign: 'center', border: '1px solid #1f2133' }}>
                <div style={{ fontSize: 10, color: '#71717a', textTransform: 'uppercase' }}>Sessions</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{h.sessions.length}</div>
                <div style={{ fontSize: 10, color: '#52525b' }}>active</div>
              </div>
              <div style={{ background: '#12131a', borderRadius: 10, padding: 12, textAlign: 'center', border: '1px solid #1f2133' }}>
                <div style={{ fontSize: 10, color: '#71717a', textTransform: 'uppercase' }}>Services</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: p?.online === p?.totalServices ? '#22c55e' : '#f59e0b' }}>{p?.online}/{p?.totalServices}</div>
                <div style={{ fontSize: 10, color: '#52525b' }}>online</div>
              </div>
              <div style={{ background: '#12131a', borderRadius: 10, padding: 12, textAlign: 'center', border: '1px solid #1f2133' }}>
                <div style={{ fontSize: 10, color: '#71717a', textTransform: 'uppercase' }}>Branch</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: g?.onMaster ? '#22c55e' : '#ef4444', marginTop: 4 }}>{g?.onMaster ? 'master' : g?.branch?.split('/').pop()?.substring(0, 12)}</div>
                <div style={{ fontSize: 10, color: '#52525b' }}>{g?.uncommitted || 0} uncommitted</div>
              </div>
            </div>

            {/* Git Warnings */}
            {g && g.warnings.length > 0 && (
              <div style={{ background: '#1a1710', borderRadius: 8, padding: 10, marginBottom: 12, border: '1px solid #78350f' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#fcd34d', marginBottom: 4 }}>GIT WARNINGS</div>
                {g.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#fcd34d' }}>{w}</div>)}
              </div>
            )}

            {/* Active Sessions Quick View */}
            <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Active Sessions</div>
            {h.sessions.map((s, i) => (
              <div key={i} style={{ background: '#12131a', borderRadius: 8, padding: 10, marginBottom: 6, border: '1px solid #1f2133' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: s.rcActive ? '#22c55e' : '#3f3f46' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{s.name}</span>
                    {s.taskName && <span style={{ fontSize: 10, color: '#6366f1', background: '#1e1b4b', padding: '1px 6px', borderRadius: 4 }}>{s.taskName}</span>}
                  </div>
                  {s.tokens && <span style={{ fontSize: 10, color: parseInt(s.tokens) > 500 ? '#f59e0b' : '#52525b' }}>{s.tokens}</span>}
                </div>
                {s.rc_url && (
                  <a href={s.rc_url} target="_blank" rel="noreferrer" style={{ display: 'block', background: '#6366f1', color: '#fff', textAlign: 'center', padding: '8px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none', marginTop: 6 }}>Open in Claude App</a>
                )}
              </div>
            ))}

            {/* Crash Looping Services */}
            {p && p.crashLooping.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 14, marginBottom: 6 }}>Crash Looping</div>
                {p.crashLooping.map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: '#1c1017', borderRadius: 6, marginBottom: 4, border: '1px solid #7f1d1d' }}>
                    <span style={{ fontSize: 12, color: '#fca5a5' }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>{s.restarts} restarts</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* SESSIONS TAB */}
        {tab === 'sessions' && h && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>All Claude Sessions ({h.sessions.length})</div>
            {h.sessions.map((s, i) => (
              <div key={i} style={{ background: '#12131a', borderRadius: 10, padding: 12, marginBottom: 8, border: '1px solid #1f2133' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{s.name}</div>
                    {s.taskName && <div style={{ fontSize: 11, color: '#6366f1', marginTop: 2 }}>{s.taskName}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.rcActive ? '#22c55e' : '#3f3f46' }} />
                    <span style={{ fontSize: 10, color: '#52525b' }}>{s.rcActive ? 'RC Active' : 'RC Off'}</span>
                  </div>
                </div>
                {s.tokens && <div style={{ fontSize: 10, color: parseInt(s.tokens) > 500 ? '#f59e0b' : '#52525b', marginBottom: 4 }}>Context: {s.tokens} tokens</div>}
                {s.lastLine && <div style={{ fontSize: 10, color: '#52525b', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.lastLine}</div>}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {s.rc_url ? (
                    <a href={s.rc_url} target="_blank" rel="noreferrer" style={{ flex: 1, display: 'block', background: '#6366f1', color: '#fff', textAlign: 'center', padding: '8px', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Open in Claude App</a>
                  ) : (
                    <div style={{ flex: 1, textAlign: 'center', padding: 8, fontSize: 11, color: '#52525b' }}>No RC link</div>
                  )}
                  {s.name.startsWith('claude-task-') && (
                    <button onClick={() => killSession(s.name)} style={{ padding: '8px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: '#7f1d1d', color: '#fca5a5' }}>Stop</button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {/* DEPLOY TAB */}
        {tab === 'deploy' && h && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Deploy Readiness</div>
            <div style={{ background: '#12131a', borderRadius: 10, padding: 14, marginBottom: 12, border: '1px solid #1f2133' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Status</span>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: h.deployReadiness.status === 'passed' ? '#14532d' : h.deployReadiness.status === 'blocked' ? '#7f1d1d' : '#27272a', color: h.deployReadiness.status === 'passed' ? '#86efac' : h.deployReadiness.status === 'blocked' ? '#fca5a5' : '#71717a' }}>{h.deployReadiness.status.toUpperCase()}</span>
              </div>
              <div style={{ fontSize: 11, color: '#52525b' }}>Last check: {h.deployReadiness.lastCheck}</div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Git State</div>
            <div style={{ background: '#12131a', borderRadius: 10, padding: 14, marginBottom: 12, border: '1px solid #1f2133' }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Branch: <span style={{ color: g?.onMaster ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{g?.branch}</span></div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Ahead of master: <span style={{ fontWeight: 600, color: (g?.aheadOfMaster || 0) > 0 ? '#f59e0b' : '#22c55e' }}>{g?.aheadOfMaster || 0} commits</span></div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Uncommitted: <span style={{ fontWeight: 600, color: (g?.uncommitted || 0) > 10 ? '#ef4444' : '#22c55e' }}>{g?.uncommitted || 0} files</span></div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Stale branches: <span style={{ fontWeight: 600, color: (g?.staleBranches || 0) > 3 ? '#f59e0b' : '#22c55e' }}>{g?.staleBranches || 0}</span></div>
              <div style={{ fontSize: 11, color: '#52525b', marginTop: 6, fontFamily: 'monospace' }}>Last: {g?.lastCommit}</div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>PM2 Services</div>
            <div style={{ background: '#12131a', borderRadius: 10, padding: 14, border: '1px solid #1f2133' }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Online: <span style={{ fontWeight: 600, color: '#22c55e' }}>{p?.online}/{p?.totalServices}</span></div>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Dashboard: <span style={{ fontWeight: 600, color: (p?.dashboardRestarts || 0) > 20 ? '#ef4444' : '#22c55e' }}>{p?.dashboardRestarts} restarts</span> (up {p?.dashboardUptime}min)</div>
              {p && p.crashLooping.map((s, i) => (
                <div key={i} style={{ fontSize: 11, color: '#fca5a5', marginTop: 2 }}>{s.name}: {s.restarts} restarts ({s.uptime}min uptime)</div>
              ))}
            </div>
          </>
        )}

        {/* TASKS TAB */}
        {tab === 'tasks' && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Launch a Task</div>
            {Object.entries(TASKS.reduce((acc, t) => { (acc[t.group] = acc[t.group] || []).push(t); return acc; }, {} as Record<string, typeof TASKS>)).map(([group, tasks]) => (
              <div key={group} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{group}</div>
                {tasks.map(t => (
                  <div key={t.id} onClick={() => { setShowLaunch(t.id); setLaunchInput(''); setLaunchResult(null); }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 10px', background: '#12131a', borderRadius: 8, marginBottom: 4, border: '1px solid #1f2133', cursor: 'pointer' }}>
                    <span style={{ fontSize: 13, color: '#e4e4e7' }}>{t.label}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Launch Modal */}
      {showLaunch && (
        <div onClick={e => { if (e.target === e.currentTarget) setShowLaunch(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#12131a', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', width: '100%', maxWidth: 800, border: '1px solid #1f2133' }}>
            <div style={{ width: 36, height: 4, background: '#3f3f46', borderRadius: 2, margin: '0 auto 16px' }} />
            <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 12 }}>{TASKS.find(t => t.id === showLaunch)?.label}</div>
            <textarea value={launchInput} onChange={e => setLaunchInput(e.target.value)} placeholder="Instructions for Claude (optional)..."
              style={{ width: '100%', background: '#0a0b10', border: '1px solid #1f2133', borderRadius: 10, padding: 12, color: '#e4e4e7', fontSize: 15, fontFamily: 'inherit', minHeight: 80, resize: 'vertical', marginBottom: 12 }} />
            <button onClick={() => launchTask(showLaunch)} disabled={!!launching}
              style={{ width: '100%', padding: '14px', borderRadius: 10, border: 'none', cursor: launching ? 'default' : 'pointer', fontSize: 16, fontWeight: 700, background: launching ? '#1f2133' : '#22c55e', color: launching ? '#71717a' : '#000' }}>
              {launching ? 'Launching...' : 'Launch Claude Session'}
            </button>
            <button onClick={() => setShowLaunch(null)}
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14, background: 'transparent', color: '#71717a', marginTop: 8 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Launch Result Toast */}
      {launchResult && (
        <div style={{ position: 'fixed', bottom: 20, left: 16, right: 16, maxWidth: 800, margin: '0 auto', background: launchResult.error ? '#7f1d1d' : '#14532d', padding: '12px 16px', borderRadius: 10, zIndex: 200 }}>
          {launchResult.remote_control_url ? (
            <a href={launchResult.remote_control_url} target="_blank" rel="noreferrer" style={{ color: '#86efac', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>Session launched — Open in Claude App</a>
          ) : (
            <span style={{ color: launchResult.error ? '#fca5a5' : '#86efac', fontSize: 13 }}>{launchResult.error || 'Session starting... check Sessions tab'}</span>
          )}
          <button onClick={() => setLaunchResult(null)} style={{ float: 'right', background: 'transparent', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      )}
    </div>
  );
}
