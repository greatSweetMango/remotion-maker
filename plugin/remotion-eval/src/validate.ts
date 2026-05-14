/**
 * validate_remotion_code — pure validation pipeline for LLM-generated
 * Remotion component code. Mirrors the in-app stack (src/lib/remotion/*)
 * but without the React/DOM evaluator step, so it can run inside a Node
 * MCP server (no browser globals available).
 *
 * Pipeline:
 *   1. sandbox.validateCode    — regex deny-list (eval, fetch, timers, ...)
 *   2. structural checks       — must declare `PARAMS` + a PascalCase component
 *   3. sucrase transpile       — TS+JSX → JS; surfaces syntax errors
 *
 * Output is stable so callers (agents / Orchestrator) can branch on
 * `result.ok` and inspect categorical `errors[]` / `warnings[]`.
 */

import { transform } from 'sucrase';

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Transpiled JS (sucrase output) — null when transpile failed or skipped. */
  transpiled: string | null;
  /** Number of PARAMS keys detected (0 when no PARAMS const present). */
  paramsCount: number;
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\beval\s*\(/, label: 'Forbidden: eval' },
  { pattern: /\bFunction\s*\(/, label: 'Forbidden: Function constructor' },
  { pattern: /\bnew\s+Function\b/, label: 'Forbidden: Function constructor' },
  // String-arg timer variants are a degenerate `eval` path; deny before the
  // bare-call rule below so the error message is more specific. (TM-115 sync)
  { pattern: /\bsetTimeout\s*\(\s*['"`]/, label: 'Forbidden: setTimeout(string)' },
  { pattern: /\bsetInterval\s*\(\s*['"`]/, label: 'Forbidden: setInterval(string)' },
  { pattern: /\bsetTimeout\s*\(/, label: 'Forbidden: setTimeout' },
  { pattern: /\bsetInterval\s*\(/, label: 'Forbidden: setInterval' },
  { pattern: /\brequestAnimationFrame\s*\(/, label: 'Forbidden: requestAnimationFrame' },
  { pattern: /\bqueueMicrotask\s*\(/, label: 'Forbidden: queueMicrotask' },

  { pattern: /\bfetch\s*\(/, label: 'Forbidden: fetch' },
  { pattern: /\bXMLHttpRequest\b/, label: 'Forbidden: XMLHttpRequest' },
  { pattern: /\bWebSocket\b/, label: 'Forbidden: WebSocket' },
  { pattern: /\bnavigator\s*\.\s*sendBeacon\b/, label: 'Forbidden: sendBeacon' },
  { pattern: /\bEventSource\b/, label: 'Forbidden: EventSource' },

  { pattern: /\bdocument\s*\.\s*cookie/, label: 'Forbidden: document.cookie' },
  { pattern: /\blocalStorage\b/, label: 'Forbidden: localStorage' },
  { pattern: /\bsessionStorage\b/, label: 'Forbidden: sessionStorage' },
  { pattern: /\bindexedDB\b/, label: 'Forbidden: indexedDB' },
  { pattern: /\bcaches\b/, label: 'Forbidden: caches' },

  { pattern: /\bwindow\s*\.\s*location/, label: 'Forbidden: window.location' },
  { pattern: /\blocation\s*\.\s*(href|assign|replace)/, label: 'Forbidden: location.*' },
  { pattern: /\bprocess\s*\./, label: 'Forbidden: process' },

  { pattern: /\brequire\s*\(/, label: 'Forbidden: require' },
  { pattern: /\bimport\s*\(/, label: 'Forbidden: dynamic import' },
  { pattern: /import\.meta\b/, label: 'Forbidden: import.meta' },

  { pattern: /\bglobalThis\b/, label: 'Forbidden: globalThis' },
  { pattern: /\bglobal\b(?!\s*[A-Za-z0-9_])/, label: 'Forbidden: global' },
  { pattern: /\b__proto__\b/, label: 'Forbidden: __proto__' },
  { pattern: /\b__defineGetter__\b/, label: 'Forbidden: __defineGetter__' },
  { pattern: /\b__defineSetter__\b/, label: 'Forbidden: __defineSetter__' },
  { pattern: /\barguments\s*\.\s*callee\b/, label: 'Forbidden: arguments.callee' },
  { pattern: /\bwith\s*\(/, label: 'Forbidden: with statement' },

  { pattern: /\bReflect\s*\./, label: 'Forbidden: Reflect' },
  { pattern: /\bnew\s+Proxy\b/, label: 'Forbidden: Proxy' },
  { pattern: /\bProxy\s*\(/, label: 'Forbidden: Proxy' },
  { pattern: /\bProxy\s*\./, label: 'Forbidden: Proxy' },

  { pattern: /\batob\s*\(/, label: 'Forbidden: atob' },
  { pattern: /\bbtoa\s*\(/, label: 'Forbidden: btoa' },
  { pattern: /\bBuffer\b/, label: 'Forbidden: Buffer' },
  { pattern: /\bWebAssembly\b/, label: 'Forbidden: WebAssembly' },

  // Media components (TM-123 sync). See src/lib/remotion/sandbox.ts for
  // the user-blocking bug rationale (Html5Audio src type error + AudioContext
  // cascade). Visual-only policy enforced at validation time.
  // TM-128 / ADR-0026 §2 mirror: <Audio> permitted iff every tag matches the
  // strict literal `staticFile("audio/<slug>.mp3")` shape — see
  // `isAudioAllowListed` below. The deny entry stays in this list so the
  // TM-115 sync invariant continues to pass.
  { pattern: /<\s*Audio\b/, label: 'Forbidden: <Audio> (visual-only assets — TM-123)' },
  { pattern: /<\s*Video\b/, label: 'Forbidden: <Video> (visual-only assets — TM-123)' },
  { pattern: /<\s*OffthreadVideo\b/, label: 'Forbidden: <OffthreadVideo> (visual-only assets — TM-123)' },
  { pattern: /<\s*IFrame\b/, label: 'Forbidden: <IFrame> (visual-only assets — TM-123)' },

  { pattern: /\bnew\s+(Shared)?Worker\b/, label: 'Forbidden: Worker' },
  { pattern: /\bnew\s+ServiceWorker\b/, label: 'Forbidden: ServiceWorker' },

  { pattern: /\bfor\s*\(\s*;\s*;\s*\)/, label: 'Forbidden: for(;;) infinite loop' },
  { pattern: /\bwhile\s*\(\s*(?:true|1)\s*\)/, label: 'Forbidden: while(true) infinite loop' },
  {
    pattern: /\bdo\s*\{[\s\S]*?\}\s*while\s*\(\s*(?:true|1)\s*\)/,
    label: 'Forbidden: do…while(true) infinite loop',
  },
];

/**
 * TM-128 / ADR-0026 §2 mirror — `<Audio>` structural allow-list.
 *
 * Returns `true` iff the code contains at least one `<Audio` token AND every
 * such token matches the strict shape
 * `<Audio src={staticFile("audio/<slug>.mp3")} ... />` where `<slug>` matches
 * the catalogue regex (`^[a-z0-9-]+\.mp3$`). Variants — variable / template
 * / numeric / external URL / path traversal — fail the match and therefore
 * still trigger the `<Audio>` deny entry in the standard scan.
 *
 * Mirror of `isAudioAllowListed` in `src/lib/remotion/sandbox.ts`. Keep in
 * sync (TM-115 invariant).
 */
const AUDIO_TAG_RE = /<\s*Audio\b/g;
const AUDIO_ALLOWED_SHAPE_RE =
  /<\s*Audio\b[^<>]*\bsrc\s*=\s*\{\s*staticFile\s*\(\s*['"]audio\/[a-z0-9-]+\.mp3['"]\s*\)\s*\}[^<>]*\/?\s*>/;

export function isAudioAllowListed(code: string): boolean {
  AUDIO_TAG_RE.lastIndex = 0;
  let saw = false;
  let m: RegExpExecArray | null;
  while ((m = AUDIO_TAG_RE.exec(code)) !== null) {
    saw = true;
    const tail = code.slice(m.index);
    const shape = tail.match(AUDIO_ALLOWED_SHAPE_RE);
    if (!shape || shape.index !== 0) {
      AUDIO_TAG_RE.lastIndex = 0;
      return false;
    }
    AUDIO_TAG_RE.lastIndex = m.index + shape[0].length;
  }
  AUDIO_TAG_RE.lastIndex = 0;
  return saw;
}

function detectRecursivePromiseChain(code: string): boolean {
  const declRe =
    /\b(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g;
  const names = new Set<string>();
  for (const m of code.matchAll(declRe)) {
    const name = m[1] ?? m[2];
    if (name) names.add(name);
  }
  if (names.size === 0) return false;
  if (!/\bPromise\b/.test(code)) return false;
  for (const name of names) {
    const re = new RegExp(`\\.then\\s*\\(\\s*${name}\\b`);
    if (re.test(code)) return true;
  }
  return false;
}

/** Count keys in `const PARAMS = { ... }`. Returns 0 when no PARAMS const. */
export function countParamsKeys(code: string): number {
  const m = code.match(/const\s+PARAMS\s*=\s*\{([\s\S]*?)\}\s*(?:as\s+const)?/);
  if (!m) return 0;
  const body = m[1];
  let count = 0;
  for (const line of body.split('\n')) {
    if (/^\s*\w+\s*:/.test(line)) count++;
  }
  return count;
}

/** Detect at least one PascalCase component declaration (function or arrow). */
function hasPascalCaseComponent(code: string): boolean {
  const re = /(?:^|\n)\s*(?:const|function)\s+([A-Z][a-zA-Z0-9]*)\s*[=(]/g;
  for (const m of code.matchAll(re)) {
    const name = m[1];
    // PascalCase, not SCREAMING_CASE (TM-58 evaluator gotcha)
    if (/[a-z]/.test(name)) return true;
  }
  return false;
}

export function validateRemotionCode(code: unknown): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof code !== 'string' || code.trim().length === 0) {
    return {
      ok: false,
      errors: ['invalid-input: code must be a non-empty string'],
      warnings,
      transpiled: null,
      paramsCount: 0,
    };
  }

  // 1. Deny list
  const audioAllowed = isAudioAllowListed(code);
  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    // TM-128 mirror: skip the <Audio> deny rule when every <Audio> tag in
    // the source matches the strict allow shape (literal staticFile call
    // with catalogue-regex slug).
    if (audioAllowed && label.startsWith('Forbidden: <Audio>')) continue;
    if (pattern.test(code) && !errors.includes(label)) errors.push(label);
  }
  if (detectRecursivePromiseChain(code)) {
    errors.push('Forbidden: recursive Promise chain');
  }

  // 2. Structural checks (warnings — ADR-0002 advises PARAMS, but absence
  //    isn't a hard security failure; surface as warning so callers can
  //    pick policy.)
  const paramsCount = countParamsKeys(code);
  if (paramsCount === 0) {
    warnings.push('structure: no `const PARAMS = { ... }` detected (ADR-0002)');
  }
  if (!hasPascalCaseComponent(code)) {
    warnings.push('structure: no PascalCase component declaration found');
  }

  // 3. Transpile (skip if deny-list already failed — output is meaningless
  //    when the input was rejected on safety grounds, and we want to
  //    minimise wasted work on hostile inputs).
  let transpiled: string | null = null;
  if (errors.length === 0) {
    try {
      const out = transform(code, {
        transforms: ['typescript', 'jsx'],
        jsxRuntime: 'classic',
        production: true,
      });
      transpiled = out.code;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`transpile: ${msg}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    transpiled,
    paramsCount,
  };
}
