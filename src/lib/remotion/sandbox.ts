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
  { pattern: /\b__proto__\b/, label: 'Forbidden: __proto__' },
  { pattern: /\b__defineGetter__\b/, label: 'Forbidden: __defineGetter__' },
  { pattern: /\b__defineSetter__\b/, label: 'Forbidden: __defineSetter__' },
  { pattern: /\barguments\s*\.\s*callee\b/, label: 'Forbidden: arguments.callee' },
  { pattern: /\bwith\s*\(/, label: 'Forbidden: with statement' },

  // Worker spawning (avoid resource exhaustion via fanout)
  { pattern: /\bnew\s+(Shared)?Worker\b/, label: 'Forbidden: Worker' },
  { pattern: /\bnew\s+ServiceWorker\b/, label: 'Forbidden: ServiceWorker' },
];

export function validateCode(code: string): ValidationResult {
  const errors: string[] = [];

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    if (pattern.test(code) && !errors.includes(label)) {
      errors.push(label);
    }
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
