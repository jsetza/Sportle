/**
 * Bowling physics (server-authoritative). The ball slides on the oiled front of the lane,
 * hooks once it reaches the dry back third, then rolls. Pins are simulated on the deck as
 * standing circles that tip over into falling capsules, so pin-to-pin action (and splits,
 * messengers off the kickbacks, and pocket strikes) comes from collisions, not a lookup table.
 * A seeded random scatter on each pin contact makes the same bowl give a similar, not
 * identical, result. This is a game model, not a measurement of a real ball.
 */
import { LANE, PIN_SPOTS } from "../shared/bowling.ts";
import type { Ball, Pin } from "../shared/bowling.ts";
import { clamp } from "../shared/types.ts";

const G = 9.81;
const BALL_M = 6.4;
const PIN_M = 1.55;
/** Lateral speed a full hook can add (m/s). */
const HOOK_MAX = 0.6;
/** A pin hit harder than this (m/s) topples. */
const TOPPLE = 0.32;
const PIT = LANE.length + LANE.deck;

/** Deterministic RNG (mulberry32) stepping a seed kept in the game state. */
export function rng(s: { seed: number }) {
  s.seed = (s.seed + 0x6d2b79f5) | 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const freshPins = (): Pin[] =>
  PIN_SPOTS.map((p) => ({
    x: p.x,
    d: p.d,
    vx: 0,
    vd: 0,
    tilt: 0,
    tiltRate: 0,
    dir: 0,
    down: false,
    gone: false,
    wob: 0,
  }));
/** After a first ball: fallen pins are swept away; standing pins stay where they stand. */
export function sweepDeadwood(pins: Pin[]) {
  for (const p of pins) {
    if (p.down) p.gone = true;
    p.vx = p.vd = p.tiltRate = 0;
    p.wob = 0;
  }
}
export type Launch = {
  /** Release position across the lane (m). */
  x: number;
  /** Ball speed at release (m/s, game speed). */
  speed: number;
  /** Angle from straight down the lane (radians, + = toward +x). */
  angle: number;
  /** -1..1 (+ = breaks toward +x). */
  hook: number;
};
export function launch(l: Launch): Ball {
  return {
    x: clamp(l.x, -LANE.half + LANE.ballR, LANE.half - LANE.ballR),
    d: 0,
    y: LANE.ballR,
    vx: Math.sin(l.angle) * l.speed,
    vd: Math.cos(l.angle) * l.speed,
    phase: "skid",
    hook: clamp(l.hook, -1, 1),
    hookLeft: Math.abs(clamp(l.hook, -1, 1)) * HOOK_MAX,
    roll: 0,
  };
}
/** Friction available for hooking at a distance down the lane: oil in front, dry in back. */
const grip = (d: number) =>
  d < LANE.oil ? 0.012 : d < LANE.oil + 1.2 ? 0.012 + ((d - LANE.oil) / 1.2) * 0.15 : 0.162;
/** Move the ball one step along the lane (no pins). */
export function moveBall(b: Ball, dt: number) {
  if (b.phase === "pit") return;
  if (b.phase === "gutter") {
    b.vd = Math.max(1.5, b.vd - 0.3 * dt);
    b.d += b.vd * dt;
    b.roll += (b.vd / LANE.ballR) * dt;
    // Past the end of the pin deck the ball drops into the pit (it used to roll on at lane
    // height over the pit for 30 cm). Only the picture changes: no pins are in play there.
    if (b.d > PIT) b.y = Math.min(b.y, LANE.ballR - (b.d - PIT) * 1.2);
    if (b.d > PIT + 0.3) b.phase = "pit";
    return;
  }
  if (b.hookLeft > 0) {
    const a = grip(b.d) * G,
      dv = Math.min(b.hookLeft, a * dt);
    b.vx += Math.sign(b.hook) * dv;
    b.hookLeft -= dv;
    // Turning costs a little forward speed.
    b.vd -= dv * 0.12;
    b.phase = b.d < LANE.oil && b.hookLeft > HOOK_MAX * Math.abs(b.hook) * 0.8 ? "skid" : "hook";
  } else b.phase = "roll";
  b.vd = Math.max(0.6, b.vd - 0.012 * G * dt);
  b.x += b.vx * dt;
  b.d += b.vd * dt;
  b.roll += (Math.hypot(b.vx, b.vd) / LANE.ballR) * dt;
  // Off the edge of the lane (before the pin deck's end): into the gutter, out of play.
  if (Math.abs(b.x) > LANE.half && b.d < PIT) {
    b.phase = "gutter";
    b.x = Math.sign(b.x) * (LANE.half + LANE.gutter * 0.5);
    b.y = LANE.ballR - 0.07;
    b.vx = 0;
  }
  // Past the end of the pin deck the ball drops into the pit (it used to roll on at lane
  // height over the pit for 30 cm). Only the picture changes: no pins are in play there.
  if (b.d > PIT) b.y = Math.min(b.y, LANE.ballR - (b.d - PIT) * 1.2);
  if (b.d > PIT + 0.3) b.phase = "pit";
}
/** Closest points between segments p1–q1 and p2–q2 in 2D (x, d). */
function segClosest(
  p1: number[],
  q1: number[],
  p2: number[],
  q2: number[],
): { a: number[]; b: number[]; s: number; dist: number } {
  const d1 = [q1[0] - p1[0], q1[1] - p1[1]],
    d2 = [q2[0] - p2[0], q2[1] - p2[1]],
    r = [p1[0] - p2[0], p1[1] - p2[1]];
  const a = d1[0] * d1[0] + d1[1] * d1[1],
    e = d2[0] * d2[0] + d2[1] * d2[1],
    f = d2[0] * r[0] + d2[1] * r[1];
  let s = 0,
    t = 0;
  if (a < 1e-9 && e < 1e-9) {
    s = t = 0;
  } else if (a < 1e-9) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1[0] * r[0] + d1[1] * r[1];
    if (e < 1e-9) s = clamp(-c / a, 0, 1);
    else {
      const b = d1[0] * d2[0] + d1[1] * d2[1],
        den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const pa = [p1[0] + d1[0] * s, p1[1] + d1[1] * s],
    pb = [p2[0] + d2[0] * t, p2[1] + d2[1] * t];
  return { a: pa, b: pb, s, dist: Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) };
}
/** A pin's footprint on the deck: base to the top's shadow (a point while standing). */
function pinSeg(p: Pin) {
  const reach = LANE.pinH * 0.85 * Math.sin(p.tilt);
  return [
    [p.x, p.d],
    [p.x + Math.sin(p.dir) * reach, p.d + Math.cos(p.dir) * reach],
  ];
}
/** Velocity of a pin's body at a fraction `s` along its footprint (base + tipping top). */
function pinVel(p: Pin, s: number) {
  const reach = LANE.pinH * 0.85 * Math.cos(p.tilt) * p.tiltRate * s;
  return [p.vx + Math.sin(p.dir) * reach, p.vd + Math.cos(p.dir) * reach];
}
/** Give a pin a velocity change; a hard enough knock starts it falling. */
function knock(p: Pin, dvx: number, dvd: number, s: { seed: number }) {
  // Scatter: a little randomness in direction and strength.
  const ang = (rng(s) - 0.5) * 0.22,
    k = 0.9 + rng(s) * 0.2;
  const c = Math.cos(ang),
    sn = Math.sin(ang);
  const ax = (dvx * c + dvd * sn) * k,
    ad = (-dvx * sn + dvd * c) * k;
  p.vx += ax;
  p.vd += ad;
  const v = Math.hypot(p.vx, p.vd);
  if (!p.down && v > TOPPLE) {
    p.down = true;
    p.dir = Math.atan2(p.vx, p.vd);
    p.tiltRate = 5 + v * 3;
  } else if (!p.down) {
    // Wobbles but stays up: most of the push is absorbed.
    p.wob = Math.min(0.25, p.wob + v * 0.6);
    p.vx *= 0.15;
    p.vd *= 0.15;
  }
}
/** One physics step for the ball and pins. Returns the number of pin contacts this step. */
export function stepLane(
  b: Ball | null,
  pins: Pin[],
  dt: number,
  s: { seed: number },
): number {
  let contacts = 0;
  if (b) moveBall(b, dt);
  // Ball against pins (only while it's on the lane or the deck).
  if (b && b.phase !== "gutter" && b.phase !== "pit" && b.d > LANE.length - 0.6)
    for (const p of pins) {
      if (p.gone) continue;
      const [base, top] = pinSeg(p);
      const c = segClosest([b.x, b.d], [b.x, b.d], base, top);
      const r = LANE.ballR + (p.tilt > 0.8 ? 0.05 : LANE.pinR);
      if (c.dist >= r || c.dist < 1e-6) continue;
      const nx = (c.a[0] - c.b[0]) / c.dist,
        nd = (c.a[1] - c.b[1]) / c.dist;
      const pv = pinVel(p, 0.5);
      const rel = (b.vx - pv[0]) * nx + (b.vd - pv[1]) * nd;
      // Push apart.
      const over = r - c.dist;
      b.x += nx * over * (PIN_M / (BALL_M + PIN_M));
      b.d += nd * over * (PIN_M / (BALL_M + PIN_M));
      p.x -= nx * over * (BALL_M / (BALL_M + PIN_M));
      p.d -= nd * over * (BALL_M / (BALL_M + PIN_M));
      if (rel >= 0) continue;
      const j = (-(1 + 0.62) * rel) / (1 / BALL_M + 1 / PIN_M);
      b.vx += (j / BALL_M) * nx;
      b.vd += (j / BALL_M) * nd;
      knock(p, (-j / PIN_M) * nx, (-j / PIN_M) * nd, s);
      contacts++;
    }
  // Pins against pins.
  for (let i = 0; i < pins.length; i++) {
    const p = pins[i];
    if (p.gone) continue;
    for (let k = i + 1; k < pins.length; k++) {
      const q = pins[k];
      if (q.gone) continue;
      if (!p.down && !q.down) continue; // two standing pins never push each other
      const [pa, pb] = pinSeg(p),
        [qa, qb] = pinSeg(q);
      const c = segClosest(pa, pb, qa, qb);
      const r = (p.tilt > 0.8 ? 0.05 : LANE.pinR) + (q.tilt > 0.8 ? 0.05 : LANE.pinR);
      if (c.dist >= r || c.dist < 1e-6) continue;
      const nx = (c.a[0] - c.b[0]) / c.dist,
        nd = (c.a[1] - c.b[1]) / c.dist;
      const tq = segClosest(qa, qb, c.b, c.b).s;
      const vp = pinVel(p, c.s),
        vq = pinVel(q, tq);
      const rel = (vp[0] - vq[0]) * nx + (vp[1] - vq[1]) * nd;
      const over = (r - c.dist) / 2;
      p.x += nx * over;
      p.d += nd * over;
      q.x -= nx * over;
      q.d -= nd * over;
      if (rel >= 0) continue;
      const j = (-(1 + 0.5) * rel) / 2;
      knock(p, j * nx, j * nd, s);
      knock(q, -j * nx, -j * nd, s);
      // The striking pin loses some of its fall energy into the struck one.
      if (p.down) p.tiltRate *= 0.85;
      if (q.down) q.tiltRate *= 0.85;
      contacts++;
    }
  }
  // Pin motion: falling, sliding, kickbacks, the pit and the gutters.
  for (const p of pins) {
    if (p.gone) continue;
    p.wob *= Math.exp(-dt * 3);
    if (p.down && p.tilt < Math.PI / 2) {
      p.tiltRate += 9 * Math.sin(Math.max(0.15, p.tilt)) * dt;
      p.tilt = Math.min(Math.PI / 2, p.tilt + p.tiltRate * dt);
      if (p.tilt >= Math.PI / 2) p.tiltRate = 0;
    }
    const v = Math.hypot(p.vx, p.vd);
    if (v > 0) {
      const dec = (p.down ? (p.tilt >= Math.PI / 2 ? 3.2 : 1.2) : 8) * dt;
      const k = Math.max(0, v - dec) / v;
      p.vx *= k;
      p.vd *= k;
    }
    p.x += p.vx * dt;
    p.d += p.vd * dt;
    if (Math.abs(p.x) > LANE.wall - LANE.pinR) {
      p.x = Math.sign(p.x) * (LANE.wall - LANE.pinR);
      p.vx = -p.vx * 0.55;
      p.down = true;
      if (!p.tiltRate && p.tilt < Math.PI / 2) p.tiltRate = 6;
    }
    // A tipping pin's body stays inside the kickbacks too, not only its base: a pin falling
    // against a side wall ends up lying along it (its fall direction turns), so its top never
    // pokes through the wall. The base isn't moved, so the pin action is unchanged.
    if (p.down && p.tilt > 0) {
      const reach = LANE.pinH * 0.85 * Math.sin(p.tilt);
      const room = Math.max(0, LANE.wall - 0.05 - Math.abs(p.x));
      const side = Math.sin(p.dir) * reach;
      if (Math.sign(side) === Math.sign(p.x) && Math.abs(side) > room) {
        const sn = (Math.sign(side) * room) / reach;
        p.dir = Math.atan2(sn, (Math.cos(p.dir) >= 0 ? 1 : -1) * Math.sqrt(1 - sn * sn));
      }
    }
    // Off the deck into a gutter: down, and out of play once it settles there.
    if (Math.abs(p.x) > LANE.half + 0.03 && p.d > LANE.length - 0.3) {
      if (!p.down) {
        p.down = true;
        p.dir = Math.atan2(p.vx, p.vd);
        p.tiltRate = 6;
      }
    }
    if (p.d > PIT + 0.05) {
      p.down = true;
      p.gone = true;
    }
    if (p.d < LANE.length - 1.2) {
      p.vd = Math.abs(p.vd) * 0.4;
    }
  }
  return contacts;
}
/** Everything has come to rest (ball gone, pins still and fully fallen or upright). */
export function settled(b: Ball | null, pins: Pin[]) {
  if (b && b.phase !== "pit") return false;
  return pins.every(
    (p) =>
      p.gone ||
      (Math.hypot(p.vx, p.vd) < 0.03 &&
        (p.down ? p.tilt >= Math.PI / 2 : true) &&
        p.wob < 0.02),
  );
}
/** Simulate a whole bowl at 120 Hz with substeps (tests, bots' aiming). */
export function simulate(
  l: Launch,
  pins: Pin[] = freshPins(),
  s: { seed: number } = { seed: 1 },
  maxTime = 8,
) {
  const b = launch(l);
  let t = 0;
  const dt = 1 / 120,
    sub = 4;
  let atPins: number | null = null,
    gutter = false;
  while (t < maxTime) {
    for (let i = 0; i < sub; i++) stepLane(b, pins, dt / sub, s);
    if (atPins === null && b.d >= LANE.length) atPins = b.x;
    if (b.phase === "gutter") gutter = true;
    t += dt;
    if (t > 1 && settled(b, pins)) break;
  }
  const down = pins.filter((p) => p.down).length;
  return { ball: b, pins, down, atPins, gutter, time: t };
}
/** Points along a ball's path without pins (flat x,d pairs, rounded to cm), for the trail
 * preview: every ~0.9 m down the lane, ending at the pins or where it drops into a gutter. */
export function trace(l: Launch, step = 0.9) {
  const b = launch(l);
  const out = [r2(b.x), 0];
  let next = step;
  for (let i = 0; i < 2400 && b.d < LANE.length && b.phase !== "gutter"; i++) {
    moveBall(b, 1 / 240);
    if (b.d >= next || (b.phase as string) === "gutter") {
      out.push(r2(clamp(b.x, -LANE.half, LANE.half)), r2(b.d));
      next += step;
    }
  }
  if (b.phase !== "gutter") out.push(r2(b.x), r2(b.d));
  return out;
}
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Where a ball crosses the head pin's row, without pins (for aiming). */
export function pathAt(l: Launch, d = LANE.length) {
  const b = launch(l);
  for (let i = 0; i < 2400 && b.d < d && b.phase !== "gutter"; i++)
    moveBall(b, 1 / 240);
  return { x: b.x, gutter: b.phase === "gutter", vx: b.vx, vd: b.vd };
}
