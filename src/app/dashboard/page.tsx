import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Zap, Plus, Sparkles, Download, Trash2 } from 'lucide-react';
import { TIER_LIMITS } from '@/lib/usage';
import { AssetGrid } from '@/components/dashboard/AssetGrid';
import type { Tier } from '@/types';

const PAGE_SIZE = 24;

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { subscription: true },
  });

  if (!user) redirect('/login');

  const [totalAssets, initialAssets] = await Promise.all([
    prisma.asset.count({ where: { userId: user.id, deletedAt: null } }),
    prisma.asset.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: PAGE_SIZE,
      include: { _count: { select: { versions: true } } },
    }),
  ]);

  const tier = user.tier as Tier;
  const limit = TIER_LIMITS[tier].monthlyGenerations;
  const usagePercent = Math.min((user.monthlyUsage / limit) * 100, 100);

  const resetDate = new Date(user.usageResetAt);
  const nextReset = new Date(resetDate.getFullYear(), resetDate.getMonth() + 1, 1);

  const initialPagination = {
    page: 1,
    pageSize: PAGE_SIZE,
    total: totalAssets,
    totalPages: Math.max(1, Math.ceil(totalAssets / PAGE_SIZE)),
  };

  // Convert Date → string for client component serialization stability.
  const serializedAssets = initialAssets.map((a) => ({
    id: a.id,
    title: a.title,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    _count: a._count,
  }));

  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="flex items-center gap-4 px-6 py-4 border-b border-slate-800 bg-slate-900">
        <Link href="/" className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-violet-400" />
          <span className="font-bold text-white">EasyMake</span>
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <Button asChild variant="outline" className="border-slate-700 text-slate-300">
            <Link href="/trash">
              <Trash2 className="h-4 w-4 mr-2" />
              Trash
            </Link>
          </Button>
          <Button asChild className="bg-violet-600 hover:bg-violet-700">
            <Link href="/studio">
              <Plus className="h-4 w-4 mr-2" />
              New Animation
            </Link>
          </Button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-slate-400 text-sm mt-1">
              Welcome back, {user.name || user.email}
            </p>
          </div>
          <Badge
            className={tier === 'PRO' ? 'bg-violet-700 text-white' : 'bg-slate-700 text-slate-300'}
          >
            {tier} Plan
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-400 font-medium uppercase tracking-wide flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                Monthly Generations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                {user.monthlyUsage} <span className="text-slate-500 text-base font-normal">/ {limit}</span>
              </div>
              <Progress value={usagePercent} className="mt-2 h-1.5" />
              <p className="text-xs text-slate-500 mt-1.5">
                Resets {nextReset.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-400 font-medium uppercase tracking-wide flex items-center gap-2">
                <Download className="h-3.5 w-3.5" />
                Total Assets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{totalAssets}</div>
              <p className="text-xs text-slate-500 mt-1.5">animations created</p>
            </CardContent>
          </Card>

          <Card className={`border ${tier === 'FREE' ? 'bg-violet-950/30 border-violet-700/30' : 'bg-slate-800/50 border-slate-700'}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-slate-400 font-medium uppercase tracking-wide flex items-center gap-2">
                <Zap className="h-3.5 w-3.5" />
                Your Plan
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{tier}</div>
              {tier === 'FREE' ? (
                <Button asChild size="sm" className="mt-2 bg-violet-600 hover:bg-violet-700 text-xs h-7 w-full">
                  <Link href="/pricing">Upgrade to Pro →</Link>
                </Button>
              ) : (
                <p className="text-xs text-violet-300 mt-1.5">
                  Renews {user.subscription?.currentPeriodEnd
                    ? new Date(user.subscription.currentPeriodEnd).toLocaleDateString()
                    : 'monthly'}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Your Animations</h2>
          <AssetGrid
            initialAssets={serializedAssets}
            initialPagination={initialPagination}
            tier={tier}
          />
        </div>
      </div>
    </div>
  );
}
