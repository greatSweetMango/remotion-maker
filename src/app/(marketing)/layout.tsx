import Link from 'next/link';
import { auth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Zap } from 'lucide-react';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center gap-4 px-6 py-4 bg-slate-950/80 backdrop-blur-sm border-b border-slate-800">
        <Link href="/" className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-violet-400" />
          <span className="font-bold text-white">EasyMake</span>
        </Link>
        <div className="hidden md:flex items-center gap-6 ml-8">
          <Link href="/pricing" className="text-sm text-slate-400 hover:text-white transition-colors">Pricing</Link>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {session ? (
            <Button asChild className="bg-violet-600 hover:bg-violet-700">
              <Link href="/studio">Open Studio</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" className="text-slate-300 hover:text-white">
                <Link href="/login">Sign In</Link>
              </Button>
              <Button asChild className="bg-violet-600 hover:bg-violet-700">
                <Link href="/login">Get Started Free</Link>
              </Button>
            </>
          )}
        </div>
      </nav>
      {children}
    </div>
  );
}
