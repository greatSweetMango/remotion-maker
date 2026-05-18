---
title: "2026-05-18 — TM-152 circular-dependency audit (refactor week-2)"
created: 2026-05-18
updated: 2026-05-18
tags: [report, refactor]
status: active
report_type: session
period: "2026-05-18"
author: TeamLead-TM-152
---

# TM-152 — Circular-dependency audit

## TL;DR

- **0 true circular dependencies** across `src/` (331 modules / 603 deps).
- Only `madge` reports 1 cycle (`generate.ts ↔ pipeline.ts`) — already mitigated with documented dynamic `import()` on both edges. Classified **acceptable**.
- Added `npm run check:circular` + `.dependency-cruiser.cjs` as a persistent regression guard.

## 무엇이 바뀌었나

- `package.json` — `+ "check:circular"` script.
- `.dependency-cruiser.cjs` — new config, `severity: error` on `no-circular`.
- `wiki/02-dev/tech-notes/2026-05-18-TM-152-circular-deps.md` — full classification + rationale.
- `wiki/05-reports/screenshots/TM-152/` — `madge.txt`, `depcruise.txt`, `depcruise-final.txt` raw outputs.

## 왜 / 배경

Refactor week-2 (TM-94 scheduler) auto-spawned TM-152 to verify no module-init cycles existed before the next round of feature work.

## 영향

- **Code**: zero source changes; refactor was unnecessary.
- **Tooling**: new guard surfaces real future cycles immediately.
- **Cost/perf**: none.

## 후속 / 다음

- [ ] Wire `npm run check:circular` into a GH Actions step (separate small task).
- [ ] If a future PR ever needs to add a third entry point that talks to both `generate.ts` and `pipeline.ts`, consider extracting a small `router.ts` instead of stacking more dynamic imports.

## 출처 / 링크

- 코드: `../src/lib/ai/generate.ts`, `../src/lib/ai/pipeline.ts`
- 가드 설정: `../.dependency-cruiser.cjs`
- 상세 분석: [[../02-dev/tech-notes/2026-05-18-TM-152-circular-deps]]
- 원본 madge/dep-cruiser 출력: `screenshots/TM-152/`
