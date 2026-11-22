// Map scenery (owner request): Tokyo, Manila rooftop, San Francisco rooftop, Central Park,
// New York rooftop at night, and UC Berkeley / UCLA / USC campus impressions (school colours
// and campus-style buildings only: no logos, mascots, seals or lettering).
// Original low-poly impressions of each place, built from the scene's box/blob primitives.
// No real logos, signs or brand lettering — only shapes, colours and lights.
import type { MapId } from "../shared/types.ts";
import type { Lighting, Spot } from "./renderer.ts";

type V = number[];
export interface Builder {
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: V,
    rx?: number,
    rz?: number,
    ry?: number,
  ): void;
  blob(
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    color: V,
    stretch?: number,
    rings?: number,
    segs?: number,
  ): void;
  text(
    s: string,
    x: number,
    y: number,
    z: number,
    size: number,
    ux: number,
    uz: number,
    color: V,
  ): number;
  /** Mark what follows as glowing (lit windows, neon, lamps); 0 = normal. */
  glow?(k: number): void;
}

/** How strongly lit windows glow on the current map (set by buildMap). */
let WIN = 0.3;

/** Sky, fog and light for each map. `ground` is drawn under the court area. */
export interface Look {
  sky: V;
  fogNear: number;
  fogFar: number;
  ambient: number;
  spots: number;
  ground: V | null;
  apron: V;
}
export const LOOKS: Record<MapId, Look> = {
  arena: {
    sky: [0.035, 0.035, 0.07],
    fogNear: 16,
    fogFar: 46,
    ambient: 0.78,
    spots: 1,
    ground: [0.52, 0.07, 0.16],
    apron: [0.44, 0.06, 0.14],
  },
  tokyo: {
    sky: [0.07, 0.05, 0.16],
    fogNear: 30,
    fogFar: 120,
    ambient: 0.8,
    spots: 0.8,
    ground: [0.17, 0.17, 0.22],
    apron: [0.14, 0.11, 0.24],
  },
  manila: {
    sky: [0.97, 0.6, 0.42],
    fogNear: 40,
    fogFar: 135,
    ambient: 0.98,
    spots: 0.25,
    ground: null,
    apron: [0.16, 0.42, 0.42],
  },
  sf: {
    sky: [0.73, 0.79, 0.86],
    fogNear: 30,
    fogFar: 125,
    ambient: 1.0,
    spots: 0.2,
    ground: null,
    apron: [0.2, 0.36, 0.3],
  },
  centralpark: {
    sky: [0.56, 0.76, 0.96],
    fogNear: 60,
    fogFar: 200,
    ambient: 1.02,
    spots: 0.15,
    ground: [0.3, 0.56, 0.26],
    apron: [0.3, 0.33, 0.38],
  },
  nyc: {
    sky: [0.02, 0.025, 0.07],
    fogNear: 50,
    fogFar: 190,
    ambient: 0.74,
    spots: 1,
    ground: null,
    apron: [0.12, 0.13, 0.2],
  },
  berkeley: {
    sky: [0.62, 0.8, 0.97],
    fogNear: 60,
    fogFar: 200,
    ambient: 1.02,
    spots: 0.15,
    ground: [0.34, 0.58, 0.28],
    apron: [0.0, 0.2, 0.38],
  },
  haas: {
    sky: [0.66, 0.8, 0.95],
    fogNear: 60,
    fogFar: 200,
    ambient: 1.0,
    spots: 0.15,
    ground: null,
    apron: [0.0, 0.2, 0.38],
  },
  ucla: {
    sky: [0.55, 0.78, 0.98],
    fogNear: 60,
    fogFar: 200,
    ambient: 1.04,
    spots: 0.15,
    ground: [0.36, 0.6, 0.28],
    apron: [0.15, 0.45, 0.68],
  },
  usc: {
    sky: [0.98, 0.78, 0.55],
    fogNear: 55,
    fogFar: 190,
    ambient: 1.0,
    spots: 0.2,
    ground: [0.38, 0.56, 0.27],
    apron: [0.55, 0.05, 0.07],
  },
  stanford: {
    sky: [0.6, 0.79, 0.97],
    fogNear: 60,
    fogFar: 200,
    ambient: 1.02,
    spots: 0.15,
    ground: [0.36, 0.58, 0.27],
    apron: [0.55, 0.08, 0.1],
  },
  harvard: {
    sky: [0.62, 0.76, 0.92],
    fogNear: 60,
    fogFar: 200,
    ambient: 1,
    spots: 0.15,
    ground: [0.34, 0.54, 0.26],
    apron: [0.6, 0.06, 0.12],
  },
  mit: {
    sky: [0.6, 0.76, 0.94],
    fogNear: 60,
    fogFar: 200,
    ambient: 1,
    spots: 0.15,
    ground: [0.36, 0.58, 0.28],
    apron: [0.5, 0.52, 0.56],
  },
  michigan: {
    sky: [0.6, 0.76, 0.95],
    fogNear: 60,
    fogFar: 200,
    ambient: 1,
    spots: 0.15,
    ground: [0.34, 0.56, 0.26],
    apron: [0.02, 0.16, 0.32],
  },
  texas: {
    sky: [0.56, 0.76, 0.98],
    fogNear: 60,
    fogFar: 200,
    ambient: 1.04,
    spots: 0.15,
    ground: [0.4, 0.56, 0.26],
    apron: [0.75, 0.34, 0.05],
  },
  notredame: {
    sky: [0.6, 0.78, 0.96],
    fogNear: 60,
    fogFar: 200,
    ambient: 1.02,
    spots: 0.15,
    ground: [0.34, 0.56, 0.26],
    apron: [0.05, 0.12, 0.3],
  },
  iceland: {
    sky: [0.7, 0.75, 0.8],
    fogNear: 35,
    fogFar: 190,
    ambient: 1.05,
    spots: 0.15,
    ground: [0.16, 0.16, 0.17],
    apron: [0.18, 0.26, 0.32],
  },
  alps: {
    sky: [0.5, 0.72, 0.98],
    fogNear: 70,
    fogFar: 210,
    ambient: 1.02,
    spots: 0.15,
    ground: [0.38, 0.6, 0.26],
    apron: [0.6, 0.1, 0.12],
  },
  hawaii: {
    sky: [0.5, 0.78, 0.98],
    fogNear: 60,
    fogFar: 210,
    ambient: 1.02,
    spots: 0.15,
    ground: [0.92, 0.84, 0.64],
    apron: [0.1, 0.5, 0.56],
  },
  sahara: {
    sky: [0.95, 0.84, 0.66],
    fogNear: 50,
    fogFar: 200,
    ambient: 1.02,
    spots: 0.15,
    ground: [0.88, 0.66, 0.4],
    apron: [0.66, 0.38, 0.2],
  },
  paris: {
    sky: [0.66, 0.78, 0.92],
    fogNear: 55,
    fogFar: 205,
    ambient: 1,
    spots: 0.15,
    ground: [0.8, 0.75, 0.64],
    apron: [0.16, 0.2, 0.4],
  },
  grandcanyon: {
    sky: [0.66, 0.8, 0.95],
    fogNear: 140,
    fogFar: 218,
    ambient: 1.02,
    spots: 0.15,
    ground: null,
    apron: [0.5, 0.3, 0.2],
  },
};

let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const shade = (c: V, k: number) => c.map((v) => Math.min(1, v * k));

/** A tower with rows of lit windows on its four faces. */
function tower(
  b: Builder,
  x: number,
  base: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: V,
  lit: V[],
  every = 2.6,
  litChance = 0.75,
) {
  b.box(x, base + h / 2, z, w, h, d, color);
  // Window rows start at a slightly different height per building (from its position, so the
  // layout stays the same): neighbouring buildings' rows then never share a plane and flicker.
  const jitter = ((((x * 7.13 + z * 3.71) % 1) + 1) % 1) * 0.3;
  for (let row = base + 2; row < base + h - 1; row += every) {
    const y = row + jitter; // same rows (and random picks) as before, nudged up a little
    if (rnd() > litChance) continue;
    const c = pick(lit);
    b.glow?.(WIN);
    b.box(x, y, z, w + 0.06, every * 0.32, d * 0.86, c);
    // Slightly shorter, so the crossing band's top and bottom don't coincide with the first's.
    b.box(x, y, z, w * 0.86, every * 0.3, d + 0.06, c);
    b.glow?.(0);
  }
  b.box(x, base + h + 0.3, z, w * 0.7, 0.6, d * 0.7, shade(color, 0.8));
}

/** Simple round tree: trunk and two or three leaf clumps. */
function tree(b: Builder, x: number, z: number, s: number, leaf: V, y = 0) {
  b.box(x, y + 1.1 * s, z, 0.28 * s, 2.2 * s, 0.28 * s, [0.32, 0.22, 0.14]);
  b.blob(x, y + 2.7 * s, z, 1.3 * s, 1.1 * s, 1.3 * s, leaf, 0, 5, 8);
  b.blob(
    x + 0.6 * s,
    y + 3.3 * s,
    z - 0.3 * s,
    0.9 * s,
    0.8 * s,
    0.9 * s,
    shade(leaf, 1.12),
    0,
    5,
    8,
  );
  if (rnd() < 0.6)
    b.blob(
      x - 0.5 * s,
      y + 3.5 * s,
      z + 0.4 * s,
      0.8 * s,
      0.7 * s,
      0.8 * s,
      shade(leaf, 0.9),
      0,
      5,
      8,
    );
}

const BLOSSOM = [
  [1, 0.78, 0.86],
  [0.98, 0.68, 0.8],
  [1, 0.86, 0.92],
  [0.95, 0.6, 0.74],
];
/** Cherry-blossom (sakura) tree: dark crooked trunk, spreading branches, clouds of pink. */
function sakura(b: Builder, x: number, z: number, s: number) {
  const bark = [0.24, 0.16, 0.14];
  b.box(x, 0.9 * s, z, 0.32 * s, 1.8 * s, 0.32 * s, bark, 0, 0.06);
  const n = 4 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6,
      len = (1.3 + rnd() * 0.6) * s;
    const ex = x + Math.cos(a) * len * 0.8,
      ez = z + Math.sin(a) * len * 0.8,
      ey = (1.8 + 0.9 + rnd() * 0.5) * s;
    // branch from the top of the trunk out to the blossom cloud
    const mx = (x + ex) / 2,
      mz = (z + ez) / 2,
      my = (1.7 * s + ey) / 2;
    const horiz = Math.hypot(ex - x, ez - z),
      tilt = Math.atan2(horiz, ey - 1.7 * s);
    b.box(
      mx,
      my,
      mz,
      0.13 * s,
      Math.hypot(horiz, ey - 1.7 * s),
      0.13 * s,
      bark,
      0,
      tilt,
      -a + Math.PI / 2,
    );
    b.blob(
      ex,
      ey,
      ez,
      (1 + rnd() * 0.4) * s,
      (0.7 + rnd() * 0.3) * s,
      (1 + rnd() * 0.4) * s,
      pick(BLOSSOM),
      0,
      5,
      9,
    );
  }
  b.blob(
    x,
    (3 + rnd() * 0.4) * s,
    z,
    1.3 * s,
    0.9 * s,
    1.3 * s,
    pick(BLOSSOM),
    0,
    5,
    9,
  );
  // fallen petals on the ground under it
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2,
      r = rnd() * 2.6 * s;
    b.box(
      x + Math.cos(a) * r,
      0.012,
      z + Math.sin(a) * r,
      0.12,
      0.01,
      0.08,
      pick(BLOSSOM),
      0,
      0,
      a,
    );
  }
}
/** Red torii gate. */
function torii(b: Builder, x: number, z: number, w: number, h: number, ry = 0) {
  const red = [0.86, 0.2, 0.14],
    black = [0.08, 0.06, 0.07];
  const cos = Math.cos(ry),
    sin = Math.sin(ry);
  for (const sd of [-1, 1]) {
    const px = x + sd * w * 0.38 * cos,
      pz = z - sd * w * 0.38 * sin;
    b.box(px, h / 2, pz, 0.5, h, 0.5, red, 0, 0, ry);
    b.box(px, 0.25, pz, 0.7, 0.5, 0.7, black, 0, 0, ry);
  }
  b.box(x, h * 0.78, z, w * 0.92, 0.4, 0.35, red, 0, 0, ry);
  b.box(x, h + 0.1, z, w * 1.12, 0.45, 0.6, red, 0, 0, ry);
  b.box(x, h + 0.45, z, w * 1.22, 0.3, 0.75, black, 0, 0, ry);
  for (const sd of [-1, 1])
    b.box(
      x + sd * w * 0.62 * cos,
      h + 0.6,
      z - sd * w * 0.62 * sin,
      0.8,
      0.3,
      0.75,
      black,
      0,
      sd * 0.25,
      ry,
    );
  b.box(x, h * 0.9, z, 0.5, h * 0.22, 0.4, red, 0, 0, ry);
}
/** Five-tier pagoda. */
function pagoda(b: Builder, x: number, z: number, s: number) {
  const wall = [0.82, 0.3, 0.2],
    roof = [0.14, 0.12, 0.14];
  b.box(x, 0.5 * s, z, 7 * s, 1 * s, 7 * s, [0.55, 0.52, 0.5]);
  let y = 1 * s;
  for (let i = 0; i < 5; i++) {
    const w = (5 - i * 0.7) * s,
      h = (2.6 - i * 0.2) * s;
    b.box(x, y + h / 2, z, w, h, w, wall);
    b.box(x, y + h + 0.15 * s, z, w + 2.4 * s, 0.35 * s, w + 2.4 * s, roof);
    b.box(x, y + h + 0.5 * s, z, w + 1.2 * s, 0.4 * s, w + 1.2 * s, roof);
    y += h + 0.7 * s;
  }
  b.box(x, y + 2.5 * s, z, 0.25 * s, 5 * s, 0.25 * s, [0.75, 0.6, 0.3]);
}

/** Rooftop deck the court sits on, with a railing and the building below it. */
function rooftop(b: Builder, deck: V, facade: V, lit: V[], drop = 42) {
  const W = 24,
    D = 34;
  b.box(0, -0.2, 0, W, 0.36, D, deck);
  // building below the roof
  b.box(0, -drop / 2 - 0.4, 0, W - 0.6, drop, D - 0.6, facade);
  b.glow?.(WIN);
  for (let y = -3; y > -drop; y -= 3) {
    b.box(0, y, 0, W - 0.5, 1.1, D - 1.4, shade(pick(lit), 0.8));
    b.box(0, y, 0, W - 1.4, 1.1, D - 0.5, shade(pick(lit), 0.8));
  }
  b.glow?.(0);
  // parapet + railing
  for (const s of [-1, 1]) {
    b.box((s * W) / 2, 0.25, 0, 0.3, 0.5, D, shade(deck, 0.8));
    b.box(0, 0.25, (s * D) / 2, W, 0.5, 0.3, shade(deck, 0.8));
    b.box((s * W) / 2, 1.15, 0, 0.08, 0.06, D, [0.85, 0.87, 0.9]);
    b.box(0, 1.15, (s * D) / 2, W, 0.06, 0.08, [0.85, 0.87, 0.9]);
  }
  for (let z = -D / 2; z <= D / 2; z += 2)
    for (const s of [-1, 1])
      b.box((s * W) / 2, 0.8, z, 0.06, 0.7, 0.06, [0.75, 0.77, 0.8]);
  for (let x = -W / 2; x <= W / 2; x += 2)
    for (const s of [-1, 1])
      b.box(x, 0.8, (s * D) / 2, 0.06, 0.7, 0.06, [0.75, 0.77, 0.8]);
}

