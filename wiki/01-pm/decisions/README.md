---
title: Architecture Decision Records (ADR)
created: 2026-04-26
updated: 2026-04-26
tags: [meta, decision]
status: active
---

# ADR — Architecture Decision Records

**왜 그렇게 결정했는가**를 기록한다. 코드만 봐서는 알 수 없는 맥락이 여기 들어간다.

## 인덱스

- [[0001-edit-not-equal-render|ADR-0001: 편집과 렌더를 분리한다]]
- [[0002-customize-ui-auto-extract|ADR-0002: 커스터마이징 UI는 PARAMS 컨벤션으로 자동 추출한다]]
- [[0003-prompt-caching|ADR-0003: 편집 요청에 프롬프트 캐싱을 적용한다]]
- [[0012-adr-number-collision-avoidance|ADR-0012: ADR 번호 충돌 회피 — Orchestrator 단독 NNNN 부여]]
- [[0017-capture-determinism|ADR-0017: capture-side determinism]]

## 새 ADR 만들기

1. 다음 번호 사용 (예: `0004-`)
2. 파일명: `NNNN-짧은-결정-요약.md`
3. 템플릿: `_meta/templates/adr.md` 복사
4. 상태: `proposed → accepted | rejected | superseded`
5. 한 번 accepted된 ADR은 **수정하지 않는다**. 바꾸려면 새 ADR을 만들고 옛 것을 `superseded by ADR-NNNN`으로 표시
