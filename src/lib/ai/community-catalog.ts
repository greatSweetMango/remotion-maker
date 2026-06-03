/**
 * TM-141 — Community-style reference CATALOG (types + registry).
 *
 * Maps each community category to its keyword set, rationale, and the inline
 * snippet source (from `./community-snippets`). Pure data — picking/building
 * logic lives in `./community-templates`.
 *
 * TM-183 (2026-06-04): split out from the 650-LOC `community-templates.ts`
 * god-module. See `wiki/05-reports/2026-06-04-refactor-week-3-lib-cohesion.md`.
 */

import {
  CHARACTER_SCENE,
  HELLO_WORLD,
  AUDIOGRAM,
  CAPTIONS,
  THREE_D_CARD,
  APPLE_WOW,
  TAILWIND_STYLE,
  STOCK_TICKER,
  AUDIO_REACT_PULSE,
  SEQUENCE_COMP,
} from './community-snippets';

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
