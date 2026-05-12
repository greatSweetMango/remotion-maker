# agent-company

3-tier 자율 에이전트 하네스 (Orchestrator → TeamLead × N → 5-role build-team).
Worktree 격리, 병렬 task 실행, 예산 가드, STOP 파일, Anthropic + OpenAI 비용 추적.

## What it gives you

- **`/orchestrate`** — Ralph 루프 진입점. continuous / `--once` / `--max=N` / `<TASK-ID>` 4 모드
- **`/agent-company-init`** — 신규 프로젝트 부트스트랩
- **PM / TeamLead 에이전트** — Tier 2/3 위임용 SOP
- **4개 hooks** — STOP 검사, 예산 95% 차단, force-push 차단, 비용 누적, 미커밋 경고
- **`.agent-state/` 템플릿** — 동시성/예산/락 테이블

## Install

```
/plugin marketplace add greatSweetMango/personal-calude-marketplace
/plugin install agent-company
```

설치 후 한 번:

```
/agent-company-init
```

`.agent-state/` 디렉토리, `.gitignore` 업데이트, `scripts/agent-company-bootstrap.sh` stub이 생성됩니다.

## Stack-agnostic 설계

본 플러그인은 코어만 제공. 다음은 프로젝트가 채움:

| 확장점 | 위치 | 책임 |
|---|---|---|
| Worktree 부트스트랩 | `scripts/agent-company-bootstrap.sh` | env 복사, DB seed, 포트 할당 |
| Task tracker | `agents/pm.md` (또는 프로젝트 로컬 복사본) | Task Master / Linear / GH Issues / 로컬 파일 |
| 문서/ADR 워크플로 | TeamLead Phase D | 회고/QA 파일 경로, ADR 번호 부여 규칙 |

## Safety

- `.agent-state/STOP` 파일로 즉시 정지
- daily / weekly / research 예산 95% 도달 시 SessionStart hook이 세션 차단
- force-push, `--no-verify`, main 직접 push는 PreToolUse hook으로 거부
- 자동 escalate: 새 의존성, 외부 결제, DB migration, complexity 9+, 동일 task 3회 escalate

## Cost tracking

PostToolUse hook이 모든 Anthropic + OpenAI API 호출의 usage를 추출 → `.agent-state/spend.json`에 누적.
가격표 내장: Claude 4.5 (Opus/Sonnet/Haiku), gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini.

## License

Personal use. Fork freely.
