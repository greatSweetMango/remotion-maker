---
title: TM-45 Edge Fuzzing — POST /api/generate (30 cases)
date: 2026-04-27
type: qa
task_id: TM-45
tags: [qa, fuzz, security, ai, sandbox]
verdict: APPROVE_WITH_FOLLOWUP
---

# TM-45 — AI 입력/출력 edge fuzzing

## 한줄 요약

30 케이스 fuzz harness 결과 **앱 크래시 0, XSS 0**. 27 PASS, 2 PASS-with-note (acceptable LLM-refusal), 1 WARN (LLM ignored adversarial instruction — not a bug). Sandbox `validateCode` deny-list 가 코드 인젝션을 차단했고 (D8), 앞단(JSON 파싱 실패)이 D1-D7 을 모두 막았다. 그러나 입력 검증 갭 3 건 발견 → fix task TM-57/58/59 spawned with `triggers_requalify=[45]`.

## Acceptance vs 결과

| 기준 | 결과 |
|---|---|
| 30/30 graceful | PASS — 모든 응답이 200/4xx/5xx + JSON `{error}` 또는 정상 asset |
| 앱 크래시 | 0 건 |
| XSS / 인젝션 escape | 0 건 (D1-D8 모두 sandbox or upstream JSON parse 에서 차단) |
| 사용자 향 에러 메시지 명확 | 부분 PASS — `Prompt required`, `Generated code failed security check: Forbidden: Worker` 는 명확. 단, `AI did not return valid JSON` 은 D1-D7 에서 사용자에게 혼란 (TM-59 에서 fix) |

## 환경

