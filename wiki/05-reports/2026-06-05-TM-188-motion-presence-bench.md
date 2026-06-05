---
title: "TM-188 — Motion-presence regression corpus + before/after bench"
created: 2026-06-05
updated: 2026-06-05
tags: [report, qa, ai, generate, motion, liveness, regression, bench, tm-149, tm-173, tm-184, tm-186]
status: active
report_type: session
period: "2026-06-05"
author: "TeamLead (TM-188)"
provenance: extracted
related:
  - "[[2026-05-19-TM-173-corpus-expand]]"
verdict: APPROVE
---

# TM-188 — Motion-presence regression corpus + before/after bench

## TL;DR — APPROVE (driver verified, live numbers deferred to nightly)

TM-149/173 회귀 코퍼스를 **motion 관점으로 확장**(16 prompt, 5 motion subtype)하고, 방금 머지된 TM-184 `liveness-check.ts`(AST + 렌더 diff)를 측정 엔진으로 쓰는 **결정론적 motion-presence bench 드라이버**를 신설했다.

- 코퍼스: `scripts/bench/tm-188/motion-corpus.json` — locomotion(곰돌이 보행 등)·parallax 횡스크롤·data-viz 애니메이션·transition·periodic loader. 16건 중 10건이 **과거 정적 출력(`애니메이션이 안 움직인다`)을 유발한 케이스**.
- 드라이버: `scripts/bench/tm-188/motion-presence-bench.ts` — `--mode=fixtures`(결정론 self-verify, 키/서버 불필요)와 `--mode=live`(야간 키-있는 루프) 2모드. 측정 코어는 side-effect free `scorer.ts`로 분리.
- 검증: 11개 fixture(known-static/known-live/render-diff)를 **100% 정확 분류**, Jest 16/16 통과, typecheck/lint clean.
- **라이브 baseline/after 실측은 이 세션에서 미실행**(키+dev서버+실 렌더 stall 위험). spawned nightly task로 예약.

## 무엇이 바뀌었나

- **신규 코퍼스** `scripts/bench/tm-188/motion-corpus.json` (16 prompt). 기존 prompt-corpus 포맷(id/category/prompt) 유지 + TM-188 motion 축(`motionSubtype`, `pastStaticFailure`, `expectMotion`) 추가. seed:42 명시.
- **신규 측정 코어** `scripts/bench/tm-188/scorer.ts` — `scoreMotion()`: TM-184 `detectStaticMotionSource`(AST, free) → 정적이면 verdict `static`/score 0; 아니면 `checkRenderedLiveness`(렌더 diff, fixtures에서는 mock seam) → maxDiff를 `diffToMotionScore`(0-100)로 매핑.
- **신규 드라이버** `scripts/bench/tm-188/motion-presence-bench.ts` — fixtures/live 2모드, `wiki/05-reports/screenshots/TM-188/<mode>-<label>.json` 산출, fixture 오분류 시 exit 1(CI loud-fail).
- **결정론 fixtures** `scripts/bench/tm-188/fixtures.ts` — 4 known-static + 4 known-live source + 3 render-diff triple(합성 feature vector). 모든 값이 리터럴 → 재현 100%.
- **결정론 테스트** `__tests__/bench/tm-188-motion-presence.test.ts` (16 case): static→static, live→live, render-diff identical→static / moving→live, 동일 입력 2회 동일 결과.

## 왜 / 배경

TM-184가 "출력이 실제로 프레임 간에 움직이는가"를 묻는 **positive liveness gate**를 도입했지만, 그 게이트가 과거 정적 회귀(곰돌이 횡스크롤이 한 장 포스터로 나오던 류)를 얼마나 잡는지 **회귀 코퍼스 기반 before/after 측정 수단이 없었다**. TM-188은 그 측정 하네스를 만든다. composition-critique/judge(TM-186 소관)는 건드리지 않고, TM-184 liveness만 소비한다 — TM-186 motion judge가 머지되면 점수는 additive 컬럼으로 통합 가능.

