// Remotion entry point used by the /api/export route (TM-89).
//
// We can't reuse `src/remotion/UniversalComposition.tsx` as the bundle entry
// because that module exports the composition tree but never calls
// `registerRoot()`. The Next.js render path (e.g. <Player>) registers a root
// implicitly via its own runtime, but the standalone `@remotion/bundler`
// invoked from /api/export requires an explicit `registerRoot()` — without it
// the bundle evaluates to an empty registry and `selectComposition` throws.
//
// This mirrors the TM-75 `vr-entry.tsx` pattern: a thin entry that imports the
// shared `RemotionRoot` and registers it.
import { registerRoot } from 'remotion';
import { RemotionRoot } from './UniversalComposition';

registerRoot(RemotionRoot);
