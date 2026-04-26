---
title: blueprint.md ASCII → Mermaid 변환 시 섹션별 다이어그램 타입 결정
created: 2026-04-26
updated: 2026-04-26
tags: [adr, dev]
status: active
provenance: extracted
---

# ADR-0004: Blueprint Mermaid 다이어그램 타입 결정

> **단일 결정**: `wiki/02-dev/agent-company-blueprint.md` §2 / §3.1 / §3.5 / §3.6×4 / §5 의 8개 ASCII 블록을 mermaid로 교체할 때 **섹션별 다이어그램 타입과 모델링 정책**을 확정한다.

## Context

- RS-1 산출물 [[../../03-research/blueprint-ascii-inventory|blueprint-ascii-inventory]]에서 8개 ASCII 블록의 노드/엣지 인벤토리와 변환 후보 타입이 정리됨.
- `wiki/CLAUDE.md` §3 시각화 규칙: 워크플로우/시퀀스/상태는 mermaid `flowchart` / `sequenceDiagram` / `stateDiagram-v2` 권장.
- Obsidian 기본 mermaid 렌더와 GitHub 렌더 둘 다 호환되어야 함. 복잡한 그래프는 렌더 안정성이 떨어지므로 단순 `flowchart` 우선.
- 인지 부하 최소화를 위해 **유사 패턴은 같은 타입을 사용**하는 일관성을 둔다 (특히 §3.6 4개 블록은 모두 동형 선형 파이프라인).
- IM-1이 mermaid 코드블록을 작성할 때 본 ADR을 단일 진실 공급원으로 사용한다.

## Decision

### 1) 섹션별 최종 다이어그램 타입

| 섹션 | 블록 | mermaid 타입 | 이유 |
|---|---|---|---|
| §2 아키텍처 | B1 | `flowchart TD` + 3 subgraph (`ORCH`, `BT`, `INFRA`) + 중첩 subgraph `ROLES` | 4-layer 수직 흐름은 TD 자연스러움. 그룹 묶음 보존을 위해 subgraph 필요. C4Context는 Obsidian 호환성 떨어져 배제. |
| §3.1 Orchestrator iter | B2 | `flowchart TD` + 단일 subgraph `BUILD_TEAM`(S3a–S3d) | 7-step 절차 + step 3의 sub-pipeline. sequenceDiagram은 단일 행위자 위주라 부적합. |
| §3.5 PM 워크트리 라이프사이클 | B3 | `flowchart TD` + **다이아몬드 분기** (L3 → 락 여부) | 10-step 직선이 길어 TD가 가독성 우수. stateDiagram-v2는 라벨이 길어 부적합. "이미 락이면 skip" 분기를 명시. |
| §3.6 Feature 흐름 | B4 | `flowchart LR` | 7-노드 선형 파이프라인. LR이 좌→우 작업 흐름 직관적. |
| §3.6 Fix 흐름 | B5 | `flowchart LR` (QA 노드 `X1`/`X5` 분리) | B4와 동일 패턴. QA 두 번 등장 → 동일 ID로 묶으면 사이클 왜곡 발생하므로 분리. |
| §3.6 Experiment 흐름 | B6 | `flowchart LR` | B4와 동일 패턴 (5-노드 선형). |
| §3.6 Refactor 흐름 | B7 | `flowchart LR` | B4와 동일 패턴 (7-노드 선형). |
| §5 End-to-End 파이프라인 | B8 | `flowchart TD` + 4 subgraph (`PLAN`, `BT`, `PR`, `GATE`) + LOOP cycle 화살표 | 9-step 종합 + 다층 sub-bullet. TD + 다중 subgraph로 가독성 유지. Ralph 루프 의미 살리기 위해 LOOP → P2 cycle 화살표 추가. |

### 2) RS-1 결정 포인트에 대한 답

