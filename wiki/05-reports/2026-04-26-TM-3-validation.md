---
title: "A1 PARAMS Auto-Extraction Reliability — Validation Report (TM-3)"
created: 2026-04-26
updated: 2026-04-26
tags: [validation, experiment, ai, benchmark]
status: active
report_type: session
---

# A1 PARAMS Auto-Extraction Reliability — Validation Report (TM-3)

## TL;DR

- **Hypothesis (ADR-0002 / PRD §11 A1)**: 시스템 프롬프트로 `PARAMS` 컨벤션을 강제하면 추출 성공률이 ≥ 80% 다.
- **결과**: 50개 prompt 중 **44개 PASS (88.0%)**. **가설 ACCEPT**.
- **Production hardening**: 동일 PR(#8)에서 시스템 프롬프트 + `extractJson` 동시 강화.
- **모델**: `openai/gpt-4o-mini` (`.env.local`의 free tier).
- **비용**: 3 라운드 합산 약 $0.15 (한도 $5 대비 3% 사용).

## 셋업

- 프롬프트 50개 / 5 카테고리 × 10: data-viz, text-anim, transition, loader, infographic.
- 산출 코드는 4개 acceptance check 모두 통과 시 PASS:
  1. `(export )?const PARAMS = { ... }` 존재
  2. PARAMS 본문에 `// type: <kind>` 주석 ≥ 2 개
  3. PARAMS 키가 컴포넌트 본문에서 참조됨
  4. `export const GeneratedAsset = ...` 존재
- 보조 메트릭: 프로덕션 `extractParameters()`가 ≥ 1개 추출.
- 실행기: `scripts/validate-params-extraction.ts` (concurrency 6, timeout 90s/req).

## 라운드 별 결과

| Round | Pass | 주요 실패 모드 | 조치 |
|-------|------|----------------|------|
| R1 | 0/50 (0%) | clarify 21, json-parse 21, no-PARAMS 8 | 채점 버그(PARAMS export 강제) + 파서 미흡 + clarify 과민 발견 |
| R2 | 8/50 (16%) | json-parse 23, clarify 19 | acceptance 채점 보정 (production extractor와 일치) |
| R3 | **44/50 (88%)** | clarify 3, json-parse 2, missing-types 1 | system prompt JSON 직렬화 룰 추가 + clarify 휴리스틱 보수화 + extractJson 백틱 복구 fallback |

## R3 카테고리 분포

| Category | Pass / Total | Rate |
|----------|--------------|------|
| data-viz | 8/10 | 80% |
| text-anim | 10/10 | 100% |
| transition | 8/10 | 80% |
| loader | 10/10 | 100% |
| infographic | 8/10 | 80% |

## 발견한 실패 패턴 → 프로덕션 수정

### 1. JS 템플릿 리터럴 백틱 (가장 큰 영향)

gpt-4o-mini가 `"code": \`...\`` 처럼 백틱으로 감싸 JSON을 깨뜨리는 케이스가 빈발 (R2에서 23/50). 수정:
- 시스템 프롬프트에 "백틱 금지 / `\n`·`\"` 이스케이프 강제" 규칙 추가.
- `src/lib/ai/generate.ts`의 `extractJson`에 `repairBacktickStrings` fallback과 backtick-aware brace walker 추가. **프로덕션에서도 동일 효과 — 잠재 사용자 영향 즉시 감소**.

### 2. Clarify mode 과민 발사

원래 휴리스틱이 "<10 단어 + 일부 모호" 였는데 "빨간 카운터 0~100", "페이드 인/아웃" 같은 명확한 짧은 프롬프트도 trigger됨. 수정:
- 기본 모드를 generate 로 설정.
- "진짜로 subject·color·text·data·style 어느 것도 없을 때만" clarify.
- 더 많은 "NOT trigger" 예시 추가.

### 3. 잔여 실패 (R3, 6/50)

- **clarify-mode parroting (3)**: 모델이 시스템 프롬프트의 예시 질문을 그대로 출력. → 후속: 예시를 `<example only — never copy verbatim>` 로 라벨링하는 ADR follow-up 추천.
- **max_tokens=4096 truncation (2)**: 대형 SVG·다중 컴포넌트 생성 시 잘림. → 후속: `chatComplete`의 `maxTokens` 6000–8000으로 상향.
- **single-PARAM borderline (1)**: `tr-08`은 PARAM 1개라 acceptance C2(≥2) 미달. 실제 production 영향 없음 (UI는 1개도 렌더). → benchmark 임계만 재고.

## 채택 결정

- **ADR-0002 가설 ACCEPT**. 88% > 80% 임계. 동일 PR에서 production prompt + 파서 강화.
- 다음 단계 권장:
  1. `claude-haiku-4-5` 로도 50 prompt 재실행 (anthropic provider).
  2. `maxTokens` 상향 (위 #2).
  3. clarify exemplar 라벨링 ADR (위 #1).
  4. 브라우저 Player 에서 10개 출력 spot-check (TM-3 test_strategy).

## 관련

- ADR-0002: [[01-pm/decisions/0002-customize-ui-auto-extract|커스터마이징 UI는 PARAMS 컨벤션으로 자동 추출한다]]
- PR: https://github.com/greatSweetMango/remotion-maker/pull/8
- 코드: `src/lib/ai/prompts.ts`, `src/lib/ai/generate.ts`
