/**
 * Sportle Kart: shared types, track geometry, the phone's steering reader and motion gestures,
 * item odds and lap/placing rules. Driving physics, items, laps and placings are decided on the
 * server (src/server/kart.ts); this file is pure and shared with the browser so the TV draws the
 * same track the server drives on.
 */
import { clamp } from "./types.ts";
import type { Gear, MapId, Outfit } from "./types.ts";
import { deviceAxes, ease, wrap } from "./motion.ts";

// ——————————————————————————— Tracks ———————————————————————————

export type TrackId = "court" | "neon" | "beach" | "skyline" | "frost" | "jungle" | "stadium" | "canyon";
/** How a track's road looks: surface, kerbs on the corners, barriers along the edge. */
export type Surface = "court" | "neon" | "planks" | "rooftop" | "ice" | "dirt" | "hardwood" | "sandstone";
export type Kerb = "court" | "neonline" | "rope" | "hazard" | "iceblocks" | "rocks" | "paint";
export type Barrier = "fence" | "neon" | "rail" | "guardrail" | "snowbank" | "logs" | "pads" | "boulders";
/** Laps per race and karts per race (players plus bots). */
export const LAPS = 3;
export const GRID = 8;
/** Lap sectors: a lap counts only after passing every sector in order. */
export const SECTORS = 12;
/** Control point: x, z (ground plane, metres), y (height) and road width. */
type Pt = [number, number, number, number];
export interface TrackDef {
  id: TrackId;
  name: string;
  note: string;
  /** Pickleball map whose sky and light the track borrows. */
  light: MapId;
  pts: Pt[];
  /** Drivable but slow ground beyond the road edge, before the barrier (metres). */
  verge: number;
  ground: "grass" | "sand" | "asphalt" | "roof" | "snow" | "jungle" | "arena" | "desert";
  road: { surface: Surface; kerb: Kerb; barrier: Barrier };
  /** Tyre grip on this road (1 = normal; ice is slippery). */
  grip?: number;
  /** Top speed off the road (fraction; default 0.5). */
  offroad?: number;
  /** A stretch drawn as a glass skybridge (fractions of the lap), e.g. the figure-8 crossing. */
  bridge?: [number, number];
  /** Water drawn under the gaps (rivers, the harbour) rather than the ground far below. */
  water?: boolean;
  /**
   * Ramps: start (fraction of the lap), length (m), lip height (m). The lip launches karts.
   * `gap`: metres with no ground after the lip (water, a street far below): fall in and the
   * drone lifts you back.
   */
  ramps: { at: number; len: number; h: number; gap?: number }[];
  /** Boost pads: position (fraction), lateral offset (fraction of half-width). */
  pads: { at: number; d: number }[];
  /** Rows of item cubes (fractions of the lap). */
  cubes: number[];
  /** Shortcut: a slow-surface strip through the infield, from/to (fractions). */
  cut: { from: number; to: number; bulge: number };
  /** Moving obstacles: giant bowling pins sliding across the road (Neon Lanes). */
  pins?: { at: number; len: number; n: number };
  /** Start/finish line (fraction of the lap), on a straight so the grid behind it is too. */
  start: number;
  /** Overhead scoreboard gantries and LED boards (fractions). */
  gantries: number[];
}
export const TRACKS: TrackDef[] = [
  {
    id: "court",
    name: "Court Circuit",
    note: "A giant pickleball complex: over the nets, under the scoreboard",
    light: "centralpark",
    verge: 4,
    ground: "grass",
    road: { surface: "court", kerb: "court", barrier: "fence" },
    pts: [
      [-40, -50, 0, 15],
      [0, -52, 0, 15],
      [40, -50, 0, 15],
      [70, -36, 0, 14],
      [80, -5, 0, 14],
      [68, 26, 0, 13],
      [42, 40, 0, 13],
      [16, 30, 0, 13],
      [-10, 44, 0, 13],
      [-36, 34, 0, 13],
      [-64, 46, 0, 14],
      [-88, 22, 0, 14],
      [-86, -16, 0, 14],
      [-70, -44, 0, 15],
    ],
    ramps: [
      { at: 0.505, len: 9, h: 1.5 },
      { at: 0.585, len: 9, h: 1.5 },
    ],
    pads: [
      { at: 0.11, d: 0 },
      { at: 0.33, d: -0.4 },
      { at: 0.68, d: 0.35 },
    ],
    cubes: [0.14, 0.45, 0.8],
    cut: { from: 0.7, to: 0.84, bulge: 8 },
    start: 0.06,
    gantries: [0.065, 0.4],
  },
  {
    id: "neon",
    name: "Neon Lanes",
    note: "Night city and a giant bowling lane with moving pins",
    light: "tokyo",
    verge: 2.5,
    ground: "asphalt",
    road: { surface: "neon", kerb: "neonline", barrier: "neon" },
    pts: [
      [-60, -40, 0, 14],
      [-10, -40, 0, 14],
      [40, -40, 0, 14],
      [66, -26, 0, 13],
      [70, 4, 0, 13],
      [56, 28, 0, 13],
      [30, 34, 0, 16],
      [0, 34, 0, 16],
      [-30, 34, 0, 16],
      [-54, 44, 0, 13],
      [-80, 36, 0, 13],
      [-86, 10, 0, 13],
      [-80, -22, 0, 13],
    ],
    ramps: [{ at: 0.2, len: 8, h: 1.1 }],
    pads: [
      { at: 0.1, d: 0.3 },
      { at: 0.28, d: -0.3 },
      { at: 0.84, d: 0 },
    ],
    cubes: [0.06, 0.4, 0.72],
    cut: { from: 0.73, to: 0.92, bulge: 9 },
    pins: { at: 0.47, len: 50, n: 5 },
    start: 0.08,
    gantries: [0.085, 0.6],
  },
  {
    id: "beach",
    name: "Beach Boardwalk",
    note: "Sand off-road, a pier jump and boost pads on the boardwalk",
    light: "hawaii",
    verge: 9,
    ground: "sand",
    road: { surface: "planks", kerb: "rope", barrier: "rail" },
    water: true,
    pts: [
      [-50, -46, 0.3, 14],
      [0, -48, 0.3, 14],
      [44, -44, 0.3, 14],
      [74, -24, 0.3, 13],
      [78, 6, 0.3, 13],
      [66, 32, 1.2, 11],
      [40, 52, 1.2, 11],
      [6, 56, 1.2, 11],
      [-26, 46, 0.3, 13],
      [-56, 40, 0.3, 13],
      [-84, 22, 0.3, 13],
      [-90, -8, 0.3, 13],
      [-78, -36, 0.3, 14],
    ],
    ramps: [{ at: 0.415, len: 10, h: 2.6, gap: 11 }],
    pads: [
      { at: 0.12, d: 0.35 },
      { at: 0.15, d: -0.35 },
      { at: 0.5, d: 0 },
      { at: 0.53, d: 0 },
    ],
    cubes: [0.16, 0.36, 0.74],
    cut: { from: 0.72, to: 0.9, bulge: 14 },
    start: 0.08,
    gantries: [0.085, 0.62],
  },
  {
    id: "skyline",
    name: "Skyline Rooftops",
    note: "Rooftop jumps and a tight spiral down a parking garage",
    light: "manila",
    verge: 2.5,
    ground: "roof",
    road: { surface: "rooftop", kerb: "hazard", barrier: "guardrail" },
    pts: [
      [-60, -50, 14, 13],
      [-20, -50, 14, 13],
      [20, -50, 14, 13],
      [52, -50, 14, 12],
      // Spiral down the garage: centre (70, -16), radius 18, down to street level.
      [76, -42, 13.4, 11],
      [88, -22, 12, 11],
      [84, 0, 10.4, 11],
      [70, 6, 9, 11],
      [54, -4, 7.6, 11],
      [52, -24, 6.2, 11],
      [66, -36, 4.8, 11],
      [86, -28, 3.4, 11],
      [92, -6, 2, 11],
      [86, 24, 0, 12],
      [64, 44, 0, 13],
      // Climb back up the ramp road to the roofs.
      [30, 50, 2.5, 13],
      [-6, 50, 6, 13],
      [-40, 46, 9.5, 13],
      [-70, 34, 12.5, 13],
      [-88, 8, 14, 13],
      [-84, -30, 14, 13],
    ],
    ramps: [
      { at: 0.13, len: 8, h: 1.6, gap: 10 },
      { at: 0.88, len: 8, h: 1.6, gap: 11 },
    ],
    pads: [
      { at: 0.115, d: 0 },
      { at: 0.86, d: 0 },
      { at: 0.6, d: 0.3 },
    ],
    cubes: [0.1, 0.55, 0.78],
    cut: { from: 0.925, to: 0.995, bulge: 6 },
    start: 0.05,
    gantries: [0.055, 0.7],
  },
  {
    id: "frost",
    name: "Frost Pass",
    note: "An icy mountain road: switchback hairpins up, a summit jump, a fast run down",
    light: "alps",
    verge: 3,
    ground: "snow",
    road: { surface: "ice", kerb: "iceblocks", barrier: "snowbank" },
    // Slightly slippery, still easy.
    grip: 0.82,
    pts: [
      [-70, -52, 0, 13],
      [-20, -56, 0, 13],
      [30, -52, 1, 13],
      [62, -38, 2.5, 12],
      [78, -16, 4, 11],
      [62, 0, 5.5, 11],
      // First switchback: a round hairpin (about 16 m radius) between the two legs.
      [24, 4, 7, 11],
      [8, 5, 7.4, 11],
      [-3, 10, 7.8, 11],
      [-6, 18, 8.4, 11],
      [-3, 26, 9, 11],
      [8, 31, 9.5, 11],
      [24, 33, 10, 11],
      // Second switchback up to the summit, also round.
      [50, 36, 12, 11],
      [64, 41, 12.8, 12],
      [75, 48, 13.4, 12],
      [79, 58, 14, 12],
      [74, 68, 14.6, 12],
      [62, 74, 15, 12],
      [44, 75, 15, 12],
      [2, 66, 13, 12],
      [-40, 58, 9, 12],
      [-76, 34, 5, 13],
      [-92, -2, 2, 13],
      [-88, -36, 0.5, 13],
    ],
    ramps: [{ at: 0.6, len: 10, h: 1.6 }],
    pads: [
      { at: 0.11, d: 0 },
      { at: 0.66, d: 0.3 },
      { at: 0.8, d: -0.3 },
    ],
    cubes: [0.16, 0.5, 0.86],
    cut: { from: 0.74, to: 0.9, bulge: 7 },
    start: 0.05,
    gantries: [0.055, 0.57],
  },
  {
    id: "jungle",
    name: "Jungle Trail",
    note: "A dirt trail through the jungle: S-bends, log bridges and a river jump",
    light: "hawaii",
    verge: 3.5,
    ground: "jungle",
    road: { surface: "dirt", kerb: "rocks", barrier: "logs" },
    grip: 0.95,
    water: true,
    pts: [
      [-80, -42, 0, 12],
      [-30, -50, 0, 12],
      [8, -38, 0, 11],
      [40, -56, 0, 11],
      [76, -42, 0, 12],
      [86, -6, 0, 11],
      [74, 8, 0, 11],
      [64, 20, 0, 11],
      [67, 33, 0, 11],
      [70, 45, 0, 11],
      [62, 57, 0, 11],
      [44, 63, 0, 12],
      [4, 50, 0.5, 12],
      [-30, 64, 0, 11],
      [-62, 52, 0, 11],
      [-92, 26, 0, 12],
      [-98, -14, 0, 12],
    ],
    ramps: [{ at: 0.655, len: 10, h: 2.2, gap: 11 }],
    pads: [
      { at: 0.1, d: 0 },
      { at: 0.63, d: 0 },
      { at: 0.35, d: -0.3 },
    ],
    cubes: [0.18, 0.45, 0.82],
    cut: { from: 0.8, to: 0.94, bulge: 8 },
    start: 0.05,
    gantries: [0.055, 0.5],
  },
  {
    id: "stadium",
    name: "Stadium Eight",
    note: "A figure-8 on a hardwood arena floor that crosses itself on a glass skybridge",
    light: "texas",
    verge: 2.5,
    ground: "arena",
    road: { surface: "hardwood", kerb: "paint", barrier: "pads" },
    pts: [
      [-28, -28, 0, 13],
      [0, 0, 0, 13],
      [28, 28, 0, 13],
      [58, 44, 0, 13],
      [90, 24, 0, 13],
      [92, -20, 0, 13],
      [60, -44, 0, 13],
      [28, -28, 3.5, 13],
      [0, 0, 7.5, 13],
      [-28, 28, 3.5, 13],
      [-60, 44, 0, 13],
      [-92, 20, 0, 13],
      [-90, -24, 0, 13],
      [-58, -44, 0, 13],
    ],
    bridge: [0.45, 0.62],
    ramps: [],
    pads: [
      { at: 0.06, d: 0 },
      { at: 0.53, d: 0 },
      { at: 0.3, d: 0.35 },
      { at: 0.8, d: -0.35 },
    ],
    cubes: [0.14, 0.4, 0.66, 0.9],
    cut: { from: 0.2, to: 0.36, bulge: 4 },
    start: 0.03,
    gantries: [0.035, 0.53],
  },
  {
    id: "canyon",
    name: "Canyon Run",
    note: "Red-rock desert: a long straight, a canyon jump, a chicane and a split path",
    light: "grandcanyon",
    verge: 5,
    ground: "desert",
    road: { surface: "sandstone", kerb: "rocks", barrier: "boulders" },
    pts: [
      [-92, -44, 0, 13],
      [-40, -48, 0, 13],
      [10, -48, 0, 13],
      [62, -46, 0, 13],
      [92, -26, 0, 12],
      [98, 10, 1, 12],
      [78, 36, 2, 12],
      [48, 40, 3, 11],
      [26, 24, 3, 11],
      [0, 38, 3, 11],
      [-28, 56, 2, 12],
      [-68, 56, 1, 12],
      [-96, 30, 0, 12],
      [-104, -10, 0, 13],
    ],
    ramps: [{ at: 0.17, len: 10, h: 2.4, gap: 12 }],
    pads: [
      { at: 0.13, d: 0.3 },
      { at: 0.15, d: -0.3 },
      { at: 0.6, d: 0 },
    ],
    cubes: [0.26, 0.5, 0.8],
    cut: { from: 0.42, to: 0.6, bulge: 8 },
    start: 0.06,
    gantries: [0.065, 0.7],
  },
];

