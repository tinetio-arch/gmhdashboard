import { requireUser } from '@/lib/auth';
import AppControlClient from './AppControlClient';

export default async function AppControlPage() {
    await requireUser('admin');

    return <AppControlClient />;
}
