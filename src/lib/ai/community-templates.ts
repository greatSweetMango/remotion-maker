/**
 * TM-141 — Community-style reference snippets for RAG.
 *
 * Background:
 *   TM-74 introduced single-template RAG using our own 35 production
 *   templates as exemplars. TM-46 r6/r7 ablation confirmed RAG-ON lifts
 *   visual quality on chart/transition prompts but left blind spots:
 *   character/entity prompts (TM-95), hello-world style intros, captions,
 *   audiogram, parallax depth ("Apple Wow"), 3-D, and stock/finance.
 *   The official `awesome-remotion` and `remotion-dev/remotion` examples
 *   show canonical patterns for each, but vendoring third-party code wholesale
 *   is a legal/maintenance hazard.
 *
 * Decision:
 *   Ship hand-authored MINIMAL PATTERN snippets (50-150 LOC each) that
 *   demonstrate the canonical structure of each category. Original work,
 *   so distribution is safe regardless of upstream license. Each snippet:
 *     - exports a `PARAMS` const (ADR-0002 contract)
 *     - uses `useCurrentFrame` + `interpolate` / `spring`
 *     - returns an `<AbsoluteFill>` root
 *     - is small enough to fit inside the system-prompt budget alongside
 *       a primary TM-74 reference
 *
 * Integration: `retrieveReferenceForPrompt` (in `retrieval.ts`) calls
 * `pickCommunityReferenceForPrompt` after the primary keyword/category
 * match. When a community signal hits (e.g. "character", "audiogram",
 * "captions"), the community snippet is appended to the primary reference
 * block as a SECONDARY exemplar with a clear "ALTERNATIVE PATTERN" label,
 * so the model gets both the matched in-house reference AND a related
 * community-style pattern.
 *
 * No new npm dependency. No fs reads — snippets are inline strings to keep
 * the worktree self-contained and the build cache stable.
 */

/** Community-corpus categories. Distinct from RagCategory. */
export type CommunityCategory =
  | 'character'        // person/animal/creature scene (TM-95 path)
  | 'hello-world'      // minimal intro / first-render starter
  | 'audiogram'        // audio waveform / podcast viz
  | 'captions'         // subtitle / word-by-word caption
  | 'three-d'          // perspective / pseudo-3d transform
  | 'apple-wow'        // parallax depth / hero product reveal
  | 'tailwind'         // utility-class composition pattern
  | 'stock'            // finance / sparkline / ticker
  | 'audio-react'      // pulse on amplitude
  | 'sequence-comp';   // multi-Sequence composition pattern

export interface CommunityReference {
  id: string;
  category: CommunityCategory;
  /** Short rationale shown to the LLM ("when to imitate this"). */
  whenToUse: string;
  /** Lowercased keyword tokens for prompt matching. */
  keywords: string[];
  /** Inline source — original, MIT-equivalent. */
  source: string;
}

// ---------------------------------------------------------------------------
// Snippets — original minimal exemplars (each ~80-130 LOC).
// ---------------------------------------------------------------------------

const CHARACTER_SCENE = `import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

export const PARAMS = {
  characterEmoji: '🐻',
  groundColor: '#3a2a1a',
  skyTop: '#fcd34d',
  skyBottom: '#fb923c',
  caption: 'wandering bear',
  bobAmplitude: 12,
  parallaxStrength: 30,
} as const;

export const CharacterScene = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // bob + parallax (TM-95 living-entity pattern)
  const bobY = Math.sin(frame / 12) * PARAMS.bobAmplitude;
  const px = interpolate(frame, [0, 90], [-PARAMS.parallaxStrength, PARAMS.parallaxStrength]);
  const captionOpacity = spring({ frame: frame - 12, fps, config: { damping: 18 } });

  return (
    <AbsoluteFill
      style={{
        background: \`linear-gradient(180deg, \${PARAMS.skyTop} 0%, \${PARAMS.skyBottom} 100%)\`,
      }}
    >
      {/* far parallax layer */}
      <div style={{ position: 'absolute', bottom: height * 0.42, left: px * 0.3, fontSize: 80, opacity: 0.7 }}>
        ⛰️ ⛰️ ⛰️
      </div>
      {/* mid parallax layer */}
      <div style={{ position: 'absolute', bottom: height * 0.28, left: px * 0.6, fontSize: 60, opacity: 0.85 }}>
        🌲 🌲 🌲 🌲
      </div>
      {/* ground */}
      <div
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: '25%',
          background: PARAMS.groundColor,
        }}
      />
      {/* character (centered, bobbing) */}
      <div
        style={{
          position: 'absolute', left: width / 2 - 80, bottom: height * 0.22 + bobY,
          fontSize: 160, lineHeight: 1,
        }}
      >
        {PARAMS.characterEmoji}
      </div>
      {/* caption */}
      <div
        style={{
          position: 'absolute', bottom: 40, left: 0, right: 0, textAlign: 'center',
          color: 'white', fontSize: 36, fontWeight: 600, opacity: captionOpacity,
          textShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}
      >
        {PARAMS.caption}
      </div>
    </AbsoluteFill>
  );
};
`;

