---
title: "ADR-PENDING-TM-126: Audio integration policy — curated staticFile catalogue"
created: 2026-05-14
updated: 2026-05-14
tags: [decision, ai, sandbox, remotion, ux]
status: proposed
supersedes: []
related:
  - "[[0001-edit-not-equal-render|ADR-0001]]"
  - "[[0023-edit-params-isolation|ADR-0023]]"
  - "[[0014-sandbox-evaluator-hardening|ADR-0014]]"
spawned_from: TM-123
---

# ADR-PENDING-TM-126 — Audio integration policy (curated staticFile catalogue)

## Context

TM-123 (`wiki/05-reports/2026-05-14-TM-123-retro.md`) shipped a 4-layer
defense-in-depth that **rejects every `<Audio>` / `<Video>` / `<OffthreadVideo>`
/ `<IFrame>` JSX tag** at three levels: sandbox deny list, prompt-level
"VISUAL-ONLY POLICY" instruction, evaluator destructure trim, plus an MCP
plugin mirror. The fix unblocked a user-blocking `Html5Audio src TypeError`
cascade and is correct for the shipped runtime.

Side effect / open product question: **users who ask "BGM 추가해줘" /
"add background music" now hit a hard reject with no escape hatch.** This
is a known regression in product capability, accepted as the cost of the
TM-123 stop-the-bleed. The TM-123 spawn (this task) is the policy-level
follow-up that decides whether — and how — EasyMake re-introduces audio
without re-opening the failure mode.

Constraints we cannot violate:

- **ADR-0001 (Edit ≠ Render)**: edits must remain LLM-only, no server
  render in the edit path.
- **ADR-0023 (Edit PARAMS isolation)**: the LLM cannot freely invent
  arbitrary string URLs (or numeric values where strings are required).
- **TM-123 sandbox invariant**: arbitrary `<Audio src={anything}>` cannot
  reach the `<Player>` tree. The `Html5Audio` runtime check is unforgiving
  and cascades through `AudioContext` errors.
- **Cost / determinism**: any audio that survives to render time also has
  to survive Lambda export determinism (ADR-0017 capture-determinism).

## Options considered

### (A) Permanent visual-only — formalize the TM-123 deny as ADR

Codify "EasyMake generates visual-only Remotion compositions" as a
permanent product invariant. BGM / sound effects are out-of-scope for the
LLM-generated asset; if audio is ever needed, it is a **separate channel**
spliced in post-render (e.g. user uploads audio to the export workflow,
mixed by Lambda or an external editor).

- Pros: smallest surface area; the TM-123 fix becomes the spec, no new
  code paths to maintain; sandbox guarantee stays trivial.
- Cons: the user's "add BGM" request is permanently rejected with a hard
  no, which is a real product gap for short-form social-video use cases
  (TikTok / Reels / Shorts where audio drives engagement). Reduces
  product TAM.

### (B) Curated `staticFile` catalogue + string-only `src` validator (RECOMMENDED)

EasyMake ships a small, curated, royalty-free audio library (N ≈ 10-30
tracks, MIT/CC-0 licensed) under `public/audio/`. The LLM is given the
catalogue as a **closed enum** in the system prompt (filename + 1-line
mood description). When the user asks for BGM:

1. The LLM picks a catalogue entry by name and emits
   `<Audio src={staticFile("audio/<name>.mp3")} />` with no other
   `src` form permitted.
2. Sandbox validator gains a **scoped allow-list** that re-permits
   `<Audio>` **only when** the `src` attribute is a literal call to
   `staticFile()` whose argument is a string literal matching the
   catalogue regex (`^audio\/[a-z0-9-]+\.mp3$`). All other `<Audio>`
   shapes (numeric src, dynamic expressions, external URLs, missing
   src) remain rejected.
3. Customize UI exposes the selected track as a PARAMS key
   (`bgmTrack: "audio/upbeat-chill.mp3"`) so users can swap within the
   catalogue without re-prompting (ADR-0002 compatible).
4. `<Video>` / `<OffthreadVideo>` / `<IFrame>` stay fully denied —
   audio is the only escape hatch.

- Pros:
  - User BGM intent is satisfiable.
  - Sandbox guarantee preserved by structural validation (`src` must
    be a literal `staticFile("audio/…")` call, not an expression);
    impossible to leak the TM-123 failure mode because numeric / dynamic
    `src` is still rejected at the AST level.
  - Customize-UI binds via ADR-0002 with no convention break.
  - Royalty-free curation removes licensing risk.
- Cons:
  - Curation cost (selecting + tagging tracks, ~half-day one-time).
  - Catalogue must ship with the build (binary asset weight: ~30-50MB
    for 20 tracks at 192 kbps ~30s).
  - Sandbox AST check is more complex than the current regex deny —
    needs a small structural matcher (or compromise: regex requiring
    `src={staticFile("audio/` literal substring, with negative tests).
  - Lambda export must include `public/audio/` in the bundle;
    Remotion Lambda already does this for `staticFile` so no new code,
    just a deployment-size impact.

### (C) Post-render Lambda audio overlay (preview muted)

Edit / preview path stays strictly visual-only (TM-123 invariant
unchanged). Audio is a parallel channel: the user picks a track in a
new "Audio" tab on the export modal, and the export Lambda mixes it in
during the final render.

- Pros: zero LLM-prompt risk (the model never emits audio JSX); 100%
  preserves the TM-123 sandbox.
