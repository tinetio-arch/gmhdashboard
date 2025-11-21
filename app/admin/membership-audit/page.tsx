export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getMembershipAuditData, getQuickBooksAuditData } from '@/lib/membershipAudit';
import { fetchLookupSets } from '@/lib/lookups';
import MembershipAuditClient from './MembershipAuditClient';

export default async function MembershipAuditPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    redirect('/unauthorized');
  }

  const [data, lookups, quickbooksData] = await Promise.all([
    getMembershipAuditData(),
    fetchLookupSets(),
    getQuickBooksAuditData()
  ]);
  return <MembershipAuditClient data={data} lookups={lookups} quickbooksData={quickbooksData} />;
}


