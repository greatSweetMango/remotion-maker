---
title: "2026-04-27 — TM-66 Visual judge: Anthropic Opus 4.7 → OpenAI gpt-4o 마이그레이션"
created: 2026-04-27
updated: 2026-04-27
tags: [report, ai, benchmark]
status: active
report_type: session
period: "2026-04-27"
author: TeamLead (Claude)
---

# TM-66 Visual judge — OpenAI gpt-4o 마이그레이션

## TL;DR

- TM-46 r2 escalate 원인이 `ANTHROPIC_API_KEY` 빈 값. judge 를 OpenAI gpt-4o 멀티모달 + JSON mode 로 포팅.
- 4축 (layout/typography/motion/fidelity) 1-10 루브릭, 3 frames/prompt, JSON 응답 스키마 동일. 호출당 비용 $0.06 → ~$0.05.
- 단위 테스트 3건 통과, 1-prompt live smoke 통과 (4.1s, overall=83 정상 parse).

## 무엇이 바뀌었나

- `__tests__/benchmarks/tm-46-judge.ts`
  - SDK 교체: `@anthropic-ai/sdk` → `openai`.
  - 모델: `claude-opus-4-7-20260101` → `gpt-4o` (default, `JUDGE_MODEL` 로 override 가능).
  - 호출: `messages.create` → `chat.completions.create({ response_format: {type:'json_object'} })`.
  - 이미지 포맷: `{type:'image', source:{type:'base64', media_type, data}}` → `{type:'image_url', image_url:{url:'data:image/png;base64,...'}}`.
  - max_tokens 600 → 400 (4축 12점수 + 짧은 코멘트만 필요).
  - 키 검증: `ANTHROPIC_API_KEY` → `OPENAI_API_KEY`.
  - `judgePrompt` export 화 (단위 테스트용).
- 신규 `__tests__/lib/tm-46-judge.test.ts` — Jest로 OpenAI 클라이언트 mock하여 4축 parse / followup 임계 / malformed JSON 핸들링 3건 검증.
- 신규 `__tests__/benchmarks/tm-66-smoke.ts` — 1-prompt live smoke (gpt-4o 1회 호출).
- worktree `.env.local` 심볼릭 링크 추가 (메인 vault 키 재사용).

## 왜 / 배경

TM-46 r2 (PR #47) 머지 후 full-run 시도 중 `ANTHROPIC_API_KEY required` 에러로 escalated. 사용자 환경에서는 OpenAI 키만 활성화되어 있었음. judge 는 의미상 평가 모델일 뿐이므로 (학습된 텍스트 코드 생성과 무관) 멀티모달 + JSON 출력만 충족하면 교체 가능 — gpt-4o 가 두 요건 모두 native 지원하고 비용도 더 낮음.

## 영향

### 코드 / 시스템

- judge 파이프라인 의존성을 OpenAI 로 단일화 (현재 codebase 의 `src/lib/ai/generate.ts` 등은 여전히 Anthropic 사용; judge 만 분리).
- ADR 영향 없음 — judge는 Edit≠Render 경계 외부의 평가 도구.

### 비용 / 성능

| 모델 | 호출당 추정 비용 | latency | JSON 강제 | 멀티모달 |
|---|---|---|---|---|
| Opus 4.7 (이전) | ~$0.06 | ~6-10s | prompt-만 | ✓ |
| gpt-4o (현재) | ~$0.05 | ~4s (smoke 4.1s 측정) | `response_format: json_object` native | ✓ |

30 프롬프트 full-run 기준: ~$1.8 → ~$1.5 (~17% 감소). JSON 강제는 native 옵션이라 parse-fail 리스크 감소.

### 사용자/제품

- 동일 4축 루브릭 유지 — 과거 점수와의 비교 가능성은 보존되나 모델 차이로 절대값에는 ±~5점 drift 가능 (검증 필요).

## 후속 / 다음

- [ ] 30-prompt full-run 후 평균 점수 분포를 Opus 4.7 기록과 비교 (drift 측정) 📅 2026-04-29
- [ ] `triggers_requalify: [46]` — TM-46 의 escalate 상태 해제, full-run 재실행
- [ ] capture 단계 (Playwright) 가 실 PNG 생성 후 placeholder fixture 분리 유지 확인

## 출처 / 링크

- 코드: `../__tests__/benchmarks/tm-46-judge.ts`
- 단위 테스트: `../__tests__/lib/tm-46-judge.test.ts`
- 라이브 smoke: `../__tests__/benchmarks/tm-66-smoke.ts`
- 선행 작업: PR #47 (TM-46 r2 visual-judge full-run infra)
- escalate 원인: ANTHROPIC_API_KEY 빈 값 (사용자 환경)
