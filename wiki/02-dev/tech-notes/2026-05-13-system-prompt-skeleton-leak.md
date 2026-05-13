---
title: System-prompt skeleton markers leak into LLM output (TM-120)
date: 2026-05-13
tags: [tech-note, gotcha, ai/prompts, gpt-4o-mini]
related: [TM-120, TM-51, TM-100]
---

# Gotcha: never put skeleton-marker comments in LLM example blocks

## The trap
When showing a code shape to an LLM via system prompt, do NOT use placeholder
comments like:

```text
// ... all params
// animation logic
{/* component content */}
// Complete TSX code here
```

`gpt-4o-mini` (and other smaller models) **copy these tokens verbatim** into
their output. Larger models (Claude Sonnet, gpt-4o) usually paraphrase them
out, but smaller models treat them as canonical structure.

## How we got burned
TM-120: `GENERATION_SYSTEM_PROMPT` had:

```typescript
export const GeneratedAsset = ({
  primaryColor = PARAMS.primaryColor,
  speed = PARAMS.speed,
  // ... all params
}: typeof PARAMS = PARAMS) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps, width, height } = useVideoConfig();
  // animation logic
  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      {/* component content */}
    </AbsoluteFill>
  );
};
```

Live measurement: `gpt-4o-mini` left at least one skeleton marker in **66.7%**
of "tricky subject" prompts (living entities, narrative scenes). TM-51's
`detectPlaceholderCode` caught them, but the retry tax was significant and
3-strike fallback fired occasionally in production.

## The rule
- Make every example body concrete. Real identifiers, real interpolate math,
  real JSX text.
- If you must mark "user content goes here", make it impossible to copy as
  code — e.g. put it in prose above the fenced block: *"Replace `Demo` with
  the user's subject."*
- Add an explicit FORBIDDEN clause listing exact strings that must never
  appear in output.

## Detector remains in place
`detectPlaceholderCode` in `src/lib/ai/generate.ts` still asserts these
markers as placeholder signals. Belt and suspenders — if a future prompt
edit reintroduces the leak, the detector will still catch it (now with the
zero-cost guard test added in `__tests__/lib/ai/generate.test.ts`).
