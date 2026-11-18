// Map scenery (owner request): Tokyo, Manila rooftop, San Francisco rooftop, Central Park.
// Original low-poly impressions of each place, built from the scene's box/blob primitives.
// No real logos, signs or brand lettering — only shapes, colours and lights.
import type { MapId } from "../shared/types.ts";

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
}

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
    ground: [0.2, 0.055, 0.1],
    apron: [0.09, 0.14, 0.26],
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
    fogNear: 40,
    fogFar: 135,
    ambient: 1.02,
    spots: 0.15,
    ground: [0.3, 0.56, 0.26],
    apron: [0.3, 0.33, 0.38],
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
  for (let y = base + 2; y < base + h - 1; y += every) {
    if (rnd() > litChance) continue;
    const c = pick(lit);
    b.box(x, y, z, w + 0.06, every * 0.32, d * 0.86, c);
    b.box(x, y, z, w * 0.86, every * 0.32, d + 0.06, c);
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

/** Rooftop deck the court sits on, with a railing and the building below it. */
function rooftop(b: Builder, deck: V, facade: V, lit: V[], drop = 42) {
  const W = 24,
    D = 34;
  b.box(0, -0.2, 0, W, 0.36, D, deck);
  // building below the roof
  b.box(0, -drop / 2 - 0.4, 0, W - 0.6, drop, D - 0.6, facade);
  for (let y = -3; y > -drop; y -= 3) {
    b.box(0, y, 0, W - 0.5, 1.1, D - 1.4, shade(pick(lit), 0.8));
    b.box(0, y, 0, W - 1.4, 1.1, D - 0.5, shade(pick(lit), 0.8));
  }
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
      b.box(s * 10.8, 4 + rnd() * 3, z, 0.25, 3 + rnd() * 3, 1.1, c);
      b.box(s * 10.95, 4.2, z, 0.1, 0.4, 1.5, shade(c, 0.6));
    }
  }
  for (const s of [-1, 1])
    for (let x = -26; x < 26; x += 7 + rnd() * 3) {
      const h = 8 + rnd() * 22;
      tower(b, x, 0, s * (19 + rnd() * 3), 6, h, 6, [0.09, 0.08, 0.14], lit);
      const c = pick(neon);
      b.box(x, 5 + rnd() * 3, s * 15.8, 2.4, 1 + rnd(), 0.25, c);
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
  // cherry trees and lanterns along the plaza
  for (const s of [-1, 1])
    for (let z = -9; z <= 9; z += 6) tree(b, s * 9, z, 0.8, [0.98, 0.7, 0.82]);
  for (const s of [-1, 1]) {
    b.box(s * 7.6, 4.2, 0, 0.03, 0.03, 26, [0.15, 0.15, 0.2]);
    for (let z = -12; z <= 12; z += 2)
      b.blob(s * 7.6, 3.9, z, 0.22, 0.3, 0.22, [0.95, 0.25, 0.2], 0, 4, 8);
    for (const z of [-13, 13])
      b.box(s * 7.6, 2.1, z, 0.12, 4.2, 0.12, [0.15, 0.15, 0.2]);
  }
  // pixel lettering on the plaza floor, the game's own name
  b.text("POVPICKLE", -9.4, 0.004, 5.4, 0.32, 0, -1, [0.3, 0.22, 0.45]);
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
  b.box(0, -42.4, -120, 320, 0.4, 150, [0.36, 0.42, 0.6]);
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
  b.blob(-15, 8, -118, 11, 11, 2, [1, 0.88, 0.55], 0, 8, 16);
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
  b.box(0, -42.6, -120, 320, 0.4, 160, [0.3, 0.42, 0.52]);
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
  for (let i = 0; i < 170; i++) {
    const x = (rnd() * 2 - 1) * 55,
      z = (rnd() * 2 - 1) * 55;
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
  for (let i = 0; i < 70; i++) {
    const side = Math.floor(rnd() * 4),
      along = (rnd() * 2 - 1) * 80,
      out = 66 + rnd() * 18;
    const [x, z] =
      side === 0
        ? [along, -out]
        : side === 1
          ? [along, out]
          : side === 2
            ? [-out, along]
            : [out, along];
    tower(
      b,
      x,
      0,
      z,
      6 + rnd() * 6,
      22 + rnd() ** 1.5 * 55,
      6 + rnd() * 6,
      pick(colors),
      lit,
      3,
      0.5,
    );
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

export function buildMap(b: Builder, id: MapId) {
  if (id === "tokyo") tokyo(b);
  else if (id === "manila") manila(b);
  else if (id === "sf") sf(b);
  else if (id === "centralpark") centralpark(b);
}
