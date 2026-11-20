// Shot trails, contact effects and timing feedback (owner request).
// Everything here is additive glow geometry (drawn after the lit scene, then bloomed) plus the
// HTML timing callout / meter and rally counter. Purely cosmetic: the server decides every
// outcome, and the verdict shown is the server's (Match.timing).
import type { Timing, Vec } from "../shared/types.ts";
import { PERFECT_ZONE, clamp } from "../shared/types.ts";

type V = number[];
/** Writes one additive vertex: position, normal, colour, strength, soft-edge flag. */
export type Put = (p: V, n: V, c: V, strength: number, soft: number) => void;

export type TrailStyle = "fire" | "cool" | "plain";
type Burst = {
  kind: "ring" | "shock" | "ice" | "bolt" | "sparkle" | "bounce" | "groundring" | "confetti";
  x: number;
  y: number;
  z: number;
  at: number;
  life: number;
  col: V;
  size: number;
  seed: number;
};

const FIRE: V = [1, 0.55, 0.12];
const FIRE_CORE: V = [1, 0.9, 0.55];
const COOL: V = [0.35, 0.85, 1];
const COOL_CORE: V = [0.85, 0.97, 1];
const PLAIN: V = [1, 0.97, 0.75];
export const ORANGE: V = [1, 0.55, 0.12];

const sub = (a: V, b: V) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V, k: number) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V, b: V) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const rnd = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** Which trail a shot gets: fire for hard drives and smashes, cool for touch and backspin. */
export function trailFor(stroke: string, kmh: number): TrailStyle {
  if (stroke === "smash" || kmh >= 58) return "fire";
  if (/slice|chop|dink|drop|reset|block/.test(stroke)) return "cool";
  return "plain";
}

export class Effects {
  bursts: Burst[] = [];
  /** Rendered ball positions with times (s), newest last. */
  trail: { x: number; y: number; z: number; t: number }[] = [];
  style: TrailStyle = "plain";
  /** Trail length in seconds for the current shot (faster ball → longer streak). */
  span = 0.18;
  speed = 0;
  /** PERFECT celebration start (ms), for post effects. */
  perfectAt = -1e9;
  /** Strength of the latest camera punch and when it started (ms). */
  punch = 0;
  punchAt = -1e9;
  /** Hit-stop: freeze motion until this time (ms). */
  freezeUntil = 0;

