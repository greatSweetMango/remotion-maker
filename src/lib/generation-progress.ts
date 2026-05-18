/**
 * TM-151 — Progressive UX copy for the full generate pipeline.
 *
 * TM-91 already supplied step copy for the *image-regen dialog*
 * (`ParameterControl.progressMessage`) calibrated to gpt-image-1's p50
 * (~38s). That message ("이미지 생성 중…") is image-specific and not
 * appropriate for the multi-step character pipeline, which exercises
 * outline → scene-spec → asset-gen → scene-code → compose stages and
 * runs ~57s p50 on character prompts (TM-149 measurement).
 *
 * This module surfaces user-facing step copy keyed to elapsed seconds
 * during the full `/api/generate` request. Thresholds picked from the
 * TM-149 dev-log breakdown:
 *
 *   - 0–5s    outline (~6s)
 *   - 5–20s   scene-specs + asset-gen kicked off in parallel
 *   - 20–45s  asset-gen long tail (gpt-image-1 character p50 ~30-40s
 *             with descriptive prompt + style suffix)
 *   - 45s+    scene-code + compose; nearing the user-frustration cliff
 *
 * Kept as a leaf module (no React, no DOM) so it can be unit-tested
 * deterministically and reused from any panel that surfaces progress.
 *
 * Pure function — no side effects. Caller owns the ticker.
 */

export interface GenerationProgress {
  /** Single-line copy safe for a button caption or tooltip. */
  message: string;
  /** Logistic-ish 0–95 fill — never hits 100 so completion stays a discrete event. */
  percent: number;
}

/**
 * Single source of truth for the step copy. Exported separately so tests
 * can assert each band without re-deriving the elapsed math.
 */
export function generationProgressMessage(elapsedMs: number): string {
  const s = Math.max(0, elapsedMs) / 1000;
  if (s < 5) return '구성을 짜는 중…';
  if (s < 20) return '장면을 설계하고 일러스트를 생성 중…';
  if (s < 45) return '캐릭터 일러스트 마무리 중… (조금만 더)';
  if (s < 75) return '코드 합치는 중… 거의 다 됐어요.';
  return '예상보다 오래 걸리고 있습니다. 잠시만 더 기다려주세요.';
}

/**
 * Logistic curve calibrated to TM-149 character p50 (57s):
 *   k=40 → ~50% at 28s, ~76% at 57s, ~92% at 95s.
 * Cap at 95 — never lie about completion.
 */
export function generationProgressPercent(elapsedMs: number): number {
  const s = Math.max(0, elapsedMs) / 1000;
  const raw = (1 - Math.exp(-s / 40)) * 100;
  return Math.min(95, Math.max(0, raw));
}

export function generationProgress(elapsedMs: number): GenerationProgress {
  return {
    message: generationProgressMessage(elapsedMs),
    percent: generationProgressPercent(elapsedMs),
  };
}
