/**
 * Drives the Sportle Boxing phone page with SYNTHETIC sensor events (tests only — not a physical
 * phone): join → 01 motion → 02 hand → 03 guard (held upright, still) → 04 two jabs, two hooks,
 * two uppercuts → ready. Punches, guard, slips/ducks and shaking are played as orientation and
 * motion samples at 60 Hz. Shared by the boxing smoke test and the screenshot runs.
 */
import { slow } from "./patient.mjs";
import assert from "node:assert/strict";
import { deviceAxes } from "../src/shared/motion.ts";

const R2D = 180 / Math.PI;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (...vs) => vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
const mul = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
/** The player faces west in world terms (a guard pose at alpha 0, beta 88 gives that forward). */
const F = [-1, 0, 0],
  RIGHT = [0, 1, 0],
  UP = [0, 0, 1];
/** Euler angles (W3C DeviceOrientation) for a phone whose top edge is Y and screen normal Z. */
export function euler(Y, Z) {
  const X = cross(Y, Z);
  const beta = Math.asin(Math.max(-1, Math.min(1, Y[2]))) * R2D;
  const alpha = Math.atan2(-Y[0], Y[1]) * R2D;
  const gamma = Math.atan2(-X[2], Z[2]) * R2D;
  const a = deviceAxes(alpha, beta, gamma);
  assert.ok(dot(a.Y, Y) > 0.999 && dot(a.Z, Z) > 0.999, "pose round trip");
  return { alpha, beta, gamma };
}
/** Poses for a right hand (screen toward the thumb = the player's left), tipped `deg` degrees. */
const tip = (toward, deg) => {
  const r = (deg * Math.PI) / 180;
  const Y = add(mul(UP, Math.cos(r)), mul(toward, Math.sin(r)));
  // Keep the screen facing left (-RIGHT) where possible.
  let Z = mul(RIGHT, -1);
  if (Math.abs(dot(Z, Y)) > 0.5) Z = add(mul(UP, Math.sign(dot(toward, RIGHT)) * Math.sin(r)), mul(RIGHT, -Math.cos(r)));
  const Zn = add(Z, mul(Y, -dot(Z, Y)));
  const l = Math.hypot(...Zn);
  return euler(Y, mul(Zn, 1 / l));
};
export const POSE = {
  guard: () => euler([0.035, 0, 0.9994], [0, -1, 0]),
  stance: () => tip(F, 45),
  right: () => tip(RIGHT, 42),
  left: () => tip(mul(RIGHT, -1), 42),
  duck: () => tip(F, 78),
};
/** Device-frame vector for a player-frame one [forward, right, up] in the given pose. */
function toDevice(p, pose) {
  const w = add(mul(F, p[0]), mul(RIGHT, p[1]), mul(UP, p[2]));
  const a = deviceAxes(pose.alpha, pose.beta, pose.gamma);
  return [dot(a.X, w), dot(a.Y, w), dot(a.Z, w)];
}
const DIRS = { jab: [1, 0, 0.05], hook: [0.4, -0.9, 0.05], upper: [0.3, 0, 0.95] };
const SPIN = { jab: [0, 0, 0], hook: [0, 0, 520], upper: [0, 420, 0] };
/** 60 Hz motion samples for one punch: half a sine pushing, half stopping. `A` = peak m/s². */
export function punchSamples(type, A = 48, pose = POSE.stance()) {
  const T = type === "jab" ? 0.1 : 0.11;
  const out = [];
  for (let t = 0; t <= 2 * T + 0.2; t += 1 / 60) {
    const k = t <= 2 * T ? Math.sin((Math.PI * t) / T) * A : 0;
    const acc = toDevice(mul(DIRS[type], k), pose);
    const w = t <= 2 * T ? SPIN[type] : [0, 0, 0];
    const rw = add(mul(F, w[0]), mul(RIGHT, w[1]), mul(UP, w[2]));
    const ax = deviceAxes(pose.alpha, pose.beta, pose.gamma);
    out.push({ acc, rot: { beta: dot(ax.X, rw), gamma: dot(ax.Y, rw), alpha: dot(ax.Z, rw) } });
  }
  return out;
}
/** Shaking the phone hard (to get up off the canvas): `secs` seconds of strong wobble. */
export function shakeSamples(secs = 2, pose = POSE.stance()) {
  const out = [];
  for (let t = 0; t < secs; t += 1 / 60) out.push({ acc: toDevice([0, 18 * Math.sin(2 * Math.PI * 4 * t), 12 * Math.cos(2 * Math.PI * 3 * t)], pose), rot: { alpha: 0, beta: 0, gamma: 0 } });
  return out;
}
/** Start 60 Hz synthetic sensors on the page (orientation = window.testPose; motion from window.testQueue). */
export async function sensors(page, pose = POSE.stance()) {
  await page.evaluate((pose) => {
    window.testPose = pose;
    window.testQueue = [];
    clearInterval(window.testSensors);
    window.testSensors = setInterval(() => {
      window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", window.testPose));
      const s = window.testQueue.shift() ?? { acc: [0, 0, 0], rot: { alpha: 0, beta: 0, gamma: 0 } };
      window.dispatchEvent(
        new DeviceMotionEvent("devicemotion", {
          acceleration: { x: s.acc[0], y: s.acc[1], z: s.acc[2] },
          accelerationIncludingGravity: { x: s.acc[0], y: s.acc[1] + 9.8, z: s.acc[2] },
          rotationRate: s.rot,
          interval: 16,
        }),
      );
    }, 16);
  }, pose);
}
export const pose = (page, p) => page.evaluate((p) => (window.testPose = p), p);
/** Queue motion samples (they play out at 60 Hz). */
export const play = (page, samples) => page.evaluate((s) => window.testQueue.push(...s), samples);
/** Wait until the queued samples have played. */
export const drained = (page) => page.waitForFunction(() => !window.testQueue.length, null, { polling: 50, timeout: slow(8000) });
export async function punch(page, type, A = 48) {
  await play(page, punchSamples(type, A));
  await drained(page);
}
/** Join a boxing room from the phone page and finish the whole setup. */
export async function joinPhone(page, base, room, name, { hand = "right", glove = "" } = {}) {
  await page.goto(`${base}/boxing/phone?room=${room}#test${glove ? "&glove=" + glove : ""}`);
  if (!glove) await page.locator("#nickname").fill(name);
  await page.locator("#connect").click();
  await page.locator("#hold").waitFor({ state: "visible" });
  await page.locator("#hold").click(); // 01: motion on
  await sensors(page, POSE.stance());
  await page.locator("#stepTag", { hasText: "HAND" }).waitFor();
  await page.locator(`#handPick button[data-hand=${hand}]`).click();
  // 03: guard up, still, for a second.
  await page.locator("#stepTag", { hasText: "GUARD" }).waitFor();
  await pose(page, POSE.guard());
  await page.locator("#stepTag", { hasText: /PUNCHES|SAVED/ }).waitFor({ timeout: slow(8000) });
  if (await page.locator("#stepTag", { hasText: "PUNCHES" }).isVisible()) {
    await pose(page, POSE.stance());
    for (const [i, type] of ["jab", "jab", "hook", "hook", "upper", "upper"].entries()) {
      await punch(page, type, 40 + (i % 2) * 10);
      await page
        .waitForFunction((n) => document.querySelectorAll("#punchList li.done").length >= n || window.__boxPhone.step !== "punch", i + 1, { polling: 50, timeout: slow(4000) })
        .catch(async (e) => {
          throw Error(`setup punch ${i + 1} (${type}) not read: ${await page.locator("#punchList").textContent()} · step ${await page.evaluate(() => window.__boxPhone.step)} · ${e.message}`);
        });
      await page.waitForTimeout(300);
    }
  }
  await page.locator("#fight").waitFor({ state: "visible", timeout: slow(8000) });
  await pose(page, POSE.stance());
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("sportle-box") || "null"));
  assert.ok(saved && saved.profile && Object.keys(saved.profile.centroids).length === 3, "setup learned three punches: " + JSON.stringify(saved));
}
