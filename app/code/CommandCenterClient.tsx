'use client';

import { useState, useEffect, useCallback } from 'react';
import { withBasePath } from '@/lib/basePath';

type Session = { name: string; remote_control_url: string; attached: boolean };
type LaunchResult = { status: string; session?: string; remote_control_url?: string; task_id?: string; error?: string };

type Task = { id: string; text: string; status: string };
type TaskGroup = { group: string; color: string; items: Task[] };

const PROJECTS: { name: string; url?: string; status: string; health: string; color: string; tasks: TaskGroup[] }[] = [
  {
    name: 'GMH Dashboard', url: 'https://nowoptimal.com/ops/', status: 'LIVE', health: 'UNSTABLE', color: '#ef4444',
    tasks: [
      { group: 'Critical Fixes', color: '#ef4444', items: [
        { id: 'disk-cleanup', text: 'Free disk space (95% → <75%)', status: 'fail' },
        { id: 'dashboard-restarts', text: 'Fix crash loop (275 restarts)', status: 'fail' },
        { id: 'quickbooks-fix', text: 'Fix QuickBooks integration', status: 'unknown' },
        { id: 'stripe-reconnect', text: 'Verify Stripe connection', status: 'unknown' },
        { id: 'payment-issues', text: 'Resolve 50 payment issues', status: 'not-started' },
      ]},
      { group: 'Clinical', color: '#f59e0b', items: [
        { id: 'pending-labs', text: 'Clear 26 pending lab reviews (3 critical hematocrit)', status: 'fail' },
        { id: 'billing-holds', text: 'Resolve 10 billing holds', status: 'progress' },
      ]},
    ]
  },
  {
    name: 'NOW Men\'s Health', url: 'https://nowmenshealth.care', status: 'LIVE', health: 'STABLE', color: '#DC2626',
    tasks: [
      { group: 'Enhancements', color: '#3b82f6', items: [
        { id: 'full-audit', text: 'Add Google Analytics tracking', status: 'not-started' },
        { id: 'ghl-pipelines', text: 'Install GHL chat widget', status: 'not-started' },
        { id: 'full-audit', text: 'Add review generation CTA', status: 'not-started' },
      ]},
    ]
  },
  {
    name: 'ABX TAC (Peptides)', url: 'https://abxtac.com', status: 'LIVE', health: 'MODERATE', color: '#3A7D32',
    tasks: [
      { group: 'Fixes', color: '#f59e0b', items: [
        { id: 'stripe-reconnect', text: 'Verify Stripe payments working', status: 'unknown' },
        { id: 'inventory-restock', text: 'Verify inventory sync', status: 'unknown' },
        { id: 'full-audit', text: 'Investigate 26 restarts', status: 'not-started' },
      ]},
    ]
  },
  {
    name: 'NOW Longevity', url: undefined, status: 'NOT BUILT', health: 'N/A', color: '#6B8F71',
    tasks: [
      { group: 'Phase 1: Foundation', color: '#6B8F71', items: [
        { id: 'longevity-launch', text: 'Create Healthie group "NowLongevity.Care"', status: 'not-started' },
        { id: 'longevity-launch', text: 'Set up DNS + Nginx + SSL', status: 'not-started' },
        { id: 'longevity-launch', text: 'Build website (clone nowmenshealth)', status: 'not-started' },
        { id: 'longevity-launch', text: 'Configure appointment types', status: 'not-started' },
      ]},
      { group: 'Phase 2: Acquisition', color: '#6B8F71', items: [
        { id: 'longevity-launch', text: 'Build waitlist form + landing page', status: 'not-started' },
        { id: 'longevity-launch', text: 'Founders Circle page (25 spots, $750/mo)', status: 'not-started' },
        { id: 'longevity-launch', text: 'Booking widget for Longevity appts', status: 'not-started' },
      ]},
      { group: 'Phase 3: Marketing', color: '#6B8F71', items: [
        { id: 'email-campaign', text: 'Announce to 2,829 GMH subscribers', status: 'not-started' },
        { id: 'ghl-pipelines', text: 'GHL waitlist drip sequence', status: 'not-started' },
        { id: 'longevity-launch', text: 'Facebook/Instagram ad funnel (35-55, Prescott)', status: 'not-started' },
      ]},
      { group: 'Phase 4: Operations', color: '#6B8F71', items: [
        { id: 'longevity-launch', text: 'Migrate legacy patients (56 total)', status: 'not-started' },
        { id: 'longevity-launch', text: 'Configure Stripe billing tiers', status: 'not-started' },
        { id: 'longevity-launch', text: 'Soft launch at 404 S. Montezuma', status: 'not-started' },
      ]},
    ]
  },
  {
    name: 'Mobile App', url: undefined, status: 'DEPLOYED', health: 'BROKEN', color: '#00D4FF',
    tasks: [
      { group: 'Critical', color: '#ef4444', items: [
        { id: 'mobile-app-debug', text: 'Fix verification (0 of 260 verified)', status: 'fail' },
        { id: 'mobile-app-debug', text: 'Diagnose is_verified sync', status: 'unknown' },
      ]},
      { group: 'Adoption', color: '#3b82f6', items: [
        { id: 'mobile-app-debug', text: 'SMS blast download link to 260 patients', status: 'not-started' },
        { id: 'mobile-app-debug', text: 'In-clinic onboarding flow', status: 'not-started' },
        { id: 'mobile-app-debug', text: 'Incentive: free B12 for first 50 verified', status: 'not-started' },
      ]},
    ]
  },
  {
    name: 'GHL & Marketing', url: undefined, status: 'PARTIAL', health: '99% SYNC', color: '#f59e0b',
    tasks: [
      { group: 'Pipelines & Workflows', color: '#3b82f6', items: [
        { id: 'ghl-pipelines', text: 'Build 4 pipelines', status: 'not-started' },
        { id: 'ghl-pipelines', text: 'Build 7 core workflows', status: 'not-started' },
        { id: 'ghl-sync', text: 'Fix 2 remaining sync errors', status: 'progress' },
        { id: 'ghl-pipelines', text: 'Set up tag library + custom fields', status: 'not-started' },
      ]},
      { group: 'Email Campaigns', color: '#f59e0b', items: [
        { id: 'email-campaign', text: 'Import 2,829 GMH + 542 Tri-City to GHL', status: 'not-started' },
        { id: 'email-campaign', text: "Send 'We're Back' to GMH list", status: 'not-started' },
        { id: 'email-campaign', text: 'Email 156 never-contacted Tri-City', status: 'not-started' },
      ]},
    ]
  },
  {
    name: 'Inventory & Supplies', url: undefined, status: 'NEEDS AUDIT', health: 'UNKNOWN', color: '#a855f7',
    tasks: [
      { group: 'Restock', color: '#f59e0b', items: [
        { id: 'inventory-restock', text: 'Audit peptide stock levels', status: 'unknown' },
        { id: 'inventory-restock', text: 'Order zero-stock SKUs', status: 'unknown' },
        { id: 'inventory-restock', text: 'Reorder female pellet kits (10 left, 36 upcoming)', status: 'unknown' },
        { id: 'inventory-restock', text: 'Reorder IV saline + Tadalafil', status: 'unknown' },
      ]},
    ]
  },
];

