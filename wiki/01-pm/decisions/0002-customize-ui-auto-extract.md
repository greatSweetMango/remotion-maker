---
title: "ADR-0002: 커스터마이징 UI는 PARAMS 컨벤션으로 자동 추출한다"
created: 2026-04-17
updated: 2026-04-26
tags: [decision, area/customize, area/generate]
status: accepted
---

# ADR-0002: 커스터마이징 UI는 PARAMS 컨벤션으로 자동 추출한다

## 컨텍스트

서비스의 핵심 해자는 **AI가 만든 에셋의 파라미터를 자동 추출해 슬라이더/컬러피커 UI로 제공**하는 것. 이를 안정적으로 구현할 방법이 필요했다.

대안:
1. AST 파싱으로 코드에서 추출 — 강력하나 복잡, 실패율 높음
2. LLM에 별도 추출 호출 — 느리고 비싸고 불일치
3. **시스템 프롬프트로 PARAMS 컨벤션 강제** — 단순, 빠름, 검증 가능

## 결정

생성 시점에 시스템 프롬프트로 **`PARAMS` const export**를 강제한다.

```ts
export const PARAMS = {
  bgColor: { type: 'color', default: '#0066ff', label: '배경' },
  speed: { type: 'range', min: 0, max: 1, default: 0.5, label: '속도' },
  // ...
} as const;
```

런타임에는 module evaluator가 `PARAMS`를 읽어 UI에 매핑한다.

## 결과

- 추출 성공률은 **프롬프트 품질에 직결** → A1 가정 (PRD §11) 검증이 비즈니스 핵심 리스크
- UI 매핑 규칙은 PRD §5.2의 타입 → 컴포넌트 표 그대로 구현
- 실시간 반영은 props 패스스루로 무료 ([[0001-edit-not-equal-render|ADR-0001]])

## 결과적 제약

- LLM이 PARAMS를 안 만들거나 잘못 만들면 UI가 비어 보임 → fallback UX 필요
- 시스템 프롬프트는 모든 모델 등급에 동일 적용

## 검증 계획

- 프롬프트 50회 테스트로 추출 성공률 측정 (목표 80%)
- 실패 케이스 카테고리화 → 시스템 프롬프트 개선 루프

## 관련

- 코드: `src/lib/ai/extract-params.ts`, `src/lib/ai/prompts.ts`
- 매핑 규칙: PRD §5.2
