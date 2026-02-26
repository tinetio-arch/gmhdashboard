import { redirect } from 'next/navigation';
import { getCurrentUser, userHasRole } from '@/lib/auth';

export default async function HomePage() {
    const user = await getCurrentUser();

    if (!user) {
        redirect('/login');
    }

    if (userHasRole(user, 'admin')) {
        redirect('/analytics');
    } else {
        redirect('/patients');
    }
}
