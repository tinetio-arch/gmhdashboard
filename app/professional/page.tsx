export const dynamic = 'force-dynamic';

import { requireUser } from '@/lib/auth';
import GHLManagementClient from './GHLManagementClient';

export default async function ProfessionalDashboardPage() {
  await requireUser('write'); // Requires write access since this can trigger syncs
  
  return <GHLManagementClient />;
}
