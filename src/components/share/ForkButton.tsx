'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ForkButtonProps {
  /** Public share slug of the source asset. */
  slug: string;
  /** Whether the visitor is signed in. Drives the click behavior. */
  isAuthenticated: boolean;
  /** Optional class for layout overrides. */
  className?: string;
}

/**
 * "Use this as starting point" — clones the shared asset into the visitor's
 * library and routes them straight into /studio.
 *
 * - Signed out: redirects to /login with a callbackUrl that returns the user
 *   to /share/<slug>?fork=1, which auto-forks on mount.
 * - Signed in: POSTs to /api/asset/fork and navigates to /studio?asset=<id>.
 */
export function ForkButton({
  slug,
  isAuthenticated,
  className,
}: ForkButtonProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const autoFiredRef = useRef(false);

  // Post-login auto-fork: when /login redirects back with ?fork=1 and the
  // visitor is now authenticated, trigger the fork once on mount.
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (!isAuthenticated) return;
    if (searchParams?.get('fork') !== '1') return;
    autoFiredRef.current = true;
    void performFork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, searchParams]);

  async function performFork() {
    setLoading(true);
    try {
      const res = await fetch('/api/asset/fork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });

      if (res.status === 401) {
        // Lost session between page load and click — bounce through login.
        const callbackUrl = `/share/${slug}?fork=1`;
        await signIn(undefined, { callbackUrl });
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body && typeof body.error === 'string' && body.error) ||
            `Fork failed (${res.status})`,
        );
      }

      const data = (await res.json()) as { id: string };
      toast.success('Copied to your library');
      router.push(`/studio?asset=${data.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not fork';
      toast.error(msg);
      setLoading(false);
    }
    // Note: on success we leave `loading` true so the button stays disabled
    // through the navigation transition.
  }

  function onClick() {
    if (loading) return;
    if (!isAuthenticated) {
      // Preserve the fork intent across login. The /share page reads ?fork=1
      // on mount and triggers the fork automatically post-redirect.
      const callbackUrl = `/share/${slug}?fork=1`;
      const loginUrl = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
      router.push(loginUrl);
      return;
    }
    void performFork();
  }

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={className}
      data-testid="fork-button"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
      ) : (
        <Copy className="h-4 w-4 mr-1.5" />
      )}
      {loading ? 'Copying…' : 'Use this as starting point'}
    </Button>
  );
}
