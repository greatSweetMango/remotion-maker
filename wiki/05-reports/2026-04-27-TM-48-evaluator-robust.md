---
title: TM-48 Evaluator robustness — 20 fuzz cases + friendly error UI
created: 2026-04-28
updated: 2026-04-28
tags: [qa, dev, sandbox]
status: active
report_type: session
---

# TM-48 Evaluator Robustness Report

## 한 줄 요약

LLM/사람이 만든 Remotion 코드가 깨졌을 때 evaluator가 **앱 크래시 0** + **친절한 한글 에러 메시지**를 보장하도록 구조화. 8 known-trap + 12 fuzz = 20 케이스 전부 통과.

## 변경 요약

| 영역 | 파일 | 내용 |
|---|---|---|
| Evaluator | `src/lib/remotion/evaluator.ts` | `EvaluationResult` 타입 + `evaluateComponentDetailed()` 도입. 에러를 5종(`parse`/`runtime`/`missing-component`/`timeout`/`invalid-input`)으로 분류, 각 종류별 한글 `userMessage` + `hint`. backward-compat shim 유지. |
| Sandbox | `src/lib/remotion/sandbox.ts` | `for(;;){}`, `while(true)`, `do…while(true)` 정적 deny. evaluator wall-clock 타임아웃이 사후 측정이라 sync 무한 루프를 못 끊는 한계를 사전 차단으로 보완. |
| 호출자 | `src/components/studio/PlayerPanel.tsx` | 친절 에러 패널 추가 (`evaluator-error-panel` testid). Player를 `EvaluatorErrorBoundary`로 감쌈. |
| 신규 | `src/components/studio/EvaluatorErrorBoundary.tsx` | 렌더 단계 throw를 잡아 fallback UI 노출 + dev에서만 console.warn. |
| 신규 | `src/app/dev-eval-fixture/{page,client}.tsx` | dev-only fixture 페이지. Playwright가 임의 jsCode를 query로 주입해 친절 UI를 검증. production에서는 404. |
| 테스트 | `__tests__/lib/remotion/evaluator-fuzz.test.ts` | 20 라벨링된 케이스 + 200회 랜덤 입력 (zero-throw) + non-string 입력 안전성. |

## 단위테스트 결과

```
Test Suites: 2 passed, 2 total
Tests:       31 passed, 31 total
```

기존 11 + 신규 20 fuzz = 31. 35-template 회귀 테스트도 동시 통과 (sandbox 신규 deny가 기존 템플릿과 충돌 X — 사전 grep 확인).

## 20 케이스 매트릭스

| # | 케이스 | 차단 layer | 기대 종류 | 결과 |
|---|---|---|---|---|
| 1 | `const = ;` | evaluator | `parse` | PASS |
| 2 | `const Comp = () => Foo;` (Foo 미정의) | evaluator | OK (factory만 만듦, render 시 Boundary가 잡음) | PASS |
| 3 | PARAMS만 | evaluator | `missing-component` | PASS |
| 4 | PARAMS + Component | evaluator | OK (regression — `tech-notes/2026-04-26-evaluator-params-bug.md`) | PASS |
| 5 | `for(;;){}` 모듈 스코프 | **sandbox** | deny | PASS |
| 6 | `setTimeout("alert(1)",0)` | sandbox | deny | PASS |
| 7 | `const x=1` | evaluator | `missing-component` | PASS |
| 8 | `const component = () => null` (소문자) | evaluator | `missing-component` | PASS |
| 9 | `function Comp(){…}` | evaluator | OK | PASS |
| 10 | 모듈 스코프에서 미정의 식별자 참조 | evaluator | `runtime` | PASS |
| 11 | 컴포넌트가 render 시 throw | evaluator (factory OK) | OK + Boundary 책임 | PASS |
| 12 | `import x from 'fs'` | evaluator | `parse` (sucrase가 안 거치면) | PASS |
| 13 | `<div>` 닫힘 누락 | evaluator | `parse` | PASS |
| 14 | `const Comp` 중복 선언 | evaluator | `parse` | PASS |
| 15 | ~50KB 코드 | evaluator | OK | PASS |
| 16 | 그리스 알파(`Α`) 컴포넌트 이름 | evaluator | `missing-component` (regex가 라틴만 매칭) | PASS |
| 17 | 코멘트 안의 syntax error | evaluator | OK | PASS |
| 18 | `() => undefined` | evaluator | OK | PASS |
| 19 | 입력이 `null` | evaluator | `invalid-input` | PASS |
| 20 | `__proto__` | sandbox | deny | PASS |

