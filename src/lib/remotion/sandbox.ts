interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\beval\s*\(/, label: 'Forbidden: eval' },
  { pattern: /\bFunction\s*\(/, label: 'Forbidden: Function constructor' },
  { pattern: /\bfetch\s*\(/, label: 'Forbidden: fetch' },
  { pattern: /\bXMLHttpRequest\b/, label: 'Forbidden: XMLHttpRequest' },
  { pattern: /\bprocess\s*\./, label: 'Forbidden: process' },
  { pattern: /\brequire\s*\(/, label: 'Forbidden: require' },
  { pattern: /\bdocument\s*\.\s*cookie/, label: 'Forbidden: document.cookie' },
  { pattern: /\blocalStorage\b/, label: 'Forbidden: localStorage' },
  { pattern: /\bsessionStorage\b/, label: 'Forbidden: sessionStorage' },
  { pattern: /\bwindow\s*\.\s*location/, label: 'Forbidden: window.location' },
  { pattern: /\bimport\s*\(/, label: 'Forbidden: dynamic import' },
  { pattern: /\bWebSocket\b/, label: 'Forbidden: WebSocket' },
  { pattern: /\bglobalThis\b/, label: 'Forbidden: globalThis' },
  { pattern: /\b__proto__\b/, label: 'Forbidden: __proto__' },
  { pattern: /import\.meta\b/, label: 'Forbidden: import.meta' },
  { pattern: /\bindexedDB\b/, label: 'Forbidden: indexedDB' },
];

export function validateCode(code: string): ValidationResult {
  const errors: string[] = [];

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      errors.push(label);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function sanitizeCode(code: string): string {
  return code
    .replace(/^import\s+.*?from\s+['"]remotion['"];?\s*$/gm, '')
    .replace(/^import\s+.*?from\s+['"]react['"];?\s*$/gm, '')
    .replace(/^import\s+type\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, 'const DefaultExport = ')
    .replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ')
    .trim();
}
