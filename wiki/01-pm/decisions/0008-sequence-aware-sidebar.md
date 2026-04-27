---
title: "ADR-0008: Sequence-Aware Sidebar Context"
date: 2026-04-26
status: accepted
tags: [adr, studio, ux, tm-28]
---

# ADR-0008 — Sequence-Aware Sidebar Context

## Context
TM-27 shipped three long-form composition templates (ProductIntro 60s, DataStory 45s, HighlightReel 30s). Each carries 10–13 PARAMS spanning multiple `<Sequence>` segments. With existing CustomizePanel showing every parameter in one flat scroll, user editing the intro shot sees feature/outro knobs that don't affect the current frame.

## Decision
Sequence-aware sidebar that filters PARAMS to whichever sequence the Player's playhead currently sits in, with explicit user override (All mode + click-to-jump timeline + hotkeys).

Key choices:
1. **Metadata via PARAMS comment annotation.** `// sequence: <id>|<id>|global` after `type:`. Backward-compatible — annotation absent → key-prefix heuristic.
2. **Pure regex source parsing for `<Sequence>` tags.** No runtime execution.
3. **Single React Context (`ActiveSequenceProvider`).** Subscribes to PlayerRef frameupdate.
4. **Three modes:** auto-follow / sticky-select (click or `1-9` key) / all-mode (`A` key).
5. **Single-shot templates degrade gracefully** — `<2` segments → SequenceTimeline returns null.

## Consequences
- Cognitive load drops on long-form templates (intro shot: ~2 text + 4 colors instead of 13).
- Frame ↔ sidebar coupling feels like a video editor.
- New convention to teach LLM-generated templates (`// sequence:` annotation). Heuristic fallback covers most cases.
