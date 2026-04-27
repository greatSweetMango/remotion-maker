/**
 * TM-61 dev-only visual preview for FluidBlobs.
 * Bypasses auth (path not in proxy.ts PROTECTED_PATHS) and renders the
 * raw component at frame 0 (and a tiny Player loop) so we can verify the
 * metaball goo composition without touching shared studio cookies.
 *
 * NOT shipped — delete before merge if it leaks past local verification.
 */
import { notFound } from 'next/navigation';
import { Client } from './client';

export const dynamic = 'force-dynamic';

export default function DevFluidPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Client />;
}
