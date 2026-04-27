---
title: ADR-0010 — Share Fork lineage via Asset.sourceAssetId
created: 2026-04-26
tags: [decision, share, schema]
status: active
---

# ADR-0010: Share Fork lineage via Asset.sourceAssetId

## Context
TM-23 — D4 공유 링크에서 visitor가 본인 계정으로 에셋을 복제 ('Use this as starting point'). fork와 원본 관계 추적 결정 필요.

옵션:
1. lineage 추적 안 함 — 단순 복사
2. 별도 ForkLineage 테이블 — N:M 또는 audit log
3. Asset 자기 참조 (sourceAssetId?) — 1:N

## Decision
**옵션 3 채택**: `Asset.sourceAssetId String?` + self-relation `AssetForks` (onDelete: SetNull) + index.

- nullable: organic 생성 (gallery, AI generate)에는 null
- self-relation: 추가 테이블 없이 단순
- onDelete SetNull: 원본 삭제해도 fork 살아남음
- index로 "이 원본의 모든 fork" 쿼리 최적화

Fork 시 `publicSlug`/`sharedAt`은 **항상 null** — fork는 private, 재공유는 명시적. Capability token (slug) 의도되지 않은 전파 방지.

## Consequences
+ schema 변경 최소, Prisma include `forks`로 자연스러운 query
+ 향후 'made by 1.2k people' fork count UI 가능
- fork-of-fork tree는 재귀 쿼리 필요
- 원본 삭제 후 lineage 끊김 — 의도된 trade-off

## Migration
`npx prisma migrate dev --name add_asset_source_id`