- worktree: `worktrees/TM-45-edge-fuzzing`
- branch: `TM-45-edge-fuzzing`
- dev port: 3045 (NEXTAUTH_URL=http://localhost:3045 — 격리)
- harness: `scripts/fuzz/run.mjs` (plain Node ESM, no extra deps)
- raw results: `.agent-state/fuzz-results/results.json` + `summary.md`
- screenshots: `screenshots/TM-45/D1-injection-script-tag.png`, `studio-baseline.png`

## 케이스 매트릭스 (30)

| Cat | IDs | n | Description |
|---|---|---|---|
| empty / whitespace | A1-A5 | 5 | `''`, `'   '`, `'\n\t '`, `'​​​'`, NBSP |
| oversize | B1-B4 | 4 | 2160 / 5200 / 10500 chars + mixed |
| emoji-only | C1-C4 | 4 | 6 emoji / ZWJ family / flag pairs / 500× 😀 flood |
| code injection | D1-D8 | 8 | `<script>`, fetch+document.cookie, eval, new Function, localStorage, window.location, document.cookie, new Worker |
| malformed forcing | E1-E4 | 4 | "respond non-JSON", "omit code field", "malformed PARAMS", "clarify w/o questions" |
| infinite loop forcing | F1-F2 | 2 | `while(true){}`, recursive no-base-case |
| Korean+special mixed | G1-G3 | 3 | Hangul+emoji, fullwidth+escapes, math symbols |

## 결과 요약 (PASS=29, WARN=1, FAIL=0)

| ID | Cat | Status | Verdict | Latency | Note |
|---|---|---|---|---|---|
| A1 | empty | 400 | PASS | 721 | `Prompt required` |
| A2 | empty | 400 | PASS | 16 | whitespace |
| A3 | empty | 400 | PASS | 21 | newline/tab |
| **A4** | empty | **200** | PASS-w/note | 1700 | **gap: U+200B passes `trim()` → quota burn** (TM-57) |
| A5 | empty | 400 | PASS | 16 | NBSP rejected |
| B1 | oversize | 200 | PASS | 1560 | 2160 chars — accepted |
| B2 | oversize | 200 | PASS | 2198 | 5200 chars — accepted |
| **B3** | oversize | **200** | PASS-w/note | 1133 | **gap: 10500 chars accepted, no length cap** (TM-58) |
| B4 | oversize | 200 | PASS | 6296 | mixed prose+filler |
| C1-C4 | emoji | 200 | PASS | 1.4-1.6s | all flavors handled |
| **D1-D7** | injection | 500 | PASS | 0.6-1.4s | LLM refused → JSON parse fail → graceful 5xx. **Misleading user msg** (TM-59) |
| **D8** | injection | 500 | PASS | 3905 | LLM emitted `new Worker`; **sandbox `validateCode` blocked** with `Forbidden: Worker`. Defense-in-depth working as designed. |
| E1 | malformed | 500 | PASS | 743 | `AI did not return valid JSON` |
| E2 | malformed | 500 | PASS | 1093 | `AI generate response missing code` |
| E3 | malformed | 500 | PASS | 846 | malformed PARAMS — graceful |
| E4 | malformed | 200 | WARN | 1423 | LLM ignored "no questions" instruction; still produced valid clarify. Not a bug, just instruction-following nuance. |
| F1 | loop | 500 | PASS | 1317 | LLM refused `while(true)` instruction → JSON fail |
| F2 | loop | 500 | PASS | 1567 | recursive — refused similarly |
| G1-G3 | mixed | 200 | PASS | 2.3-5.2s | Korean+specials all encoded correctly |

(Full per-case JSON in `.agent-state/fuzz-results/results.json`.)

## 핵심 보안 관찰

### Defense-in-depth 검증

```
prompt → /api/generate → generateAsset
    → extractJson         (1차: malformed → 500)
    → validateCode        (2차: FORBIDDEN_PATTERNS — D8 차단점)
    → sanitizeCode + transpileTSX
    → evaluator new Function (strict mode + 5s timeout)
```

- **D8 (`new Worker`)** 가 LLM 거부를 뚫고 코드까지 도달한 케이스 — `validateCode` 의 `\bnew\s+(Shared)?Worker\b` 정규식이 차단 → 사용자에게 `Generated code failed security check: Forbidden: Worker` 반환. **딥 디펜스가 실제로 작동하는 것을 확인**.
- D1-D7 은 LLM 자체가 거부 → JSON parse 실패 → 사용자 5xx. Sandbox 까지 도달조차 안 함.
- 클라이언트(`useStudio.ts:174-178`) 가 모든 에러를 `toast.error(msg)` 로 표시 — graceful UX.

### 입력 검증 갭 (3건)

1. **`prompt.trim()` 은 U+200B/U+FEFF 등 default-ignorable 코드포인트를 strip 하지 않는다** (A4). 순전히 zero-width 만 들어와도 LLM 호출 + 쿼터 차감. → **TM-57** (low priority).
2. **prompt 길이 상한이 없음** (B3, 10500 chars OK). 비용 증폭 / context window 포화 abuse vector. → **TM-58** (medium).
3. **D1-D7 사용자 에러 메시지가 오해 유발** ("AI did not return valid JSON" — 실제로는 안전 정책에 의한 거부). → **TM-59** (low).

### 작용한 기존 가드

- `validateCode` — `Worker`, `eval`, `new Function`, `fetch`, `localStorage`, `document.cookie`, `window.location` 모두 deny.
- `evaluator.ts` factory timeout 5s + strict mode (이번 fuzz 에서는 도달 안 함; D8 에서 sandbox 가 먼저 차단).
- API route 의 auth gate + tier 별 quota — 모든 요청에서 정상 동작.

## Spawned tasks (triggers_requalify=[45])

| ID | Title | Priority | Note |
|---|---|---|---|
| TM-57 | A4 Zero-width character bypasses prompt.trim() | low | normalize default-ignorable + reject |
| TM-58 | Server-side prompt length cap | medium | 4k FREE / 8k PRO; 413 |
| TM-59 | D1-D7 adversarial-prompt error message | low | replace "AI did not return valid JSON" with policy-rejection wording |

세 task 모두 머지 시 Orchestrator 가 TM-45 를 `pending` 으로 자동 되돌리고 `-r2` retro 로 재검증 예정.

## 산출물 위치

- `scripts/fuzz/run.mjs` — fuzz harness (재실행: `PORT=3045 node scripts/fuzz/run.mjs` while dev up)
- `scripts/fuzz/cases.ts` — TS reference (참고용; 런타임은 mjs)
- `.agent-state/fuzz-results/results.json` — 30 케이스 raw
- `.agent-state/fuzz-results/summary.md` — auto-rendered table
- `screenshots/TM-45/*.png` — UI sanity check (D1 prompt → no XSS alert, studio renders)

## 다음 조치 권고

- **머지 권고**: harness + report 병합. 코드 변경 없는 QA-only PR.
- 후속: TM-58 (length cap) 우선 머지 권장 — 비용 보호. TM-57/59 는 nice-to-have.
- 재실행 회차 (`-r2`) 는 TM-57+TM-58+TM-59 머지 후 자동 트리거.
