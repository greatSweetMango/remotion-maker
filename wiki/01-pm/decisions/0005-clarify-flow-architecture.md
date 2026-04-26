---
title: ADR-0005 — Clarify 분기 아키텍처 (단일 LLM 호출 토글)
created: 2026-04-26
updated: 2026-04-26
tags: [adr, dev, ai]
status: active
provenance: extracted
---

# ADR-0005: GEN-06 Clarifying Questions — 단일 LLM 호출 토글 아키텍처

> **Origin**: TM-11 build-team의 Architect 결정 (2026-04-26).
> **관련 산출물**: [[../../03-research/clarifying-questions-llm-patterns|RS-1 리서치]] · [[../../05-reports/2026-04-26-task-TM-11-validation|VL-1 Validation]]

## Context

PRD §5.1 GEN-06 — 모호한 프롬프트에 AI가 1-3개 핵심 질문을 역으로 던져 사용자 의도를 구체화. Researcher RS-1이 3가지 분기 옵션과 모호성 휴리스틱 후보를 정리.

## Decision

### D1. 옵션 A 채택 — 단일 LLM 호출 토글
한 번의 generate 호출에서 시스템 프롬프트가 모델에게 `mode=clarify` 또는 `mode=generate`를 결정하도록 위임. 명확 프롬프트 추가 비용 0.

옵션 B(별도 Haiku 분류기)는 명확 케이스도 매번 +$0.002 발생 → 데모 트래픽에서 누적 비용 부담.

### D2. CLARIFY_SYSTEM_PROMPT 전략 — 통합형 export
- `GENERATION_SYSTEM_PROMPT` 그대로 유지 (회귀 안전망)
- `GENERATION_WITH_CLARIFY_SYSTEM_PROMPT` 신설 (RESPONSE MODE DECISION 블록 + 기존 PARAMS/COMPONENT 섹션)
- generate.ts는 신규 프롬프트 사용

### D3. 클라이언트 휴리스틱 → 채택 X
서버 LLM이 단일 진실. 클라이언트는 응답 shape 분기만. 자명한 빈/너무 짧은 입력은 입력 가드만.

### D4. ClarifyResponse shape (동결)
```typescript
type ClarifyChoice = { value: string; label: string };
type ClarifyQuestion = {
  id: string;
  question: string;
  choices: ClarifyChoice[]; // 2~5개
  default_skip?: string;
};
type ClarifyResponse = { type: 'clarify'; questions: ClarifyQuestion[]; };
type GenerateSuccessResponse = { type: 'generate'; asset: GeneratedAsset };
type GenerateApiResponse = ClarifyResponse | GenerateSuccessResponse;
```

`type` discriminator 필수.

### D5. usage 카운팅 정책
- **clarify-only 응답**: usage++ 안 함
- **generate 성공**: usage++
- 답변 후 재생성 = 1 usage (자연스러운 자산 생성 단위)
- 비용 telemetry는 모든 호출 누적 (모니터링용)

### D6. JSON 파싱 견고성 — 2단 fallback
1. 1차: 기존 `text.match(/\{[\s\S]*\}/)`
2. 2차: 균형 괄호 매칭 + fence-stripping
3. 실패 → 첫 200자 로깅 + 명확한 에러 throw + 사용자 UX "다시 시도"

`jsonrepair` 의존성 추가는 보류 (D6 알고리즘으로 데모 충분).

### D7. PRO 티어 모델 정책
옵션 A 귀결: clarify는 generate와 동일 모델 (PRO=Sonnet/Opus, FREE=Haiku). 별도 분기 코드 X.

### D8. i18n
시스템 프롬프트에 "사용자 입력 언어로 질문 생성, 모호하면 한국어 기본" 명시. 별도 i18n 키 매핑 X (데모 범위).

## Implementation Touch Points

| 파일 | 변경 |
|---|---|
| `src/types/index.ts` | Clarify 타입 5종 |
| `src/lib/ai/prompts.ts` | `GENERATION_WITH_CLARIFY_SYSTEM_PROMPT` 신설 |
| `src/lib/ai/generate.ts` | `generateAsset(prompt, model, opts?: {answers?})` 시그니처, mode 분기 |
| `src/app/api/generate/route.ts` | answers 수신, usage++ 위치 이동 |
| `src/hooks/useStudio.ts` | `clarifyState` + submit/skip 액션 |
| `src/components/studio/PromptPanel.tsx` | ClarifyCard 서브컴포넌트 |

## Consequences

### 긍정
- 명확 프롬프트 추가 비용 0
- API 응답 shape이 discriminated union → 타입 안전성
- Sandbox/PARAMS 추출 경로 무수정 (회귀 0)
- clarify 응답은 무료 한도에서 차감되지 않음 (사용자 친화)

### 부정 / 주의
- API 응답 shape 변경 (`{asset}` → `{type, asset}`) — 외부 호출자 마이그레이션 필요. 현재 useStudio만 확인됨
- 시스템 프롬프트 길이 +495 토큰 (캐싱으로 완화)
- skip 경로는 generate 1회 추가 ($0.006) — 향후 캐시/재사용 검토 가능

## Verification

VL-1 검증: 7/7 통과, verdict APPROVE 92%. 회귀 28/28 (19+9 신규).

## 관련

- [[../../03-research/clarifying-questions-llm-patterns|RS-1 리서치]]
- [[../../05-reports/2026-04-26-task-TM-11-validation|VL-1 Validation Report]]
- [[../../05-reports/2026-04-26-task-TM-11-qa|QA-1 Report]]
- 코드: PR #2 / branch `TM-11-gen-06-clarifying-questions` / commit `4274c6e`
