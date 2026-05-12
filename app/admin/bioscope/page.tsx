import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import BioscopeAdminClient from '../BioscopeAdminClient';

export default async function BioscopeAdminPage() {
  const user = await getCurrentUser();

  if (!user || user.role !== 'admin') {
    redirect('/unauthorized');
  }

  return <BioscopeAdminClient />;
}
