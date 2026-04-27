'use client';
import React, { useMemo, useState } from 'react';
import { Player } from '@remotion/player';
import { evaluateComponentDetailed } from '@/lib/remotion/evaluator';
import { validateCode, sanitizeCode } from '@/lib/remotion/sandbox';
import { EvaluatorErrorBoundary } from '@/components/studio/EvaluatorErrorBoundary';

/**
 * Mirrors the validate → sanitize → evaluate pipeline used by the studio
 * (PromptPanel → asset.jsCode → PlayerPanel) so we can run TM-48 fuzz
 * cases against the *real* code paths from a Playwright test.
 */
export function EvalFixtureClient({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode);

  const { Component, sandboxError, evalError } = useMemo(() => {
    if (!code.trim()) {
      return { Component: null, sandboxError: null, evalError: null };
    }
    const v = validateCode(code);
    if (!v.valid) {
      return {
        Component: null,
        sandboxError: v.errors.join(', '),
        evalError: null,
      };
    }
    const sanitized = sanitizeCode(code);
    const r = evaluateComponentDetailed(sanitized);
    return { Component: r.component, sandboxError: null, evalError: r.error };
  }, [code]);

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#e2e8f0', padding: 24 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
        Evaluator fixture (dev only)
      </h1>
      <textarea
        data-testid="eval-fixture-input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={6}
        style={{
          width: '100%',
          fontFamily: 'monospace',
          fontSize: 12,
          background: '#1e293b',
          color: '#e2e8f0',
          padding: 8,
          border: '1px solid #334155',
          borderRadius: 4,
          marginBottom: 16,
        }}
      />
      <div
        data-testid="eval-fixture-output"
        style={{
          minHeight: 240,
          background: '#0f172a',
          border: '1px solid #1e293b',
          borderRadius: 8,
          padding: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {sandboxError ? (
          <div data-testid="sandbox-error-panel" style={{ textAlign: 'center', maxWidth: 360 }}>
            <p style={{ fontWeight: 500 }}>이 코드는 안전 정책에 의해 차단되었어요.</p>
            <p style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>
              차단 이유는 콘솔/로그에서 확인할 수 있어요.
            </p>
            <p data-testid="sandbox-error-kind" style={{ fontSize: 10, marginTop: 6, color: '#475569' }}>
              ({sandboxError})
            </p>
          </div>
        ) : evalError ? (
          <div data-testid="evaluator-error-panel" style={{ textAlign: 'center', maxWidth: 360 }}>
            <p style={{ fontWeight: 500 }}>{evalError.userMessage}</p>
            {evalError.hint && (
              <p style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>{evalError.hint}</p>
            )}
            <p data-testid="evaluator-error-kind" style={{ fontSize: 10, marginTop: 6, color: '#475569' }}>
              ({evalError.kind})
            </p>
          </div>
        ) : Component ? (
          <EvaluatorErrorBoundary resetKey={code.length}>
            <div style={{ width: 240, height: 135 }}>
              <Player
                component={Component as React.ComponentType<Record<string, unknown>>}
                inputProps={{}}
                durationInFrames={60}
                fps={30}
                compositionWidth={320}
                compositionHeight={180}
                style={{ width: '100%', height: '100%' }}
                autoPlay
                loop
              />
            </div>
          </EvaluatorErrorBoundary>
        ) : (
          <p data-testid="empty-state" style={{ color: '#64748b' }}>
            (no code)
          </p>
        )}
      </div>
    </div>
  );
}