  /** A paddle contact. `timing` is the server verdict when a human hit it. */
  contact(at: Vec, now: number, opts: {
    team: V;
    stroke: string;
    kmh: number;
    timing: Timing | null;
    local: boolean;
  }) {
    const { timing: t } = opts;
    this.style = trailFor(opts.stroke, opts.kmh);
    this.speed = opts.kmh;
    this.span = clamp(0.12 + (opts.kmh / 80) * 0.3, 0.14, 0.42);
    this.trail = this.trail.slice(-1);
    const seed = now % 1000;
    const ringCol = t
      ? t.kind === "perfect"
        ? ORANGE
        : t.kind === "good"
          ? [0.9, 0.95, 1]
          : [1, 0.25, 0.22]
      : opts.team;
    this.add("ring", at, now, 380, ringCol, t?.kind === "perfect" ? 1.3 : 1, seed);
    if (this.style === "fire") this.add("sparkle", at, now, 520, FIRE, 0.7, seed + 1);
    // Special effects tied to real shots.
    if (opts.stroke === "smash") this.add("bolt", at, now, 420, [1, 0.95, 0.55], 1, seed + 2);
    if (/slice|chop/.test(opts.stroke)) this.add("ice", at, now, 900, COOL, 1, seed + 3);
    if (t?.kind === "perfect") {
      this.add("shock", at, now, 520, ORANGE, 1, seed + 4);
      this.add("sparkle", at, now, 800, [1, 0.85, 0.5], 1.2, seed + 5);
      if (opts.local) {
        this.perfectAt = now;
        this.freezeUntil = now + 75;
      }
    }
    if (opts.local) {
      this.punch = t?.kind === "perfect" ? 1 : opts.kmh > 55 ? 0.5 : 0.25;
      this.punchAt = now;
    }
  }
  /** Confetti over the winning side: team colour, plus white and gold. Bigger for games/matches. */
  confetti(at: Vec, col: V, now: number, size: number) {
    this.add("confetti", { x: at.x, y: 2.2, z: at.z }, now, 2600 + size * 600, col, size, now % 991);
  }
  /** Ball touched the court: a fading ring where it landed. */
  bounce(at: Vec, now: number, out: boolean) {
    this.add(
      "bounce",
      { x: at.x, y: 0.03, z: at.z },
      now,
      900,
      out ? [1, 0.25, 0.2] : this.style === "cool" ? COOL : [1, 0.9, 0.7],
      1,
      now % 997,
    );
  }
  add(kind: Burst["kind"], at: Vec, now: number, life: number, col: V, size: number, seed: number) {
    this.bursts.push({ kind, x: at.x, y: at.y, z: at.z, at: now, life, col, size, seed });
    if (this.bursts.length > 28) this.bursts.shift();
  }
  /** Record where the ball is drawn this frame (once per frame, not per split-screen half). */
  track(ball: Vec | null, now: number) {
    if (!ball) {
      this.trail = [];
      return;
    }
    const last = this.trail[this.trail.length - 1];
    if (last && Math.hypot(last.x - ball.x, last.y - ball.y, last.z - ball.z) > 1.2)
      this.trail = []; // teleport: new serve or feed
    this.trail.push({ ...ball, t: now / 1000 });
    const cut = now / 1000 - this.span;
    while (this.trail.length > 2 && this.trail[0].t < cut) this.trail.shift();
    this.bursts = this.bursts.filter((b) => now - b.at < b.life);
  }
  /** Camera shake offset (m) and FOV kick (deg) for this frame. */
  shake(now: number) {
    const age = (now - this.punchAt) / 1000;
    if (age > 0.3) return { x: 0, y: 0, fov: 0 };
    const k = this.punch * (1 - age / 0.3) ** 2;
    return {
      x: Math.sin(now * 0.09) * 0.05 * k,
      y: Math.cos(now * 0.11) * 0.04 * k,
      fov: -4 * k * (this.punch >= 1 ? 1 : 0.4),
    };
  }
  /** Screen effects for a PERFECT hit by a player on this screen. */
  post(now: number) {
    const age = (now - this.perfectAt) / 1000;
    if (age > 0.55) return { rgbSplit: 0, speedLines: 0, flash: 0 };
    const k = 1 - age / 0.55;
    return { rgbSplit: k * 1.0, speedLines: k * k, flash: Math.max(0, 1 - age / 0.1) * 0.1 };
  }

