import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

/**
 * TM-121: Post-login landing branch.
 *
 * Existing users with at least one saved asset land on /dashboard so they can
 * immediately find their previous work (the original blocker was "I don't
 * know how to see what I made"). Brand-new users with zero assets continue
 * straight to /studio so the empty state never appears between login and
 * first creation.
 *
 * Lives at /welcome so signIn(callbackUrl) can target a single stable path
 * regardless of user state, and the LoginPage's same-origin guard
 * (safeCallbackUrl) keeps working unchanged.
 */
export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const count = await prisma.asset.count({
    where: { userId: session.user.id, deletedAt: null },
  });

  redirect(count > 0 ? '/dashboard' : '/studio');
}