/** Lots of buildings around a centre, kept out of a clear rectangle. */
function city(
  b: Builder,
  opts: {
    ground: number;
    clearX: number;
    clearZ: number;
    reach: number;
    minH: number;
    maxH: number;
    colors: V[];
    lit: V[];
    count: number;
    skip?: (x: number, z: number) => boolean;
  },
) {
  for (let i = 0; i < opts.count; i++) {
    const x = (rnd() * 2 - 1) * opts.reach,
      z = (rnd() * 2 - 1) * opts.reach;
    if (Math.abs(x) < opts.clearX && Math.abs(z) < opts.clearZ) continue;
    if (opts.skip?.(x, z)) continue;
    const w = 4 + rnd() * 6,
      d = 4 + rnd() * 6,
      h = opts.minH + rnd() ** 1.6 * (opts.maxH - opts.minH);
    tower(b, x, opts.ground, z, w, h, d, pick(opts.colors), opts.lit);
  }
}

function tokyo(b: Builder) {
  seed = 11;
  const lit = [
    [1, 0.85, 0.55],
    [0.55, 0.9, 1],
    [0.95, 0.95, 0.9],
  ];
  const neon = [
    [1, 0.25, 0.6],
    [0.2, 0.95, 1],
    [1, 0.85, 0.2],
    [0.6, 0.35, 1],
  ];
  // street-level buildings close around the plaza, taller towers behind
  for (const s of [-1, 1]) {
    for (let z = -26; z < 26; z += 7 + rnd() * 3) {
      const h = 8 + rnd() * 22;
      tower(b, s * (14 + rnd() * 3), 0, z, 6, h, 6, [0.09, 0.08, 0.14], lit);
      // vertical neon sign panels facing the court (shapes only, no lettering)
      const c = pick(neon);
      b.glow?.(1.5);
      b.box(s * 10.8, 4 + rnd() * 3, z, 0.25, 3 + rnd() * 3, 1.1, c);
      b.glow?.(0);
      b.box(s * 10.95, 4.2, z, 0.1, 0.4, 1.5, shade(c, 0.6));
    }
  }
  for (const s of [-1, 1])
    for (let x = -26; x < 26; x += 7 + rnd() * 3) {
      const h = 8 + rnd() * 22;
      tower(b, x, 0, s * (19 + rnd() * 3), 6, h, 6, [0.09, 0.08, 0.14], lit);
      const c = pick(neon);
      b.glow?.(1.5);
      b.box(x, 5 + rnd() * 3, s * 15.8, 2.4, 1 + rnd(), 0.25, c);
      b.glow?.(0);
    }
  city(b, {
    ground: 0,
    clearX: 22,
    clearZ: 26,
    reach: 85,
    minH: 20,
    maxH: 70,
    colors: [
      [0.1, 0.1, 0.16],
      [0.13, 0.12, 0.2],
      [0.08, 0.09, 0.13],
    ],
    lit,
    count: 110,
  });
  // red-and-white lattice tower on the skyline (a generic broadcast tower)
  const tx = 30,
    tz = -70;
  for (let i = 0; i < 14; i++) {
    const y = i * 4.4,
      w = 12 - i * 0.78,
      c = i % 2 ? [0.96, 0.95, 0.92] : [0.92, 0.28, 0.12];
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      b.box(tx + (sx * w) / 2, y + 2.2, tz + (sz * w) / 2, 0.5, 4.5, 0.5, c);
    b.box(tx, y + 4.3, tz, w + 0.5, 0.3, 0.4, c);
    b.box(tx, y + 4.3, tz, 0.4, 0.3, w + 0.5, c);
    if (i === 6)
      b.box(tx, y + 4.6, tz, w + 1.5, 1.4, w + 1.5, [0.9, 0.9, 0.85]);
  }
  b.box(tx, 66, tz, 0.5, 10, 0.5, [0.92, 0.28, 0.12]);
  // a sakura avenue: two rows of cherry trees down each side of the court
  for (const s of [-1, 1]) {
    for (let z = -14; z <= 14; z += 3.5)
      sakura(b, s * (8.4 + rnd() * 0.4), z, 0.85 + rnd() * 0.2);
    for (let z = -12.5; z <= 14; z += 4.5)
      sakura(b, s * 11.2, z, 1 + rnd() * 0.2);
  }
  // more sakura behind each baseline, kept clear of the camera's view down the middle
  for (const zs of [-1, 1])
    for (const x of [-9.5, -7.5, 7.5, 9.5])
      sakura(b, x, zs * (16 + rnd()), 1.05);
  // petals drifted across the plaza
  for (let i = 0; i < 260; i++) {
    const x = (rnd() * 2 - 1) * 12,
      z = (rnd() * 2 - 1) * 17;
    if (Math.abs(x) < 3.4 && Math.abs(z) < 7) continue;
    b.box(x, 0.008, z, 0.1, 0.01, 0.07, pick(BLOSSOM), 0, 0, rnd() * 3);
  }
  // torii gates framing each end, and a pagoda on the skyline
  torii(b, 0, -19, 9, 6.5);
  torii(b, 0, 19.5, 9, 6.5);
  pagoda(b, -32, -48, 1.6);
  for (const s of [-1, 1]) {
    b.box(s * 7.6, 4.2, 0, 0.03, 0.03, 26, [0.15, 0.15, 0.2]);
    for (let z = -12; z <= 12; z += 2)
      b.blob(s * 7.6, 3.9, z, 0.22, 0.3, 0.22, [0.95, 0.25, 0.2], 0, 4, 8);
    for (const z of [-13, 13])
      b.box(s * 7.6, 2.1, z, 0.12, 4.2, 0.12, [0.15, 0.15, 0.2]);
  }
  // pixel lettering on the plaza floor, the game's own name
  b.text("SPORTLE", -9.4, 0.004, 5.4, 0.32, 0, -1, [0.3, 0.22, 0.45]);
}

function manila(b: Builder) {
  seed = 23;
  const lit = [
    [1, 0.82, 0.55],
    [0.98, 0.7, 0.5],
    [0.9, 0.86, 0.75],
  ];
  rooftop(b, [0.55, 0.52, 0.5], [0.62, 0.55, 0.5], lit);
  // city far below, a few towers rising past the roof, bay on the far side
  b.box(0, -43, 0, 320, 1, 320, [0.36, 0.33, 0.32]);
  b.box(0, -42.4, -120, 319.6, 0.4, 150, [0.36, 0.42, 0.6]);
  city(b, {
    ground: -42.5,
    clearX: 16,
    clearZ: 20,
    reach: 90,
    minH: 10,
    maxH: 75,
    colors: [
      [0.7, 0.6, 0.55],
      [0.55, 0.6, 0.66],
      [0.75, 0.7, 0.62],
      [0.45, 0.52, 0.6],
    ],
    lit,
    count: 120,
    skip: (_x, z) => z < -48,
  });
  // setting sun over the bay
  b.glow?.(2.2);
  b.blob(-15, 8, -118, 11, 11, 2, [1, 0.88, 0.55], 0, 8, 16);
  b.glow?.(0);
  b.box(-15, -42, -80, 6, 0.1, 70, [1, 0.75, 0.45]);
  // rooftop things: water tank, AC units, potted palms, string lights
  for (const [x, z] of [
    [-9, -14],
    [-7, -14],
    [-9, -12],
    [-7, -12],
  ])
    b.box(x, 1.2, z, 0.18, 2.4, 0.18, [0.3, 0.3, 0.32]);
  b.blob(-8, 3.4, -13, 1.4, 1.1, 1.4, [0.56, 0.6, 0.64], 1.2, 6, 12);
  for (const x of [8, 10])
    b.box(x, 0.6, -14.5, 1.6, 1.2, 1.4, [0.7, 0.7, 0.72]);
  for (const [x, z] of [
    [-10.5, 6],
    [10.5, 6],
    [-10.5, -4],
    [10.5, -4],
    [-10.5, 14],
    [10.5, 14],
  ]) {
    b.box(x, 0.4, z, 0.9, 0.8, 0.9, [0.55, 0.32, 0.22]);
    for (let i = 0; i < 5; i++)
      b.box(x + i * 0.07, 1.2 + i * 0.6, z, 0.2, 0.62, 0.2, [0.45, 0.33, 0.2]);
    for (let a = 0; a < 6; a++)
      b.box(
        x + 0.35 + Math.cos(a) * 0.8,
        4.1,
        z + Math.sin(a) * 0.8,
        1.7,
        0.06,
        0.4,
        [0.2, 0.55, 0.25],
        0,
        -0.35,
        -a,
      );
  }
  for (const s of [-1, 1])
    for (let z = -16; z <= 16; z += 1.2)
      b.blob(s * 11.8, 1.5, z, 0.07, 0.07, 0.07, [1, 0.9, 0.5], 0, 3, 5);
}

function sf(b: Builder) {
  seed = 37;
  const lit = [
    [0.92, 0.92, 0.88],
    [0.75, 0.82, 0.9],
  ];
  rooftop(b, [0.46, 0.47, 0.5], [0.78, 0.76, 0.72], lit);
  b.box(0, -43, 40, 320, 1, 240, [0.42, 0.44, 0.42]);
  b.box(0, -42.6, -120, 319.6, 0.4, 160, [0.3, 0.42, 0.52]);
  city(b, {
    ground: -42.5,
    clearX: 16,
    clearZ: 20,
    reach: 80,
    minH: 8,
    maxH: 60,
    colors: [
      [0.82, 0.8, 0.76],
      [0.6, 0.64, 0.7],
      [0.7, 0.72, 0.74],
    ],
    lit,
    count: 90,
    skip: (_x, z) => z < -45,
  });
  // tall pointed tower on the skyline (stepped pyramid)
  for (let i = 0; i < 16; i++) {
    const w = 9 - i * 0.55;
    b.box(30, -42.5 + i * 5.5 + 2.75, -28, w, 5.6, w, [0.92, 0.92, 0.9]);
  }
  b.box(30, 47, -28, 0.4, 8, 0.4, [0.9, 0.9, 0.88]);
  // red suspension bridge across the water
  const orange = [0.78, 0.24, 0.14],
    bz = -95,
    deck = -30;
  b.box(-10, deck, bz, 170, 1.2, 4, orange);
  const towers = [-45, 25];
  for (const tx of towers) {
    for (const s of [-1, 1])
      b.box(tx, deck + 5, bz + s * 1.8, 1.4, 70, 1.2, orange);
    for (const y of [deck + 10, deck + 22, deck + 33])
      b.box(tx, y, bz, 1.4, 1.4, 4.4, orange);
  }
  const top = deck + 39;
  const cable = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    sag: number,
  ) => {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const t0 = i / n,
        t1 = (i + 1) / n;
      const f = (t: number) => y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
      const xa = x0 + (x1 - x0) * t0,
        xb = x0 + (x1 - x0) * t1;
      const ya = f(t0),
        yb = f(t1);
      const len = Math.hypot(xb - xa, yb - ya);
      for (const s of [-1, 1])
        b.box(
          (xa + xb) / 2,
          (ya + yb) / 2,
          bz + s * 1.8,
          len + 0.1,
          0.35,
          0.35,
          orange,
          0,
          Math.atan2(yb - ya, xb - xa),
        );
      if (i % 2 === 0)
        for (const s of [-1, 1])
          b.box(
            xa,
            (ya + deck) / 2,
            bz + s * 1.8,
            0.12,
            ya - deck,
            0.12,
            orange,
          );
    }
  };
  cable(towers[0], towers[1], top, top, 30);
  cable(-95, towers[0], deck + 2, top, 6);
  cable(towers[1], 75, top, deck + 2, 6);
  // hills with rows of colourful houses
  const pastel = [
    [0.95, 0.8, 0.7],
    [0.75, 0.85, 0.95],
    [0.95, 0.92, 0.7],
    [0.8, 0.92, 0.8],
    [0.95, 0.75, 0.8],
  ];
  for (const [hx, hz, r] of [
    [-55, 30, 30],
    [60, 25, 26],
    [10, 75, 32],
  ]) {
    b.blob(hx, -43, hz, r, 18, r, [0.45, 0.5, 0.36], 0, 6, 12);
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2,
        rr = rnd() * r * 0.75;
      const x = hx + Math.cos(a) * rr,
        z = hz + Math.sin(a) * rr;
      const y = -43 + 18 * Math.sqrt(Math.max(0, 1 - (rr / r) ** 2));
      b.box(x, y + 1, z, 2.2, 2.4, 2.6, pick(pastel));
    }
  }
  // rooftop bits: vents and planters
  for (const [x, z] of [
    [-9, -14],
    [9, -14],
    [-9, 14],
  ])
    b.box(x, 0.6, z, 1.6, 1.2, 1.6, [0.62, 0.63, 0.66]);
  for (const s of [-1, 1])
    for (let z = -10; z <= 10; z += 5) {
      b.box(s * 10.6, 0.35, z, 1, 0.7, 2.4, [0.4, 0.3, 0.22]);
      b.blob(s * 10.6, 0.95, z, 0.5, 0.45, 1.1, [0.28, 0.5, 0.3], 0, 4, 8);
    }
}