export interface Cut {
  /** Polyline of the strip's centre and the main-track indexes where it starts and ends. */
  x: number[];
  z: number[];
  y: number[];
  /** Cumulative length along the strip. */
  l: number[];
  from: number;
  to: number;
  /** Main-track distance at each end. */
  s0: number;
  s1: number;
  width: number;
}
export interface Track {
  def: TrackDef;
  n: number;
  /** Lap length (m, measured on the ground plane). */
  L: number;
  x: Float64Array;
  z: Float64Array;
  y: Float64Array;
  w: Float64Array;
  /** Unit tangent on the ground plane. */
  tx: Float64Array;
  tz: Float64Array;
  s: Float64Array;
  /** 0 = no ground here (a gap). */
  ground: Uint8Array;
  /** Signed curvature (1/m), + = turning right (toward +normal). */
  k: Float64Array;
  /** Racing line: lateral offset toward the inside of corners (m). */
  line: Float64Array;
  cut: Cut | null;
  /** Distance of the start/finish line. */
  S0: number;
}
/** Narrowest road anywhere (metres). */
export const MIN_WIDTH = 13;
/** Control points are drawn on a small grid, then scaled up to race size. */
export const TRACK_SCALE = 1.25;
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 *
  (2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
/** Normal (-tz, tx) points to the driver's right (y up, heading +x → right is +z); lateral offset d is measured along it. */
export function buildTrack(def: TrackDef, step = 1.5): Track {
  const P = def.pts,
    m = P.length;
  const xs: number[] = [],
    zs: number[] = [],
    ys: number[] = [],
    ws: number[] = [];
  for (let i = 0; i < m; i++) {
    const a = P[(i - 1 + m) % m],
      b = P[i],
      c = P[(i + 1) % m],
      d = P[(i + 2) % m];
    const segLen = Math.hypot(c[0] - b[0], c[1] - b[1]) * TRACK_SCALE;
    const k = Math.max(2, Math.ceil(segLen / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      xs.push(cr(a[0], b[0], c[0], d[0], t) * TRACK_SCALE);
      zs.push(cr(a[1], b[1], c[1], d[1], t) * TRACK_SCALE);
      ys.push(cr(a[2], b[2], c[2], d[2], t));
      ws.push(cr(a[3], b[3], c[3], d[3], t));
    }
  }
  const n = xs.length;
  const s = new Float64Array(n + 1);
  for (let i = 0; i < n; i++)
    s[i + 1] = s[i] + Math.hypot(xs[(i + 1) % n] - xs[i], zs[(i + 1) % n] - zs[i]);
  const L = s[n];
  const tx = new Float64Array(n),
    tz = new Float64Array(n),
    k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const l = Math.hypot(xs[j] - xs[i], zs[j] - zs[i]) || 1;
    tx[i] = (xs[j] - xs[i]) / l;
    tz[i] = (zs[j] - zs[i]) / l;
  }
  for (let i = 0; i < n; i++) {
    const a = (i - 3 + n) % n,
      b = (i + 3) % n;
    const turn = Math.atan2(tx[a] * tz[b] - tz[a] * tx[b], tx[a] * tx[b] + tz[a] * tz[b]);
    k[i] = turn / (6 * step);
  }
  // Roads are at least MIN_WIDTH wide, and wider through tight bends (up to +4 m on a hairpin),
  // eased along the track so the edges stay smooth.
  const extra = new Float64Array(n);
  for (let i = 0; i < n; i++) extra[i] = clamp((Math.abs(k[i]) * 30 - 1) * 4, 0, 4);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let q = -10; q <= 10; q++) e = Math.max(e, extra[(i + q + n) % n] * (1 - Math.abs(q) / 11));
    ws[i] = Math.max(MIN_WIDTH, ws[i]) + e;
  }
  const y = Float64Array.from(ys),
    ground = new Uint8Array(n).fill(1);
  const idxAt = (frac: number) => Math.round(((((frac % 1) + 1) % 1) * n)) % n;
  for (const r of def.ramps) {
    const i0 = idxAt(r.at);
    for (let q = 0; q < n; q++) {
      const i = (i0 + q) % n;
      const ds = (s[i] - s[i0] + L) % L;
      if (ds <= r.len) y[i] += r.h * (ds / r.len);
      else if (ds <= r.len + (r.gap ?? 0)) ground[i] = 0;
      else break;
    }
  }
  // Racing line: toward the inside of corners, smoothed.
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let kk = 0;
    for (let q = -6; q <= 6; q++) kk += k[(i + q + n) % n];
    raw[i] = clamp((kk / 13) * 25, -1, 1) * (ws[i] / 2 - 2);
  }
  const line = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (let q = -8; q <= 8; q++) a += raw[(i + q + n) % n];
    line[i] = a / 17;
  }
  const t: Track = {
    def,
    n,
    L,
    x: Float64Array.from(xs),
    z: Float64Array.from(zs),
    y,
    w: Float64Array.from(ws),
    tx,
    tz,
    s,
    ground,
    k,
    line,
    cut: null,
    S0: def.start * L,
  };
  t.cut = buildCut(t);
  return t;
}
/** The shortcut strip: from the inner road edge at `from` to the inner edge at `to`, bowed inward. */
function buildCut(t: Track): Cut | null {
  const c = t.def.cut;
  if (!c) return null;
  const i0 = Math.round(c.from * t.n) % t.n,
    i1 = Math.round(c.to * t.n) % t.n;
  // Inside = the side the road turns toward between the two ends.
  let turn = 0;
  for (let i = i0; i !== i1; i = (i + 1) % t.n) turn += t.k[i];
  const side = turn >= 0 ? 1 : -1;
  const edge = (i: number) => {
    const off = side * (t.w[i] / 2 + 0.5);
    return [t.x[i] - t.tz[i] * off, t.z[i] + t.tx[i] * off];
  };
  const a = edge(i0),
    b = edge(i1);
  const mx = (a[0] + b[0]) / 2,
    mz = (a[1] + b[1]) / 2;
  // Bow the strip away from the road (toward the inside of the corner).
  const im = (i0 + Math.round(((i1 - i0 + t.n) % t.n) / 2)) % t.n;
  let bx = mx - t.x[im],
    bz = mz - t.z[im];
  const bl = Math.hypot(bx, bz) || 1;
  bx /= bl;
  bz /= bl;
  const x: number[] = [],
    z: number[] = [],
    y: number[] = [],
    l: number[] = [0];
  const N = 24;
  for (let q = 0; q <= N; q++) {
    const u = q / N,
      bow = Math.sin(Math.PI * u) * c.bulge;
    // Quadratic-ish: start along the road edge, then cut across.
    x.push(a[0] + (b[0] - a[0]) * u + bx * bow);
    z.push(a[1] + (b[1] - a[1]) * u + bz * bow);
    y.push(t.y[i0] + (t.y[i1] - t.y[i0]) * u);
    if (q) l.push(l[q - 1] + Math.hypot(x[q] - x[q - 1], z[q] - z[q - 1]));
  }
  return { x, z, y, l, from: i0, to: i1, s0: t.s[i0], s1: t.s[i1], width: 6 };
}
const cache = new Map<TrackId, Track>();
export function track(id: TrackId): Track {
  let t = cache.get(id);
  if (!t) {
    t = buildTrack(TRACKS.find((d) => d.id === id) ?? TRACKS[0]);
    cache.set(id, t);
  }
  return t;
}
/** Track position: segment index, how far along it, distance s and lateral offset d. */
export type Where = { i: number; f: number; s: number; d: number; y: number; dist: number };
/**
 * Where a point is on the track, searching only near the last known index (`hint`) so the
 * parts of the track that pass over each other (the garage spiral) never get mixed up.
 */
