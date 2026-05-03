/**
 * TM-74 — Reference Template Retrieval (RAG, simple).
 *
 * TM-46 r6 found the prompt-only visual-quality ceiling at ~70 (mean). The
 * dominant failure modes were data-viz (axes/labels/animation missing) and
 * transition (single-state output) — categories where a worked reference
 * is far more instructive than an additional rule paragraph.
 *
 * This module retrieves ONE existing template's source as a "reference" the
 * model can imitate, then we inject it as a system-prompt addendum. We
 * deliberately use a **simple keyword + category** strategy (no embeddings)
 * to keep the change zero-dependency and reversible. An embedding-based
 * retriever is tracked as a separate task.
 *
 * Decision record: ADR-PENDING-TM-74.
 *
 * Pipeline:
 *   inferCategoryFromPrompt(prompt)
 *     → pickReferenceTemplate(category, prompt)  // keyword tiebreak
 *       → buildReferenceBlock(template)          // system-prompt addendum
 *
 * The retriever is **opt-in** via `withReference: true` and gracefully
 * degrades to no-op when retrieval misses.
 */

import fs from 'fs';
import path from 'path';

/** Categories used by the retriever. Aligns with `Template['category']`. */
export type RagCategory =
  | 'chart'
  | 'transition'
  | 'text'
  | 'background'
  | 'counter'
  | 'logo'
  | 'composition'
  | 'infographic';

export interface ReferenceTemplate {
  /** stable id — matches src/lib/templates.ts */
  id: string;
  /** filename under src/remotion/templates/ */
  filename: string;
  category: RagCategory;
  /** Free-form keywords used for keyword tiebreak. Lowercased. */
  keywords: string[];
}

/**
 * Static catalog. Keep deliberately compact — one or two strong exemplars per
 * category that demonstrate the patterns the model frequently misses. Picked
 * by hand from the 35 templates in src/remotion/templates/.
 */
export const REFERENCE_CATALOG: ReferenceTemplate[] = [
  // chart / data-viz — primary weak spot in TM-46 r6
  {
    id: 'bar-chart',
    filename: 'BarChart.tsx',
    category: 'chart',
    keywords: ['bar', 'bars', '막대', '바차트', 'column', 'columns', 'histogram'],
  },
  {
    id: 'line-chart',
    filename: 'LineChart.tsx',
    category: 'chart',
    keywords: ['line', 'trend', '꺾은선', '선형', 'curve', 'series', '시계열', 'stock', '주식'],
  },
  {
    id: 'donut-chart',
    filename: 'DonutChart.tsx',
    category: 'chart',
    keywords: ['donut', 'doughnut', 'pie', 'ring', '도넛', '파이', 'percentage', '%', '비율'],
  },
  {
    id: 'area-chart',
    filename: 'AreaChart.tsx',
    category: 'chart',
    keywords: ['area', '영역', 'fill', 'mountain'],
  },
  {
    id: 'progress-bar',
    filename: 'ProgressBar.tsx',
    category: 'chart',
    keywords: ['progress', '진행', 'loading bar', '바'],
  },

  // transition — second weak spot
  {
    id: 'zoom-transition',
    filename: 'ZoomTransition.tsx',
    category: 'transition',
    keywords: ['zoom', 'punch', '확대', 'iris', 'flash', 'cut'],
  },
  {
    id: 'logo-reveal',
    filename: 'LogoReveal.tsx',
    category: 'transition',
    keywords: ['logo', '로고', 'reveal', 'intro', 'brand'],
  },

  // text-anim
  {
    id: 'typewriter',
    filename: 'Typewriter.tsx',
    category: 'text',
    keywords: ['typewriter', 'typing', '타이핑', 'cursor', '커서'],
  },
  {
    id: 'text-reveal',
    filename: 'TextReveal.tsx',
    category: 'text',
    keywords: ['reveal', '드롭', 'drop', 'stagger', 'letters', 'fade in text'],
  },
  {
    id: 'glitch-effect',
    filename: 'GlitchEffect.tsx',
    category: 'text',
    keywords: ['glitch', '글리치', 'rgb', 'split', '치명적', 'cyberpunk', '사이버펑크'],
  },
  {
    id: 'wave-text',
    filename: 'WaveText.tsx',
    category: 'text',
    keywords: ['wave', '파도', 'sine', '물결'],
  },

  // counter / KPI
  {
    id: 'counter-animation',
    filename: 'CounterAnimation.tsx',
    category: 'counter',
    keywords: ['counter', '카운터', 'count', '카운트', '숫자', 'number', 'kpi'],
  },
  {
    id: 'progress-circle',
    filename: 'ProgressCircle.tsx',
    category: 'counter',
    keywords: ['ring', 'circular', '원형', 'progress', 'percent', '%'],
  },

  // background / loop
  {
    id: 'gradient-orbs',
    filename: 'GradientOrbs.tsx',
    category: 'background',
    keywords: ['orb', 'gradient', '그라디언트', 'background', '배경', 'abstract', '추상'],
  },
  {
    id: 'particle-field',
    filename: 'ParticleField.tsx',
    category: 'background',
    keywords: ['particle', '파티클', 'star', '별', 'dust'],
  },
  {
    id: 'flow-field',
    filename: 'FlowField.tsx',
    category: 'background',
    keywords: ['flow', '플로우', 'perlin', 'vector field', 'trail'],
  },

  // logo / lower-third
  {
    id: 'lower-third',
    filename: 'LowerThird.tsx',
    category: 'logo',
    keywords: ['lower third', '로어 써드', '이름표', 'name card', 'caption'],
  },

  // infographic
  {
    id: 'timeline',
    filename: 'Timeline.tsx',
    category: 'infographic',
    keywords: ['timeline', '타임라인', 'milestone', '연표', 'roadmap', '로드맵'],
  },
  {
    id: 'icon-badge',
    filename: 'IconBadge.tsx',
    category: 'infographic',
    keywords: ['badge', '뱃지', 'icon', '아이콘', 'medal'],
  },
];

