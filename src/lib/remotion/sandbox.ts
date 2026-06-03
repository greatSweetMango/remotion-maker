/**
 * Sandbox validation + sanitization for LLM-generated Remotion component code.
 *
 * Defense-in-depth model:
 *   1. `validateCode` — regex-based deny list (cheap, runs first)
 *   2. `sanitizeCode` — strips common-but-harmless decorations (imports, exports)
 *   3. `evaluator.ts` — `new Function(...)` with strict mode + restricted args
 *
 * TM-175: `validateCode` also enforces the lucide-react export whitelist
 * (`validateLucideIdentifiers`). This is a defensive layer — the
 * sanitizer in `pipeline.ts::sanitizeForbiddenTokens` (rule §10) normally
 * rewrites invented icons before validation; this catches any path that
 * skips the sanitizer (e.g. user-pasted code, future call sites).
 *
 * NOTE: This file does **not** isolate execution into a Worker/iframe.
 * See ADR-PENDING-TM-34 for rationale (React component handoff blocks
 * cross-realm isolation; isolation must instead happen at LLM-output gate).
 */

import { LUCIDE_VALID_NAMES } from '@/lib/lucide-whitelist';

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

/**
 * TM-168 — imageUrl composition rules.
 *
 * Background: TM-166 RCA found that the multi-step pipeline routinely
 * (a) referenced a bare `imageUrl` identifier inside scene fragments
 * instead of `PARAMS.imageUrl` (ReferenceError at render → __SceneBoundary
 * blanks the scene), and (b) added solid-colored full-frame `<div>` /
 * `<AbsoluteFill>` siblings on top of the asset-gen PNG (purple band /
 * pink overlay), smothering the bear-in-meadow image the user was
 * waiting on. The deny-list catches none of this — both forms are
 * "valid" JSX from a sandbox standpoint.
 *
 * This validator runs ONLY when the code defines a `PARAMS.imageUrl`
 * field (the canonical asset-gen surface). It enforces three rules:
 *
 *   R1. Every `<Img src={...}>` MUST resolve to one of:
 *        - `PARAMS.imageUrl`           (the canonical reference)
 *        - a destructured prop default (e.g. `imageUrl = PARAMS.imageUrl`)
 *        - a literal string            (legacy / hard-coded path)
 *       A bare `imageUrl` identifier with no PARAMS prefix and no
 *       destructured default in scope → reject.
 *
 *   R2. The asset-gen PNG IS the full scene (sky + ground + character).
 *       Adding an opaque solid overlay on top of it smothers the image.
 *       So: at least one `<Img>` MUST exist somewhere in the code (if
 *       PARAMS.imageUrl is declared but never spliced, reject — the LLM
 *       ignored the addendum).
 *
 *   R3. NO opaque solid overlay siblings after an `<Img>` in the same
 *       AbsoluteFill. We approximate "opaque solid overlay" as:
 *        - `<AbsoluteFill style={{ backgroundColor: ... }} />`   (self-closed, no children)
 *        - `<div style={{ ... backgroundColor ... width:'100%' ... height: ... }} />`
 *       with NO `opacity:` style key and NO children. These shapes are
 *       deterministically the failure mode in TM-166.
 *
 * Rule R3 is intentionally conservative — siblings with children, with
 * an animated `opacity`, or that explicitly set a transparent/rgba
 * backgroundColor are allowed (they're motion layers, not overlays).
 *
 * False-positive surface: tested against the 35-case TM-43 corpus in
 * the sandbox-fuzz suite; the rules only fire when `PARAMS.imageUrl` is
 * present, so non-image scenes are unaffected.
 */

// `imageUrl:` key in PARAMS — kept narrow so we don't fire on unrelated
// scene specs that happen to mention "imageUrl" in a comment.
const PARAMS_IMAGE_URL_DECL_RE = /\bimageUrl\s*:\s*['"]/;

// Every `<Img ...` tag in the file. Used to enforce R1 + R2.
const IMG_TAG_RE = /<\s*Img\b[^>]*>/g;

// `src={...}` extractor inside one Img tag. Captures the expression
// between the curly braces so we can inspect it.
const IMG_SRC_EXPR_RE = /\bsrc\s*=\s*\{\s*([^}]+?)\s*\}/;

// Destructured prop default `imageUrl = PARAMS.imageUrl` (or any default).
const IMG_URL_DESTRUCTURE_RE = /\bimageUrl\s*=\s*[^,)}]+/;

