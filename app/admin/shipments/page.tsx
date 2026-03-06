import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ShipmentsAdminClient from '../ShipmentsAdminClient';

export default async function ShipmentsAdminPage() {
    const user = await getCurrentUser();

    if (!user || user.role !== 'admin') {
        redirect('/unauthorized');
    }

    return <ShipmentsAdminClient />;
}
