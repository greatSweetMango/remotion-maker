---
description: 3-tier 자율 에이전트 컴퍼니 Orchestrator. PM이 ready task fetch → 각 task에 TeamLead Agent 위임(병렬) → 요약 수집 → main 머지 → 다음 iter. 사용자 어프루벌 없이 진행.
---

# /orchestrate — Agent Company Orchestrator (3-tier Ralph loop)

당신은 **Orchestrator**입니다. 본 세션은 Tier 1 — 위임만 하고, 코드/문서 변경은 Tier 2/3가 worktree 안에서 수행. main은 PR 머지로만 진입.

## 3-tier 구조

```
[Tier 1] Orchestrator (이 세션)
   ↓ Agent 도구로 위임 (단일 메시지에 N개 호출 → 병렬)
[Tier 2] TeamLead × N (각 별도 컨텍스트)
   ↓ build-team 스킬 / 자체 phase
[Tier 3] Teammates (Researcher + Architect + Implementer + QA + Validator 등)
```

**원칙**:
- Tier 2의 모든 teammate 메시지는 Tier 2 컨텍스트에 머무름 → Orchestrator 격리
- Orchestrator는 TeamLead의 **요약 JSON만** 받음
- 모든 변경은 worktree → PR → squash merge

## 실행 모드 (argv 파싱) — Step 0

`/orchestrate` 호출 시 인자(`$ARGUMENTS`)를 파싱하여 루프 동작을 결정한다. **루프 진입 전 1회만**.

| 인자 | mode | 동작 |
|---|---|---|
| (없음) | `continuous` | 연속 모드 — STOP/예산/loop-count/ready 고갈까지 무한 |
| `--once` | `once` | 1 task 처리 후 종료 |
| `--max=N` (N≥1) | `max_n` | N개 task 처리 후 종료 |
| `<TASK_ID>` (예: `TM-7`, `ISSUE-3`) | `forced` | 우선순위/ready 무시하고 해당 task 1건만 강제 실행 |

**파싱 규칙**:

```
args = ($ARGUMENTS).trim().split(/\s+/).filter(Boolean)
mode = "continuous"; forced_task_id = null; max_count = null

for a in args:
  if a == "--once": mode = "once"
  elif a.startsWith("--max="):
    n = parseInt(a.slice(6)); assert n >= 1
    mode = "max_n"; max_count = n
  elif /^[A-Z]+-\d+$/.test(a):
    mode = "forced"; forced_task_id = a
  else: error("unknown arg: " + a)

# 우선순위: forced > once > max_n > continuous
completed_count = 0
```

루프 시작 전 transcript에 모드 출력:
`[mode] continuous` / `[mode] once` / `[mode] max_n N=3` / `[mode] forced task=<id>`

## 안전 가드 (매 iter 시작 시 검사)

1. `.agent-state/STOP` 존재 → **즉시 종료**
2. `.agent-state/spend.json` daily/weekly 예산 95% 초과 → 종료
3. `.agent-state/loop-count` 100 초과 → 종료, 사람 호출
4. 같은 task 3회 escalate → 종료, blocking_questions 기록

## Ralph 루프 (1 iteration)

### Step 1: 환경 점검

```
- test -f .agent-state/STOP && exit
- git status (clean? 미커밋 있으면 alert)
- git pull --ff-only origin <main_branch>
- branch-locks.json read → active_locks count
- concurrency-limit read → max_slots
- available_slots = max_slots - active_locks
```

### Step 2: PM 호출 — 다음 ready task fetch

`Agent({subagent_type: "general-purpose", prompt: "..."})` 로 PM 호출. PM 정의는 `agents/pm.md`.

**모드별 분기**:

- `mode == "forced"`: `get_specific_task` 요청. ready 검사 우회.
- `mode == "once"`: `max=1`로 캡.
- `mode == "max_n"`: `max=min(available_slots, max_count - completed_count)`.
- `mode == "continuous"`: `max=available_slots`.

PM에 전달(continuous/once/max_n):
```json
{
  "request": "next_ready_tasks",
  "max": effective_max,
  "skip_blocking": true,
  "policy": {
    "complexity_max": 9,
    "experiment_max_concurrent": 1,
    "same_area_max_concurrent": 2
  }
}
```

PM 응답에서 `tasks[]`, `current_locks`, `available_slots_after` 추출.

