---
title: "TM-147 — Lambda render-verify Lottie smoke"
created: 2026-05-15
updated: 2026-05-15
tags: [report, dev, remotion, lottie, qa]
status: active
report_type: session
---

# TM-147 — Lottie bundle smoke (ADR-0027 §4)

5초 합성을 webpack 번들 → `selectComposition` → `renderStill` (frame 0/149) → `renderMedia` (h264 mp4) 순서로 돌려 `public/lottie/` + `<CatalogueLottie>` 라운드트립을 검증.

## 변경

- `__tests__/api/export/lottie-bundle-entry.tsx` (신규) — `LottieBundleSmoke` Composition (640×360, 30fps, 150 frames). `<CatalogueLottie asset="lottie/bear-walk.json" loop>`만 마운트.
- `__tests__/api/export/lottie-bundle.test.ts` (신규) — TM-131 audio bundle 테스트 미러. `REMOTION_BUNDLE_TEST=1` opt-in, 평소 `describe.skip`.

## 검증 항목

1. **Composition resolve** — `id`, `durationInFrames`, `fps`, width/height 검증.
2. **Animation liveness** — frame 0 vs frame 149 PNG 바이트 비교: 다르면 통과. `staticFile()`이 fail-soft로 `null`을 그렸다면 두 프레임이 동일 솔리드 배경 → 즉시 fail. (가장 강한 시그널.)
3. **mp4 stream check** — ffprobe로 video stream + codec(h264/avc1) + width/height + duration(4.8~5.2s) 검증. ffprobe 미존재 환경은 `avc1`/`vide` 아톰 바이트 스니프로 fallback.

## 결과

```
REMOTION_BUNDLE_TEST=1 npx jest __tests__/api/export/lottie-bundle.test.ts
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Time:        15.55 s
```

(첫 실행 때 Chrome Headless Shell 90MB 다운로드 포함, 이후 캐시.)

회귀: 전체 jest 결과는 변경 전후 모두 `27 failed / 8 skipped / 79 passed (총 106 of 114 suites), 999 passed tests`로 동일 — 본 PR로 인한 신규 회귀 0.

## 제약 / 후속

- Remotion Lambda 라이브 호출은 의도적으로 미수행 (TM-147 scope: local renderer로 staticFile 메커니즘 = Lambda staticFile 메커니즘이라는 ADR-0027 §4의 추론 검증). Lambda 비용 절감.
- `bear-walk.json`은 TM-144 hand-authored CC0 stub. 차후 외부 큐레이션 자산 추가 시 동일 smoke 패턴 재사용 가능.
- 테스트는 webpack bundle + Chrome shell 다운로드 비용으로 ~15s, opt-in 유지.

## 관련

- [[01-pm/decisions/0027-lottie-catalogue|ADR-0027]] §4 — Lambda render verify
- TM-131 audio bundle smoke (이번 패턴의 sibling)
- TM-144 catalogue assets, TM-140 wrapper component
