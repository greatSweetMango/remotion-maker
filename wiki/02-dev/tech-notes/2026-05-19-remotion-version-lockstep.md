---
title: Remotion 4.x requires lockstep minor versions across all @remotion/* packages
date: 2026-05-19
tags: [#tech-note, #remotion, #deps, #gotcha]
related: [TM-180]
---

# Remotion 4.x — all `@remotion/*` packages must share the exact same minor

## Symptom

Dev/build returns **500 on every route** the moment a Remotion code path executes (Composition, Player, Lottie). No useful error in logs — Turbopack just bails.

## Cause

`@remotion/*` packages (`bundler`, `cli`, `lottie`, `player`, `renderer`) each declare `"remotion"` as a peer/transitive dep pinned to **their own exact minor**. If a sibling drifts (e.g. `@remotion/lottie@4.0.461` while everything else is on `4.0.448`), npm resolves **two distinct copies of `remotion`** into the tree. Remotion's internal module registry can't reconcile them — instances stop matching, hooks blow up, route returns 500.

## Rule

When bumping **any** `@remotion/*` package, bump **all** of them to the same version in the same commit. Includes:

- `remotion` (core)
- `@remotion/bundler`
- `@remotion/cli`
- `@remotion/lottie`
- `@remotion/player`
- `@remotion/renderer`
- (and any future siblings — `@remotion/captions`, `@remotion/transitions`, `@remotion/google-fonts`, etc.)

## Detection

```bash
grep -E '"@?remotion[/"]' package.json
# All versions on RHS should match exactly.

# Confirm the lockfile has a single resolution:
grep -A1 '"node_modules/remotion":' package-lock.json
# Should NOT also see a second `node_modules/@remotion/<x>/node_modules/remotion` entry.
```

## History

- **TM-180 (2026-05-19)** — `@remotion/lottie` drifted to `4.0.461` while family stayed at `4.0.448`. Pinned back down. Retro: `wiki/05-reports/2026-05-19-TM-180-retro.md`.

## Prevention

- Renovate/Dependabot: group `@remotion/*` and `remotion` into one PR.
- Code review checklist: any `@remotion/*` version bump triggers "did you bump the family?" review.
