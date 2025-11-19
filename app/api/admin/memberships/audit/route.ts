import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth';
import { getMembershipAuditData } from '@/lib/membershipAudit';

export async function GET(req: NextRequest) {
  await requireApiUser(req, 'admin');
  const data = await getMembershipAuditData();
  return NextResponse.json(data);
}