const HELLO_WORLD = `import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

export const PARAMS = {
  title: 'Hello, World',
  subtitle: 'made with Remotion',
  bg: '#0f172a',
  accent: '#38bdf8',
} as const;

export const HelloWorld = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleScale = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const subOpacity = interpolate(frame, [20, 40], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: PARAMS.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ transform: \`scale(\${titleScale})\`, color: 'white', fontSize: 96, fontWeight: 800 }}>
        {PARAMS.title}
      </div>
      <div style={{ marginTop: 16, color: PARAMS.accent, fontSize: 32, opacity: subOpacity }}>
        {PARAMS.subtitle}
      </div>
    </AbsoluteFill>
  );
};
`;

const AUDIOGRAM = `import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

export const PARAMS = {
  barCount: 48,
  barColor: '#22d3ee',
  bg: '#020617',
  title: 'Episode 42 — Building in Public',
} as const;

export const Audiogram = () => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const barWidth = (width - 120) / PARAMS.barCount - 4;

  return (
    <AbsoluteFill style={{ background: PARAMS.bg, padding: 60, justifyContent: 'flex-end' }}>
      <div style={{ color: 'white', fontSize: 44, fontWeight: 700, marginBottom: 40 }}>
        {PARAMS.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 220 }}>
        {Array.from({ length: PARAMS.barCount }).map((_, i) => {
          // synthesized waveform — replace with FFT amplitudes from <Audio/>
          const phase = (i + frame / 4) * 0.4;
          const h = 40 + Math.abs(Math.sin(phase) + Math.sin(phase * 1.7)) * 80;
          return (
            <div
              key={i}
              style={{
                width: barWidth, height: h,
                background: PARAMS.barColor,
                borderRadius: 4,
                opacity: 0.85,
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
`;

const CAPTIONS = `import { AbsoluteFill, useCurrentFrame } from 'remotion';

export const PARAMS = {
  words: ['Build', 'videos', 'programmatically', 'with', 'React'] as readonly string[],
  framesPerWord: 12,
  bg: '#000',
  highlight: '#facc15',
  base: '#cbd5e1',
} as const;

export const WordByWordCaptions = () => {
  const frame = useCurrentFrame();
  const activeIndex = Math.min(
    Math.floor(frame / PARAMS.framesPerWord),
    PARAMS.words.length - 1,
  );

  return (
    <AbsoluteFill style={{ background: PARAMS.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 20, fontSize: 80, fontWeight: 800 }}>
        {PARAMS.words.map((w, i) => (
          <span
            key={i}
            style={{
              color: i === activeIndex ? PARAMS.highlight : PARAMS.base,
              transform: i === activeIndex ? 'translateY(-8px) scale(1.05)' : 'none',
              transition: 'none',
            }}
          >
            {w}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
`;

const THREE_D_CARD = `import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';

export const PARAMS = {
  bg: '#111827',
  faceColor: '#6366f1',
  label: '3D',
  perspective: 900,
} as const;

export const ThreeDCard = () => {
  const frame = useCurrentFrame();
  const rotY = interpolate(frame, [0, 90], [0, 360]);
  const rotX = Math.sin(frame / 30) * 15;

  return (
    <AbsoluteFill
      style={{
        background: PARAMS.bg,
        justifyContent: 'center',
        alignItems: 'center',
        perspective: PARAMS.perspective,
      }}
    >
      <div
        style={{
          width: 320, height: 320,
          background: PARAMS.faceColor,
          borderRadius: 24,
          transformStyle: 'preserve-3d',
          transform: \`rotateY(\${rotY}deg) rotateX(\${rotX}deg)\`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontSize: 120, fontWeight: 900,
          boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
        }}
      >
        {PARAMS.label}
      </div>
    </AbsoluteFill>
  );
};
`;