## 측정 산식 (motion-presence)

| 지표 | 정의 |
|---|---|
| `motion_present_pct` | verdict가 `live`인 row 비율 |
| `motion_score_avg` | render-diff가 돈 row의 0-100 motion score 평균 (`maxDiff/25*100`, cap 100) |
| `classification_accuracy_pct` | (fixtures) ground-truth 라벨과 일치한 비율 — **드라이버 정확도** |

결정성(ADR-0018): 측정 경로는 순수 산술 + AST 정규식. 모델 호출/난수 없음, ε·downscale·frame 고정. fixtures 모드는 바이트 동일 산출.

## fixtures 모드 결과 (이 세션, 결정론)

```
mode=fixtures  n=11  classification_accuracy_pct=100  classified_correct=11/11
motion_present_n=6  motion_present_pct=55  motion_score_avg=28
```

- 4 known-static source → 전부 `static` (AST `no-frame-driven-ref` / `css-freeze`).
- 4 known-live source → 전부 `live` (AST 통과).
- 3 render-diff: identical→`static`(score 0), moving 2건→`live`(score>0).

→ **드라이버가 정적/동적을 정확히 분류함을 결정론적으로 증명.** (수용 기준 1 충족)

## baseline → after 비교 (골격 — 라이브 수치 후속)

야간 키-있는 루프(`--mode=live`)가 16-prompt 코퍼스를 baseline 커밋과 after 커밋에서 각각 돌려 채운다. 표 골격:

| motion subtype | n | baseline `motion_present_pct` | after `motion_present_pct` | Δ |
|---|---|---|---|---|
| locomotion | 4 | _(nightly)_ | _(nightly)_ | _(nightly)_ |
| parallax-scroll | 3 | _(nightly)_ | _(nightly)_ | _(nightly)_ |
| dataviz-anim | 3 | _(nightly)_ | _(nightly)_ | _(nightly)_ |
| transition | 3 | _(nightly)_ | _(nightly)_ | _(nightly)_ |
| periodic-loader | 3 | _(nightly)_ | _(nightly)_ | _(nightly)_ |

산출물: `wiki/05-reports/screenshots/TM-188/live-baseline.json`, `live-after.json` (드라이버가 자동 기록).

## 영향

- **코드/시스템**: 새 파일만 추가(코퍼스+scorer+드라이버+fixtures+테스트). production generate 경로 무변경. TM-186 surface(composition-critique.ts/judge) 무접촉 → 충돌 없음.
- **비용/성능**: fixtures 모드 0 토큰·0 렌더. live 모드만 키 소비(야간). TM-184 `isLivenessRenderEnabled()` test-default-off 존중 — 드라이버는 fixtures에서 mock seam만 사용.
- **CI/야간**: fixtures 모드는 결정론이라 CI 게이트 편입 가능(오분류 시 exit 1). live 모드는 야간 bench 편입.

## 후속 / 다음

- [ ] (spawned, nightly, keyed) `--mode=live --label=baseline` / `--label=after` 실측 → 위 비교표 채우기 📅 2026-06-06
- [ ] TM-186 motion judge 머지 후 score를 additive 컬럼으로 통합 (scorer.ts에 옵셔널 필드)
- [ ] live 모드 numbers 확보 후 CI 야간 bench에 정식 등록

## 출처 / 링크

- 코퍼스: `../../scripts/bench/tm-188/motion-corpus.json`
- 드라이버: `../../scripts/bench/tm-188/motion-presence-bench.ts`
- 측정 코어: `../../scripts/bench/tm-188/scorer.ts`
- fixtures: `../../scripts/bench/tm-188/fixtures.ts`
- 테스트: `../../__tests__/bench/tm-188-motion-presence.test.ts`
- 측정 엔진(소비만): `../../src/lib/ai/liveness-check.ts` (TM-184)
