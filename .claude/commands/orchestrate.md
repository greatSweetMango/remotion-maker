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

## 실행 모드 (argv 파싱) — Step 0

`/orchestrate` 호출 시 인자(`$ARGUMENTS`)를 파싱하여 루프 동작을 결정한다. **루프 진입 전 (Step 1 이전) 1회만 실행**.

| 인자 | mode | 동작 |
|---|---|---|
| (없음) | `continuous` | 연속 모드 (default) — STOP/예산/loop-count/ready 고갈까지 무한 |
| `--once` | `once` | 1 task 처리 후 종료 (TeamLead 요약 수집 + main 처리까지 마치고 exit) |
| `--max=N` (N은 양의 정수) | `max_n` | N개 task 처리(=`completed_count >= N`) 후 종료 |
| `TM-X` (예: `TM-3`) | `forced` | 우선순위/ready 무시하고 해당 task 1건만 강제 실행 → 처리 후 종료 |

**파싱 규칙**:

```
args = ($ARGUMENTS).trim().split(/\s+/).filter(Boolean)
mode = "continuous"
forced_task_id = null
max_count = null

for a in args:
  if a == "--once": mode = "once"
  elif a.startsWith("--max="):
    n = parseInt(a.slice(6))
    assert n >= 1, "--max=N requires N>=1"
    mode = "max_n"; max_count = n
  elif /^TM-\d+$/.test(a):
    mode = "forced"; forced_task_id = a
  else: error("unknown arg: " + a)

# 동시 지정 시 우선순위: forced > once > max_n > continuous
# (조합 미지원 — 두 개 이상 모드 인자 발견 시 마지막 것이 이김, 단 forced는 항상 우선)

completed_count = 0  # main 처리(머지 또는 escalate 확정)까지 끝난 task 수
```

루프 시작 전 transcript에 모드 출력:
- `[mode] continuous` / `[mode] once` / `[mode] max_n N=3` / `[mode] forced task=TM-7`

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

**모드별 분기**:

- `mode == "forced"`: PM에게 `next_ready_tasks` 대신 `get_specific_task` 요청. 우선순위/ready 검사 무시하고 `forced_task_id` 1건만 spec 조회. 단 `pending|review|in_progress` 상태인지만 확인 (이미 done이면 즉시 종료, escalated면 경고 후 진행).
- `mode == "once"`: PM 호출하되 `max=1`로 제한 (사용 가능 슬롯이 더 있어도 1개만).
- `mode == "max_n"`: 매 iter PM에게 `max=min(available_slots, max_count - completed_count)` 전달. 남은 할당량이 0이면 즉시 Step 7로.
- `mode == "continuous"` (default): 기존 동작 — `max=available_slots`.

PM에게 전달 (continuous/once/max_n):
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

PM에게 전달 (forced):
```json
{
  "request": "get_specific_task",
  "task_id": forced_task_id,
  "bypass_priority": true
}
```

PM 응답에서 추출:
- `tasks[]` (각 task에 branch/worktree_path/spec_links/context_files 등 포함)
- `current_locks`, `available_slots_after`

**0개**면:
- `mode == "forced"`: 에러 — 사용자에게 알림 후 종료
- 그 외: idle 모드 (Step 7 → ScheduleWakeup 또는 mode에 따라 종료)

### Step 3: 워크트리 + 락 사전 할당 (Orchestrator 책임)

각 task에 대해:

```bash
# 코드 task
if execution_location == "worktree":
  git worktree add {worktree_path} -b {branch}
  # TM-56: 워크트리 env 자동 부트스트랩.
  #   .env.local 복사 + NEXTAUTH_URL 포트 치환 + prisma db push (worktree-local SQLite).
  #   누락 시 TeamLead가 매번 수동으로 .env 만지다 시간 낭비 (TM-42/43/45 retro 참조).
  #   dev_port 컨벤션: 30NN (NN = task_id 두자리, 예: TM-56 → 3056).
  bash scripts/setup-worktree.sh {worktree_path} {dev_port}
  branch-locks.json에 entry 추가 (status: "in_progress")

# wiki-only / docs task
elif execution_location == "main":
  worktree 생성 X
  branch-locks.json에 등록 X (단 동시 wiki-only 1개 직렬화)

# Task Master 상태 전이 (모든 task 공통, 디스패치 직전 1회)
mcp__task-master-ai__set_task_status(id={tm_id}, status="in-progress")
```

> Task Master 통합 상세는 `.claude/agents/pm.md` §Task Master MCP 통합 참조. PM이 fetch 시 `tm_details` 필드를 채워 보내므로, Orchestrator는 그대로 TeamLead에 전달한다.

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

#### Step 5-pre: ADR 번호 충돌 회피 (TeamLead 책임으로 이전 — 2026-04-27 변경)

