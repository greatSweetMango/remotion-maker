// TM-131 — dedicated Remotion entry for the audio-bundle smoke test.
//
// We don't reuse `src/remotion/export-entry.tsx` because the production
// export evaluator (TM-123) intentionally OMITS `Audio` from the user JS
// scope: visual-only policy means user-supplied jsCode cannot emit
// `<Audio>` tags. ADR-0026 §B then re-enables `<Audio>` ONLY when src is a
// `staticFile("audio/...")` literal, mixed in at the composition level — not
// via the user-jsCode sandbox.
//
// This entry mirrors that contract: the composition itself owns the
// `<Audio>` tag pointing at a curated `public/audio/` track, so we can
// verify the Remotion bundle pipeline (bundle -> serveUrl -> renderMedia)
// actually carries `public/audio/` files into the rendered mp4.
import React from 'react';
import { Composition, AbsoluteFill, Audio, staticFile, registerRoot } from 'remotion';

const TRACK = 'audio/chill-driftwood.mp3';

const AudioSmokeComponent: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: '#1e1e2e' }}>
    <Audio src={staticFile(TRACK)} />
  </AbsoluteFill>
);

const AudioSmokeRoot: React.FC = () => (
  <Composition
    id="AudioBundleSmoke"
    component={AudioSmokeComponent}
    // 5s @ 30fps = 150 frames — matches ADR-0026 §5 smoke spec.
    durationInFrames={150}
    fps={30}
    width={640}
    height={360}
  />
);

registerRoot(AudioSmokeRoot);
