'use client';

import { useRouter } from 'next/navigation';
import BulkReceiveForm from './BulkReceiveForm';
import TransactionForm from './TransactionForm';
import type { PatientOption } from '@/lib/patientQueries';
import type { UserRole } from '@/lib/auth';
import BulkDeleteForm from './BulkDeleteForm';

type VialOption = {
  vial_id: string;
  external_id: string | null;
  remaining_volume_ml: string | null;
  size_ml: string | null;
  status: string | null;
  dea_drug_name: string | null;
};

type Props = {
  patientOptions: PatientOption[];
  vials: VialOption[];
  showBulk?: boolean;
  showTransactions?: boolean;
  currentUserRole: UserRole;
};

export default function InventoryActions({
  patientOptions,
  vials,
  showBulk = true,
  showTransactions = true,
  currentUserRole
}: Props) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const isAdmin = currentUserRole === 'admin';

  return (
    <div style={{ display: 'grid', gap: '1.5rem', marginBottom: '2.5rem' }}>
      {showBulk && <BulkReceiveForm onCompleted={refresh} currentUserRole={currentUserRole} />}
      {showTransactions && (
        <TransactionForm
          patients={patientOptions}
          vials={vials}
          onSaved={refresh}
          currentUserRole={currentUserRole}
        />
      )}
      {isAdmin && <BulkDeleteForm onCompleted={refresh} />}
    </div>
  );
}