// AbsoluteFill or div with backgroundColor style AND no children
// (self-closing OR open+close with whitespace). Heuristic — captures
// the most common failure shape from TM-166 (full-frame purple band /
// pink overlay).
const OPAQUE_OVERLAY_FRAGMENT_RE =
  /<\s*(?:AbsoluteFill|div)\b[^>]*\bbackgroundColor\b[^>]*\/\s*>/g;

export function validateImageUrlComposition(code: string): string[] {
  const errors: string[] = [];
  if (!PARAMS_IMAGE_URL_DECL_RE.test(code)) return errors;

  // R1 — collect every <Img ...> tag's src expression.
  const imgTags: string[] = [];
  let m: RegExpExecArray | null;
  IMG_TAG_RE.lastIndex = 0;
  while ((m = IMG_TAG_RE.exec(code)) !== null) {
    imgTags.push(m[0]);
  }
  IMG_TAG_RE.lastIndex = 0;

  // R2 — at least one <Img> must exist when PARAMS.imageUrl is declared.
  if (imgTags.length === 0) {
    errors.push(
      'imageUrl rule: PARAMS.imageUrl declared but no <Img> tag found — splice the PNG via <Img src={PARAMS.imageUrl}/>',
    );
    // Continue to R3 — overlays are still meaningful to report.
  }

  // R1 — each Img.src must be PARAMS.imageUrl, a literal string, or a
  // destructured prop default present somewhere in the file.
  const hasDestructuredDefault = IMG_URL_DESTRUCTURE_RE.test(code);
  for (const tag of imgTags) {
    const srcMatch = tag.match(IMG_SRC_EXPR_RE);
    if (!srcMatch) {
      // src is a literal string attribute (e.g. src="https://..."), or
      // entirely missing. A missing src would have crashed at the
      // sucrase parse stage; a literal-string src is fine for legacy
      // hard-coded assets. Allow either.
      continue;
    }
    const expr = srcMatch[1].trim();
    // PARAMS.imageUrl, props.imageUrl, this.props.imageUrl — all allowed.
    if (/\bPARAMS\s*\.\s*imageUrl\b/.test(expr)) continue;
    if (/\bprops\s*\.\s*imageUrl\b/.test(expr)) continue;
    // Bare `imageUrl` identifier — allowed ONLY if a destructured default
    // sets it (e.g. `({ imageUrl = PARAMS.imageUrl } = PARAMS)`).
    if (/^imageUrl$/.test(expr) && hasDestructuredDefault) continue;
    // String literal inside the expression (e.g. `"https://..."`).
    if (/^['"][^'"]+['"]$/.test(expr)) continue;
    errors.push(
      `imageUrl rule: <Img src={${expr}}> must reference PARAMS.imageUrl (or a destructured \`imageUrl\` prop) — bare identifier is undefined at scene-fragment scope`,
    );
  }

  // R3 — opaque solid overlay siblings.
  //
  // We only fire when an <Img> exists AND a self-closing div/AbsoluteFill
  // with backgroundColor follows it in source order. The "follows" check
  // is purely positional; AST-precise checks belong to a future TM-XXX
  // composition-lint pass. For each overlay, we verify it has no
  // `opacity:` (animated fade overlays are fine) and no children (overlay
  // with children is a wrapper layer, not a solid block).
  if (imgTags.length > 0) {
    const firstImgIdx = code.search(IMG_TAG_RE);
    IMG_TAG_RE.lastIndex = 0;
    OPAQUE_OVERLAY_FRAGMENT_RE.lastIndex = 0;
    let ov: RegExpExecArray | null;
    while ((ov = OPAQUE_OVERLAY_FRAGMENT_RE.exec(code)) !== null) {
      const fragment = ov[0];
      if (ov.index < firstImgIdx) continue; // overlay is BEHIND the Img (z-below) — fine
      // Allow when opacity is in the style — that's an animated fade,
      // not a solid block (TM-166 explicitly permits animated overlays).
      // Match both `opacity: <expr>` (explicit key) and ES shorthand
      // `{ opacity }` / `{ ..., opacity }` / `{ ..., opacity, ... }`.
      if (/\bopacity\s*:/.test(fragment)) continue;
      if (/\{[^}]*\bopacity\b[\s,}]/.test(fragment)) continue;
      // Allow rgba/transparent backgroundColor — that's translucent paint.
      if (/backgroundColor\s*:\s*['"]?(?:transparent|rgba\s*\()/.test(fragment)) continue;
      errors.push(
        'imageUrl rule: opaque solid <AbsoluteFill>/<div> sibling found after <Img> — the PNG IS the full scene; do NOT cover it with a solid backgroundColor block (add opacity, children, or remove)',
      );
      break; // one report is enough — multiple overlays usually share the cause
    }
    OPAQUE_OVERLAY_FRAGMENT_RE.lastIndex = 0;
  }

  return errors;
}

/**
 * TM-176 — full-bleed `<Img>` with `objectFit:'contain'` letterboxes the scene.
 *
 * Background: TM-167 RCA on the bear-in-meadow regression found that the
 * multi-step pipeline routinely emits `<Img src={PARAMS.imageUrl}
 * style={{ width:'100%', height:'100%', objectFit:'contain' }}/>` as the
 * full-bleed asset-gen layer. With a 16:9 viewport and a non-matching image
 * aspect ratio, `contain` shrinks the image to fit inside, producing black
 * letterbox bars covering ~70% of the frame (visible in tm-167-r1-baseline
 * screenshots). The asset-gen PNG IS the full scene by contract, so the
 * intended behaviour is `objectFit:'cover'` (crop, no bars).
 *
 * TM-167 patched the system prompt to recommend `cover`, but the validator
 * had no enforcement — so the LLM still emitted `contain` ~15% of the time
 * (TM-173 regression corpus #5/#7). This rule closes that gap.
 *
 * Definition of "full-bleed": the `<Img>` style sets BOTH `width:'100%'`
 * (or `width:'100vw'`) AND `height:'100%'` (or `height:'100vh'`). An Img
 * with explicit pixel sizes (`width: 200`) is treated as a small inline
 * image and is allowed to use `contain` — that's a legitimate use case
 * (logo, icon, thumbnail) where preserving aspect matters more than
 * filling the box.
 *
 * False-positive surface: the small-pixel and intentional-letterbox cases
 * are preserved; only the full-bleed shape (the actual TM-167 failure
 * mode) triggers. Validated against the TM-43/TM-173 corpus — fires only
 * on the regression cases, no incidental triggers on icon/badge scenes.
 */

// Every `<Img ...>` tag in the file, with its full attribute payload.
const IMG_TAG_FULL_RE = /<\s*Img\b([^>]*)>/g;

// Inside a single Img tag, find the `style={{ ... }}` payload (the
// inner braces). We accept both `style={{...}}` and the rarer
// `style={styleVar}` (skipped — can't statically resolve).
const STYLE_OBJECT_RE = /\bstyle\s*=\s*\{\s*\{([^}]*)\}\s*\}/;