const dotColor: Record<string, string> = {
  done: '#22c55e', pass: '#22c55e', progress: '#f59e0b',
  fail: '#ef4444', 'not-started': '#3f3f46', unknown: '#6366f1',
};
const healthColor: Record<string, string> = {
  STABLE: '#22c55e', HEALTHY: '#22c55e', MODERATE: '#f59e0b', UNSTABLE: '#ef4444',
  BROKEN: '#ef4444', 'N/A': '#52525b', '99% SYNC': '#f59e0b', UNKNOWN: '#6366f1',
};

export default function CommandCenterClient({ userEmail }: { userEmail: string }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [launchModal, setLaunchModal] = useState<{ id: string; text: string } | null>(null);
  const [userInput, setUserInput] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);
  const [expandedProject, setExpandedProject] = useState<number | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(withBasePath('/api/code/sessions/'));
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (e) {}
  }, []);

  useEffect(() => { loadSessions(); const i = setInterval(loadSessions, 15000); return () => clearInterval(i); }, [loadSessions]);

  const launchTask = async () => {
    if (!launchModal) return;
    setLaunching(true); setLaunchResult(null);
    try {
      const res = await fetch(withBasePath('/api/code/launch-task/'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: launchModal.id, user_input: userInput }),
      });
      setLaunchResult(await res.json());
      setTimeout(loadSessions, 3000);
    } catch (e: any) { setLaunchResult({ status: 'error', error: e.message }); }
    setLaunching(false);
  };

  const killSession = async (name: string) => {
    if (!confirm('Stop ' + name + '?')) return;
    await fetch(withBasePath('/api/code/kill-session/?session=' + name));
    loadSessions();
  };

  const getAppLink = (url: string) => url;

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#e4e4e7', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif', maxWidth: 600, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #2a2d3a', position: 'sticky', top: 0, background: '#0f1117', zIndex: 50 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Command Center</div>
            <div style={{ fontSize: 11, color: '#52525b', marginTop: 2 }}>{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
          </div>
          <button onClick={loadSessions} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: '#f59e0b', color: '#000' }}>Refresh</button>
        </div>
      </div>

      {/* Active Sessions */}
      {sessions.length > 0 && (
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Active Sessions ({sessions.length})</div>
          {sessions.map((s, i) => (
            <div key={i} style={{ background: '#1a1d29', borderRadius: 10, padding: 12, marginBottom: 6, border: '1px solid #2a2d3a' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: s.remote_control_url ? 8 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</span>
                </div>
                {s.name.startsWith('claude-task-') && (
                  <button onClick={() => killSession(s.name)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 600, background: '#7f1d1d', color: '#fca5a5' }}>Stop</button>
                )}
              </div>
              {s.remote_control_url && (
                <a href={getAppLink(s.remote_control_url)} style={{ display: 'block', background: '#6366f1', color: '#fff', textAlign: 'center', padding: '10px', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Open in Claude App</a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Projects */}
      <div style={{ padding: '4px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Projects</div>
        {PROJECTS.map((proj, pi) => (
          <div key={pi} style={{ marginBottom: 8 }}>
            {/* Project Header — tappable accordion */}
            <div
              onClick={() => setExpandedProject(expandedProject === pi ? null : pi)}
              style={{ background: '#1a1d29', borderRadius: expandedProject === pi ? '10px 10px 0 0' : 10, padding: '14px 12px', border: '1px solid #2a2d3a', borderBottom: expandedProject === pi ? 'none' : '1px solid #2a2d3a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, WebkitTapHighlightColor: 'transparent' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: healthColor[proj.health] || '#52525b', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{proj.name}</div>
                <div style={{ fontSize: 11, color: '#71717a', marginTop: 2 }}>
                  {proj.status} {proj.url && <span style={{ color: '#52525b' }}>· {proj.url.replace('https://','')}</span>}
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: healthColor[proj.health] || '#52525b' }}>{proj.health}</div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2" style={{ transform: expandedProject === pi ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6"/></svg>
            </div>

            {/* Expanded tasks */}
            {expandedProject === pi && (
              <div style={{ background: '#1a1d29', borderRadius: '0 0 10px 10px', padding: '4px 12px 12px', border: '1px solid #2a2d3a', borderTop: 'none' }}>
                {proj.tasks.map((group, gi) => (
                  <div key={gi} style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: group.color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{group.group}</div>
                    {group.items.map((t, ti) => (
                      <div key={ti}
                        onClick={() => { setLaunchModal({ id: t.id, text: t.text }); setUserInput(''); setLaunchResult(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px', borderRadius: 6, marginBottom: 2, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor[t.status] || '#3f3f46', flexShrink: 0 }} />
                        <div style={{ flex: 1, fontSize: 13, lineHeight: 1.3 }}>{t.text}</div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Launch Modal */}
      {launchModal && (
        <div onClick={(e) => { if (e.target === e.currentTarget) { setLaunchModal(null); setLaunchResult(null); } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#1a1d29', borderRadius: '16px 16px 0 0', padding: '20px 16px 32px', width: '100%', maxWidth: 600, border: '1px solid #2a2d3a', borderBottom: 'none' }}>
            <div style={{ width: 36, height: 4, background: '#3f3f46', borderRadius: 2, margin: '0 auto 16px' }} />
            {!launchResult ? (
              <>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 4 }}>{launchModal.id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
                <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>{launchModal.text}</div>
                <textarea value={userInput} onChange={e => setUserInput(e.target.value)} placeholder="Add instructions for Claude (optional)..."
                  style={{ width: '100%', background: '#0f1117', border: '1px solid #3f3f46', borderRadius: 10, padding: 12, color: '#e4e4e7', fontSize: 15, fontFamily: 'inherit', minHeight: 80, resize: 'vertical', marginBottom: 12 }} />
                <button onClick={launchTask} disabled={launching}
                  style={{ width: '100%', padding: '14px', borderRadius: 10, border: 'none', cursor: launching ? 'default' : 'pointer', fontSize: 16, fontWeight: 700, background: launching ? '#27272a' : '#22c55e', color: launching ? '#71717a' : '#000' }}>
                  {launching ? 'Launching...' : 'Launch Claude Session'}
                </button>
                <button onClick={() => { setLaunchModal(null); setLaunchResult(null); }}
                  style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14, background: 'transparent', color: '#71717a', marginTop: 8 }}>Cancel</button>
              </>
            ) : launchResult.error ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#ef4444', marginBottom: 8 }}>Launch Failed</div>
                <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>{launchResult.error}</div>
                <button onClick={() => setLaunchResult(null)} style={{ padding: '12px 24px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, background: '#27272a', color: '#e4e4e7' }}>Try Again</button>
              </div>
            ) : launchResult.remote_control_url ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#14532d', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 16 }}>Session Running</div>
                <a href={getAppLink(launchResult.remote_control_url)}
                  style={{ display: 'block', background: '#6366f1', color: '#fff', textAlign: 'center', padding: '14px', borderRadius: 10, fontSize: 16, fontWeight: 700, textDecoration: 'none', marginBottom: 8 }}>Open in Claude App</a>
                <button onClick={() => { setLaunchModal(null); setLaunchResult(null); }}
                  style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14, background: 'transparent', color: '#71717a' }}>Done</button>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 8 }}>{launchResult.status === 'exists' ? 'Session Already Running' : 'Session Starting...'}</div>
                <div style={{ fontSize: 13, color: '#a1a1aa', marginBottom: 16 }}>Check active sessions above in a moment.</div>
                <button onClick={() => { setLaunchModal(null); setLaunchResult(null); loadSessions(); }}
                  style={{ width: '100%', padding: '14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 16, fontWeight: 600, background: '#27272a', color: '#e4e4e7' }}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
