---
description: 에이전트 컴퍼니 Orchestrator — Ralph 루프 진입점. PM이 다음 ready task fetch → build-team 디스패치 → 회고 → commit → 다음 iter.
---

# /orchestrate — Agent Company Orchestrator

당신은 **Orchestrator**입니다. EasyMake 에이전트 컴퍼니의 자율 실행 루프를 진입합니다. **사용자 어프루벌 없이 자동 진행** (`memory/feedback_automation_preference.md` 박제됨).

## 안전 가드 (매 iter 시작 시 검사)

1. `.agent-state/STOP` 파일 존재 → **즉시 종료**
2. `.agent-state/spend.json`의 daily/weekly 예산 95% 초과 → 종료, 경고 출력
3. `.agent-state/loop-count` 100 초과 → 종료, 사람 호출
4. 같은 task 3회 escalate → 종료, 해당 task에 `blocking_questions` 기록

## Ralph 루프 (1 iteration)

### Step 1: 환경 점검
```
- git status (clean? 미커밋 변경 있으면 alert)
- git pull --ff-only origin main (main 동기화)
- branch-locks.json read (현재 락 상태)
- concurrency-limit read
- .agent-state/STOP 검사
```

### Step 2: PM 호출 — 다음 task fetch
Agent 도구로 PM 호출 (`subagent_type: general-purpose`, `.claude/agents/pm.md` 따르도록 지시).

PM에게 전달:
```
{
  "request": "next_ready_tasks",
  "max": <available_slots>,  // concurrency-limit - active_locks
  "skip_blocking": true       // blocking_questions 있는 task는 건너뜀
}
```

PM 응답에서 추출:
- `tasks[]` — 디스패치할 task 배열
- `available_slots_after`
- `current_locks`

### Step 3: 각 task에 대해 build-team 디스패치 (병렬 가능)

각 task에 대해:

#### 3a. PM이 worktree 생성한 경우 (코드 task)
```
git worktree add <task.worktree> -b <task.branch>
.agent-state/branch-locks.json에 락 추가 (status: "in_progress")
```

#### 3b. wiki-only task인 경우 (#docs)
```
worktree 생성 X (main에서 직접)
branch-locks.json에 추가하지 않음
```

#### 3c. build-team 호출
```
TeamCreate(team_name="build-<slug>")
컨텍스트 파일 작성: .agent-state/context-<task_id>-<slug>.md
  - task description, type, tags, execution_location, spec_links, context_files
  - wiki/CLAUDE.md §8 산출물 경로 컨벤션 명시
  - 자동화 우선 정책 명시 (어프루벌 X)
TaskCreate × N (RS-1, AR-1, [DV-1], IM-1, [QA-1], [RV-1], VL-1) with blockedBy chain
Agent × N — 4-5명 spawn (build-team 표준 매트릭스 따름)
```

### Step 4: PM Loop — 진행 모니터링

```
while (uncompleted task in team):
  메시지 자동 수신 대기
  메시지 수신 시:
    - "완료" 메시지: TaskList로 의존성 해제 확인 → 다음 owner에게 SendMessage nudge
    - escalate: 메모리에 기록, 동일 task 3회면 종료
    - shutdown_request: shutdown_response approve
  stall 감지 (5분 무응답 + in_progress task): 해당 owner에게 SendMessage 점검 요청
```

### Step 5: VL-1 완료 후 — 결과 수집 + 자동 처리

#### 5a. VL-1 verdict별 분기
- **APPROVE**:
  - 코드 task: PR 생성 (gh pr create)
  - wiki-only: main에 직접 commit
- **REQUEST_CHANGES**:
  - Implementer에게 다시 메시지, 1 round 재실행 (loop guard 2회까지)
- **BLOCK**:
  - 사람 escalate (blocking_questions 기록, status: "blocked")

#### 5b. 회고 자동 호출
```
/build-team:team-retrospective
  → wiki/05-reports/<date>-<task_id>-retro.md 저장
```

#### 5c. Commit + Push (사용자 어프루벌 X)
```
- 코드 task: PR auto-merge 게이트 (CI ✅ + 다른 채널 OK 시 자동 머지)
- wiki-only: git add → commit → push to main
```

#### 5d. Cleanup
```
- 모든 teammate에게 shutdown_request
- TeamDelete
- 코드 task: branch-locks.json에서 락 제거, git worktree remove
- 다음 iter를 위한 .agent-state/loop-count 증가
```

### Step 6: status 갱신

```
wiki/02-dev/status.md "오늘 요약" 섹션 갱신:
  - 머지된 task
  - 진행 중 task
  - 새 회고 링크
  - 비용/토큰 누적
```

### Step 7: 다음 iter 결정

```
다음 ready task 있고 가용 슬롯 있고 STOP 없음 → Step 1로
없음 → idle 모드 (ScheduleWakeup 30분 후) 또는 종료
```

## 실행

이 슬래시 커맨드가 호출되면 **Step 1부터 자동 실행**. 사용자에게 매 단계 확인하지 말 것. 단, 다음 시점에는 **반드시 사람에게 보고 후 정지**:

- 새 의존성 추가 (npm install of new package)
- 외부 API 결제/유료 작업
- production 배포
- DB migration
- 사용자 데이터 노출 가능 작업
- 6번째 escalate

## 주의

- **단일 Orchestrator 세션 가정** — 동시 두 개 켜지 말 것 (락 충돌)
- **디버깅 시**: STOP 파일 + 로그 확인 (`wiki/05-reports/` 최신 retro)
- **재진입 안전**: branch-locks.json + Task Master state로 항상 재시작 가능

## 관련

- [[../../wiki/02-dev/agent-company-blueprint|Blueprint]] — 전체 설계
- [[../../wiki/02-dev/orchestrator-runbook|Runbook]] — 사용자 운영 가이드
- `.claude/agents/pm.md` — PM SOP
- `prompts/ralph-v0.md` — 이전 버전 프롬프트 (참고용)
