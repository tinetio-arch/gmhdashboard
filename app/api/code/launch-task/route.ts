import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);
const SCRIPTS_DIR = path.join(process.env.HOME || '/home/ec2-user', 'gmhdashboard/scripts');

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin' || user.email !== 'admin@nowoptimal.com') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { task_id, user_input } = await request.json();
    if (!task_id) {
      return NextResponse.json({ error: 'task_id required' }, { status: 400 });
    }
    const safeTaskId = task_id.replace(/[^a-z0-9-]/g, '');
    const safeInput = (user_input || '').replace(/'/g, "'\\''").substring(0, 1000);

    const { stdout } = await execAsync(
      `bash ${SCRIPTS_DIR}/claude-task.sh '${safeTaskId}' '${safeInput}'`,
      { timeout: 45000 }
    );

    try {
      const result = JSON.parse(stdout.trim());
      return NextResponse.json(result);
    } catch {
      return NextResponse.json({ status: 'launched', raw: stdout.trim() });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