export function locate(t: Track, x: number, z: number, y: number, hint: number, span = 10): Where {
  let best: Where | null = null;
  for (let q = -span; q <= span; q++) {
    const i = (((hint + q) % t.n) + t.n) % t.n;
    const j = (i + 1) % t.n;
    const ex = t.x[j] - t.x[i],
      ez = t.z[j] - t.z[i];
    const len2 = ex * ex + ez * ez || 1;
    const f = clamp(((x - t.x[i]) * ex + (z - t.z[i]) * ez) / len2, 0, 1);
    const px = t.x[i] + ex * f,
      pz = t.z[i] + ez * f,
      py = t.y[i] + (t.y[j] - t.y[i]) * f;
    // Height only matters where the track passes over itself (the garage spiral).
    const dist = (x - px) ** 2 + (z - pz) ** 2 + 4 * Math.max(0, Math.abs(y - py) - 2.5) ** 2;
    if (!best || dist < best.dist) {
      const d = -(x - px) * t.tz[i] + (z - pz) * t.tx[i];
      best = { i, f, s: t.s[i] + (t.s[i + 1] - t.s[i]) * f, d, y: py, dist };
    }
  }
  return best!;
}
/** Same, over the whole track (used once at spawn). */
export function locateAll(t: Track, x: number, z: number, y: number): Where {
  let best = locate(t, x, z, y, 0, 0);
  for (let i = 0; i < t.n; i += 15) {
    const w = locate(t, x, z, y, i, 8);
    if (w.dist < best.dist) best = w;
  }
  return best;
}
/** World point on the track at distance s and lateral offset d. */
export function pointAt(t: Track, s: number, d = 0) {
  s = ((s % t.L) + t.L) % t.L;
  let lo = 0,
    hi = t.n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t.s[m] <= s) lo = m;
    else hi = m;
  }
  const i = lo,
    j = (i + 1) % t.n;
  const f = (s - t.s[i]) / (t.s[i + 1] - t.s[i] || 1);
  const x = t.x[i] + (t.x[j] - t.x[i]) * f,
    z = t.z[i] + (t.z[j] - t.z[i]) * f;
  return {
    i,
    x: x - t.tz[i] * d,
    z: z + t.tx[i] * d,
    y: t.y[i] + (t.y[j] - t.y[i]) * f,
    h: Math.atan2(t.tz[i], t.tx[i]),
    w: t.w[i],
  };
}
/** Index at distance s. */
export const indexAt = (t: Track, s: number) => pointAt(t, s).i;
/** Where a point is on the shortcut strip: u = 0..1 along it, d = lateral offset. */
export function onCut(c: Cut, x: number, z: number) {
  let best = { u: 0, d: 0, dist: Infinity };
  const N = c.x.length - 1;
  for (let q = 0; q < N; q++) {
    const ex = c.x[q + 1] - c.x[q],
      ez = c.z[q + 1] - c.z[q];
    const len2 = ex * ex + ez * ez || 1;
    const f = clamp(((x - c.x[q]) * ex + (z - c.z[q]) * ez) / len2, 0, 1);
    const px = c.x[q] + ex * f,
      pz = c.z[q] + ez * f;
    const dist = Math.hypot(x - px, z - pz);
    if (dist < best.dist) {
      const l = Math.sqrt(len2);
      const d = (-(x - px) * ez + (z - pz) * ex) / l;
      const along = c.l[q] + f * (c.l[q + 1] - c.l[q]);
      // Past either end, keep counting along the end segment's direction.
      const beyond =
        q === 0 && f === 0
          ? ((x - c.x[0]) * ex + (z - c.z[0]) * ez) / l
          : q === N - 1 && f === 1
            ? ((x - c.x[N]) * ex + (z - c.z[N]) * ez) / l
            : 0;
      best = { u: (along + beyond) / c.l[N], d, dist };
    }
  }
  return best;
}
/** Sector (0..SECTORS-1) of a distance along the lap. */
/** Distance past the start/finish line (0..L). */
export const lapS = (t: Track, s: number) => ((((s - t.S0) % t.L) + t.L) % t.L);
export const sectorOf = (t: Track, s: number) => Math.min(SECTORS - 1, Math.floor(lapS(t, s) / (t.L / SECTORS)));

