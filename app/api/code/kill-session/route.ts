import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { execSync } from 'child_process';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin' || user.email !== 'admin@nowoptimal.com') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = request.nextUrl.searchParams.get('session');
  if (!session || !session.startsWith('claude-task-')) {
    return NextResponse.json({ error: 'Invalid session name' }, { status: 400 });
  }

  try {
    execSync(`tmux kill-session -t ${session} 2>/dev/null`, { timeout: 5000 });
    return NextResponse.json({ status: 'killed', session });
  } catch {
    return NextResponse.json({ status: 'not_found', session });
  }
}
