/**
 * Prompt suggestion pool for the empty-state PromptPanel.
 *
 * Static pool, organized by category. The PromptPanel rotates through a
 * small subset (3–5) chosen with category diversity so users always see
 * a variety of starting points instead of the same handful of examples.
 *
 * Adding new suggestions: append to a category. Aim for short, vivid,
 * self-contained prompts (one sentence, no leading verb stutter). Keep
 * each category populated so diversified picks remain possible.
 */

export type PromptCategory =
  | 'data-viz'
  | 'text-animation'
  | 'loader'
  | 'infographic'
  | 'transition';

export interface PromptSuggestion {
  id: string;
  category: PromptCategory;
  label: string;
  prompt: string;
}

export const CATEGORY_LABELS: Record<PromptCategory, string> = {
  'data-viz': 'Data Viz',
  'text-animation': 'Text',
  loader: 'Loader',
  infographic: 'Infographic',
  transition: 'Transition',
};

export const PROMPT_SUGGESTIONS: PromptSuggestion[] = [
  // ── data-viz ────────────────────────────────────────────────
  { id: 'dv-01', category: 'data-viz', label: 'Bar chart',
    prompt: 'Animated bar chart showing monthly revenue from Jan to Dec with smooth grow-up motion' },
  { id: 'dv-02', category: 'data-viz', label: 'Line chart',
    prompt: 'Animated line chart drawing a stock price curve with a moving dot tracing the path' },
  { id: 'dv-03', category: 'data-viz', label: 'Pie chart',
    prompt: 'Pie chart with five wedges that sweep in clockwise, then pop the largest wedge outward' },
  { id: 'dv-04', category: 'data-viz', label: 'Counter',
    prompt: 'Animated counter from 0 to 100 with spring effect and a pulsing accent ring' },
  { id: 'dv-05', category: 'data-viz', label: 'Big counter',
    prompt: 'Big number counter rolling from 0 to 1,000,000 with comma formatting and easing' },
  { id: 'dv-06', category: 'data-viz', label: 'Scoreboard',
    prompt: 'Sports scoreboard counting up two team scores with a flip-card style digit transition' },
  { id: 'dv-07', category: 'data-viz', label: 'Donut progress',
    prompt: 'Donut chart progress ring filling to 87% with a percentage label counting up in the center' },
  { id: 'dv-08', category: 'data-viz', label: 'Area chart',
    prompt: 'Layered area chart with three colored bands easing up from the baseline' },
  { id: 'dv-09', category: 'data-viz', label: 'Heat grid',
    prompt: 'Animated heatmap grid where cells fade in with intensity from cool to warm' },
  { id: 'dv-10', category: 'data-viz', label: 'Bubble chart',
    prompt: 'Bubble chart with five floating circles scaling in based on relative size' },

  // ── text-animation ──────────────────────────────────────────
  { id: 'tx-01', category: 'text-animation', label: 'Typewriter',
    prompt: 'Typewriter effect spelling out "Hello, world." with a blinking cursor' },
  { id: 'tx-02', category: 'text-animation', label: 'Neon glow',
    prompt: 'Neon text glow animation for the word "OPEN" with a flickering tube light feel' },
  { id: 'tx-03', category: 'text-animation', label: 'Comic POW',
    prompt: 'Comic book explosion effect text "POW!" bursting in with star-shaped backdrop' },
  { id: 'tx-04', category: 'text-animation', label: 'Kinetic title',
    prompt: 'Kinetic typography sequence revealing the words "MOVE FAST" one at a time with mask wipe' },
  { id: 'tx-05', category: 'text-animation', label: 'Split-flap',
    prompt: 'Split-flap board flipping characters to spell "ARRIVED" letter by letter' },
  { id: 'tx-06', category: 'text-animation', label: 'Glitch text',
    prompt: 'Glitch text effect on the word "ERROR" with RGB channel split and jitter' },
  { id: 'tx-07', category: 'text-animation', label: 'Stretch reveal',
    prompt: 'Word "BIG" stretching horizontally from 0 to full width with elastic ease-out' },
  { id: 'tx-08', category: 'text-animation', label: 'Stagger words',
    prompt: 'Headline "Build it now" with each word fading and rising in staggered sequence' },
  { id: 'tx-09', category: 'text-animation', label: 'Underline grow',
    prompt: 'Headline with an underline stroke drawing left-to-right after the text settles' },
  { id: 'tx-10', category: 'text-animation', label: '3D tumble',
    prompt: '3D rotating text "LAUNCH" tumbling in on the x-axis with shadow' },

  // ── loader ──────────────────────────────────────────────────
  { id: 'ld-01', category: 'loader', label: 'Spinner',
    prompt: 'Minimal spinner: rotating arc with rounded ends on a transparent background' },
  { id: 'ld-02', category: 'loader', label: 'Dot pulse',
    prompt: 'Three dots pulsing in sequence as a loading indicator' },
  { id: 'ld-03', category: 'loader', label: 'Progress bar',
    prompt: 'Progress bar filling 0 to 100% with shimmering highlight sweeping across' },
  { id: 'ld-04', category: 'loader', label: 'Skeleton',
    prompt: 'Skeleton card placeholder with shimmering gradient passing over rounded blocks' },
  { id: 'ld-05', category: 'loader', label: 'Orbital',
    prompt: 'Orbital loader: small dot revolving around a central circle with trailing fade' },
  { id: 'ld-06', category: 'loader', label: 'Bouncing ball',
    prompt: 'Bouncing ball loader squashing and stretching as it hits the baseline' },
  { id: 'ld-07', category: 'loader', label: 'Square morph',
    prompt: 'Square that morphs into a circle and back, looping smoothly' },
  { id: 'ld-08', category: 'loader', label: 'Wave bars',
    prompt: 'Five vertical bars rising and falling in a wave pattern' },
  { id: 'ld-09', category: 'loader', label: 'Checkmark success',
    prompt: 'Spinner that resolves into an animated checkmark stroke for a success state' },
  { id: 'ld-10', category: 'loader', label: 'Hex gear',
    prompt: 'Hexagonal gear rotating with subtle teeth highlights on each tick' },

  // ── infographic ─────────────────────────────────────────────
  { id: 'ig-01', category: 'infographic', label: 'Pricing tiers',
    prompt: 'Three pricing tier cards sliding up with feature checkmarks animating in' },
  { id: 'ig-02', category: 'infographic', label: 'Step list',
    prompt: 'Numbered step list 1-2-3-4 with each step revealing connecting line then label' },
  { id: 'ig-03', category: 'infographic', label: 'Stat trio',
    prompt: 'Three large stat cards with counters: users, revenue, growth, animating up together' },
  { id: 'ig-04', category: 'infographic', label: 'Timeline',
    prompt: 'Horizontal timeline with five milestone markers drawing in from left to right' },
  { id: 'ig-05', category: 'infographic', label: 'World map dots',
    prompt: 'World map with pulsing location dots appearing across continents' },
  { id: 'ig-06', category: 'infographic', label: 'Comparison',
    prompt: 'Side-by-side comparison: "Before" and "After" cards with checkmarks vs crosses animating in' },
  { id: 'ig-07', category: 'infographic', label: 'Funnel',
    prompt: 'Marketing funnel with stages narrowing top-to-bottom and percentages counting up' },
  { id: 'ig-08', category: 'infographic', label: 'Iconography row',
    prompt: 'Row of five feature icons popping in with labels fading underneath' },
  { id: 'ig-09', category: 'infographic', label: 'KPI dashboard',
    prompt: 'KPI dashboard with four metric tiles, each animating its sparkline and value' },
  { id: 'ig-10', category: 'infographic', label: 'Quote card',
    prompt: 'Quote card sliding in with author photo, quote text typing out, and a subtle highlight underline' },

  // ── transition ──────────────────────────────────────────────
  { id: 'tr-01', category: 'transition', label: 'Logo reveal',
    prompt: 'Logo reveal with particle effect that coalesces into the wordmark' },
  { id: 'tr-02', category: 'transition', label: 'Wipe',
    prompt: 'Diagonal color wipe transition from indigo to magenta across the frame' },
  { id: 'tr-03', category: 'transition', label: 'Iris open',
    prompt: 'Iris-open transition revealing a hero scene from the center outward' },
  { id: 'tr-04', category: 'transition', label: 'Slide stack',
    prompt: 'Three full-bleed slides stacking in from the right with shadow depth' },
  { id: 'tr-05', category: 'transition', label: 'Mask reveal',
    prompt: 'Text reveal where each character is masked by a colored block sliding away' },
  { id: 'tr-06', category: 'transition', label: 'Gradient blob',
    prompt: 'Gradient blob background animation morphing slowly between two complementary palettes' },
  { id: 'tr-07', category: 'transition', label: 'Curtain pull',
    prompt: 'Curtain-pull transition: two panels parting to reveal centered logo' },
  { id: 'tr-08', category: 'transition', label: 'Zoom punch',
    prompt: 'Zoom-punch transition: rapid scale-in then settle on the next composition' },
  { id: 'tr-09', category: 'transition', label: 'Flip card',
    prompt: 'Card flip transition revealing the back face with a new headline' },
  { id: 'tr-10', category: 'transition', label: 'Page peel',
    prompt: 'Page-peel transition curling the top-right corner to reveal the next scene' },
];

