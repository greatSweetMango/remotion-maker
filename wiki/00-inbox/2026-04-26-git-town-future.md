---
title: 아이디어 — Git Town을 에이전트 컴퍼니 브랜치 자동화에 도입
created: 2026-04-26
updated: 2026-04-26
tags: [idea, dev, automation]
status: deferred
---

# Git Town 도입 아이디어 (보류)

> **상태**: 아이디어 단계. 에이전트 컴퍼니가 Phase 3 이상 안정화된 이후 재검토.

## 요약

Developer/Reviewer subagent의 git 조작을 [Git Town](https://www.git-town.com/) 으로 전면 대체. Planner의 작업 분해를 **스택 PR 체인**으로 자연스럽게 매핑.

## 왜 매력적인가

- **스택 PR 자동화**: `git town append`로 부모-자식 PR 자동 연결, 부모 머지 시 base 자동 재배선
- **브랜치 메타데이터 영속화**: `.git/config`에 parent 키 저장 → 여러 worktree가 메타 공유
- **단일 명령 = 여러 단계**: `hack`(브랜치+sync), `propose`(PR+base 자동), `ship --strategy=api`(CI통과+머지+정리)

## 명령 매핑

| 기존 | Git Town 대체 |
|---|---|
| `checkout main && pull && checkout -b feat/x` → `gh pr create` | `git town hack feat/x` → `git town propose` |
| 의존 task 분기 + 수동 base 지정 | `git town append feat/x-2` |
| `fetch && rebase main` | `git town sync` |
| `gh pr merge --squash` | `git town ship --strategy=api` |

## 권장 설정

```
sync-feature-strategy = compress
ship-strategy = api
push-hook = false
GIT_EDITOR=true
GIT_TOWN_TOKEN=<gh-token>
```

## 도입 시 주의점

- 첫 호출 시 setup 마법사 prompt → 사전 `git town config setup` 베이크 필수
- 충돌 자동 해결 X → 별도 LLM 해결 루틴 필요
- 동일 브랜치 worktree 충돌 → Planner가 브랜치-워크트리 1:1 락 테이블 유지

## 도입 시점 판단 기준

다음 모두 충족 시 검토:
- [ ] 에이전트 컴퍼니 Phase 3 안정화 (PR 1건 자율 닫힘)
- [ ] 의존성 있는 다단계 task가 빈번히 발생 (스택 PR 가치 발현)
- [ ] 다중 Developer 병렬 작업 필요 (worktree 락 가치)

## 관련

- [[../02-dev/agent-company-blueprint|에이전트 컴퍼니 설계]] (생성 예정)
- 외부: https://www.git-town.com/
