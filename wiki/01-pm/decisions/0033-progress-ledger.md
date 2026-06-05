---
title: "ADR-0033: Magentic-One progress ledger + phase_loop stall detector"
created: 2026-06-05
updated: 2026-06-05
tags: [decision, area/infra, area/agent-company, orchestrator-v2]
status: accepted
---

# ADR-0033: Magentic-One progress ledger + phase_loop stall detector

## 컨텍스트

에이전트 컴퍼니의 안전 가드는 지금까지 **post-hoc** 신호에 의존했다. `stop-guard.mjs`(TM-101)의 `error_rate_spike` 는 TeamLead 가 **요약을 반환한 뒤**에야 `verdict-history.jsonl` 에 기록되는 verdict 를 본다. 즉, TeamLead 가 한 task 안에서 같은 Phase 를 헛돌며(build-team 재시도, push 실패 루프 등) 시간/토큰을 태우는 동안에는 **in-flight 가시성이 0** 이었다. 막힌 task 는 verdict 가 나올 때까지(또는 stale-lock 6h 임계까지) 감지되지 않았다.

Microsoft 의 **Magentic-One** orchestrator 는 이 문제를 *progress ledger* 로 푼다 — 매 스텝마다 "진전이 있었나 / 같은 루프에 빠졌나 / 목표가 충족됐나 / 다음 동작은 무엇인가" 를 1줄로 적고, 정체가 감지되면 plan 을 리셋·재작성한다. 본 task 는 그 패턴을 우리 3-tier Ralph 루프에 이식한다.

제약: 안전 가드 자기수정이므로 **기존 5개 STOP 신호(quality_plateau / error_rate_spike / worktree_leak / stale_lock / cost_burst)의 임계·동작을 절대 약화하지 않는다.** 신규 신호는 순수 additive 여야 하고, 새 npm 의존성·render 비용 없이 bash/jq + 기존 node 만 쓴다 (mac flock 부재 → mkdir 폴백).

## 결정

**TeamLead 가 매 Phase 종료 시 progress-ledger 1줄을 append 하고, `stop-guard.mjs` 에 in-flight stall 을 잡는 additive 신호 `phase_loop` 를 추가한다.**

1. **`scripts/orchestrator/append-progress.sh`** (신규) — `append-verdict.sh`(TM-113)를 미러한 직렬화 appender. `.agent-state/progress-ledger.jsonl` 에 `{ts,task_id,phase,progress_made,in_loop,satisfied,next_action}` JSONL 1줄을 append 한다. 동시성은 `task-queue.sh`/`branch-locks.sh` 와 동일한 mutex 전략 — flock(1) 우선, mac/flock 부재 시 `.agent-state/progress-ledger.lock.d` 에 대한 `mkdir` 원자적 폴백 — 으로 병렬 TeamLead 의 동시 append 를 직렬화한다 (lost-write 0, 별도 lock anchor 라 기존 mutex 와 무경합). free-text(`phase`,`next_action`)는 backslash/quote/control 문자를 JSON-escape 한다. bool 3개는 0|1 만 허용(validation).

2. **`stop-guard.mjs` 신호 6 `phase_loop`** (신규, additive) — `progress-ledger.jsonl` 을 task_id 별로 그룹핑하고, 각 task 를 **newest-first** 로 훑어 선행하는 `progress_made=0` 연속 run 을 센다. 임의의 task 에서 run 이 `STOP_PHASE_LOOP_CONSEC`(기본 2) 이상이면 발화. `runChecks()` 배열 끝에 `checkPhaseLoop(stateDir)` 를 추가했을 뿐, 기존 5신호의 코드/임계/플러밍은 불변. 파일 부재·malformed 라인은 조용히 skip(back-compat).

3. **`prompts/team-lead.md`** — 각 Phase(A~F) 종료 시 emit 1줄 지시 + "정직하게 0 을 기록하라"(헛돌면 progress_made=0/in_loop=1) 가드. progress_made 를 습관적으로 1 로 박으면 stall 감지가 무력화되므로 명시.

4. **`.claude/commands/orchestrate.md` Step 7** — `phase_loop` **만** 떴을 때는 전역 STOP 대신 해당 task 만 **reset+replan**(branch-lock/worktree 회수 → `pending` 복귀 → `metadata.replan_count++` → progress-ledger 에 `REPLAN/progress_made=1` 1줄로 run 리셋)하여 다음 iter 재디스패치한다. `replan_count>=3` 이면 self-heal 포기 → blocked + STOP(사람 호출). `phase_loop` 외 다른 신호가 함께 떴으면 기존 일반 STOP 경로로 떨어진다. **Step 3 / Step 5 미접촉**(TM-207/TM-208 충돌 회피).

## phase_loop vs stale_lock — 왜 둘 다?

`stale_lock` 은 TeamLead 가 **크래시해 lock 을 6h 동안 방치**한 좀비를 잡는다(시간 기반, 사후). `phase_loop` 은 TeamLead 가 **살아서 헛도는** 경우를 **2 Phase 만에**(진전 기반, 거의 실시간) 잡고, 전역 STOP 이 아니라 그 task 만 재계획한다. 둘은 상보적이며 서로의 임계를 건드리지 않는다.

## 대안 (기각)

- **verdict-history 에 in-flight 행 추가** — verdict 스키마를 오염시키고 `error_rate_spike` 윈도우 계산을 흔든다(기존 신호 회귀 위험). 별도 ledger 가 안전.
- **TeamLead heartbeat 타임스탬프만** — "살아있음" 은 알아도 "진전" 은 모른다. Magentic-One 의 핵심은 progress 의 의미론적 판단(progress_made/in_loop)이다.
- **stale_lock 임계를 낮춰 재사용** — 살아있는 TeamLead 를 좀비로 오판하고, 안전 가드 임계 변경 금지 제약에 위배.

## 영향 / 비회귀

- `scripts/tests/test-stop-guard.sh` — 기존 8 케이스 + 신규 4 케이스(phase_loop 발화 / healthy 비발화 / 파일 부재 / per-task 격리) = **13 passed, 0 failed**. 기존 5신호 케이스 전부 그대로 통과.
- `append-progress.sh` — 40× 병렬 append 에서 lost-write 0, 전 라인 valid JSONL 확인. bool/ id validation 동작.
- 새 의존성 0, render-light, mac mkdir 폴백 검증(이 환경엔 flock 부재).

자세한 배경은 ADR-0033 참조.
