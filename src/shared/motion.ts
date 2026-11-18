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
  calibrate() {
    this.neutral = { ...this.raw };
    this.angle = { pitch: 0, roll: 0, yaw: 0 };
    this.calibrated = true;
    this.armed = false;
    this.strength = 0;
  }
  orientation(alpha: number, beta: number, gamma: number, screenAngle: number) {
    const a = (screenAngle * Math.PI) / 180;
    this.raw = {
      pitch: beta * Math.cos(a) + gamma * Math.sin(a),
      roll: gamma * Math.cos(a) - beta * Math.sin(a),
      yaw: alpha,
    };
    for (const key of ["pitch", "roll", "yaw"] as const) {
      const v = wrap(this.raw[key] - this.neutral[key]);
      this.angle[key] += 0.28 * wrap(v - this.angle[key]);
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
    const energy = clamp((rate / 210 + force / 24) * this.sensitivity, 0, 1);
    this.strength = this.strength * 0.35 + energy * 0.65;
    this.rate = [rotation.alpha, rotation.beta, rotation.gamma];
    if (this.axes) {
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
      this.strength > 0.24 &&
      now - this.lastSwing > 320;
    if (swing) {
      this.lastSwing = now;
      this.armed = false;
    }
    return swing;
  }
}
