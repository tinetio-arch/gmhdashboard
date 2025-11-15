import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import QuickBooksAdminClient from './QuickBooksAdminClient';

export default async function QuickBooksAdminPage() {
  const session = await getServerSession();

  if (!session?.user || session.user.role !== 'admin') {
    redirect('/unauthorized');
  }

  return <QuickBooksAdminClient />;
}
