# .agent-state/

agent-company 플러그인의 런타임 상태 저장소. 일부 파일은 머신마다 다르므로 .gitignore 추가 권장 (init 스크립트가 처리).

| 파일 | 용도 | 누가 갱신 | git 추적 |
|---|---|---|---|
| `STOP` | (존재 시) Orchestrator 즉시 종료 | 사용자 (`touch .agent-state/STOP`) | ❌ |
| `branch-locks.json` | worktree/branch 락 테이블 | PM agent | ❌ (머신별) |
| `spend.json` | 토큰/비용 추적, 일일/주간 예산 | PostToolUse hook | ❌ (머신별) |
| `concurrency-limit` | 동시 실행 worktree 한도 | 사용자/PM (기본 3) | ✅ |
| `loop-count` | Ralph 루프 반복 카운터 | Orchestrator | ❌ |
| `context-{task-id}.md` | build-team 임시 컨텍스트 | PM / TeamLead | ❌ |
| `.spend.lock` | flock 동시 갱신 직렬화 | PostToolUse hook | ❌ |

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

## 예산 조정

`spend.json` 의 `daily_budget_usd`, `weekly_budget_usd`, `research_daily_budget_usd` 를 수정. 사용량이 95% 도달 시 SessionStart hook이 세션을 차단.