| # | 결정 포인트 | 결론 |
|---|---|---|
| 1 | B1 Orchestrator 5 bullet 표현 | **subgraph 멤버 5개 노드로 분리** (멀티라인 라벨은 가독성 떨어짐) |
| 2 | B2 step 3 sub-pipeline | **단일 다이어그램 안 subgraph로 직렬 표현** (별도 다이어그램 분리는 §2와 중복돼 배제) |
| 3 | B3 락 분기 | **다이아몬드 명시** (`{이미 락?}` → yes: `Skip` / no: L4). 본문 주석만으로는 정보 손실 |
| 4 | B5 QA 두 번 등장 | **`X1`, `X5` 두 노드로 분리** (RS-1 권장 그대로 확정) |
| 5a | B8 Phase 4 "Implementer + QA 병렬" | **단일 노드 라벨**(`"Phase 4: Implementer + QA 병렬"`) 유지. 다이어그램이 이미 길어 분기까지 추가하면 가독성 저하 |
| 5b | B8 Phase 1-3 어프루벌 vs Phase 4+ 자동 | **단일 노드 라벨**로 압축 (`BTDry["dry-run 미리보기 (Phase 1-3 사용자 승인 / Phase 4+ 자동)"]`). 분기는 이미 GATE subgraph에서 표현 |
| 5c | B8 LOOP cycle | **`LOOP --> P2` cycle 화살표 추가** (Ralph 루프 의미 보존) |
| 6 | fence | ` ```mermaid ` 코드펜스 통일 (이미 wiki/CLAUDE.md §3와 합치) |

### 3) 모델링 정책 (전 섹션 공통)

- **노드 ID**: ASCII 영숫자만. 라벨에만 한글/특수문자 허용 (큰따옴표 필수).
- **subgraph 헤더**: `subgraph ID["라벨"] ... end` 형태로 라벨에 한글 허용.
- **이모지/Unicode**: 따옴표 안에서 그대로 사용 가능 (예: `G1["✅ CI + Reviewer approve ..."]`).
- **escape**: 라벨 안 큰따옴표는 `#quot;`로 변환 (B3 L5 `worktree: "..."`이 해당).
- **방향**: §2/§3.1/§3.5/§5 = `TD`, §3.6 = `LR`. subgraph 내부 방향 다르면 `direction` 명시.
- **엣지 라벨**: 원본 ASCII에 라벨 없으면 무라벨로 유지. 분기 다이아몬드(B3)와 라벨 명시 가치 있는 경우(B8 PR auto-merge 조건)에만 라벨 추가.

## Consequences

### 긍정적

- 모든 §3.6 블록이 `flowchart LR`로 통일되어 독자의 인지 부하 감소.
- 일관된 `flowchart` 사용으로 Obsidian/GitHub 양쪽 렌더 안정성 확보.
- 다이아몬드 분기/cycle 화살표/노드 분리 정책 덕분에 정보 손실 0 보장 (RS-1의 손실 위험 항목 모두 해결).
- IM-1이 본 ADR + RS-1 인벤토리만 참조하면 1:1 변환 가능 — 추가 결정 부담 없음.

### 부정적 / 트레이드오프

- B8(§5) 다이어그램이 4 subgraph + cycle로 비교적 복잡. 만약 Obsidian 일부 테마에서 subgraph 중첩 렌더 이슈가 발견되면 VL-1 단계에서 평면화(flatten) 재검토 필요.
- B1, B8에서 subgraph 사용 시 일부 mermaid 버전에서 화살표 끝점이 subgraph 경계에 붙는 시각적 차이 발생 가능 — 의미 손실은 없음.

### 후속 작업

- IM-1 (Task #3): 본 ADR + RS-1 인벤토리 기반으로 8개 ASCII 블록을 mermaid 코드블록으로 교체. 한 섹션씩 atomic commit.
- VL-1 (Task #4): mermaid syntax 검증 + Obsidian 미리보기 + GitHub 렌더 + 정보 보존 확인 + 변경 범위 (§3.5 Wiki 소유권 표 / §1 TL;DR 등 비-ASCII 영역 미수정).

## 관련 문서

- [[../../03-research/blueprint-ascii-inventory|RS-1: blueprint ASCII 인벤토리 + mermaid 매핑]]
- [[../../02-dev/agent-company-blueprint|대상 문서: Agent Company Blueprint]]
- [[../../CLAUDE|wiki/CLAUDE.md §3 시각화 규칙]]
- 컨텍스트: `.agent-state/context-phase1-001-blueprint-mermaid.md`
