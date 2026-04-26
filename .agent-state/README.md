# .agent-state/

에이전트 컴퍼니의 런타임 상태 저장소. 모두 git 추적 대상 (히스토리 보존).

| 파일 | 용도 | 누가 갱신 |
|---|---|---|
| `STOP` | (존재 시) Orchestrator 즉시 종료 | 사용자 (`touch .agent-state/STOP`) |
| `branch-locks.json` | worktree/branch 락 테이블 | PM agent |
| `spend.json` | 토큰/비용 추적, 일일/주간 예산 | Hooks (PostToolUse) |
| `concurrency-limit` | 동시 실행 worktree 한도 | PM agent (자동 조정) |
| `loop-count` | Ralph 루프 반복 카운터 | Orchestrator |
| `context-{task-id}.md` | build-team 임시 컨텍스트 | build-team Phase 0 |

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