const APPLE_WOW = `import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

export const PARAMS = {
  bg: '#000',
  productEmoji: '📱',
  title: 'Introducing',
  product: 'The new thing',
  glow: '#a855f7',
} as const;

export const AppleWowReveal = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // slow zoom-in product, label fades in late, soft glow pulses
  const scale = interpolate(frame, [0, 90], [0.8, 1.05], { extrapolateRight: 'clamp' });
  const titleOp = spring({ frame: frame - 30, fps, config: { damping: 20 } });
  const productOp = spring({ frame: frame - 50, fps, config: { damping: 22 } });
  const glow = 40 + Math.sin(frame / 18) * 20;

  return (
    <AbsoluteFill style={{ background: PARAMS.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          fontSize: 280,
          transform: \`scale(\${scale})\`,
          filter: \`drop-shadow(0 0 \${glow}px \${PARAMS.glow})\`,
        }}
      >
        {PARAMS.productEmoji}
      </div>
      <div style={{ color: '#9ca3af', fontSize: 28, marginTop: 32, opacity: titleOp, letterSpacing: 4 }}>
        {PARAMS.title.toUpperCase()}
      </div>
      <div style={{ color: 'white', fontSize: 64, fontWeight: 700, opacity: productOp, marginTop: 8 }}>
        {PARAMS.product}
      </div>
    </AbsoluteFill>
  );
};
`;

const TAILWIND_STYLE = `import { AbsoluteFill, useCurrentFrame, spring, useVideoConfig } from 'remotion';

export const PARAMS = {
  bg: '#0ea5e9',
  card: '#ffffff',
  accent: '#1e293b',
  heading: 'Modern Card',
  body: 'Compose with utility tokens — gap, padding, rounded, shadow.',
} as const;

// Demonstrates utility-class style composition without depending on Tailwind
// itself. Inline tokens map 1:1 to common classes (rounded-3xl, shadow-2xl,
// p-10, gap-4) so the LLM can imitate the structure when generating either
// style flavor.
export const UtilityCard = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16 } });

  return (
    <AbsoluteFill style={{ background: PARAMS.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          width: 560,
          background: PARAMS.card,
          borderRadius: 24,        // rounded-3xl
          padding: 40,             // p-10
          display: 'flex',
          flexDirection: 'column',
          gap: 16,                 // gap-4
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', // shadow-2xl
          transform: \`translateY(\${(1 - enter) * 40}px)\`,
          opacity: enter,
        }}
      >
        <div style={{ color: PARAMS.accent, fontSize: 36, fontWeight: 800 }}>{PARAMS.heading}</div>
        <div style={{ color: '#475569', fontSize: 20, lineHeight: 1.5 }}>{PARAMS.body}</div>
      </div>
    </AbsoluteFill>
  );
};
`;

const STOCK_TICKER = `import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion';

export const PARAMS = {
  ticker: 'AAPL',
  prices: [182.4, 184.1, 183.9, 187.0, 189.2, 188.6, 191.3, 193.0] as readonly number[],
  bg: '#0f172a',
  upColor: '#22c55e',
  downColor: '#ef4444',
} as const;

export const StockSparkline = () => {
  const frame = useCurrentFrame();
  const w = 1080;
  const h = 360;
  const pad = 60;

  const min = Math.min(...PARAMS.prices);
  const max = Math.max(...PARAMS.prices);
  const points = PARAMS.prices.map((p, i) => {
    const x = pad + (i / (PARAMS.prices.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (p - min) / (max - min || 1)) * (h - pad * 2);
    return [x, y] as const;
  });

  // progressive draw
  const progress = interpolate(frame, [0, 60], [0, points.length], { extrapolateRight: 'clamp' });
  const visible = points.slice(0, Math.max(2, Math.ceil(progress)));
  const path = visible.map(([x, y], i) => \`\${i === 0 ? 'M' : 'L'} \${x} \${y}\`).join(' ');

  const last = PARAMS.prices[PARAMS.prices.length - 1];
  const first = PARAMS.prices[0];
  const stroke = last >= first ? PARAMS.upColor : PARAMS.downColor;

  return (
    <AbsoluteFill style={{ background: PARAMS.bg, padding: 60, color: 'white' }}>
      <div style={{ fontSize: 56, fontWeight: 800 }}>{PARAMS.ticker}</div>
      <div style={{ fontSize: 80, fontWeight: 900, color: stroke, marginTop: 8 }}>
        {'$' + last.toFixed(2)}
      </div>
      <svg width={w} height={h} style={{ marginTop: 32 }}>
        <path d={path} stroke={stroke} strokeWidth={4} fill="none" />
      </svg>
    </AbsoluteFill>
  );
};
`;

