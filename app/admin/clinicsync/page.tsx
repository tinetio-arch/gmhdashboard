import { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import ClinicSyncAdminClient from './ClinicSyncAdminClient';

export const metadata: Metadata = {
  title: 'ClinicSync Configuration - GMH Dashboard',
  description: 'Configure ClinicSync webhook filtering and sync settings',
};

export default async function ClinicSyncAdminPage() {
  const user = await requireUser('admin');

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">ClinicSync Configuration</h1>
          <p className="text-gray-600">
            Configure webhook filtering to reduce unnecessary processing of patients without membership data.
          </p>
        </div>

        <ClinicSyncAdminClient />
      </div>
    </div>
  );
}


