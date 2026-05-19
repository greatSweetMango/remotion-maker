/**
 * TM-175 — lucide-react export whitelist.
 *
 * Built dynamically at module load by introspecting the actual `lucide-react`
 * module namespace, so it tracks whatever version is pinned in package.json.
 * Filtered to PascalCase identifiers (the icon export shape — e.g. `Star`,
 * `Heart`, `ChartBar`); excludes lowercase helpers (`createLucideIcon`,
 * `defaultAttributes`, etc.) that user code can never validly emit inside a
 * JSX tag like `<lucide.X>`.
 *
 * Why this exists
 * ---------------
 * TM-118 fixed the case where gpt-4o emits `<lucide.Icon name="foo"/>` —
 * a generic API that doesn't exist in lucide-react. That sanitizer is a
 * pattern match on the literal token `Icon name=`. It does NOT catch the
 * second class of hallucination observed in TM-166:
 *
 *     <lucide.Flowers .../>    // pluralised invented name
 *     <lucide.SunRise .../>    // wrong casing (real is `Sunrise`)
 *     <lucide.CharacterIcon /> // wholly invented PascalCase identifier
 *
 * These tags pass the TM-118 regex (no `name=` attribute) and hit the
 * evaluator. `lucide.Flowers` is `undefined` → React throws
 * `Type is invalid: ... got undefined` → `<Unknown>` ErrorBoundary residue
 * (the post-TM-118 failure mode we're patching).
 *
 * This whitelist is the source of truth for "is `X` a real lucide-react
 * export?" — consumed by `sanitizeForbiddenTokens` in `src/lib/ai/pipeline.ts`
 * (rewrites invented icons → `Star`) and by `validateCode` in
 * `src/lib/remotion/sandbox.ts` (final defensive layer).
 *
 * Maintenance
 * -----------
 * No manual updates required. Lucide adds icons → npm bump picks them up
 * automatically. The set is computed once at module load (~5800 entries,
 * negligible cost). If lucide-react ever switches to a non-namespace
 * export shape, this file is the single place to retarget.
 */
import * as LucideLib from 'lucide-react';

/**
 * PascalCase identifier check: starts with uppercase letter, followed by
 * letters/digits only. Matches the shape of every lucide icon export
 * (`AArrowDown`, `Star`, `ChartBar3`). Deliberately excludes
 * `createLucideIcon`, `defaultAttributes`, `icons`, etc.
 */
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;

/**
 * The set of every PascalCase named export from `lucide-react`. Used as a
 * read-only whitelist; never mutated after module init.
 *
 * `Icon` IS a real export in lucide-react but is special-cased by the
 * TM-118 scrubber (it crashes on `name=` props). Keeping it in the
 * whitelist here is correct — the TM-118 sanitizer runs BEFORE the TM-175
 * scrubber, so by the time we check, any `<lucide.Icon name=...>` has
 * already been rewritten. A bare `<lucide.Icon iconNode={...}/>` (the
 * legitimate dynamic API) would pass through both untouched, as intended.
 */
export const LUCIDE_VALID_NAMES: ReadonlySet<string> = new Set(
  Object.keys(LucideLib).filter(k => PASCAL_CASE.test(k)),
);

/**
 * Default substitute when an invented icon is scrubbed. Matches
 * `DEFAULT_LUCIDE_ICON` from `lucide-catalog.ts` (curated picker list);
 * `Star` is a recognisable, universally-useful glyph.
 */
export const LUCIDE_FALLBACK = 'Star';

/**
 * Heuristic singular→canonical fallback for common pluralisation /
 * casing mistakes. Cheap O(1) lookup before falling back to `Star`.
 *
 * Observed in the wild (TM-166 corpus):
 *   - `Flowers` → `Flower`         (pluralisation)
 *   - `Hearts`  → `Heart`
 *   - `Stars`   → `Star`
 *   - `SunRise` → `Sunrise`        (casing — lucide uses single-word PascalCase)
 *   - `MoonRise`→ `Moon`           (no `Moonrise` exists; closest valid root)
 *
 * Extend as new patterns are observed in benchmarks; keep entries
 * verified against `LUCIDE_VALID_NAMES` (test below enforces this).
 */
export const LUCIDE_FUZZY_FIXES: Record<string, string> = {
  // Pluralisation mistakes (real export is singular).
  Flowers: 'Flower',
  Hearts: 'Heart',
  // NOTE: `Stars`, `Sparkle`, `Cloudy` are REAL lucide exports — do NOT
  // add them here (the whitelist would shadow this map anyway, but keeping
  // accurate documentation prevents confusion).

  // Generic "character / person" hallucinations.
  CharacterIcon: 'User',
  Character: 'User',
  Person: 'User',
  People: 'Users',

  // Brand / logo hallucinations.
  Logo: 'Sparkles',
  Brand: 'Sparkles',
  Company: 'Building',

  // Casing / compound errors (lucide uses single-word PascalCase:
  // `Sunrise`, not `SunRise`).
  SunRise: 'Sunrise',
  SunSet: 'Sunset',
  MoonRise: 'Moon',

  // Weather adjectives (real lucide uses noun roots: `Cloud`, `CloudRain`).
  // NOTE: `Cloudy` IS a real export — do NOT add it.
  Rainy: 'CloudRain',
  Snowy: 'CloudSnow',
};

/**
 * Map an unknown lucide identifier to the best in-catalog substitute.
 * Returns the fuzzy-fix when present, else `LUCIDE_FALLBACK` (`Star`).
 * Never returns the input unchanged — callers should only call this
 * after confirming `!LUCIDE_VALID_NAMES.has(name)`.
 */
export function pickLucideFallback(invented: string): string {
  const fix = LUCIDE_FUZZY_FIXES[invented];
  if (fix && LUCIDE_VALID_NAMES.has(fix)) return fix;
  return LUCIDE_FALLBACK;
}

/**
 * Test/inspection helper — exposes the whitelist size without leaking
 * 5800+ entries into snapshot output.
 */
export function __lucideWhitelistSize(): number {
  return LUCIDE_VALID_NAMES.size;
}
