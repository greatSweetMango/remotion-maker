# personal-calude-marketplace

greatSweetMango의 개인용 Claude Code 플러그인 마켓플레이스.

## 사용법

Claude Code에서:

```
/plugin marketplace add greatSweetMango/personal-calude-marketplace
/plugin install <plugin-name>
```

## 수록 플러그인

### [agent-company](./agent-company)

3-tier 자율 에이전트 하네스 (Orchestrator → TeamLead × N → 5-role build-team).
Worktree 격리, 병렬 task 실행, 예산 가드, STOP 파일, Anthropic + OpenAI 비용 추적.

```
/plugin install agent-company
/agent-company-init
```

## 구조

```
.claude-plugin/marketplace.json   ← 마켓플레이스 매니페스트
agent-company/                    ← 플러그인 1
  .claude-plugin/plugin.json
  commands/
  agents/
  hooks/
  templates/
  README.md
```

## 자동 동기화

`agent-company` 플러그인 원본은 [remotion-maker](https://github.com/greatSweetMango/remotion-maker) 레포의 `plugin/agent-company/` 디렉토리에 있습니다. 해당 레포에서 회고로 개선되는 사항이 GitHub Action을 통해 본 마켓플레이스로 자동 PR 됩니다.

## 라이선스

Personal use. Fork freely.
