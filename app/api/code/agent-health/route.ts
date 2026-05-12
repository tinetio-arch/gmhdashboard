import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { execSync } from 'child_process';

/**
 * GET /api/code/agent-health
 * 
 * Unified agent health endpoint for nowoptimal.com/ops/agents
 * Uses the Dispatch Session Coordinator (claude-coord) for authoritative data.
 * Returns: sessions, git state, PM2 health, file claims, conflicts, debug results.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const coord = (cmd: string, timeout = 10000) => {
    try {
      return JSON.parse(execSync(`claude-coord ${cmd} --json 2>/dev/null || echo '{}'`, { timeout, env: { ...process.env, PATH: `${process.env.HOME}/.claude/bin:${process.env.PATH}` } }).toString().trim() || '{}');
    } catch { return {}; }
  };

  const shell = (cmd: string, timeout = 5000) => {
    try { return execSync(cmd, { timeout }).toString().trim(); } catch { return ''; }
  };

  try {
    // 1. Coordinator session list
    let sessions: any[] = [];
    try {
      const listOut = shell('claude-coord list --json 2>/dev/null || tmux list-sessions -F "#{session_name}" 2>/dev/null');
      // Parse coordinator list or fall back to tmux
      const tmuxSessions = shell('tmux list-sessions -F "#{session_name}" 2>/dev/null').split('\n').filter(s => s.includes('claude'));
      
      sessions = tmuxSessions.map(name => {
        let rc_url = '', rcActive = false, taskName = '', tokens = '', lastLine = '';
        try {
          const pane = shell(`tmux capture-pane -t ${name} -p 2>/dev/null | tail -20`);
          const urlMatch = pane.match(/https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_]+/);
          if (urlMatch) rc_url = urlMatch[0];
          rcActive = pane.includes('Remote Control active');
          const taskMatch = pane.match(/─+ ([a-z][\w-]+) ─+/);
          taskName = taskMatch ? taskMatch[1] : '';
          const tokenMatch = pane.match(/(\d+\.?\d*k) tokens/);
          tokens = tokenMatch ? tokenMatch[1] : '';
          const lines = pane.split('\n').filter((x: string) => x.trim() && !x.startsWith('─') && !x.startsWith('  ⏵'));
          lastLine = (lines.pop() || '').substring(0, 120);
        } catch {}
        
        // Get registered task from coordinator
        let coordTask = '';
        try {
          const regInfo = shell(`claude-coord show ${name} 2>/dev/null | head -3`);
          const taskLine = regInfo.match(/Task:\s*(.+)/);
          if (taskLine) coordTask = taskLine[1].substring(0, 150);
        } catch {}
        
        return { name, rc_url, rcActive, taskName: taskName || coordTask, tokens, lastLine, registered: !!coordTask };
      });
    } catch {}

    // 2. Git status for all sessions (coordinator-aware)
    let gitStatus: any[] = [];
    try {
      const gitOut = shell('claude-coord git-status-all --json 2>/dev/null');
      if (gitOut) gitStatus = JSON.parse(gitOut);
    } catch {}
    // Fallback
    if (gitStatus.length === 0) {
      try {
        const branch = shell('cd ~/gmhdashboard && git branch --show-current');
        const uncommitted = parseInt(shell('cd ~/gmhdashboard && git status --short | wc -l') || '0');
        const ahead = parseInt(shell('cd ~/gmhdashboard && git log master..HEAD --oneline 2>/dev/null | wc -l') || '0');
        const lastCommit = shell('cd ~/gmhdashboard && git log -1 --format="%h %s" 2>/dev/null');
        const staleBranches = parseInt(shell('cd ~/gmhdashboard && git branch | grep claude | wc -l') || '0');
        gitStatus = [{ session: 'production', branch, uncommitted, ahead, lastCommit, staleBranches, onMaster: branch === 'master' }];
      } catch {}
    }

    // 3. File claims and conflicts
    let claims: any = {};
    try {
      const claimsOut = shell('claude-coord claims --json 2>/dev/null');
      if (claimsOut) claims = JSON.parse(claimsOut);
    } catch {}

    // 4. PM2 state
    let pm2: any = {};
    try {
      const pm2Json = shell('pm2 jlist 2>/dev/null');
      const services = JSON.parse(pm2Json || '[]');
      const dashboard = services.find((s: any) => s.name === 'gmh-dashboard');
      pm2 = {
        total: services.length,
        online: services.filter((s: any) => s.pm2_env?.status === 'online').length,
        crashLooping: services.filter((s: any) => (s.pm2_env?.restart_time || 0) > 20).map((s: any) => ({
          name: s.name, restarts: s.pm2_env.restart_time,
          uptime: Math.round((Date.now() - (s.pm2_env.pm_uptime || Date.now())) / 60000)
        })),
        dashboardRestarts: dashboard?.pm2_env?.restart_time || 0,
        dashboardUptime: dashboard ? Math.round((Date.now() - dashboard.pm2_env.pm_uptime) / 60000) : 0,
      };
    } catch {}

    // 5. Deploy check status
    let deploy: any = { status: 'never_run', lastCheck: 'never' };
    try {
      const deployMd = shell('cat ~/gmhdashboard/docs/DEPLOY_CHECK.md 2>/dev/null');
      if (deployMd) {
        deploy = {
          status: deployMd.includes('PASSED') ? 'passed' : deployMd.includes('BLOCKED') ? 'blocked' : 'unknown',
          lastCheck: deployMd.match(/\*\*Time\*\*: (.+)/)?.[1] || 'unknown'
        };
      }
    } catch {}

    // 6. Last debug results
    let lastDebug: any = { status: 'unknown' };
    try {
      const debugOut = shell('tail -5 ~/gmhdashboard/docs/DEBUG_RESULTS.md 2>/dev/null');
      if (debugOut) {
        const passMatch = debugOut.match(/PASS:\s*(\d+)/);
        const failMatch = debugOut.match(/FAIL\w*:\s*(\d+)/);
        lastDebug = {
          pass: passMatch ? parseInt(passMatch[1]) : 0,
          fail: failMatch ? parseInt(failMatch[1]) : 0,
          status: failMatch && parseInt(failMatch[1]) === 0 ? 'clean' : 'issues'
        };
      }
    } catch {}

    // 7. Health score
    const issues: string[] = [];
    const prodGit = gitStatus.find((g: any) => g.session === 'production' || g.session === 'claude8') || gitStatus[0] || {};
    if (prodGit.branch && prodGit.branch !== 'master' && prodGit.branch !== 'main') issues.push('Production not on master');
    if ((prodGit.uncommitted || 0) > 10) issues.push(`${prodGit.uncommitted} uncommitted files`);
    if ((prodGit.staleBranches || 0) > 5) issues.push(`${prodGit.staleBranches} stale branches`);
    if (pm2.crashLooping?.length > 0) issues.push(`${pm2.crashLooping.length} services crash-looping`);
    if (deploy.status === 'blocked') issues.push('Deploy blocked');
    if (sessions.some((s: any) => s.tokens && parseInt(s.tokens) > 800)) issues.push('Session near context limit');
    const unregistered = sessions.filter((s: any) => !s.registered).length;
    if (unregistered > 0) issues.push(`${unregistered} unregistered sessions`);

    const healthScore = Math.max(0, 100 - (issues.length * 15));

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      healthScore,
      issues,
      sessions,
      git: gitStatus,
      pm2,
      deploy,
      lastDebug,
      claims,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/code/agent-health
 * 
 * Actions: run-debug, run-deploy-check, claim-files, check-conflicts
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { action, session, paths } = await request.json();

    if (action === 'run-debug') {
      const output = execSync(
        `cd ~/gmhdashboard && bash scripts/agents/debug-all-systems.sh 2>&1 | tail -30`,
        { timeout: 60000, env: { ...process.env, PATH: `${process.env.HOME}/.claude/bin:${process.env.PATH}` } }
      ).toString();
      return NextResponse.json({ output });
    }

    if (action === 'run-deploy-check') {
      const output = execSync(
        `bash ~/gmhdashboard/scripts/pre-deploy-check.sh 2>&1`,
        { timeout: 120000 }
      ).toString();
      const passed = !output.includes('BLOCKED');
      return NextResponse.json({ passed, output });
    }

    if (action === 'check-conflicts' && paths) {
      const output = execSync(
        `claude-coord conflicts ${paths.map((p: string) => `"${p}"`).join(' ')} --json 2>/dev/null || echo '{}'`,
        { timeout: 5000, env: { ...process.env, PATH: `${process.env.HOME}/.claude/bin:${process.env.PATH}` } }
      ).toString();
      return NextResponse.json(JSON.parse(output || '{}'));
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
