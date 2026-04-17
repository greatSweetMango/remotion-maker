'use client';
import * as RemotionLib from 'remotion';
import React from 'react';

type RemotionComponent = React.ComponentType<Record<string, unknown>>;

const componentCache = new Map<string, RemotionComponent>();

export function evaluateComponent(
  jsCode: string,
  params: Record<string, unknown>
): RemotionComponent | null {
  const cacheKey = jsCode.slice(0, 100) + JSON.stringify(params);
  if (componentCache.has(cacheKey)) return componentCache.get(cacheKey)!;

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

    const Wrapped: RemotionComponent = (props) =>
      React.createElement(Component, { ...params, ...props });
    Wrapped.displayName = 'EvaluatedAsset';

    componentCache.set(cacheKey, Wrapped);
    return Wrapped;
  } catch (err) {
    console.error('Component evaluation failed:', err);
    return null;
  }
}

export function clearEvaluatorCache() {
  componentCache.clear();
}
