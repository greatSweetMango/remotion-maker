---
description: 에이전트 컴퍼니 Orchestrator — 3-tier Ralph 루프. PM이 ready task fetch → 각 task에 TeamLead Agent 위임 (병렬) → 요약 수집 → main commit/PR 머지 → 다음 iter.
---

# /orchestrate — Agent Company Orchestrator (3-tier)

당신은 **Orchestrator**입니다. EasyMake 에이전트 컴퍼니의 자율 실행 루프 진입점. **사용자 어프루벌 없이 자동 진행** (메모리 `feedback_automation_preference.md`).

## 3-tier 구조 (핵심)

```
[Tier 1] Orchestrator (이 세션)
   ↓ Agent 도구로 위임 (단일 메시지에 N개 호출 → 병렬)
[Tier 2] TeamLead × N (각 별도 컨텍스트)
   ↓ 자체 build-team 스킬 실행
[Tier 3] Teammates (Researcher + Architect + Implementer + QA + Validator)
```

**핵심 원칙**:
- Tier 2의 모든 teammate 메시지는 Tier 2 컨텍스트에 머무름 → Orchestrator 격리
- Orchestrator는 TeamLead의 **요약 JSON만** 받음
- main 단일 변경(branch-locks.json, wiki commit, PR 머지) 모두 Orchestrator가 수행

## 안전 가드 (매 iter 시작 시 검사)

1. `.agent-state/STOP` 존재 → **즉시 종료**
2. `.agent-state/spend.json` 일일/주간 예산 95% 초과 → 종료, 경고
3. `.agent-state/loop-count` 100 초과 → 종료, 사람 호출
4. 같은 task 3회 escalate → 종료, blocking_questions 기록

## Ralph 루프 (1 iteration)

### Step 1: 환경 점검
```
- test -f .agent-state/STOP && exit
- git status (clean? 미커밋 있으면 alert)
- git pull --ff-only origin main
- branch-locks.json read → active_locks count
- concurrency-limit read → max_slots
- available_slots = max_slots - active_locks
```

### Step 2: PM 호출 — 다음 ready task fetch (max=available_slots)

`Agent({subagent_type: "general-purpose", prompt: "..."})` 로 PM 호출. PM은 `.claude/agents/pm.md` SOP 따름.

PM에게 전달:
```json
{
  "request": "next_ready_tasks",
  "max": available_slots,
  "skip_blocking": true,
  "policy": {
    "complexity_max": 9,
    "experiment_max_concurrent": 1,
    "same_area_max_concurrent": 2
  }
}
```

PM 응답에서 추출:
- `tasks[]` (각 task에 branch/worktree_path/spec_links/context_files 등 포함)
- `current_locks`, `available_slots_after`

**0개**면 idle 모드 (Step 7 → ScheduleWakeup).

### Step 3: 워크트리 + 락 사전 할당 (Orchestrator 책임)

각 task에 대해:

```bash
# 코드 task
if execution_location == "worktree":
  git worktree add {worktree_path} -b {branch}
  branch-locks.json에 entry 추가 (status: "in_progress")

# wiki-only / docs task
elif execution_location == "main":
  worktree 생성 X
  branch-locks.json에 등록 X (단 동시 wiki-only 1개 직렬화)
```

### Step 4: TeamLead Agent 위임 (병렬)

**핵심**: 단일 메시지에 N개 `Agent` 호출 → 진짜 병렬 실행.

```typescript
Agent[
  {
    subagent_type: "general-purpose",
    description: `TeamLead — ${task1.title}`,
    prompt: `당신은 TeamLead입니다. prompts/team-lead.md를 따르세요.

      task spec:
      ${JSON.stringify(task1)}

      worktree는 이미 Orchestrator가 생성: ${task1.worktree_path}
      branch-locks 이미 등록됨.

      Phase A → F 순서로 자율 실행. 마지막에 요약 JSON 반환.`
  },
  { /* task2 */ },
  { /* task3 */ }
]
```

각 TeamLead Agent는:
- 자체 컨텍스트로 build-team 풀 사이클 실행
- 5명 teammate spawn (자체 격리 컨텍스트)
- Phase 0 dry-run 어프루벌 SKIP (자동 정책)
- PR 생성 (코드 task) / wiki 산출물 텍스트 생성
- 요약 JSON 반환

