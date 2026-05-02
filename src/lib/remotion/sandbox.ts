/**
 * Sandbox validation + sanitization for LLM-generated Remotion component code.
 *
 * Defense-in-depth model:
 *   1. `validateCode` — regex-based deny list (cheap, runs first)
 *   2. `sanitizeCode` — strips common-but-harmless decorations (imports, exports)
 *   3. `evaluator.ts` — `new Function(...)` with strict mode + restricted args
 *
 * NOTE: This file does **not** isolate execution into a Worker/iframe.
 * See ADR-PENDING-TM-34 for rationale (React component handoff blocks
 * cross-realm isolation; isolation must instead happen at LLM-output gate).
 */

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Eval-equivalents
  { pattern: /\beval\s*\(/, label: 'Forbidden: eval' },
  { pattern: /\bFunction\s*\(/, label: 'Forbidden: Function constructor' },
  { pattern: /\bnew\s+Function\b/, label: 'Forbidden: Function constructor' },
  { pattern: /\bsetTimeout\s*\(\s*['"`]/, label: 'Forbidden: setTimeout(string)' },
  { pattern: /\bsetInterval\s*\(\s*['"`]/, label: 'Forbidden: setInterval(string)' },
  // TM-85 — Remotion components animate via `useCurrentFrame`. Any timer
  // scheduling in user code is either recursive-DoS bait (setTimeout calls
  // itself) or a microtask-flood loop. Deny outright.
  { pattern: /\bsetTimeout\s*\(/, label: 'Forbidden: setTimeout' },
  { pattern: /\bsetInterval\s*\(/, label: 'Forbidden: setInterval' },
  { pattern: /\brequestAnimationFrame\s*\(/, label: 'Forbidden: requestAnimationFrame' },
  { pattern: /\bqueueMicrotask\s*\(/, label: 'Forbidden: queueMicrotask' },

  // Network
  { pattern: /\bfetch\s*\(/, label: 'Forbidden: fetch' },
  { pattern: /\bXMLHttpRequest\b/, label: 'Forbidden: XMLHttpRequest' },
  { pattern: /\bWebSocket\b/, label: 'Forbidden: WebSocket' },
  { pattern: /\bnavigator\s*\.\s*sendBeacon\b/, label: 'Forbidden: sendBeacon' },
  { pattern: /\bEventSource\b/, label: 'Forbidden: EventSource' },

  // Storage / cookies
  { pattern: /\bdocument\s*\.\s*cookie/, label: 'Forbidden: document.cookie' },
  { pattern: /\blocalStorage\b/, label: 'Forbidden: localStorage' },
  { pattern: /\bsessionStorage\b/, label: 'Forbidden: sessionStorage' },
  { pattern: /\bindexedDB\b/, label: 'Forbidden: indexedDB' },
  { pattern: /\bcaches\b/, label: 'Forbidden: caches' },

  // Navigation / process
  { pattern: /\bwindow\s*\.\s*location/, label: 'Forbidden: window.location' },
  { pattern: /\blocation\s*\.\s*(href|assign|replace)/, label: 'Forbidden: location.*' },
  { pattern: /\bprocess\s*\./, label: 'Forbidden: process' },

  // Module loaders
  { pattern: /\brequire\s*\(/, label: 'Forbidden: require' },
  { pattern: /\bimport\s*\(/, label: 'Forbidden: dynamic import' },
  { pattern: /import\.meta\b/, label: 'Forbidden: import.meta' },

  // Realm / prototype escape
  { pattern: /\bglobalThis\b/, label: 'Forbidden: globalThis' },
  { pattern: /\bglobal\b(?!\s*[A-Za-z0-9_])/, label: 'Forbidden: global' },
  { pattern: /\b__proto__\b/, label: 'Forbidden: __proto__' },
  { pattern: /\b__defineGetter__\b/, label: 'Forbidden: __defineGetter__' },
  { pattern: /\b__defineSetter__\b/, label: 'Forbidden: __defineSetter__' },
  { pattern: /\barguments\s*\.\s*callee\b/, label: 'Forbidden: arguments.callee' },
  { pattern: /\bwith\s*\(/, label: 'Forbidden: with statement' },

  // Reflection / metaprogramming (TM-85). `Reflect` + `Proxy` give attackers
  // a path around frozen objects and into prototype chains; deny statically.
  { pattern: /\bReflect\s*\./, label: 'Forbidden: Reflect' },
  { pattern: /\bnew\s+Proxy\b/, label: 'Forbidden: Proxy' },
  { pattern: /\bProxy\s*\(/, label: 'Forbidden: Proxy' },
  { pattern: /\bProxy\s*\./, label: 'Forbidden: Proxy' },

  // Encoding / binary helpers (TM-85). Often used to smuggle obfuscated
  // payloads past the deny list (`eval(atob('...'))`).
  { pattern: /\batob\s*\(/, label: 'Forbidden: atob' },
  { pattern: /\bbtoa\s*\(/, label: 'Forbidden: btoa' },
  { pattern: /\bBuffer\b/, label: 'Forbidden: Buffer' },

  // WebAssembly — full alternative execution surface, deny entirely. (TM-85)
  { pattern: /\bWebAssembly\b/, label: 'Forbidden: WebAssembly' },

  // Worker spawning (avoid resource exhaustion via fanout)
  { pattern: /\bnew\s+(Shared)?Worker\b/, label: 'Forbidden: Worker' },
  { pattern: /\bnew\s+ServiceWorker\b/, label: 'Forbidden: ServiceWorker' },

  // Obvious infinite loops in module scope. The evaluator's wall-clock
  // timeout is a *post-hoc* check (`Date.now()` after the synchronous
  // factory call) and therefore cannot interrupt a `for(;;){}` /
  // `while(true){}` body — by the time we measure, the tab is already
  // frozen. Reject these statically in the deny list. (TM-48)
  // Note: this is a heuristic, not a halting-problem solver — only the
  // canonical syntactic forms are rejected.
  { pattern: /\bfor\s*\(\s*;\s*;\s*\)/, label: 'Forbidden: for(;;) infinite loop' },
  { pattern: /\bwhile\s*\(\s*(?:true|1)\s*\)/, label: 'Forbidden: while(true) infinite loop' },
  { pattern: /\bdo\s*\{[\s\S]*?\}\s*while\s*\(\s*(?:true|1)\s*\)/, label: 'Forbidden: do…while(true) infinite loop' },
];

/**
 * Heuristic AST-lite check for self-recursive Promise chains.
 *
 * A common 0-day pattern smuggled past simple `Promise` denial is:
 *
 *     function loop() { return Promise.resolve().then(loop); }
 *     loop();
 *
 * The chain is unbounded and starves the microtask queue, hanging the tab
 * even though no `for(;;)` / `while(true)` ever appears. We detect the
 * pattern by looking for any function whose body contains `.then(<ownName>)`
 * — purely textual, but cheap, and the false-positive rate on legitimate
 * Remotion code is effectively zero (components don't await microtask
 * loops at module scope).
 */
function detectRecursivePromiseChain(code: string): boolean {
  // Collect every identifier declared as a function/arrow at the top level.
  // We then check whether `.then(<name>)` appears anywhere in the source AND
  // that name's declaration is co-located with a `Promise` reference. This
  // is intentionally textual; the false-positive surface for legit Remotion
  // code is empty (components don't pass their own name to `.then`).
  const declRe = /\b(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g;
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

export function validateCode(code: string): ValidationResult {
  const errors: string[] = [];

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    if (pattern.test(code) && !errors.includes(label)) {
      errors.push(label);
    }
  }

  if (detectRecursivePromiseChain(code)) {
    errors.push('Forbidden: recursive Promise chain');
  }

  return { valid: errors.length === 0, errors };
}

export function sanitizeCode(code: string): string {
  return code
    .replace(/^import\s+.*?from\s+['"]remotion['"];?\s*$/gm, '')
    .replace(/^import\s+.*?from\s+['"]react['"];?\s*$/gm, '')
    // lucide-react is provided as a `lucide` global by the evaluator. Strip
    // any stray import the model might emit so the sandbox doesn't reject it.
    .replace(/^import\s+.*?from\s+['"]lucide-react['"];?\s*$/gm, '')
    .replace(/^import\s+type\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, 'const DefaultExport = ')
    .replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ')
    .trim();
}
