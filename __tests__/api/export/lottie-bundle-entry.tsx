// TM-147 / ADR-0027 §4 — dedicated Remotion entry for the Lottie-bundle smoke test.
//
// Mirror of `audio-bundle-entry.tsx` (TM-131). Verifies the ADR-0027
// claim that Remotion Lambda bundles `public/lottie/` via `staticFile`
// the same way it bundles `public/audio/`.
//
// We don't reuse `src/remotion/export-entry.tsx` because that entry runs
// the full evaluator pipeline against user-supplied jsCode. Here we want
// to exercise just the bundle / staticFile / `<CatalogueLottie>` path,
// owned by the composition itself.
import React from 'react';
import { AbsoluteFill, Composition, registerRoot } from 'remotion';
import { CatalogueLottie } from '@/remotion/CatalogueLottie';

// `bear-walk.json` is the canonical TM-144 catalogue entry (60f loop @ 30fps).
const ASSET = 'lottie/bear-walk.json';

const LottieSmokeComponent: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#1e1e2e' }}>
    <CatalogueLottie
      asset={ASSET}
      loop
      style={{ width: '100%', height: '100%' }}
    />
  </AbsoluteFill>
);

const LottieSmokeRoot: React.FC = () => (
  <Composition
    id="LottieBundleSmoke"
    component={LottieSmokeComponent}
    // 5s @ 30fps = 150 frames — matches ADR-0027 §4 smoke spec
    // (catalogue loop is 60f, so the composition spans ~2.5 loops).
    durationInFrames={150}
    fps={30}
    width={640}
    height={360}
  />
);

registerRoot(LottieSmokeRoot);
