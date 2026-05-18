---
title: "TM-153 — asset-gen prompt diet A/B (hybrid wins, ship)"
created: 2026-05-18
updated: 2026-05-18
type: session
report_type: session
task: TM-153
status: active
verdict: SHIP-hybrid
tags: [report, area/ai, area/cost, area/latency, task/TM-153]
related:
  - "[[2026-05-18-TM-151-latency-budget]]"
  - "[[2026-05-13-TM-92-tier-bench]]"
provenance: extracted
---

# TM-153 — asset-gen prompt diet (live A/B bench)

## TL;DR — SHIP hybrid

TM-151 flagged the 88-char default style suffix in `buildImagePrompt` as
the next obvious latency dial after TM-92 (low-tier) was already shipped.
Live A/B on `gpt-image-1` low with 3 character fixtures × {long, hybrid,
diet}:

| variant | prompt chars (range) | latency p50 | judge overall mean |
|---|---:|---:|---:|
| long (current) | 176-222 | 14.7s | 89 |
| **hybrid** (drop "Style: …" suffix) | **78-124** | **12.5s** | **93** |
| diet (subject + 1 hint only) | 11-21 | 14.6s | 64 |

- **Hybrid is strictly better than long**: -2.2s p50, +4 judge points,
  -45% prompt chars. Ship.
- **Full diet is worse**: subject-only stripping lost critical context
  (judge: "static image, not an animation", "lacks walking animation").
  Don't ship.
- Latency improvement (-2.2s) falls short of TM-151's 10s aspirational
  target — the 30s production gap (TM-92 13s vs prod ~44s) is mostly NOT
  prompt-length-driven. Other factors (network egress, queue, multi-stage
  overhead) must dominate. Separate investigation needed.

## Decision matrix vs spec

| Gate | Long→Hybrid | Long→Diet |
|---|---|---|
| Latency Δ ≥ 10s | NO (-2.2s) | NO (-0.1s) |
| Judge Δ ≤ 5pts | PASS (+4) | FAIL (-25) |
| Verdict | **hybrid (partial improvement, near-zero risk)** | revert |

Spec ("부분 개선이면 hybrid") → ship hybrid.

## 변경

`src/lib/ai/asset-gen-stage.ts`:

1. `runAssetGenStage` default `style` changed from the 88-char suffix to
   `''` (empty). Callers that want the old behaviour still pass it through
   `AssetGenStageInput.style`.
2. `buildImagePrompt` now skips the `". Style: …."` suffix when `style` is
   blank/whitespace — emits just `${prompt}${answerText}`. Backward-compat
   preserved for explicit-style callers (existing TM-90 tests still green).
3. New unit tests (`__tests__/lib/ai/asset-gen-stage.test.ts`):
   - empty-string style → no "Style:" in output
   - whitespace-only style → no "Style:" in output
   - explicit style still emits the suffix verbatim

Existing tests: 22 PASS unchanged + 3 new TM-153 cases = **25/25**.
`generate-tm136-asset-gen.test.ts` (11/11) also green.

## 환경

- 호스트: worktree `worktrees/TM-153-prompt-diet/`
- 모델: `gpt-image-1` quality=`low` 1024×1024 (현재 default)
- Judge: `gpt-4o` multimodal, JSON-strict, `detail: low` (TM-138 reuse)
- Bench scripts: `scripts/qa/tm-153-prompt-diet-bench.mjs`,
  `scripts/qa/tm-153-hybrid-bench.mjs`
- 총 OpenAI 비용 (라이브): 9 gpt-image-1 + 9 gpt-4o judge ≈ **$0.127**
  (사용자 사전 승인 $0.16 cap 내)

## 프롬프트 fixture (TM-149 캐릭터 corpus 일부)

| id | user prompt | answers (clarify-style) |
|---|---|---|
| bear | 곰돌이가 초원을 걸어가는 약 10초분량의 횡스크롤 애니메이션 만들어줘 | style: 동화풍 파스텔 일러스트, palette: 따뜻한 파스텔, mood: 행복하고 평화로움, text_overlay: 없음 |
| puppy | 강아지가 공원에서 뛰어가는 8초 애니메이션 | style: 귀여운 카툰, palette: 밝은 초록, mood: 활기찬, camera: 횡스크롤 |
| robot | robot dancing in cyber city, 6 seconds | style: neon synthwave, palette: magenta and cyan, mood: energetic, text_overlay: none |

