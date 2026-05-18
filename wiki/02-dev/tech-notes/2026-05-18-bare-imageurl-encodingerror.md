---
title: "Bare `imageUrl` in scene fragment → browser `EncodingError`"
date: 2026-05-18
type: tech-note
task: TM-178
tags: [#gotcha, #ai-pipeline, #asset-gen, #remotion-img, #scope]
---

# Bare `imageUrl` identifier in a scene fragment → misleading `EncodingError`

## Symptom

Browser console (Studio preview):

```
EncodingError: The source image cannot be decoded.
[TM-116] scene render error in SceneN: imageUrl is not defined
```

The first line is **misleading** — the PNG on disk and on the wire is fine. The actual cause is the second line.

## Mechanism

1. The multi-step pipeline's per-scene system prompt (asset-gen branch) can produce a scene fragment containing `<Img src={imageUrl} ... />` — a **bare identifier**, not `PARAMS.imageUrl`.
2. `composeSceneCodes` builds the wrapper module with a `PARAMS.imageUrl` field for the customize UI but never declares a module-scope `imageUrl` binding.
3. Inside the scene component, the bare `imageUrl` is unresolved → `ReferenceError: imageUrl is not defined`.
4. Remotion's `<Img>` ends up with `src={undefined}` for any path that doesn't throw first; the browser sets `<img src="">` and tries to decode the document URL / empty body as a PNG. The decoder rejects → `EncodingError: The source image cannot be decoded.`
5. `__SceneBoundary` (TM-116) catches the throw and blanks that scene — so the rest of the asset keeps playing and the user sees a perpetually-firing error in console with no visible cause.

## Fix (in `composeSceneCodes`, TM-178)

Inject a module-scope shim when needed:

```ts
let imageUrlShim = '';
if (imageUrl) {
  const declaresImageUrl = renamedFragments.some(f =>
    /(?:^|\n)\s*(?:const|let|var)\s+imageUrl\b/.test(f),
  );
  const referencesImageUrl = renamedFragments.some(f =>
    /\bimageUrl\b/.test(f),
  );
  if (referencesImageUrl && !declaresImageUrl) {
    imageUrlShim = `const imageUrl = ${JSON.stringify(imageUrl)};\n\n`;
  }
}
return `${imageUrlShim}${fragments}\n\n…`;
```

The redeclare-guard is required: a fragment that legitimately writes `const imageUrl = "https://..."` for a hardcoded image must win and we must NOT emit a sibling `const imageUrl` (SyntaxError).

## Belt-and-braces

The per-scene system prompt on `main` was already updated (TM-168) to say `PARAMS.imageUrl` explicitly. The compose-time shim is **defense in depth**: gpt-4o still drifts in roughly a third of multi-scene runs even when the prompt is correct, and one bad scene is enough for the user to see the error.

## How to recognise this in the wild

- "EncodingError" without an obvious 404 in DevTools Network tab.
- Coincides with `[TM-116] scene render error in Scene{N}: imageUrl is not defined`.
- File `public/uploads/asset-gen/<hash>.png` exists and is a valid PNG (`file` says `PNG image data`).
- `curl -I` to the URL returns 200 OK.
- The DB-stored `Asset.code` contains `<Img src={imageUrl}` (bare) rather than `<Img src={PARAMS.imageUrl}`.

## Related

- `ADR-0022` — asset-gen pipeline.
- `wiki/05-reports/2026-05-18-TM-178-retro.md` — full RCA.
- `wiki/02-dev/tech-notes/2026-04-26-evaluator-params-bug.md` — sibling story of SCREAMING_CASE identifier mishandling.