function centralpark(b: Builder) {
  seed = 53;
  // the ground plane under the whole park, paths, a pond
  b.box(0, -0.1, 0, 220, 0.1, 220, [0.3, 0.55, 0.26]);
  b.box(0, -0.03, -12.5, 70, 0.04, 2.4, [0.82, 0.76, 0.62]);
  b.box(12.5, -0.03, 0, 2.4, 0.04, 70, [0.82, 0.76, 0.62]);
  b.blob(-30, -0.02, -32, 14, 0.04, 9, [0.33, 0.55, 0.72], 0, 2, 20);
  // chain-link fence around the court
  const fx = 8.2,
    fz = 11;
  for (let x = -fx; x <= fx; x += 2.05)
    for (const s of [-1, 1])
      b.box(x, 1.5, s * fz, 0.08, 3, 0.08, [0.18, 0.3, 0.2]);
  for (let z = -fz; z <= fz; z += 2.2)
    for (const s of [-1, 1])
      b.box(s * fx, 1.5, z, 0.08, 3, 0.08, [0.18, 0.3, 0.2]);
  for (const y of [0.05, 1.5, 3])
    for (const s of [-1, 1]) {
      b.box(0, y, s * fz, fx * 2, 0.05, 0.05, [0.22, 0.32, 0.24]);
      b.box(s * fx, y, 0, 0.05, 0.05, fz * 2, [0.22, 0.32, 0.24]);
    }
  // benches and lamp posts along the paths
  for (let x = -30; x <= 30; x += 10) {
    if (Math.abs(x) < 9) continue;
    b.box(x, 0.45, -14.2, 1.8, 0.1, 0.5, [0.45, 0.3, 0.18]);
    b.box(x, 0.75, -14.45, 1.8, 0.45, 0.08, [0.45, 0.3, 0.18]);
    b.box(x + 4, 1.9, -14, 0.1, 3.8, 0.1, [0.1, 0.12, 0.12]);
    b.blob(x + 4, 3.9, -14, 0.25, 0.25, 0.25, [0.98, 0.96, 0.85], 0, 4, 8);
  }
  // rocky outcrop
  for (const [x, z, r] of [
    [18, -22, 3],
    [21, -20, 2.2],
    [16, -19, 1.8],
  ])
    b.blob(x, 0, z, r, r * 0.6, r * 0.8, [0.5, 0.5, 0.52], 0, 4, 8);
  // lots of trees, kept off the court and paths
  const greens = [
    [0.22, 0.5, 0.2],
    [0.28, 0.58, 0.24],
    [0.18, 0.42, 0.18],
    [0.36, 0.6, 0.22],
  ];
  for (let i = 0; i < 190; i++) {
    const x = (rnd() * 2 - 1) * 40,
      z = (rnd() * 2 - 1) * 40;
    if (Math.abs(x) < 11 && Math.abs(z) < 14) continue;
    if (Math.abs(z + 12.5) < 2.5 || Math.abs(x - 12.5) < 2.5) continue;
    if (Math.hypot((x + 30) / 15, (z + 32) / 10) < 1) continue;
    tree(b, x, z, 0.9 + rnd() * 0.8, pick(greens));
  }
  // the skyline around the park's edges
  const lit = [
    [0.95, 0.92, 0.8],
    [0.7, 0.8, 0.9],
  ];
  const colors = [
    [0.78, 0.72, 0.62],
    [0.6, 0.62, 0.66],
    [0.5, 0.6, 0.72],
    [0.72, 0.66, 0.58],
  ];
  // A solid wall of buildings along all four edges of the park, then taller towers behind.
  const edge = (out: number, along: number, side: number) =>
    side === 0
      ? [along, -out]
      : side === 1
        ? [along, out]
        : side === 2
          ? [-out, along]
          : [out, along];
  for (let side = 0; side < 4; side++)
    for (let along = -50; along <= 50; along += 6 + rnd() * 2) {
      const [x, z] = edge(48 + rnd() * 3, along, side);
      const w = 5 + rnd() * 2,
        h = 28 + rnd() ** 1.4 * 50;
      tower(b, x, 0, z, w, h, w, pick(colors), lit, 3, 0.55);
      // rooftop water tank on the shorter ones
      if (h < 45 && rnd() < 0.6) {
        for (const [dx, dz] of [
          [-0.5, -0.5],
          [0.5, -0.5],
          [-0.5, 0.5],
          [0.5, 0.5],
        ])
          b.box(x + dx, h + 1.2, z + dz, 0.12, 1.2, 0.12, [0.25, 0.2, 0.18]);
        b.blob(x, h + 2.4, z, 0.9, 0.8, 0.9, [0.5, 0.36, 0.26], 0.6, 4, 10);
      }
    }
  for (let i = 0; i < 160; i++) {
    const side = Math.floor(rnd() * 4),
      along = (rnd() * 2 - 1) * 95,
      out = 58 + rnd() * 30;
    const [x, z] = edge(out, along, side);
    tower(
      b,
      x,
      0,
      z,
      6 + rnd() * 7,
      40 + rnd() ** 1.3 * 90,
      6 + rnd() * 7,
      pick(colors),
      lit,
      3,
      0.5,
    );
  }
  // a few very tall, thin glass towers ("billionaires' row") on the south side
  for (let i = 0; i < 6; i++) {
    const x = -40 + i * 15 + rnd() * 4,
      z = 62 + rnd() * 6;
    b.box(x, 75, z, 5, 150, 5, [0.55, 0.66, 0.78]);
    for (let y = 6; y < 148; y += 6)
      b.box(x, y, z, 5.1, 0.25, 5.1, [0.8, 0.85, 0.9]);
  }
  // a stepped art-deco tower with a spire
  const dx = -18,
    dz = -78;
  for (const [w, h0, h1] of [
    [12, 0, 40],
    [9, 40, 62],
    [6, 62, 78],
    [3.5, 78, 86],
  ])
    b.box(dx, (h0 + h1) / 2, dz, w, h1 - h0, w, [0.78, 0.74, 0.66]);
  b.box(dx, 94, dz, 0.6, 16, 0.6, [0.8, 0.8, 0.82]);
}

/** Palm tree: slightly leaning segmented trunk and a crown of drooping fronds. */
function palm(b: Builder, x: number, z: number, s: number) {
  const lean = (rnd() - 0.5) * 0.25,
    h = (7 + rnd() * 3) * s;
  for (let i = 0; i < 8; i++) {
    const y = (i + 0.5) * (h / 8);
    b.box(
      x + lean * y,
      y,
      z,
      // Alternate thickness: overlapping segments never share a face (no flicker).
      (i % 2 ? 0.4 : 0.44) * s,
      h / 8 + 0.05,
      (i % 2 ? 0.4 : 0.44) * s,
      i % 2 ? [0.5, 0.38, 0.26] : [0.44, 0.33, 0.22],
    );
  }
  const tx = x + lean * h;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.box(
      tx + Math.cos(a) * 1.3 * s,
      h - 0.2 * s,
      z + Math.sin(a) * 1.3 * s,
      2.8 * s,
      0.08,
      0.55 * s,
      [0.2, 0.5, 0.2],
      0,
      0.45,
      -a,
    );
  }
  b.blob(tx, h, z, 0.5 * s, 0.4 * s, 0.5 * s, [0.3, 0.42, 0.18], 0, 4, 8);
}
/** Campus quad ground: lawn, crossing paths and a low hedge around the court. */
function quad(b: Builder, lawn: V, path: V) {
  b.box(0, -0.1, 0, 240, 0.1, 240, lawn);
  b.box(0, -0.03, -14, 80, 0.04, 3, path);
  b.box(0, -0.03, 14, 80, 0.04, 3, path);
  b.box(-12, -0.03, 0, 3, 0.04, 80, path);
  b.box(12, -0.03, 0, 3, 0.04, 80, path);
  for (const sd of [-1, 1]) {
    b.box(sd * 8.6, 0.45, 0, 0.8, 0.9, 20, shade(lawn, 0.7));
    b.box(0, 0.45, sd * 11.2, 16, 0.9, 0.8, shade(lawn, 0.7));
  }
}
/** Classical hall: base, a row of columns, an entablature and a low pitched roof. */
function hall(
  b: Builder,
  x: number,
  z: number,
  w: number,
  h: number,
  d: number,
  wall: V,
  roof: V,
  ry = 0,
) {
  b.box(x, h / 2, z, w, h, d, wall, 0, 0, ry);
  const cos = Math.cos(ry),
    sin = Math.sin(ry),
    face = d / 2 + 0.9;
  // Columns go on whichever long face looks toward the court (the origin).
  const toward =
    Math.hypot(x - sin * face, z - cos * face) <
    Math.hypot(x + sin * face, z + cos * face)
      ? 1
      : -1;
  const fx = -sin * face * toward,
    fz = -cos * face * toward;
  for (let i = 0; i < 8; i++) {
    const u = (i / 7 - 0.5) * w * 0.8;
    b.box(
      x + cos * u + fx,
      h * 0.42,
      z - sin * u + fz,
      0.7,
      h * 0.84,
      0.7,
      shade(wall, 1.08),
      0,
      0,
      ry,
    );
  }
  b.box(
    x + fx,
    h * 0.86,
    z + fz,
    w * 0.88,
    h * 0.1,
    1.6,
    shade(wall, 0.95),
    0,
    0,
    ry,
  );
  b.box(x, h + 0.5, z, w + 0.6, 1, d + 0.6, roof, 0, 0, ry);
  b.box(x, h + 1.4, z, w * 0.8, 0.9, d * 0.5, shade(roof, 0.9), 0, 0, ry);
}
/** Brick building with a row of arched windows/arcade along its front. */
function brick(
  b: Builder,
  x: number,
  z: number,
  w: number,
  h: number,
  d: number,
  wall: V,
  trim: V,
  ry = 0,
) {
  b.box(x, h / 2, z, w, h, d, wall, 0, 0, ry);
  const cos = Math.cos(ry),
    sin = Math.sin(ry),
    n = Math.max(3, Math.floor(w / 2.4));
  for (const fs of [-1, 1]) {
    const fx = -sin * (d / 2 + 0.05) * fs,
      fz = -cos * (d / 2 + 0.05) * fs;
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.5) / n - 0.5) * w;
      for (const y of [1.6, h * 0.62]) {
        b.box(
          x + cos * u + fx,
          y,
          z - sin * u + fz,
          1.1,
          1.9,
          0.12,
          [0.16, 0.12, 0.12],
          0,
          0,
          ry,
        );
        b.blob(
          x + cos * u + fx,
          y + 0.95,
          z - sin * u + fz,
          0.55,
          0.45,
          0.07,
          [0.16, 0.12, 0.12],
          0,
          3,
          8,
        );
        b.box(
          x + cos * u + fx,
          y - 1.05,
          z - sin * u + fz,
          1.3,
          0.14,
          0.2,
          trim,
          0,
          0,
          ry,
        );
      }
    }
  }
  b.box(x, h + 0.2, z, w + 0.4, 0.4, d + 0.4, trim, 0, 0, ry);
  b.box(x, h + 1.1, z, w + 0.2, 1.4, d * 0.6, [0.62, 0.28, 0.2], 0, 0, ry);
}
/** Plain coloured pennant banner on a lamp post (school colours, no lettering). */
function banner(b: Builder, x: number, z: number, c1: V, c2: V) {
  b.box(x, 2.6, z, 0.12, 5.2, 0.12, [0.15, 0.16, 0.18]);
  b.box(x + 0.45, 3.9, z, 0.8, 1.6, 0.05, c1);
  b.box(x + 0.45, 3.0, z, 0.8, 0.25, 0.06, c2);
  b.blob(x, 5.3, z, 0.25, 0.25, 0.25, [0.98, 0.96, 0.85], 0, 4, 8);
}
/** Classic rooftop water tank on legs. */
function waterTank(b: Builder, x: number, y: number, z: number) {
  const wood = [0.36, 0.25, 0.18];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    b.box(
      x + sx * 1.1,
      y + 1.2,
      z + sz * 1.1,
      0.2,
      2.4,
      0.2,
      [0.15, 0.15, 0.16],
    );
  b.blob(x, y + 4, z, 1.7, 1.6, 1.7, wood, 1.4, 4, 10);
  b.blob(x, y + 6.2, z, 1.8, 0.9, 1.8, [0.2, 0.18, 0.18], 0, 4, 10);
}

function nyc(b: Builder) {
  seed = 71;
  const lit = [
    [1, 0.86, 0.55],
    [0.95, 0.95, 0.85],
    [0.6, 0.8, 1],
    [1, 0.7, 0.4],
  ];
  const facade = [0.07, 0.07, 0.1];
  rooftop(b, [0.2, 0.2, 0.23], facade, lit, 120);
  // string lights over the deck and a few planters
  for (const sd of [-1, 1]) {
    for (let z = -15; z <= 15; z += 1.5)
      b.blob(
        sd * 10.5,
        3.2 + Math.sin(z * 0.6) * 0.15,
        z,
        0.09,
        0.09,
        0.09,
        [1, 0.88, 0.55],
        0,
        3,
        6,
      );
    b.box(sd * 10.5, 1.6, -15.5, 0.1, 3.2, 0.1, [0.12, 0.12, 0.14]);
    b.box(sd * 10.5, 1.6, 15.5, 0.1, 3.2, 0.1, [0.12, 0.12, 0.14]);
    for (const z of [-13, 13]) {
      b.box(sd * 10, 0.4, z, 1.6, 0.8, 1.6, [0.3, 0.22, 0.16]);
      b.blob(sd * 10, 1.2, z, 0.9, 0.7, 0.9, [0.16, 0.36, 0.18], 0, 4, 8);
    }
  }
  waterTank(b, -9, 0, 18.5);
  // the street grid far below and the skyline all around (the court is ~120 m up)
  b.box(0, -120.5, 0, 500, 0.5, 500, [0.05, 0.05, 0.07]);
  for (let i = -6; i <= 6; i++) {
    b.box(i * 32, -120, 0, 1.2, 0.2, 500, [0.95, 0.75, 0.4]);
    b.box(0, -120, i * 32, 500, 0.2, 1.2, [0.95, 0.75, 0.4]);
  }
  city(b, {
    ground: -120,
    clearX: 20,
    clearZ: 26,
    reach: 150,
    minH: 70,
    maxH: 230,
    colors: [
      [0.08, 0.08, 0.12],
      [0.11, 0.1, 0.14],
      [0.06, 0.07, 0.1],
      [0.13, 0.12, 0.13],
    ],
    lit,
    count: 160,
  });
  // neighbouring rooftops close by, with their own water tanks
  for (const [x, z, h] of [
    [-30, -10, 112],
    [32, 8, 108],
    [-26, 34, 104],
    [30, -38, 116],
  ]) {
    tower(b, x, -120, z, 16, h, 16, [0.12, 0.11, 0.14], lit);
    waterTank(b, x + 3, h - 120 + 0.6, z - 2);
  }
  // a tall art-deco spire on the skyline (stepped setbacks, generic) with a red beacon
  const sx = -40,
    sz = -120;
  let y = -120;
  for (const [w, h] of [
    [30, 150],
    [22, 50],
    [15, 35],
    [10, 25],
    [6, 18],
  ]) {
    tower(b, sx, y, sz, w, h, w, [0.62, 0.6, 0.58], lit, 2.6, 0.5);
    y += h;
  }
  for (let i = 0; i < 6; i++)
    b.box(
      sx,
      y + 4 + i * 3,
      sz,
      4 - i * 0.6,
      3,
      4 - i * 0.6,
      [0.85, 0.85, 0.8],
    );
  b.box(sx, y + 30, sz, 0.5, 18, 0.5, [0.8, 0.8, 0.82]);
  b.blob(sx, y + 40, sz, 0.8, 0.8, 0.8, [1, 0.15, 0.1], 0, 4, 8);
  // a crowned tower with a lit, stepped top on the other side
  const cx = 70,
    cz = -90;
  tower(b, cx, -120, cz, 20, 190, 20, [0.18, 0.18, 0.22], lit);
  for (let i = 0; i < 7; i++)
    b.box(
      cx,
      74 + i * 3.2,
      cz,
      18 - i * 2.4,
      2.6,
      18 - i * 2.4,
      [0.95, 0.85, 0.6],
    );
  // moon
  b.blob(60, 120, -260, 10, 10, 2, [0.95, 0.95, 0.88], 0, 6, 14);
}