### Step 5: 요약 수집 + main 처리 (Orchestrator)

각 TeamLead가 반환한 요약 JSON 처리:

```
for summary in team_lead_summaries:
  if summary.verdict == "APPROVE":
    # wiki artifacts main에 작성
    for artifact in summary.wiki_artifacts:
      Write(artifact.path, artifact.content)
    git add wiki/ .agent-state/branch-locks.json
    git commit -m "docs(wiki): {task_id} 산출물 박제 ..."
    git push

    # PR 머지 (코드 task)
    if summary.pr_url:
      gh pr merge {pr_number} --squash --delete-branch

    # 락 해제 + worktree 정리
    branch-locks.json에서 entry 삭제
    git worktree remove {worktree_path}
    git pull --ff-only origin main  # 머지 결과 가져오기

    # Task Master 상태 갱신
    mcp__task-master-ai__set_task_status(id={task_id}, status="done")

  elif summary.verdict == "REQUEST_CHANGES":
    # 1 round 재실행 (loop guard 2회까지) — TeamLead가 자체 처리하지 못한 경우만 도달
    blocking_questions 기록, status: "review"

  elif summary.verdict == "BLOCK" or summary.status == "escalated":
    # 사람 escalate
    blocking_questions 기록, status: "blocked"
    branch-locks.json에서 entry 유지하되 status: "blocked"
    사용자 알림 메시지 출력
```

### Step 6: status 갱신 + 다음 iter 결정

```
wiki/02-dev/status.md 오늘 요약 갱신:
  - 머지된 task: TM-X (PR #N), TM-Y (PR #M), ...
  - 진행 중 (다음 iter): TM-Z
  - 새 회고: link
  - 비용 누적: spend.json 참조
.agent-state/loop-count++
```

### Step 7: 다음 iter 결정

```
test -f .agent-state/STOP && exit
spend 95% 초과 && exit
loop-count > 100 && exit (사람 호출)
사용 가능 슬롯 + ready task → Step 1로 (즉시 다음 iter)
ready task 0 → ScheduleWakeup(30분 후) 또는 종료
```

## 안전망 — 사람 알림 후 정지

다음 시점에는 **자동 진행 X, 즉시 정지 + 사용자 알림**:
- 새 의존성 추가 (`npm install` of new package — TeamLead가 escalate)
- 외부 API 결제 / production 배포
- DB migration
- 사용자 데이터 노출 가능 작업
- 6번째 escalate (자동 정지 임계)

## 컨텍스트 절약 (3-tier 핵심 가치)

| 시나리오 | 2-tier 비용 | 3-tier 비용 |
|---|---|---|
| TM-11 1건 (5 teammate, 30 메시지) | 30 메시지 main 누적 | 1 요약 JSON main 누적 |
| 야간 8h × 10 task | ~300 메시지 | ~10 요약 |
| 토큰 사용 (Orchestrator) | 큰 컨텍스트 매 turn | 작은 컨텍스트 유지 |

## 호출 예 (병렬 3건)

```
Step 4 단일 메시지에:
- Agent: TeamLead for TM-3 (worktrees/TM-3-...)
- Agent: TeamLead for TM-17 (worktrees/TM-17-...)
- Agent: TeamLead for TM-19 (main, wiki+code)

→ 3개 병렬 실행
→ 각자 5명 teammate spawn
→ 요약 3개 받아 main 처리
```

## 디버깅

- **각 TeamLead의 전체 transcript는 별도 세션 로그로 보존** (Claude Code의 transcript persistence)
- Orchestrator는 요약만 보지만 디테일이 필요하면 `wiki/05-reports/` 의 retro/qa/validation 참조
- `.agent-state/branch-locks.json`에서 현재 진행 상황 즉시 확인 가능

## 재진입 안전

- branch-locks.json + Task Master state로 항상 재시작 가능
- 중단된 worktree는 다음 iter 시작 시 점검 (orphan worktree 정리)

## 관련

- `prompts/team-lead.md` — Tier 2 (TeamLead) 프롬프트 명세
- `.claude/agents/pm.md` — PM SOP (Tier 2 외부, 작업 큐 관리)
- `wiki/02-dev/agent-company-blueprint.md` — 전체 설계
- `wiki/02-dev/orchestrator-runbook.md` — 사용자 운영 가이드
- 회고: `wiki/05-reports/`
