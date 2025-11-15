import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import QuickBooksAdminClient from './QuickBooksAdminClient';

export default async function QuickBooksAdminPage() {
  const user = await getCurrentUser();

  if (!user || user.role !== 'admin') {
    redirect('/unauthorized');
  }

  return <QuickBooksAdminClient />;
}
