'use client';
import * as RemotionLib from 'remotion';
import React from 'react';

type RemotionComponent = React.ComponentType<Record<string, unknown>>;

const componentCache = new Map<string, RemotionComponent>();

function buildReturnStatement(jsCode: string): string {
  // Find PascalCase component names (must have lowercase letters — excludes SCREAMING_CASE like PARAMS)
  const candidates = [...jsCode.matchAll(/(?:^|\n)\s*(?:const|function)\s+([A-Z][a-zA-Z0-9]*)\s*[=(]/g)]
    .map(m => m[1])
    .filter((name, i, arr) => arr.indexOf(name) === i) // dedupe
    .filter(name => /[a-z]/.test(name)); // PascalCase only, not SCREAMING_CASE

  const fallbacks = candidates
    .map(name => `if (typeof ${name} !== 'undefined') return ${name};`)
    .join('\n');

  return `
    if (typeof GeneratedAsset !== 'undefined') return GeneratedAsset;
    if (typeof Component !== 'undefined') return Component;
    ${fallbacks}
    return null;
  `;
}

export function evaluateComponent(jsCode: string): RemotionComponent | null {
  if (componentCache.has(jsCode)) return componentCache.get(jsCode)!;

  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function(
      'React',
      'remotion',
      `
      "use strict";
      const {
        useCurrentFrame, useVideoConfig, interpolate, interpolateColors,
        spring, AbsoluteFill, Sequence, Img, Easing
      } = remotion;

      ${jsCode}

      ${buildReturnStatement(jsCode)}
      `
    );

    const Component = factory(React, RemotionLib);
    if (typeof Component !== 'function') return null;

    const Wrapped: RemotionComponent = (props) => React.createElement(Component, props);
    Wrapped.displayName = 'EvaluatedAsset';

    componentCache.set(jsCode, Wrapped);
    return Wrapped;
  } catch (err) {
    console.error('Component evaluation failed:', err);
    return null;
  }
}

export function clearEvaluatorCache() {
  componentCache.clear();
}
