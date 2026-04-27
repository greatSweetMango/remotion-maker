import { randomBytes } from 'crypto';

/**
 * Generate a URL-safe public slug for asset sharing.
 * 12 chars from base64url encoding of 9 random bytes (~72 bits entropy).
 *
 * Used as a capability token for /share/[slug] — long enough to resist
 * guessing/enumeration, short enough for QR codes and copy-paste.
 */
export function generatePublicSlug(): string {
  return randomBytes(9).toString('base64url');
}
