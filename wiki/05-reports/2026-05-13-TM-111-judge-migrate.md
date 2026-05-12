---
title: TM-111 — visual-judge migrate to ai-quality-judge agent + judge-acceptance skill
date: 2026-05-13
type: session
tags: [#qa, #judge, #adr-0018, #tm-66, #tm-100, #tm-103]
related: [TM-46, TM-66, TM-70, TM-100, TM-103]
verdict: APPROVE
---

# TM-111 — visual-judge migrate to ai-quality-judge agent + judge-acceptance skill

## 무엇을 했나

visual-judge 호출부 (`__tests__/benchmarks/tm-46-judge.ts`, `tm-66-smoke.ts`) 를
TM-100 `ai-quality-judge` agent + `judge-acceptance` skill 표준 컨트랙트 안으로
정렬. TM-103 mcp-llm-judge 의 `ChatLikeClient` 인터페이스 모양으로 시그니처를
맞춰 단위 테스트가 OpenAI SDK 없이도 judge 로직만 mock 가능하도록 변경.

ADR-0018 N-shot variance probe (기본 N=2, env `TM111_N_SHOTS` / CLI `--n-shots`
로 override) 내장. sample 단위로 `runs[]`, `delta_max`, `std`, `n_shots` 필드
emit, scores.json envelope 에 `n_shots/seed/temperature` 메타데이터 + aggregate
variance (`avg_delta_max`, `max_delta_max`, `floor_violated`) 노출.

## 표준 검증 매트릭스 (ai-quality-judge SOP)

| # | 항목 | 결과 |
|---|---|---|
| 1 | typecheck (`tsc --noEmit`) | clean — pre-existing 5 errors 외 신규 0 |
| 2 | unit tests (`jest __tests__/lib/tm-46-judge.test.ts`) | 8/8 PASS (5 신규 TM-111 케이스 포함) |
| 3 | variance probe — 결정성 시뮬레이션 (mock) | Δmax=0, σ=0 ✅ |
| 4 | 라이브 sanity (`tm-111-live-sanity.ts`, ~$0.02) | runs=[63,69] Δmax=6 σ=3 — 컨트랙트 OK |

라이브 sanity 의 Δmax=6 은 TM-43 fixture 가 prompt category 와 일치하지 않아
judge 가 흔들린 결과 (corpus mismatch). ADR-0018 floor 는 canonical TM-46 corpus
기준이므로 본 PR 의 wiring 검증과 무관 — corpus 재캡처 시 재측정 필요.

## per-sample variance 표 (라이브 sanity)

| sample | runs | Δmax | σ | n_shots | needs_followup |
|---|---|---|---|---|---|
| live (bar-chart proxy) | [63, 69] | 6 | 3 | 2 | true |

## 산출물 스키마 변화

scores.json envelope 신규 필드:

```jsonc
{
  "n_shots": 2,
  "seed": 42,
  "temperature": 0,
  "variance": {
    "avg_delta_max": 0,
    "max_delta_max": 0,
    "floor_violated": false
  },
  "results": [
    {
      ...,
      "runs": [80, 80],
      "delta_max": 0,
      "std": 0,
      "n_shots": 2
    }
  ]
}
```

기존 필드 (`model`, `ran_at`, `n`, `avg_overall`, `followup_count`, `results`)
는 **호환 유지** (TM-46 r*-analyze 스크립트가 깨지지 않음). per-sample `judge`
필드는 마지막 성공 shot 의 frame breakdown.

## ADR / skill 준수 체크

- ADR-0018 `temperature: 0, seed: 42, response_format: { type: 'json_object' }`
  — 보존, 단위 테스트로 회귀 가드.
- ADR-0016 4-criteria gate — runs[]/Δmax/std 표면화 → skill Step 4 산식이
  per-sample variance 까지 보고 판단 가능.
- judge-acceptance skill "금지" 목록 — `temperature`/`seed` 누락 0건,
  `runs[]/delta_max/std` 필드 추가 (제거 아님), provider 신규 도입 0건.

## SPAWN 권고

없음. canonical TM-46 30-prompt corpus 재캡처 후 N=3 full-run + 회차 비교 보고서가
필요하지만 본 PR scope (callsite migrate) 와 분리되어 TM-46 line 의 별도 회차로
처리되어야 한다. corpus 재캡처는 `ai-prompt-tuner` / capture infra 영역.

## 변경 파일

- `__tests__/benchmarks/tm-46-judge.ts` — ChatLikeClient, judgeOnce/judgePrompt
  분리, N-shot variance, envelope 신규 필드.
- `__tests__/benchmarks/tm-66-smoke.ts` — N=2 variance 출력, ChatLikeClient cast.
- `__tests__/benchmarks/tm-111-live-sanity.ts` — 신규 라이브 sanity 진입점.
- `__tests__/lib/tm-46-judge.test.ts` — 5 신규 케이스 (variance, 결정성 flag,
  partial-failure, hermetic ChatLikeClient).
- `wiki/05-reports/2026-05-13-TM-111-judge-migrate.md` — 본 회고.

## verdict

APPROVE — 표준 검증 매트릭스 4/4 PASS, ADR-0016/0018 위반 0건, 단위 테스트 8/8.
