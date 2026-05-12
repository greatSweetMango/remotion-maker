# .agent-state/

에이전트 컴퍼니의 런타임 상태 저장소. 모두 git 추적 대상 (히스토리 보존).

| 파일 | 용도 | 누가 갱신 |
|---|---|---|
| `STOP` | (존재 시) Orchestrator 즉시 종료 | 사용자 또는 `scripts/orchestrator/stop-guard.mjs` |
| `branch-locks.json` | worktree/branch 락 테이블 | PM agent |
| `spend.json` | 토큰/비용 추적 (누적), 일일/주간 예산 | Hooks (PostToolUse) |
| `spend-ledger.jsonl` (TM-101 format, TM-112 producer) | append-only 비용 원장 — 시간대/task/model 별 breakdown | Hooks (PostToolUse), 분석: stop-guard |
| `current-task` (TM-112) | 현재 진행 중 task_id 한 줄 (선택) — `CLAUDE_TASK_ID` 환경변수가 우선 | Orchestrator/TeamLead (선택적) |
| `verdict-history.jsonl` (TM-101) | TeamLead 요약 verdict 로그 (error-rate 분석용) | Orchestrator Step 5 |
| `concurrency-limit` | 동시 실행 worktree 한도 | PM agent (자동 조정) |
| `loop-count` | Ralph 루프 반복 카운터 | Orchestrator |
| `context-{task-id}.md` | build-team 임시 컨텍스트 | build-team Phase 0 |

## TM-101 — Night-mode STOP 조건 + spend ledger

기존 STOP 가드 (STOP file / spend 95% / loop-count >100 / openai cap $18 / AI QA final / qa_iteration ≥5) 외에 `scripts/orchestrator/stop-guard.mjs` 가 5 신호를 추가 감시한다. orchestrate.md Step 7-1 가 매 iter 호출.

| 신호 | 조건 (기본) | env override |
|---|---|---|
| quality_plateau | 최근 3개 bench report `mode_match_pct` drift <1pp | `STOP_QUALITY_LOOKBACK`, `STOP_QUALITY_DELTA_PP` |
| error_rate_spike | 최근 5 verdict 중 BLOCK/REQUEST_CHANGES ≥60% | `STOP_ERROR_LOOKBACK`, `STOP_ERROR_RATE_PCT` |
| worktree_leak | `git worktree list` ≥5 | `STOP_WORKTREE_MAX` |
| stale_lock | branch-locks entry started_at >6h 경과 | `STOP_STALE_LOCK_HOURS` |
| cost_burst | spend-ledger.jsonl 최근 60min 합산 ≥$3 | `STOP_COST_BURST_USD`, `STOP_COST_BURST_MIN` |

`spend-ledger.jsonl` 한 줄 스키마 (append-only):
```json
{ "ts": "2026-05-13T03:21:18.412Z", "task_id": "TM-101", "model": "gpt-4o-mini",
  "tokens_in": 4123, "tokens_out": 812, "cost_usd": 0.0024, "kind": "openai" }
```
누적 합계는 여전히 `spend.json` 가 canonical — ledger 는 시간대 분석용 데이터 소스.

생산자(TM-112): `.claude/hooks/post-tool-use.sh` — Claude Code PostToolUse 페이로드에서 `usage` 블록 추출 시 한 줄 append. `task_id` 는 `CLAUDE_TASK_ID` env → `.agent-state/current-task` 파일 → `"unknown"` 순으로 해석. `flock` 직렬화 (`.spend-ledger.lock`).

회전(TM-118): `scripts/orchestrator/rotate-spend-ledger.mjs` — launchd `com.easymake.spend-ledger-rotate-monthly` 가 매월 1일 00:05 (로컬) 호출. 지난 달 데이터를 `.agent-state/spend-ledger.archive.YYYY-MM.jsonl.gz` 로 압축한 뒤 원본에서 제거. 같은 `.spend-ledger.lock` 으로 직렬화하여 PostToolUse hook 과 충돌 없음. Idempotent: 진행 상태를 `.agent-state/spend-ledger.rotate.json` 에 기록하여 partial-failure 재실행 시 중복 archive append 차단. 시간대 분석은 회전 후에도 현재 달 + archive 파일들을 함께 zcat 으로 스트림하면 됨 (`zcat .agent-state/spend-ledger.archive.*.jsonl.gz; cat .agent-state/spend-ledger.jsonl`).

## 정지 방법

```bash
# 현재 진행 중인 작업이 끝나면 멈춤
touch .agent-state/STOP

# 다시 시작하려면
rm .agent-state/STOP
```

## 비상 정지

`STOP` 파일이 작동하지 않으면:
```bash
pkill -f claude
```
