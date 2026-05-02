# Visual regression — TM-75

35 templates have a frozen "1-second mark" baseline PNG; every PR re-renders
and diffs against the baseline so silent visual drift is caught before merge.

## Files

```
__tests__/visual-regression/
├── README.md           ← this file
├── registry.mjs        ← 35 template metadata (id / file / fps / dims)
├── phash.mjs           ← sha256 + dHash + pixel-diff helpers (uses sharp)
├── phash.test.js       ← Jest unit tests for the diff helpers
├── vr-entry.tsx        ← dedicated Remotion entry (calls registerRoot)
├── run.mjs             ← driver — bundle once, render 35 frames, diff
└── baselines/          ← committed: <id>.png + meta.json (sha + dHash)
```

## Commands

```bash
# Compare current renders against baselines (CI mode — exits non-zero on drift).
npm run test:visual-regression

# Re-capture baselines after an intentional visual change.
npm run test:visual-regression:update

# Drill into one template (debugging).
node __tests__/visual-regression/run.mjs --only=counter-animation
```

## How the driver works

1. Bundle `vr-entry.tsx` (a tiny Remotion root that wraps `evaluateComponent`)
   once via `@remotion/bundler`.
2. For each template:
   - Read `src/remotion/templates/<File>.tsx`.
   - Apply the same `sanitizeCode` + sucrase transpile pipeline the in-app
     loader uses (`src/lib/templates.ts:loadTemplate`), so the captured frame
     is **literally what users see**, not a re-implementation.
   - `selectComposition` + `renderStill` at `frame = round(fps)` (the
     1-second mark — fps=30 ⇒ frame 30, fps=60 ⇒ frame 60).
3. Compute three signals on the resulting PNG:
   - **sha256** of the byte stream — exact-match channel.
   - **dHash** (9×8 grayscale → 64-bit fingerprint) — perceptual channel.
   - **pixelDiff** (64×36 grayscale, per-pixel delta > 12 counted) — drift score.
4. PASS if `pixelDiff.ratio < 5%` **and** `hammingDistance ≤ 12`. EXACT if
   sha matches. FAIL otherwise — the current frame is written as
   `baselines/<id>.current.png` for human inspection.

## Determinism evidence

The first end-to-end run after baseline capture produced
`EXACT sha-match=true` for all 35 templates — Remotion's headless Chrome
output is byte-for-byte stable across runs on the same machine. CI runners
may produce a few bits of jitter (font hinting, GPU vs swiftshader, etc.),
which is exactly what the dHash + pixelDiff fallbacks absorb.

## When you change a template

1. Make the visual change.
2. Run `npm run test:visual-regression` — expect FAILs on the touched templates.
3. Eyeball `baselines/<id>.current.png` next to `baselines/<id>.png`.
4. If the change is intentional, run `npm run test:visual-regression:update`
   and commit the refreshed PNGs + `meta.json`.

## Integrating into CI

```yaml
# .github/workflows/visual-regression.yml (example)
- run: npm ci
- run: npm run test:visual-regression
```

Total wall-clock: ~50–70s for 35 templates after the first cold bundle.
