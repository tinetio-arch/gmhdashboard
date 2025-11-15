import ProviderSignatureClient from './ProviderSignatureClient';
import { requireUser } from '@/lib/auth';
import { fetchProviderSignatureQueue, fetchProviderSignatureSummary } from '@/lib/inventoryQueries';

export const dynamic = 'force-dynamic';

export default async function ProviderSignaturesPage() {
  const user = await requireUser('write');

  const [queue, summary] = await Promise.all([fetchProviderSignatureQueue(), fetchProviderSignatureSummary()]);

  return (
    <ProviderSignatureClient
      queue={queue}
      summary={summary}
      currentUserRole={user.role}
      currentUserCanSign={user.can_sign}
    />
  );
}
