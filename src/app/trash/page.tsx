import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';
import { Zap, ArrowLeft, Trash2 } from 'lucide-react';
import { TrashList } from '@/components/trash/TrashList';
import { purgeExpiredTrash, TRASH_RETENTION_DAYS } from '@/lib/trash/cleanup';

// Trash should never be cached — listing changes whenever the user deletes,
// restores, or hard-deletes an asset.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TrashPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = session.user.id;

  // Lazy 30-day cleanup before listing (TM-18).
  await purgeExpiredTrash(userId);

  const items = await prisma.asset.findMany({
    where: { userId, deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    select: {
      id: true,
      title: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const serialized = items.map((a) => ({
    id: a.id,
    title: a.title,
    deletedAt: a.deletedAt!.toISOString(),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  }));

  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="flex items-center gap-4 px-6 py-4 border-b border-slate-800 bg-slate-900">
        <Link href="/" className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-violet-400" />
          <span className="font-bold text-white">EasyMake</span>
        </Link>
        <Link
          href="/dashboard"
          className="ml-auto flex items-center gap-1 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center gap-3 mb-2">
          <Trash2 className="h-6 w-6 text-slate-400" />
          <h1 className="text-2xl font-bold text-white">Trash</h1>
        </div>
        <p className="text-sm text-slate-400 mb-8">
          Items here are kept for {TRASH_RETENTION_DAYS} days, then permanently deleted.
          You can restore or delete them now.
        </p>

        <TrashList initialItems={serialized} retentionDays={TRASH_RETENTION_DAYS} />
      </div>
    </div>
  );
}
