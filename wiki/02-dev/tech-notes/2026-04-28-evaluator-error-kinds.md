---
title: Evaluator error kinds — TM-48 도입 분류
created: 2026-04-28
updated: 2026-04-28
tags: [dev, tech-note, sandbox]
status: active
---

# Evaluator error kinds

`evaluateComponentDetailed()`가 반환하는 `EvaluationResult.error.kind` enum 카탈로그.

| kind | 발생 시점 | userMessage (한글) | hint | 호출자가 할 일 |
|---|---|---|---|---|
| `parse` | `new Function()` 단계에서 `SyntaxError` | "코드를 해석할 수 없습니다…" | 괄호/JSX 닫힘 점검 | 친절 패널 표시. retry 권장 X (사용자가 코드 고쳐야 함) |
| `runtime` | factory body 실행 시 throw | "코드를 실행하는 중 오류가 발생했어요" | 정의되지 않은 식별자 점검 | 친절 패널. dev에선 `error.raw` 콘솔 |
| `missing-component` | factory가 함수가 아닌 값 반환 / 컴포넌트 식별자 없음 | "미리보기에 사용할 컴포넌트를 찾지 못했어요" | `Component` 또는 PascalCase 함수 정의 | 친절 패널. 보통 LLM 출력 부분 누락 |
| `timeout` | factory call이 5초 초과 | "코드 평가가 시간 제한을 초과했어요" | 무한 루프/무거운 init 점검 | 친절 패널. 사실상 거의 안 발생 (sync 무한 루프는 sandbox에서 사전 차단) |
| `invalid-input` | `jsCode`가 string 아님 / 빈 문자열 | "미리보기를 생성할 코드가 비어 있거나 형식이 잘못되었어요" | — | 호출자 버그일 가능성 (asset.jsCode가 비었음) |

## 사용 권장

```ts
const { component, error } = evaluateComponentDetailed(asset.jsCode);
if (error) {
  // 친절 패널: error.userMessage + (error.hint ?? '')
  // dev 트리아지: console.warn(error.kind, error.raw)
  return <FallbackPanel kind={error.kind} message={error.userMessage} hint={error.hint} />;
}
return <Player component={component} … />;
```

## 절대 하지 말 것

- `error.raw`를 사용자에게 노출하지 않기 — 스택 트레이스/내부 식별자 포함 가능.
- legacy `evaluateComponent()`만 쓰면 `null`만 받아 검은 화면이 됨. 새 호출처는 항상 `evaluateComponentDetailed()` 사용.

## 분류 휴리스틱

`classifyThrow()`가 `instanceof SyntaxError` → `parse`, 메시지에 `Unexpected|expected|invalid|Identifier`(단 `is not defined` 제외) → `parse`, 그 외 → `runtime`. 크로스-realm error는 prototype 체인이 끊겨 `instanceof`가 실패하므로 메시지 sniff가 백업.

## 관련

- ADR-PENDING-TM-34 — sandbox + evaluator 다층 방어 (TM-48이 보강)
- `wiki/05-reports/2026-04-27-TM-48-evaluator-robust.md` — 20 케이스 매트릭스
- 코드: `../../src/lib/remotion/evaluator.ts`