function berkeley(b: Builder) {
  seed = 83;
  const blue = [0.0, 0.2, 0.38],
    gold = [0.99, 0.71, 0.08],
    granite = [0.88, 0.86, 0.8];
  quad(b, [0.34, 0.58, 0.28], [0.85, 0.8, 0.68]);
  // the campus clock tower (campanile-style: tall shaft, open belfry, pyramid roof)
  const tx = 12,
    tz = -112;
  b.box(tx, 1, tz, 14, 2, 14, shade(granite, 0.9));
  b.box(tx, 27, tz, 10, 50, 10, granite);
  for (let i = 0; i < 4; i++)
    b.box(tx, 8 + i * 10, tz, 10.3, 0.4, 10.3, shade(granite, 0.92));
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    b.box(tx + sx * 4.4, 57, tz + sz * 4.4, 1.2, 10, 1.2, granite);
  b.box(tx, 55, tz, 7, 6, 7, [0.25, 0.22, 0.2]);
  b.box(tx, 62.5, tz, 11, 1.2, 11, granite);
  for (let i = 0; i < 6; i++)
    b.box(
      tx,
      64 + i * 2.2,
      tz,
      9 - i * 1.5,
      2.2,
      9 - i * 1.5,
      [0.32, 0.48, 0.42],
    );
  b.box(tx, 79, tz, 0.4, 4, 0.4, [0.75, 0.62, 0.3]);
  for (const sd of [-1, 1])
    b.blob(tx, 46, tz + sd * 5.1, 2.2, 2.2, 0.15, [0.95, 0.93, 0.85], 0, 4, 12);
  // white classical halls around the quad
  hall(b, -42, -55, 30, 14, 14, granite, [0.55, 0.4, 0.32], -0.4);
  hall(b, 40, -58, 30, 14, 14, granite, [0.55, 0.4, 0.32], 0.4);
  hall(
    b,
    -36,
    18,
    26,
    12,
    14,
    shade(granite, 0.97),
    [0.55, 0.4, 0.32],
    -Math.PI / 2,
  );
  hall(
    b,
    36,
    18,
    26,
    12,
    14,
    shade(granite, 0.97),
    [0.55, 0.4, 0.32],
    Math.PI / 2,
  );
  // blue-and-gold banners along the paths
  for (let z = -10; z <= 10; z += 5)
    for (const sd of [-1, 1]) banner(b, sd * 13.8, z, blue, gold);
  // oaks and eucalyptus, then golden hills behind
  const greens = [
    [0.22, 0.45, 0.2],
    [0.3, 0.5, 0.3],
    [0.38, 0.52, 0.36],
  ];
  for (let i = 0; i < 120; i++) {
    const x = (rnd() * 2 - 1) * 70,
      z = (rnd() * 2 - 1) * 70;
    if (Math.abs(x) < 16 && Math.abs(z) < 18) continue;
    if (Math.abs(x - tx) < 10 && Math.abs(z - tz) < 10) continue;
    if (Math.abs(z + 56) < 12 && Math.abs(Math.abs(x) - 41) < 18) continue;
    if (Math.abs(z - 18) < 10 && Math.abs(Math.abs(x) - 50) < 12) continue;
    if (z < -20 && Math.abs(x) < 14) continue;
    tree(b, x, z, 1 + rnd() * 0.9, pick(greens));
  }
  for (let i = 0; i < 9; i++)
    b.blob(
      -120 + i * 30,
      0,
      -140 - rnd() * 20,
      40 + rnd() * 20,
      25 + rnd() * 18,
      30,
      i % 2 ? [0.62, 0.6, 0.32] : [0.42, 0.52, 0.28],
      0,
      5,
      12,
    );
}

/**
 * Gabled courtyard wing in the Haas style: cream walls with brick-red bands, rows of
 * many-paned windows, a steep dark slate roof with dormers, a covered walkway on the
 * courtyard side. Runs along X (ry rotates it).
 */
function haasWing(
  b: Builder,
  x: number,
  z: number,
  len: number,
  h: number,
  depth: number,
  ry: number,
  facing: 1 | -1,
) {
  const cream = [0.9, 0.85, 0.74],
    band = [0.64, 0.3, 0.22],
    slate = [0.27, 0.32, 0.33],
    timber = [0.42, 0.3, 0.2],
    glass = [0.2, 0.24, 0.3],
    cos = Math.cos(ry),
    sin = Math.sin(ry);
  // local (u along the wing, v across it) → world
  const at = (u: number, v: number): [number, number] => [
    x + cos * u + sin * v,
    z - sin * u + cos * v,
  ];
  b.box(x, h / 2, z, len, h, depth, cream, 0, 0, ry);
  for (const y of [0.6, h * 0.48, h - 0.3])
    b.box(x, y, z, len + 0.06, 0.45, depth + 0.06, band, 0, 0, ry);
  // windows on the courtyard face: two storeys, multi-paned (dark glass, cream mullions)
  const n = Math.floor(len / 3.2);
  const face = (depth / 2 + 0.05) * facing;
  for (let i = 0; i < n; i++) {
    const u = ((i + 0.5) / n - 0.5) * len;
    for (const y of [h * 0.3, h * 0.72]) {
      const [wx, wz] = at(u, face);
      b.box(wx, y, wz, 1.5, 1.9, 0.1, glass, 0, 0, ry);
      b.box(wx, y, wz, 1.55, 0.08, 0.14, cream, 0, 0, ry);
      b.box(wx, y, wz, 0.08, 1.95, 0.14, cream, 0, 0, ry);
    }
  }
  // steep gable roof: two slate planes meeting at a ridge, plus dormers on the court side
  const pitch = 0.75,
    half = depth / 2 + 0.6,
    rise = Math.tan(pitch) * half;
  for (const sd of [-1, 1]) {
    const [rx, rz] = at(0, (sd * half) / 2);
    b.box(
      rx,
      h + rise / 2,
      rz,
      len + 1,
      0.3,
      half / Math.cos(pitch) + 0.2,
      slate,
      sd * pitch,
      0,
      ry,
    );
  }
  for (let i = 0; i < n; i += 2) {
    const u = ((i + 0.5) / n - 0.5) * len;
    const [dx, dz] = at(u, half * 0.45 * facing);
    b.box(dx, h + rise * 0.55, dz, 1.6, 1.6, 1.4, cream, 0, 0, ry);
    b.box(dx, h + rise * 0.55, dz, 1.0, 1.0, 1.46, glass, 0, 0, ry);
    for (const sd of [-1, 1])
      b.box(
        dx + cos * sd * 0.5,
        h + rise * 0.55 + 1.05,
        dz - sin * sd * 0.5,
        1.2,
        0.18,
        1.6,
        slate,
        0,
        sd * -0.6,
        ry,
      );
  }
  // covered timber walkway along the courtyard side
  const wv = (depth / 2 + 1.6) * facing;
  for (let i = 0; i <= n; i++) {
    const u = (i / n - 0.5) * len;
    const [px, pz] = at(u, wv);
    b.box(px, 1.5, pz, 0.3, 3, 0.3, timber, 0, 0, ry);
  }
  const [cx, cz] = at(0, wv - 0.6 * facing);
  b.box(cx, 3.1, cz, len, 0.25, 3.4, slate, facing * 0.18, 0, ry);
}

/** UC Berkeley Haas School of Business: a hillside courtyard ringed by gabled wings. */
function haas(b: Builder) {
  seed = 97;
  const blue = [0.0, 0.2, 0.38],
    gold = [0.99, 0.71, 0.08],
    pavers = [0.74, 0.64, 0.54];
  // hillside lawn, the paved courtyard with a paver grid, and a few planters
  b.box(0, -0.1, 0, 260, 0.1, 260, [0.36, 0.54, 0.28]);
  b.box(0, -0.05, 0, 34, 0.06, 42, pavers);
  for (let x = -16; x <= 16; x += 2)
    b.box(x, -0.02, 0, 0.05, 0.02, 42, shade(pavers, 0.9));
  for (let z = -20; z <= 20; z += 2)
    b.box(0, -0.02, z, 34, 0.02, 0.05, shade(pavers, 0.9));
  // the U of wings around the courtyard (north wing across the far end, east and west sides)
  haasWing(b, 0, -27, 40, 11, 9, 0, 1);
  haasWing(b, -19, -2, 34, 10, 9, Math.PI / 2, 1);
  haasWing(b, 19, -2, 34, 10, 9, -Math.PI / 2, 1);
  // a square tower with a copper pyramid roof at the north-west corner
  const tx = -17,
    tz = -24;
  b.box(tx, 9, tz, 5.5, 18, 5.5, [0.9, 0.85, 0.74]);
  b.box(tx, 17.2, tz, 5.7, 0.5, 5.7, [0.64, 0.3, 0.22]);
  for (let i = 0; i < 5; i++)
    b.box(
      tx,
      18.5 + i * 0.9,
      tz,
      6.2 - i * 1.3,
      0.9,
      6.2 - i * 1.3,
      [0.36, 0.55, 0.48],
    );
  b.blob(tx, 13, tz + 2.8, 1.1, 1.1, 0.12, [0.96, 0.94, 0.86], 0, 4, 12);
  // terraced steps up the hill behind the north wing
  for (let i = 0; i < 6; i++)
    b.box(
      0,
      0.4 + i * 0.8,
      -36 - i * 2.2,
      46 - i * 2,
      0.8 + i * 1.6,
      2.4,
      i % 2 ? [0.62, 0.6, 0.56] : [0.4, 0.56, 0.3],
    );
  // Chou Hall-style modern glass block beyond the south-east corner
  b.box(27, 9, 26, 16, 18, 12, [0.86, 0.88, 0.88]);
  for (let y = 2.5; y < 18; y += 3)
    b.box(27, y, 26, 16.1, 2.1, 12.1, [0.48, 0.66, 0.78]);
  for (let u = -7; u <= 7; u += 1.4)
    b.box(27 + u, 9, 19.9, 0.18, 18, 0.4, [0.95, 0.95, 0.94]);
  // stadium bowl next door (tiered rim), and the campus clock tower far to the west
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2,
      r = 34;
    b.box(
      70 + Math.cos(a) * r,
      6 + (i % 2) * 0.4,
      70 + Math.sin(a) * r * 0.7,
      9,
      12,
      4,
      [0.78, 0.74, 0.66],
      0,
      0.25,
      -a + Math.PI / 2,
    );
  }
  b.box(-95, 26, 40, 9, 52, 9, [0.88, 0.86, 0.8]);
  for (let i = 0; i < 5; i++)
    b.box(-95, 54 + i * 2, 40, 8 - i * 1.5, 2, 8 - i * 1.5, [0.32, 0.48, 0.42]);
  // blue-and-gold banners along the walkways, benches in the courtyard
  for (let z = -12; z <= 12; z += 6)
    for (const sd of [-1, 1]) banner(b, sd * 13.5, z, blue, gold);
  for (const [x, z] of [
    [-10, 15],
    [10, 15],
    [-10, -16],
    [10, -16],
  ]) {
    b.box(x, 0.45, z, 2, 0.1, 0.55, [0.45, 0.3, 0.18]);
    b.box(x, 0.2, z, 0.12, 0.4, 0.5, [0.2, 0.2, 0.2]);
  }
  // eucalyptus (tall, thin, grey-green) and oaks on the hills around
  for (let i = 0; i < 140; i++) {
    const x = (rnd() * 2 - 1) * 85,
      z = (rnd() * 2 - 1) * 85;
    if (Math.abs(x) < 26 && Math.abs(z) < 34) continue;
    if (Math.abs(x - 27) < 11 && Math.abs(z - 26) < 9) continue;
    if (Math.hypot(x - 70, (z - 70) / 0.7) < 42) continue;
    if (rnd() < 0.55) {
      const s = 1 + rnd() * 0.8;
      b.box(x, 4 * s, z, 0.35 * s, 8 * s, 0.35 * s, [0.72, 0.68, 0.6]);
      b.blob(
        x,
        8.5 * s,
        z,
        1.4 * s,
        2.4 * s,
        1.4 * s,
        [0.42, 0.52, 0.42],
        0,
        5,
        8,
      );
    } else
      tree(
        b,
        x,
        z,
        1 + rnd() * 0.7,
        pick([
          [0.24, 0.42, 0.2],
          [0.3, 0.46, 0.24],
        ]),
      );
  }
  // Berkeley hills behind
  for (let i = 0; i < 9; i++)
    b.blob(
      -120 + i * 30,
      0,
      -150 - rnd() * 20,
      45 + rnd() * 20,
      30 + rnd() * 18,
      30,
      i % 2 ? [0.56, 0.58, 0.32] : [0.38, 0.5, 0.28],
      0,
      5,
      12,
    );
}

function ucla(b: Builder) {
  seed = 97;
  const blue = [0.15, 0.45, 0.68],
    gold = [1, 0.82, 0.0],
    brickC = [0.7, 0.32, 0.22],
    trim = [0.92, 0.86, 0.72];
  quad(b, [0.36, 0.6, 0.28], [0.9, 0.82, 0.66]);
  // big brick hall with twin towers facing the court (Romanesque style)
  const hz = -78;
  brick(b, 0, hz, 52, 14, 14, brickC, trim);
  for (const sd of [-1, 1]) {
    const x = sd * 9;
    b.box(x, 15, hz + 2, 7, 30, 7, brickC);
    for (const y of [12, 18, 24])
      b.box(x, y, hz - 1.55, 2, 3, 0.12, [0.16, 0.12, 0.12]);
    b.box(x, 30.6, hz + 2, 8, 1.2, 8, trim);
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      b.box(x + sx * 2.8, 33.5, hz + 2 + sz * 2.8, 0.9, 5, 0.9, brickC);
    b.box(x, 36.6, hz + 2, 8, 1.2, 8, trim);
    for (let i = 0; i < 4; i++)
      b.box(
        x,
        38 + i * 1.6,
        hz + 2,
        7 - i * 1.7,
        1.6,
        7 - i * 1.7,
        [0.62, 0.28, 0.2],
      );
  }
  // matching hall opposite and long wings down the sides
  brick(b, 0, 60, 46, 13, 12, shade(brickC, 0.95), trim, Math.PI);
  brick(b, -52, -20, 40, 11, 12, shade(brickC, 1.05), trim, -Math.PI / 2);
  brick(b, 52, -20, 40, 11, 12, shade(brickC, 1.05), trim, Math.PI / 2);
  // wide brick steps and planters in front of the hall
  for (let i = 0; i < 5; i++)
    b.box(0, 0.15 + i * 0.3, -66 - i * 0.9, 20, 0.3, 1, [0.66, 0.36, 0.28]);
  for (let z = -10; z <= 10; z += 5)
    for (const sd of [-1, 1]) banner(b, sd * 13.8, z, blue, gold);
  // palms down the walks and shade trees around
  for (let z = -26; z <= 26; z += 6)
    for (const sd of [-1, 1]) palm(b, sd * 16.5, z, 1 + rnd() * 0.2);
  const greens = [
    [0.25, 0.5, 0.22],
    [0.32, 0.55, 0.28],
  ];
  for (let i = 0; i < 60; i++) {
    const x = (rnd() * 2 - 1) * 80,
      z = (rnd() * 2 - 1) * 80;
    if (Math.abs(x) < 62 && Math.abs(z) < 86) continue;
    tree(b, x, z, 1.1 + rnd() * 0.6, pick(greens));
  }
  for (let i = 0; i < 8; i++)
    b.blob(
      -110 + i * 32,
      0,
      -150,
      45,
      22 + rnd() * 16,
      30,
      [0.45, 0.5, 0.32],
      0,
      5,
      12,
    );
}