- Cons:
  - No preview-time audio = users cannot tune timing/sync against the
    visual.
  - New UI surface (export-time audio picker) + new Lambda mix step.
  - Doesn't satisfy users who explicitly said "the BGM should drop on
    the third beat" — sync requires preview audio.
  - Larger engineering footprint than (B) and worse UX.

## Decision

**Option B — Curated `staticFile` catalogue with string-literal-only `src`
validator, accepted as ADR-PENDING-TM-126.**

Rationale:

- B is the only option that satisfies both the user's "add BGM" intent
  AND the TM-123 sandbox invariant. (A) loses product capability;
  (C) loses preview-time sync UX and adds more engineering than B.
- The structural validator (literal `staticFile("audio/…")` only) is
  a narrow, testable rule that we can mirror in `plugin/remotion-eval`
  alongside the existing TM-115 deny-list-sync invariant.
- Compatibility: ADR-0001 unchanged (edits remain LLM-only — the model
  picks a track string, not a URL). ADR-0023 unchanged (catalogue track
  swap is a single PARAMS key). ADR-0002 unchanged (track is just a
  PARAMS string).

## Implementation outline (deferred to follow-up tasks — NOT this ADR)

This ADR is **policy only**. Code/infra work split into follow-ups so
each can land independently behind tests:

1. **TM-126-spawn-1 — Audio catalogue curation + asset import.** Pick
   10-20 royalty-free tracks (CC-0 / MIT-0), normalize to 192 kbps mp3,
   30s each, drop into `public/audio/`, write `public/audio/MANIFEST.json`
   with `{ filename, mood, bpm, license, attribution? }` schema. Owner:
   product / curation; not engineering-blocking.
2. **TM-126-spawn-2 — Sandbox `<Audio>` allow-list (structural).**
   Extend `src/lib/remotion/sandbox.ts` with an "Audio: only when src is
   a literal `staticFile("audio/…mp3")` call" rule. Mirror in
   `plugin/remotion-eval/src/validate.ts` (TM-115 sync invariant). Add
   exhaustive negative cases: numeric src, template-string src, variable
   src, external URL, path traversal (`audio/../../foo`), wrong
   extension. **Re-evaluator** must also re-include `staticFile` (already
   present per TM-116) — no change.
3. **TM-126-spawn-3 — Prompt update: catalogue enum + emission rule.**
   Replace the TM-123 hard "no Audio" block with a "Audio is allowed
   ONLY via `<Audio src={staticFile("audio/<name>.mp3")} />` from this
   closed list: …" block. Keep `<Video>` / `<OffthreadVideo>` / `<IFrame>`
   denied. ADR-0023 isolation rule still applies.
4. **TM-126-spawn-4 — Customize UI: BGM track picker + preview play.**
   When PARAMS contains a `bgmTrack` (or any string matching the
   catalogue regex), render a dropdown bound to the catalogue manifest
   with an in-place play/pause preview. ADR-0002 PARAMS auto-extract
   handles the binding for free.
5. **TM-126-spawn-5 — Lambda render: bundle `public/audio/` + verify
   determinism.** Confirm Remotion Lambda includes `public/audio/` in
   the deploy bundle (it should via `staticFile`); add a render smoke
   test that exports a 5s composition referencing a catalogue track and
   asserts the audio track is present in the output mp4 with correct
   duration.

These are **separate tasks** — this ADR's scope ends at the policy
decision. Spawn proposal in the retro JSON below.

## Consequences

Pros (decision-level):

- The "add BGM" user request becomes satisfiable without breaking the
  TM-123 sandbox.
- Product gains differentiation for short-form social video output.
- All existing ADRs (0001 / 0002 / 0023) remain compatible — no
  superseding required.

Cons / accepted trade-offs:

- Audio variety is bounded by curation; users cannot bring their own
  audio in v2 (deferred to v3 — would need upload + license verification
  flow).
- Build artifact size grows by ~30-50MB.
- Sandbox validator complexity grows from regex to AST-shape check
  (small but real maintenance cost).
- Until TM-126-spawn-2 ships, the TM-123 deny remains in effect — users
  still get "no audio" until the catalogue+validator pair lands.

## Validation criteria (for the spawn tasks, not this ADR)

- All TM-123 visual-only test cases continue to pass (no regression).
- New tests: every shape of malformed `<Audio src=…>` outside the
  catalogue allow-list is rejected; every catalogue-conformant call is
  accepted.
- Lambda export of an audio-bearing composition produces an mp4 with
  the expected audio track length.
- Customize UI swap of `bgmTrack` does not trigger an LLM edit (track
  swap is pure PARAMS, ADR-0002).

## References

- `wiki/05-reports/2026-05-14-TM-123-retro.md` — fix that motivated this ADR
- `src/lib/remotion/sandbox.ts` — current TM-123 deny list
- `src/lib/ai/prompts.ts` — current "VISUAL-ONLY POLICY" block
- `plugin/remotion-eval/src/validate.ts` — MCP mirror (TM-115 sync)
- `[[0001-edit-not-equal-render|ADR-0001]]` — Edit ≠ Render (compatible)
- `[[0002-customize-ui-auto-extract|ADR-0002]]` — PARAMS auto-extract (compatible)
- `[[0023-edit-params-isolation|ADR-0023]]` — single-key edit (compatible)
- `[[0014-sandbox-evaluator-hardening|ADR-0014]]` — sandbox invariant baseline
