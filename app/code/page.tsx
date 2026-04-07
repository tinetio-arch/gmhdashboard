import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import CommandCenterClient from './CommandCenterClient';

export default async function CodePage() {
  const user = await getCurrentUser();

  // Must be logged in, admin role, and specifically admin@nowoptimal.com
  if (!user || user.role !== 'admin' || user.email !== 'admin@nowoptimal.com') {
    redirect('/unauthorized');
  }

  return <CommandCenterClient userEmail={user.email} />;
}
