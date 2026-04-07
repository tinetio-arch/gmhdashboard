import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { execSync } from 'child_process';

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin' || user.email !== 'admin@nowoptimal.com') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const out = execSync('tmux list-sessions 2>/dev/null || echo ""', { timeout: 5000 }).toString();
    const sessions = out.trim().split('\n').filter(l => l.includes('claude')).map(l => {
      const name = l.split(':')[0];
      let remote_control_url = '';
      try {
        const pane = execSync(`tmux capture-pane -t ${name} -p 2>/dev/null`, { timeout: 3000 }).toString();
        const match = pane.match(/https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_]+/);
        if (match) remote_control_url = match[0];
      } catch(e) {}
      return { name, remote_control_url, attached: l.includes('attached') };
    });
    return NextResponse.json({ sessions });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
