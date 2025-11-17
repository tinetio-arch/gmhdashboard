import AuditClient from './AuditClient';
import { requireUser } from '@/lib/auth';
import { fetchAuditHistory, fetchAuditSummary } from '@/lib/auditQueries';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  await requireUser('write');
  const [history, summary] = await Promise.all([fetchAuditHistory(), fetchAuditSummary()]);
  return <AuditClient history={history} summary={summary} />;
}


