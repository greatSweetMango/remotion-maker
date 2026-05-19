/**
 * TM-171 — shared Remotion bundle accessor.
 *
 * `/api/export` originally owned the bundle-cache singleton (see TM-89). The
 * TM-171 composition-critique loop needs the same bundle on the generate path
 * to render a single still for visual judging — so we lift the singleton here.
 * Both call sites share one cache, so the first request that triggers a bundle
 * pays the ~10s webpack tax once and every subsequent request (export OR
 * critique) reuses the same serve URL.
 *
 * The bundle entry point (`src/remotion/export-entry.tsx`) registers the
 * universal Remotion root — same composition the /api/export render uses, so
 * inputProps shape (`{ jsCode, params }`) is identical across both paths.
 */
import path from 'path';

let bundleCachePromise: Promise<string> | null = null;

export async function getSharedBundlePath(): Promise<string> {
  if (bundleCachePromise) return bundleCachePromise;
  bundleCachePromise = (async () => {
    const { bundle } = await import('@remotion/bundler');
    const entryPoint = path.resolve(process.cwd(), 'src/remotion/export-entry.tsx');
    return bundle({
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
  })();
  try {
    return await bundleCachePromise;
  } catch (err) {
    // Reset on failure so the next caller can retry instead of being stuck on
    // a permanently-rejected promise.
    bundleCachePromise = null;
    throw err;
  }
}

/** Test seam — reset the cached bundle between integration test runs. */
export function __resetBundleCacheForTesting() {
  bundleCachePromise = null;
}
