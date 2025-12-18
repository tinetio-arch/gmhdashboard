import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import UsersAdminClient from '../UsersAdminClient';

export default async function UsersAdminPage() {
  const user = await getCurrentUser();

  if (!user || user.role !== 'admin') {
    redirect('/unauthorized');
  }

  return <UsersAdminClient />;
}



