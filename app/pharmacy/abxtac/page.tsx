export const dynamic = 'force-dynamic';

import { fetchPharmacyOrders } from '@/lib/specialtyOrderQueries';
import { requireUser } from '@/lib/auth';
import PharmacyOrderTable from '../PharmacyOrderTable';

export default async function AbxtacPage() {
    await requireUser('read');
    const orders = await fetchPharmacyOrders('abxtac');

    return (
        <section>
            <PharmacyOrderTable
                orders={orders}
                pharmacyType="abxtac"
                pharmacyName="ABXTAC"
                medicationLabel="Medication Ordered"
            />
        </section>
    );
}
