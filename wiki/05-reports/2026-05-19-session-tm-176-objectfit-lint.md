---
title: "TM-176 — full-bleed Img objectFit:'contain' validator"
date: 2026-05-19
type: session
tags: [sandbox, validator, tm-166-followup, tm-167, tm-176, asset-gen]
pr: https://github.com/greatSweetMango/remotion-maker/pull/226
status: merged-pending
---

# TM-176 — full-bleed Img objectFit lint

## Context
TM-166 #10 child of asset-gen composition hardening. TM-167 RCA showed
multi-step pipeline emitting `<Img style={{ width:'100%', height:'100%',
objectFit:'contain' }}/>` for the asset-gen layer. With a 16:9 viewport
+ non-matching PNG aspect, `contain` letterboxes ~70% of the frame.
TM-167 patched the system prompt (recommend `cover`), but no validator
enforcement — TM-173 regression corpus #5/#7 still tripped at ~15%.

## What changed
- **`src/lib/remotion/sandbox.ts`** — new `validateFullBleedImgObjectFit`.
  Fires only when an `<Img>` style sets BOTH `width:'100%'|'100vw'` AND
  `height:'100%'|'100vh'` AND `objectFit:'contain'`. Wired into
  `validateCode` after TM-175.
- **`plugin/remotion-eval/src/validate.ts`** — TM-115 mirror so external
  agents pre-flight against the same rule. Wired into
  `validateRemotionCode` step 1c.
- **Tests** — 4 in-app + 4 plugin: positive (cover, small inline contain,
  single-axis 100%, no-objectFit), negative (full-bleed contain,
  100vw/100vh variant), single-report invariant for multi-Img.

## Verification
- `npx jest __tests__/lib/remotion/sandbox.test.ts` → **93/93 pass**
- `npm --prefix plugin/remotion-eval test` → **41/41 pass**
- `bash scripts/pre-pr.sh feat/tm-176-objectfit-cover-lint` → safe

## Design notes
- **Why regex, not AST**: matches the existing sandbox conventions (TM-128,
  TM-168, TM-175 all regex-based). Plugin mirror has no React/DOM
  deps — must stay regex.
- **Why reject (not auto-scrub)**: per task spec — intentional letterbox
  exists (logo, badge). The full-bleed shape is the precise failure mode;
  reject so the LLM learns. Auto-scrub would mask the prompt-engineering
  signal.
- **False-positive guard**: only fires on the AND of three conditions.
  Small inline Imgs (`width: 200`) and single-axis full Imgs
  (`width:'100%'` + numeric height) are preserved.

## Follow-ups
- TM-173 regression corpus re-run (next overnight loop) should show
  the imageUrl/contain cases dropping from ~15% → 0.
- If sanitizer (`sanitizeCode`) ever auto-rewrites `contain` → `cover`,
  add the same gate (full-bleed + contain only), do NOT touch inline.
