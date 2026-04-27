'use client';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Share2, Copy, Check, Loader2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface ShareButtonProps {
  assetId: string;
  /** Pre-existing slug from the server, if any. Lets the modal skip the POST. */
  initialSlug?: string | null;
  /** Optional class for the trigger button. */
  className?: string;
  /** Visual size, forwarded to the Button. */
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

/**
 * Share button that opens a modal exposing a public read-only link.
 * On first open without a slug, POSTs to /api/asset/[id]/share to mint one.
 */
export function ShareButton({
  assetId,
  initialSlug = null,
  className,
  size = 'sm',
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareUrl =
    slug && typeof window !== 'undefined'
      ? `${window.location.origin}/share/${slug}`
      : slug
        ? `/share/${slug}`
        : '';

  async function ensureSlug() {
    if (slug || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/asset/${assetId}/share`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { slug: string };
      setSlug(data.slug);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create share link';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void ensureSlug();
  }

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(
      () => {
        setCopied(true);
        toast.success('Link copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error('Could not copy link')
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={size}
          className={className}
          data-testid="share-button"
        >
          <Share2 className="h-4 w-4 mr-1.5" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this animation</DialogTitle>
          <DialogDescription>
            Anyone with this link can view a read-only preview. No sign-in required.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
            Public link
          </label>
          {loading && !slug ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 px-3 py-2 bg-slate-900 rounded-md border border-slate-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating link...
            </div>
          ) : slug ? (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 font-mono"
                data-testid="share-url-input"
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={copyLink}
                aria-label="Copy link"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button asChild size="icon" variant="outline" aria-label="Open in new tab">
                <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-red-400">
              Could not create a share link. Try again.
            </p>
          )}

          <p className="text-xs text-slate-500">
            Free plan animations show a small &ldquo;Made with EasyMake&rdquo; watermark.
            Upgrade to Pro to remove it.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
