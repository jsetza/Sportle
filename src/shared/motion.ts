import { SWING_RELOAD } from "./types.ts";
import { clamp } from "./types.ts";
export const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
// Relative Euler angles are intentional: orientation intent, never position tracking.
export type Vec3 = [number, number, number];
const vlen = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const vdot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vunit = (v: Vec3): Vec3 => {
  const l = vlen(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** Rotation-rate directions learned from the player's own test swings (device frame). */
export type SwingAxes = { side: Vec3; up: Vec3 };
export type TestSwings = { right: Vec3; left: Vec3; up: Vec3; down: Vec3 };
/**
 * Learn left/right and up/down from four test swings, whatever the grip (screen forward or
 * back, portrait or tilted). Each test swing is the raw rotation-rate vector at the swing's
 * peak. Checks that opposite swings really are opposite and that the two pairs differ.
 */
export function learnAxes(
  t: TestSwings,
):
  | { ok: true; axes: SwingAxes }
  | { ok: false; redo: (keyof TestSwings)[]; reason: string } {
  const weak = (Object.keys(t) as (keyof TestSwings)[]).filter(
    (k) => vlen(t[k]) < 60,
  );
  if (weak.length)
    return { ok: false, redo: weak, reason: "A swing was too small to read." };
  const cos = (a: Vec3, b: Vec3) => vdot(a, b) / (vlen(a) * vlen(b));
  if (cos(t.right, t.left) > -0.25)
    return {
      ok: false,
      redo: ["right", "left"],
      reason: "Right and left didn't read as opposite swings.",
    };
  if (cos(t.up, t.down) > -0.25)
    return {
      ok: false,
      redo: ["up", "down"],
      reason: "Up and down didn't read as opposite swings.",
    };
  const side = vunit([
    t.right[0] - t.left[0],
    t.right[1] - t.left[1],
    t.right[2] - t.left[2],
  ]);
  const up = vunit([
    t.up[0] - t.down[0],
    t.up[1] - t.down[1],
    t.up[2] - t.down[2],
  ]);
  if (Math.abs(vdot(side, up)) > 0.75)
    return {
      ok: false,
      redo: ["right", "left", "up", "down"],
      reason: "Side-to-side and up-down swings looked too similar.",
    };
  // Final check: every recorded swing must read as its own direction on the learned axes.
  const wrong = (
    [
      ["right", vdot(t.right, side) > 0],
      ["left", vdot(t.left, side) < 0],
      ["up", vdot(t.up, up) > 0],
      ["down", vdot(t.down, up) < 0],
    ] as [keyof TestSwings, boolean][]
  )
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  if (wrong.length)
    return {
      ok: false,
      redo: wrong,
      reason: "A swing didn't match its direction.",
    };
  return { ok: true, axes: { side, up } };
}
/** Rotation speed (rad/s) below which nothing registers as swing effort. */
export const SWING_FLOOR = 3;
/** Extra rad/s above the floor for a 100% swing. */
export const SWING_SPAN = 13;
/** Swing strength needed to count as a swing (≈ 6 rad/s at the default feel). */
export const SWING_TRIGGER = 0.24;
/** Rotation speed (rad/s) at which a swing starts to count, for the setup gauge. */
export const swingThreshold = (sensitivity = 1) =>
  SWING_FLOOR + (SWING_TRIGGER / sensitivity) * SWING_SPAN;
/**
 * Smoothing factor for a reading that arrived dtMs after the last one, so smoothing takes the
 * same time on every phone: sensor events come at ~60 Hz on most phones but up to 200 Hz on
 * some Android ones, and a fixed per-event factor made those feel twitchier.
 */
export const ease = (dtMs: number, tauMs: number) =>
  1 - Math.exp(-clamp(dtMs, 1, 100) / tauMs);
const tauFor = (perEventAt60Hz: number) =>
  -(1000 / 60) / Math.log(1 - perEventAt60Hz);
/** Same feel as the old per-event factors at 60 Hz. */
const TAU = { strength: tauFor(0.65), pose: tauFor(0.4), angle: tauFor(0.28) };
export class MotionFilter {
  /** Learned from the movement test; null until then (fallback formulas are used). */
  axes: SwingAxes | null = null;
  /** Raw rotation-rate vector at this swing's peak, for the movement test. */
  peakVec: Vec3 = [0, 0, 0];
  rate: Vec3 = [0, 0, 0];
  neutral = { pitch: 0, roll: 0, yaw: 0 };
  angle = { pitch: 0, roll: 0, yaw: 0 };
  raw = { pitch: 0, roll: 0, yaw: 0 };
  strength = 0;
  direction = 0;
  /**
   * Sideways swing direction in the player's own frame: +1 = moving toward their right,
   * -1 = toward their left. From the rotation rate about the phone's long axis while it is
   * held like a paddle (screen = paddle face). `flip` lets a player swap it if their grip
   * reports it reversed. An intent estimate, not a measured paddle path.
   */
  side = 0;
  flip = 1;
  lastSwing = -1000;
  armed = true;
  calibrated = false;
  sensitivity = 1;
  hand = 1;
  /** "Toward the screen" from setup step 02; when set, angles and swing paths are screen-relative. */
  fwd: [number, number] | null = null;
  sideSign = 1;
  faceSign = 1;
  /** 1 = forehand side (screen toward the TV), -1 = backhand side; keeps its last clear value. */
  face = 1;
  abs = { alpha: 0, beta: 0, gamma: 0 };
  path = { side: 0, up: 0, rad: 0 };
  /** Rotation speed (rad/s) of the latest motion reading. */
  rad = 0;
  private motionAt = -1;
  private orientAt = -1;
  /** Set "toward the screen" (phone flat, top edge at the screen). Returns false if not flat. */
  aim() {
    const f = aimFrom(this.abs.alpha, this.abs.beta, this.abs.gamma);
    if (!f) return false;
    this.fwd = f;
    this.calibrated = true;
    this.armed = false;
    this.strength = 0;
    return true;
  }
  calibrate() {
    this.neutral = { ...this.raw };
    this.angle = { pitch: 0, roll: 0, yaw: 0 };
    this.calibrated = true;
    this.armed = false;
    this.strength = 0;
  }
  orientation(
    alpha: number,
    beta: number,
    gamma: number,
    screenAngle: number,
    now?: number,
  ) {
    this.abs = { alpha, beta, gamma };
    const dt =
      now === undefined || this.orientAt < 0 ? 1000 / 60 : now - this.orientAt;
    if (now !== undefined) this.orientAt = now;
    if (this.fwd) {
      const p = paddlePose(alpha, beta, gamma, this.fwd, this.faceSign);
      const k = ease(dt, TAU.pose);
      for (const key of ["pitch", "roll", "yaw"] as const)
        this.angle[key] += k * wrap(p[key] - this.angle[key]);
      if (p.face) this.face = p.face;
      return;
    }
    const a = (screenAngle * Math.PI) / 180;
    this.raw = {
      pitch: beta * Math.cos(a) + gamma * Math.sin(a),
      roll: gamma * Math.cos(a) - beta * Math.sin(a),
      yaw: alpha,
    };
    const k = ease(dt, TAU.angle);
    for (const key of ["pitch", "roll", "yaw"] as const) {
      const v = wrap(this.raw[key] - this.neutral[key]);
      this.angle[key] += k * wrap(v - this.angle[key]);
      if (Math.abs(this.angle[key]) < 1.5) this.angle[key] = 0;
    }
  }
  motion(
    acc: { x: number; y: number; z: number },
    rotation: { alpha: number; beta: number; gamma: number },
    screenAngle: number,
    now: number,
  ) {
    const a = (screenAngle * Math.PI) / 180;
    const rate = Math.hypot(rotation.alpha, rotation.beta, rotation.gamma);
    const force = Math.hypot(acc.x, acc.y, acc.z);
    // Owner request: swings take real effort. Rotation speed in rad/s drives it: nothing below
    // SWING_FLOOR, a swing counts from ~6 rad/s, and full power needs ~16 rad/s (a hard swing).
    const rad = (rate * Math.PI) / 180;
    const energy = clamp(
      ((rad - SWING_FLOOR) / SWING_SPAN + force / 90) * this.sensitivity,
      0,
      1,
    );
    const dt = this.motionAt < 0 ? 1000 / 60 : now - this.motionAt;
    this.motionAt = now;
    this.rad = rad;
    this.strength += ease(dt, TAU.strength) * (energy - this.strength);
    this.rate = [rotation.alpha, rotation.beta, rotation.gamma];
    if (this.fwd) {
      // Screen-relative swing path (setup steps 02–04).
      const { alpha, beta, gamma } = this.abs;
      this.path = swingPath(rotation, alpha, beta, gamma, this.fwd);
      this.direction = clamp(this.path.up * 1.5, -1, 1);
      this.side = clamp(this.path.side * 1.5 * this.sideSign, -1, 1);
    } else if (this.axes) {
      // Project onto the directions learned from this player's own test swings.
      this.direction = clamp(vdot(this.rate, this.axes.up) / 130, -1, 1);
      this.side = clamp(vdot(this.rate, this.axes.side) / 150, -1, 1);
    } else {
      this.direction = clamp(
        (rotation.beta * Math.cos(a) + rotation.gamma * Math.sin(a)) / 130,
        -1,
        1,
      );
      this.side = clamp(
        ((rotation.gamma * Math.cos(a) - rotation.beta * Math.sin(a)) / 150) *
          this.flip,
        -1,
        1,
      );
    }
    if (this.strength < 0.12) this.armed = true;
    const swing =
      this.calibrated &&
      this.armed &&
      this.strength > SWING_TRIGGER &&
      now - this.lastSwing > SWING_RELOAD * 1000;
    if (swing) {
      this.lastSwing = now;
      this.armed = false;
    }
    return swing;
  }
}

// ——— Screen-relative paddle pose ———
// Step 02 of the phone setup records which horizontal direction points at the screen. With
// that, the phone's own orientation gives the paddle face angle and which side of the phone
// faces the TV, and the rotation rate gives the swing path. These are orientation and
// rotation readings turned into intent, not a measured paddle position.

/** World axes (x east, y north, z up) of the device's x, y (top edge) and z (screen) axes. */
export function deviceAxes(alpha: number, beta: number, gamma: number) {
  const r = Math.PI / 180;
  const cA = Math.cos(alpha * r),
    sA = Math.sin(alpha * r),
    cB = Math.cos(beta * r),
    sB = Math.sin(beta * r),
    cG = Math.cos(gamma * r),
    sG = Math.sin(gamma * r);
  // W3C DeviceOrientation: R = Rz(alpha) · Rx(beta) · Ry(gamma); columns are the device axes.
  const X: Vec3 = [cA * cG - sA * sB * sG, cG * sA + cA * sB * sG, -cB * sG];
  const Y: Vec3 = [-cB * sA, cA * cB, sB];
  const Z: Vec3 = [cG * sA * sB + cA * sG, sA * sG - cA * cG * sB, cB * cG];
  return { X, Y, Z };
}
/**
 * "Toward the screen" from the phone held flat like a TV remote, top edge pointing at the
 * screen: the horizontal direction of the top edge. Null if the phone isn't roughly flat.
 */
export function aimFrom(
  alpha: number,
  beta: number,
  gamma: number,
): [number, number] | null {
  const { Y, Z } = deviceAxes(alpha, beta, gamma);
  const h = Math.hypot(Y[0], Y[1]);
  if (h >= 0.5) return [Y[0] / h, Y[1] / h];
  // Held upright instead (like a paddle, screen toward the TV): the screen points at the TV.
  const hz = Math.hypot(Z[0], Z[1]);
  if (hz >= 0.5) return [Z[0] / hz, Z[1] / hz];
  return null;
}
/** Screen-relative frame: forward (to the TV), right, up. */
const frame = (fwd: [number, number]) => ({
  F: [fwd[0], fwd[1], 0] as Vec3,
  R: [fwd[1], -fwd[0], 0] as Vec3,
  U: [0, 0, 1] as Vec3,
});
export type PaddlePose = {
  /** Hitting-face tilt: + open (facing up), − closed (facing down), degrees. */
  pitch: number;
  /** Paddle turned to the right (+) or left (−) of the screen, degrees. */
  yaw: number;
  /** Paddle head leaning right (+) / left (−) from upright, degrees. */
  roll: number;
  /** 1 = screen toward the TV (forehand), -1 = back toward the TV (backhand), 0 = edge-on. */
  face: number;
};
export function paddlePose(
  alpha: number,
  beta: number,
  gamma: number,
  fwd: [number, number],
  faceSign = 1,
): PaddlePose {
  const { Y, Z } = deviceAxes(alpha, beta, gamma);
  const { F, R, U } = frame(fwd);
  const toward = vdot(Z, F) * faceSign;
  const face = toward > 0.25 ? 1 : toward < -0.25 ? -1 : 0;
  // The hitting face is whichever side of the phone points toward the TV.
  const s = face === -1 ? -1 : 1;
  const H: Vec3 = [
    Z[0] * s * faceSign,
    Z[1] * s * faceSign,
    Z[2] * s * faceSign,
  ];
  const deg = 180 / Math.PI;
  return {
    pitch: Math.asin(clamp(vdot(H, U), -1, 1)) * deg,
    yaw: Math.atan2(vdot(H, R), vdot(H, F)) * deg,
    roll: Math.atan2(vdot(Y, R), vdot(Y, U)) * deg,
    face,
  };
}
/**
 * Swing path from the rotation rate (deg/s, device axes: beta = x, gamma = y, alpha = z):
 * the velocity of a point in front of the player, ω × forward, split into right and up.
 * Returns unit-ish components and the rotation speed in rad/s.
 */
export function swingPath(
  rate: { alpha: number; beta: number; gamma: number },
  alpha: number,
  beta: number,
  gamma: number,
  fwd: [number, number],
) {
  const { X, Y, Z } = deviceAxes(alpha, beta, gamma);
  const w: Vec3 = [
    X[0] * rate.beta + Y[0] * rate.gamma + Z[0] * rate.alpha,
    X[1] * rate.beta + Y[1] * rate.gamma + Z[1] * rate.alpha,
    X[2] * rate.beta + Y[2] * rate.gamma + Z[2] * rate.alpha,
  ];
  const { F, R, U } = frame(fwd);
  const v: Vec3 = [
    w[1] * F[2] - w[2] * F[1],
    w[2] * F[0] - w[0] * F[2],
    w[0] * F[1] - w[1] * F[0],
  ];
  const speed = Math.hypot(rate.alpha, rate.beta, rate.gamma);
  const n = Math.max(vlen(v), speed * 0.35, 1);
  return {
    side: vdot(v, R) / n,
    up: vdot(v, U) / n,
    rad: (speed * Math.PI) / 180,
  };
}
/** One recorded setup swing. */
export type SetupSwing = {
  side: number;
  up: number;
  rad: number;
  face: number;
};
export type SwingProfile = {
  /** +1 or -1: corrects the left/right sign if this phone reads it reversed. */
  sideSign: number;
  /** +1 or -1: corrects which phone side counts as the forehand face. */
  faceSign: number;
  /** Swing feel: a typical setup swing becomes a medium (~60%) shot. */
  sensitivity: number;
  /** Typical swing speed (rad/s), for the gauge. */
  typical: number;
};
/**
 * Learn from three forehands and three backhands (setup steps 03–04).
 * Forehands swing across the body toward the non-paddle side; backhands the other way.
 */
export function learnSwings(
  fore: SetupSwing[],
  back: SetupSwing[],
  hand: "left" | "right",
):
  | { ok: true; profile: SwingProfile }
  | { ok: false; redo: "fore" | "back" | "both"; reason: string } {
  if (fore.length < 3)
    return { ok: false, redo: "fore", reason: "Three forehands, please." };
  if (back.length < 3)
    return { ok: false, redo: "back", reason: "Three backhands, please." };
  // Robust to an odd swing: count which way most swings went instead of averaging.
  const vote = (a: number[]) => a.reduce((s, v) => s + Math.sign(v), 0);
  const fs = vote(fore.map((s) => s.side)),
    bs = vote(back.map((s) => s.side));
  // Right hand: forehands go right→left (side < 0), backhands left→right (side > 0).
  const want = hand === "left" ? -1 : 1;
  // Unclear (both ways the same)? Keep the standard sign rather than asking for a redo.
  const gap = bs - fs === 0 ? 1 : Math.sign(bs - fs) * want;
  const ff = vote(fore.map((s) => s.face)),
    bf = vote(back.map((s) => s.face));
  const speeds = [...fore, ...back].map((s) => s.rad).sort((a, b) => a - b);
  const typical = (speeds[2] + speeds[3]) / 2;
  return {
    ok: true,
    profile: {
      sideSign: gap > 0 ? 1 : -1,
      // Standard unless the forehands clearly read as the other face.
      faceSign: ff < bf ? -1 : 1,
      // Owner request: everyone swings with effort — no "soft swing" feel is learned.
      sensitivity: 1,
      typical,
    },
  };
}

// ——— Reading a swing at its peak ———
// A swing is noticed as soon as it crosses the trigger speed, but the shot is read where the
// swing is fastest: power from the peak, direction from the fast part of the swing
// (not one noisy reading) and the face angle at that moment. The same effort then gives the
// same shot whatever the phone's sensor rate or how quickly the swing built up.

/** A swing is read at least this long after it's noticed (ms)… */
export const SWING_MIN_MS = 30;
/** …and sent once it has clearly peaked, or after this long at most (ms). */
export const SWING_MAX_MS = 85;
export type SwingSample = {
  t: number;
  rad: number;
  strength: number;
  direction: number;
  side: number;
  path: { side: number; up: number };
  face: number;
  pitch: number;
  roll: number;
  yaw: number;
};
export type SwingShot = Omit<SwingSample, "t">;
/** Snapshot of the filter for the swing reader. */
export const sampleOf = (f: MotionFilter, t: number): SwingSample => ({
  t,
  rad: f.rad,
  strength: f.strength,
  direction: f.direction,
  side: f.side,
  path: { side: f.path.side, up: f.path.up },
  face: f.face,
  pitch: f.angle.pitch,
  roll: f.angle.roll,
  yaw: f.angle.yaw,
});
export class SwingCapture {
  private samples: SwingSample[] = [];
  private startAt = -1;
  private minMs = SWING_MIN_MS;
  private maxMs = SWING_MAX_MS;
  private peaked = false;
  get active() {
    return this.startAt >= 0;
  }
  /** Start reading a swing; setup uses one fixed window so backswing + swing count once. */
  start(t: number, minMs = SWING_MIN_MS, maxMs = SWING_MAX_MS) {
    this.samples = [];
    this.startAt = t;
    this.minMs = minMs;
    this.maxMs = maxMs;
    this.peaked = false;
  }
  add(x: SwingSample) {
    if (!this.active) return;
    this.samples.push(x);
    const top = Math.max(...this.samples.map((q) => q.rad));
    // Slowing down from its fastest point: the swing has peaked.
    if (x.rad < top * 0.93) this.peaked = true;
  }
  ready(t: number) {
    const age = t - this.startAt;
    return (
      this.active && age >= this.minMs && (this.peaked || age >= this.maxMs)
    );
  }
  cancel() {
    this.startAt = -1;
    this.samples = [];
  }
  finish(): SwingShot {
    const all = this.samples;
    this.cancel();
    if (!all.length)
      return {
        rad: 0,
        strength: SWING_TRIGGER,
        direction: 0,
        side: 0,
        path: { side: 0, up: 0 },
        face: 1,
        pitch: 0,
        roll: 0,
        yaw: 0,
      };
    const peak = all.reduce((a, q) => (q.rad > a.rad ? q : a));
    // The fast part of the swing (readings at 60%+ of the peak speed); the median ignores a
    // single odd reading.
    const core = all.filter((q) => q.rad >= peak.rad * 0.6);
    const avg = (get: (q: SwingSample) => number) => {
      const v = core.map(get).sort((a, b) => a - b),
        m = v.length >> 1;
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    return {
      rad: peak.rad,
      strength: Math.max(...all.map((q) => q.strength)),
      direction: avg((q) => q.direction),
      side: avg((q) => q.side),
      path: peak.path,
      face: peak.face,
      pitch: peak.pitch,
      roll: peak.roll,
      yaw: peak.yaw,
    };
  }
}
