'use client';

import { useRouter } from 'next/navigation';
import type { PatientOption } from '@/lib/patientQueries';
import TransactionForm from '../inventory/TransactionForm';
import type { UserRole } from '@/lib/auth';

type VialOption = {
  vial_id: string;
  external_id: string | null;
  remaining_volume_ml: string | null;
  size_ml: string | null;
  status: string | null;
  dea_drug_name: string | null;
};

type Props = {
  patients: PatientOption[];
  vials: VialOption[];
  currentUserRole: UserRole;
};

export default function TransactionsActions({ patients, vials, currentUserRole }: Props) {
  const router = useRouter();
  return (
    <TransactionForm
      patients={patients}
      vials={vials}
      onSaved={() => router.refresh()}
      currentUserRole={currentUserRole}
    />
  );
}

