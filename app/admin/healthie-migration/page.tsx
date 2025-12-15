import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import HealthieMigrationClient from './HealthieMigrationClient';

export default async function HealthieMigrationPage() {
  const user = await getCurrentUser();

  if (!user || user.role !== 'admin') {
    redirect('/unauthorized');
  }

  return <HealthieMigrationClient />;
}

