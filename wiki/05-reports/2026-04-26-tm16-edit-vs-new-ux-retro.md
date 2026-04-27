# TM-16 — Edit vs Generate-new UX (RP-06)

## Outcome
- PR #17 opened. 116/116 tests pass, lint+typecheck clean.
- Replaced `useState mode` + `useEffect(setMode('edit'))` with pure `effectiveMode(hasAsset, userOverride)` helper. Eliminates React 19 set-state-in-effect warning that recurred in TM-13/14 retros.
- UX: distinct color/icon per mode (violet+Pencil for Edit, emerald+Plus for Generate-new), live helper strip, panel-scoped ⌘E/⌘N shortcuts.

## Decisions
- ⌘N is panel-scoped (not `window`) — doesn't hijack browser native "new tab".
- `modeOverride: PromptMode | null` — extensible for future modes.

## Follow-ups
- jsdom test env for ⌘N/⌘E interaction tests
- Promote `effectiveMode` to shared `lib/` if pattern reused
