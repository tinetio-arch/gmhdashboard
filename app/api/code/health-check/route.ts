import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

const DOCS_DIR = path.join(process.env.HOME || '/home/ec2-user', 'gmhdashboard/docs');
const SCRIPTS_DIR = path.join(process.env.HOME || '/home/ec2-user', 'gmhdashboard/scripts');

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin' || user.email !== 'admin@nowoptimal.com') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    execSync(`bash ${SCRIPTS_DIR}/health-check.sh`, { timeout: 30000 });
    execSync(`bash ${SCRIPTS_DIR}/generate-status-report.sh`, { timeout: 30000 });
    const kpi = readFileSync(path.join(DOCS_DIR, 'KPI_CHECK.md'), 'utf8');
    const status = readFileSync(path.join(DOCS_DIR, 'LIVE_STATUS.md'), 'utf8');
    const tracker = readFileSync(path.join(DOCS_DIR, 'PROJECT_TRACKER.md'), 'utf8');
    return NextResponse.json({ kpi, status, tracker });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
