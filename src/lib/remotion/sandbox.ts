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

  // Media components (TM-123). Generated assets are visual-only; <Audio>/
  // <Video>/<OffthreadVideo>/<IFrame> require a `src` URL that the LLM has
  // no source-of-truth for, and emitting them with a non-string `src` (or no
  // `src` at all) triggers Remotion's runtime error
  // `<Html5Audio> tag requires a string for `src`` plus a 100+ "AudioContext
  // encountered an error" cascade in the studio. Reject statically so the
  // user sees a friendly evaluator error instead of a flooded console.
  //
  // TM-128 / ADR-0026 §2: <Audio> is re-permitted ONLY when every <Audio>
  // tag's `src` is a literal call to `staticFile("audio/<slug>.mp3")` whose
  // slug matches the catalogue regex (`^[a-z0-9-]+\.mp3$`). The check runs
  // BEFORE the deny-list scan via `isAudioAllowListed`; when it returns true
  // this row is skipped. All other shapes (numeric / variable / template
  // string / external URL / path traversal / wrong extension / no src) still
  // hit this deny rule. `<Video>` / `<OffthreadVideo>` / `<IFrame>` remain
  // unconditionally denied — audio is the only escape hatch.
  //
  // TM-132 / ADR-0026 §B amendment: `<CatalogueAudio>` is the PARAMS-driven
  // wrapper that lets the customize picker actually swap tracks. The
  // `<\s*Audio\b` regex below requires the `<` to be IMMEDIATELY followed
  // by `Audio` (modulo whitespace), so `<CatalogueAudio` does not match —
  // no allow-list carve-out needed for the wrapper. The wrapper itself
  // returns a literal `<Audio src={staticFile("audio/<slug>.mp3")} />`
  // (see src/remotion/CatalogueAudio.tsx) which satisfies the TM-128
  // structural shape without any user code reaching `<Audio>` directly.
  { pattern: /<\s*Audio\b/, label: 'Forbidden: <Audio> (visual-only assets — TM-123)' },
  { pattern: /<\s*Video\b/, label: 'Forbidden: <Video> (visual-only assets — TM-123)' },
  { pattern: /<\s*OffthreadVideo\b/, label: 'Forbidden: <OffthreadVideo> (visual-only assets — TM-123)' },
  { pattern: /<\s*IFrame\b/, label: 'Forbidden: <IFrame> (visual-only assets — TM-123)' },

  // TM-140 / ADR-0027: bare `<Lottie>` is denied for the same reason as
  // bare `<Audio>` — Lottie JSON can carry embedded expressions that
  // break Remotion's per-frame determinism (per @remotion/lottie docs)
  // and a freely-emittable `<Lottie>` would let the LLM point at
  // attacker-controlled JSON. Use `<CatalogueLottie asset=...>` instead;
  // the wrapper validates the catalogue slug shape and emits a
  // known-good `<Lottie animationData={...}>` internally. The deny
  // regex requires `<` immediately followed by `Lottie` (modulo
  // whitespace), so `<CatalogueLottie` does not match — no allow-list
  // carve-out needed for the wrapper (mirrors the ADR-0026 §B
  // `<CatalogueAudio>` pattern).
  { pattern: /<\s*Lottie\b/, label: 'Forbidden: <Lottie> (use <CatalogueLottie asset=...> — ADR-0027)' },

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

/**
 * TM-128 / ADR-0026 §2 — `<Audio>` structural allow-list.
 *
 * Returns `true` iff the code contains at least one `<Audio` token AND every
 * `<Audio` token in the source matches the strict allow shape:
 *
 *     <Audio src={staticFile("audio/<slug>.mp3")} ... />
 *
 * where `<slug>` matches the catalogue filename regex
 * (`^[a-z0-9-]+\.mp3$` per `src/lib/audio/manifest.ts`). The literal-string
 * argument shape is enforced — variable `src`, template literals, numeric
 * values, external URLs, path traversal (`audio/../foo`), and wrong
 * extensions all FAIL the match, so the caller will then hit the deny-list
 * `<Audio>` rule.
 *
 * The match must succeed for EVERY `<Audio` occurrence. A file containing
 * one allow-listed tag plus one variant tag is rejected (the variant tag
 * still triggers the deny-list rule via the standard scan).
 *
 * Note: this is a deliberately narrow, regex-based shape check — not an AST
 * matcher. It mirrors the existing FORBIDDEN_PATTERNS strategy and stays
 * cheap enough to run on every edit. A later AST-based validator can replace
 * this with stricter source-position checks; until then the regex is paired
 * with a runtime manifest lookup at the customize / render layer (TM-130).
 */
const AUDIO_TAG_RE = /<\s*Audio\b/g;
const AUDIO_ALLOWED_SHAPE_RE =
  /<\s*Audio\b[^<>]*\bsrc\s*=\s*\{\s*staticFile\s*\(\s*['"]audio\/[a-z0-9-]+\.mp3['"]\s*\)\s*\}[^<>]*\/?\s*>/;

export function isAudioAllowListed(code: string): boolean {
  // Reset lastIndex defensively; AUDIO_TAG_RE is a module-level /g regex.
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
    // Advance past the matched tag so a malformed <Audio later in the file
    // is still inspected on the next loop iteration.
    AUDIO_TAG_RE.lastIndex = m.index + shape[0].length;
  }
  AUDIO_TAG_RE.lastIndex = 0;
  return saw;
}

export function validateCode(code: string): ValidationResult {
  const errors: string[] = [];
  const audioAllowed = isAudioAllowListed(code);

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    // TM-128: skip the <Audio> deny rule when every <Audio> tag in the
    // source matches the strict allow-list shape (literal staticFile call
    // with catalogue-regex slug). All other variants — including numeric
    // src, dynamic var, template-string, external URL, path traversal — do
    // NOT match the allow shape and therefore still trip this rule.
    if (audioAllowed && label.startsWith('Forbidden: <Audio>')) continue;
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
    // TM-132 / ADR-0026 §B amendment: <CatalogueAudio> is injected as a local
    // (see evaluator.ts) — strip any stray import the model might emit.
    .replace(
      /^import\s+\{\s*CatalogueAudio\s*\}\s+from\s+['"](?:@\/)?remotion\/CatalogueAudio['"];?\s*$/gm,
      '',
    )
    // TM-142 — <SpriteAnimator> is injected as a local (see evaluator.ts);
    // strip any stray import the model might emit after seeing it in the
    // sprite-sheet system-prompt addendum.
    .replace(
      /^import\s+\{\s*SpriteAnimator\s*\}\s+from\s+['"](?:@\/)?remotion\/SpriteAnimator['"];?\s*$/gm,
      '',
    )
    // Same for CatalogueLottie (TM-140 missed this in the original sanitiser).
    .replace(
      /^import\s+\{\s*CatalogueLottie\s*\}\s+from\s+['"](?:@\/)?remotion\/CatalogueLottie['"];?\s*$/gm,
      '',
    )
    .replace(/^import\s+type\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, 'const DefaultExport = ')
    .replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ')
    .trim();
}