// Width / height = '100%' or '100vw'/'100vh' inside a style object.
const FULL_WIDTH_RE = /\bwidth\s*:\s*['"](?:100%|100vw)['"]/;
const FULL_HEIGHT_RE = /\bheight\s*:\s*['"](?:100%|100vh)['"]/;

// objectFit:'contain' (or "contain") inside a style object.
const OBJECT_FIT_CONTAIN_RE = /\bobjectFit\s*:\s*['"]contain['"]/;

export function validateFullBleedImgObjectFit(code: string): string[] {
  const errors: string[] = [];
  let m: RegExpExecArray | null;
  IMG_TAG_FULL_RE.lastIndex = 0;
  let reported = false;
  while ((m = IMG_TAG_FULL_RE.exec(code)) !== null) {
    const attrs = m[1] ?? '';
    const styleMatch = attrs.match(STYLE_OBJECT_RE);
    if (!styleMatch) continue;
    const styleBody = styleMatch[1];
    if (!OBJECT_FIT_CONTAIN_RE.test(styleBody)) continue;
    if (!FULL_WIDTH_RE.test(styleBody)) continue;
    if (!FULL_HEIGHT_RE.test(styleBody)) continue;
    if (reported) continue; // one report is enough for the LLM to correct
    reported = true;
    errors.push(
      "Img rule (TM-176): full-bleed <Img> (width:'100%' AND height:'100%') with objectFit:'contain' letterboxes the scene — use objectFit:'cover' so the asset fills the frame without black bars",
    );
  }
  IMG_TAG_FULL_RE.lastIndex = 0;
  return errors;
}

/**
 * TM-175 — invented lucide icon detection.
 *
 * Scans `lucide.XYZ` member-access tokens (covers both `<lucide.XYZ/>` JSX
 * and bare `lucide.XYZ` expressions) and reports each PascalCase identifier
 * that is NOT a real `lucide-react` export. Returns one human-readable
 * error per distinct invented name, including the name itself so the LLM
 * (or human) can correct it on retry.
 *
 * The whitelist is built from `Object.keys(import * as lucide-react)` at
 * module load and tracks the pinned npm version; see `lucide-whitelist.ts`.
 *
 * This is the defense-in-depth layer behind `sanitizeForbiddenTokens`
 * rule §10 — the sanitizer normally rewrites invented icons to `Star`
 * before validation runs. Anything that reaches this check is either
 * (a) user-pasted code that skipped the sanitizer, or (b) a regression
 * in the sanitizer (the test corpus enforces these stay in sync).
 */
const LUCIDE_MEMBER_RE = /\blucide\s*\.\s*([A-Z][A-Za-z0-9]*)\b/g;

export function validateLucideIdentifiers(code: string): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  LUCIDE_MEMBER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LUCIDE_MEMBER_RE.exec(code)) !== null) {
    const name = m[1];
    if (LUCIDE_VALID_NAMES.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    errors.push(
      `Invented lucide icon: \`lucide.${name}\` is not a real lucide-react export — use a name from https://lucide.dev/icons (e.g. Star, Heart, Sparkles)`,
    );
  }
  LUCIDE_MEMBER_RE.lastIndex = 0;
  return errors;
}

/**
 * TM-185 — frame-driven motion enforcement (CSS-animation deny).
 *
 * Background: a major Class-A residual cause of "the animation doesn't move"
 * is LLM-emitted CSS animation. Remotion renders each frame in ISOLATION
 * (the player seeks to a frame and paints a fresh DOM with no wall-clock
 * continuity), so CSS `transition`, the `animation` shorthand, and
 * `@keyframes` never advance — they freeze at their t=0 state (see
 * Remotion docs /flickering). The deny-list in FORBIDDEN_PATTERNS already
 * rejects `setTimeout` / `setInterval` / `requestAnimationFrame`, but CSS
 * animation slips through because it is "just a style". This validator
 * closes that gap: all visual change MUST derive from `useCurrentFrame()`.
 *
 * Three forbidden shapes (each frozen at t=0 under frame-isolated render):
 *
 *   1. `@keyframes` — only meaningful inside a `<style>` tag / template-string
 *      CSS block; the keyframe timeline is driven by wall-clock, not frame.
 *   2. `transition:` style key with a NON-ZERO time — interpolates between
 *      successive DOM states over wall-clock; in a seeked render the prior
 *      state never existed, so it snaps with no tween.
 *   3. `animation:` / `animationName:` style key — binds a `@keyframes`
 *      timeline; same wall-clock problem.
 *
 * FALSE-POSITIVE avoidance (the hard part — frame-driven code must NEVER
 * be rejected):
 *   - The regexes anchor on the CSS *property key* form (`transition:` /
 *     `animation:` as an object key or CSS declaration), NOT on the bare
 *     word. So identifiers like `ZoomTransition`, `CounterAnimation`,
 *     `WebkitTransition`, `transitionRef`, or a local `const transition = …`
 *     do NOT match (the key form requires the token to START the property
 *     name and be immediately followed by `:`).
 *   - `WebkitTransition` / `MozAnimation` etc. are vendor-prefixed React
 *     style keys; they START with an uppercase vendor prefix, so the
 *     lowercase-anchored key regex skips them. (They are equally frozen, but
 *     they are vanishingly rare in LLM output and excluding them keeps the
 *     false-positive surface provably empty against the template corpus.)
 *   - A ZERO-duration / `none` transition (`transition: 'none'`,
 *     `transition: '0s'`, `transitionDuration: 0`) animates nothing and is
 *     harmless — allowed. Only a transition with a positive time unit
 *     (`0.3s`, `200ms`) is rejected.
 *   - `transitionProperty` WITHOUT a non-zero `transitionDuration` is inert
 *     (default duration 0s) — allowed.
 *
 * Validated against the 35-template corpus: only the genuine frozen
 * `transition: 'width 0.1s'` in CounterAnimation triggers (fixed in the
 * same PR), leaving false-positive count 0.
 */

// `@keyframes` declaration anywhere (template-literal CSS / <style> block).
const CSS_KEYFRAMES_RE = /@keyframes\b/;

// `animation:` or `animationName:` as an object/CSS property key.
// Anchored: must be preceded by `{`, `,`, `;`, whitespace, or start — and
// the key must be lowercase `animation` (so `WebkitAnimation`, identifiers
// like `myAnimation`, component names, etc. do NOT match).
const CSS_ANIMATION_KEY_RE = /(?:^|[\s,;{])animation(?:Name)?\s*:/;

// `transition:` / `transitionProperty:` / `transitionDuration:` property key,
// captured so we can inspect the value for a non-zero time.
// We grab the value up to the next `,` / `}` / `;` / newline.
const CSS_TRANSITION_DECL_RE =
  /(?:^|[\s,;{])transition(Property|Duration)?\s*:\s*([^,;}\n]+)/g;

// A positive time token: a number > 0 followed by s/ms (e.g. 0.3s, 200ms,
// 1s). `0s`, `0ms`, `0.0s` are NOT positive. Bare `0` / `none` → no time.
const POSITIVE_TIME_RE = /(?<!\d)(\d*\.?\d+)\s*(ms|s)\b/g;

function hasPositiveTime(value: string): boolean {
  POSITIVE_TIME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = POSITIVE_TIME_RE.exec(value)) !== null) {
    if (parseFloat(m[1]) > 0) return true;
  }
  return false;
}