export const PROMPT_SUGGESTION_CATEGORIES: PromptCategory[] = [
  'data-viz',
  'text-animation',
  'loader',
  'infographic',
  'transition',
];

/**
 * Pick `count` suggestions diversified across categories.
 *
 * Greedy round-robin: shuffle the categories, then for each round pull
 * one (still-unused) suggestion from each category until we have
 * `count` items. If a category runs out, skip it and continue.
 *
 * `seed` is optional — when provided, the function is deterministic for
 * the same seed (useful for tests + a stable rotation key). The seed
 * uses a tiny LCG; we don't need crypto-grade randomness.
 */
export function pickDiversifiedSuggestions(
  count: number,
  seed?: number,
  pool: PromptSuggestion[] = PROMPT_SUGGESTIONS
): PromptSuggestion[] {
  if (count <= 0 || pool.length === 0) return [];
  const rand = makeRng(seed);

  // Group by category.
  const byCategory = new Map<PromptCategory, PromptSuggestion[]>();
  for (const s of pool) {
    const list = byCategory.get(s.category) ?? [];
    list.push(s);
    byCategory.set(s.category, list);
  }
  // Shuffle each bucket (so picks vary by seed).
  for (const list of byCategory.values()) {
    shuffleInPlace(list, rand);
  }
  // Shuffle category order (so the first pick isn't always the same).
  const cats = shuffleInPlace([...byCategory.keys()], rand);

  const picked: PromptSuggestion[] = [];
  let progressed = true;
  while (picked.length < count && progressed) {
    progressed = false;
    for (const cat of cats) {
      if (picked.length >= count) break;
      const list = byCategory.get(cat);
      if (list && list.length > 0) {
        picked.push(list.shift()!);
        progressed = true;
      }
    }
  }
  return picked;
}

// ── internal helpers ──────────────────────────────────────────

function makeRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  // mulberry32 — small, deterministic
  let state = (seed | 0) || 1;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
