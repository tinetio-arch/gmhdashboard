export const dynamic = 'force-dynamic';

import { fetchPharmacyOrders } from '@/lib/specialtyOrderQueries';
import { requireUser } from '@/lib/auth';
import PharmacyOrderTable from '../PharmacyOrderTable';

export default async function StrivePage() {
    await requireUser('read');
    const orders = await fetchPharmacyOrders('tirzepatide');

    return (
        <section>
            <PharmacyOrderTable
                orders={orders}
                pharmacyType="tirzepatide"
                pharmacyName="Strive (Tirzepatide)"
                medicationLabel="Vials Ordered"
            />
        </section>
    );
}
