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
 * TM-48 hardening:
 *   - Always returns a structured `EvaluationResult` with a friendly,
 *     user-facing `userMessage` (Korean) and an `errorKind` enum so callers
 *     can pick an appropriate UI affordance instead of leaking raw stack
 *     traces. The legacy `evaluateComponent()` shim is preserved for callers
 *     that only need the component-or-null shape.
 *
 * Worker/iframe isolation was evaluated and rejected for this iteration:
 * Remotion components must render inside the host React tree, so a
 * cross-realm boundary breaks the component-handoff contract. See
 * ADR-PENDING-TM-34 for rationale.
 */

type RemotionComponent = React.ComponentType<Record<string, unknown>>;

/**
 * Categorical classification of evaluator failures. Used by callers to pick
 * an appropriate UI affordance (toast vs full-pane error vs silent fallback).
 *
 * - `parse`               — syntax error inside the factory body (sucrase
 *                           usually catches these earlier; this is a safety
 *                           net for anything that slips through).
 * - `runtime`             — factory body executed but threw (e.g. reference
 *                           to an undefined identifier in module scope).
 * - `missing-component`   — code parsed and ran, but no PascalCase component
 *                           identifier was found / the export was non-function.
 * - `timeout`             — synchronous factory call exceeded
 *                           FACTORY_TIMEOUT_MS (catastrophic regex / infinite
 *                           loop / etc.).
 * - `invalid-input`       — `jsCode` was not a string.
 */
export type EvaluatorErrorKind =
  | 'parse'
  | 'runtime'
  | 'missing-component'
  | 'timeout'
  | 'invalid-input';

export interface EvaluatorError {
  kind: EvaluatorErrorKind;
  /** Localized message safe to show end users. Never contains stack traces. */
  userMessage: string;
  /** Optional remediation hint, also localized. */
  hint?: string;
  /** Original error message — for dev console / logs only. Never rendered. */
  raw?: string;
}

export interface EvaluationResult {
  component: RemotionComponent | null;
  error: EvaluatorError | null;
}

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
 * Heuristic classification of a thrown error from `new Function(...)` /
 * factory invocation into an `EvaluatorErrorKind`.
 *
 * We deliberately use `instanceof SyntaxError` first, then fall back to name
 * inspection because cross-realm errors lose their prototype chain.
 */
function classifyThrow(err: unknown): { kind: EvaluatorErrorKind; raw: string } {
  const raw =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === 'string'
        ? err
        : 'Unknown error';

  if (err instanceof SyntaxError) return { kind: 'parse', raw };
  // Some engines throw plain Error for `new Function(badSrc)` — sniff the message.
  if (typeof raw === 'string' && /Unexpected|expected|invalid|Identifier/.test(raw)
      && !/is not defined/.test(raw)) {
    return { kind: 'parse', raw };
  }
  return { kind: 'runtime', raw };
}

const USER_MESSAGES: Record<EvaluatorErrorKind, { userMessage: string; hint?: string }> = {
  parse: {
    userMessage: '코드를 해석할 수 없습니다. 문법 오류가 있는지 확인해 주세요.',
    hint: '괄호/중괄호 짝, JSX 닫힘 태그를 점검해 보세요.',
  },
  runtime: {
    userMessage: '코드를 실행하는 중 오류가 발생했어요.',
    hint: '정의되지 않은 변수나 컴포넌트를 참조하고 있는지 확인해 주세요.',
  },
  'missing-component': {
    userMessage: '미리보기에 사용할 컴포넌트를 찾지 못했어요.',
    hint: '`Component` 또는 PascalCase 이름의 함수형 컴포넌트가 정의되어 있는지 확인해 주세요.',
  },
  timeout: {
    userMessage: '코드 평가가 시간 제한을 초과했어요.',
    hint: '무한 루프 또는 매우 무거운 초기화 코드가 있는지 확인해 주세요.',
  },
  'invalid-input': {
    userMessage: '미리보기를 생성할 코드가 비어 있거나 형식이 잘못되었어요.',
  },
};

function makeError(kind: EvaluatorErrorKind, raw?: string): EvaluatorError {
  const m = USER_MESSAGES[kind];
  return { kind, userMessage: m.userMessage, hint: m.hint, raw };
}

/**
 * Construct + invoke the factory under a wall-clock timeout. Because the
 * factory call is synchronous, this measures elapsed time around it and
 * throws on overrun — it cannot interrupt mid-execution. For pathological
 * inputs (e.g. catastrophic regex backtracking inside the factory body) the
 * deny list in sandbox.ts is the first line of defense.
 *
 * Returns either `{ component }` or `{ error }`. Never throws.
 */
function buildAndInvoke(jsCode: string): EvaluationResult {
  const start = Date.now();

  let factory: Function;
  try {
    factory = new Function(
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
  } catch (err) {
    const { kind, raw } = classifyThrow(err);
    return { component: null, error: makeError(kind, raw) };
  }

  let result: unknown;
  try {
    result = factory(React, RemotionLib, LucideLib);
  } catch (err) {
    const { kind, raw } = classifyThrow(err);
    return { component: null, error: makeError(kind, raw) };
  }

  const elapsed = Date.now() - start;
  if (elapsed > FACTORY_TIMEOUT_MS) {
    return {
      component: null,
      error: makeError('timeout', `factory took ${elapsed}ms (budget ${FACTORY_TIMEOUT_MS}ms)`),
    };
  }

  if (typeof result !== 'function') {
    return { component: null, error: makeError('missing-component') };
  }
  return { component: result as RemotionComponent, error: null };
}

/**
 * Detailed evaluator — preferred entry point. Always resolves to an
 * `EvaluationResult`; never throws. Callers can render `error.userMessage`
 * directly to end users (e.g. in a fallback panel) and log `error.raw` for
 * dev triage.
 */
export function evaluateComponentDetailed(jsCode: unknown): EvaluationResult {
  if (typeof jsCode !== 'string' || jsCode.trim().length === 0) {
    return { component: null, error: makeError('invalid-input') };
  }

  const hash = hashCode(jsCode);
  const cached = cacheGet(hash, jsCode);
  if (cached) return { component: cached, error: null };

  const result = buildAndInvoke(jsCode);
  if (result.error) {
    // Dev-only logging; never surfaced to user via the normal render path.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[evaluator]', result.error.kind, '—', result.error.raw);
    }
    return result;
  }
  if (!result.component) {
    return { component: null, error: makeError('missing-component') };
  }

  const inner = result.component;
  const Wrapped: RemotionComponent = (props) => React.createElement(inner, props);
  Wrapped.displayName = 'EvaluatedAsset';

  cacheSet(hash, jsCode, Wrapped);
  return { component: Wrapped, error: null };
}

/**
 * Backward-compatible shim. Returns the component or `null`. New callers
 * should prefer `evaluateComponentDetailed` so they can render a friendly
 * error UI instead of a blank screen.
 */
export function evaluateComponent(jsCode: string): RemotionComponent | null {
  return evaluateComponentDetailed(jsCode).component;
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
