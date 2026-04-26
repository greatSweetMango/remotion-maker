---
title: 'ADR-0006 — spend.json 자동 갱신 (PostToolUse hook)'
created: 2026-04-26
updated: 2026-04-26
tags: [pm, decision, infra, agent-company]
status: active
---

# ADR-0006 — spend.json 자동 갱신 (PostToolUse hook)

## 컨텍스트

에이전트 컴퍼니의 폭주 방지 (blueprint §9) 중 '일일/주간 토큰 예산 초과 → 정지'를 자동화하려면 매 Anthropic 호출의 usage를 집계해야 한다. 기존 `SessionStart` 훅은 이미 daily 95% 게이트를 갖고 있었으나, **누가 spend.json을 갱신하는가**에 대한 구현이 비어 있었다.

## 결정

Claude Code의 `PostToolUse` 훅에서 stdin payload의 `tool_response.usage`를 추출하여 `.agent-state/spend.json`에 누적한다.

- 가격: Claude 4.5 (Opus / Sonnet / Haiku) 표준 단가, 모델 family 자동 감지
- 토큰 종류: input / output / cache_creation / cache_read 4종 모두 합산
- 동시성: `flock` 으로 spend.json 직렬화
- research 카운터: `CLAUDE_RESEARCH=1` 또는 `tool_input`에 'research' 흔적 시 별도 누적
- graceful degrade: jq 미설치 / payload에 usage 없음 / 비-Anthropic tool 호출 모두 무음 exit 0

`SessionStart` 훅은 자정 자동 리셋(history archive)과 weekly·research_daily 95% 게이트를 추가한다.

## 대안

1. **모든 비용 추적을 `Stop` 훅으로 모음** — 세션 종료 전까지 비용을 모르므로 게이트 늦음. 기각.
2. **외부 프로세스(daemon)로 추적** — 의존성 추가, 단일 머신 가정 깨짐. 기각.
3. **PreToolUse에서 추정** — 응답 토큰을 알 수 없어 부정확. 기각.

## 결과

- daily/weekly/research 예산 게이트가 자동화되어 사람 개입 없이 STOP 트리거 가능
- 가격표를 hook 내부에 박제 → 단가 변동 시 단일 파일 수정
- 4-path fallback으로 Claude Code 버전별 payload 스키마 변경에 어느 정도 내성

## 관련

- PR: https://github.com/greatSweetMango/remotion-maker/pull/5
- `wiki/02-dev/agent-company-blueprint.md` §8, §9
- `.claude/hooks/post-tool-use.sh`, `.claude/hooks/session-start.sh`
