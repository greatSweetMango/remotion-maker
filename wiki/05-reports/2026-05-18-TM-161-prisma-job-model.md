---
title: "2026-05-18 — TM-161 Prisma Job model + migration"
created: 2026-05-18
updated: 2026-05-18
tags: [report, area/architecture, area/db, task/TM-161]
status: active
report_type: session
period: "2026-05-18"
author: teamlead-agent
related:
  - "[[../01-pm/decisions/0029-background-queue-asset-gen|ADR-0029]]"
  - "[[2026-05-18-TM-158-background-queue-adr]]"
provenance: extracted
---

# TM-161 — Prisma Job model + repository helper

## TL;DR

ADR-0029 §1 의 첫 구현 청크. `Job` 모델과 enum `JobStatus` 를
`prisma/schema.prisma` 에 추가하고 SQLite 에 `db push` 로 반영했다
(TM-107/108/109 와 동일 패턴, 신규 migration 파일 없음). 동시에
`src/lib/db/jobs.ts` 에 lease 기반 큐 helper (createJob / leaseJob /
completeJob / failJob / cancelJob / requeueExpiredLeases) 와 단위
테스트 12 케이스를 추가했다. 워커/엔드포인트는 후속 TM 에서 붙인다.

## 무엇이 바뀌었나

- `prisma/schema.prisma`
  - `model Job { … }` — id, userId(FK→User CASCADE), status, kind,
    prompt, params(String, JSON 인코딩), resultAssetId, error, leasedAt,
    leaseExpiresAt, attempts, createdAt, updatedAt.
  - 3 개 index: `[userId, status]`(유저별 조회), `[status, createdAt]`
    (worker poll = oldest PENDING first), `[status, leaseExpiresAt]`
    (reaper).
  - `enum JobStatus { PENDING RUNNING SUCCEEDED FAILED CANCELLED }`.
  - `User.jobs Job[]` 역참조 추가.
- `src/lib/db/jobs.ts` — repository helper (lease atomicity, JSON
  encode/decode, 메시지 truncate 4KB).
- `__tests__/lib/db-jobs.test.ts` — 12 케이스 (전부 PASS).
- SQLite schema 적용 완료 (`Job` 테이블 + 3 index 확인).

## 왜 / 배경

ADR-0029 결정: DB-backed (Prisma) 큐. 별도 인프라 도입 없이
`User.assets` 와 같은 신뢰선으로 작업 수명주기를 관리한다.
이 PR 은 그 첫 단계 — 모델/마이그레이션/리포지토리 표면.
워커 루프, API 핸들러, 클라이언트 폴링 통합은 후속 TM.

## 설계 선택

- **SQLite-friendly typing**: ADR-0029 초안의 `Json` 컬럼은 SQLite
  에 없어 `String?` 로 저장하고 `JSON.parse/stringify` 를 helper 에
  집중시켰다 (기존 `Asset.tags`, `User.editUsage` 와 동일 패턴).
  `@db.Text` 도 SQLite 에 비적용이라 제거 — Prisma 가 자동으로
  무제한 TEXT 로 매핑.
- **Lease atomicity without `FOR UPDATE`**: SQLite 는 row lock 이
  없으므로 peek-then-CAS 패턴 — `findMany(limit=5)` 로 후보를 뽑은
  뒤 `updateMany({ where: { id, status: PENDING } })` 로 조건부
  업데이트. `count === 1` 인 경우에만 lease 성립. 동일 코드가
  Postgres 에서도 동작 (Postgres 는 더 강한 보장).
- **Attempt cap**: `requeueExpiredLeases({ maxAttempts: 3 })` 가
  attempts 누적값 기준으로 재큐 vs FAIL 분기. 영원 루프 방지.
- **에러 truncate 4KB**: stack trace 폭주로 인한 row blow-up 방지.

## 영향

- 코드: `src/lib/db/jobs.ts` 신규, schema 변경. 기존 호출자 없음
  (worker/API 미구현) → 회귀 위험 0.
- DB: 워크트리 SQLite 에 `Job` 테이블 생성. main 머지 시 production
  Postgres 도 동일 `db push` 필요 (현재 deploy 파이프라인이
  `prisma db push` 사용 — TM-107 과 동일).
- 성능: 신규 테이블이며 index 3개. write path 없음 — 무영향.
- 비용: 0.

## 검증

- `npx prisma format` — clean.
- `npx prisma db push` — `Your database is now in sync` + client regen.
- `sqlite3 prisma/dev.db ".schema Job"` — 테이블 + 3 index 모두 생성.
- `npx jest __tests__/lib/db-jobs.test.ts` — 12/12 pass.
- `npx tsc --noEmit` — 신규 코드 에러 0 (기존 main 의 pre-existing
  ts 에러 14개는 본 PR 무관).
- `npx eslint src/lib/db/jobs.ts __tests__/lib/db-jobs.test.ts` — clean.

## 후속 / 다음

- [ ] TM-162: worker loop (`leaseJob` polling, generate kind dispatch)
- [ ] TM-163: API `POST /api/generate/async` → createJob, `GET
      /api/job/:id` → status
- [ ] TM-164: 클라이언트 SSE/poll 통합
- [ ] TM-165: production migration runbook (Postgres `db push` 시점)

## 출처 / 링크

- 코드: `src/lib/db/jobs.ts`, `prisma/schema.prisma`
- 테스트: `__tests__/lib/db-jobs.test.ts`
- ADR: [[../01-pm/decisions/0029-background-queue-asset-gen|ADR-0029]]
- 직전 세션: [[2026-05-18-TM-158-background-queue-adr]]
