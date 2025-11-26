export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getMembershipAuditData, getQuickBooksAuditData } from '@/lib/membershipAudit';
import { fetchLookupSets } from '@/lib/lookups';
import { getPatientAnalyticsBreakdown } from '@/lib/patientAnalytics';
import SimplifiedAuditClient from './SimplifiedAuditClient';
import AnalyticsSection from './AnalyticsSection';

export default async function MembershipAuditPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    redirect('/unauthorized');
  }

  const [data, lookups, quickbooksData, analytics] = await Promise.all([
    getMembershipAuditData(),
    fetchLookupSets(),
    getQuickBooksAuditData(),
    getPatientAnalyticsBreakdown()
  ]);
  
  return (
    <>
      <AnalyticsSection analytics={analytics} />
      <SimplifiedAuditClient data={data} lookups={lookups} quickbooksData={quickbooksData} />
    </>
  );
}


