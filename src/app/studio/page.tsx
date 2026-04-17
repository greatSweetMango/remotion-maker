import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Studio } from '@/components/studio/Studio';
import type { Tier } from '@/types';

export default async function StudioPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <Studio
      tier={(session.user.tier || 'FREE') as Tier}
      userImage={session.user.image}
      userName={session.user.name}
    />
  );
}