export function validateFrameDrivenMotion(code: string): string[] {
  const errors: string[] = [];

  if (CSS_KEYFRAMES_RE.test(code)) {
    errors.push(
      'Frame-driven motion (TM-185): `@keyframes` CSS animation freezes at t=0 under Remotion frame-isolated render — drive all motion from useCurrentFrame()→interpolate()/spring() instead',
    );
  }

  if (CSS_ANIMATION_KEY_RE.test(code)) {
    errors.push(
      "Frame-driven motion (TM-185): CSS `animation`/`animationName` style key freezes at t=0 under Remotion frame-isolated render — drive motion from useCurrentFrame()→interpolate()/spring() instead",
    );
  }

  // transition: only the duration-bearing shorthand / transitionDuration
  // matters. `transition: 'none'` / `'0s'` and a bare `transitionProperty`
  // are inert and allowed.
  CSS_TRANSITION_DECL_RE.lastIndex = 0;
  let t: RegExpExecArray | null;
  let transitionReported = false;
  while ((t = CSS_TRANSITION_DECL_RE.exec(code)) !== null) {
    if (transitionReported) break;
    const kind = t[1]; // undefined (shorthand) | 'Property' | 'Duration'
    const value = t[2] ?? '';
    if (kind === 'Property') continue; // transitionProperty alone is inert
    if (!hasPositiveTime(value)) continue; // none / 0s / no time → harmless
    transitionReported = true;
    errors.push(
      "Frame-driven motion (TM-185): CSS `transition` with a non-zero time freezes at t=0 under Remotion frame-isolated render — drive the animated property from useCurrentFrame()→interpolate()/spring() instead of a CSS transition",
    );
  }
  CSS_TRANSITION_DECL_RE.lastIndex = 0;

  return errors;
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

  // TM-168 — imageUrl composition rules (only fire when PARAMS.imageUrl
  // is declared; no-op for non-image assets).
  for (const e of validateImageUrlComposition(code)) {
    if (!errors.includes(e)) errors.push(e);
  }

  // TM-175 — invented PascalCase lucide identifiers (defensive layer; the
  // pipeline sanitizer normally rewrites these to `Star` before we get here).
  for (const e of validateLucideIdentifiers(code)) {
    if (!errors.includes(e)) errors.push(e);
  }

  // TM-176 — full-bleed <Img> with objectFit:'contain' letterboxes the scene
  // (the asset-gen PNG IS the full scene; use 'cover' instead).
  for (const e of validateFullBleedImgObjectFit(code)) {
    if (!errors.includes(e)) errors.push(e);
  }

  // TM-185 — CSS animation (@keyframes / transition / animation shorthand)
  // freezes at t=0 under Remotion frame-isolated render. All motion must be
  // frame-driven via useCurrentFrame().
  for (const e of validateFrameDrivenMotion(code)) {
    if (!errors.includes(e)) errors.push(e);
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