  /** Build this view's glow geometry. `right`/`up` are the camera's screen axes. */
  build(put: Put, ball: Vec | null, eye: V, right: V, up: V, now: number) {
    const toEye = (p: V) => norm(sub(eye, p));
    // ——— ball glow and comet trail ———
    if (ball) {
      const fast = clamp((this.speed - 20) / 50, 0, 1);
      const glowCol =
        this.style === "fire" ? FIRE : this.style === "cool" ? COOL : [0.9, 1, 0.45];
      this.disc(put, [ball.x, ball.y, ball.z], 0.28 + fast * 0.12, glowCol, 0.5 + fast * 0.7, right, up);
      this.ribbon(put, eye, now);
    }
    // ——— bursts ———
    for (const b of this.bursts) {
      const k = (now - b.at) / b.life;
      if (k < 0 || k > 1) continue;
      const c: V = [b.x, b.y, b.z];
      if (b.kind === "ring") {
        const r = (0.18 + k * 0.75) * b.size;
        this.ring(put, c, r, 0.07 * (1 - k) + 0.02, b.col, 3.5 * (1 - k) ** 1.5, right, up);
      } else if (b.kind === "shock") {
        const r = (0.3 + k * 2.4) * b.size;
        this.ring(put, c, r, 0.18 * (1 - k) + 0.03, b.col, 4 * (1 - k) ** 2, right, up);
        this.ring(put, [b.x, 0.04, b.z], r * 1.2, 0.14, b.col, 2.2 * (1 - k) ** 2, [1, 0, 0], [0, 0, 1]);
      } else if (b.kind === "bounce" || b.kind === "groundring") {
        const r = 0.12 + k * 0.45;
        this.ring(put, c, r, 0.05, b.col, 2.2 * (1 - k) ** 1.4, [1, 0, 0], [0, 0, 1]);
        this.disc(put, c, 0.16, b.col, 0.8 * (1 - k), [1, 0, 0], [0, 0, 1]);
      } else if (b.kind === "sparkle") {
        const n = Math.round(14 * b.size);
        for (let i = 0; i < n; i++) {
          const s = b.seed + i * 7.13;
          const dir = norm([rnd(s) * 2 - 1, rnd(s + 1) * 1.4 - 0.2, rnd(s + 2) * 2 - 1]);
          const v = 1.6 + rnd(s + 3) * 2.4;
          const t = k * (b.life / 1000);
          const p = [
            c[0] + dir[0] * v * t,
            c[1] + dir[1] * v * t - 2.5 * t * t,
            c[2] + dir[2] * v * t,
          ];
          const tw = 0.5 + 0.5 * Math.sin(now * 0.04 + i);
          this.star(put, p, 0.06 * (1 - k) + 0.015, b.col, 5 * (1 - k) * tw, right, up);
        }
      } else if (b.kind === "bolt") {
        // Lightning sparks: jagged bolts that re-shape every ~45 ms.
        const flick = Math.floor(now / 45);
        for (let i = 0; i < 6; i++) {
          let p = c;
          const a = (i / 6) * Math.PI * 2 + b.seed;
          const dir = norm([Math.cos(a), 0.5 + rnd(b.seed + i) * 0.6, Math.sin(a)]);
          for (let j = 0; j < 5; j++) {
            const s = flick * 31 + i * 7 + j;
            const step = scale(norm(add(dir, [rnd(s) - 0.5, rnd(s + 1) - 0.5, rnd(s + 2) - 0.5])), 0.16 + k * 0.12);
            const q = add(p, step);
            this.beam(put, p, q, 0.025, b.col, 6 * (1 - k), eye);
            p = q;
          }
        }
        this.disc(put, c, 0.5, b.col, 1.5 * (1 - k), right, up);
      } else if (b.kind === "confetti") {
        // Paper squares bursting up, then fluttering down; they catch the light as they spin.
        const n = Math.round(110 * b.size);
        const t = k * (b.life / 1000);
        for (let i = 0; i < n; i++) {
          const s = b.seed + i * 5.31;
          const pick = rnd(s + 9);
          const col = pick < 0.6 ? b.col.map((c) => Math.min(1, c * 1.15 + 0.12)) : pick < 0.8 ? [1, 1, 1] : [1, 0.8, 0.3];
          const vx = (rnd(s) * 2 - 1) * 2.6 * b.size,
            vz = (rnd(s + 1) * 2 - 1) * 2.0 * b.size,
            vy = 2.5 + rnd(s + 2) * 3;
          // Rise quickly, then fall slowly (air drag) with a sideways flutter.
          const rise = Math.min(t, 0.35);
          const y =
            b.y + vy * rise - 4.9 * rise * rise - Math.max(0, t - 0.35) * (0.9 + rnd(s + 3) * 0.5);
          if (y < 0.02) continue;
          const drift = Math.min(t, 0.6);
          const p = [
            b.x + vx * drift + Math.sin(t * 6 + i) * 0.15,
            y,
            b.z + vz * drift + Math.cos(t * 5 + i) * 0.15,
          ];
          const spin = t * (5 + rnd(s + 4) * 7) + i;
          const u2 = [Math.cos(spin), Math.sin(spin * 0.7) * 0.5, Math.sin(spin)];
          const v2 = norm(cross(u2, [0.3, 1, 0.2]));
          const q = 0.09;
          const shine = 0.55 + 0.45 * Math.abs(Math.sin(spin * 1.3));
          const fade = 1 - clamp((k - 0.8) / 0.2, 0, 1);
          const c0 = scale(col, shine * fade);
          const a = add(p, add(scale(u2, q), scale(v2, q))),
            bb = add(p, add(scale(u2, -q), scale(v2, q))),
            cc = add(p, add(scale(u2, -q), scale(v2, -q))),
            dd = add(p, add(scale(u2, q), scale(v2, -q)));
          const nn = norm(cross(u2, v2));
          put(a, nn, c0, 1.8, 0);
          put(bb, nn, c0, 1.8, 0);
          put(cc, nn, c0, 1.8, 0);
          put(a, nn, c0, 1.8, 0);
          put(cc, nn, c0, 1.8, 0);
          put(dd, nn, c0, 1.8, 0);
        }
      } else if (b.kind === "ice") {
        // Ice-crystal burst: shards that shoot out and up, hold, then melt away.
        const grow = clamp(k / 0.18, 0, 1),
          fade = 1 - clamp((k - 0.5) / 0.5, 0, 1);
        for (let i = 0; i < 11; i++) {
          const s = b.seed + i * 3.7;
          const a = (i / 11) * Math.PI * 2 + rnd(s) * 0.5;
          const tilt = 0.35 + rnd(s + 1) * 0.7;
          const dir = norm([Math.cos(a) * tilt, 1, Math.sin(a) * tilt]);
          const len = (0.45 + rnd(s + 2) * 0.6) * grow;
          this.shard(put, c, dir, len, 0.07 + rnd(s + 3) * 0.05, COOL_CORE, COOL, 1.8 * fade, eye);
        }
        this.ring(put, [b.x, Math.max(0.04, b.y - 0.2), b.z], 0.3 + k * 0.6, 0.06, COOL, 2 * fade, [1, 0, 0], [0, 0, 1]);
      }
    }
    void toEye;
  }
  /** Comet ribbon behind the ball: wide and bright at the head, thin and dim at the tail. */
  ribbon(put: Put, eye: V, now: number) {
    const pts = this.trail;
    if (pts.length < 3) return;
    const head = pts[pts.length - 1].t,
      span = this.span;
    const [outer, core] =
      this.style === "fire"
        ? [FIRE, FIRE_CORE]
        : this.style === "cool"
          ? [COOL, COOL_CORE]
          : [PLAIN, [1, 1, 0.9]];
    const width = this.style === "fire" ? 0.15 : 0.1;
    const strength = this.style === "plain" ? 1.8 : 2.6;
    // A wide coloured halo, then a narrow hot core.
    this.strip(put, eye, outer, width, strength * 0.8, 1.3);
    this.strip(put, eye, core, width * 0.4, strength, 1.6);
    // Flicker of embers behind a fire ball.
    if (this.style === "fire")
      for (let i = 0; i < pts.length; i += 2) {
        const s = Math.floor(now / 60) + i;
        const p = pts[i];
        const k = clamp(1 - (head - p.t) / span, 0, 1);
        const j = [rnd(s) - 0.5, rnd(s + 1) - 0.5, rnd(s + 2) - 0.5];
        const at = [p.x + j[0] * 0.18, p.y + j[1] * 0.18 + (1 - k) * 0.12, p.z + j[2] * 0.18];
        const n = norm(sub(eye, at));
        const up = norm(cross(n, [1, 0, 0]));
        const rt = norm(cross(up, n));
        this.star(put, at, 0.03 + 0.03 * k, FIRE, 3 * k, rt, up);
      }
  }
  /** One camera-facing strip along the trail, fading (power `fall`) toward the tail. */
  strip(put: Put, eye: V, col: V, width: number, strength: number, fall: number) {
    const pts = this.trail,
      head = pts[pts.length - 1].t;
    const black = [0, 0, 0];
    let prev: { L: V; R: V; C: V; c: V } | null = null;
    for (let i = 0; i < pts.length; i++) {
      const p: V = [pts[i].x, pts[i].y, pts[i].z];
      const k = clamp(1 - (head - pts[i].t) / this.span, 0, 1); // 1 at the head
      const q = pts[Math.min(pts.length - 1, i + 1)],
        o = pts[Math.max(0, i - 1)];
      const tan = norm([q.x - o.x, q.y - o.y, q.z - o.z]);
      const side = norm(cross(tan, norm(sub(eye, p))));
      const w = width * (0.15 + 0.85 * k);
      const cur = { L: add(p, scale(side, w)), R: sub(p, scale(side, w)), C: p, c: scale(col, k ** fall) };
      if (prev) {
        const n = norm(sub(eye, p));
        for (const [e0, e1] of [
          [prev.L, cur.L],
          [prev.R, cur.R],
        ]) {
          put(e0, n, black, strength, 0);
          put(e1, n, black, strength, 0);
          put(cur.C, n, cur.c, strength, 0);
          put(e0, n, black, strength, 0);
          put(cur.C, n, cur.c, strength, 0);
          put(prev.C, n, prev.c, strength, 0);
        }
      }
      prev = cur;
    }
  }
  /** Soft round glow (fan with a black rim). */
  disc(put: Put, c: V, r: number, col: V, strength: number, u: V, v: V, n = 16) {
    if (strength <= 0.001) return;
    const nrm = norm(cross(u, v));
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2,
        a1 = ((i + 1) / n) * Math.PI * 2;
      const p0 = add(c, add(scale(u, Math.cos(a0) * r), scale(v, Math.sin(a0) * r)));
      const p1 = add(c, add(scale(u, Math.cos(a1) * r), scale(v, Math.sin(a1) * r)));
      put(c, nrm, col, strength, 0);
      put(p0, nrm, [0, 0, 0], strength, 0);
      put(p1, nrm, [0, 0, 0], strength, 0);
    }
  }
  /** Soft ring: black inner edge → colour → black outer edge. */
  ring(put: Put, c: V, r: number, w: number, col: V, strength: number, u: V, v: V, n = 32) {
    if (strength <= 0.001) return;
    const nrm = norm(cross(u, v));
    const at = (a: number, rr: number) =>
      add(c, add(scale(u, Math.cos(a) * rr), scale(v, Math.sin(a) * rr)));
    const black = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2,
        a1 = ((i + 1) / n) * Math.PI * 2;
      for (const [r0, c0, r1, c1] of [
        [r - w, black, r, col],
        [r, col, r + w, black],
      ] as [number, V, number, V][]) {
        put(at(a0, r0), nrm, c0, strength, 0);
        put(at(a1, r0), nrm, c0, strength, 0);
        put(at(a1, r1), nrm, c1, strength, 0);
        put(at(a0, r0), nrm, c0, strength, 0);
        put(at(a1, r1), nrm, c1, strength, 0);
        put(at(a0, r1), nrm, c1, strength, 0);
      }
    }
  }
  /** Four-point twinkle. */
  star(put: Put, c: V, r: number, col: V, strength: number, u: V, v: V) {
    if (strength <= 0.001) return;
    const n = norm(cross(u, v));
    for (const [a, b] of [
      [u, v],
      [v, u],
    ]) {
      const p0 = add(c, scale(a, r * 2.2)),
        p1 = sub(c, scale(a, r * 2.2)),
        q0 = add(c, scale(b, r * 0.35)),
        q1 = sub(c, scale(b, r * 0.35));
      put(p0, n, [0, 0, 0], strength, 0);
      put(q0, n, col, strength, 0);
      put(c, n, col, strength, 0);
      put(p0, n, [0, 0, 0], strength, 0);
      put(c, n, col, strength, 0);
      put(q1, n, col, strength, 0);
      put(p1, n, [0, 0, 0], strength, 0);
      put(q0, n, col, strength, 0);
      put(c, n, col, strength, 0);
      put(p1, n, [0, 0, 0], strength, 0);
      put(c, n, col, strength, 0);
      put(q1, n, col, strength, 0);
    }
    this.disc(put, c, r * 1.2, col, strength * 0.6, u, v, 8);
  }
  /** Camera-facing line segment (lightning). */
  beam(put: Put, a: V, b: V, w: number, col: V, strength: number, eye: V) {
    const d = norm(sub(b, a));
    const s = scale(norm(cross(d, norm(sub(eye, a)))), w);
    const n = norm(sub(eye, a));
    const black = [0, 0, 0];
    for (const [x0, c0, x1, c1] of [
      [scale(s, -1), black, [0, 0, 0], col],
      [[0, 0, 0], col, s, black],
    ] as [V, V, V, V][]) {
      put(add(a, x0), n, c0, strength, 0);
      put(add(b, x0), n, c0, strength, 0);
      put(add(b, x1), n, c1, strength, 0);
      put(add(a, x0), n, c0, strength, 0);
      put(add(b, x1), n, c1, strength, 0);
      put(add(a, x1), n, c1, strength, 0);
    }
  }
  /** Ice shard: a long four-sided crystal from `base` along `dir`. */
  shard(put: Put, base: V, dir: V, len: number, w: number, tip: V, col: V, strength: number, eye: V) {
    if (len < 0.01 || strength <= 0.001) return;
    const u = norm(cross(dir, Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])),
      v = cross(dir, u);
    const mid = add(base, scale(dir, len * 0.3));
    const top = add(base, scale(dir, len));
    const corners = [u, v, scale(u, -1), scale(v, -1)].map((e) => add(mid, scale(e, w)));
    for (let i = 0; i < 4; i++) {
      const a = corners[i],
        b = corners[(i + 1) % 4];
      const n = norm(cross(sub(b, a), sub(top, a)));
      put(a, n, col, strength, 1);
      put(b, n, col, strength, 1);
      put(top, n, tip, strength, 1);
      put(base, n, scale(col, 0.4), strength, 1);
      put(b, n, col, strength, 1);
      put(a, n, col, strength, 1);
    }
    void eye;
  }
}

