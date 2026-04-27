# TM-5 Template gallery expansion

**Status**: shipped — PR #11
**Verdict**: APPROVE

## Outcome
13 → 25 templates. Added: LineChart, DonutChart, AreaChart, ProgressBar, GlowingText, WaveText, RotatingText, LogoReveal, ZoomTransition, ParticleField, Timeline, IconBadge.

## Type changes
- `Template['category']` extended with `'transition' | 'infographic'`
- FilterBar exposes Transitions / Infographics / Compositions chips

## Conventions honored
- ADR-0002 PARAMS const + typed comments
- AbsoluteFill root
- PascalCase top-level (evaluator extractor compat)
- TM-17 palette keys (primaryColor/secondaryColor/accentColor/backgroundColor/textColor)

## Validation
- tsc / eslint clean (1 pre-existing warning in ComicEffect untouched)
- jest 58/58 pass

## Process notes
TeamLead executed directly without build-team — scaffolding-style work with high boilerplate-to-novelty ratio is faster solo. Saved ~10-15 min orchestration overhead.

## Follow-ups
- public/templates/*.gif previews (Remotion Studio still snapshot)
- Visual QA in /gallery
