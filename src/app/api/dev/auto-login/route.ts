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

  const existing = await prisma.user.findUnique({ where: { email: DEV_EMAIL } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email: DEV_EMAIL,
        name: 'Dev User',
        password: await bcrypt.hash(DEV_PASSWORD, 4),
      },
    });
  }

  await signIn('credentials', { email: DEV_EMAIL, password: DEV_PASSWORD, redirectTo: callbackUrl });
}
