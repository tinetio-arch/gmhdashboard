export const dynamic = 'force-dynamic';

import { fetchPharmacyOrders } from '@/lib/specialtyOrderQueries';
import { requireUser } from '@/lib/auth';
import PharmacyOrderTable from '../PharmacyOrderTable';

export default async function FarmakaioPage() {
    await requireUser('read');
    const orders = await fetchPharmacyOrders('farmakaio');

    return (
        <section>
            <PharmacyOrderTable
                orders={orders}
                pharmacyType="farmakaio"
                pharmacyName="Farmakaio"
                medicationLabel="Medication"
            />
        </section>
    );
}
