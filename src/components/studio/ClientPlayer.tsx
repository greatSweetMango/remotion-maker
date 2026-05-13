'use client';
/**
 * TM-122: Client-only wrapper around `@remotion/player`'s <Player>.
 *
 * Why this exists
 * ---------------
 * Even though every wrapper that uses <Player> is already marked
 * `'use client'`, Next.js 16 still SSRs client components on the initial
 * request. Remotion's Player evaluates `useCurrentFrame()` at frame 0
 * during SSR, which causes SVG coordinates / CSS transforms to differ
 * from the client by the last few floating-point digits, producing a
 * flood of hydration mismatches in the browser console, e.g.:
 *
 *   + x2={-355.9574246867301}    (client)
 *   - x2="-355.95742468673006"   (server)
 *
 * The fix is to skip SSR entirely for the Player subtree via
 * `next/dynamic({ ssr: false })`. We keep the export name `Player` so
 * call sites only swap the import path.
 *
 * Ref forwarding
 * --------------
 * `next/dynamic` does not forward refs through its loader proxy, so we
 * accept the ref as a named prop `playerRef` and re-attach it inside
 * the loader factory. Type-only imports from `@remotion/player` are
 * safe (no runtime cost, no SSR involvement).
 */
import * as React from 'react';
import dynamic from 'next/dynamic';
import type {
  PlayerPropsWithoutZod,
  PlayerRef,
} from '@remotion/player';

type AnyProps = Record<string, unknown>;
type AnyPlayerProps = PlayerPropsWithoutZod<AnyProps>;

type ClientPlayerProps = AnyPlayerProps & {
  playerRef?: React.Ref<PlayerRef>;
};

// next/dynamic loader: import the real Player on the client only.
// The factory returns a small React component that re-attaches the ref
// from props onto the underlying Player (next/dynamic strips refs).
const PlayerDynamic = dynamic(
  async () => {
    const mod = await import('@remotion/player');
    const RealPlayer = mod.Player as unknown as React.ComponentType<
      AnyPlayerProps & { ref?: React.Ref<PlayerRef> }
    >;
    const Wrapped = (props: ClientPlayerProps) => {
      const { playerRef, ...rest } = props;
      return <RealPlayer ref={playerRef} {...(rest as AnyPlayerProps)} />;
    };
    Wrapped.displayName = 'ClientPlayerInner';
    return Wrapped;
  },
  { ssr: false },
) as React.ComponentType<ClientPlayerProps>;

/**
 * Drop-in replacement for `@remotion/player`'s <Player>.
 * Pass a ref via the `playerRef` prop instead of `ref` (see file header).
 */
export const Player = PlayerDynamic;
export type { PlayerRef, PlayerProps, PlayerPropsWithoutZod } from '@remotion/player';
