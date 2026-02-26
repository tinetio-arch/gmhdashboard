export const dynamic = 'force-dynamic';

import { fetchPharmacyOrders } from '@/lib/specialtyOrderQueries';
import { requireUser } from '@/lib/auth';
import PharmacyOrderTable from '../PharmacyOrderTable';

export default async function TopRxPage() {
    await requireUser('read');
    const orders = await fetchPharmacyOrders('toprx');

    return (
        <section>
            <PharmacyOrderTable
                orders={orders}
                pharmacyType="toprx"
                pharmacyName="TopRX"
                medicationLabel="Medication"
            />
        </section>
    );
}
