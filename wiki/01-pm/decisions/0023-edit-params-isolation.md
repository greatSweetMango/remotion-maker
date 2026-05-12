---
title: "ADR-0023: Edit PARAMS isolation — strict single-key change policy"
created: 2026-05-13
updated: 2026-05-13
tags: [decision, ai, edit, pm]
status: accepted
supersedes: []
related: ["[[0002-customize-ui-auto-extract|ADR-0002]]", "[[0003-prompt-caching|ADR-0003]]"]
---

# ADR-0023 — Edit PARAMS isolation (strict single-key policy)

## Context

TM-55 r2 (`wiki/05-reports/2026-05-12-TM-55-tm42-r2.md`) ran the full 20-set ×
3-turn edit corpus (60 OpenAI edit attempts) and uncovered 4 cases (6.7%) of
"unintended change" — edits where the LLM mutated a PARAMS key the user did
not name. All 4 cases fell into two semantic families:

- **color family** (set-06, set-07 on the `color` turn): user asked to change
  `primaryColor` and the model also touched `secondaryColor` / `accentColor`
  to "harmonize" the palette.
- **speed family** (set-07, set-16 on the `speed` turn): user asked to set
  `speed=1.5` and the model also adjusted `duration` / `animDuration` to
  preserve total runtime.

PARAMS lost = 0 / 60 (data-integrity preserved). The 4 unintended changes are
semantically reasonable but they break the customize-UI contract: ADR-0002
specifies that customize sliders bind 1:1 to PARAMS keys, and the user
expects a single-slider change to map to a single LLM-edit. Silent co-update
makes the UI's state untrustworthy and surprises power users who want fine
control.

## Decision

**Strict isolation, Option B** — the edit prompt MUST instruct the model to
change only the keys explicitly named by the user. All other existing PARAMS
keys must keep their exact RHS byte-for-byte.

Concretely:

- `src/lib/ai/prompts.ts::EDIT_SYSTEM_PROMPT` gains a "PARAMS ISOLATION GUARD"
  section (see code) that:
  - tells the model to identify the MINIMAL set of targeted keys,
  - forbids "improving / harmonizing / rebalancing" related keys,
  - permits free changes OUTSIDE the PARAMS block (component logic, JSX, new
    scenes) — isolation applies to PARAMS values only,
  - says "when in doubt, prefer NOT changing a key."
- Code outside `PARAMS` is unaffected — `scene` edits (turn 2 in the corpus)
  still get full freedom to grow the component.

### Rejected alternatives

- **Option A — allow family co-update + add customize-UI co-update preview.**
  Larger surface area (UI work in customize panel) and harder to reason about
  for users who never opt in. Possible future enhancement, not now.
- **Option C — hybrid (allow color/speed family, strict elsewhere).** Adds
  rule-based gates that drift as new PARAMS conventions emerge; the per-family
  "what counts as related" question has no stable answer. Worst of both worlds.

## Consequences

Pros:

- Customize UI / edit-prompt contract is now coherent: one user request →
  one key change.
- Deterministic acceptance signal — `unintendedChangeZero` becomes a real
  pass/fail rather than a heuristic.
- No UI changes required.

Cons / trade-offs:

- Sometimes a "color change" leaves a visually mismatched palette until the
  user does a follow-up edit. Acceptable: the customize panel already lets
  users pick any color independently, and follow-up edits are cheap.
- The driver's `intentKey='primaryColor'` assumption can still false-positive
  when the asset's PARAMS use a different key name (e.g. `fromColor`). The
  model is correctly substituting the closest semantic key — that's a driver
  issue, not a prompt issue. Driver fix (event vs change counting) is part of
  the same PR.

## Validation

Re-ran `scripts/qa/tm-42-edit-flow.mjs` against the same 20-set corpus with
this prompt:

- r2 (pre-fix): 4 unintended changes across 60 edits.
- r3 (post-fix): see `wiki/05-reports/2026-05-13-TM-86-retro.md` for the numbers.

PARAMS lost remains 0 / 60.

## References

- `src/lib/ai/prompts.ts:520` — `EDIT_SYSTEM_PROMPT`
- `scripts/qa/tm-42-edit-flow.mjs` — corpus driver
- `wiki/05-reports/2026-05-12-TM-55-tm42-r2.md` — r2 baseline data
- ADR-0002 — customize-UI auto-extract contract
- ADR-0003 — prompt caching (system prompt change invalidates cache key — accepted cost)
