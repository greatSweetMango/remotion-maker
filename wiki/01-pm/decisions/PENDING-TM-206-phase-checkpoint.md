---
title: "ADR-PENDING-TM-206: TeamLead Phase 체크포인트 + kill→재개 (LangGraph 패턴)"
created: 2026-06-05
updated: 2026-06-05
tags: [decision, area/infra, area/agent-company, orchestrator-v2, resilience]
status: accepted
---

# ADR-PENDING-TM-206: TeamLead Phase 체크포인트 + kill→재개 (LangGraph 패턴)

## 컨텍스트

TeamLead(Tier 2)는 단일 task 를 Phase A→F 로 자율 실행한다. 그러나 이 실행은
지금까지 **무상태(stateless)** 였다 — watchdog/overload kill(`stop-guard.mjs` 의
`phase_loop` reset+replan, stale-lock 6h 회수, 또는 세션 강제 종료) 후 Orchestrator 가
같은 task 를 **재디스패치**하면, 새 TeamLead 세션은 항상 **Phase A 부터 처음** 다시
시작했다.

문제는 이미 부작용이 있는 Phase(특히 Phase D — git 커밋/push + `gh pr create`)를
지나친 뒤 kill 당한 경우다. 재시작 TeamLead 는:
- 이미 만든 context 파일·build-team 결과·retro·ADR 을 다시 만들고,
- 최악의 경우 이미 열린 PR 을 인지하지 못해 **중복 PR 생성**을 시도한다
  (TM-55/TM-85 race 와 동일 계열).

이번 orchestrator-v2 세션에서 **TM-184 가 2회 stall 로 작업유실 직전**까지 갔다 —
TM-205 의 `phase_loop` 가 stall 을 잡아 reset+replan 했지만, replan 후 TeamLead 는
직전 진척을 0 에서 다시 쌓아야 했다. stall **감지**(TM-205)는 갖췄으나 stall 후
**진척 보존**이 없었다.

이는 LangGraph / Temporal / Magentic-One 류 durable-execution 프레임워크가 푸는
고전 문제다 — 장기 실행 워크플로를 **체크포인트 경계**로 쪼개, 크래시 후 마지막
완료 체크포인트부터 재개(replay-free resume)한다.

제약:
- **순수 additive** — 콜드 스타트(정상 실행) 경로의 동작은 한 글자도 바뀌면 안 된다.
- **안전 가드 비회귀** — TM-205 progress-ledger / `phase_loop`, TM-207 preflight,
  TM-208/Step5, TM-215 current-task 의 임계·동작·플러밍 불변.
- **render-light** — 새 npm 의존성·LLM·렌더 비용 없이 bash/jq + 기존 node 만.
- **런타임 파일 커밋 금지** — checkpoint 는 worktree-local, PR 에 들어가면 안 된다.

## 결정

**TeamLead 가 각 Phase 종료 시 `.agent-state/checkpoint.json` 에 last-completed-phase
high-water-mark 를 기록하고, 첫 turn 에 그 파일을 읽어 마지막 완료 Phase 다음부터
재개한다.** TM-205 progress-ledger emit 과 **공존**한다 — 같은 Phase 경계 훅을
공유하되 역할이 다르다.

| | TM-205 progress-ledger | TM-206 checkpoint |
|---|---|---|
| 파일 | `progress-ledger.jsonl` (append-only) | `checkpoint.json` (덮어쓰기, 1개) |
| 독자 | **Orchestrator** (stop-guard `phase_loop`) | **TeamLead 자신** (재개 preamble) |
| 의미 | in-flight health 신호 (전역) | durable resume 상태 (worktree-local) |
| 동시성 | flock/mkdir mutex (병렬 append) | single-writer/worktree, 원자적 mv |

1. **`scripts/orchestrator/write-checkpoint.sh`** (신규) — `append-progress.sh`(TM-205)의
   task_id 정규화·JSON-escape·timestamp 컨벤션을 미러한다. 단 append 가 아니라
   `.agent-state/checkpoint.json` 을 **덮어쓴다**(항상 최신 1개). `artifacts` 는
   이전 checkpoint 의 artifacts 와 **머지**(새 키 우선)하므로, 각 Phase 가 새 산출물
   (context_file → impl → retro/adr → pr_url/commit_hash)을 누적한다. node 로 견고한
   JSON 머지, node 부재 시 verbatim 폴백. 쓰기는 temp+mv 원자적 — 독자가 half-write 를
   보지 않는다. single-writer(워크트리당 TeamLead 1명)라 cross-process lock 불필요.
   스키마: `{task_id, last_completed_phase, artifacts{...}, next_step, ts}`.

