import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import MappingDiagnosticsClient from './MappingDiagnosticsClient';

export default async function MappingDiagnosticsPage() {
  const user = await getCurrentUser();

  if (!user || user.role !== 'admin') {
    redirect('/unauthorized');
  }

  return <MappingDiagnosticsClient />;
}







