import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { TIER_LIMITS } from '@/lib/usage';

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    tier: user.tier,
    monthlyUsage: user.monthlyUsage,
    monthlyLimit: TIER_LIMITS[user.tier as 'FREE' | 'PRO'].monthlyGenerations,
    editUsage: user.editUsage,
    usageResetAt: user.usageResetAt,
  });
}
