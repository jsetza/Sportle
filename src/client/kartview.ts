/**
 * Sportle Kart screen layout and camera easing, kept free of the DOM and WebGL so they can be
 * unit-tested (tests/kart-client.test.ts).
 */
import { pointAt } from "../shared/kart.ts";
import type { Track } from "../shared/kart.ts";
export type Cam = { eye: number[]; target: number[]; fov: number };
export type CamMode = "chase" | "bumper" | "broadcast";
/**
 * Which views the TV draws: one shared view in the lobby, with no local drivers, or when the
 * shared layout is on; otherwise one per local driver (up to 4). Three drivers get a fourth
 * quadrant that follows the leader instead of an empty one.
 */
export function viewIds(local: string[], shared: boolean, phase: string | null) {
  if (shared || !local.length || !phase || phase === "lobby") return ["shared"];
  const v = local.slice(0, 4);
  if (v.length === 3) v.push("shared");
  return v;
}
/**
 * Ease a camera toward its goal. A camera that wasn't drawn for a moment (layout switch, a new
 * race) or is far from its goal jumps there instead of sweeping across the track. The bumper
 * camera's eye stays exactly on the kart's nose; only its aim is eased.
 */
export function easeCam(prev: Cam | undefined, goal: Cam, mode: CamMode, dt: number, idleMs: number): Cam {
  if (!prev || idleMs > 300) return goal;
  const far = Math.hypot(prev.eye[0] - goal.eye[0], prev.eye[1] - goal.eye[1], prev.eye[2] - goal.eye[2]) > 40;
  if (far) return goal;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  if (mode === "broadcast") {
    const e = 1 - Math.exp(-dt * 6);
    return { eye: goal.eye, target: prev.target.map((v, i) => lerp(v, goal.target[i], e)), fov: goal.fov };
  }
  const e = 1 - Math.exp(-dt * (mode === "bumper" ? 30 : 7));
  return {
    eye: mode === "bumper" ? goal.eye : prev.eye.map((v, i) => lerp(v, goal.eye[i], e)),
    target: prev.target.map((v, i) => lerp(v, goal.target[i], Math.min(1, e * 1.6))),
    fov: lerp(prev.fov, goal.fov, e),
  };
}
/**
 * Menu and lobby camera: flies slowly along the lap 4.5 m above the road, looking ahead, so it
 * stays inside the barriers and never passes through scenery (an orbit around the start did).
 */
export function lobbyCam(t: Track, nowMs: number): Cam {
  const s = t.S0 + ((nowMs / 1000) * 9) % t.L;
  const e = pointAt(t, s - 12, 0),
    g = pointAt(t, s + 16, 0);
  return { eye: [e.x, e.y + 4.5, e.z], target: [g.x, g.y + 1, g.z], fov: 55 };
}