/** Lap bookkeeping for one kart. */
export type LapState = { lap: number; sector: number };
/**
 * Move to a new sector. Only the next sector (or the one just behind, when reversing) is
 * accepted, so skipping part of the lap never counts. Crossing from the last sector into
 * sector 0 completes a lap; reversing over the line takes it back. Returns +1 on a new lap.
 */
export function passSector(l: LapState, sec: number): number {
  if (sec === l.sector) return 0;
  const next = (l.sector + 1) % SECTORS,
    prev = (l.sector - 1 + SECTORS) % SECTORS;
  if (sec === next) {
    l.sector = sec;
    if (sec === 0) {
      l.lap++;
      return 1;
    }
    return 0;
  }
  if (sec === prev) {
    if (l.sector === 0) l.lap--;
    l.sector = sec;
  }
  return 0;
}
/** Race distance used for placings: completed laps plus distance into the current lap. */
export function progressOf(t: Track, lap: number, s: number, sector: number) {
  s = lapS(t, s);
  // Behind the line before the first crossing (sector at the end of the lap): negative.
  const into = sector === SECTORS - 1 && s < t.L / SECTORS ? s + t.L : s;
  return (lap - 1) * t.L + into;
}
/**
 * Placings: finished karts by finish time, then everyone else by race distance (ties broken by
 * distance; exact ties keep grid order).
 */