**0개**면:
- `mode == "forced"`: 에러 → 종료
- 그 외: idle (Step 7 → `ScheduleWakeup`)

### Step 3: 워크트리 + 락 사전 할당

각 task에 대해:

```bash
if execution_location == "worktree":
  git worktree add {worktree_path} -b {branch}
  # 프로젝트별 부트스트랩 훅 — .env 복사, DB seeding 등.
  # ${CLAUDE_PLUGIN_ROOT}/scripts/setup-worktree.sh 는 STUB.
  # 본 프로젝트 전용 부트스트랩은 다음 중 하나로 둠 (있으면 실행, 없으면 skip):
  #   1) ./scripts/agent-company-bootstrap.sh <worktree_path> [extra_args]
  #   2) PROJECT_BOOTSTRAP_HOOK 환경변수 경로
  if test -x ./scripts/agent-company-bootstrap.sh:
    bash ./scripts/agent-company-bootstrap.sh {worktree_path}
  elif test -n "$PROJECT_BOOTSTRAP_HOOK" && test -x "$PROJECT_BOOTSTRAP_HOOK":
    bash "$PROJECT_BOOTSTRAP_HOOK" {worktree_path}
  branch-locks.json에 entry 추가 (status: "in_progress")

elif execution_location == "main":
  worktree 생성 X (wiki-only/docs task)
  branch-locks.json에 등록 X (동시 wiki-only 1개 직렬화)
```

### Step 4: TeamLead Agent 위임 (병렬)

**핵심**: 단일 메시지에 N개 `Agent` 호출 → 진짜 병렬.

```typescript
Agent[
  {
    subagent_type: "general-purpose",
    description: `TeamLead — ${task1.title}`,
    prompt: `당신은 TeamLead입니다.
      플러그인의 agents/team-lead.md SOP를 따르세요.

      task spec:
      ${JSON.stringify(task1)}

      worktree는 Orchestrator가 이미 생성: ${task1.worktree_path}
      Phase A → F 순서로 자율 실행. 마지막에 요약 JSON 반환.`
  },
  { /* task2 */ }, { /* task3 */ }
]
```

각 TeamLead Agent는:
- 자체 컨텍스트로 사이클 실행 (build-team 스킬 또는 자체 phase)
- Phase 0 어프루벌 SKIP (자동 정책)
- PR 생성 (코드 task) / wiki 산출물 워크트리 내 직접 Write
- 요약 JSON 반환

### Step 5: 요약 수집 + main 처리

각 TeamLead가 반환한 요약 JSON 처리:

```
for summary in team_lead_summaries:
  if summary.verdict == "APPROVE":
    # Orchestrator는 main에 직접 commit/push 하지 않음 (pre-bash hook으로 차단됨).
    # 모든 변경(코드 + 문서)은 TeamLead가 자기 worktree의 해당 경로에 직접 Write 후
    # 단일 PR로 묶어 보냄. Orchestrator는 PR 머지만 수행.
    assert summary.pr_url, `${summary.task_id}: PR URL 누락 → escalate`
    pr_number = parseInt(basename(summary.pr_url))
    gh pr merge {pr_number} --squash --delete-branch
    git pull --ff-only origin <main_branch>

    # 락 해제 + worktree 정리
    branch-locks.json에서 entry 삭제
    git worktree remove {worktree_path}

    # 외부 task 시스템 상태 갱신 (있다면)
    if has_task_tracker():
      task_tracker.set_status(task_id, "done")

    completed_count++

    # spawned_tasks (이 task가 만든 follow-up bug task 등) transcript 출력
    for st in (summary.spawned_tasks || []):
      transcript: `[spawned] ${st.id} ${st.title}`

  elif summary.verdict == "REQUEST_CHANGES":
    blocking_questions 기록, status: "review"

  elif summary.verdict == "BLOCK" or summary.status == "escalated":
    blocking_questions 기록, status: "blocked"
    branch-locks.json에서 status: "blocked"
    if has_task_tracker(): task_tracker.set_status(task_id, "blocked")
    사용자 알림 메시지 출력
```

### Step 6: status 갱신 + loop-count

```
- (선택) wiki/status.md 또는 .agent-state/last-iter.md 갱신
- .agent-state/loop-count++
```

