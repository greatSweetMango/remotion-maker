import React from 'react';
import { Composition, AbsoluteFill } from 'remotion';
import { evaluateComponent } from '@/lib/remotion/evaluator';

interface UniversalCompositionProps {
  jsCode: string;
  params: Record<string, unknown>;
}

export const UniversalComposition: React.FC<UniversalCompositionProps> = ({ jsCode, params }) => {
  const Component = evaluateComponent(jsCode, params);

  if (!Component) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#1e1e2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#f38ba8', fontFamily: 'monospace', fontSize: 16 }}>
          Component evaluation failed
        </div>
      </AbsoluteFill>
    );
  }

  return <Component {...params} />;
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="UniversalComposition"
    component={UniversalComposition as unknown as React.FC<Record<string, unknown>>}
    durationInFrames={150}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ jsCode: '', params: {} }}
  />
);
