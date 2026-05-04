/**
 * Pure tier-limit constants — kept in a leaf module with **no** server-only
 * dependencies (no prisma, no fs) so client components like
 * `src/components/studio/PromptPanel.tsx` can import the table without
 * dragging the Prisma client into the browser bundle.
 *
 * Surfaced when TM-98 dev verification revealed the chunker pulling
 * `node:fs` (prisma → @prisma/client) into a client chunk via
 * `usage.ts → prisma`. Splitting the constant is the smallest fix that
 * preserves the public re-export from `@/lib/usage`.
 */
import type { Tier } from '@/types';

export const TIER_LIMITS = {
  FREE: { monthlyGenerations: 3, editsPerAsset: 3, uploadImages: 5, uploadFonts: 3 },
  PRO:  { monthlyGenerations: 200, editsPerAsset: Infinity, uploadImages: Infinity, uploadFonts: Infinity },
} as const satisfies Record<Tier, {
  monthlyGenerations: number;
  editsPerAsset: number;
  uploadImages: number;
  uploadFonts: number;
}>;
