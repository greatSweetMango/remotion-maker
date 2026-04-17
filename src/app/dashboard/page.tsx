import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Zap, Plus, Sparkles, Download, Clock } from 'lucide-react';
import { TIER_LIMITS } from '@/lib/usage';
import type { Tier } from '@/types';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      assets: {
        orderBy: { updatedAt: 'desc' },
        take: 20,
        include: { _count: { select: { versions: true } } },
      },
      subscription: true,
    },
  });

  if (!user) redirect('/login');

  const tier = user.tier as Tier;
  const limit = TIER_LIMITS[tier].monthlyGenerations;
  const usagePercent = Math.min((user.monthlyUsage / limit) * 100, 100);

  const resetDate = new Date(user.usageResetAt);
  const nextReset = new Date(resetDate.getFullYear(), resetDate.getMonth() + 1, 1);

  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="flex items-center gap-4 px-6 py-4 border-b border-slate-800 bg-slate-900">
        <Link href="/" className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-violet-400" />
          <span className="font-bold text-white">EasyMake</span>
        </Link>
        <div className="ml-auto flex items-center gap-3">
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
              <div className="text-2xl font-bold text-white">{user.assets.length}</div>
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

          {user.assets.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-slate-700 rounded-xl">
              <Sparkles className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 mb-4">No animations yet</p>
              <Button asChild className="bg-violet-600 hover:bg-violet-700">
                <Link href="/studio">Create your first animation</Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {user.assets.map(asset => (
                <Link
                  key={asset.id}
                  href={`/studio?asset=${asset.id}`}
                  className="group bg-slate-800/50 rounded-xl border border-slate-700 hover:border-violet-500 transition-all p-4"
                >
                  <div className="aspect-video bg-slate-900 rounded-lg mb-3 flex items-center justify-center">
                    <Sparkles className="h-8 w-8 text-slate-600 group-hover:text-violet-400 transition-colors" />
                  </div>
                  <h3 className="text-white text-sm font-medium truncate">{asset.title}</h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(asset.updatedAt).toLocaleDateString()}
                    </span>
                    {asset._count.versions > 1 && (
                      <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400 py-0">
                        v{asset._count.versions}
                      </Badge>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
