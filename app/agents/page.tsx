import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import AgentsDashboard from './AgentsDashboard';

export default async function AgentsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    redirect('/unauthorized');
  }
  return <AgentsDashboard userEmail={user.email} />;
}
