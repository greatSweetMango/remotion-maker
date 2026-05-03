import { NextResponse } from 'next/server';
import { signIn } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import bcrypt from 'bcryptjs';

export const runtime = 'nodejs';

const DEV_EMAIL = 'dev@localhost';
const DEV_PASSWORD = 'dev-bypass-key';

export async function GET(req: Request) {
  if (process.env.DEV_AUTO_LOGIN !== 'true') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  const callbackUrl = new URL(req.url).searchParams.get('callbackUrl') ?? '/studio';

  // Idempotent dev user upsert: ensure row exists with PRO tier so feature
  // gates don't block local development. Mirrors src/app/dev-login/actions.ts.
  // (TM-95: API route was missing tier=PRO; if a stale JWT session pointed
  // to a non-existent user_id after a worktree DB reset, downstream queries
  // silently failed — re-running this route now restores the row.)
  const existing = await prisma.user.findUnique({ where: { email: DEV_EMAIL } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email: DEV_EMAIL,
        name: 'Dev User',
        password: await bcrypt.hash(DEV_PASSWORD, 4),
        tier: 'PRO',
      },
    });
  } else if (existing.tier !== 'PRO') {
    await prisma.user.update({ where: { email: DEV_EMAIL }, data: { tier: 'PRO' } });
  }

  // signIn() throws a NEXT_REDIRECT — Next propagates it as the response.
  await signIn('credentials', { email: DEV_EMAIL, password: DEV_PASSWORD, redirectTo: callbackUrl });
  // Unreachable; satisfy TS return type.
  return NextResponse.redirect(new URL(callbackUrl, req.url));
}
