'use client';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Zap } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

const FREE_FEATURES = [
  '3 generations / month',
  '3 edits per asset',
  'Quick AI model (Haiku)',
  'GIF export (with watermark)',
  '3 customization parameters',
  'Web embed (free forever)',
];

const PRO_FEATURES = [
  '200 generations / month',
  'Unlimited edits',
  'Creative AI model (Sonnet)',
  'MP4 1080p, WebM (alpha), PNG',
  'All customization parameters',
  'React component export',
  'Web embed (no watermark)',
  'Priority support',
];

export default function PricingPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    if (!session) {
      router.push('/login?callbackUrl=/pricing');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      const { url, error } = await res.json();
      if (error) throw new Error(error);
      window.location.href = url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open checkout';
      toast.error(message);
      setLoading(false);
    }
  }

  return (
    <div className="pt-32 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-white mb-4">Simple, transparent pricing</h1>
          <p className="text-slate-400 text-lg">Start free. Upgrade when you need more.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-8">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-white">Free</h2>
              <div className="mt-3">
                <span className="text-4xl font-black text-white">$0</span>
                <span className="text-slate-400 ml-2">/ month</span>
              </div>
              <p className="text-slate-400 text-sm mt-2">Perfect for trying out EasyMake</p>
            </div>

            <ul className="space-y-3 mb-8">
              {FREE_FEATURES.map(f => (
                <li key={f} className="flex items-center gap-3 text-sm text-slate-300">
                  <Check className="h-4 w-4 text-slate-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <Button asChild variant="outline" className="w-full border-slate-600 text-white hover:bg-slate-700">
              <a href="/login">Get Started Free</a>
            </Button>
          </div>

          <div className="bg-violet-950/50 rounded-2xl border border-violet-500/50 p-8 relative overflow-hidden">
            <div className="absolute top-4 right-4">
              <Badge className="bg-violet-600 text-white text-xs">Most Popular</Badge>
            </div>
            <div className="absolute inset-0 bg-gradient-to-br from-violet-600/5 to-transparent pointer-events-none" />

            <div className="mb-6 relative">
              <h2 className="text-xl font-bold text-white">Pro</h2>
              <div className="mt-3">
                <span className="text-4xl font-black text-white">$12</span>
                <span className="text-slate-400 ml-2">/ month</span>
              </div>
              <p className="text-slate-400 text-sm mt-2">For creators and developers</p>
            </div>

            <ul className="space-y-3 mb-8 relative">
              {PRO_FEATURES.map(f => (
                <li key={f} className="flex items-center gap-3 text-sm text-slate-300">
                  <Check className="h-4 w-4 text-violet-400 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <Button
              onClick={handleUpgrade}
              disabled={loading}
              className="w-full bg-violet-600 hover:bg-violet-700 relative"
            >
              <Zap className="h-4 w-4 mr-2" />
              {loading ? 'Redirecting...' : 'Upgrade to Pro'}
            </Button>
          </div>
        </div>

        <div className="mt-20 max-w-2xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-white text-center mb-8">Frequently Asked Questions</h2>
          {[
            {
              q: 'What counts as a generation?',
              a: 'Each time you enter a prompt and create a new animation from scratch, that counts as one generation. Editing an existing animation (re-prompting) does not count as a new generation.',
            },
            {
              q: 'Can I cancel anytime?',
              a: 'Yes. Cancel anytime from your dashboard. You keep Pro access until the end of your billing period, then automatically downgrade to Free.',
            },
            {
              q: 'What happens to my assets if I downgrade?',
              a: "All your previously created assets remain accessible. You just can't generate new ones beyond the Free tier limit.",
            },
          ].map(({ q, a }) => (
            <div key={q} className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
              <h3 className="text-white font-semibold mb-2">{q}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