function usc(b: Builder) {
  seed = 109;
  const cardinal = [0.6, 0.0, 0.0],
    gold = [1, 0.8, 0.0],
    brickC = [0.66, 0.28, 0.2],
    trim = [0.93, 0.87, 0.74];
  quad(b, [0.38, 0.56, 0.27], [0.88, 0.8, 0.66]);
  // brick buildings with arcades on every side of the quad
  brick(b, -34, -70, 34, 13, 14, brickC, trim);
  brick(b, 34, -72, 30, 11, 14, shade(brickC, 0.95), trim);
  brick(b, -54, -10, 44, 12, 12, shade(brickC, 1.05), trim, -Math.PI / 2);
  brick(b, 54, -10, 44, 12, 12, shade(brickC, 1.05), trim, Math.PI / 2);
  brick(b, 0, 60, 50, 12, 12, brickC, trim, Math.PI);
  // tall brick bell tower with a pointed cap (generic campus tower)
  const tx = 6,
    tz = -80;
  b.box(tx, 22, tz, 7, 44, 7, brickC);
  for (const y of [14, 22, 30, 38])
    b.box(tx, y, tz - 3.55, 1.6, 3.4, 0.12, [0.16, 0.12, 0.12]);
  b.box(tx, 44.6, tz, 8, 1.2, 8, trim);
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    b.box(tx + sx * 2.9, 48, tz + sz * 2.9, 0.9, 6, 0.9, trim);
  b.box(tx, 51.6, tz, 8, 1.2, 8, trim);
  for (let i = 0; i < 8; i++)
    b.box(
      tx,
      53 + i * 1.8,
      tz,
      6.5 - i * 0.8,
      1.8,
      6.5 - i * 0.8,
      [0.3, 0.42, 0.38],
    );
  b.box(tx, 69, tz, 0.3, 3, 0.3, gold);
  // round fountain at the end of the walk
  b.blob(0, 0.3, -34, 4.5, 0.6, 4.5, trim, 0, 3, 18);
  b.blob(0, 0.55, -34, 4, 0.2, 4, [0.4, 0.6, 0.8], 0, 2, 18);
  b.box(0, 1.4, -34, 0.8, 2.6, 0.8, trim);
  b.blob(0, 3, -34, 1.2, 0.5, 1.2, [0.7, 0.85, 0.95], 0, 3, 10);
  for (let z = -10; z <= 10; z += 5)
    for (const sd of [-1, 1]) banner(b, sd * 13.8, z, cardinal, gold);
  for (let z = -28; z <= 30; z += 6.5)
    for (const sd of [-1, 1]) palm(b, sd * 17, z, 1.05 + rnd() * 0.2);
  const greens = [
    [0.26, 0.48, 0.22],
    [0.34, 0.52, 0.26],
  ];
  for (let i = 0; i < 70; i++) {
    const x = (rnd() * 2 - 1) * 85,
      z = (rnd() * 2 - 1) * 85;
    if (Math.abs(x) < 62 && Math.abs(z) < 86) continue;
    tree(b, x, z, 1.1 + rnd() * 0.6, pick(greens));
  }
  // downtown skyline in the distance
  city(b, {
    ground: 0,
    clearX: 90,
    clearZ: 110,
    reach: 200,
    minH: 30,
    maxH: 110,
    colors: [
      [0.72, 0.72, 0.74],
      [0.55, 0.6, 0.68],
      [0.8, 0.76, 0.7],
    ],
    lit: [[0.95, 0.9, 0.75]],
    count: 60,
    skip: (_x, z) => z > -100,
  });
}

// ——— More maps (owner request): six more campus impressions (school colours and campus-style
// buildings only; no logos, mascots, seals or lettering) and six places: an Icelandic
// waterfall, the Swiss Alps, a Hawaiian beach, the Sahara, Paris and the Grand Canyon.
// The play area (|x| < 10, |z| < 18 up to head height) stays clear of scenery.

/** Offset (ox, oz) turned by ry, matching the renderer's box rotation. */
const turn = (ry: number, ox: number, oz: number) => [
  ox * Math.cos(ry) + oz * Math.sin(ry),
  -ox * Math.sin(ry) + oz * Math.cos(ry),
];
/** Wide flat ground, top at -5 cm (same height as the campus lawns). */
function plain(b: Builder, c: V, size = 320) {
  b.box(0, -0.1, 0, size, 0.1, size, c);
}
/** Low-poly peak (six-sided double cone, half below ground); `snow` = share of it that's white. */
function peak(
  b: Builder,
  x: number,
  z: number,
  r: number,
  h: number,
  rock: V,
  snow = 0,
  y = 0,
  cap: V = [0.95, 0.96, 0.98],
) {
  b.blob(x, y, z, r, h, r, rock, 0, 2, 6);
  if (snow > 0) {
    const k = snow / (1 - (1 - snow) / 1.05);
    b.blob(x, y, z, r * k, h * 1.05, r * k, cap, 0, 2, 6);
  }
}
/** Conifer: trunk and three stacked low-poly tiers. */
function pine(b: Builder, x: number, z: number, s: number, c: V, y = 0) {
  b.box(x, y + 0.7 * s, z, 0.26 * s, 1.4 * s, 0.26 * s, [0.3, 0.2, 0.13]);
  for (let i = 0; i < 3; i++)
    b.blob(
      x,
      y + (2 + i * 1.3) * s,
      z,
      (1.6 - i * 0.42) * s,
      1.5 * s,
      (1.6 - i * 0.42) * s,
      shade(c, 1 + i * 0.07),
      0,
      2,
      7,
    );
}
/** Pitched roof: two slabs meeting at a ridge along the building's width. */
function gable(
  b: Builder,
  x: number,
  top: number,
  z: number,
  w: number,
  d: number,
  pitch: number,
  c: V,
  ry = 0,
) {
  const half = d / 2 + 0.5,
    len = half / Math.cos(pitch),
    rise = Math.tan(pitch) * half;
  for (const s of [-1, 1]) {
    const [ox, oz] = turn(ry, 0, (s * half) / 2);
    b.box(
      x + ox,
      top + rise / 2 + 0.12,
      z + oz,
      w + 0.8,
      0.24,
      len,
      c,
      s * pitch,
      0,
      ry,
    );
  }
  return top + rise;
}
/** Rows of windows on both long faces of a w×h×d block (frame + darker pane). */
function windows(
  b: Builder,
  x: number,
  z: number,
  w: number,
  h: number,
  d: number,
  frame: V,
  pane: V,
  ry = 0,
  first = 1.6,
  every = 2.8,
) {
  const n = Math.max(2, Math.floor(w / 2.4));
  for (const fs of [-1, 1])
    for (let y = first; y < h - 1; y += every)
      for (let i = 0; i < n; i++) {
        const u = ((i + 0.5) / n - 0.5) * w;
        const [fx, fz] = turn(ry, u, fs * (d / 2 + 0.05));
        const [px, pz] = turn(ry, u, fs * (d / 2 + 0.09));
        b.box(x + fx, y, z + fz, 1.0, 1.5, 0.1, frame, 0, 0, ry);
        b.box(x + px, y + 0.02, z + pz, 0.74, 1.18, 0.1, pane, 0, 0, ry);
      }
}
/** Georgian brick hall: white-framed windows, slate roof, small white cupola. */
function georgian(
  b: Builder,
  x: number,
  z: number,
  w: number,
  h: number,
  d: number,
  wall: V,
  ry = 0,
  cupola = true,
) {
  const white = [0.95, 0.94, 0.9];
  b.box(x, h / 2, z, w, h, d, wall, 0, 0, ry);
  windows(b, x, z, w, h, d, white, [0.14, 0.16, 0.2], ry);
  b.box(x, h + 0.15, z, w + 0.5, 0.3, d + 0.5, white, 0, 0, ry);
  const ridge = gable(b, x, h + 0.3, z, w, d, 0.55, [0.32, 0.34, 0.38], ry);
  if (cupola) {
    b.box(x, ridge + 0.6, z, 2.2, 2.4, 2.2, white);
    b.box(x, ridge + 1.95, z, 2.6, 0.3, 2.6, white);
    b.blob(x, ridge + 2.1, z, 1.1, 1.2, 1.1, [0.28, 0.42, 0.38], 0, 4, 8);
  }
}
/** White church tower with stacked stages and a needle spire. */
function steeple(
  b: Builder,
  x: number,
  z: number,
  s: number,
  c: V = [0.95, 0.94, 0.9],
) {
  b.box(x, 6 * s, z, 4 * s, 12 * s, 4 * s, c);
  b.box(x, 13 * s, z, 3.2 * s, 2 * s, 3.2 * s, shade(c, 0.97));
  b.box(x, 15.5 * s, z, 2.4 * s, 3 * s, 2.4 * s, c);
  b.box(x, 15.5 * s, z, 1.2 * s, 1.6 * s, 2.5 * s, [0.2, 0.2, 0.24]);
  b.blob(x, 17 * s, z, 1.1 * s, 9 * s, 1.1 * s, c, 0, 2, 8);
}
/** Live oak: low wide crown on a short trunk. */
function oak(b: Builder, x: number, z: number, s: number, leaf: V) {
  b.box(x, 1 * s, z, 0.4 * s, 2 * s, 0.4 * s, [0.3, 0.22, 0.15]);
  b.blob(x, 2.8 * s, z, 3.4 * s, 1.3 * s, 3 * s, leaf, 0, 4, 9);
  b.blob(
    x + 1.2 * s,
    3.3 * s,
    z - 0.6 * s,
    2 * s,
    1 * s,
    2 * s,
    shade(leaf, 1.1),
    0,
    4,
    8,
  );
}
/** Tower with a clock face on each side, a belfry and a stepped roof. */
function clockTower(
  b: Builder,
  x: number,
  z: number,
  w: number,
  h: number,
  stone: V,
  roof: V,
  face: V = [0.95, 0.93, 0.85],
) {
  b.box(x, h / 2, z, w, h, w, stone);
  for (let y = 8; y < h - 8; y += 9)
    b.box(x, y, z, w + 0.3, 0.4, w + 0.3, shade(stone, 0.92));
  for (const [dx, dz] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ])
    b.blob(
      x + dx * (w / 2 + 0.1),
      h - 5,
      z + dz * (w / 2 + 0.1),
      dz ? w * 0.3 : 0.12,
      w * 0.3,
      dx ? w * 0.3 : 0.12,
      face,
      0,
      4,
      12,
    );
  b.box(x, h + 0.5, z, w + 1, 1, w + 1, shade(stone, 0.95));
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    b.box(
      x + sx * (w / 2 - 0.4),
      h + 3,
      z + sz * (w / 2 - 0.4),
      0.8,
      4,
      0.8,
      stone,
    );
  b.box(x, h + 2.6, z, w * 0.6, 3.2, w * 0.6, [0.2, 0.18, 0.18]);
  b.box(x, h + 5.4, z, w + 0.6, 0.8, w + 0.6, shade(stone, 0.95));
  for (let i = 0; i < 6; i++)
    b.box(x, h + 6.4 + i * 1.3, z, w - i * (w / 7), 1.3, w - i * (w / 7), roof);
}
/** Classical dome on a drum (centre x, z; drum bottom at y). */
function dome(
  b: Builder,
  x: number,
  y: number,
  z: number,
  r: number,
  stone: V,
  cap: V,
) {
  // Drum and columns reach 1 m down into the roof below, so they never float on it.
  b.box(x, y + r * 0.55 - 0.5, z, r * 2.1, r * 1.1 + 1, r * 2.1, stone);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box(
      x + Math.cos(a) * r * 1.12,
      y + r * 0.55 - 0.48,
      z + Math.sin(a) * r * 1.12,
      0.6,
      r * 1.1 + 0.85,
      0.6,
      shade(stone, 1.06),
    );
  }
  b.box(x, y + r * 1.15, z, r * 2.3, 0.4, r * 2.3, shade(stone, 0.95));
  b.blob(x, y + r * 1.35, z, r, r * 0.95, r, cap, 0, 8, 16);
  b.box(x, y + r * 2.45, z, 0.9, 1.6, 0.9, stone);
  b.blob(x, y + r * 3.3, z, 0.55, 0.55, 0.55, cap, 0, 4, 8);
}
/** Seating bowl of a big stadium (generic), centred at x, z. */
function stadium(
  b: Builder,
  x: number,
  z: number,
  rx: number,
  rz: number,
  seat: V,
  rim: V,
) {
  b.box(x, 0.02, z, rx * 1.2, 0.08, rz * 1.2, [0.3, 0.55, 0.25]);
  const n = 36;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2,
      ca = Math.cos(a),
      sa = Math.sin(a),
      ry = Math.atan2(ca, sa),
      seg = (Math.PI * 2 * Math.max(rx, rz)) / n + 2;
    for (let k = 0; k < 5; k++) {
      const out = 0.62 + k * 0.1,
        h = 2 + k * 3.2 + (i % 2) * 0.03;
      b.box(
        x + ca * rx * out,
        h / 2,
        z + sa * rz * out,
        seg,
        h,
        4.6,
        shade(seat, 1 + k * 0.05),
        0,
        0,
        ry,
      );
    }
    b.box(
      x + ca * rx * 1.04,
      16.2,
      z + sa * rz * 1.04,
      seg,
      1.4,
      1.2,
      rim,
      0,
      0,
      ry,
    );
  }
}
/** Two-storey Alpine chalet: stone base, timber upper floor, wide roof, flower boxes. */
function chalet(
  b: Builder,
  x: number,
  z: number,
  w: number,
  d: number,
  ry: number,
) {
  const wood = [0.5, 0.31, 0.17];
  b.box(x, 1, z, w, 2, d, [0.92, 0.9, 0.86], 0, 0, ry);
  b.box(x, 3.6, z, w + 0.1, 3.2, d + 0.1, wood, 0, 0, ry);
  windows(
    b,
    x,
    z,
    w,
    5.2,
    d,
    [0.36, 0.22, 0.12],
    [0.16, 0.18, 0.22],
    ry,
    1.4,
    2.6,
  );
  for (const fs of [-1, 1]) {
    const [bx, bz] = turn(ry, 0, fs * (d / 2 + 0.6));
    b.box(x + bx, 2.75, z + bz, w * 0.8, 0.3, 1.1, shade(wood, 0.8), 0, 0, ry);
    const [fx, fz] = turn(ry, 0, fs * (d / 2 + 1.05));
    b.box(
      x + fx,
      3.05,
      z + fz,
      w * 0.78,
      0.35,
      0.25,
      [0.85, 0.15, 0.18],
      0,
      0,
      ry,
    );
  }
  gable(b, x, 5.2, z, w + 1.4, d + 1.6, 0.42, [0.34, 0.24, 0.18], ry);
}
/** Sandstone/mud-brick block with crenellations. */
function kasbah(
  b: Builder,
  x: number,
  z: number,
  w: number,
  h: number,
  d: number,
  c: V,
) {
  b.box(x, h / 2, z, w, h, d, c);
  const n = Math.floor(w / 1.6);
  for (let i = 0; i < n; i++)
    for (const s of [-1, 1])
      b.box(
        x + ((i + 0.5) / n - 0.5) * w,
        h + 0.4,
        z + s * (d / 2 - 0.3),
        0.8,
        0.8,
        0.6,
        c,
      );
  for (let i = 1; i < 3; i++)
    for (let k = 0; k < n; k += 2)
      b.box(
        x + ((k + 0.5) / n - 0.5) * w,
        (h * i) / 3,
        z + d / 2 + 0.05,
        0.5,
        0.9,
        0.12,
        [0.25, 0.16, 0.1],
      );
}
function camel(b: Builder, x: number, z: number, ry: number) {
  const c = [0.74, 0.56, 0.36];
  const at = (
    u: number,
    y: number,
    rx: number,
    ryy: number,
    rz: number,
    col = c,
  ) => {
    const [ox, oz] = turn(ry, u, 0);
    b.blob(x + ox, y, z + oz, rx, ryy, rz, col, 0, 5, 8);
  };
  at(0, 1.9, 1.1, 0.5, 0.45);
  at(0, 2.35, 0.45, 0.45, 0.38);
  at(1.2, 2.4, 0.25, 0.7, 0.2);
  at(1.45, 3.0, 0.38, 0.2, 0.18);
  for (const [u, s] of [
    [-0.7, -1],
    [-0.7, 1],
    [0.7, -1],
    [0.7, 1],
  ]) {
    const [ox, oz] = turn(ry, u, s * 0.25);
    b.box(x + ox, 0.75, z + oz, 0.16, 1.5, 0.16, shade(c, 0.85));
  }
}
function umbrella(b: Builder, x: number, z: number, c: V) {
  b.box(x, 1.2, z, 0.08, 2.4, 0.08, [0.9, 0.9, 0.88]);
  b.blob(x, 2.4, z, 1.6, 0.5, 1.6, c, 0, 2, 8);
}
/** Ocean: deep water far out, lighter shallows near the shore (shore along z = shore). */
function ocean(b: Builder, shore: number, deep: V, shallow: V) {
  b.box(0, -0.35, shore - 130.25, 400, 0.2, 259.5, deep);
  b.box(0, -0.22, shore - 9, 400, 0.1, 18, shallow);
  b.box(0, -0.15, shore - 1.2, 400, 0.06, 1.6, [0.95, 0.97, 0.98]);
}

