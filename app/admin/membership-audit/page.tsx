import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getMembershipAuditData } from '@/lib/membershipAudit';
import MembershipAuditClient from './MembershipAuditClient';

export default async function MembershipAuditPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    redirect('/unauthorized');
  }

  const data = await getMembershipAuditData();
  return <MembershipAuditClient data={data} />;
}