export function placings<T extends { finished: number; progress: number; grid: number }>(rs: T[]): T[] {
  return rs.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finished - b.finished || a.grid - b.grid;
    if (a.finished || b.finished) return a.finished ? -1 : 1;
    return b.progress - a.progress || a.grid - b.grid;
  });
}
/** Race points by finishing place (8 karts). */
export const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

// ——————————————————————————— Karts and items ———————————————————————————

export type BodyId = "classic" | "paddle" | "roller";
/** Kart bodies: small stat differences only (1 = average). */
export const BODIES: { id: BodyId; name: string; note: string; speed: number; accel: number; handling: number; weight: number }[] = [
  { id: "classic", name: "Classic go-kart", note: "Balanced", speed: 1, accel: 1, handling: 1, weight: 1 },
  { id: "paddle", name: "Paddle cart", note: "Light and quick off the line", speed: 0.985, accel: 1.07, handling: 1.05, weight: 0.85 },
  { id: "roller", name: "Ball roller", note: "Heavy, a little faster flat out", speed: 1.025, accel: 0.93, handling: 0.95, weight: 1.25 },
];
export const bodyOf = (id: BodyId) => BODIES.find((b) => b.id === id) ?? BODIES[0];

export type ItemKind =
  | "dink"
  | "pinbowl"
  | "strike"
  | "guard"
  | "serve"
  | "fence"
  | "tape"
  | "sweet"
  | "net"
  | "cannon"
  | "wave"
  | "machine";
