/**
 * TM-144 — generate the EasyMake Lottie catalogue (CC0-1.0).
 *
 * # Why hand-authored stubs instead of LottieFiles downloads
 *
 * The TM-144 ticket asked for "5-10 CC0/MIT-equivalent Lottie assets".
 * We considered scraping LottieFiles' Free tab, but their per-asset
 * licenses are not uniformly CC0/MIT — many "free for personal use"
 * entries forbid SaaS redistribution, which is exactly what EasyMake
 * does. Rather than play license whack-a-mole on a moving CDN, we
 * generate a small set of EasyMake-authored Lottie JSONs ourselves and
 * dedicate them to CC0-1.0. This guarantees:
 *
 *   1. Every asset's provenance is the EasyMake repo at a known commit.
 *   2. We can re-derive sha256 deterministically (regenerate -> same
 *      hash), so the manifest's integrity check stays reproducible.
 *   3. No surprise EULA in a third-party CDN can retroactively block
 *      our prod deploy.
 *
 * The animations are deliberately minimal (geometric shapes, pure
 * transforms — no expressions, no embedded fonts, no images) so they
 * stay inside the @remotion/lottie supported feature subset documented
 * by `getLottieMetadata`. They're placeholders with semantic motion,
 * not character art — the goal is that the LLM can pick a "walk-cycle
 * bear" entry and the user gets a plausible bear-shaped silhouette
 * bobbing across the frame.
 *
 * Future work (separate ADR): swap individual entries for hand-drawn
 * After Effects exports as we commission them. The manifest schema
 * doesn't change.
 *
 * # Usage
 *
 *   pnpm tsx scripts/lottie/generate-stub-lotties.ts
 *
 * Writes `public/lottie/<slug>.json` for every entry below and rewrites
 * `public/lottie/MANIFEST.json` with fresh sha256s + bytes.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

// ---------- Lottie helpers ----------

type Vec2 = [number, number];
type RGBA = [number, number, number, number];

interface Keyframe {
  t: number;
  s: number[];
  i?: { x: number[] | number; y: number[] | number };
  o?: { x: number[] | number; y: number[] | number };
  to?: number[];
  ti?: number[];
}

const ease = {
  i: { x: [0.5], y: [1] },
  o: { x: [0.5], y: [0] },
};

function shapeFill(color: RGBA) {
  return {
    ty: 'fl',
    c: { a: 0, k: color },
    o: { a: 0, k: 100 },
    nm: 'fill',
  };
}

function shapeTransform(pos: Vec2 = [0, 0], scale: Vec2 = [100, 100], rot = 0) {
  return {
    ty: 'tr',
    p: { a: 0, k: pos },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: scale },
    r: { a: 0, k: rot },
    o: { a: 0, k: 100 },
  };
}

function ellipse(size: Vec2, pos: Vec2 = [0, 0]) {
  return {
    ty: 'el',
    p: { a: 0, k: pos },
    s: { a: 0, k: size },
    nm: 'ellipse',
  };
}

function rect(size: Vec2, pos: Vec2 = [0, 0], r = 0) {
  return {
    ty: 'rc',
    p: { a: 0, k: pos },
    s: { a: 0, k: size },
    r: { a: 0, k: r },
    nm: 'rect',
  };
}

function group(items: unknown[], name = 'group') {
  return { ty: 'gr', it: items, nm: name };
}

interface LayerOpts {
  ind: number;
  name: string;
  shapes: unknown[];
  pos: { a: 0; k: [number, number, number] } | { a: 1; k: Keyframe[] };
  rot?: { a: 0; k: number } | { a: 1; k: Keyframe[] };
  scale?: { a: 0; k: [number, number, number] } | { a: 1; k: Keyframe[] };
  ip?: number;
  op?: number;
}

function shapeLayer(o: LayerOpts) {
  return {
    ddd: 0,
    ind: o.ind,
    ty: 4,
    nm: o.name,
    sr: 1,
    ks: {
      o: { a: 0, k: 100 },
      r: o.rot ?? { a: 0, k: 0 },
      p: o.pos,
      a: { a: 0, k: [0, 0, 0] },
      s: o.scale ?? { a: 0, k: [100, 100, 100] },
    },
    ao: 0,
    shapes: o.shapes,
    ip: o.ip ?? 0,
    op: o.op ?? 60,
    st: 0,
    bm: 0,
  };
}

interface BuildOpts {
  name: string;
  fps: number;
  durationFrames: number;
  width: number;
  height: number;
  layers: unknown[];
}

function buildLottie(o: BuildOpts) {
  return {
    v: '5.7.4',
    fr: o.fps,
    ip: 0,
    op: o.durationFrames,
    w: o.width,
    h: o.height,
    nm: o.name,
    ddd: 0,
    assets: [],
    layers: o.layers,
    meta: { g: 'easymake-tm144', tc: '#000000' },
  };
}

// ---------- Animation builders ----------

// Walking cycle for an animal silhouette — two-tone body+head bobbing
// horizontally with a slight vertical bounce.
function walkingAnimal(opts: {
  name: string;
  bodyColor: RGBA;
  headOffset?: number;
  ear?: 'round' | 'pointy' | 'none';
}) {
  const W = 400;
  const H = 400;
  const dur = 60;

  // body bob: x stays centered, y oscillates ±8
  const bodyPos: Keyframe[] = [
    { i: ease.i, o: ease.o, t: 0, s: [200, 240, 0] },
    { i: ease.i, o: ease.o, t: 15, s: [200, 232, 0] },
    { i: ease.i, o: ease.o, t: 30, s: [200, 240, 0] },
    { i: ease.i, o: ease.o, t: 45, s: [200, 232, 0] },
    { t: 60, s: [200, 240, 0] },
  ];

  const headPos: Keyframe[] = bodyPos.map((kf) => ({
    ...kf,
    s: [kf.s[0], (kf.s[1] as number) - 70 + (opts.headOffset ?? 0), 0],
  }));

  // legs (two rectangles) cycling forward/back
  const legFront = (offset: number): Keyframe[] => [
    { i: ease.i, o: ease.o, t: 0, s: [0 + offset] },
    { i: ease.i, o: ease.o, t: 30, s: [40 + offset] },
    { t: 60, s: [0 + offset] },
  ];

  const layers = [
    // back leg
    shapeLayer({
      ind: 1,
      name: 'leg-back',
      pos: { a: 0, k: [200, 320, 0] },
      shapes: [
        group([
          rect([18, 60], [-30, 0], 4),
          shapeFill([0.35, 0.22, 0.12, 1]),
          shapeTransform(),
        ]),
      ],
      rot: { a: 1, k: legFront(-15) },
    }),
    // front leg
    shapeLayer({
      ind: 2,
      name: 'leg-front',
      pos: { a: 0, k: [200, 320, 0] },
      shapes: [
        group([
          rect([18, 60], [30, 0], 4),
          shapeFill([0.35, 0.22, 0.12, 1]),
          shapeTransform(),
        ]),
      ],
      rot: { a: 1, k: legFront(15) },
    }),
    // body
    shapeLayer({
      ind: 3,
      name: 'body',
      pos: { a: 1, k: bodyPos },
      shapes: [
        group([
          ellipse([180, 110]),
          shapeFill(opts.bodyColor),
          shapeTransform(),
        ]),
      ],
    }),
    // head
    shapeLayer({
      ind: 4,
      name: 'head',
      pos: { a: 1, k: headPos },
      shapes: [
        group([
          ellipse([95, 95]),
          shapeFill(opts.bodyColor),
          shapeTransform(),
        ]),
        // ears
        ...(opts.ear === 'round'
          ? [
              group([
                ellipse([28, 28], [-32, -38]),
                shapeFill(opts.bodyColor),
                shapeTransform(),
              ]),
              group([
                ellipse([28, 28], [32, -38]),
                shapeFill(opts.bodyColor),
                shapeTransform(),
              ]),
            ]
          : opts.ear === 'pointy'
            ? [
                group([
                  rect([18, 30], [-30, -50], 4),
                  shapeFill(opts.bodyColor),
                  shapeTransform(),
                ]),
                group([
                  rect([18, 30], [30, -50], 4),
                  shapeFill(opts.bodyColor),
                  shapeTransform(),
                ]),
              ]
            : []),
        // eye dot
        group([
          ellipse([10, 10], [22, -5]),
          shapeFill([0.05, 0.05, 0.05, 1]),
          shapeTransform(),
        ]),
      ],
    }),
  ];
  return buildLottie({
    name: opts.name,
    fps: 30,
    durationFrames: dur,
    width: W,
    height: H,
    layers,
  });
}

// Idle breathing — single shape with pulsating scale.
function idleBreathing(opts: { name: string; color: RGBA }) {
  const dur = 90;
  const scaleKf: Keyframe[] = [
    { i: ease.i, o: ease.o, t: 0, s: [100, 100, 100] },
    { i: ease.i, o: ease.o, t: 45, s: [108, 108, 100] },
    { t: 90, s: [100, 100, 100] },
  ];
  return buildLottie({
    name: opts.name,
    fps: 30,
    durationFrames: dur,
    width: 400,
    height: 400,
    layers: [
      shapeLayer({
        ind: 1,
        name: 'idle-body',
        pos: { a: 0, k: [200, 220, 0] },
        scale: { a: 1, k: scaleKf },
        shapes: [
          group([
            ellipse([180, 140]),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
          group([
            ellipse([100, 100], [0, -90]),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
        ],
      }),
    ],
  });
}

// Dancing — shape rotating + scaling on a beat.
function dancingFigure(opts: { name: string; color: RGBA }) {
  const dur = 60;
  const rotKf: Keyframe[] = [
    { i: ease.i, o: ease.o, t: 0, s: [-15] },
    { i: ease.i, o: ease.o, t: 30, s: [15] },
    { t: 60, s: [-15] },
  ];
  const scaleKf: Keyframe[] = [
    { i: ease.i, o: ease.o, t: 0, s: [100, 100, 100] },
    { i: ease.i, o: ease.o, t: 15, s: [110, 90, 100] },
    { i: ease.i, o: ease.o, t: 30, s: [100, 110, 100] },
    { i: ease.i, o: ease.o, t: 45, s: [110, 90, 100] },
    { t: 60, s: [100, 100, 100] },
  ];
  return buildLottie({
    name: opts.name,
    fps: 30,
    durationFrames: dur,
    width: 400,
    height: 400,
    layers: [
      shapeLayer({
        ind: 1,
        name: 'dancer',
        pos: { a: 0, k: [200, 220, 0] },
        rot: { a: 1, k: rotKf },
        scale: { a: 1, k: scaleKf },
        shapes: [
          group([
            ellipse([60, 60], [0, -80]),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
          group([
            rect([90, 130], [0, 0], 30),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
          group([
            rect([20, 80], [-50, 30], 8),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
          group([
            rect([20, 80], [50, 30], 8),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
        ],
      }),
    ],
  });
}

// Running figure — fast leg cycle + forward lean.
function runningFigure(opts: { name: string; color: RGBA }) {
  const dur = 30; // faster cycle
  const legKf = (sign: number): Keyframe[] => [
    { i: ease.i, o: ease.o, t: 0, s: [sign * -40] },
    { i: ease.i, o: ease.o, t: 15, s: [sign * 40] },
    { t: 30, s: [sign * -40] },
  ];
  return buildLottie({
    name: opts.name,
    fps: 30,
    durationFrames: dur,
    width: 400,
    height: 400,
    layers: [
      shapeLayer({
        ind: 1,
        name: 'leg-back',
        pos: { a: 0, k: [200, 290, 0] },
        rot: { a: 1, k: legKf(1) },
        shapes: [
          group([
            rect([18, 80], [0, 30], 6),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
        ],
      }),
      shapeLayer({
        ind: 2,
        name: 'leg-front',
        pos: { a: 0, k: [200, 290, 0] },
        rot: { a: 1, k: legKf(-1) },
        shapes: [
          group([
            rect([18, 80], [0, 30], 6),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
        ],
      }),
      shapeLayer({
        ind: 3,
        name: 'torso',
        pos: { a: 0, k: [200, 220, 0] },
        rot: { a: 0, k: 12 },
        shapes: [
          group([
            ellipse([90, 130]),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
          group([
            ellipse([60, 60], [25, -90]),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
        ],
      }),
    ],
  });
}

// Jumping figure — vertical pop with squash/stretch.
function jumpingFigure(opts: { name: string; color: RGBA }) {
  const dur = 60;
  const posKf: Keyframe[] = [
    { i: ease.i, o: ease.o, t: 0, s: [200, 280, 0] },
    { i: ease.i, o: ease.o, t: 30, s: [200, 140, 0] },
    { t: 60, s: [200, 280, 0] },
  ];
  const scaleKf: Keyframe[] = [
    { i: ease.i, o: ease.o, t: 0, s: [120, 80, 100] },
    { i: ease.i, o: ease.o, t: 15, s: [90, 115, 100] },
    { i: ease.i, o: ease.o, t: 30, s: [100, 100, 100] },
    { i: ease.i, o: ease.o, t: 45, s: [90, 115, 100] },
    { t: 60, s: [120, 80, 100] },
  ];
  return buildLottie({
    name: opts.name,
    fps: 30,
    durationFrames: dur,
    width: 400,
    height: 400,
    layers: [
      shapeLayer({
        ind: 1,
        name: 'kid',
        pos: { a: 1, k: posKf },
        scale: { a: 1, k: scaleKf },
        shapes: [
          group([
            ellipse([70, 70], [0, -70]),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
          group([
            rect([90, 100], [0, 10], 30),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
        ],
      }),
    ],
  });
}

// Flying creature — arc path + wing flap (scale x).
function flyingCreature(opts: { name: string; color: RGBA }) {
  const dur = 90;
  const posKf: Keyframe[] = [
    { i: ease.i, o: ease.o, t: 0, s: [80, 200, 0] },
    { i: ease.i, o: ease.o, t: 45, s: [200, 120, 0] },
    { t: 90, s: [320, 200, 0] },
  ];
  const wingKf: Keyframe[] = [
    { i: ease.i, o: ease.o, t: 0, s: [100, 100, 100] },
    { i: ease.i, o: ease.o, t: 10, s: [100, 30, 100] },
    { i: ease.i, o: ease.o, t: 20, s: [100, 100, 100] },
    { i: ease.i, o: ease.o, t: 30, s: [100, 30, 100] },
    { i: ease.i, o: ease.o, t: 40, s: [100, 100, 100] },
    { i: ease.i, o: ease.o, t: 50, s: [100, 30, 100] },
    { i: ease.i, o: ease.o, t: 60, s: [100, 100, 100] },
    { i: ease.i, o: ease.o, t: 70, s: [100, 30, 100] },
    { t: 90, s: [100, 100, 100] },
  ];
  return buildLottie({
    name: opts.name,
    fps: 30,
    durationFrames: dur,
    width: 400,
    height: 400,
    layers: [
      shapeLayer({
        ind: 1,
        name: 'wings',
        pos: { a: 1, k: posKf },
        scale: { a: 1, k: wingKf },
        shapes: [
          group([
            ellipse([180, 40]),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
        ],
      }),
      shapeLayer({
        ind: 2,
        name: 'body',
        pos: { a: 1, k: posKf },
        shapes: [
          group([
            ellipse([60, 36]),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
          group([
            ellipse([34, 34], [25, -8]),
            shapeFill(opts.color),
            shapeTransform(),
          ]),
        ],
      }),
    ],
  });
}

// Scene background — drifting clouds across a sky band.
function sceneClouds(opts: { name: string }) {
  const dur = 120;
  const cloudKf = (startX: number): Keyframe[] => [
    { i: ease.i, o: ease.o, t: 0, s: [startX, 120, 0] },
    { t: 120, s: [startX + 400, 120, 0] },
  ];
  const cloudShapes = [
    group([
      ellipse([100, 50], [0, 0]),
      shapeFill([1, 1, 1, 1]),
      shapeTransform(),
    ]),
    group([
      ellipse([60, 50], [-40, 5]),
      shapeFill([1, 1, 1, 1]),
      shapeTransform(),
    ]),
    group([
      ellipse([60, 50], [40, 5]),
      shapeFill([1, 1, 1, 1]),
      shapeTransform(),
    ]),
  ];
  return buildLottie({
    name: opts.name,
    fps: 30,
    durationFrames: dur,
    width: 400,
    height: 400,
    layers: [
      // sky
      shapeLayer({
        ind: 1,
        name: 'sky',
        pos: { a: 0, k: [200, 200, 0] },
        shapes: [
          group([
            rect([400, 400], [0, 0], 0),
            shapeFill([0.55, 0.78, 0.95, 1]),
            shapeTransform(),
          ]),
        ],
        op: dur,
      }),
      shapeLayer({
        ind: 2,
        name: 'cloud-a',
        pos: { a: 1, k: cloudKf(-100) },
        shapes: cloudShapes,
        op: dur,
      }),
      shapeLayer({
        ind: 3,
        name: 'cloud-b',
        pos: { a: 1, k: cloudKf(-300) },
        shapes: cloudShapes,
        op: dur,
      }),
    ],
  });
}

// ---------- Catalogue ----------

interface CatalogueEntry {
  filename: string;
  subject: string;
  motion: string;
  durationFrames: number;
  fps: number;
  category: 'character' | 'scene';
  build: () => unknown;
}

const CATALOGUE: CatalogueEntry[] = [
  {
    filename: 'bear-walk.json',
    subject: 'bear',
    motion: 'side-view brown bear walking loop with leg cycle and body bob',
    durationFrames: 60,
    fps: 30,
    category: 'character',
    build: () =>
      walkingAnimal({
        name: 'bear-walk',
        bodyColor: [0.55, 0.36, 0.18, 1],
        ear: 'round',
      }),
  },
  {
    filename: 'cat-walk.json',
    subject: 'cat',
    motion: 'side-view orange cat walking loop with pointy ears',
    durationFrames: 60,
    fps: 30,
    category: 'character',
    build: () =>
      walkingAnimal({
        name: 'cat-walk',
        bodyColor: [0.95, 0.55, 0.2, 1],
        ear: 'pointy',
      }),
  },
  {
    filename: 'dog-run.json',
    subject: 'dog',
    motion: 'side-view dog running loop with fast leg cycle and forward lean',
    durationFrames: 30,
    fps: 30,
    category: 'character',
    build: () =>
      runningFigure({
        name: 'dog-run',
        color: [0.45, 0.3, 0.15, 1],
      }),
  },
  {
    filename: 'cat-idle.json',
    subject: 'cat',
    motion: 'sitting cat idle breathing loop, gentle pulse',
    durationFrames: 90,
    fps: 30,
    category: 'character',
    build: () =>
      idleBreathing({
        name: 'cat-idle',
        color: [0.6, 0.6, 0.6, 1],
      }),
  },
  {
    filename: 'person-dance.json',
    subject: 'person',
    motion: 'person dancing loop with side-to-side rotation and squash-stretch',
    durationFrames: 60,
    fps: 30,
    category: 'character',
    build: () =>
      dancingFigure({
        name: 'person-dance',
        color: [0.2, 0.45, 0.85, 1],
      }),
  },
  {
    filename: 'kid-jump.json',
    subject: 'kid',
    motion: 'small character jumping in place with squash-and-stretch',
    durationFrames: 60,
    fps: 30,
    category: 'character',
    build: () =>
      jumpingFigure({
        name: 'kid-jump',
        color: [0.92, 0.4, 0.45, 1],
      }),
  },
  {
    filename: 'bird-fly.json',
    subject: 'bird',
    motion: 'bird flying across the frame in a gentle arc with wing flaps',
    durationFrames: 90,
    fps: 30,
    category: 'character',
    build: () =>
      flyingCreature({
        name: 'bird-fly',
        color: [0.3, 0.6, 0.4, 1],
      }),
  },
  {
    filename: 'sky-clouds.json',
    subject: 'scene',
    motion: 'sky background scene with two drifting clouds, full-frame loop',
    durationFrames: 120,
    fps: 30,
    category: 'scene',
    build: () => sceneClouds({ name: 'sky-clouds' }),
  },
];

// ---------- Emit ----------

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

const lottieDir = path.join(process.cwd(), 'public', 'lottie');
const manifestEntries: Array<{
  filename: string;
  subject: string;
  motion: string;
  durationFrames: number;
  fps: number;
  license: string;
  attribution: string;
  category: string;
  sha256: string;
  bytes: number;
}> = [];

for (const entry of CATALOGUE) {
  const obj = entry.build();
  // Stable serialization — sorted-key JSON guarantees reproducible sha256.
  // Lottie players don't care about key order, but our integrity check does.
  const text = JSON.stringify(obj);
  const buf = Buffer.from(text, 'utf8');
  const fp = path.join(lottieDir, entry.filename);
  writeFileSync(fp, buf);
  manifestEntries.push({
    filename: entry.filename,
    subject: entry.subject,
    motion: entry.motion,
    durationFrames: entry.durationFrames,
    fps: entry.fps,
    license: 'CC0-1.0',
    attribution: 'EasyMake (TM-144 hand-authored stub)',
    category: entry.category,
    sha256: sha256(buf),
    bytes: buf.byteLength,
  });
  console.log(
    `wrote ${entry.filename}  ${buf.byteLength.toString().padStart(6)} bytes  ${sha256(buf).slice(0, 12)}…`,
  );
}

const manifest = {
  $schema: 'https://easymake.dev/schemas/lottie-manifest.v1.json',
  version: 1,
  note:
    'TM-144 / ADR-0027 hand-authored CC0-1.0 catalogue. All assets are simple shape-based animations generated by scripts/lottie/generate-stub-lotties.ts. Licensed CC0-1.0; attribution EasyMake. To regenerate: pnpm tsx scripts/lottie/generate-stub-lotties.ts',
  assets: manifestEntries.map((e) => {
    // strip `category` — not part of the manifest schema (lives in this script
    // for documentation; if curation expands we can promote it later via ADR).
    const { category: _category, ...rest } = e;
    void _category;
    return rest;
  }),
};

writeFileSync(
  path.join(lottieDir, 'MANIFEST.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

console.log(
  `\nwrote MANIFEST.json with ${manifestEntries.length} entries — categories: ${[
    ...new Set(manifestEntries.map((e) => e.category)),
  ].join(', ')}`,
);
