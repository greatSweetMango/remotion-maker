'use client';
import * as RemotionLib from 'remotion';
import React from 'react';

type RemotionComponent = React.ComponentType<Record<string, unknown>>;

const componentCache = new Map<string, RemotionComponent>();

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

      return typeof GeneratedAsset !== 'undefined'
        ? GeneratedAsset
        : typeof Component !== 'undefined'
        ? Component
        : null;
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
