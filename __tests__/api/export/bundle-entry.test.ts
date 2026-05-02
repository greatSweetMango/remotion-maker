/**
 * TM-89 — verify the /api/export bundle entry registers a Remotion root.
 *
 * Prior to TM-89 the route used `src/remotion/UniversalComposition.tsx` as
 * the bundle entry, which exports a Composition tree but never calls
 * `registerRoot()`. That works for the in-app <Player> path (which registers
 * implicitly) but breaks the standalone `@remotion/bundler` flow used here:
 * `selectComposition()` would throw because the bundle exposes no root.
 *
 * This test bundles the new entry (`src/remotion/export-entry.tsx`) and
 * confirms `selectComposition` can resolve `UniversalComposition`.
 *
 * Slow (~30s due to webpack bundle); we keep the timeout generous and skip
 * it on CI when REMOTION_BUNDLE_TEST is not set, mirroring the
 * visual-regression driver's opt-in pattern.
 */
import path from 'path';

const RUN = process.env.REMOTION_BUNDLE_TEST === '1';
const d = RUN ? describe : describe.skip;

d('export bundle entry (TM-89)', () => {
  jest.setTimeout(120_000);

  it('registers RemotionRoot so selectComposition resolves UniversalComposition', async () => {
    const { bundle } = await import('@remotion/bundler');
    const { selectComposition } = await import('@remotion/renderer');

    const entryPoint = path.resolve(process.cwd(), 'src/remotion/export-entry.tsx');
    const serveUrl = await bundle({
      entryPoint,
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          alias: {
            ...(config.resolve?.alias || {}),
            '@': path.resolve(process.cwd(), 'src'),
          },
        },
      }),
    });

    const composition = await selectComposition({
      serveUrl,
      id: 'UniversalComposition',
      inputProps: { jsCode: '', params: {} },
    });

    expect(composition.id).toBe('UniversalComposition');
    expect(composition.fps).toBe(30);
    expect(composition.width).toBe(1920);
    expect(composition.height).toBe(1080);
  });
});
