import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import FinancialsAdminClient from './FinancialsAdminClient';

export default async function FinancialsAdminPage() {
  const user = await getCurrentUser();

  if (!user || user.role !== 'admin') {
    redirect('/unauthorized');
  }

  return <FinancialsAdminClient />;
}

