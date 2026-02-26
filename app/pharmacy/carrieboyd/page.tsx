export const dynamic = 'force-dynamic';

import { fetchPharmacyOrders } from '@/lib/specialtyOrderQueries';
import { requireUser } from '@/lib/auth';
import PharmacyOrderTable from '../PharmacyOrderTable';

export default async function CarrieBoydPage() {
    await requireUser('read');
    const orders = await fetchPharmacyOrders('carrieboyd');

    return (
        <section>
            <PharmacyOrderTable
                orders={orders}
                pharmacyType="carrieboyd"
                pharmacyName="Carrie Boyd"
                medicationLabel="Medication"
            />
        </section>
    );
}
