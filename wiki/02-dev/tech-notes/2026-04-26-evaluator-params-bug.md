---
title: Evaluator의 PARAMS 식별자 매칭 버그
created: 2026-04-26
updated: 2026-04-26
tags: [dev, tech-note]
status: active
---

# Evaluator: PARAMS가 컴포넌트로 잘못 인식되던 버그

## 증상

TemplatePicker의 모든 템플릿 썸네일이 검은 화면으로만 표시됨. 실제 Studio에서 같은 코드를 로드하면 정상 동작.

## 원인

`src/lib/remotion/evaluator.ts`의 `buildReturnStatement()`가 코드에서 export할 식별자를 정규식으로 추출할 때, 문서 상단의 `PARAMS` 객체 선언을 컴포넌트 함수보다 먼저 매칭함.

```ts
// 템플릿 코드 예시
const PARAMS = { ... };
const Counter = () => { ... };

// 정규식이 PARAMS를 먼저 잡아 객체를 return → Player가 함수가 아닌 객체를 받음
```

## 수정

추출 결과를 PascalCase로 필터링 (SCREAMING_CASE 식별자 제외):

```ts
const candidates = [...jsCode.matchAll(/(?:^|\n)\s*(?:const|function)\s+([A-Z][a-zA-Z0-9]*)\s*[=(]/g)]
  .map(m => m[1])
  .filter((name, i, arr) => arr.indexOf(name) === i)
  .filter(name => /[a-z]/.test(name)); // SCREAMING_CASE 제외
```

## 교훈

정규식으로 식별자를 추출할 때는 컨벤션(PascalCase 컴포넌트, SCREAMING_CASE 상수)을 명시적으로 분리해야 함. AST 파서를 쓰는 게 안전하지만, 현재 sucrase 기반 파이프라인에서는 이 정도 휴리스틱으로 충분.

## 관련

- 코드: `../src/lib/remotion/evaluator.ts`
- 사용처: `../src/components/studio/TemplatePicker.tsx`