**구버전(폐기)**: Orchestrator 가 main 에 직접 push 하던 시절, TeamLead 는 PENDING placeholder 만 작성하고 Orchestrator 가 commit 직전 NNNN 을 부여했다.

**현버전**: 모든 변경(코드 + wiki + ADR)이 worktree → PR → 머지 흐름을 거치므로 Orchestrator 가 main 을 직접 만질 수 없다. ADR NNNN 부여 책임을 **TeamLead Phase D(PR 생성 직전)** 로 이전한다.

- TeamLead 가 PR 생성 직전 `git fetch origin main && ls origin/main:wiki/01-pm/decisions/` 로 현재 max NNNN 확인 → `max+1` 부여 → PENDING placeholder 를 NNNN-slug 로 rename + 본문 토큰 일괄 치환 → 같은 PR 에 포함하여 push.
- 병렬 race 시 두 PR 이 동일 NNNN 을 가질 수 있다. 첫 번째 PR 머지 후 두 번째 PR 은 자연스럽게 rebase conflict (같은 파일명) 발생 → TeamLead 또는 Orchestrator 의 머지 재시도 루프(아래 잔여 위험 처리)에서 두 번째 PR 을 다음 NNNN 으로 자동 rename 후 force push 재시도.

**Orchestrator 측 잔여 책임**: 머지 직전 PR 의 ADR 파일명이 main 의 현재 max+1 와 어긋나면 자동 fixup 재시도 (아래 알고리즘은 머지 시점에 적용):

**TeamLead가 보내야 하는 형식** (`prompts/team-lead.md` Phase F 참조):
- `wiki_artifacts.adr.path` = `wiki/01-pm/decisions/PENDING-<task_id>-<slug>.md`
- 본문 내 self-reference 토큰 = `ADR-PENDING-<task_id>` (제목, 인덱스, 다른 산출물의 cross-link 포함 모두 동일 토큰)

**Orchestrator 알고리즘** (wiki commit 직전 단일 배치, 병렬 task 간 충돌 원천 차단):

```
# 1) 현재 main의 최대 NNNN 스캔 (README/_meta/PENDING- 파일 제외)
existing = ls wiki/01-pm/decisions/ | grep -E '^[0-9]{4}-.*\.md$' | sort
max_nnnn = existing의 마지막 4자리 prefix를 정수로 (없으면 0)

# 2) 이번 배치에서 PENDING ADR을 가진 APPROVE summary 수집 + 결정 순서 고정
#    - 정렬: task_id 오름차순 (TM-3 < TM-17 < TM-19) → 같은 task의 여러 ADR은 path 보조정렬
pending = sorted(
  [(s, art) for s in approved_summaries
              for art in [s.wiki_artifacts.adr]
              if art and art.path includes "/PENDING-"],
  key=(s.task_id_numeric, art.path)
)

# 3) 순차 NNNN 부여 + rename map / token map 구성
nnnn = max_nnnn
rename_map = {}             # old_path -> new_path
token_map  = {}             # "ADR-PENDING-TM-X" -> "ADR-NNNN"
title_by_nnnn = {}          # NNNN -> ADR title (인덱스 갱신용)
for (summary, art) in pending:
  nnnn += 1
  pad  = String(nnnn).padStart(4, "0")
  # PENDING-<task_id>-<slug>.md 에서 <slug> 추출
  #   task_id 자체가 "TM-36" 처럼 hyphen을 포함 → 정규식은 task_id를 알고 lstrip
  fname = basename(art.path)                                    # PENDING-TM-36-adr-collision-avoidance.md
  slug  = fname.removePrefix("PENDING-" + summary.task_id + "-")
                .removeSuffix(".md")                            # adr-collision-avoidance
  new_path = "wiki/01-pm/decisions/" + pad + "-" + slug + ".md"
  rename_map[art.path]                          = new_path
  token_map["ADR-PENDING-" + summary.task_id]   = "ADR-" + pad
  title_by_nnnn[pad]                            = (art.content frontmatter title) or slug
  art.path = new_path

# 4) 모든 wiki_artifacts(ADR + retro + qa + validation + research) 본문에 token 일괄 치환
#    cross-reference (예: 회고 본문이 "see ADR-PENDING-TM-36" 라고 쓴 경우 자동 보정)
for s in approved_summaries:
  for art in s.wiki_artifacts.values():
    if art and art.content:
      for (token, replacement) in token_map:
        art.content = art.content.replaceAll(token, replacement)
      # 파일명 self-reference도 보정 (PENDING-TM-X-slug → NNNN-slug)
      for (old_path, new_path) in rename_map:
        art.content = art.content.replaceAll(old_path, new_path)
        art.content = art.content.replaceAll(basename(old_path), basename(new_path))

# 5) ADR 인덱스(README) 갱신: 새 NNNN 항목을 인덱스 끝에 자동 추가
#    wiki/01-pm/decisions/README.md "## 인덱스" 섹션 마지막에 줄 append:
#      `- [[NNNN-slug|ADR-NNNN: <title>]]`
#    title은 art.content frontmatter title 필드에서 추출 (없으면 slug 그대로)
#    이미 존재하는 NNNN이면 (이론상 없지만) skip + transcript warn
```