const AUDIO_REACT_PULSE = `import { AbsoluteFill, useCurrentFrame } from 'remotion';

export const PARAMS = {
  bg: '#1e1b4b',
  ringColor: '#f472b6',
  cores: 3,
} as const;

// Synthesized amplitude. Replace with visualizeAudio() output when wiring a
// real <Audio/> source.
const fakeAmp = (frame: number) =>
  0.4 + 0.3 * Math.abs(Math.sin(frame / 6)) + 0.2 * Math.abs(Math.sin(frame / 11));

export const AudioReactivePulse = () => {
  const frame = useCurrentFrame();
  const amp = fakeAmp(frame);

  return (
    <AbsoluteFill style={{ background: PARAMS.bg, justifyContent: 'center', alignItems: 'center' }}>
      {Array.from({ length: PARAMS.cores }).map((_, i) => {
        const size = 240 + i * 120 + amp * 200;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              width: size, height: size,
              borderRadius: '50%',
              border: \`3px solid \${PARAMS.ringColor}\`,
              opacity: Math.max(0, 0.6 - i * 0.18 - (1 - amp) * 0.2),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
`;

const SEQUENCE_COMP = `import { AbsoluteFill, Sequence, useCurrentFrame, spring, useVideoConfig } from 'remotion';

export const PARAMS = {
  bg: '#fafafa',
  scenes: [
    { label: 'Scene 1', color: '#6366f1' },
    { label: 'Scene 2', color: '#ec4899' },
    { label: 'Scene 3', color: '#10b981' },
  ] as const,
  perSceneFrames: 30,
} as const;

const Scene = ({ label, color }: { label: string; color: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ background: color, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ color: 'white', fontSize: 96, fontWeight: 900, transform: \`scale(\${s})\` }}>
        {label}
      </div>
    </AbsoluteFill>
  );
};

export const SequenceComposition = () => {
  return (
    <AbsoluteFill style={{ background: PARAMS.bg }}>
      {PARAMS.scenes.map((s, i) => (
        <Sequence key={i} from={i * PARAMS.perSceneFrames} durationInFrames={PARAMS.perSceneFrames}>
          <Scene label={s.label} color={s.color} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
`;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const COMMUNITY_REFERENCES: CommunityReference[] = [
  {
    id: 'character-scene',
    category: 'character',
    whenToUse:
      'Living entity (person/animal/creature) in a scene with foreground/midground/background depth. Apply bobY + parallax + caption pattern.',
    keywords: [
      // EN entities (mirrors asset-gen-stage living-entity regex; subset)
      'character', 'person', 'people', 'man', 'woman', 'boy', 'girl', 'kid',
      'astronaut', 'wizard', 'knight', 'robot', 'monster', 'creature', 'dragon',
      'cat', 'dog', 'bear', 'fox', 'rabbit', 'bunny', 'tiger', 'lion', 'panda',
      'owl', 'bird', 'fish', 'whale', 'dolphin', 'unicorn', 'alien',
      // KO
      '캐릭터', '사람', '소년', '소녀', '아이', '동물', '곰', '강아지', '고양이', '여우', '토끼',
    ],
    source: CHARACTER_SCENE,
  },
  {
    id: 'hello-world',
    category: 'hello-world',
    whenToUse: 'Minimal title-card style intro: title spring-scales in, subtitle fades in.',
    keywords: ['hello', 'world', 'first', 'starter', 'minimal', 'intro card', '안녕', '시작'],
    source: HELLO_WORLD,
  },
  {
    id: 'audiogram',
    category: 'audiogram',
    whenToUse: 'Podcast / audio waveform visualization. Frequency-bar pattern with synthesized amplitudes.',
    keywords: ['audiogram', 'podcast', 'waveform', 'audio bar', '오디오그램', '팟캐스트', '파형'],
    source: AUDIOGRAM,
  },
  {
    id: 'word-by-word-captions',
    category: 'captions',
    whenToUse: 'Word-by-word subtitle highlight (active word scaled + colored).',
    keywords: ['caption', 'captions', 'subtitle', 'subtitles', 'lyrics', 'word by word', '자막', '가사'],
    source: CAPTIONS,
  },
  {
    id: 'three-d-card',
    category: 'three-d',
    whenToUse: 'Pseudo-3D card / cube using CSS perspective + rotateY/X. No external 3D lib.',
    keywords: ['3d', '3-d', 'three d', 'three-d', 'perspective', 'cube', 'rotate y', '3차원', '입체'],
    source: THREE_D_CARD,
  },
  {
    id: 'apple-wow-reveal',
    category: 'apple-wow',
    whenToUse: 'Premium product reveal: black bg, glowing hero element, slow scale, tagline + product name fade in.',
    keywords: ['apple', 'product reveal', 'introducing', 'hero reveal', 'showcase', '제품', '런칭', '발표', '화려', '프리미엄'],
    source: APPLE_WOW,
  },
  {
    id: 'utility-card',
    category: 'tailwind',
    whenToUse: 'Tailwind / utility-class style card layout (rounded-3xl, shadow-2xl, p-10, gap-4 mapped to inline tokens).',
    keywords: ['tailwind', 'utility', 'card', 'modern card', '카드'],
    source: TAILWIND_STYLE,
  },
  {
    id: 'stock-sparkline',
    category: 'stock',
    whenToUse: 'Finance / stock ticker with progressive sparkline draw and up/down color.',
    keywords: ['stock', 'ticker', 'sparkline', 'finance', 'price', 'crypto', '주식', '시세', '암호화폐', '코인'],
    source: STOCK_TICKER,
  },
  {
    id: 'audio-reactive-pulse',
    category: 'audio-react',
    whenToUse: 'Audio-reactive concentric ring pulses. Synthesized amplitude — swap for visualizeAudio() with <Audio/>.',
    keywords: ['pulse', 'reactive', 'audio reactive', 'beat', 'visualizer', '리듬', '비트', '시각화'],
    source: AUDIO_REACT_PULSE,
  },
  {
    id: 'sequence-composition',
    category: 'sequence-comp',
    whenToUse: 'Multi-Sequence composition pattern: chain N scenes via <Sequence from durationInFrames>.',
    keywords: ['sequence', 'scenes', 'multi scene', 'chain', 'compose', '시퀀스', '여러 장면'],
    source: SEQUENCE_COMP,
  },
];

