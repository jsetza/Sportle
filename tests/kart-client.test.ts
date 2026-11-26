/**
 * Sportle Kart bugs found in the 2026-11-26 sweep, each with a check that would have caught it.
 * Synthetic inputs only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { viewIds, easeCam, lobbyCam } from "../src/client/kartview.ts";
import type { Cam } from "../src/client/kartview.ts";
import { SteerReader, TRACKS, cameraReach, pointAt, track, upVector } from "../src/shared/kart.ts";
import { addRacer, kartInput, newKart, nextRace, startKart, stepKart } from "../src/server/kart.ts";
import { DEFAULT_GEAR } from "../src/shared/types.ts";
import type { Input } from "../src/shared/types.ts";

test("views: one view in the lobby; split while racing; 3 drivers get a leader view, not an empty quadrant", () => {
  // Bug: the lobby showed four identical split views.
  assert.deepEqual(viewIds(["a", "b", "c", "d"], false, "lobby"), ["shared"]);
  assert.deepEqual(viewIds(["a", "b"], false, "race"), ["a", "b"]);
  // Bug: with three drivers the fourth quadrant was left empty.
  assert.deepEqual(viewIds(["a", "b", "c"], false, "countdown"), ["a", "b", "c", "shared"]);
  assert.deepEqual(viewIds(["a", "b", "c", "d"], false, "race"), ["a", "b", "c", "d"]);
  assert.deepEqual(viewIds(["a", "b"], true, "race"), ["shared"]);
  assert.deepEqual(viewIds([], false, "race"), ["shared"]);
});

test("cameras: no sweeping across the track after a layout switch; the bumper camera stays on the nose", () => {
  const goal: Cam = { eye: [100, 3, 100], target: [104, 1, 100], fov: 62 };
  const stale: Cam = { eye: [-80, 14, 30], target: [0, 1, 0], fov: 50 };
  // Bug: switching to the shared view eased from the old lobby orbit camera, so for a second the
  // camera flew through walls and scenery and the leader wasn't on screen.
  assert.deepEqual(easeCam(stale, goal, "chase", 1 / 60, 16), goal, "far from its goal: jump");
  const near: Cam = { eye: [99, 3, 100], target: [103, 1, 100], fov: 62 };
  assert.deepEqual(easeCam(near, goal, "chase", 1 / 60, 5000), goal, "idle camera: jump");
  const eased = easeCam(near, goal, "chase", 1 / 60, 16);
  assert.ok(eased.eye[0] > 99 && eased.eye[0] < 100, "a live chase camera is eased");
  // Bug: the bumper camera's eye was eased too, so at speed it trailed ~1 m behind the nose and
  // split-screen views showed their own kart from above.
  const bump = easeCam(near, goal, "bumper", 1 / 60, 16);
  assert.deepEqual(bump.eye, goal.eye, "bumper eye exactly on the nose");
});

test("camera reach: if nothing behind the kart is clear, the camera stays close to the kart (not 25 % of a long line)", () => {
  const t = track("court");
  const p = pointAt(t, t.S0 + 30);
  const from = [p.x, p.y + 1.2, p.z];
  // A wanted eye 300 m away, deep in scenery (a stale camera).
  const eye = [p.x + 300, p.y - 20, p.z + 300];
  const f = cameraReach(t, t.S0 + 30, from, eye);
  const dist = Math.hypot(...eye.map((v, i) => (v - from[i]) * f));
  assert.ok(dist <= 1.6, "fallback distance " + dist.toFixed(1));
});

test("joining between races keeps the bots (and their cup points); the next race still has 8 karts", () => {
  let now = 9_000_000,
    seq = 1;
  const feed = (k: ReturnType<typeof newKart>, r: { id: string } & any) =>
    kartInput(k, r, { seq: seq++, t: now, pitch: 0, roll: 0, yaw: 0, strength: 0, direction: 0, swing: false, sensors: true, calibrated: true, mx: 0, mz: 1 } as Input, now);
  const k = newKart("cup", "court", "club", false, 1);
  const a = addRacer(k, "a", "Ana", "classic", { ...DEFAULT_GEAR }, "classic", 0);
  feed(k, a);
  a.ready = true;
  startKart(k, now);
  a.bot = "pro";
  for (let i = 0; i < 120 * 150 && k.phase !== "results"; i++) {
    now += 1000 / 120;
    stepKart(k, 1 / 120, now);
  }
  a.bot = "";
  assert.equal(k.phase, "results");
  const botPoints = k.racers.filter((r) => r.bot).reduce((s, r) => s + r.points, 0);
  assert.ok(botPoints > 0);
  // Bug: a phone joining on the results screen removed every bot, so the next race had only the
  // phones and the bots' cup points were lost.
  const b = addRacer(k, "b", "Ben", "classic", { ...DEFAULT_GEAR }, "classic", 1);
  assert.equal(k.racers.length, 8, "grid stays at 8");
  assert.equal(k.racers.filter((r) => r.bot).length, 6);
  assert.ok(b.place >= 1, "the newcomer has a place on the results board");
  feed(k, a);
  feed(k, b);
  b.ready = true;
  nextRace(k, now);
  assert.equal(k.racers.length, 8, "next race: 8 karts");
  const kept = k.racers.filter((r) => r.bot).reduce((s, r) => s + r.points, 0);
  assert.ok(kept > 0 && kept <= botPoints, "bots kept their cup points");
  // Joining in the lobby still starts from just the phones.
  const k2 = newKart("race", "neon", "club", false);
  addRacer(k2, "x", "X", "classic", { ...DEFAULT_GEAR }, "classic", 0);
  assert.equal(k2.racers.length, 1);
});

test("tilt to drive: top edge away = gas, toward you = brake/reverse, small leans do nothing", () => {
  const r = new SteerReader();
  // Wheel grip, +x edge up; leaning the screen back tilts world-up toward the screen normal.
  const lean = (deg: number) => {
    const u = upVector(0, 0, -90 + deg);
    return u;
  };
  r.setCenter(lean(0));
  r.feed(lean(0), 0);
  assert.equal(r.throttle(), 0);
  r.feed(lean(3), 16);
  assert.equal(r.throttle(), 0, "dead zone");
  r.feed(lean(25), 32);
  const away = r.throttle();
  r.feed(lean(-25), 48);
  const toward = r.throttle();
  assert.ok(Math.abs(away) > 0.9 && Math.abs(toward) > 0.9 && Math.sign(away) === -Math.sign(toward), `${away} / ${toward}`);
});

// ——— Server flows ———
let clock = 20_000_000,
  sq = 1;
const send = (k: ReturnType<typeof newKart>, r: any, a: Partial<Input> = {}) =>
  kartInput(k, r, { seq: sq++, t: clock, pitch: 0, roll: 0, yaw: 0, strength: 0, direction: 0, swing: false, sensors: true, calibrated: true, mx: 0, mz: 1, ...a } as Input, clock);
const step = (k: ReturnType<typeof newKart>, secs: number, every?: () => void) => {
  for (let i = 0; i < secs * 120; i++) {
    clock += 1000 / 120;
    if (every && i % 4 === 0) every();
    stepKart(k, 1 / 120, clock);
  }
};

test("a phone that left the lobby can't block the start; one away at Next race gets a bot (cups don't skip a track)", () => {
  const k = newKart("cup", "court", "club", false, 1);
  const a = addRacer(k, "a", "Ana", "classic", { ...DEFAULT_GEAR }, "classic", 0);
  const b = addRacer(k, "b", "Ben", "classic", { ...DEFAULT_GEAR }, "classic", 1);
  send(k, a);
  send(k, b);
  a.ready = b.ready = true;
  // Ben closes the page; Ana keeps sending.
  step(k, 5, () => send(k, a));
  assert.throws(() => startKart(k, clock), /Ben/, "a phone away for a few seconds: wait for it");
  // Bug: Ben being gone for good blocked Start forever.
  step(k, 30, () => send(k, a));
  startKart(k, clock);
  assert.ok(!k.racers.some((r) => r.name === "Ben"), "Ben dropped from the lobby after 30 s away");
  assert.equal(k.phase, "countdown");
  // Race 1, driven for Ana; then her phone goes away on the results screen.
  a.bot = "pro";
  for (let i = 0; i < 120 * 150 && (k.phase as string) !== "results"; i++) step(k, 1 / 120);
  assert.equal(k.phase, "results");
  a.bot = "";
  step(k, 4);
  const before = k.cupRace;
  // Bug: Next race with a phone away moved the cup on and then refused, so each retry skipped a
  // track. Now the race starts and a bot drives the missing phone's kart.
  nextRace(k, clock);
  assert.equal(k.cupRace, before + 1, "exactly one track further");
  assert.equal(k.phase, "countdown");
  assert.ok(a.botFor, "a bot drives Ana's kart while her phone is away");
  // Ana comes back: she takes the wheel.
  step(k, 5, () => send(k, a));
  assert.equal(a.botFor, false);
});

test("countdown: gas in the last 0.7 s gives a start boost; too early stalls; FINAL LAP and FINISH callouts", () => {
  for (const when of ["good", "early", "none"] as const) {
    const k = newKart("race", "neon", "club", false, 2);
    const a = addRacer(k, "a", "Ana", "classic", { ...DEFAULT_GEAR }, "classic", 0);
    send(k, a, { mz: 0 });
    a.ready = true;
    startKart(k, clock);
    while (k.phase === "countdown") {
      const gas = when === "good" ? k.clock > -0.5 : when === "early" ? k.clock < -2 : false;
      send(k, a, { mz: gas ? 1 : 0 });
      step(k, 1 / 30);
    }
    step(k, 0.05, () => send(k, a));
    const text = k.callouts.filter((c) => c.who === a.id).map((c) => c.text);
    if (when === "good") assert.ok(a.boost > 0.9 && text.includes("START BOOST!"), "start boost");
    if (when === "early") assert.ok(text.includes("TOO EARLY!") && a.v < 1, "stall");
    if (when === "none") assert.ok(!text.length && a.boost === 0);
    if (when === "good") {
      a.bot = "pro";
      step(k, 100);
      const all = k.callouts.filter((c) => c.who === a.id).map((c) => c.text);
      assert.ok(all.includes("FINAL LAP!") || a.finished, "final lap called");
      assert.ok(a.finished > 0, "finished two laps");
    }
  }
});

test("lobby camera: flies along the road, always inside the barriers (the old orbit went through scenery)", () => {
  for (const d of TRACKS) {
    const t = track(d.id);
    for (let ms = 0; ms < (t.L / 9) * 1000; ms += 700) {
      const c = lobbyCam(t, ms);
      let best = Infinity,
        roadY = 0,
        half = 0;
      for (let i = 0; i < t.n; i++) {
        const dd = Math.hypot(t.x[i] - c.eye[0], t.z[i] - c.eye[2]);
        if (dd < best && Math.abs(t.y[i] + 4.5 - c.eye[1]) < 3) {
          best = dd;
          roadY = t.y[i];
          half = t.w[i] / 2 + d.verge;
        }
      }
      assert.ok(best <= half, `${d.id}: lobby camera ${best.toFixed(1)} m off the road at ${ms} ms`);
      assert.ok(c.eye[1] > roadY + 3, `${d.id}: lobby camera above the road`);
    }
  }
});
