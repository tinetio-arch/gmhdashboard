export const dynamic = 'force-dynamic';

import { fetchPharmacyOrders } from '@/lib/specialtyOrderQueries';
import { requireUser } from '@/lib/auth';
import PharmacyOrderTable from '../PharmacyOrderTable';

export default async function AlphaBioMedPage() {
    await requireUser('read');
    const orders = await fetchPharmacyOrders('alphabiomed');

    return (
        <section>
            <PharmacyOrderTable
                orders={orders}
                pharmacyType="alphabiomed"
                pharmacyName="Alpha BioMed"
                medicationLabel="Medication Ordered"
            />
        </section>
    );
}
