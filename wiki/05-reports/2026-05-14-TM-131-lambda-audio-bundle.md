---
title: "2026-05-14 — TM-131 Lambda audio bundle smoke"
created: 2026-05-14
updated: 2026-05-14
tags: [report, TM-131, audio, lambda, export, ADR-0026]
status: active
report_type: session
period: "2026-05-14"
author: "TeamLead Agent (TM-131)"
---

# TM-131 — public/audio/ bundle + audio-stream determinism smoke

## TL;DR

ADR-0026 §B claims "Remotion Lambda already includes `public/audio/` via
`staticFile`" — TM-131 turns that claim into an executable smoke test.
Bundles a 5s composition with `<Audio src={staticFile("audio/...")} />`,
renders to mp4, ffprobes the output: audio stream present, codec aac,
duration ~5.0s. Smoke green on first run, no production code changes
required.

## 무엇이 바뀌었나

- Added dedicated Remotion entry `__tests__/api/export/audio-bundle-entry.tsx`
  that registers an `AudioBundleSmoke` composition referencing a curated
  catalogue track (`audio/chill-driftwood.mp3`).
- Added smoke `__tests__/api/export/audio-bundle.test.ts` (opt-in via
  `REMOTION_BUNDLE_TEST=1`, ~12s wall-clock) that bundles → renders → ffprobes.
  Falls back to mp4-atom byte-sniff when ffprobe is unavailable.
- No changes to `src/app/api/export/route.ts` or `src/remotion/export-entry.tsx`
  — the existing TM-89 pipeline already bundles `public/`.

## 왜 / 배경

ADR-0026 §B accepts a curated `staticFile("audio/...")` catalogue (TM-127
shipped 15 stub fixtures). Before downstream tasks (TM-130 BGM picker UI,
TM-128 audio allowlist, etc.) wire end-to-end, we need empirical proof that
the export pipeline carries `public/audio/` through to the rendered mp4 — a
silent regression here would break BGM at export time only, surfacing in
production.

## 영향

- Bundle delta: `public/audio/` is currently 3.5 MB (15 stub mp3 tracks at
  ~230 KB each). Remotion bundles all of `public/` into the serveUrl, so the
  Lambda zip grows by the same amount. Acceptable headroom against Lambda's
  250 MB unzipped limit.
- The smoke is opt-in (downloads Chrome Headless Shell on first run, ~90 MB);
  CI default keeps the test skipped, mirroring TM-89 bundle-entry test.
- Reuses existing TM-127 fixtures — no new asset checked in.

## 검증

```
$ REMOTION_BUNDLE_TEST=1 npx jest __tests__/api/export/audio-bundle.test.ts
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Time:        11.521 s
```

ffprobe on the rendered mp4 confirmed:
- audio stream present (codec=aac)
- audio duration in [4.8, 5.2]s (asserted)
- mp4 size > 10 KB (asserted)

## 다음

- TM-128 audio allowlist (sandbox validator for `staticFile("audio/...")`).
- TM-130 BGM picker UI binding `bgmTrack` PARAM (ADR-0002 auto-extract).
- (Optional) Once TM-89 migrates to true Remotion Lambda, re-run this smoke
  against the deployed function for end-to-end deploy-bundle verification.

## 관련

- ADR-0026 audio policy (`wiki/01-pm/decisions/0026-audio-policy.md`) §B step 5
- TM-89 export-entry test (`__tests__/api/export/bundle-entry.test.ts`)
- TM-127 catalogue fixtures (`public/audio/MANIFEST.json`)