/** Sportle's own power-ups, themed on its sports. `uses`: taps per item. */
export const ITEMS: Record<ItemKind, { name: string; uses: number; note: string }> = {
  dink: { name: "Dink Shot", uses: 1, note: "Lob a pickleball forward (or back): it bounces twice and spins out who it hits" },
  pinbowl: { name: "Pin Bowl", uses: 1, note: "A bowling ball rolls straight down the track and knocks over anyone in its lane" },
  strike: { name: "Strike Bowl", uses: 1, note: "A giant ball follows the centre line through the leaders" },
  guard: { name: "Paddle Guard", uses: 1, note: "A spinning paddle bats away the next item. Flick the phone to send it back" },
  serve: { name: "Spin Serve", uses: 3, note: "Three fast curving pickleballs: tilt as you tap to bend them" },
  fence: { name: "Pin Fence", uses: 1, note: "Drops three pins behind you: karts that hit them wobble" },
  tape: { name: "Turbo Tape", uses: 3, note: "Three short speed boosts, one per tap" },
  sweet: { name: "Sweet Spot", uses: 1, note: "Glow for a few seconds: nothing knocks you over and boost pads are doubled" },
  net: { name: "Net Toss", uses: 1, note: "A net sticks to the kart ahead and slows it until its driver shakes free" },
  cannon: { name: "Comeback Cannon", uses: 1, note: "Fires you up the track to just behind the kart ahead" },
  wave: { name: "Crowd Wave", uses: 1, note: "A stadium wave bumps every kart ahead in range; you get a boost" },
  machine: { name: "Ball Machine", uses: 1, note: "A pitching machine fires pickleballs across the road for 6 s" },
};
export const ITEM_KINDS = Object.keys(ITEMS) as ItemKind[];
/**
 * Item odds by place (1 = leader). The leader mostly gets defensive items; karts near the
 * back get stronger catch-up items. Comeback Cannon only for the last two places.
 */
export function itemOdds(place: number, n: number): Record<ItemKind, number> {
  const w: Record<ItemKind, number> = Object.fromEntries(ITEM_KINDS.map((k) => [k, 0])) as Record<ItemKind, number>;
  if (n <= 1) {
    w.tape = 1;
    return w;
  }
  const p = (place - 1) / (n - 1); // 0 = leader … 1 = last
  if (p === 0) Object.assign(w, { guard: 30, fence: 25, dink: 30, serve: 10, pinbowl: 5 });
  else if (p < 0.4) Object.assign(w, { dink: 22, pinbowl: 18, guard: 12, fence: 12, serve: 16, tape: 12, net: 8 });
  else if (p < 0.75) Object.assign(w, { pinbowl: 14, serve: 14, tape: 20, net: 15, machine: 10, wave: 8, strike: 7, sweet: 6, dink: 6 });
  else Object.assign(w, { tape: 24, sweet: 13, wave: 13, strike: 12, net: 12, machine: 8, pinbowl: 6 });
  if (place >= n - 1) w.cannon = p === 1 ? 16 : 10;
  return w;
}
/** Draw an item for a place, with a random number 0..1. */
export function rollItem(place: number, n: number, r: number): ItemKind {
  const w = itemOdds(place, n);
  const total = ITEM_KINDS.reduce((a, k) => a + w[k], 0);
  let x = r * total;
  for (const k of ITEM_KINDS) {
    x -= w[k];
    if (x < 0 && w[k] > 0) return k;
  }
  return ITEM_KINDS.filter((k) => w[k] > 0).pop()!;
}
/** Effect lengths (s). Nothing takes away control for more than about 2 s. */
export const HIT = { spin: 1.0, tumble: 1.3, wobble: 0.7, net: 2.0, bump: 0.6, serve: 0.8, machine: 0.7 };
/** Drift charge thresholds (charge units ≈ seconds of drifting into the turn) and boosts. */
export const DRIFT_LEVELS = [1.0, 2.0, 3.0];
export const DRIFT_BOOST = [0.6, 1.0, 1.4];
export const driftLevel = (charge: number) => DRIFT_LEVELS.filter((c) => charge >= c).length;

export type KartPhase = "lobby" | "countdown" | "race" | "results" | "podium";
export type KartMode = "race" | "cup" | "trial";
export type BotLevel = "rookie" | "club" | "pro";
export const BOT_LEVELS: { id: BotLevel; name: string }[] = [
  { id: "rookie", name: "Rookie" },
  { id: "club", name: "Club" },
  { id: "pro", name: "Pro" },
];
/** Two cups of four tracks. */
export const CUPS: { id: string; name: string; tracks: TrackId[] }[] = [
  { id: "classic", name: "Classic Cup", tracks: ["court", "neon", "beach", "skyline"] },
  { id: "wild", name: "Wild Cup", tracks: ["frost", "jungle", "stadium", "canyon"] },
];
/** Every track id (single races and the track picker). */
export const CUP: TrackId[] = CUPS.flatMap((c) => c.tracks);
/** The cup a track belongs to. */
export const cupOf = (id: TrackId) => CUPS.findIndex((c) => c.tracks.includes(id));
/** Seconds a dropped phone's kart waits before a bot takes over. */
export const WAIT_LIMIT = 30;
export const COUNTDOWN = 3.6;