2. **`prompts/team-lead.md`** —
   - 각 Phase(A~F) 종료 시 TM-205 emit **직후 같은 자리**에 checkpoint write 1번 지시
     (emit 라인 보존 — 두 훅이 한 Phase 경계를 공유).
   - **재개 preamble**(첫 turn, Phase A0 직후): `checkpoint.json` 존재 시 읽어
     `last_completed_phase` 다음부터 재개. `artifacts.context_file`→Phase A 재사용,
     `artifacts.pr_url`→`gh pr create` 재호출 금지(기존 PR 재사용), `artifacts.adr_path`→
     ADR 재작성 금지. 콜드 스타트(파일 부재)면 평소대로 Phase A 부터.
   - **멱등성**: checkpoint 는 "이 Phase 까지 확실히 끝났다"는 high-water-mark 다.
     Phase 중간 kill 은 checkpoint 에 반영되지 않아 그 Phase 만 재실행된다(부분 작업
     폐기 — 안전 측 default). PR/커밋 부작용은 Phase D 의 pre-PR dup 가드
     (`pre-pr.sh` rc==10 open PR → create 금지)와 git 자연 멱등성(같은 커밋 재push=no-op)이
     흡수한다.

3. **`.claude/commands/orchestrate.md` Step 4** — 재디스패치 시 TeamLead 프롬프트에
   `resume=true` 신호 한 줄 추가. 판별은 cheap — **worktree 에 checkpoint.json 이
   이미 있으면** 재디스패치(주로 Step 7-1b `phase_loop` reset+replan 경로). 신호는
   힌트일 뿐 권위 있는 재개 상태는 checkpoint.json 단독. **Step 4 내부에만** 위치 —
   Step 5(머지)/Step 7(stop-guard/replan) 미접촉(TM-205/TM-208 충돌 회피).

4. **`.gitignore`** — `.agent-state/checkpoint.json` 추가(TM-215 current-task 와 동일
   rationale: per-worktree 런타임 파일, 추적 시 동시 TeamLead PR 간 머지/pull conflict).
   Phase D `git add` 는 의도한 파일(코드+wiki)만 — checkpoint 는 staging 안 함.

## 대안 검토

- **Orchestrator 가 재개 상태 소유** — Orchestrator 가 각 task 의 Phase 진척을
  추적해 재디스패치 프롬프트에 박는 안. 기각: Orchestrator 는 요약 JSON 만 받는
  3-tier 격리 원칙(컨텍스트 절약 핵심)을 깨고, in-flight Phase 정보를 모른다.
  worktree-local 파일을 TeamLead 가 소유하는 게 격리에 맞다.
- **progress-ledger.jsonl 재사용** — append-only 로그를 역순으로 읽어 마지막 Phase
  추론. 기각: 로그는 health 신호용 grouping 이라 artifacts(pr_url 등) 미보유 →
  중복 PR 방지 불가. 전용 durable 상태 파일이 필요.
- **checkpoint 를 git-tracked** — 기각: 동시 TeamLead PR 간 conflict(TM-215 실증).
  런타임 파일은 gitignore.

## 결과

- kill→re-dispatch 시 Phase A 재시작 대신 마지막 완료 Phase 다음부터 재개 →
  중복 PR/커밋/산출물 생성 차단, replan 후 진척 보존. TM-184 류 작업유실 위험 제거.
- TM-205 stall **감지** + TM-206 stall 후 **재개**가 한 쌍으로 완성(Magentic-One 의
  detect→replan 에 durable resume 을 더한 형태).
- 콜드 스타트 무영향(additive). 새 의존성 0, render 0.

## 검증

코드 task 가 아닌 prompt/infra 변경이라 단위 테스트보다 시나리오·헬퍼 스모크로 검증:
- `write-checkpoint.sh` 스모크: Phase A write → Phase D write 시 artifacts 머지 확인,
  bare/`TM-` task_id 정규화, 무인자 artifacts 기본 `{}`, 잘못된 JSON/배열 artifacts
  rc=2(파일 미생성), usage rc=2, `bash -n` 통과.
- `git check-ignore .agent-state/checkpoint.json` → ignored 확인.
- 재개 시나리오 문서화: cold start(파일 없음→Phase A) vs resume(파일 있음→
  `last_completed_phase`+1), pr_url 보유 시 PR 재사용 멱등성.

## See also

- ADR-0033 (TM-205) — progress-ledger + `phase_loop` stall detector (본 ADR 의 짝)
- ADR-0030 — orchestrator-v2 hardening
- ADR-0032 (TM-209) — tasks.json single-writer
- TM-215 — current-task 런타임 파일 gitignore (checkpoint 와 동일 패턴)
- retro: `wiki/05-reports/2026-06-05-TM-206-retro.md`
