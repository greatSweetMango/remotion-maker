/**
 * TM-3 — PARAMS auto-extraction reliability benchmark prompts.
 *
 * 50 curated prompts spanning 5 animation categories (10 each):
 *   - data-viz       : charts, counters, graphs
 *   - text-anim      : typography animations
 *   - transition     : slide / fade / morph
 *   - loader         : spinners / progress
 *   - infographic    : icon + text combos
 *
 * Each prompt is intentionally short (the kind of input EasyMake users send),
 * but specific enough that the LLM should NOT enter clarify mode (>10 words OR
 * concrete subject/colors/data). Mix of Korean & English.
 */

export type BenchmarkCategory =
  | 'data-viz'
  | 'text-anim'
  | 'transition'
  | 'loader'
  | 'infographic';

export interface BenchmarkPrompt {
  id: string;
  category: BenchmarkCategory;
  prompt: string;
}

export const BENCHMARK_PROMPTS: BenchmarkPrompt[] = [
  // ─── data-viz (10) ──────────────────────────────────────────────
  { id: 'dv-01', category: 'data-viz', prompt: 'Animated counter from 0 to 100 with spring effect, blue text on transparent background' },
  { id: 'dv-02', category: 'data-viz', prompt: '월별 매출 막대그래프, 1월부터 6월까지 [120, 150, 180, 200, 240, 280] 단위 만원, 보라색 톤' },
  { id: 'dv-03', category: 'data-viz', prompt: 'Pie chart with 4 slices: 40% sales, 30% marketing, 20% R&D, 10% admin, pastel colors' },
  { id: 'dv-04', category: 'data-viz', prompt: 'Line graph showing growth from 10 to 90, smooth curve, green gradient stroke' },
  { id: 'dv-05', category: 'data-viz', prompt: '실시간 주식 시세 그래프 느낌, 빨강/초록 캔들, 8개 막대' },
  { id: 'dv-06', category: 'data-viz', prompt: 'Animated percentage ring filling from 0% to 75%, neon cyan color, dark background' },
  { id: 'dv-07', category: 'data-viz', prompt: '인구 증가 카운터 8,000,000,000 까지 빠르게 올라가는 애니메이션' },
  { id: 'dv-08', category: 'data-viz', prompt: 'Horizontal bar race, 5 brands [Apple 320, Samsung 280, Xiaomi 200, Google 150, Sony 100], orange theme' },
  { id: 'dv-09', category: 'data-viz', prompt: 'Animated KPI dashboard tile: revenue $1.2M with 12% green up arrow' },
  { id: 'dv-10', category: 'data-viz', prompt: '도넛 차트 60%/40% 분할, 부드럽게 채워지는 애니메이션, 파란색 강조' },

  // ─── text-anim (10) ─────────────────────────────────────────────
  { id: 'ta-01', category: 'text-anim', prompt: 'Comic book style POW! text exploding into view, yellow with black outline' },
  { id: 'ta-02', category: 'text-anim', prompt: '"Hello World" 타이핑 효과, 모노스페이스 폰트, 흰 배경 검정 글씨' },
  { id: 'ta-03', category: 'text-anim', prompt: 'Big bold "SALE" text bouncing in with spring, red color, drop shadow' },
  { id: 'ta-04', category: 'text-anim', prompt: 'Word-by-word reveal of the sentence "Make the impossible possible", elegant serif font' },
  { id: 'ta-05', category: 'text-anim', prompt: '"NEW" 글자가 회전하면서 등장, 금색 그라데이션, 5초 길이' },
  { id: 'ta-06', category: 'text-anim', prompt: 'Glitchy cyberpunk title "SYSTEM ONLINE", green RGB shift effect' },
  { id: 'ta-07', category: 'text-anim', prompt: 'Quote text fading in line by line, italic, navy blue background' },
  { id: 'ta-08', category: 'text-anim', prompt: '브랜드 로고 텍스트 "EasyMake" 좌우로 슬라이드 인, 굵은 산세리프' },
  { id: 'ta-09', category: 'text-anim', prompt: 'Numbers 3, 2, 1, GO! countdown with each number scaling up and fading out' },
  { id: 'ta-10', category: 'text-anim', prompt: 'Handwritten signature "Claude" stroke animation, black ink on white' },

  // ─── transition (10) ────────────────────────────────────────────
  { id: 'tr-01', category: 'transition', prompt: 'Slide transition from left to right, two colored panels (purple to teal)' },
  { id: 'tr-02', category: 'transition', prompt: '페이드 인 페이드 아웃, 검정에서 흰색으로 1.5초' },
  { id: 'tr-03', category: 'transition', prompt: 'Zoom-in transition on a circular mask, revealing pink background' },
  { id: 'tr-04', category: 'transition', prompt: 'Wipe transition diagonal from top-left to bottom-right, two color blocks' },
  { id: 'tr-05', category: 'transition', prompt: '원이 화면을 가득 채우며 다음 색으로 전환, 노랑→파랑' },
  { id: 'tr-06', category: 'transition', prompt: 'Iris-out transition, black aperture closing on a red background' },
  { id: 'tr-07', category: 'transition', prompt: 'Page flip transition simulating a book turning, beige tones' },
  { id: 'tr-08', category: 'transition', prompt: 'Glitchy cut transition between two scenes, RGB split, 0.4 seconds' },
  { id: 'tr-09', category: 'transition', prompt: '블라인드 효과 전환, 가로 5줄, 검정에서 흰색' },
  { id: 'tr-10', category: 'transition', prompt: 'Morph transition from circle to square, single accent color (#FF6B6B)' },

  // ─── loader (10) ────────────────────────────────────────────────
  { id: 'ld-01', category: 'loader', prompt: 'Circular spinner loader, 8 dots rotating, primary blue color' },
  { id: 'ld-02', category: 'loader', prompt: '진행률 바 0%에서 100%까지, 초록색, 둥근 모서리' },
  { id: 'ld-03', category: 'loader', prompt: 'Bouncing 3 dots loader, gray on white, ease-in-out' },
  { id: 'ld-04', category: 'loader', prompt: 'Skeleton shimmer loading effect, gradient sweep across a card' },
  { id: 'ld-05', category: 'loader', prompt: 'Pulsing heart loader, red, scale 1.0 to 1.3 with spring' },
  { id: 'ld-06', category: 'loader', prompt: '무한 회전하는 링 스피너, 두께 8px, 보라색 하이라이트' },
  { id: 'ld-07', category: 'loader', prompt: 'Loading bar with percentage text "Loading 42%", dark theme' },
  { id: 'ld-08', category: 'loader', prompt: 'Hourglass flip loader, sand falling animation, sepia tone' },
  { id: 'ld-09', category: 'loader', prompt: '4개의 사각형이 순차로 페이드되는 로더, 청록색' },
  { id: 'ld-10', category: 'loader', prompt: 'Animated wave loader, three waves bouncing, ocean blue' },

  // ─── infographic (10) ───────────────────────────────────────────
  { id: 'ig-01', category: 'infographic', prompt: 'Step indicator 1-2-3-4 with checkmarks animating in, green accent' },
  { id: 'ig-02', category: 'infographic', prompt: '3가지 특징 아이콘+텍스트: 빠른 속도, 안정성, 보안 — 가로 배치 페이드인' },
  { id: 'ig-03', category: 'infographic', prompt: 'Comparison side-by-side: "Before 30s" vs "After 5s", red vs green' },
  { id: 'ig-04', category: 'infographic', prompt: 'Timeline 2020→2021→2022→2023, dots connected by line, sequential reveal' },
  { id: 'ig-05', category: 'infographic', prompt: '피라미드 다이어그램 3단계: Vision/Strategy/Execution, 보라 그라디언트' },
  { id: 'ig-06', category: 'infographic', prompt: 'Stat callout: "10x faster", giant number with subtitle, orange theme' },
  { id: 'ig-07', category: 'infographic', prompt: 'Process flow with 4 boxes connected by arrows, sequential fill, blue' },
  { id: 'ig-08', category: 'infographic', prompt: '아이콘 그리드 6개 (홈/검색/설정/유저/알림/카트), 순서대로 팝인' },
  { id: 'ig-09', category: 'infographic', prompt: 'Quote card with avatar circle, name, and 5-star rating animation' },
  { id: 'ig-10', category: 'infographic', prompt: 'Map pin dropping onto a location label "Seoul", red pin, gray map' },
];

if (BENCHMARK_PROMPTS.length !== 50) {
  throw new Error(`Expected 50 prompts, got ${BENCHMARK_PROMPTS.length}`);
}