/**
 * Match a community reference against a free-form prompt.
 *
 * Strategy: for each catalog entry, count how many of its keywords appear in
 * the lowercased prompt. Pick the entry with the highest non-zero score.
 * Returns null when no entry scores > 0 — caller should skip community
 * augmentation rather than guessing.
 *
 * Deterministic tiebreak: when multiple entries tie, return the FIRST one
 * registered. This keeps prompt-cache keys stable across runs (ADR-0003).
 */
export function pickCommunityReferenceForPrompt(
  prompt: string,
  catalog: CommunityReference[] = COMMUNITY_REFERENCES,
): CommunityReference | null {
  const p = prompt.toLowerCase();
  let best: CommunityReference | null = null;
  let bestScore = 0;
  for (const c of catalog) {
    let score = 0;
    for (const kw of c.keywords) {
      // word-boundary-ish match for short tokens to avoid e.g. "cat" matching
      // "category". For multi-word keywords (with a space) we just substring.
      if (kw.includes(' ')) {
        if (p.includes(kw)) score += 1;
      } else if (/^[a-z0-9-]+$/.test(kw)) {
        const re = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, 'i');
        if (re.test(p)) score += 1;
      } else {
        // Korean / non-ASCII — substring is fine; KO has no word boundaries.
        if (p.includes(kw)) score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Build a secondary "ALTERNATIVE PATTERN" addendum from a matched community
 * reference. Designed to be appended after the primary TM-74 reference block
 * in `retrieval.ts`. Returns '' when no community match — safe to concat.
 */
export function buildCommunityReferenceBlock(prompt: string): string {
  const ref = pickCommunityReferenceForPrompt(prompt);
  if (!ref) return '';

  const MAX_REF_CHARS = 4500; // smaller than primary; this is supplementary.
  const src =
    ref.source.length > MAX_REF_CHARS
      ? ref.source.slice(0, MAX_REF_CHARS) + '\n// ... (truncated)'
      : ref.source;

  return `

============== ALTERNATIVE PATTERN (RAG community, TM-141) ==============

The prompt also matched a community-style pattern for "${ref.category}".
${ref.whenToUse}

This is a SECONDARY exemplar — the primary reference above remains your
main structural guide. Borrow only what's relevant from the snippet below
(layering, motion, layout) and adapt to the user's actual subject.

Reference id: ${ref.id}
Reference category: ${ref.category}

\`\`\`tsx
${src}
\`\`\`

============== END ALTERNATIVE PATTERN ==============
`;
}
