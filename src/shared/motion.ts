import { clamp } from "./types.ts";
export const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180;
// Relative Euler angles are intentional: orientation intent, never position tracking.
export class MotionFilter {
  neutral = { pitch: 0, roll: 0, yaw: 0 };
  angle = { pitch: 0, roll: 0, yaw: 0 };
  raw = { pitch: 0, roll: 0, yaw: 0 };
  strength = 0;
  direction = 0;
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
    this.direction = clamp(
      (rotation.beta * Math.cos(a) + rotation.gamma * Math.sin(a)) / 130,
      -1,
      1,
    );
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
