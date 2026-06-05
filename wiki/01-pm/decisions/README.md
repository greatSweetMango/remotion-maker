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
- [[0016-acceptance-gate-v2|ADR-0016: Visual quality acceptance gate v2 — 4-criteria multi-run]]
- [[0017-capture-determinism|ADR-0017: capture-side determinism]]
- [[0018-judge-determinism|ADR-0018: judge determinism]]
- [[0019-rag-templates|ADR-0019: Reference 템플릿 RAG]]
- [[0021-context-ingest|ADR-0021: URL/이미지 컨텍스트 ingest]]
- [[0022-character-rendering|ADR-0022: 캐릭터/장면 렌더링 capability 전략]]
- [[0023-edit-params-isolation|ADR-0023: Edit PARAMS isolation — strict single-key change policy]]
- [[0024-workflow-tooling|ADR-0024: Agent workflow tooling — specialized agents, MCP servers, skills, orchestrator guards]]
- [[0025-branch-locks-mutex|ADR-0025: branch-locks mutex + pre-PR duplicate guard (TM-96)]]
- [[0026-audio-policy|ADR-0026: Audio integration policy — curated staticFile catalogue]]
- [[0027-lottie-catalogue|ADR-0027: Lottie integration policy — curated staticFile catalogue for living-entity motion]]
- [[0028-text-to-video|ADR-0028: Text-to-video hybrid (Runway / Kling / Sora / Pika / Luma) — defer with single PILOT]]
- [[0029-background-queue-asset-gen|ADR-0029: Background queue + polling for asset-gen (R1a from TM-156 RCA)]]

## 새 ADR 만들기

1. 다음 번호 사용 (예: `0004-`)
2. 파일명: `NNNN-짧은-결정-요약.md`
3. 템플릿: `_meta/templates/adr.md` 복사
4. 상태: `proposed → accepted | rejected | superseded`
5. 한 번 accepted된 ADR은 **수정하지 않는다**. 바꾸려면 새 ADR을 만들고 옛 것을 `superseded by ADR-NNNN`으로 표시
- [[0030-orchestrator-v2-hardening|ADR-0030: Orchestrator v2 — 점진 강화 하드닝 (Hermes/Magentic-One/LangGraph 기반 자율성 강화)]]
- [[0031-preflight-guardrail|ADR-0031: Preflight guardrail — 디스패치 전 키/dev-server/env fail-fast (OpenAI Swarm input-guardrail 패턴)]]
- [[0032-tasks-json-single-writer|ADR-0032: tasks.json 단일-writer 직렬화 (TM-96 mutex 확장, 동시쓰기 race 제거)]]
- [[0033-progress-ledger|ADR-0033: Magentic-One progress-ledger + phase_loop stall detector (in-flight health for TeamLeads)]]
