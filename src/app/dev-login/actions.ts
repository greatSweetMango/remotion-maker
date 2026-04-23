'use server';
import { signIn } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import bcrypt from 'bcryptjs';

const DEV_EMAIL = 'dev@localhost';
const DEV_PASSWORD = 'dev-bypass-key';

export async function devAutoLogin(formData: FormData) {
  const callbackUrl = (formData.get('callbackUrl') as string) ?? '/studio';

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
    await prisma.user.update({
      where: { email: DEV_EMAIL },
      data: { tier: 'PRO' },
    });
  }

  await signIn('credentials', { email: DEV_EMAIL, password: DEV_PASSWORD, redirectTo: callbackUrl });
}