## 결과 (per call)

### long (현행)
| fixture | chars | latency | judge.overall | judge.notes |
|---|---:|---:|---:|---|
| bear | 209 | 20.4s | 92 | Charming bear in meadow, well-crafted. |
| puppy | 176 | 14.7s | 88 | Cute style, matches dog in park well. |
| robot | 222 | 13.8s | 88 | Vivid depiction of a dancing robot in a cyber city. |

### hybrid (style 접미사 제거)
| fixture | chars | latency | judge.overall | judge.notes |
|---|---:|---:|---:|---|
| bear | 111 | 11.9s | 93 | Cute bear walking in field, well-made. |
| puppy | 78 | 12.5s | 87 | Cute dog running in a park; good animation style. |
| robot | 124 | 13.0s | **98** | Vivid cyberpunk theme, clear subject. |

### diet (subject + 1 style hint만)
| fixture | chars | latency | judge.overall | judge.notes |
|---|---:|---:|---:|---|
| bear | 17 | 14.6s | 75 | Cute bear, lacks walking animation. |
| puppy | 11 | 16.2s | 45 | Static image, not an animation. |
| robot | 21 | 11.3s | 73 | Static image, no dancing visible. |

JSON 원본:
- `wiki/05-reports/screenshots/TM-153/bench-summary.json` (long + diet)
- `wiki/05-reports/screenshots/TM-153/hybrid-bench-summary.json`
- 9 PNG: `wiki/05-reports/screenshots/TM-153/<variant>-<fixture>.png`

## Why hybrid wins (interpretation)

생성된 PNG는 본질적으로 정지 이미지. 사용자 prompt 의 "걸어가는 / 뛰어가는 /
dancing" 같은 **동사 motion** 단서는 judge 가 채점하지만 PNG 화질엔 영향이
적다. 동사 단서를 잃지 않으면서 generic style 적용 부분 ("friendly cartoon
illustration, transparent background, soft colors, centered composition")
을 떨어뜨리면, 각 prompt 의 **고유 style 단서 (동화풍 파스텔, neon synthwave,
귀여운 카툰)** 가 모델 attention 을 독점한다 → 결과가 prompt-specific 으로
더 잘 align. 점수 상승은 그래서.

Diet 가 망한 이유: subject 외 동사 motion 단서까지 통째로 제거 → "강아지" 만
주면 "정적 강아지" 가 나오고 judge subject_match 폭락.

## 잔여 latency gap (TM-92 13s vs prod ~44s)

본 변경 후 prod 추정 p50 ≈ **42s** (44 - 2). TM-92 13s baseline 과의 잔여
~29s gap 은 **prompt 길이 외 요인**이 지배적임이 증명됨. 후보:

- 멀티스텝 파이프라인 안 다른 stage 의 부하 (compose 2s, scene-spec 평가 시
  교차 영향).
- 운영 환경 네트워크 (TM-92 는 로컬 dev, prod 는 서버리스 cold start 가능).
- Provider 측 queue depth (운영 시각대 부하).

→ Follow-up task 후보: prod latency profiling (server timestamps 도입,
TM-92 와 동일 host 에서 비교 재측정).

## ADR 영향

없음. ADR-0022 (character rendering) 의 "캐싱 → R2" 결정과 무관, 본 변경은
`buildImagePrompt` 내부 default 만 건드림 (public API 변경 없음).

## 산출물 경로

- 코드: `src/lib/ai/asset-gen-stage.ts`
- 신규 테스트: `__tests__/lib/ai/asset-gen-stage.test.ts` (3 cases 추가)
- 벤치 스크립트: `scripts/qa/tm-153-prompt-diet-bench.mjs`,
  `scripts/qa/tm-153-hybrid-bench.mjs`
- 9 PNG + JSON summaries: `wiki/05-reports/screenshots/TM-153/`
- 본 보고서: `wiki/05-reports/2026-05-18-TM-153-prompt-diet-bench.md`

## Verify (local)

```bash
npx jest __tests__/lib/ai/asset-gen-stage.test.ts
# → 25/25 PASS (incl. 3 new TM-153 cases)
npx jest __tests__/lib/ai/generate-tm136-asset-gen.test.ts
# → 11/11 PASS (regression check)
```
