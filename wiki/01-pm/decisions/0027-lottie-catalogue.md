---
title: "ADR-0027: Lottie integration policy — curated staticFile catalogue for living-entity motion"
created: 2026-05-15
updated: 2026-05-15
tags: [decision, ai, sandbox, remotion, ux, character]
status: accepted
supersedes: []
related:
  - "[[0001-edit-not-equal-render|ADR-0001]]"
  - "[[0002-customize-ui-auto-extract|ADR-0002]]"
  - "[[0014-sandbox-evaluator-hardening|ADR-0014]]"
  - "[[0022-character-rendering|ADR-0022]]"
  - "[[0023-edit-params-isolation|ADR-0023]]"
  - "[[0026-audio-policy|ADR-0026]]"
spawned_from: TM-140
depends_on: [TM-135, TM-90]
---

# ADR-0027 — Lottie integration policy (curated `staticFile` catalogue)

## Context

TM-135 RCA (`wiki/05-reports/2026-05-14-TM-135-quality-rca.md`) traced the
"곰돌이 → 갈색 원" regression to a structural capability gap: the LLM
emits Remotion code, and Remotion code expressed as React/SVG/Canvas
primitives **cannot render a recognisable bear, dog, person, or any other
living entity** at acceptable quality. ADR-0022 picked image-gen
(`gpt-image-1`) as the primary fix, but image-gen has two residual
problems for living-entity prompts:

1. **Static images don't move.** A "bear walking" prompt yields a still
   bear; the user sees a Ken-Burns pan over a static asset, not a
   walk-cycle. ADR-0022 §B explicitly acknowledged this gap and deferred
   it ("motion overlay is a follow-up").
2. **Per-asset cost + 5–15s latency** ($0.011–$0.166 per gen — TM-92
   bench) for the most common motion shape (idle/walk/dance loops) is
   wasteful when those loops are *the same across users* and could be
   served from a curated, free, royalty-cleared catalogue.

The audio side already solved this exact shape with ADR-0026: a small
curated catalogue under `public/audio/`, a manifest, an allow-listed
wrapper component (`<CatalogueAudio>`, ADR-0026 §B), and a sandbox that
admits the wrapper unconditionally because the underlying media tag is
emitted internally with a known-shape literal. We intentionally mirror
that pattern here for Lottie animations.