/** One kart as sent to screens and phones (numbers rounded). */
export type Racer = {
  id: string;
  name: string;
  outfit: Outfit;
  gear: Gear;
  body: BodyId;
  /** Paint colour index (PADDLES). */
  color: number;
  bot: "" | BotLevel;
  /** Screen this phone paired with ("" / "host" = the host screen). */
  display: string;
  connected: boolean;
  ready: boolean;
  /** Phone away: since when (server ms) its kart has been waiting; 0 = here. */
  away: number;
  /** A bot is driving for a missing phone. */
  botFor: boolean;
  grid: number;
  x: number;
  y: number;
  z: number;
  /** Heading (radians, 0 = +x; increasing = turning right, toward +z). */
  h: number;
  /** Extra visual yaw: drift slip and spin-outs. */
  yaw: number;
  /** Body roll for the picture (radians). */
  tilt: number;
  v: number;
  steer: number;
  /** -1 / 1 while drifting, 0 otherwise. */
  drift: number;
  charge: number;
  air: boolean;
  boost: number;
  item: ItemKind | "";
  uses: number;
  /** Item roulette running (seconds left). */
  rolling: number;
  /** Effects (seconds left). */
  spin: number;
  wobble: number;
  net: number;
  guard: number;
  sweet: number;
  lift: number;
  cannon: number;
  lap: number;
  sector: number;
  s: number;
  d: number;
  progress: number;
  place: number;
  /** Race time at the finish (s), 0 while racing. */
  finished: number;
  laps: number[];
  best: number;
  wrong: boolean;
  points: number;
  /** Last race's points (results board). */
  gained: number;
  /** Counters the screens turn into callouts. */
  tricks: number;
  boosts: number;
  hits: number;
};
export type Shot = {
  id: number;
  kind: ItemKind | "mball";
  x: number;
  y: number;
  z: number;
  h: number;
  owner: string;
  /** Size (m), for the giant Strike Bowl. */
  r: number;
};
export type Callout = { at: number; who: string; text: string; kind: string };
export type Kart = {
  game: "kart";
  mode: KartMode;
  track: TrackId;
  bot: BotLevel;
  items: boolean;
  phase: KartPhase;
  /** Race clock (s) and when the phase started. */
  time: number;
  phaseAt: number;
  /** Seconds since GO (negative in the countdown). */
  clock: number;
  racers: Racer[];
  shots: Shot[];
  /** Item cubes: s, d and whether each is there. */
  cubes: { s: number; d: number; up: boolean }[];
  /** Moving pins on Neon Lanes (lateral offsets now). */
  pins: number[];
  /** Which cup (CUPS index) and which race of it. */
  cup: number;
  cupRace: number;
  laps: number;
  paused: boolean;
  message: string;
  event: number;
  callouts: Callout[];
  /** Screen layout: split screen for local players or one shared leader view. */
  shared: boolean;
  seed: number;
};
export const BOT_NAMES = ["Orbit", "Nova", "Dash", "Pixel", "Comet", "Juno", "Echo", "Zuma", "Blip", "Tango"];

// ——————————————————————————— Phone: steering and gestures ———————————————————————————

/** World "up" in the phone's own axes, from a deviceorientation reading (W3C frame). */
export function upVector(alpha: number, beta: number, gamma: number): [number, number, number] {
  const { X, Y, Z } = deviceAxes(alpha, beta, gamma);
  return [X[2], Y[2], Z[2]];
}
/**
 * Wheel angle in degrees: where "up" points within the screen's plane. Turning the phone
 * like a wheel changes it one-for-one, whichever long edge is up, so both landscape grips
 * read the same. Counter-clockwise (wheel left) makes it larger.
 */
export const wheelAngle = (u: [number, number, number]) => (Math.atan2(u[0], u[1]) * 180) / Math.PI;
/** How far the screen leans back (top edge away from you), degrees. */
export const leanAngle = (u: [number, number, number]) => (Math.asin(clamp(u[2], -1, 1)) * 180) / Math.PI;
/** Which way up the phone is held: "left" = left edge up (rotated clockwise), "right" = right edge up. */
export const gripSide = (centerAngle: number): "left" | "right" =>
  wrap(centerAngle) > 0 ? "right" : "left";

export type SteerProfile = {
  /** Measured full turn each way (degrees of wheel angle). */
  left: number;
  right: number;
  /** +1 when wheel-left makes the wheel angle larger (spec behaviour); learned in setup. */
  sign: 1 | -1;
};
export const DEFAULT_STEER: SteerProfile = { left: 40, right: 40, sign: 1 };
export type Sensitivity = "gentle" | "normal" | "sharp";
export const SENSITIVITY: Record<Sensitivity, number> = { gentle: 0.8, normal: 1, sharp: 1.3 };
export const DEAD_ZONE = 0.06;
/** Learn the steering range from the setup's full left and full right turns. */
export function learnSteer(center: number, leftAngle: number, rightAngle: number):
  | { ok: true; profile: SteerProfile }
  | { ok: false; reason: string } {
  const l = wrap(leftAngle - center),
    r = wrap(rightAngle - center);
  if (Math.abs(l) < 12 || Math.abs(r) < 12) return { ok: false, reason: "Turn the phone further, like a steering wheel" };
  if (Math.sign(l) === Math.sign(r)) return { ok: false, reason: "Left and right turned the same way. Try again" };
  const sign = l > 0 ? 1 : -1;
  return { ok: true, profile: { left: Math.min(80, Math.abs(l)), right: Math.min(80, Math.abs(r)), sign } };
}
/**
 * Steering from the phone's tilt: centre and range from setup, a small dead zone, a gentle
 * response curve (small tilts = fine control, big tilts = full lock) and time-based smoothing
 * (same feel at 60 Hz and 120 Hz sensor rates). Output -1 (full left) .. +1 (full right).
 */
