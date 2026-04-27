---
title: TM-12 — 에셋 공유 링크 세션 회고
report_type: session
created: 2026-04-26
tags: [report, share, feature]
---

# TM-12 세션 회고

## 결과
- PR #12 생성, 머지 대기
- 8 files / +490 LOC, 새 npm 의존성 0
- tsc/lint clean, jest 58→61 (regressions 0)

## 산출물
- `prisma/schema.prisma` — Asset.publicSlug? unique + sharedAt?
- `src/lib/share/slug.ts` — `crypto.randomBytes(9).toString('base64url')` (12자, ~72bit)
- `src/app/api/asset/[id]/share/route.ts` — POST/DELETE, owner-only, idempotent, P2002 retry
- `src/app/share/[slug]/page.tsx` — SSR, force-dynamic, OG meta, 404
- `src/components/share/SharePlayer.tsx` — controls=false, FREE 워터마크
- `src/components/share/ShareButton.tsx` — 모달 + copy + open-in-new-tab
- Studio.tsx 헤더에 ShareButton
- `__tests__/lib/share/slug.test.ts` — 3 cases

## 결정
- 마이그레이션 정책: PM이 escalate 후보로 표시 → **Option 3** 선택 (schema in PR, 머지 후 사용자 1회 실행). PR description 명시.
- nanoid 새 의존성 회피 → `crypto.randomBytes`.
- read-only Player: 신규 SharePlayer 컴포넌트.

## ⚠️ 머지 후 사용자 액션
```bash
npx prisma migrate dev --name add_asset_public_slug
```

## 다음
- 후속 P2: dashboard에서 공유 상태 표시 / revoke UI
- 후속 P2: rate limit on POST /api/asset/[id]/share
