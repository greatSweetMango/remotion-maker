/**
 * TM-46 — Visual judge 평가 프롬프트 30개.
 *
 * TM-3 의 50개 BENCHMARK_PROMPTS 에서 카테고리별 6개씩 균형 추출
 * (data-viz / text-anim / transition / loader / infographic).
 */

import { BENCHMARK_PROMPTS, type BenchmarkPrompt } from './params-extraction.benchmark';

const PICK_IDS: string[] = [
  // data-viz (6) — 단순/복합 혼합
  'dv-01', 'dv-02', 'dv-03', 'dv-06', 'dv-08', 'dv-10',
  // text-anim (6)
  'ta-01', 'ta-02', 'ta-04', 'ta-05', 'ta-06', 'ta-09',
  // transition (6)
  'tr-01', 'tr-02', 'tr-03', 'tr-05', 'tr-08', 'tr-10',
  // loader (6)
  'ld-01', 'ld-02', 'ld-03', 'ld-05', 'ld-06', 'ld-09',
  // infographic (6)
  'ig-01', 'ig-02', 'ig-03', 'ig-04', 'ig-06', 'ig-08',
];

export const TM46_PROMPTS: BenchmarkPrompt[] = PICK_IDS.map((id) => {
  const found = BENCHMARK_PROMPTS.find((p) => p.id === id);
  if (!found) throw new Error(`TM-46 prompt id ${id} missing from BENCHMARK_PROMPTS`);
  return found;
});

/** smoke-run: 카테고리별 1개씩 5개 — 빠른 파이프라인 검증용. */
export const TM46_SMOKE_PROMPTS: BenchmarkPrompt[] = ['dv-01', 'ta-02', 'tr-02', 'ld-01', 'ig-01']
  .map((id) => {
    const found = BENCHMARK_PROMPTS.find((p) => p.id === id);
    if (!found) throw new Error(`TM-46 smoke prompt id ${id} missing`);
    return found;
  });

/** 캡처할 프레임 인덱스 (1초/중간/끝). 30fps × 6초 default 가정. */
export const CAPTURE_FRAMES = [60, 90, 180] as const;