export class SteerReader {
  center = 0;
  lean0 = 0;
  profile: SteerProfile = { ...DEFAULT_STEER };
  sensitivity: Sensitivity = "normal";
  /** Smoothed output. */
  value = 0;
  /** Raw (unsmoothed) output of the last reading. */
  target = 0;
  angle = 0;
  lean = 0;
  at = -1;
  /** Smoothing time constant (ms). */
  tau = 45;
  /** Raw mapping: wheel angle → -1..1, no smoothing. */
  map(angle: number) {
    const delta = wrap(angle - this.center) * this.profile.sign; // + = turned left
    const range = (delta > 0 ? this.profile.left : this.profile.right) * 0.85;
    let x = clamp((-delta / Math.max(8, range)) * SENSITIVITY[this.sensitivity], -1, 1);
    const ax = Math.abs(x);
    if (ax <= DEAD_ZONE) return 0;
    const u = (ax - DEAD_ZONE) / (1 - DEAD_ZONE);
    // Gentle curve: fine control around the centre, full lock at the end of the range.
    x = Math.sign(x) * clamp(0.3 * u + 0.7 * u * u, 0, 1);
    return x;
  }
  /** Feed one orientation reading (world-up in device axes) at time `t` (ms). */
  feed(u: [number, number, number], t: number) {
    this.angle = wheelAngle(u);
    this.lean = leanAngle(u);
    this.target = this.map(this.angle);
    const dt = this.at < 0 ? 1000 / 60 : t - this.at;
    this.at = t;
    this.value += ease(dt, this.tau) * (this.target - this.value);
    if (Math.abs(this.value) < 0.002) this.value = 0;
    return this.value;
  }
  setCenter(u: [number, number, number]) {
    this.center = wheelAngle(u);
    this.lean0 = leanAngle(u);
    this.value = 0;
  }
  /** Tilt-to-drive: top edge away = gas (+), toward you = brake/reverse (-). */
  throttle() {
    const p = wrap(this.lean - this.lean0);
    if (Math.abs(p) < 5) return 0;
    return clamp((p - Math.sign(p) * 5) / 20, -1, 1);
  }
  /** Leaning toward you (for throwing items backwards). */
  pulledBack() {
    return wrap(this.lean - this.lean0) < -14;
  }
}
/**
 * Motion gestures on top of the buttons, strict enough that steering never triggers them:
 * - flick: a sharp upward jerk (≥ 13 m/s² along world-up for ≥ 2 readings within 0.12 s);
 * - shake: four or more hard jolts (≥ 15 m/s²) alternating direction within 0.9 s.
 * Steering is a rotation and moves the phone itself very little (a few m/s²).
 */
export class GestureReader {
  private ups: number[] = [];
  private jolts: { t: number; dir: number }[] = [];
  private lastFlick = -1e9;
  private lastShake = -1e9;
  feed(acc: [number, number, number], up: [number, number, number], t: number): "flick" | "shake" | null {
    const along = acc[0] * up[0] + acc[1] * up[1] + acc[2] * up[2];
    const mag = Math.hypot(acc[0], acc[1], acc[2]);
    this.ups = this.ups.filter((q) => t - q <= 120);
    if (along >= 13) this.ups.push(t);
    if (mag >= 15) {
      const dir = Math.sign(along) || Math.sign(acc[0] + acc[1]) || 1;
      const last = this.jolts[this.jolts.length - 1];
      if (!last || last.dir !== dir) this.jolts.push({ t, dir });
    }
    this.jolts = this.jolts.filter((q) => t - q.t <= 900);
    if (this.jolts.length >= 4 && t - this.lastShake > 500) {
      this.lastShake = t;
      this.jolts = [];
      this.ups = [];
      return "shake";
    }
    if (this.ups.length >= 2 && t - this.lastFlick > 600 && this.jolts.length < 3) {
      this.lastFlick = t;
      this.ups = [];
      return "flick";
    }
    return null;
  }
}
/** Width of a message on an LED board in pixel units (scene.ts pixel font). */
export function ledUnits(msg: string) {
  let u = 0;
  for (const c of msg) u += c === " " ? 3 : c === "I" ? 4 : c === ">" ? 5 : c === "|" || c === "!" ? 1.6 : 6;
  return u;
}
/** LED board width over the road at a gantry (metres). */
export const boardWidth = (t: Track, at: number) => {
  const p = pointAt(t, at * t.L, 0);
  return (p.w / 2 + t.def.verge + 1.2) * 2 + 0.5;
};
/** Pixel size so a message fits on a board with a margin (never larger than 0.16 m). */
export const ledSize = (msg: string, width: number) => Math.min(0.16, (width * 0.9) / Math.max(1, ledUnits(msg) + 1.5));
/**
 * Chase-camera safety: how far (0..1) along from the kart to the wanted eye position the camera
 * can go and stay over this part of the road (inside the barriers, above the road), so it never
 * ends up inside a wall, a rock face, a building or another level of the track.
 */
export function cameraReach(t: Track, s: number, from: number[], eye: number[]) {
  const hint = pointAt(t, s).i;
  for (let f = 1; f > 0.25; f -= 0.075) {
    const x = from[0] + (eye[0] - from[0]) * f,
      y = from[1] + (eye[1] - from[1]) * f,
      z = from[2] + (eye[2] - from[2]) * f;
    const w = locate(t, x, z, y, hint, 12);
    if (Math.abs(w.d) <= t.w[w.i] / 2 + t.def.verge - 0.3 && y >= w.y + 0.8) return f;
  }
  return 0.25;
}
/** Highest road near a point (for trackside cameras: stay above other levels and terrain). */
export function roadTop(t: Track, x: number, z: number, r = 24) {
  let top = -Infinity;
  for (let i = 0; i < t.n; i += 2) if ((t.x[i] - x) ** 2 + (t.z[i] - z) ** 2 < r * r) top = Math.max(top, t.y[i]);
  return top;
}
/** Ordinal place text: 1st, 2nd, 3rd, 4th… */
export const ordinal = (n: number) =>
  n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