**불변식**:
- Step 5-pre 실행 후 `wiki_artifacts` 안에는 더 이상 `PENDING-` 또는 `ADR-PENDING-` 토큰이 남아있지 않다.
- 같은 iter에서 N개 ADR이 들어오면 `max+1, max+2, ..., max+N`이 보장된다 (정렬 결정성으로 재실행해도 동일 결과).
- 이전 iter가 commit한 ADR과 동시 iter의 ADR이 같은 NNNN을 가질 수 없다 (commit 직전 매번 ls로 max 재산정).

**한 가지 잔여 위험**: Orchestrator가 ADR을 commit하고 push하기 직전에, 사람(또는 다른 main 작업)이 새 ADR을 main에 직접 push하면 fast-forward 실패. 처리:
- `git push origin main` 실패 시 → `git pull --rebase origin main` → Step 5-pre의 max_nnnn을 재계산해 본 iter에서 만든 ADR 들을 한 번 더 rename + token rewrite → 재 commit → push.
- 2회 실패하면 escalate.

치환 후 일반 흐름 진행:

```
for summary in team_lead_summaries:
  if summary.verdict == "APPROVE":
    # ❌ Orchestrator 는 main 에 직접 commit/push 하지 않는다 (hook 으로 차단됨).
    # ✅ wiki 산출물은 TeamLead 가 자기 worktree 에서 wiki/ 경로에 직접 Write,
    #    코드 + wiki 가 함께 들어있는 단일 PR 을 생성한다 (team-lead.md Phase D 참조).
    # Orchestrator 는 PR 머지만 수행 → 머지 시점에 코드 + wiki 가 함께 main 진입.
    assert summary.pr_url, `${summary.task_id}: PR URL 누락 — TeamLead 가 PR 생성 안 함, escalate`
    pr_number = parseInt(basename(summary.pr_url))
    gh pr merge {pr_number} --squash --delete-branch
    git pull --ff-only origin main  # 머지 결과 가져오기

    # 락 해제 + worktree 정리 (.agent-state/branch-locks.json 은 .gitignore 처리)
    branch-locks.json 에서 entry 삭제 (로컬 파일, push 불필요)
    git worktree remove {worktree_path}

    # Task Master 상태 갱신
    mcp__task-master-ai__set_task_status(id={task_id}, status="done")

    completed_count++   # 모드 종료 조건 평가용 (once/max_n)

    # === Step 5-post: QA 재검증 트리거 처리 ===
    # 머지된 task가 fix 성격이고 metadata에 triggers_requalify 가 박혀있으면
    # 부모 QA task들을 pending 으로 되돌려 다음 iter 에서 재실행되게 함.
    triggers = read_task_metadata(task_id, "triggers_requalify") || []
    for parent_qa_id in triggers:
      parent = mcp__task-master-ai__get_task(id=parent_qa_id)
      if parent.status == "done":
        # qa_iteration 증가 (없으면 2부터)
        next_iter = (parent.metadata.qa_iteration || 1) + 1
        update_task_metadata(parent_qa_id, {qa_iteration: next_iter})
        mcp__task-master-ai__set_task_status(id=parent_qa_id, status="pending")
        transcript: `[requalify] ${parent_qa_id} → pending (r${next_iter}) (fix=${task_id})`
      # 이미 pending/in-progress 면 noop (다음 iter 자연 재실행)

    # spawned_tasks (이 task 가 새로 만든 bug task 들) 도 transcript 만 출력 — PM 이 다음 iter 에서 fetch
    for st in (summary.spawned_tasks || []):
      transcript: `[spawned] ${st.id} ${st.title} (requalify→${st.triggers_requalify})`

  elif summary.verdict == "REQUEST_CHANGES":
    # 1 round 재실행 (loop guard 2회까지) — TeamLead가 자체 처리하지 못한 경우만 도달
    blocking_questions 기록, status: "review"

  elif summary.verdict == "BLOCK" or summary.status == "escalated":
    # 사람 escalate
    blocking_questions 기록, status: "blocked"
    branch-locks.json에서 entry 유지하되 status: "blocked"
    mcp__task-master-ai__set_task_status(id={tm_id}, status="blocked")
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

### Step 7: 다음 iter 결정 (모드별 분기)

```
# 7-1) 글로벌 안전 가드 (모드 무관, 항상 우선)
test -f .agent-state/STOP && exit
spend 95% 초과 && exit (경고 출력)
loop-count > 100 && exit (사람 호출)