function stanford(b: Builder) {
  seed = 131;
  const sand = [0.86, 0.74, 0.56],
    trim = [0.92, 0.84, 0.68],
    cardinal = [0.55, 0.08, 0.1];
  quad(b, [0.36, 0.58, 0.27], [0.88, 0.8, 0.64]);
  // sandstone arcades with red tile roofs around the quad
  brick(b, -36, -66, 32, 9, 12, sand, trim);
  brick(b, 36, -66, 32, 9, 12, sand, trim);
  brick(b, -52, -8, 40, 9, 12, shade(sand, 1.03), trim, -Math.PI / 2);
  brick(b, 52, -8, 40, 9, 12, shade(sand, 1.03), trim, Math.PI / 2);
  // memorial church at the head of the quad: tall facade with a bright mosaic panel
  b.box(0, 9, -82, 26, 18, 16, sand);
  gable(b, 0, 18, -82, 16, 26, 0.5, [0.7, 0.3, 0.2], Math.PI / 2);
  b.glow?.(0.25);
  const tiles = [
    [0.95, 0.75, 0.25],
    [0.25, 0.45, 0.75],
    [0.8, 0.3, 0.2],
    [0.98, 0.85, 0.4],
  ];
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 3; j++)
      b.box(-6 + i * 2.4, 10 + j * 2.4, -73.9, 2.3, 2.3, 0.12, pick(tiles));
  b.glow?.(0);
  for (const sd of [-1, 1]) b.box(sd * 9, 4, -73.6, 2.6, 8, 0.7, trim);
  // the slim observation tower with a red dome, off to one side
  const tx = 48,
    tz = -110;
  b.box(tx, 22, tz, 8, 44, 8, trim);
  for (let y = 6; y < 40; y += 5) {
    b.box(tx, y, tz, 8.2, 2.6, 2.2, [0.2, 0.22, 0.26]);
    b.box(tx, y, tz, 2.2, 2.5, 8.2, [0.2, 0.22, 0.26]);
  }
  b.box(tx, 44.5, tz, 10, 1, 10, sand);
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    b.box(tx + sx * 3.6, 47, tz + sz * 3.6, 0.8, 4, 0.8, trim);
  b.box(tx, 49.4, tz, 9, 0.8, 9, sand);
  b.blob(tx, 49.8, tz, 3.8, 4.2, 3.8, [0.72, 0.3, 0.2], 0, 8, 14);
  for (let z = -10; z <= 10; z += 5)
    for (const sd of [-1, 1])
      banner(b, sd * 13.8, z, cardinal, [0.95, 0.95, 0.95]);
  // the palm-lined drive behind, oaks around, golden foothills
  for (let z = 22; z <= 100; z += 7)
    for (const sd of [-1, 1]) palm(b, sd * 8, z, 1.1 + rnd() * 0.2);
  for (let z = -46; z <= 6; z += 8)
    for (const sd of [-1, 1]) palm(b, sd * 22, z, 1 + rnd() * 0.2);
  for (let i = 0; i < 80; i++) {
    const x = (rnd() * 2 - 1) * 95,
      z = (rnd() * 2 - 1) * 95;
    if (Math.abs(x) < 70 && z < 20 && z > -95) continue;
    if (Math.abs(x) < 14) continue;
    oak(
      b,
      x,
      z,
      0.9 + rnd() * 0.5,
      pick([
        [0.26, 0.42, 0.2],
        [0.32, 0.46, 0.24],
      ]),
    );
  }
  for (let i = 0; i < 9; i++)
    b.blob(
      -130 + i * 32,
      0,
      -150 - rnd() * 20,
      42 + rnd() * 18,
      22 + rnd() * 14,
      30,
      i % 2 ? [0.72, 0.62, 0.34] : [0.46, 0.54, 0.28],
      0,
      5,
      12,
    );
}

function harvard(b: Builder) {
  seed = 151;
  const red = [0.58, 0.24, 0.18],
    crimson = [0.6, 0.06, 0.12];
  quad(b, [0.34, 0.54, 0.26], [0.62, 0.32, 0.24]);
  // Georgian brick halls around the yard
  georgian(b, -34, -48, 30, 12, 12, red);
  georgian(b, 34, -48, 30, 12, 12, shade(red, 0.94));
  georgian(b, -48, 4, 34, 12, 12, shade(red, 1.04), -Math.PI / 2);
  georgian(b, 48, 4, 34, 12, 12, red, Math.PI / 2);
  georgian(b, -30, 52, 28, 10, 12, shade(red, 0.97), Math.PI, false);
  georgian(b, 30, 52, 28, 10, 12, red, Math.PI, false);
  // white church steeple at the head of the yard, a library with columns beside it
  b.box(0, 6, -86, 18, 12, 26, red);
  gable(b, 0, 12, -86, 26, 18, 0.6, [0.32, 0.34, 0.38], Math.PI / 2);
  steeple(b, 0, -71, 1.4);
  hall(b, 52, -84, 34, 14, 16, [0.88, 0.85, 0.78], [0.5, 0.48, 0.45], 0.25);
  for (let z = -10; z <= 10; z += 5)
    for (const sd of [-1, 1])
      banner(b, sd * 13.8, z, crimson, [0.95, 0.95, 0.95]);
  // elms in their autumn colours
  const fall = [
    [0.85, 0.45, 0.12],
    [0.75, 0.2, 0.1],
    [0.9, 0.7, 0.2],
    [0.36, 0.5, 0.24],
    [0.7, 0.32, 0.12],
  ];
  for (let i = 0; i < 110; i++) {
    const x = (rnd() * 2 - 1) * 80,
      z = (rnd() * 2 - 1) * 80;
    if (Math.abs(x) < 16 && Math.abs(z) < 20) continue;
    if (Math.abs(z + 48) < 10 && Math.abs(Math.abs(x) - 34) < 18) continue;
    if (Math.abs(Math.abs(x) - 48) < 10 && Math.abs(z - 4) < 20) continue;
    if (Math.abs(z - 52) < 10 && Math.abs(Math.abs(x) - 30) < 17) continue;
    if (z < -60 && Math.abs(x) < 72) continue;
    tree(b, x, z, 1.1 + rnd() * 0.7, pick(fall));
  }
  city(b, {
    ground: 0,
    clearX: 95,
    clearZ: 100,
    reach: 190,
    minH: 10,
    maxH: 40,
    colors: [
      [0.62, 0.3, 0.22],
      [0.75, 0.72, 0.68],
      [0.55, 0.52, 0.5],
    ],
    lit: [[0.95, 0.9, 0.75]],
    count: 70,
  });
}

function mit(b: Builder) {
  seed = 173;
  const lime = [0.86, 0.84, 0.78],
    roof = [0.55, 0.55, 0.55];
  quad(b, [0.36, 0.58, 0.28], [0.84, 0.82, 0.76]);
  // the great domed building at the head of the court, wings either side
  hall(b, 0, -62, 56, 16, 18, lime, roof);
  dome(b, 0, 18, -64, 8, lime, [0.62, 0.64, 0.62]);
  hall(b, -46, -28, 40, 16, 16, shade(lime, 0.97), roof, -Math.PI / 2);
  hall(b, 46, -28, 40, 16, 16, shade(lime, 0.97), roof, Math.PI / 2);
  // newer glass-and-concrete labs further out
  for (const [x, z, w, h, d] of [
    [-80, -70, 20, 26, 16],
    [82, -76, 18, 34, 18],
    [-90, 10, 16, 20, 30],
    [90, 20, 18, 22, 24],
  ])
    tower(b, x, 0, z, w, h, d, [0.7, 0.72, 0.74], [[0.55, 0.7, 0.85]], 3.2, 1);
  for (let z = -10; z <= 10; z += 5)
    for (const sd of [-1, 1])
      banner(b, sd * 13.8, z, [0.64, 0.12, 0.16], [0.6, 0.62, 0.65]);
  for (let i = 0; i < 60; i++) {
    const x = (rnd() * 2 - 1) * 70,
      z = 20 + rnd() * 25;
    if (Math.abs(x) < 16 && z < 22) continue;
    tree(
      b,
      x,
      z,
      1 + rnd() * 0.6,
      pick([
        [0.25, 0.46, 0.22],
        [0.32, 0.5, 0.26],
      ]),
    );
  }
  // the river behind, with the city skyline across it
  b.box(0, -0.04, 75, 400, 0.04, 60, [0.3, 0.42, 0.55]);
  b.box(0, 0.4, 45.5, 400, 1.2, 2, [0.6, 0.58, 0.55]);
  for (let i = 0; i < 6; i++)
    b.box(
      -60 + i * 24,
      0.05,
      75 + (i % 2) * 8,
      3,
      0.25,
      0.8,
      [0.95, 0.95, 0.95],
    );
  city(b, {
    ground: 0,
    clearX: 200,
    clearZ: 108,
    reach: 200,
    minH: 20,
    maxH: 95,
    colors: [
      [0.62, 0.66, 0.72],
      [0.78, 0.76, 0.72],
      [0.5, 0.56, 0.64],
    ],
    lit: [[0.9, 0.92, 0.95]],
    count: 120,
    skip: (_x, z) => z < 108,
  });
  for (let i = 0; i < 8; i++)
    b.blob(
      -130 + i * 36,
      0,
      -150 - rnd() * 20,
      40,
      16 + rnd() * 10,
      26,
      [0.4, 0.5, 0.32],
      0,
      5,
      12,
    );
}

function michigan(b: Builder) {
  seed = 191;
  const blue = [0.02, 0.15, 0.3],
    maize = [1, 0.8, 0.05],
    red = [0.6, 0.28, 0.2],
    lime = [0.88, 0.85, 0.76];
  quad(b, [0.34, 0.56, 0.26], [0.84, 0.8, 0.7]);
  brick(b, -36, -64, 34, 12, 14, red, lime);
  hall(b, 36, -66, 34, 15, 16, lime, [0.45, 0.46, 0.48]);
  brick(b, -54, -6, 42, 12, 12, shade(red, 1.05), lime, -Math.PI / 2);
  georgian(b, 54, -6, 40, 12, 12, red, Math.PI / 2, false);
  // tall stone bell tower
  clockTower(b, -4, -98, 9, 44, lime, [0.32, 0.46, 0.42]);
  // the big bowl stadium in the distance
  stadium(b, 110, 60, 34, 46, blue, maize);
  for (let z = -10; z <= 10; z += 5)
    for (const sd of [-1, 1]) banner(b, sd * 13.8, z, blue, maize);
  const fall = [
    [0.85, 0.5, 0.12],
    [0.78, 0.25, 0.1],
    [0.92, 0.75, 0.2],
    [0.35, 0.5, 0.24],
  ];
  for (let i = 0; i < 110; i++) {
    const x = (rnd() * 2 - 1) * 80,
      z = (rnd() * 2 - 1) * 80;
    if (Math.abs(x) < 16 && Math.abs(z) < 20) continue;
    if (z < -50 && Math.abs(x) < 60) continue;
    if (Math.abs(Math.abs(x) - 54) < 10 && Math.abs(z + 6) < 24) continue;
    tree(b, x, z, 1.1 + rnd() * 0.6, pick(fall));
  }
}