/**
 * Category inference from a free-form prompt. Mirrors the heuristic used in
 * the system-prompt category guidelines (TM-71) but operates on the prompt
 * text directly so we can pick a reference BEFORE the LLM call.
 *
 * Returns null when no category dominates — caller should skip RAG injection
 * rather than guessing a wrong reference.
 */
export function inferCategoryFromPrompt(prompt: string): RagCategory | null {
  const p = prompt.toLowerCase();

  // Order matters: more specific categories first.
  const checks: Array<[RagCategory, RegExp]> = [
    [
      'chart',
      // EN: chart names, axis terms, % / numbers explicitly framed as data
      // KO: 차트, 그래프, 도넛, 파이, 막대, 꺾은선, 영역
      /\b(bar|line|donut|doughnut|pie|area|chart|graph|kpi|axis|axes|histogram)\b|차트|그래프|도넛|파이|막대|꺾은선|시계열|주식|영역\s*그래프|진행률|퍼센트|%/,
    ],
    // Logo MUST run before transition because logo prompts often contain
    // "fade" / "reveal" / "intro" tokens that the transition regex would
    // otherwise win.
    [
      'logo',
      /\b(logo|lower[- ]?third|brand\s+intro|name\s*card|caption\s*card)\b|로고|로어\s*써드|이름표/,
    ],
    [
      'transition',
      /\b(transition|fade|wipe|slide(?:\s+(?:in|out|from))?|zoom\s*(?:in|out|trans)|iris|reveal\s+cut|crossfade|dissolve)\b|페이드|와이프|전환|슬라이드(?:\s*(?:인|아웃))|줌\s*(?:인|아웃)|디졸브/,
    ],
    [
      'counter',
      /\b(counter|countdown|count\s+(?:up|down|from)|statistic|metric)\b|카운터|카운트다운|카운트업|숫자\s*세기/,
    ],
    [
      'text',
      /\b(typewriter|typing|glitch|caption|headline|word(?:[- ])by(?:[- ])word|letter|stagger\s+text|wave\s+text|rgb[- ]?split)\b|타이핑|글리치|텍스트\s*효과|문구|타이틀/,
    ],
    [
      'infographic',
      /\b(timeline|roadmap|milestone|infographic|step[- ]by[- ]step|process\s+flow|badge)\b|타임라인|연표|로드맵|뱃지|인포그래픽/,
    ],
    [
      'background',
      /\b(background|loop(?:able|ing)?|particle|orb|flow\s*field|fluid|metaball|liquid|wave|abstract|ambient|atmospheric)\b|배경|루프|파티클|추상|앰비언트/,
    ],
    [
      'composition',
      /\b(60s|45s|30s|product\s*intro|highlight\s*reel|year\s*in\s*review|data\s*story)\b|쇼케이스|하이라이트\s*릴|연말\s*리뷰/,
    ],
  ];

  for (const [cat, re] of checks) {
    if (re.test(p)) return cat;
  }
  return null;
}