# OpenAI 야간 QA 예산 캡 — TM-41~48 라이브 호출 누적
openai_spend = read .agent-state/spend.json .openai_total_usd (default 0)
if openai_spend >= 18.00:
  write .agent-state/STOP (reason: "openai $18 cap reached")
  transcript: `[budget] OpenAI cap hit ($${openai_spend}/$20) — STOP written`
  exit

# 같은 task N 회차 fix 누적 실패 가드 (Ralph 무한 루프 방지)
# qa_iteration >= 5 인 부모 QA task 가 또 pending 으로 회귀하면 escalate
for t in tasks where t.metadata.qa_iteration >= 5 and t.status == "pending":
  mcp__task-master-ai__set_task_status(id=t.id, status="blocked")
  transcript: `[escalate] ${t.id} qa_iteration=${t.metadata.qa_iteration} — blocked, 사람 호출`

# AI QA 종료 조건 — 최종 보고서 작성됨 → STOP
if test -f wiki/05-reports/2026-04-27-ai-qa-final.md:
  write .agent-state/STOP (reason: "AI QA final report exists")
  transcript: "[ai-qa] final report detected — STOP written, exit"
  exit

# 7-2) 모드별 종료 조건
switch (mode):
  case "forced":
    # 1건 처리 후 무조건 종료. 다음 iter 없음.
    transcript: "[mode=forced] task=<forced_task_id> 처리 완료, 종료"
    exit

  case "once":
    if completed_count >= 1:
      transcript: "[mode=once] 1 task 처리 완료, 종료"
      exit
    # 아직 0건이면(예: PM이 ready 0개 반환) → 7-3로 fallthrough
    #   단 다음 iter Step 2의 effective_max 는 여전히 1로 캡

  case "max_n":
    if completed_count >= max_count:
      transcript: "[mode=max_n] max=<max_count> 처리 완료, 종료"
      exit
    # 남았으면 7-3로 fallthrough

  case "continuous":
    # 종료 조건 없음 — 7-3로 fallthrough

# 7-3) 다음 iter / idle 결정 (continuous + 미달 once/max_n 공통)
if (사용 가능 슬롯 > 0 && ready task 존재):
  → Step 1로 (즉시 다음 iter)
elif (ready task 0):
  # idle 자동 재진입 — ScheduleWakeup 도구 호출 (종료 대신)
  # prompt 인자에 Step 0에서 보존한 원본 $ARGUMENTS 그대로 실어야 mode 유지됨
  resume_prompt =
    "/orchestrate"                              if args.length == 0
    else  "/orchestrate " + args.join(" ")      # 예: "/orchestrate --max=3"

  if (mode == "continuous"):
    ScheduleWakeup({
      delaySeconds: 1800,                        # 30분 (cache miss 1회로 장시간 idle 커버)
      prompt: resume_prompt,                     # 즉 "/orchestrate"
      reason: "ready task 0 — 30분 후 PM 재요청"
    })
  elif (mode in {"once", "max_n"}):
    ScheduleWakeup({
      delaySeconds: 900,                         # 15분 (모드 종료 임박, 짧게)
      prompt: resume_prompt,                     # 원본 argv 보존 필수
      reason: `[mode=${mode}] ready 0 — 15분 후 재시도 (남은 ${max_count - completed_count}건)`
    })
  # forced 모드는 Step 2에서 ready 0 발견 시 즉시 종료(에러)이므로 여기 도달 X
```

**ScheduleWakeup 호출 규약** (필수 검증 항목):
- `delaySeconds`: continuous=1800, once/max_n=900. 절대 `300` 사용 금지 (cache TTL 5분 — worst-of-both).
- `prompt`: 반드시 `/orchestrate` 접두 + Step 0의 원본 argv를 공백 join. **빠뜨리면 wake-up 시 mode가 `continuous`로 리셋**되어 once/max_n 의도 손실.
  - 예: 원본이 `--max=3 --once` (last-wins → once) → `prompt: "/orchestrate --max=3 --once"`
  - 예: 원본이 빈 문자열 → `prompt: "/orchestrate"`
- `reason`: 한 줄로 모드 + 의도 명시 (telemetry / 사용자 노출).
- 호출 직후 transcript에 `[idle] ScheduleWakeup armed delay=Ns mode=M` 1줄 출력 후 turn 종료.

**종료 vs idle 선택**: ScheduleWakeup이 default. 단 다음은 `exit` (재진입 X):
- `.agent-state/STOP` 존재 / spend 95% 초과 / loop-count > 100 (Step 7-1에서 이미 처리)
- `mode == "forced"` (Step 7-2에서 처리)
- `mode in {"once","max_n"}` 이고 `completed_count >= 목표` (Step 7-2에서 처리)

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