function texas(b: Builder) {
  seed = 211;
  const lime = [0.9, 0.85, 0.72],
    orange = [0.75, 0.34, 0.02],
    tile = [0.7, 0.3, 0.18];
  quad(b, [0.4, 0.56, 0.26], [0.88, 0.82, 0.7]);
  // main building with the tall tower rising out of it
  brick(b, 0, -78, 56, 14, 18, lime, lime);
  const th = 66;
  b.box(0, th / 2, -78, 11, th, 11, lime);
  for (let y = 18; y < th - 10; y += 4) {
    b.box(0, y, -78, 11.2, 2.2, 3, [0.24, 0.24, 0.28]);
    b.box(0, y, -78, 3, 2.1, 11.2, [0.24, 0.24, 0.28]);
  }
  for (const [dx, dz] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ])
    b.blob(
      dx * 5.65,
      th - 6,
      -78 + dz * 5.65,
      dz ? 2.4 : 0.12,
      2.4,
      dx ? 2.4 : 0.12,
      [0.95, 0.92, 0.82],
      0,
      4,
      12,
    );
  b.box(0, th + 0.6, -78, 13, 1.2, 13, lime);
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ])
    b.box(sx * 5.4, th + 3.2, -78 + sz * 5.4, 0.9, 4, 0.9, lime);
  b.box(0, th + 3, -78, 8, 4, 8, [0.3, 0.26, 0.22]);
  b.box(0, th + 5.6, -78, 12, 1.2, 12, lime);
  for (let i = 0; i < 5; i++)
    b.box(0, th + 6.8 + i * 1.2, -78, 10 - i * 2, 1.2, 10 - i * 2, tile);
  b.blob(0, th + 13, -78, 0.9, 1.4, 0.9, [0.95, 0.8, 0.3], 0, 5, 8);
  // limestone halls with red tile roofs
  brick(b, -50, -10, 40, 12, 14, lime, lime, -Math.PI / 2);
  brick(b, 50, -10, 40, 12, 14, lime, lime, Math.PI / 2);
  brick(b, 0, 64, 50, 11, 12, shade(lime, 0.97), lime, Math.PI);
  for (let z = -10; z <= 10; z += 5)
    for (const sd of [-1, 1])
      banner(b, sd * 13.8, z, orange, [0.96, 0.96, 0.94]);
  for (let i = 0; i < 70; i++) {
    const x = (rnd() * 2 - 1) * 90,
      z = (rnd() * 2 - 1) * 90;
    if (Math.abs(x) < 18 && Math.abs(z) < 22) continue;
    if (z < -60 && Math.abs(x) < 40) continue;
    if (Math.abs(Math.abs(x) - 50) < 11 && Math.abs(z + 10) < 24) continue;
    if (Math.abs(z - 64) < 10 && Math.abs(x) < 30) continue;
    oak(
      b,
      x,
      z,
      1 + rnd() * 0.5,
      pick([
        [0.28, 0.42, 0.2],
        [0.34, 0.46, 0.22],
      ]),
    );
  }
  city(b, {
    ground: 0,
    clearX: 100,
    clearZ: 110,
    reach: 200,
    minH: 25,
    maxH: 90,
    colors: [
      [0.7, 0.72, 0.76],
      [0.55, 0.62, 0.7],
      [0.8, 0.76, 0.7],
    ],
    lit: [[0.95, 0.9, 0.75]],
    count: 60,
    skip: (_x, z) => z > -110,
  });
}

function notredame(b: Builder) {
  seed = 229;
  const cream = [0.93, 0.86, 0.68],
    gold = [1, 0.78, 0.25],
    navy = [0.05, 0.12, 0.3];
  quad(b, [0.34, 0.56, 0.26], [0.86, 0.82, 0.72]);
  // the main building with its golden dome
  b.box(0, 10, -80, 54, 20, 20, cream);
  windows(b, 0, -80, 54, 20, 20, [0.9, 0.88, 0.82], [0.2, 0.22, 0.26]);
  gable(b, 0, 20, -80, 54, 20, 0.42, [0.4, 0.42, 0.44]);
  b.box(0, 12, -69, 14, 24, 4, cream);
  b.glow?.(0.18);
  dome(b, 0, 24, -80, 7, cream, gold);
  b.glow?.(0);
  // the basilica beside it: long nave, front tower, tall needle spire
  b.box(-42, 8, -76, 14, 16, 34, cream);
  gable(b, -42, 16, -76, 34, 14, 0.75, [0.36, 0.38, 0.4], Math.PI / 2);
  b.box(-42, 14, -57, 8, 28, 8, cream);
  b.box(-42, 28.6, -57, 8.6, 1.2, 8.6, shade(cream, 0.95));
  b.blob(-42, 29.2, -57, 3.4, 26, 3.4, [0.36, 0.38, 0.4], 0, 2, 8);
  b.blob(-42, 56.5, -57, 0.3, 0.3, 0.3, gold, 0, 3, 6);
  brick(b, 46, -62, 30, 12, 14, cream, shade(cream, 1.05));
  brick(b, -54, -2, 40, 12, 12, cream, shade(cream, 1.05), -Math.PI / 2);
  for (let z = -10; z <= 10; z += 5)
    for (const sd of [-1, 1]) banner(b, sd * 13.8, z, navy, gold);
  // the lake off to one side, ringed with trees
  b.box(80, 0.02, 0, 60, 0.06, 90, [0.3, 0.45, 0.55]);
  for (let i = 0; i < 120; i++) {
    const x = (rnd() * 2 - 1) * 90,
      z = (rnd() * 2 - 1) * 90;
    if (Math.abs(x) < 16 && Math.abs(z) < 20) continue;
    if (x > 48 && Math.abs(z) < 47) continue;
    if (z < -50 && x > -62 && x < 62) continue;
    if (Math.abs(x + 54) < 10 && Math.abs(z + 2) < 24) continue;
    tree(
      b,
      x,
      z,
      1.1 + rnd() * 0.7,
      pick([
        [0.24, 0.44, 0.2],
        [0.32, 0.5, 0.26],
        [0.4, 0.5, 0.24],
      ]),
    );
  }
}

function iceland(b: Builder) {
  seed = 241;
  const basalt = [0.2, 0.21, 0.23],
    moss = [0.33, 0.48, 0.24],
    sand = [0.16, 0.16, 0.17];
  plain(b, sand);
  // the cliff with the falls in a recess at its centre
  const face = -70,
    top = 46;
  for (const sd of [-1, 1])
    for (let i = 0; i < 12; i++) {
      // Cliff in uneven slabs: each juts out a little more or less, at its own height.
      const w = 10 + (i % 3) * 0.7,
        x = sd * (6 + i * 10 + w / 2 - 0.4),
        h = top + ((i * 7) % 5) - 2 + (i ? 0 : 2),
        jut = ((i * 5) % 4) * 0.9 + (i === 0 ? 0 : 0.4);
      b.box(
        x,
        h / 2,
        face - 25 + jut,
        w,
        h,
        50,
        shade(basalt, 0.92 + ((i * 3) % 4) * 0.05),
      );
      b.blob(
        x,
        h,
        face - 2 + jut,
        w * 0.62,
        2.2,
        3.5,
        shade(moss, 0.9 + (i % 3) * 0.1),
        0,
        3,
        8,
      );
      b.box(x, h + 0.4, face - 26.5 + jut, w + 0.2, 1, 45, moss);
      if (i % 2)
        b.blob(
          x + sd * 2,
          h * 0.45,
          face + jut,
          w * 0.4,
          1.4,
          1.6,
          shade(moss, 0.85),
          0,
          3,
          7,
        );
    }
  b.box(0, 22, face - 29, 12.2, 44, 50, shade(basalt, 0.9));
  b.box(0, 44.3, face - 29, 12, 0.4, 49.6, [0.55, 0.66, 0.72]);
  b.box(0, 22, face - 3.8, 12, 44, 0.4, [0.82, 0.9, 0.95]);
  // mossy slopes at the foot of the cliff, basalt columns, boulders
  for (let i = 0; i < 26; i++) {
    const sd = i % 2 ? 1 : -1,
      x = sd * (22 + rnd() * 95);
    b.blob(
      x,
      0,
      face + 2 + rnd() * 6,
      5 + rnd() * 7,
      6 + rnd() * 10,
      5,
      pick([moss, shade(moss, 0.85), shade(moss, 1.1)]),
      0,
      4,
      8,
    );
  }
  for (let i = 0; i < 18; i++) {
    const x = (i % 2 ? 1 : -1) * (14 + i * 1.1);
    b.box(
      x,
      (3 + (i % 4)) / 2,
      face + 4 + (i % 3),
      1.3,
      3 + (i % 4),
      1.3,
      shade(basalt, 1.1 + (i % 3) * 0.06),
    );
  }
  // plunge pool and the river running off to the side
  b.box(0, -0.02, face + 5.1, 24, 0.06, 17.8, [0.42, 0.56, 0.62]);
  b.box(60, -0.04, face + 10, 100, 0.06, 6, [0.42, 0.56, 0.62]);
  for (let i = 0; i < 14; i++)
    b.blob(
      (rnd() * 2 - 1) * 14,
      0.1,
      face + 1 + rnd() * 13,
      0.6 + rnd(),
      0.5 + rnd() * 0.5,
      0.6 + rnd(),
      shade(basalt, 1.2),
      0,
      3,
      6,
    );
  // moss tufts on the black sand, a turf-roofed hut and a little red-roofed church
  for (let i = 0; i < 70; i++) {
    const x = (rnd() * 2 - 1) * 110,
      z = -50 + rnd() * 160;
    if (Math.abs(x) < 14 && Math.abs(z) < 22) continue;
    const r = 1.2 + rnd() * 2.2;
    b.blob(
      x,
      0,
      z,
      r,
      r * (0.45 + rnd() * 0.3),
      r * (0.8 + rnd() * 0.4),
      pick([moss, shade(moss, 0.8), shade(moss, 1.12)]),
      0,
      4,
      8,
    );
  }
  b.box(42, 1.4, -28, 8, 2.8, 6, [0.55, 0.5, 0.42]);
  gable(b, 42, 2.8, -28, 8, 6, 0.55, moss);
  b.box(-44, 2.5, -22, 9, 5, 6, [0.95, 0.95, 0.93]);
  gable(b, -44, 5, -22, 9, 6, 0.6, [0.72, 0.14, 0.12]);
  b.box(-39, 4, -22, 2.2, 8, 2.2, [0.95, 0.95, 0.93]);
  b.blob(-39, 8, -22, 1.2, 2.5, 1.2, [0.72, 0.14, 0.12], 0, 2, 4);
  // glacier peaks behind the player
  for (let i = 0; i < 7; i++)
    peak(
      b,
      -150 + i * 50,
      140 + rnd() * 40,
      30 + rnd() * 15,
      35 + rnd() * 25,
      [0.3, 0.32, 0.36],
      0.55,
    );
  for (const sd of [-1, 1])
    peak(b, sd * 150, 20, 35, 40, [0.28, 0.3, 0.32], 0.4);
}

function alps(b: Builder) {
  seed = 263;
  const meadow = [0.38, 0.6, 0.26],
    rock = [0.46, 0.46, 0.5];
  plain(b, meadow);
  // a ring of snowy peaks
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.2,
      d = 140 + rnd() * 30;
    peak(
      b,
      Math.cos(a) * d,
      Math.sin(a) * d,
      32 + rnd() * 20,
      55 + rnd() * 40,
      rock,
      0.45 + rnd() * 0.15,
    );
  }
  peak(b, 30, -160, 40, 100, shade(rock, 0.9), 0.5);
  for (let i = 0; i < 10; i++)
    b.blob(
      -150 + i * 34,
      0,
      -90 - rnd() * 20,
      30 + rnd() * 10,
      12 + rnd() * 10,
      18,
      shade(meadow, 0.85 + rnd() * 0.2),
      0,
      5,
      12,
    );
  // village of chalets and a pine forest
  const homes = [
    [-30, -34, 0.1],
    [-46, -18, 0.6],
    [32, -36, -0.2],
    [48, -14, -0.7],
    [-34, 34, 2.9],
    [36, 38, 3.4],
    [-60, 10, 1.5],
    [62, 14, -1.4],
  ];
  for (const [x, z, r] of homes) chalet(b, x, z, 10, 8, r);
  for (let i = 0; i < 140; i++) {
    const x = (rnd() * 2 - 1) * 120,
      z = (rnd() * 2 - 1) * 120;
    if (Math.abs(x) < 20 && Math.abs(z) < 26) continue;
    if (homes.some(([hx, hz]) => Math.hypot(x - hx, z - hz) < 9)) continue;
    pine(
      b,
      x,
      z,
      1.4 + rnd() * 1.2,
      pick([
        [0.14, 0.32, 0.18],
        [0.18, 0.36, 0.2],
        [0.12, 0.28, 0.16],
      ]),
    );
  }
  // timber fence around the meadow court
  for (const sd of [-1, 1]) {
    b.box(sd * 11, 0.9, 0, 0.12, 0.12, 38, [0.5, 0.36, 0.22]);
    b.box(0, 0.9, sd * 19, 22, 0.12, 0.12, [0.48, 0.34, 0.2]);
    for (let z = -15; z <= 15; z += 3)
      b.box(sd * 11, 0.55, z, 0.18, 1.1, 0.18, [0.42, 0.3, 0.18]);
  }
  // wildflowers
  for (let i = 0; i < 160; i++) {
    const x = (rnd() * 2 - 1) * 40,
      z = (rnd() * 2 - 1) * 40;
    if (Math.abs(x) < 12 && Math.abs(z) < 20) continue;
    b.blob(
      x,
      0.08,
      z,
      0.18,
      0.12,
      0.18,
      pick([
        [0.95, 0.9, 0.3],
        [0.9, 0.4, 0.6],
        [0.6, 0.5, 0.95],
        [0.9, 0.9, 0.92],
      ]),
      0,
      2,
      5,
    );
  }
}

function hawaii(b: Builder) {
  seed = 281;
  const sandC = [0.92, 0.84, 0.64];
  b.box(0, -0.1, 80, 400, 0.1, 250, sandC);
  ocean(b, -45, [0.05, 0.36, 0.55], [0.2, 0.68, 0.7]);
  // a green volcano and a couple of islands offshore
  peak(b, -120, 40, 60, 62, [0.24, 0.42, 0.22], 0.2, 0, [0.4, 0.33, 0.26]);
  for (let i = 0; i < 3; i++)
    peak(b, -120 + i * 110, -190, 30, 18 + i * 6, [0.24, 0.4, 0.24], 0, -0.4);
  // palms along the beach, umbrellas, surfboards, tiki torches
  for (let i = 0; i < 40; i++) {
    const x = (rnd() * 2 - 1) * 100,
      z = -30 + rnd() * 130;
    if (Math.abs(x) < 18 && z < 24) continue;
    palm(b, x, z, 1 + rnd() * 0.3);
  }
  const brights = [
    [0.95, 0.3, 0.3],
    [0.98, 0.8, 0.2],
    [0.2, 0.6, 0.9],
    [0.95, 0.5, 0.7],
  ];
  for (let i = 0; i < 12; i++) {
    const x = (i % 2 ? 1 : -1) * (14 + (i >> 1) * 7);
    umbrella(b, x, -24 - (i % 3) * 5, pick(brights));
    b.box(x + 1.8, 0.02, -24 - (i % 3) * 5, 0.8, 0.06, 1.9, pick(brights));
  }
  for (let i = 0; i < 6; i++)
    b.box(
      -26 + i * 1.1,
      1.1,
      18,
      0.5,
      2.2,
      0.08,
      pick(brights),
      0,
      0.12 * (i % 2 ? 1 : -1),
    );
  for (const sd of [-1, 1])
    for (let z = -12; z <= 12; z += 8) {
      b.box(sd * 12, 1, z, 0.14, 2, 0.14, [0.45, 0.32, 0.18]);
      b.glow?.(1);
      b.blob(sd * 12, 2.15, z, 0.18, 0.28, 0.18, [1, 0.62, 0.2], 0, 3, 6);
      b.glow?.(0);
    }
  // lifeguard stand
  b.box(30, 1.6, -36, 3, 0.2, 3, [0.95, 0.95, 0.9]);
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    b.box(
      30 + sx * 1.3,
      0.8,
      -36 + sz * 1.3,
      0.16,
      1.6,
      0.16,
      [0.95, 0.95, 0.9],
    );
  b.box(30, 2.8, -36, 3, 2.2, 3, [0.95, 0.3, 0.25]);
  b.box(30, 4.1, -36, 3.6, 0.3, 3.6, [0.95, 0.95, 0.9]);
}

