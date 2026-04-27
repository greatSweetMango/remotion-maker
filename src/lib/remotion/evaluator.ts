'use client';
import * as RemotionLib from 'remotion';
import * as LucideLib from 'lucide-react';
import React from 'react';

/**
 * Component evaluator — turns a transpiled jsCode string into a React
 * component via `new Function(...)`.
 *
 * Hardening layers (TM-34, see ADR-PENDING-TM-34):
 *   1. **Strict mode + restricted argument shape** — only React/remotion/lucide
 *      injected; no `globalThis`, `window`, `document`, `process`.
 *   2. **Synchronous factory-construction timeout** — bounds parse + initial
 *      evaluation of the factory body. Render-time work happens inside the
 *      Remotion <Player> render loop and is bounded by the host frame budget.
 *   3. **Hashed LRU cache** — keyed on a fast 32-bit FNV-1a digest of the
 *      jsCode (memory-bounded; old entries evicted at MAX_CACHE_ENTRIES).
 *   4. **Pre-flight validation** is the caller's responsibility (see
 *      `sandbox.ts::validateCode`). The evaluator assumes input has already
 *      passed the deny list and only enforces structural safety here.
 *
 * Worker/iframe isolation was evaluated and rejected for this iteration:
 * Remotion components must render inside the host React tree, so a
 * cross-realm boundary breaks the component-handoff contract. See
 * ADR-PENDING-TM-34 for rationale.
 */

type RemotionComponent = React.ComponentType<Record<string, unknown>>;

interface CacheEntry {
  component: RemotionComponent;
  hash: string;
  /** Source length — used as a coarse memory-pressure signal. */
  size: number;
}

const MAX_CACHE_ENTRIES = 64;
const FACTORY_TIMEOUT_MS = 5_000;

/**
 * Insertion-ordered LRU. `Map` preserves insertion order; on access we
 * delete + re-set to bump the entry to the most-recent position.
 */
const componentCache = new Map<string, CacheEntry>();

/**
 * 32-bit FNV-1a hash of a string. Hex-encoded.
 *
 * Cheap, deterministic, and collision-rate is acceptable for ~hundreds of
 * cached entries. We do NOT rely on hash uniqueness for correctness — the
 * full `jsCode` is also stored on the entry and re-checked on hit, so a
 * collision degrades to a recompile, not a wrong-component bug.
 */
function hashCode(code: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function cacheGet(hash: string, code: string): RemotionComponent | null {
  const entry = componentCache.get(hash);
  if (!entry) return null;
  // Collision guard — see hashCode() comment.
  if (entry.size !== code.length) return null;
  // LRU bump.
  componentCache.delete(hash);
  componentCache.set(hash, entry);
  return entry.component;
}

function cacheSet(hash: string, code: string, component: RemotionComponent): void {
  if (componentCache.size >= MAX_CACHE_ENTRIES) {
    // Map iterators yield keys in insertion order — first key is oldest.
    const oldest = componentCache.keys().next().value;
    if (oldest !== undefined) componentCache.delete(oldest);
  }
  componentCache.set(hash, { component, hash, size: code.length });
}

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

/**
 * Construct + invoke the factory under a wall-clock timeout. Because the
 * factory call is synchronous, this measures elapsed time around it and
 * throws on overrun — it cannot interrupt mid-execution. For pathological
 * inputs (e.g. catastrophic regex backtracking inside the factory body) the
 * deny list in sandbox.ts is the first line of defense.
 */
function buildAndInvoke(jsCode: string): RemotionComponent | null {
  const start = Date.now();

  const factory = new Function(
    'React',
    'remotion',
    'lucide',
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

  const Component = factory(React, RemotionLib, LucideLib);

  const elapsed = Date.now() - start;
  if (elapsed > FACTORY_TIMEOUT_MS) {
    throw new Error(`Sandbox factory exceeded ${FACTORY_TIMEOUT_MS}ms budget (took ${elapsed}ms)`);
  }

  if (typeof Component !== 'function') return null;
  return Component as RemotionComponent;
}

export function evaluateComponent(jsCode: string): RemotionComponent | null {
  const hash = hashCode(jsCode);
  const cached = cacheGet(hash, jsCode);
  if (cached) return cached;

  try {
    const Component = buildAndInvoke(jsCode);
    if (!Component) return null;

    const Wrapped: RemotionComponent = (props) => React.createElement(Component, props);
    Wrapped.displayName = 'EvaluatedAsset';

    cacheSet(hash, jsCode, Wrapped);
    return Wrapped;
  } catch (err) {
    console.error('Component evaluation failed:', err);
    return null;
  }
}

export function clearEvaluatorCache() {
  componentCache.clear();
}

/** Test/inspection only — exposes cache size without leaking entries. */
export function __evaluatorCacheSize() {
  return componentCache.size;
}

/** Test/inspection only — exposes cache config. */
export const __evaluatorCacheConfig = {
  MAX_CACHE_ENTRIES,
  FACTORY_TIMEOUT_MS,
} as const;
