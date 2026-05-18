// TM-152 — Circular-dependency guard.
//
// dependency-cruiser (unlike madge) correctly distinguishes a static
// `import` cycle from a runtime `await import(...)` edge. The repo
// currently has 0 true cycles; the single madge-reported pair
// (lib/ai/generate.ts ↔ lib/ai/pipeline.ts) is mitigated via documented
// dynamic imports and is therefore filtered out by dependency-cruiser.
//
// Run: `npm run check:circular`
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Modules must not depend on themselves transitively. Use dynamic ' +
        'import() to defer a cross-module edge if a true cycle is needed.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '(\\.test\\.(ts|tsx|js|jsx)$)|(__tests__)|(\\.next)' },
  },
};
