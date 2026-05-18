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

/**
 * TM-160 — map server-side stage names (`recordMark` phases in
 * `latency-profile.ts` / `pipeline.ts`) to user-facing Korean copy and a
 * coarse 0–95 fill that matches the stage's typical pipeline position.
 *
 * Percent anchors picked from TM-149 / TM-156 production breakdown:
 *   pipeline.outline           ~10s   →  15
 *   pipeline.scene-specs       ~ 5s   →  25
 *   asset-gen-stage.prompt     ~ 0    →  28
 *   asset-gen.client-init      ~ 0    →  30
 *   asset-gen.wire (long)      ~30s   →  60
 *   asset-gen-stage.*          ~       →  70
 *   pipeline.scene-code        ~ 5s   →  80
 *   pipeline.compose+validate  ~ 3s   →  90
 *   route.total / done                →  95
 *
 * Unknown stage falls back to the timer curve (TM-91) plus a small
 * "we got SOMETHING from the server" nudge so the bar can never appear
 * stuck below the timer baseline.
 */
export function stageProgress(stage: string, elapsedMs: number): GenerationProgress {
  const table: Array<{ match: RegExp; message: string; percent: number }> = [
    { match: /^pipeline\.outline$/, message: '구성을 짜는 중…', percent: 15 },
    { match: /^pipeline\.scene-specs?$/, message: '장면 명세를 설계 중…', percent: 25 },
    { match: /^asset-gen-stage\.prompt-build$/, message: '캐릭터 일러스트 프롬프트 준비 중…', percent: 28 },
    { match: /^asset-gen\.client-init$/, message: '이미지 모델 연결 중…', percent: 30 },
    { match: /^asset-gen(\.|-).*(wire|generate-total|disk-write)$/, message: '캐릭터 일러스트 생성 중…', percent: 60 },
    { match: /^asset-gen(\.|-)/, message: '캐릭터 일러스트 처리 중…', percent: 55 },
    { match: /^pipeline\.scene-code$/, message: '장면 코드 생성 중…', percent: 80 },
    { match: /^pipeline\.compose\+validate$/, message: '합치고 검증하는 중…', percent: 90 },
    { match: /^route\.total$/, message: '마무리 중…', percent: 95 },
    { match: /^done$/, message: '완료!', percent: 95 },
  ];
  for (const row of table) {
    if (row.match.test(stage)) return { message: row.message, percent: row.percent };
  }
  const fallback = generationProgress(elapsedMs);
  return {
    message: fallback.message,
    percent: Math.min(95, fallback.percent + 5),
  };
}
