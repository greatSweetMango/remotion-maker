---
type: report
date: 2026-04-26
tags: [feature, dashboard, auth]
task: TM-13
pr: https://github.com/greatSweetMango/remotion-maker/pull/15
---

# TM-13 — Asset history page

## What shipped
- `/dashboard` lists user assets with title search, sort, inclusive date range filter, 24-per-page pagination
- New: `AssetCard.tsx`, `AssetGrid.tsx`
- API `/api/assets` GET with `page`, `pageSize`, `search`, `sort`, `dateFrom`, `dateTo`
- Empty state with `/studio` CTA

## Verification
- Jest: 101/101 (+14 new), tsc clean, eslint clean, next build OK

## Deferred
- Tag filtering — see ADR-0009 (Asset model lacks `tags` column)
- Real thumbnails — placeholder retained
