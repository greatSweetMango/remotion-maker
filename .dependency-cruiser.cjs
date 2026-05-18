// TM-152 — Circular-dependency guard.
// TM-155 — Fixed TS + `@/` alias resolution under moduleResolution=bundler.
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
      // TM-155: only flag *static* circular edges; `await import(...)` is a
      // documented mitigation (see generate.ts ↔ pipeline.ts).
      to: { circular: true, dynamic: false },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    // TM-155: enhanced-resolve options so local TS edges + `@/` alias
    // (tsconfig `paths`) are walked correctly under bundler resolution.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      mainFields: ['module', 'main', 'types'],
    },
    exclude: { path: '(\\.test\\.(ts|tsx|js|jsx)$)|(__tests__)|(\\.next)' },
  },
};
