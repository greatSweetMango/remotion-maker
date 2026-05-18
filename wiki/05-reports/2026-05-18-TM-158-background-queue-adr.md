---
title: "2026-05-18 — TM-158 R1(a) background queue ADR (ADR-only, scope-cut)"
created: 2026-05-18
updated: 2026-05-18
tags: [report, area/ai, area/latency, area/architecture, task/TM-158]
status: active
report_type: session
period: "2026-05-18"
author: teamlead-agent
related:
  - "[[../01-pm/decisions/0029-background-queue-asset-gen|ADR-0029]]"
  - "[[2026-05-18-TM-156-latency-rca]]"
  - "[[2026-05-18-TM-157-speculative-prefetch]]"
provenance: extracted
---

# TM-158 — Background queue + polling for asset-gen (ADR-only)

## TL;DR

TM-156 RCA identified `gpt-image-1` wire (p50 34.6s, 80% of request)
as the dominant latency. R1(b)/TM-157 (speculative prefetch) covers
part of the population. R1(a) — moving asset-gen off the synchronous
path via a job queue — was opened as TM-158. This session delivers
the **architectural decision only**: option matrix, choice (DB-backed
Prisma `Job` model), design sketch, and 4-5 follow-up task split. No
runtime code or migration shipped.

## 무엇이 바뀌었나

- 신규 ADR: `wiki/01-pm/decisions/0029-background-queue-asset-gen.md`
  (token: `ADR-0029`).
- 코드 변경: 0. Worktree clean against `feat/tm-158-background-queue-adr`.
- DB 변경: 0.

## 왜 / 배경

TM-156 결론대로, latency 예산의 80%가 외부 provider tail. 동기
경로에서 해결 불가 → 구조적 lever (background queue) 채택 필요.
다만 3가지 옵션 (in-process / DB-backed / 외부 큐) 중 어느 것을
고를지가 후속 코드 작업 전 의사결정 필요. 본 task는 이 의사결정
하나만 처리 (scope cut — 큰 architectural 변경은 ADR-first 원칙
ADR-0015 선례 따름).

## 옵션 비교 (요약)

| 옵션 | 채택 | 사유 |
|---|---|---|
| (1) In-process Map + SSE | REJECT | Vercel multi-instance prod에서 정합성 실패 |
| (2) Prisma `Job` + worker | **ADOPT** | 단일 migration, 기존 스택만 사용, reversible |
| (3) Inngest / BullMQ / Trigger.dev | REJECT (현 시점) | 새 vendor 비용, 현재 단일 asset/req에는 overkill |

상세 trade-off는 ADR 본문 참조.

## 결정 요지

DB-backed `Job` 모델 + worker polling. `/api/generate?async=1`
플래그로 게이트, 동기 경로는 그대로 유지 (reversible). 구현은
**4-5개 후속 task로 분할**: (a) Prisma 모델 + migration, (b) async
API, (c) worker (lease + retry), (d) studio UI, (e) Vercel cron.

## 영향

- **코드 / 시스템**: 본 task 영향 0. 후속 (a)~(d)에서 누적적 변경.
- **사용자 / 제품 (후속 적용 시)**: p50 latency 41s → ~5-7s 사용자
  체감. Provider tail (max 47s) 완전 은닉.
- **비용 / 성능**: 새 vendor 0. Prisma table 1개 + index 2개 추가
  (후속). Vercel cron 사용 시 free tier 가능.

## 후속 / 다음

- [ ] TM-NEXT-a: Prisma `Job` 모델 + migration 📅 다음 sprint
- [ ] TM-NEXT-b: `POST /api/generate?async=1` + `GET /api/jobs/[id]`
- [ ] TM-NEXT-c: Worker (lease + retry, self-trigger vs cron)
- [ ] TM-NEXT-d: Studio UI (polling + SSE upgrade — TM-160 채널 재사용)
- [ ] TM-NEXT-e (선택): Vercel cron 배선 + prod migration
- [ ] ADR 번호 부여: Orchestrator가 PR merge 직전 `PENDING-TM-158` →
  `00NN-background-queue-asset-gen.md` (다음 free 번호; 현재 max
  0028 → 0029 예상)

## 산출물

- `wiki/01-pm/decisions/0029-background-queue-asset-gen.md` (신규)
- 본 보고서

## 출처 / 링크

- ADR: [[../01-pm/decisions/0029-background-queue-asset-gen|ADR-0029]]
- RCA: [[2026-05-18-TM-156-latency-rca|TM-156]]
- 선행 ROI: [[2026-05-18-TM-157-speculative-prefetch|TM-157]]
- 예산 컨텍스트: [[2026-05-18-TM-151-latency-budget|TM-151]]
- 워크트리: `worktrees/TM-158-background-queue/` (branch
  `feat/tm-158-background-queue-adr`, base HEAD `d45e2fe`)
