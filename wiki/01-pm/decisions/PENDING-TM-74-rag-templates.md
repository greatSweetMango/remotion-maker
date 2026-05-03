---
title: ADR-PENDING-TM-74 Reference-template RAG (simple keyword/category retrieval)
status: accepted
date: 2026-04-27
tags:
  - "#adr"
  - "#ai/generate"
  - "#rag"
  - "#tm-74"
related:
  - "[[0017-capture-determinism]]"
  - "[[0018-judge-determinism]]"
  - "[[2026-04-27-TM-74-fix]]"
---

# ADR-PENDING-TM-74: Reference-template RAG (simple keyword/category retrieval)

## Context

TM-46 r6 found the **prompt-only** visual-quality ceiling at ~70 mean score on
the acceptance gate. The dominant residual failure modes were:

- **data-viz**: missing axes/labels, single bar instead of full series,
  default purple swatch when the prompt asked for a different palette.
- **transition**: single-state output (no "before"/"after"), no midpoint
  blend frame.

TM-71 added category-specific guidelines (long bullet lists in the system
prompt) but the LLM still under-renders the patterns the prose describes.
A **worked example** of the target pattern is far more instructive than
another paragraph of rules.

We have 35 production-quality templates already authored under
`src/remotion/templates/`. They are the canonical visual reference for what
"good" looks like in this codebase. Injecting one as a reference per
generation should let the model imitate cadence, layout, animation timing,
and PARAMS shape — without us writing more rules.

## Decision

Introduce a **simple, dependency-free RAG retriever** that:

1. Infers a category (`chart` | `transition` | `text` | `background` | `counter`
   | `logo` | `composition` | `infographic`) from the user prompt via a small
   bilingual (KO/EN) regex catalog.
2. Picks the best in-category template via keyword tiebreak against a static
   metadata catalog (`REFERENCE_CATALOG` in `src/lib/ai/retrieval.ts`).
3. Reads that template's source from disk (cached) and appends it to the
   generation system prompt as a `REFERENCE TEMPLATE (RAG, TM-74)` block.

**Explicitly out of scope (separate task):**
- Embedding-based retrieval (needs a vector library + index store).
- Multi-template retrieval (top-k). For now we inject exactly **one**
  reference; richer context tradeoffs are a v2 concern.
- LLM-side rewriting of the reference into a "skeleton" (would add a hop).

## Consequences

### Positive

- **Zero new dependencies.** The retriever is ~250 lines of TS + a static
  catalog. No vector store, no embedding API call, no async setup.
- **Reversible.** A single boolean wrap or env flag can disable RAG injection.
- **Cache-friendly.** The reference for a given prompt is stable across
  retries within a single `generateAsset` invocation — preserves the
  ADR-0003 prompt-cache key on the system prompt block (which trails the
  reference unchanged).
- **Cheap context.** Template source is ~2-4KB; total system prompt grows
  ~10-20% per call. On Haiku/gpt-4o-mini the marginal cost is in the noise.

### Negative

- **Mis-categorization risk.** A pure regex inference will sometimes pick a
  wrong category for ambiguous prompts. Mitigated by:
  (a) returning `null` (and skipping injection) when no category dominates,
  (b) ordering categories so logo/intro wins over generic transition fade,
  (c) keyword tiebreak inside a category.
- **Reference can mislead the model.** If the reference uses a palette the
  user didn't ask for, the model may copy it verbatim. Mitigated by the
  reference block's instruction: "Use it as a structural guide. DO NOT copy
  it verbatim; adapt it to the user's actual subject, data, and palette."
- **Static catalog drift.** If we add a new template to
  `src/remotion/templates/` but forget to register it in `REFERENCE_CATALOG`,
  the retriever simply won't surface it. Acceptable for now; a future ADR
  may consume `getTemplates()` directly and dispense with the duplicate
  metadata.

## Alternatives considered

1. **Top-k embedding retrieval (OpenAI text-embedding-3-small, in-memory cosine).**
   Rejected for v1 because it adds a dependency, an async warmup, an extra
   per-call API hop, and still needs a category fallback. Tracked as a
   follow-up task; revisit when the simple version's lift is measured.

2. **Bigger system prompt (more rules, more bullets).**
   This is what TM-71 did and it left the ceiling at ~70. More words will
   not unlock more compliance — a worked example will.

3. **Inline a synthetic "skeleton" pseudo-code instead of real template.**
   Rejected because the 35 production templates already are the skeleton.
   A synthetic skeleton would drift from the actual visual language we ship.

## Validation

5 live prompts (chart x2 / transition / text / counter), Haiku/gpt-4o-mini,
cost ~$0.05 actual:

| prompt                                            | category  | ref               | result       |
|---------------------------------------------------|-----------|-------------------|--------------|
| 월별 매출 막대 차트 120,150,180,200,240,280       | chart     | bar-chart         | OK, contains 120/150/180 |
| 도넛 차트 40% 35% 25%, 카테고리별 라벨 포함       | chart     | donut-chart       | OK           |
| Slide transition L→R, 검정→흰색 두 패널 1.5초     | transition| logo-reveal*      | OK           |
| Typewriter "Hello, World" 모노스페이스            | text      | typewriter        | OK           |
| Animated counter 0 → 100, spring 효과             | counter   | counter-animation | OK           |

\* The transition prompt routed via category keyword; logo-reveal happened
to be the closest in-category exemplar registered. Future tuning: register
a dedicated `slide-transition` template if/when we author one.

A full TM-46 r7 acceptance-gate run (rag-on vs rag-off, ≥30 prompts) is
booked separately; the working hypothesis from TM-46 r6 RCA is **+10~15
mean** on data-viz / transition categories.

## See also

- `wiki/05-reports/2026-04-27-TM-74-fix.md` — implementation + retro
- `src/lib/ai/retrieval.ts` — retriever
- `src/lib/ai/generate.ts` — wiring
- `__tests__/lib/ai/retrieval.test.ts` — unit tests
- `__tests__/lib/ai/tm-74-live-validate.test.ts` — gated live smoke
- ADR-0003 (prompt caching on edit) — referenced for cache-key stability
