import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { getTemplates } from '@/lib/templates';
import { Studio } from '@/components/studio/Studio';
import type { GeneratedAsset, Parameter, Tier } from '@/types';

interface StudioPageProps {
  searchParams: Promise<{ template?: string; asset?: string }>;
}

export default async function StudioPage({ searchParams }: StudioPageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const params = await searchParams;
  let initialAsset: GeneratedAsset | null = null;

  if (params.template) {
    const templates = await getTemplates();
    const template = templates.find((t) => t.id === params.template);
    if (template) {
      initialAsset = {
        id: `template-${template.id}`,
        title: template.title,
        code: template.code,
        jsCode: template.jsCode,
        parameters: template.parameters,
        durationInFrames: template.durationInFrames,
        fps: template.fps,
        width: template.width,
        height: template.height,
      };
    }
  } else if (params.asset) {
    const asset = await prisma.asset.findUnique({
      where: { id: params.asset, userId: session.user.id },
    });
    if (asset) {
      initialAsset = {
        id: asset.id,
        title: asset.title,
        code: asset.code,
        jsCode: asset.jsCode,
        parameters: asset.parameters as unknown as Parameter[],
        durationInFrames: asset.durationInFrames,
        fps: asset.fps,
        width: asset.width,
        height: asset.height,
      };
    }
  }

  return (
    <Studio
      tier={(session.user.tier || 'FREE') as Tier}
      userImage={session.user.image}
      userName={session.user.name}
      initialAsset={initialAsset}
    />
  );
}
