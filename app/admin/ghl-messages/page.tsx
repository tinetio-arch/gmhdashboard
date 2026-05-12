import { requireUser } from '@/lib/auth';
import GHLMessagesClient from './GHLMessagesClient';

export default async function GHLMessagesPage() {
  await requireUser('read');

  return <GHLMessagesClient />;
}