function sahara(b: Builder) {
  seed = 307;
  const sand = [0.88, 0.66, 0.4],
    mud = [0.72, 0.48, 0.3];
  plain(b, sand);
  // rolling dunes
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2,
      d = 60 + rnd() * 130;
    const r = Math.min(14 + rnd() * 26, d - 45),
      x = Math.cos(a) * d,
      z = Math.sin(a) * d;
    if (Math.abs(x) < 80 && z > -110 && z < -40) continue;
    if (Math.abs(x - 42) < 30 && Math.abs(z + 32) < 25) continue;
    b.blob(
      x,
      -r * 0.15,
      z,
      r,
      4 + rnd() * 10,
      r * (0.5 + rnd() * 0.4),
      shade(sand, 0.9 + rnd() * 0.18),
      0,
      5,
      10,
    );
  }
  // a mud-brick fort ahead
  kasbah(b, 0, -80, 40, 10, 14, mud);
  for (const sd of [-1, 1]) {
    b.box(sd * 22, 8, -80, 6, 16, 6, shade(mud, 0.95));
    b.box(sd * 22, 16.4, -80, 7, 0.8, 7, shade(mud, 0.9));
  }
  kasbah(b, -60, -60, 18, 7, 12, shade(mud, 1.05));
  kasbah(b, 58, -64, 22, 8, 12, shade(mud, 0.97));
  // an oasis: pool, palms, tents
  b.box(42, -0.02, -32, 22, 0.06, 14, [0.2, 0.5, 0.55]);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    palm(b, 42 + Math.cos(a) * 14, -32 + Math.sin(a) * 10, 0.9 + rnd() * 0.3);
  }
  for (const [x, z, c] of [
    [-34, -26, [0.7, 0.2, 0.15]],
    [-44, -18, [0.9, 0.85, 0.75]],
    [-28, 30, [0.25, 0.3, 0.6]],
  ] as [number, number, V][]) {
    b.box(x, 1.1, z, 6, 2.2, 4.5, c);
    gable(b, x, 2.2, z, 6, 4.5, 0.5, shade(c, 0.9));
  }
  camel(b, -24, -40, 0.4);
  camel(b, -30, -46, 0.2);
  camel(b, 26, 34, 2.4);
}

function paris(b: Builder) {
  seed = 331;
  const gravel = [0.8, 0.75, 0.64],
    stone = [0.9, 0.85, 0.74],
    slate = [0.38, 0.42, 0.48],
    iron = [0.42, 0.34, 0.27];
  b.box(0, -0.1, -41, 320, 0.1, 238, gravel);
  b.box(0, -0.1, 136, 320, 0.1, 48, gravel);
  // long lawns of the park leading to the iron tower
  for (const sd of [-1, 1])
    b.box(sd * 15, -0.045, -60, 9, 0.05, 110, [0.36, 0.56, 0.28]);
  b.box(0, -0.045, -140, 30, 0.05, 38, [0.36, 0.56, 0.28]);
  const tz = -150;
  const lean = Math.atan(12 / 35);
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    b.box(
      sx * 12,
      17.5,
      tz + sz * 12,
      3.6,
      39,
      3.6,
      iron,
      -sz * lean,
      sx * lean,
    );
  b.box(0, 20, tz, 26, 2.4, 26, iron);
  b.box(0, 35, tz, 14, 1.8, 14, iron);
  for (let i = 0; i < 7; i++)
    b.box(
      0,
      39 + i * 6.6,
      tz,
      9 - i * 1.15,
      6.6,
      9 - i * 1.15,
      shade(iron, 1 + (i % 2) * 0.05),
    );
  b.box(0, 82.5, tz, 3.4, 1.6, 3.4, iron);
  b.box(0, 86, tz, 0.4, 7.5, 0.4, iron);
  // apartment blocks: cream stone, rows of windows, grey mansard roofs
  for (const sd of [-1, 1])
    for (let z = -100; z <= 60; z += 26) {
      const w = 18,
        h = 18 + rnd() * 4,
        d = 22,
        x = sd * 44;
      const ry = Math.PI / 2;
      b.box(x, h / 2, z, w, h, d, stone);
      b.box(x, 2, z, w + 0.1, 4, d + 0.1, shade(stone, 0.93));
      windows(b, x, z, d, h, w, stone, [0.26, 0.28, 0.32], ry, 5.6, 3);
      for (const y of [7.2, 16.2])
        b.box(x, y, z, w + 0.7, 0.18, d + 0.4, [0.12, 0.12, 0.14]);
      b.box(x, h + 1.4, z, w - 1.2, 3, d - 1.2, slate);
      for (let k = -1; k <= 1; k++)
        b.box(x + sd * 3, h + 3.4, z + k * 7, 1.2, 1.4, 1.2, [0.72, 0.5, 0.4]);
    }
  // clipped plane trees in rows and lamp posts
  for (const sd of [-1, 1])
    for (let z = -110; z <= 30; z += 6) {
      if (Math.abs(z) < 20) continue;
      b.box(sd * 23, 1.4, z, 0.3, 2.8, 0.3, [0.4, 0.32, 0.24]);
      b.box(sd * 23, 4, z, 3.2, 2.6, 3.2, [0.28, 0.46, 0.24]);
    }
  for (const sd of [-1, 1])
    for (let z = -16; z <= 16; z += 8) {
      b.box(sd * 11, 1.6, z, 0.12, 3.2, 0.12, [0.15, 0.17, 0.18]);
      b.blob(sd * 11, 3.35, z, 0.24, 0.26, 0.24, [0.98, 0.94, 0.8], 0, 3, 6);
    }
  // the river behind, with stone quays
  b.box(0, -0.6, 95, 400, 0.2, 30, [0.32, 0.42, 0.46]);
  for (const sd of [-1, 1])
    b.box(0, -0.25, 95 + sd * 16, 400, 0.6, 2, shade(stone, 0.9));
}

function grandcanyon(b: Builder) {
  seed = 353;
  const dirt = [0.66, 0.5, 0.36],
    bands = [
      [0.72, 0.36, 0.22],
      [0.82, 0.58, 0.38],
      [0.62, 0.3, 0.2],
      [0.9, 0.76, 0.56],
      [0.68, 0.42, 0.28],
      [0.55, 0.28, 0.2],
    ];
  // The rim sits close behind the court so the drop and the buttes show from player height.
  const rim = -20,
    floor = -100;
  // the rim the court sits on
  b.box(0, -5.05, (rim + 300) / 2, 420, 10, 300 - rim, dirt);
  // the canyon wall dropping away in steps of coloured rock
  for (let i = 1; i <= 10; i++) {
    const front = rim - i * 5 - (i % 3) * 3;
    b.box(
      0,
      -i * 10 + 5 - 0.3 - 0.02 * i,
      (front + rim + 20) / 2,
      419 - i * 0.3,
      10,
      rim + 20 - front,
      bands[i % bands.length],
    );
  }
  b.box(0, floor - 2, -120, 410, 4, 200, [0.5, 0.42, 0.3]);
  b.box(14, floor + 0.1, -110, 400, 0.2, 6, [0.3, 0.5, 0.45]);
  // buttes and mesas rising from the canyon floor, many standing taller than the rim
  for (let i = 0; i < 24; i++) {
    const x = (rnd() * 2 - 1) * 160,
      z = -62 - rnd() * 55 + i * 0.011,
      w = 16 + rnd() * 20,
      d = 14 + rnd() * 16,
      layers = 10 + Math.floor(rnd() * 4);
    for (let k = 0; k < layers; k++) {
      const sc = 1 - k * 0.05;
      // Each butte sits a little lower than the last, so neighbours never share a ledge height.
      b.box(
        x,
        floor - ((i * 0.137) % 3) + k * 10 + 5,
        z,
        w * sc,
        10,
        d * sc,
        bands[(k + i) % bands.length],
      );
    }
  }
  // the far rim, stepping back as it rises
  for (let k = 0; k < 14; k++) {
    const front = -128 - k * 1.6;
    b.box(
      0,
      floor + k * 10 + 5,
      (front - 200) / 2,
      420 - k * 0.2,
      10,
      front + 200,
      bands[(k + 2) % bands.length],
    );
  }
  // stone wall at the edge, a timber-and-stone lodge, junipers and pines
  b.box(0, 0.45, rim + 0.5, 60, 0.9, 0.6, [0.56, 0.48, 0.4]);
  b.box(0, 3.5, 48, 40, 7, 14, [0.54, 0.46, 0.38]);
  windows(b, 0, 48, 40, 7, 14, [0.4, 0.28, 0.18], [0.2, 0.2, 0.22]);
  gable(b, 0, 7, 48, 40, 14, 0.5, [0.38, 0.26, 0.18]);
  for (let i = 0; i < 70; i++) {
    const x = (rnd() * 2 - 1) * 120,
      z = rim + 6 + rnd() * 120;
    if (Math.abs(x) < 16 && z < 24) continue;
    if (Math.abs(x) < 24 && Math.abs(z - 48) < 11) continue;
    if (rnd() < 0.5) pine(b, x, z, 1.2 + rnd() * 0.8, [0.2, 0.34, 0.2]);
    else
      b.blob(
        x,
        0.6,
        z,
        1.4 + rnd(),
        1 + rnd() * 0.6,
        1.4 + rnd(),
        [0.3, 0.38, 0.26],
        0,
        4,
        7,
      );
  }
}

export function buildMap(b0: Builder, id: MapId) {
  const night = id === "tokyo" || id === "nyc";
  WIN = night ? 1.0 : id === "manila" ? 0.35 : 0.08;
  // Small bright blobs (string lights, lamp globes) glow on every map.
  const b: Builder = {
    box: (...a) => b0.box(...a),
    text: (...a) => b0.text(...a),
    glow: (k) => b0.glow?.(k),
    blob(x, y, z, rx, ry, rz, color, stretch, rings, segs) {
      const lamp =
        Math.max(rx, ry, rz) <= 0.3 &&
        color[0] + color[1] + color[2] > 2.3 &&
        color[0] > 0.9;
      if (lamp) b0.glow?.(night ? 2 : 1);
      b0.blob(x, y, z, rx, ry, rz, color, stretch, rings, segs);
      if (lamp) b0.glow?.(0);
    },
  };
  if (id === "tokyo") tokyo(b);
  else if (id === "manila") manila(b);
  else if (id === "sf") sf(b);
  else if (id === "centralpark") centralpark(b);
  else if (id === "nyc") nyc(b);
  else if (id === "berkeley") berkeley(b);
  else if (id === "haas") haas(b);
  else if (id === "ucla") ucla(b);
  else if (id === "usc") usc(b);
  else if (id === "stanford") stanford(b);
  else if (id === "harvard") harvard(b);
  else if (id === "mit") mit(b);
  else if (id === "michigan") michigan(b);
  else if (id === "texas") texas(b);
  else if (id === "notredame") notredame(b);
  else if (id === "iceland") iceland(b);
  else if (id === "alps") alps(b);
  else if (id === "hawaii") hawaii(b);
  else if (id === "sahara") sahara(b);
  else if (id === "paris") paris(b);
  else if (id === "grandcanyon") grandcanyon(b);
}

const lin = (c: V): [number, number, number] => [
  c[0] ** 2.2,
  c[1] ** 2.2,
  c[2] ** 2.2,
];
const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};
/** Floodlight aimed from (x, y, z) at a floor point. */
const flood = (
  x: number,
  y: number,
  z: number,
  tx: number,
  tz: number,
  color: [number, number, number],
  outer = 30,
): Spot => ({
  pos: [x, y, z],
  dir: unit(tx - x, -y, tz - z),
  color,
  inner: outer * 0.45,
  outer,
  range: 16,
});
/** Key light, ambient, spotlights, exposure and bloom for each map (renderer input). */
export function lightingFor(id: MapId): Lighting {
  const look = LOOKS[id];
  const base = {
    sky: lin(look.sky),
    fogNear: look.fogNear,
    fogFar: look.fogFar,
  };
  if (id === "arena") {
    // TV arena: dim key from the gantries, four warm spot pools on the court.
    const w: [number, number, number] = [1.9, 1.78, 1.6];
    return {
      ...base,
      sunDir: unit(0.32, -1, 0.42),
      sunColor: [0.3, 0.29, 0.29],
      skyAmb: [0.09, 0.09, 0.15],
      groundAmb: [0.06, 0.02, 0.03],
      spots: [
        flood(-5.5, 10.5, 7.5, -1.4, 3.2, w),
        flood(5.5, 10.5, 7.5, 1.4, 3.2, w),
        flood(-5.5, 10.5, -7.5, -1.4, -3.2, w),
        flood(5.5, 10.5, -7.5, 1.4, -3.2, w),
      ],
      exposure: 1.2,
      bloom: 0.06,
    };
  }
  if (id === "tokyo" || id === "nyc") {
    const c: [number, number, number] =
      id === "tokyo" ? [2.3, 2.0, 2.3] : [2.5, 2.3, 2.0];
    return {
      ...base,
      sunDir: unit(-0.35, -1, -0.45),
      sunColor: id === "tokyo" ? [0.32, 0.28, 0.48] : [0.3, 0.32, 0.42],
      skyAmb: lin(look.sky).map((v) => v * 1.4 + 0.06) as [
        number,
        number,
        number,
      ],
      groundAmb: [0.05, 0.04, 0.07],
      spots: [
        flood(-7, 9.5, 8, -1.2, 2.5, c, 34),
        flood(7, 9.5, -8, 1.2, -2.5, c, 34),
      ],
      exposure: 1.3,
      bloom: 0.08,
    };
  }
  // Iceland: soft overcast light, no hard sun.
  if (id === "iceland")
    return {
      ...base,
      sunDir: unit(-0.3, -0.92, -0.25),
      sunColor: [1.25, 1.28, 1.32],
      skyAmb: lin(look.sky).map((v) => v * 0.95 + 0.08) as [
        number,
        number,
        number,
      ],
      groundAmb: [0.05, 0.05, 0.06],
      spots: [],
      exposure: 1.05,
      bloom: 0.04,
    };
  // Daylight maps: sun, sky fill, ground bounce. Manila is a low warm sunset.
  const sunset = id === "manila" || id === "usc";
  return {
    ...base,
    sunDir: sunset ? unit(0.25, -0.62, 0.8) : unit(-0.45, -0.88, -0.32),
    sunColor: sunset ? [1.95, 1.35, 0.92] : [2.15, 2.0, 1.8],
    skyAmb: lin(look.sky).map((v) => v * 0.75 + 0.05) as [
      number,
      number,
      number,
    ],
    groundAmb: lin(look.ground ?? look.apron).map((v) => v * 0.6 + 0.03) as [
      number,
      number,
      number,
    ],
    spots: [],
    exposure: 1.0,
    bloom: 0.045,
  };
}
