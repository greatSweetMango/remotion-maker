---
title: "ADR-0013: 사용자 업로드 storage 추상화 + Vercel Blob 채택"
status: accepted
date: 2026-04-27
tags: [decision, infra, uploads]
---

# ADR-0013: 사용자 업로드 storage 추상화 + Vercel Blob 채택

## Context
TM-31 (사용자 이미지/폰트 업로드)은 외부 object storage 필요. 자동화 정책상 외부 credential 발급은 사람 어프루벌이지만 코드/스키마/UI는 자동 진행 가능해야.

## Decision

1. **`StorageProvider` 인터페이스** (`src/lib/storage/`) — 백엔드 선택 런타임 env로
2. 기본 구현 2개:
   - `localStorageProvider` — 디스크 + `/api/upload/file/<path>` 라우트. dev/CI/credential 미설정 fallback
   - `vercelBlobProvider` — `BLOB_READ_WRITE_TOKEN` 활성, `@vercel/blob` **lazy import** (미설치 상태로도 빌드 통과)
3. S3 추가는 동일 인터페이스로 plug-in (별도 ADR 불필요)

선택 우선순위:
```
STORAGE_PROVIDER=local → local
BLOB_READ_WRITE_TOKEN set → vercel-blob
else → local (placeholder)
```

Vercel Blob 1차 채택 이유:
- Vercel hosting 1-step 통합
- Pro 100명 미만 규모에서 비용 차이 미미
- S3 마이그레이션은 인터페이스 동일 → 후행 가능

## Consequences
+ 외부 credential 0으로 100% 코드/UI 검증 가능
+ 백엔드 교체 시 단일 모듈만
+ `storageProvider` 컬럼으로 row별 출처 식별
- `local` provider production 운영 시 single-instance 한계 (의도)

## Follow-up (사람 어프루벌)
1. `BLOB_READ_WRITE_TOKEN` 발급 + Vercel env 등록
2. `npm install @vercel/blob`
3. 머지 후 `npx prisma db push`
