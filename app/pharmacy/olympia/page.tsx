export const dynamic = 'force-dynamic';

import { fetchPharmacyOrders } from '@/lib/specialtyOrderQueries';
import { requireUser } from '@/lib/auth';
import PharmacyOrderTable from '../PharmacyOrderTable';

export default async function OlympiaPage() {
    await requireUser('read');
    const orders = await fetchPharmacyOrders('olympia');

    return (
        <section>
            <PharmacyOrderTable
                orders={orders}
                pharmacyType="olympia"
                pharmacyName="Olympia"
                medicationLabel="Medication"
            />
        </section>
    );
}