추가: 200회 랜덤 짧은 문자열 입력 → `evaluateComponentDetailed`가 한 번도 throw 안 함. 비-string 입력 7종(`undefined/null/0/false/{}/[]/123n`) 모두 안전한 `invalid-input` 반환.

## Playwright 통합 검증 (port 3048)

`/dev-eval-fixture?jsCode=…`로 5개 대표 케이스 navigate해서 DOM/콘솔 점검.

| 시나리오 | 친절 패널 노출 | raw stack trace | 앱 크래시 |
|---|---|---|---|
| `const Comp = () => <div>;` (parse) | YES — "코드를 해석할 수 없습니다…" + hint | NO | NO |
| `for(;;){} const Component = () => null;` (sandbox) | YES — "이 코드는 안전 정책에 의해 차단되었어요" | NO | NO |
| `const PARAMS = {};` (missing) | YES — "미리보기에 사용할 컴포넌트를 찾지 못했어요" | NO | NO |
| `const Comp = () => { throw new Error('boom'); };` (render throw) | Remotion Player 자체 fallback ⚠ | NO ('boom' 미노출) | NO |
| `const PARAMS={}; const Component=()=>null;` (정상) | 정상 렌더 (Player 동작) | — | NO |

콘솔에 보이는 4건의 `/api/auth/session 500`은 evaluator와 무관한 환경 이슈(NextAuth DB 미연결). evaluator/sandbox 관련 raw error 노출 0건.

## 알려진 한계 / 후속 작업 후보

1. **Remotion Player 내부 fallback의 모호함** — render-time throw 시 Player가 표시하는 "⚠️"는 우리 ErrorBoundary를 트리거하지 않음. Player가 자체 처리한 결과라 우리 UI 메시지가 안 나옴. 사용자에게 "어떤 에러인지" 알리고 싶다면 Player 외곽에 `<RemotionPlayerErrorWrapper>` 추가 또는 component에 자체 try/catch 주입 필요. ⇒ AI-BUG-evaluator-render-error-not-friendly task로 분리 가치.
2. **그리스/한글 식별자** — `buildReturnStatement`의 PascalCase regex가 `[A-Za-z]`만 매칭. 비-라틴 component 이름은 `missing-component`로 분류됨. LLM이 한글 컴포넌트를 만들 가능성은 낮지만 향후 i18n 시 검토.
3. **무한 루프 휴리스틱의 회피** — `for(let i=0; ; i++){}` 같은 변형은 사전 deny에 안 걸림. AST 분석 도입 시 보강 가능.

## 회고는 별도

`2026-04-28-TM-48-retro.md` 참조.

## 관련

- ADR-PENDING-TM-48 (별도 ADR 미작성 — 기존 ADR-PENDING-TM-34 sandbox-evaluator-hardening 을 보강하는 성격이라 tech-note + retro 로 충분)
- `wiki/02-dev/tech-notes/2026-04-28-evaluator-error-kinds.md` — error kind 카탈로그 + 사용 가이드
- `wiki/02-dev/tech-notes/2026-04-26-evaluator-params-bug.md` — 본 작업의 출발점
- 코드: `../src/lib/remotion/evaluator.ts`, `../src/lib/remotion/sandbox.ts`
