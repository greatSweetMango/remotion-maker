---
title: "ADR-0035: 머지 전 Hard CI 게이트 + chronically-red allowlist"
created: 2026-06-05
updated: 2026-06-05
tags: [decision, area/infra, area/agent-company, orchestrator-v2]
status: accepted
---

# ADR-0035: 머지 전 Hard CI 게이트 + chronically-red allowlist

## 컨텍스트

에이전트 컴퍼니의 자율 머지 루프(`orchestrate.md` Step 5)는 TeamLead 가 `APPROVE`
요약을 반환하면 곧바로 `gh pr merge --squash` 를 수행했다. 즉 **CI 의 green 여부와
무관하게** PR 이 main 에 들어갔다. APPROVE 는 TeamLead 의 코드-품질 판단일 뿐 CI 의
객관적 상태가 아니므로, red CI 가 그대로 main 에 진입하는 회귀가 가능했다.

단순히 "모든 체크가 green 이어야 머지" 라는 전면 게이트를 걸면 **머지 파이프라인이
마비**된다. 현재 `Lint — circular dependencies` 체크가 수 주째 red 다 — `depcruise`
(dependency-cruiser) 바이너리가 CI 에 설치되지 않아 **exit 127** 로 죽는다. 이건 코드
결함이 아니라 CI 인프라 결함인데, 전면 게이트면 이 한 체크 때문에 정상 PR 까지 전부
머지 불가가 된다(자기-차단 포함 — 본 ADR 의 PR 자신도 같은 게이트를 통과해야 한다).

## 결정

`scripts/orchestrator/ci-gate.sh <pr_number>` 를 신설하고, `orchestrate.md` Step 5
APPROVE 분기에서 **`gh pr merge` 직전에만** 호출한다. 게이트는 red 체크를 두 부류로
나눈다:

- **known-broken (allowlisted)** — 머지를 차단하지 않는다(로그만).
- **그 외 red 또는 미완료 pending** — 머지 차단(`exit 20`).

수용 규칙:

- 모든 체크 green/skipped → `exit 0` (`decision: green`).
- red 가 allowlist(예: `Lint — circular dependencies`)뿐 → `exit 0`
  (`decision: known-red-only`). **머지 허용** — 자기-차단 방지의 핵심.
- allowlist 밖 red 가 하나라도 있음 → `exit 20` (`decision: red`). 머지 보류 +
  task `blocked` escalate + 사유 transcript.
- pending 은 bounded wait(`CI_GATE_MAX_WAIT`, 기본 180s, 600 cap) 후 재평가;
  예산 소진 후에도 pending 이면 blocking 으로 간주(미완료 CI 위에 머지 금지).

### allowlist 관리 (하드코딩 최소화)

우선순위로 합집합:

1. 빌트인 기본값 — `Lint — circular dependencies` (파일이 없어도 안전하도록 코드에
   1개만 박음).
2. 파일 — `scripts/orchestrator/ci-gate-allowlist.txt` (substring per line, `#` 주석).
3. env — `CI_GATE_KNOWN_RED` (콤마/개행 구분). 파일에 **추가**된다(대체 아님).

체크 이름에 allowlist 항목이 **substring** 으로 포함되면 allowlisted.

### chronically-red 감지 (best-effort)

매 실행마다 red 체크를 `.agent-state/ci-gate-red-history.jsonl` 에 append. 동일 체크가
최근 `CI_GATE_CHRONIC_K`(기본 3)개 이상의 distinct PR 에서 red 면 stderr 에 "allowlist
candidate" 경고를 찍는다. **로깅 전용** — 자동 allowlist 도, exit code 변경도 하지 않는다
(사람/ADR 이 승격 판단).

## 대안 / 기각

- **전면 green 게이트** — 머지 마비 + 자기-차단. 기각.
- **CI 인프라(depcruise) 즉시 수정** — 본 task 범위 밖. allowlist 로 우회만 하고 실제
  수정은 별도 spawned task 로 분리(`Lint — circular dependencies` exit 127).
- **APPROVE 신뢰(현행 유지)** — red CI 회귀를 막지 못함. 기각.

## 결과

- additive 가드: green/known-red-only PR 은 게이트 도입 전과 **정확히 동일**하게(exit 0)
  머지된다. STOP/stop-guard 등 기존 안전 가드는 일절 약화되지 않고 머지 경로만 더
  엄격해진다.
- 새 npm 의존성 0 — `gh` + `bash` + `jq` 만 사용.
- 테스트: `scripts/tests/test-ci-gate.sh` — mock `gh pr checks`(`CI_GATE_CHECKS_CMD`)로
  green/skip/allowlisted-red/real-red/혼합/pending-timeout/state-fallback/env-override/
  usage/chronic-detection 13 케이스 검증.

## 잔여 / 후속

- spawned task: `Lint — circular dependencies` exit 127 (depcruise 미설치) 실제 CI 수정.
  머지되어 체크가 green 이 되면 allowlist 에서 해당 항목 제거.

## See also

- `scripts/orchestrator/ci-gate.sh`, `scripts/orchestrator/ci-gate-allowlist.txt`
- `.claude/commands/orchestrate.md` Step 5 (APPROVE 분기, `gh pr merge` 직전)
- ADR-0031 (preflight guardrail) — 본 게이트의 *입력* 가드 대응(여기는 *출력*/머지 가드).