[LottieFiles](https://lottiefiles.com) hosts thousands of free Lottie
JSON animations including walk cycles, idle loops, and other
living-entity motions that map cleanly to user prompts like "bear
walking", "dog running", "person dancing". Remotion's official
`@remotion/lottie` package (`v4.0.448`, same major as our existing
Remotion deps) provides a typed `<Lottie>` component that uses
`lottie-web` to render and seek the animation deterministically per
frame.

Constraints we cannot violate:

- **ADR-0001 (Edit ≠ Render)**: edits stay LLM-only. Catalogue track
  selection is a single PARAMS string; no server render in the edit
  path.
- **ADR-0002 (PARAMS auto-extract)**: catalogue selection must surface
  as a `lottieAsset` PARAMS entry so the customize UI auto-binds.
- **ADR-0014 / TM-128 sandbox**: the LLM cannot freely invent arbitrary
  string URLs reaching `<Lottie>` (Lottie JSON can carry embedded
  expressions; an attacker-supplied JSON could exploit `lottie-web`).
- **ADR-0023 (PARAMS isolation)**: asset swap is a single PARAMS key,
  no LLM round-trip.
- **Determinism (ADR-0017)**: per-frame Lottie seeking is deterministic
  via `lottie-web .goToAndStop()`; expression-heavy Lottie files are
  not — curation excludes them.

## Options considered

### (A) No Lottie — keep TM-135 image-gen + motion overlay TBD

Stay on the ADR-0022 path: image-gen for living entities, defer motion
to a future "Ken-Burns + bone rig" experiment.

- Pros: zero new deps, zero new sandbox surface.
- Cons: walk-cycle / idle-loop user prompts continue to render as
  static images for the foreseeable future; the most-requested motion
  shape (per TM-135 follow-up) stays unsatisfied.

### (B) Curated Lottie catalogue + `<CatalogueLottie>` wrapper (RECOMMENDED — mirrors ADR-0026)

Ship a small, curated, **CC0 / MIT** Lottie catalogue (initial N ≈
5–10, scaling to 20–30 with curation) under `public/lottie/`. The LLM
gets the catalogue as a closed enum in the system prompt (filename +
1-line motion description: "bear-walk: side-view bear walking loop",
etc.). For living-entity prompts:

1. The LLM picks a catalogue entry by name and emits
   `<CatalogueLottie asset={lottieAsset} loop playbackRate={1} />`.
2. The wrapper validates `asset` against the catalogue filename regex
   (`^[a-z0-9-]+\.json$`, mirrors ADR-0026 audio shape), strips any
   `lottie/` prefix, fetches `staticFile("lottie/<slug>.json")`
   inside `useEffect` with `delayRender`/`continueRender` (Remotion
   doc-recommended pattern), and renders `<Lottie animationData={...}>`
   only when the JSON has loaded. Invalid `asset` → `null` (no
   `lottie-web` cascade — same risk shape TM-123 fixed for `<Audio>`).
3. Sandbox: `<CatalogueLottie>` is unconditionally allowed (the
   regex `<\s*Lottie\b` does not match `<CatalogueLottie`, identical
   to the ADR-0026 §B carve-out for `<CatalogueAudio>`). The bare
   `<Lottie>` tag stays denied — only the wrapper's internal,
   known-shape emission reaches Remotion.
4. Customize UI exposes the selection as a PARAMS key
   (`lottieAsset: "lottie/bear-walk.json"`) — ADR-0002 auto-binds.
5. `@remotion/lottie` and `lottie-web` are added as dependencies (1
   official Remotion package + its peer dep — same shape as the
   existing `@remotion/player`/`@remotion/renderer` deps).

- Pros:
  - Walk-cycle / idle-loop / dance-loop user intents become satisfiable
    at zero per-asset cost and zero extra latency (catalogue ships
    with the build).
  - Sandbox guarantee preserved by structural validation +
    wrapper-only emission — impossible to leak arbitrary `<Lottie>`
    or arbitrary JSON URLs.
  - Pattern mirror with ADR-0026 audio means engineers, prompt
    writers, and reviewers already know this shape — low cognitive
    overhead.
  - Customize-UI swap is pure PARAMS, ADR-0002 / ADR-0023 compatible.
  - All curated assets are CC0 or MIT — no licensing risk.
- Cons:
  - Catalogue is finite — uncovered prompts (e.g. "an octopus
    juggling") fall back to image-gen (ADR-0022) for the static frame
    and miss the motion benefit.
  - One-time curation cost (selecting + license-vetting + sha256-ing
    ~5–30 Lottie JSONs).
  - Catalogue ships in the build — Lottie JSON is small (typically
    <100KB each, no binary blobs) so 30 files ≈ 1–3MB, far smaller
    than the audio catalogue (~30–50MB).
  - `@remotion/lottie` + `lottie-web` add ~100KB to client bundle
    (`lottie-web` is the bulk; tree-shakeable but Remotion uses the
    full surface).
  - Lottie expression-heavy files render non-deterministically per
    Remotion docs — curation MUST exclude expression-only animations
    and verify each candidate with `getLottieMetadata()` + visual
    smoke test.

### (C) Inline Lottie JSON in the LLM-emitted code

Let the LLM emit the Lottie JSON inline as a JS object literal.

- Pros: no catalogue, no fetch, fully editable per prompt.
- Cons: Lottie JSON is large (KB to MB) and structurally complex —
  blows the LLM token budget, breaks ADR-0003 prompt-cache stability,
  and the LLM cannot author a working Lottie from scratch any more
  than it can author a working bear illustration. Hard reject.

## Decision

**Option B — Curated Lottie `staticFile` catalogue with
`<CatalogueLottie>` wrapper, accepted as ADR-0027.**

Rationale:

- B is the only option that gives users actual living-entity motion
  (walk cycles, dance loops, idle bobbing) at acceptable cost and
  latency, while preserving every existing sandbox / cache / PARAMS
  invariant.
- Mirroring ADR-0026's audio architecture is a deliberate design
  choice: same manifest schema (filename + license + sha256 + metadata),
  same allow-list mechanism (wrapper-prefixed tag), same client-safe
  vs server-only loader split (TM-133 lesson — see "Implementation
  outline" §5).
- Compatibility: ADR-0001 unchanged (catalogue swap is a PARAMS string
  edit, no server render). ADR-0002 unchanged. ADR-0014/TM-128
  unchanged (the bare `<Lottie>` tag stays in the deny list).
  ADR-0022 enhanced — image-gen remains the fallback for non-catalogue
  living entities; this ADR only carves out a fast path for the most
  common motion shapes.
- `@remotion/lottie` is an official Remotion package on the same
  `4.0.x` line as our existing Remotion deps — adopting it carries
  the same upgrade-risk profile as any other `@remotion/*` package
  we already use.

## Implementation outline (deferred to follow-up tasks)

This ADR establishes policy + ships the wrapper scaffold. The actual
catalogue curation is a separate, async task because it requires
human review of LottieFiles entries for license + visual quality.

1. **TM-140 (this task) — wrapper + manifest schema + sandbox carve-out
   + initial placeholder.** Land:
   - `npm i @remotion/lottie lottie-web` (sole new deps; user-approved).
   - `src/lib/lottie/manifest-types.ts` (client-safe types + regex +
     `isValidCatalogTrack`-shaped predicate, mirrors TM-133 split).
   - `src/lib/lottie/manifest-loader.ts` (server-only fs loader +
     sha256 integrity check, identical pattern to audio).
   - `src/lib/lottie/manifest.ts` (client-safe barrel re-export).
   - `src/remotion/CatalogueLottie.tsx` (wrapper, validates `asset`,
     fetches via `delayRender`/`continueRender`).
   - `public/lottie/MANIFEST.json` v1 with one placeholder
     `bear-walk.json` entry (curation deferred — see TM-140-spawn-1).
   - `public/lottie/bear-walk.json` placeholder (minimal valid Lottie
     JSON — single circle bobbing 60f loop — so the wrapper renders
     non-null in dev/tests until real curation lands).
   - Evaluator scope injection — expose `CatalogueLottie` alongside
     `CatalogueAudio` (`src/lib/remotion/evaluator.ts`).
   - Sandbox: no change required (`<CatalogueLottie` does not match
     the existing `<\s*Lottie\b`-style deny would-be regex; bare
     `<\s*Lottie\b` is added to the deny list as a defence-in-depth
     mirror of the audio policy).
   - Tests: shape predicate + manifest parse + wrapper render + sandbox
     deny of bare `<Lottie>` + sandbox accept of `<CatalogueLottie>`.
2. **TM-140-spawn-1 — Catalogue curation (5–10 living-entity loops).**
   Source from LottieFiles (CC0/MIT only), download JSON, normalise
   filenames to slug regex, sha256-stamp, write MANIFEST.json entries
   with `motion`, `subject`, `license`, `attribution`, `durationFrames`,
   `fps`, `bytes`. Visual smoke test each candidate in dev studio to
   reject expression-heavy / non-deterministic files. Owner: product
   / curation; not engineering-blocking.
3. **TM-140-spawn-2 — Prompt update: catalogue enum + emission rule.**
   Extend the audio-policy block in `src/lib/ai/prompts.ts` with a
   parallel "Lottie is allowed ONLY via `<CatalogueLottie
   asset={lottieAsset} ... />` from this closed list: …" section.
   Keep image-gen (ADR-0022) as the fallback for non-catalogue living
   entities.
4. **TM-140-spawn-3 — Customize UI: Lottie picker + preview play.**
   When PARAMS contains a `lottieAsset` (or any string matching the
   catalogue regex), render a dropdown bound to the catalogue manifest
   with a small in-place preview (re-use the audio picker pattern
   from TM-130). ADR-0002 PARAMS auto-extract handles the binding.
5. **TM-140-spawn-4 — Lambda render verify.** Confirm Remotion Lambda
   bundles `public/lottie/` (it should via `staticFile`); add a render
   smoke test that exports a 5s composition referencing a catalogue
   Lottie and asserts the output mp4 contains the expected motion (e.g.
   pixel-diff first vs last frame).

## Consequences

Pros (decision-level):

- Living-entity walk/idle/dance prompts become satisfiable with real
  motion, no per-asset cost, sub-second latency.
- Mirrors ADR-0026 — engineers familiar with the audio policy can
  reason about the Lottie policy by analogy.
- Catalogue is small, free, and additive — no impact on existing
  template/render paths.
- ADR-0022 image-gen path remains unchanged for non-catalogue prompts.

Cons / accepted trade-offs:

- Bundle grows by `@remotion/lottie` + `lottie-web` (~100KB) + Lottie
  JSON catalogue (~1–3MB at 30 entries).
- Curation cost (one-time, then incremental).
- Coverage is bounded by curation; uncovered prompts fall back to
  image-gen (still better than TM-135 status quo).
- Sandbox deny list grows by one entry (`<\s*Lottie\b`) — small but
  real maintenance cost when adding future Remotion media tags.
- `lottie-web` carries its own upstream risk surface (the package is
  large, well-maintained, Apache-2.0; expression evaluation is the
  primary determinism risk and is mitigated by curation).

## Validation criteria

- `<CatalogueLottie>` with a valid `asset` prop renders the Lottie
  animation in dev studio + Lambda render.
- `<CatalogueLottie>` with `null` / invalid / traversal `asset` renders
  `null` and never throws.
- Bare `<Lottie>` tag in generated code is rejected by the sandbox
  deny list (deny-list parity with `<Audio>`/`<Video>`).
- `<CatalogueLottie>` in generated code passes the sandbox.
- Manifest parse rejects malformed entries (mirror audio test
  coverage: missing fields, wrong slug shape, duplicate filenames,
  bad sha256).
- Customize UI swap of `lottieAsset` does not trigger an LLM edit
  (PARAMS isolation per ADR-0023).

## References

- ADR-0026 — audio catalogue (sibling pattern this ADR mirrors).
- ADR-0022 — character rendering image-gen baseline.
- TM-135 RCA — `wiki/05-reports/2026-05-14-TM-135-quality-rca.md`.
- TM-133 retro — manifest client/server split lesson.
- Remotion docs — https://www.remotion.dev/docs/lottie
