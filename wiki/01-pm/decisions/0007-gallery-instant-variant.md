# ADR-0007 — Gallery instant variant on hover

- Status: Accepted
- Date: 2026-04-26
- Source task: TM-35 (#experiment)
- PR: https://github.com/greatSweetMango/remotion-maker/pull/9

## Context
TemplatePicker thumbnails were inert: a Player previewed defaults, click opened studio. Hypothesis from TM-35: letting users tweak the most-impactful axes (primary color + speed) directly on the card — without leaving the gallery — meaningfully raises both discovery rate and demo wow. The cost we worried about: 10 concurrently autoplaying Players already exist in the grid, so any per-frame remount on hover would tank FPS.

## Decision
Adopt a *minimal* hover (or long-press) overlay strip with two controls only:
1. **Primary color picker** — drives a single PARAMS key chosen by `pickPrimaryColorParameter` (reuses TM-17 `mapColorKeyToSlot`: prefers explicit `primary*`/`main*` keys, then any non-background/non-text color, then first color, else hidden).
2. **Speed presets (0.5x / 1x / 2x)** — flows through `<Player playbackRate>` rather than mutating PARAMS, so it works uniformly across templates that don't expose a `speed` param and stays non-destructive.

State policy: overrides reset on `mouseLeave` — instant variant is *exploratory*, not sticky. Click still opens studio with template defaults.

Interaction:
- Desktop: 180ms hover-intent debounce before the strip appears (prevents flashing on cursor fly-throughs).
- Touch: 500ms long-press opens the strip; tap on the card itself still selects.

Performance contract: `inputProps` is memoized on `[template, override.colorKey, override.colorValue]`. This is **load-bearing** — without it, every keystroke on the color input remounts the Remotion composition.

## Consequences
- Positive: Adds two-axis live exploration with one helper (`src/lib/instant-variant.ts`, +10 tests) and one component edit. No new dependency, no PARAMS churn, no API surface change for templates.
- Positive: Heuristic-based primary-color resolution means existing 10 templates work today; a future PARAMS naming convention (`primaryColor` etc.) only improves matching.
- Negative / accepted: Hover-out resets the override. If a user finds a great variant they must reproduce it in studio. Re-evaluate after first user feedback round.
- Negative / accepted: 1080p Player + live `inputProps` change is fine for one focused cell, but if we later expand to *all 10* simultaneously animating with overrides we must benchmark — out of scope for this ADR.

## Follow-up
1. Standardize PARAMS color keys across the 10 stock templates so `pickPrimaryColorParameter` always hits the explicit-primary branch.
2. Decide whether clicking a card with an active override should carry the override into studio (currently does **not**).
3. Track perceived demo wow rate qualitatively in the next pre-launch demo session.