/**
 * Pick the best reference within a category. Tiebreak by keyword overlap;
 * fall back to the first entry registered for that category.
 */
export function pickReferenceTemplate(
  category: RagCategory,
  prompt: string,
  catalog: ReferenceTemplate[] = REFERENCE_CATALOG,
): ReferenceTemplate | null {
  const candidates = catalog.filter(t => t.category === category);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const p = prompt.toLowerCase();
  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const score = c.keywords.reduce(
      (acc, kw) => acc + (p.includes(kw.toLowerCase()) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Read the on-disk source for a template. Cached to avoid repeated fs reads
 * inside the same Node process.
 */
const _sourceCache = new Map<string, string>();
export function readTemplateSource(filename: string): string | null {
  const cached = _sourceCache.get(filename);
  if (cached) return cached;
  try {
    const filePath = path.join(
      process.cwd(),
      'src/remotion/templates',
      filename,
    );
    const code = fs.readFileSync(filePath, 'utf-8');
    _sourceCache.set(filename, code);
    return code;
  } catch {
    return null;
  }
}

/**
 * Build the system-prompt addendum that injects a reference template.
 * Returns an empty string when retrieval should be skipped, so callers can
 * always concatenate without a null-check.
 */
export function buildReferenceBlock(
  prompt: string,
  opts: { sourceLoader?: (filename: string) => string | null } = {},
): string {
  const category = inferCategoryFromPrompt(prompt);
  if (!category) return '';
  const ref = pickReferenceTemplate(category, prompt);
  if (!ref) return '';
  const source = (opts.sourceLoader ?? readTemplateSource)(ref.filename);
  if (!source) return '';

  // Keep the reference code under ~6KB so we don't blow the system-prompt
  // budget. Templates in the catalog are typically 2-4KB; truncate just in
  // case a future entry is unusually long.
  const MAX_REF_CHARS = 6000;
  const truncated =
    source.length > MAX_REF_CHARS
      ? source.slice(0, MAX_REF_CHARS) + '\n// ... (truncated for context budget)'
      : source;

  return `

============== REFERENCE TEMPLATE (RAG, TM-74) ==============

The user's prompt looks like a "${category}" animation. Here is a working,
production-quality reference template for this category. **Use it as a
structural and stylistic guide** — the same PARAMS shape, the same animation
cadence, the same labelling/axes (for charts) or two-state interpolation
(for transitions). DO NOT copy it verbatim; adapt it to the user's actual
subject, data, and palette. The reference exists so you cannot omit the
patterns the prompt-only path tends to skip.

Reference id: ${ref.id}
Reference category: ${category}

\`\`\`tsx
${truncated}
\`\`\`

============== END REFERENCE ==============
`;
}

/**
 * High-level helper used by generate.ts: returns metadata + addendum so the
 * caller can log retrieval decisions cleanly.
 */
export function retrieveReferenceForPrompt(prompt: string): {
  category: RagCategory | null;
  reference: ReferenceTemplate | null;
  addendum: string;
} {
  const category = inferCategoryFromPrompt(prompt);
  if (!category) return { category: null, reference: null, addendum: '' };
  const reference = pickReferenceTemplate(category, prompt);
  if (!reference) return { category, reference: null, addendum: '' };
  const addendum = buildReferenceBlock(prompt);
  return { category, reference, addendum };
}
