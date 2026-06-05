---
title: "ADR-0032: tasks.json 단일-writer 직렬화"
created: 2026-06-05
updated: 2026-06-05
tags: [decision, area/infra, area/agent-company]
status: accepted
---

# ADR-0032: tasks.json 단일-writer 직렬화

## 컨텍스트

`.taskmaster/tasks/tasks.json` 은 에이전트 컴퍼니 파이프라인의 canonical task DB 다. 이 세션에서 실제로 **raw `python` write 와 `task-master` MCP write 가 직렬화 없이 물려** 두 가지 손상이 동시에 발생했다:

1. **int/str id 혼동** — task-master 는 id 를 number 로 쓰고, 다른 경로(스크립트/수동)는 string 으로 비교/기록해 매칭이 깨졌다.
2. **lost-update race** — A 가 읽은 스냅샷에 append 하는 사이 B 도 같은 스냅샷에 append → 한쪽 쓰기가 통째로 유실. 결과적으로 "tasks.json 손상" 이라는 **가짜 신호**가 떴다 (파일 자체는 valid JSON 이지만 내용이 유실됨).

이미 `.agent-state/branch-locks.json` 은 동일한 race(TM-55/TM-85 의 PR-중복) 때문에 `scripts/lib/branch-locks.sh` 의 flock/mkdir mutex 로 보호되고 있었다. tasks.json 만 보호 없이 다중 writer 에 노출돼 있었다.

## 결정

**tasks.json 의 모든 read-modify-write 를 단일 직렬 writer 로 강제한다.**

- 신규 `scripts/lib/task-queue.sh` — `branch-locks.sh` 의 mutex 패턴(flock 우선, mac/flock 부재 시 `mkdir` 원자적 폴백)을 그대로 재사용하되, **별도 lock anchor** `.agent-state/.tasks.lock` / `.tasks.mutex.d` 를 쓴다. branch-locks mutex 와 독립이라 동시 보유해도 deadlock 없음 (기존 동작 비회귀, additive).
- 공개 함수: `task_queue_set_status <id> <status>`, `task_queue_append_task <json>`, `task_queue_with_lock <cmd...>`. CLI 디스패처도 제공(`bash scripts/lib/task-queue.sh set-status 209 done`).
- **id 는 항상 문자열로 정규화** — 쓰기 직전 `.id |= tostring` 을 강제 적용해 int/str 혼동을 단일 chokepoint 에서 제거한다. `set-status` 는 `TM-209` 와 `209` 둘 다 받아 bare-string 으로 정규화 매칭.
- tagged-format 인지 — `.taskmaster/state.json` 의 `currentTag` → `master` → 단일 태그 키 → legacy 무태그 `.tasks` 순으로 활성 태그 해석.
- tasks.json 을 직접 만지던 경로(`scripts/orchestrator/promote-spawned.sh`)를 이 mutex 경유로 전환. promote 의 `task-master add-task` 배치 전체를 `task_queue_with_lock` 하에 실행 → 다른 writer 와 상호 배제 + mac 에서 누락돼 있던 락(이전엔 flock 없으면 무락으로 add-task 실행)을 mkdir 폴백으로 메움.

## 역할 규약

- **TeamLead 는 tasks.json 을 직접 write 금지.** 상태/spawned 는 Phase F 요약 JSON 으로만 반환하고, Orchestrator 가 머지 직후 단일 직렬화 지점에서 적용한다 (`prompts/team-lead.md` TM-209 절, `.claude/commands/orchestrate.md` Step 5 주석).
- Orchestrator(canonical main) 만 tasks.json writer. task-master MCP 또는 task-queue.sh 경유, 직접 `jq | mv` 금지.

## 결과

- 동시 append/set-status 시뮬레이션(병렬 20)에서 유실 0, 최종 tasks.json valid JSON, id 전부 문자열 (`scripts/tests/test-task-queue.sh`).
- `with-lock` 가 raw read-modify-write 와 `append-task` 를 상호 배제함을 회귀 테스트로 검증.
- `promote-spawned.sh` 기존 기능 비회귀(`scripts/tests/test-promote-spawned.sh` green).

## 대안 (기각)

- **flock 단독** — mac 에 flock 부재. branch-locks 선례대로 mkdir 폴백 필수.
- **branch-locks lock 재사용(같은 anchor)** — 의미상 다른 자원이고 동시 보유 시 불필요한 contention/deadlock 위험. 별 anchor 채택.
- **새 npm 의존성(예: proper-lockfile)** — 순수 bash/jq 제약. 기각.

## See also

- `scripts/lib/branch-locks.sh` — 동일 mutex 패턴의 원형
- ADR-0012 (adr-number-collision-avoidance) — 유사한 병렬-writer 직렬화 결정
