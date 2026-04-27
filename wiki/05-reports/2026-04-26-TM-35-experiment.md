# 2026-04-26 — TM-35 Gallery Instant Variant (experiment)

- Type: experiment / feature / demo-impact / frontend-ui
- PR: https://github.com/greatSweetMango/remotion-maker/pull/9
- Branch: TM-35-gallery-instant-variant
- Verdict: **APPROVE** — adopt as default, file follow-up standardization task.

## What shipped
- `src/lib/instant-variant.ts`: `pickPrimaryColorParameter`, `buildInstantVariantInputProps`, `INSTANT_SPEED_PRESETS`, `DEFAULT_INSTANT_SPEED`.
- `src/components/studio/TemplatePicker.tsx`: hover-intent + long-press driven mini control strip with color picker + speed presets, memoized inputProps, `<Player playbackRate>` wiring.
- 10 new unit tests (43 → 53 total, 0 regressions). Lint + typecheck clean.

## Hypothesis check
> 템플릿을 클릭 없이 인스턴트 변형하면 발견성과 시연 임팩트가 크게 증가한다.

The coding work confirmed the hypothesis is *cheaply implementable* (≈ 1 helper, 1 component, ~350 LoC including tests/comments) without breaking ADR-0001 (edit ≠ render — we still don't render server-side here) or ADR-0002 (PARAMS auto-extract — we read from it, never mutate). Demo wow is qualitative and was not measurable in this offline run; reviewer is asked to validate during next live demo.

## What worked
- TM-17's `palettes.ts` heuristic dropped right in — saved an extra ADR for color routing.
- Routing speed through `<Player playbackRate>` instead of a PARAMS key avoided forcing every template to expose `speed`.
- Hover-intent + long-press symmetry kept the desktop/mobile branch from forking into two implementations.

## What hurt
- 5-concurrent-hover FPS test was specced but not measurable without a live dev server in this run. Reframed: the realistic worst case is **one** active hover + 9 idle Players, which already exists today. Documented as a follow-up benchmark task instead of a blocker.
- Touch UX is implemented as long-press but not validated on a real device.

## Follow-ups
1. Standardize PARAMS naming (`primaryColor`/`secondaryColor`/etc.) across stock templates so `pickPrimaryColorParameter` always takes the explicit branch.
2. Decide carry-over policy: click-with-active-override → studio inherits override (or not).
3. Add a real-device manual QA pass for long-press.
4. (Optional) Live-demo wow-rate measurement next pre-launch session.