// ——— timing callout, EARLY ↔ LATE meter, rally counter (HTML over the canvas) ———
const WORD: Record<Timing["kind"], string> = {
  perfect: "PERFECT",
  good: "GOOD",
  early: "EARLY",
  late: "LATE",
};
/** Position the meter's sweet-spot zone and needle (set from script: the page's CSP blocks
 * inline style attributes). */
export function placeMeter(el: HTMLElement, t: Timing) {
  const zone = el.querySelector<HTMLElement>(".tzone"),
    needle = el.querySelector<HTMLElement>(".tneedle");
  const z = PERFECT_ZONE * 50;
  if (zone) {
    zone.style.left = 50 - z + "%";
    zone.style.width = z * 2 + "%";
  }
  if (needle) needle.style.left = (((clamp(t.offset, -1, 1) + 1) / 2) * 100).toFixed(1) + "%";
}
export function calloutHtml(t: Timing) {
  const shot = t.stroke.replace("pop-up", "pop-up").toUpperCase();
  const why =
    t.why === "popup" ? "POPPED UP" : t.why === "net" ? "INTO THE NET" : "";
  return `<div class="callout-name">${WORD[t.kind]} ${shot}</div>${
    why ? `<div class="callout-why"><i></i>${why}</div>` : ""
  }<div class="tmeter"><div class="tbar"><i class="tzone"></i><b class="tneedle"></b></div><div class="tlabels"><span>EARLY</span><span class="tkmh">${t.kmh} KM/H</span><span>LATE</span></div></div>`;
}
