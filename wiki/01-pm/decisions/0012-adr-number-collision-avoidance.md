---
title: "ADR-0012: ADR 번호 충돌 회피 — Orchestrator 단독 NNNN 부여"
created: 2026-04-26
updated: 2026-04-26
tags: [meta, decision, infra, agent-company]
status: accepted
---

# ADR-0012: ADR 번호 충돌 회피 — Orchestrator 단독 NNNN 부여

병렬로 실행되는 TeamLead들이 ADR 번호(`NNNN`)를 각자 부여하면 동시 commit 시 충돌이 발생한다. **번호 부여 책임을 Orchestrator로 단일화**하고, TeamLead는 placeholder만 사용한다.

## 배경 (TM-36)

3-tier Ralph 루프는 한 iteration에 N개 TeamLead가 병렬로 build-team을 돌린다. 각 TeamLead는 자체 컨텍스트에서 ADR을 작성하므로 main의 `wiki/01-pm/decisions/`를 동시에 보고 같은 다음 번호(`max+1`)를 선택할 수 있다. Orchestrator가 main에 일괄 commit하는 시점에서야 충돌이 드러나면:

- 파일명 동일 → 한쪽이 다른 쪽을 덮어씀
- 본문 내 self-reference (`ADR-NNNN: ...`) 도 깨짐
- ADR 인덱스(`README.md`) 갱신도 race

## 결정

ADR 번호는 **commit 직전 단일 직렬화 지점인 Orchestrator만 부여**한다.

- **TeamLead 책임**: placeholder 형식 사용
  - 파일 path: `wiki/01-pm/decisions/PENDING-<task_id>-<slug>.md`
  - 본문 self-ref 토큰: `ADR-PENDING-<task_id>` (제목, cross-ref, retro/qa 본문 등 모든 위치 동일 토큰)
- **Orchestrator 책임** (`.claude/commands/orchestrate.md` Step 5-pre):
  1. 현재 `wiki/01-pm/decisions/`에서 최대 NNNN 스캔.
  2. 본 iter의 APPROVE summary들 중 PENDING ADR을 task_id 오름차순 정렬.
  3. `max+1, max+2, ...` 순차 부여, path rename, 모든 산출물 본문에서 token 일괄 치환.
  4. ADR 인덱스(`README.md`) 자동 갱신.
  5. push fast-forward 실패 시 → rebase 후 max_nnnn 재산정 후 재 commit (2회 실패 escalate).

## 대안과 거부 이유

- **TeamLead가 timestamp 기반 임시 ID 사용 후 Orchestrator가 rename**: placeholder와 동등한 효과지만 timestamp는 결정적이지 않아 디버깅 시 트레이스가 어렵다. `task_id`는 로그/PR과 1:1 매핑되므로 placeholder 키로 더 적합.
- **Filesystem-level 락**: 주 대상은 main repo 내 파일이고 TeamLead들이 서로 다른 worktree에 있어 OS 락이 어렵다. 또한 락 경합이 실제 직렬화로 이어지지 않는다(각 worktree의 wiki는 서로 다른 파일).
- **TeamLead가 직접 main에 push**: 주 ownership 모델 위반(`wiki = main 단독 owner`).

## 결과

- `prompts/team-lead.md` Phase F: ADR 작성 시 placeholder 형식 강제.
- `.claude/commands/orchestrate.md` Step 5-pre: 알고리즘 박제.
- `.claude/agents/pm.md` 산출물 컨벤션: 동일 안내.
- `wiki/CLAUDE.md` §8: Architect 행에 placeholder 명시.
- 사람이 외부에서 직접 작성하는 ADR(에이전트 컴퍼니 밖)은 기존대로 `<NNNN>-<slug>.md` 직접 부여 가능.

## 관련

- [[../../02-dev/agent-company-blueprint|Blueprint]]
- 이전 회고: `wiki/05-reports/` (Phase 1 dry-run)