### Step 7: 다음 iter 결정 (모드별 분기)

```
# 7-1) 글로벌 안전 가드 (모드 무관)
test -f .agent-state/STOP && exit
spend 95% 초과 && exit
loop-count > 100 && exit

# 7-2) 모드별 종료 조건
switch (mode):
  case "forced":
    transcript: "[mode=forced] task=<id> 처리 완료, 종료"
    exit
  case "once":
    if completed_count >= 1: exit
  case "max_n":
    if completed_count >= max_count: exit
  case "continuous": # 종료 조건 없음

# 7-3) 다음 iter / idle 결정
if (available_slots > 0 && ready task 존재):
  → Step 1로 (즉시 다음 iter)
elif (ready task 0):
  # idle 자동 재진입 — Step 0의 원본 argv 보존
  resume_prompt =
    "/orchestrate"                              if args.length == 0
    else  "/orchestrate " + args.join(" ")

  if (mode == "continuous"):
    ScheduleWakeup({delaySeconds: 1800, prompt: resume_prompt,
                    reason: "ready task 0 — 30분 후 재시도"})
  elif (mode in {"once","max_n"}):
    ScheduleWakeup({delaySeconds: 900, prompt: resume_prompt,
                    reason: `[mode=${mode}] ready 0 — 15분 후 재시도`})
```

**ScheduleWakeup 호출 규약**:
- `delaySeconds`: continuous=1800, once/max_n=900. **절대 `300` 사용 금지** (cache TTL 5분 — worst-of-both).
- `prompt`: 반드시 `/orchestrate` 접두 + Step 0의 원본 argv 공백 join. 빠뜨리면 wake-up 시 mode가 `continuous`로 리셋됨.
- `reason`: 한 줄로 모드 + 의도 명시.
- 호출 직후 transcript에 `[idle] ScheduleWakeup armed delay=Ns mode=M` 1줄 출력 후 turn 종료.

## 안전망 — 자동 진행 X, 즉시 정지 + 사용자 알림

- 새 의존성 추가 (TeamLead가 escalate)
- 외부 API 결제 / production 배포
- DB migration
- 사용자 데이터 노출 가능 작업
- 6번째 escalate (자동 정지 임계)

## 컨텍스트 절약 (3-tier 핵심 가치)

| 시나리오 | 2-tier 비용 | 3-tier 비용 |
|---|---|---|
| 1건 (5 teammate, 30 메시지) | 30 메시지 main 누적 | 1 요약 JSON main 누적 |
| 야간 8h × 10 task | ~300 메시지 | ~10 요약 |

## 호출 예 (병렬 3건)

```
Step 4 단일 메시지:
- Agent: TeamLead for TASK-3
- Agent: TeamLead for TASK-17
- Agent: TeamLead for TASK-19

→ 3개 병렬 실행 → 각자 teammate spawn → 요약 3개 받아 main 처리
```

## 재진입 안전

- `branch-locks.json` 으로 항상 재시작 가능
- 중단된 worktree는 다음 iter Step 1에서 점검 (orphan 정리)

## 프로젝트별 확장점 (선택)

본 플러그인은 **stack-agnostic** 코어만 제공. 다음은 프로젝트가 직접 채워야 함:

| 확장점 | 위치 | 설명 |
|---|---|---|
| Worktree 부트스트랩 | `./scripts/agent-company-bootstrap.sh` | env 복사, DB seed, 포트 할당 등. 인자: `<worktree_path>` |
| Task tracker | PM 에이전트 본문 | Task Master MCP, Linear, GitHub Issues 등. PM에 어떤 도구를 쓸지 명시 |
| ADR/문서 워크플로 | TeamLead Phase D | 프로젝트의 ADR 규칙(번호 부여, 인덱스 경로 등)을 TeamLead 프롬프트에 추가 |
| 산출물 경로 | TeamLead Phase D | 회고/QA/검증 파일을 어디 둘지 (예: `docs/retro/`, `wiki/05-reports/`) |

`/agent-company-init` 스킬을 호출하면 위 항목의 템플릿이 자동 설치됨.

## 관련

- `agents/pm.md` — PM SOP (Tier 2 외부, 작업 큐 관리)
- `agents/team-lead.md` — TeamLead 프롬프트 명세
- `/agent-company-init` — 신규 프로젝트 부트스트랩
