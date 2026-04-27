import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { SharePlayer } from '@/components/share/SharePlayer';
import { ForkButton } from '@/components/share/ForkButton';
import type { Parameter, Tier } from '@/types';
import type { Metadata } from 'next';

// SSR — never cache stale data; slug is a capability token.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function loadShared(slug: string) {
  return prisma.asset.findFirst({
    where: { publicSlug: slug, deletedAt: null },
    select: {
      id: true,
      title: true,
      jsCode: true,
      parameters: true,
      durationInFrames: true,
      fps: true,
      width: true,
      height: true,
      sharedAt: true,
      user: { select: { tier: true } },
    },
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const asset = await loadShared(slug);
  if (!asset) return { title: 'Shared animation not found' };
  return {
    title: `${asset.title} — EasyMake`,
    description: 'Animation made with EasyMake.',
    openGraph: {
      title: asset.title,
      description: 'Animation made with EasyMake.',
      type: 'video.other',
    },
  };
}

export default async function SharePage({ params }: PageProps) {
  const { slug } = await params;
  const [asset, session] = await Promise.all([loadShared(slug), auth()]);
  if (!asset) notFound();

  let parameters: Parameter[] = [];
  try {
    const parsed = JSON.parse(asset.parameters);
    if (Array.isArray(parsed)) parameters = parsed as Parameter[];
  } catch {
    parameters = [];
  }

  const tier = (asset.user?.tier as Tier | undefined) ?? 'FREE';
  const watermark = tier !== 'PRO';
  const isAuthenticated = Boolean(session?.user?.id);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-slate-800 bg-slate-900">
        <Link href="/" className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-violet-400" />
          <span className="font-bold text-white">EasyMake</span>
        </Link>
        <span className="ml-auto text-xs text-slate-500">Shared animation</span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <div className="w-full max-w-4xl">
          <h1 className="text-xl font-semibold text-white mb-3 truncate">
            {asset.title}
          </h1>
          <div className="rounded-lg overflow-hidden border border-slate-800 bg-black">
            <SharePlayer
              jsCode={asset.jsCode}
              parameters={parameters}
              durationInFrames={asset.durationInFrames}
              fps={asset.fps}
              width={asset.width}
              height={asset.height}
              watermark={watermark}
            />
          </div>
        </div>

        <div className="text-center flex flex-col items-center gap-3">
          <p className="text-sm text-slate-400">
            Like it? Make it yours.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <ForkButton
              slug={slug}
              isAuthenticated={isAuthenticated}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            />
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-200 text-sm font-medium"
            >
              <Zap className="h-4 w-4" />
              Try EasyMake
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
