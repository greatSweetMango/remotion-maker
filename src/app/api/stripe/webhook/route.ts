import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe/client';
import { prisma } from '@/lib/db/prisma';
import type Stripe from 'stripe';

export const runtime = 'nodejs';

async function updateUserTier(customerId: string, tier: 'FREE' | 'PRO') {
  const sub = await prisma.subscription.findUnique({ where: { stripeCustomerId: customerId } });
  if (!sub) return;
  await Promise.all([
    prisma.subscription.update({
      where: { stripeCustomerId: customerId },
      data: { tier, status: tier === 'PRO' ? 'active' : 'canceled' },
    }),
    prisma.user.update({ where: { id: sub.userId }, data: { tier } }),
  ]);
}

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription & { current_period_end: number };
      const customerId = subscription.customer as string;
      const isActive = ['active', 'trialing'].includes(subscription.status);
      const existing = await prisma.subscription.findUnique({ where: { stripeCustomerId: customerId } });
      if (existing) {
        await prisma.subscription.update({
          where: { stripeCustomerId: customerId },
          data: {
            stripeSubscriptionId: subscription.id,
            tier: isActive ? 'PRO' : 'FREE',
            status: subscription.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          },
        });
      }
      await updateUserTier(customerId, isActive ? 'PRO' : 'FREE');
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await updateUserTier(subscription.customer as string, 'FREE');
      break;
    }
  }

  return NextResponse.json({ received: true });
}
