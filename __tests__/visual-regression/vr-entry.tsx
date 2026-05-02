// Remotion entry point used exclusively by the TM-75 visual-regression
// driver. We can't reuse `src/remotion/UniversalComposition.tsx` directly
// because that module exports a Composition tree but never calls
// `registerRoot()` — the Next.js render path it was written for does the
// registration implicitly via its own runtime. The standalone
// `@remotion/bundler` requires an explicit registerRoot.
//
// Render contract: the driver passes `{ jsCode, params }` via inputProps and
// the composition evaluates the user-supplied component with the same
// evaluator the in-app preview uses (so we capture the *real* user-facing
// frame, not a re-implementation that could silently drift).
import React from 'react';
import { Composition, AbsoluteFill, registerRoot } from 'remotion';
import { evaluateComponent } from '@/lib/remotion/evaluator';

interface VRProps {
  jsCode: string;
  params: Record<string, unknown>;
}

const VRComponent: React.FC<VRProps> = ({ jsCode, params }) => {
  const Component = evaluateComponent(jsCode);
  if (!Component) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#1e1e2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#f38ba8', fontFamily: 'monospace', fontSize: 16 }}>
          Component evaluation failed (visual-regression entry)
        </div>
      </AbsoluteFill>
    );
  }
  return <Component {...params} />;
};

const VRRoot: React.FC = () => (
  <Composition
    id="VRComposition"
    component={VRComponent as unknown as React.FC<Record<string, unknown>>}
    // Long enough to cover the largest fps*1s capture frame across all 35
    // templates (60fps -> capture frame 60). Bumped to 480 to also let
    // selectComposition return a sensible value for very-short templates.
    durationInFrames={480}
    fps={60}
    width={1920}
    height={1080}
    defaultProps={{ jsCode: '', params: {} }}
  />
);

registerRoot(VRRoot);
