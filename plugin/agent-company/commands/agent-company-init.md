---
description: agent-company 플러그인을 현재 프로젝트에 부트스트랩. .agent-state/ 디렉토리, 부트스트랩 스크립트 stub, CLAUDE.md 스니펫을 설치한다.
---

# /agent-company-init — Initial Setup

당신은 **Initializer**입니다. 본 명령은 `agent-company` 플러그인이 처음 설치된 프로젝트에서 1회 실행되어 필요한 런타임 상태와 확장점을 만든다.

## 실행 절차

다음 단계를 순서대로 수행하고 각 단계의 결과를 transcript에 한 줄씩 보고하세요.

### 1) 사전 점검

- `git status` 확인 — 미커밋 변경이 있으면 사용자에게 경고하고 진행 여부 묻기
- `.agent-state/` 이미 존재? → 덮어쓰지 말고 "[skip] .agent-state exists" 출력 후 step 3으로
- 현재 디렉토리가 git 저장소 루트인지 확인 (`git rev-parse --show-toplevel`과 일치)

### 2) `.agent-state/` 디렉토리 생성

플러그인의 `templates/agent-state/` 내용을 프로젝트 루트의 `.agent-state/`로 복사:

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
mkdir -p .agent-state
cp -n "${PLUGIN_ROOT}/templates/agent-state/README.md" .agent-state/README.md
cp -n "${PLUGIN_ROOT}/templates/agent-state/concurrency-limit" .agent-state/concurrency-limit
cp -n "${PLUGIN_ROOT}/templates/agent-state/spend.json" .agent-state/spend.json
cp -n "${PLUGIN_ROOT}/templates/agent-state/branch-locks.json" .agent-state/branch-locks.json
```

`cp -n` 으로 기존 파일은 보존. (`CLAUDE_PLUGIN_ROOT`는 Claude Code가 플러그인 루트로 주입하는 환경변수)

### 3) `.gitignore` 갱신

다음 항목을 `.gitignore`에 추가(없으면):

```
.agent-state/STOP
.agent-state/loop-count
.agent-state/branch-locks.json
.agent-state/spend.json
.agent-state/context-*.md
.agent-state/.spend.lock
```

`spend.json` / `branch-locks.json` 등 런타임 상태는 머신마다 다르므로 추적 X. 단 `README.md`와 `concurrency-limit` 는 추적.

### 4) 부트스트랩 스크립트 stub 설치

`scripts/agent-company-bootstrap.sh` 가 없으면 stub 생성:

```bash
mkdir -p scripts
cat > scripts/agent-company-bootstrap.sh <<'SH'
#!/usr/bin/env bash
# agent-company-bootstrap.sh — 프로젝트별 worktree 부트스트랩 훅
# Orchestrator(Step 3)가 새 worktree 생성 직후 호출.
#
# 인자:
#   $1 = worktree_path (절대경로)
#   $2... = 추가 인자 (예: dev_port)
#
# 본 stub은 no-op. 각 프로젝트가 필요에 맞게 수정:
#   - .env.* 복사
#   - DB seed / migration
#   - 의존성 재설치
#   - 포트/호스트 할당
#
# 멱등성 유지 — 재실행 시 기존 설정을 보존하도록 작성할 것.
set -euo pipefail

WORKTREE_PATH="${1:?usage: $0 <worktree_path> [extra...]}"

echo "[agent-company-bootstrap] worktree=$WORKTREE_PATH (no-op stub — edit me)"
exit 0
SH
chmod +x scripts/agent-company-bootstrap.sh
```

### 5) CLAUDE.md / AGENTS.md 스니펫 안내

`templates/CLAUDE.md.snippet` 내용을 출력하고, 사용자에게 "프로젝트 CLAUDE.md / AGENTS.md에 위 내용을 붙여넣을지" 묻기. **자동으로 붙여넣지 말 것** — 프로젝트마다 기존 본문이 다름.

### 6) 호환성 점검

다음 도구가 PATH에 있는지 확인하고 결과 보고:

- `jq` — hooks에서 필수
- `gh` (GitHub CLI) — PR 머지에 필요
- `git` 버전 (worktree 지원: 2.5+)
- `awk`, `flock` — hooks에서 사용 (BSD/GNU awk 모두 호환 작성됨; flock 없으면 spend.json 동시 갱신 race 가능 — macOS는 brew install flock 권장)

누락 시 설치 명령 안내:
- macOS: `brew install jq gh flock`
- Ubuntu: `apt install jq gh util-linux`

### 7) 외부 task tracker 통합 안내 (선택)

플러그인 코어는 **task tracker-agnostic**. PM 에이전트가 어떤 시스템에서 task를 fetch할지 본 프로젝트 컨텍스트에 추가해야 함. 후보:

- [Task Master MCP](https://task-master.dev) — `mcp__task-master-ai__*` 도구 사용
- Linear MCP
- GitHub Issues (`gh issue list`)
- 단순 로컬 파일 (예: `tasks.md`)

사용자에게 선택지를 보여주고, 선택된 도구에 따라 `agents/pm.md`를 (있다면) 프로젝트 로컬 `.claude/agents/pm.md`로 복사 + 해당 섹션을 수정하도록 안내. 자동 수정 X.

### 8) 완료 리포트

다음 형식으로 마무리:

```
✅ agent-company 부트스트랩 완료

설치된 항목:
  - .agent-state/ (README, concurrency-limit, spend.json, branch-locks.json)
  - .gitignore 갱신
  - scripts/agent-company-bootstrap.sh (stub)

다음 단계:
  1. scripts/agent-company-bootstrap.sh 를 프로젝트에 맞게 편집
  2. CLAUDE.md에 agent-company 사용 안내 추가 (snippet 참고)
  3. PM 에이전트의 task tracker 섹션을 채우기 (agents/pm.md 참고)
  4. /orchestrate --once 로 1건 dry-run 테스트

주의:
  - hooks가 즉시 활성화됨. .agent-state/STOP 으로 언제든 정지 가능.
  - 예산 한도는 .agent-state/spend.json 의 daily_budget_usd / weekly_budget_usd 수정.
```

## 자동화 정책

- 모든 단계는 **사용자 확인 없이 진행**. 단:
  - 기존 파일 덮어쓰기는 절대 금지 (`cp -n`)
  - CLAUDE.md / AGENTS.md 자동 수정 금지 (사용자에게 스니펫만 제시)
- 실패 시 어디서 실패했는지 정확히 보고 후 종료.
