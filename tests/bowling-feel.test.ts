// Bowling feel (owner report: "very inconsistent and hard to get a good bowl"): hold-to-bowl
// release, a steadier line, and the predicted path. Synthetic sensor readings only — NOT a
// physical phone test.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BOWL_PROFILE,
  LANE,
  lineFrom,
  readHeld,
  HELD_AFTER,
  curveFrom,
} from "../src/shared/bowling.ts";
import type { HeldSample } from "../src/shared/bowling.ts";
import { phoneLaunch, bowler } from "../src/server/bowling.ts";
import { pathAt, trace } from "../src/server/bowlphysics.ts";
import type { Input } from "../src/shared/types.ts";

/**
 * One underhand bowl sampled at `hz`: a 500 ms backswing (path up < 0), then a 300 ms forward
 * swing (up > 0) peaking at `peak` rad/s. The button is let go `late` ms after the forward
 * swing's peak (negative = before it). `side` wobbles the left/right reading.
 */
function held(hz: number, peak: number, late = 0, side = 0) {
  const s: HeldSample[] = [];
  const dt = 1000 / hz;
  for (let t = 0; t < 1200; t += dt) {
    let rad = 0.3,
      up = 0;
    if (t < 500) {
      rad = 3 * Math.sin((Math.PI * t) / 500);
      up = -0.9;
    } else if (t < 800) {
      rad = peak * Math.sin((Math.PI * (t - 500)) / 300);
      up = 0.9;
    }
    // Sideways reading wobbles around `side` (alternating ±0.12).
    s.push({ t, rad, up, side: up > 0 ? side + (Math.round(t / dt) % 2 ? 0.12 : -0.12) : 0 });
  }
  const releaseT = 650 + late;
  // The phone reads up to HELD_AFTER ms past the let-go (the arm is still swinging).
  return readHeld(s.filter((q) => q.t <= releaseT + HELD_AFTER), releaseT, DEFAULT_BOWL_PROFILE, 0);
}

test("hold to bowl: the same swing reads the same at 60 and 120 Hz", () => {
  for (const peak of [6, 9, 13]) {
    const a = held(60, peak)!,
      b = held(120, peak)!;
    assert.ok(a && b);
    assert.ok(Math.abs(a.speed - b.speed) < 0.04, `${peak}: ${a.speed} vs ${b.speed}`);
    assert.equal(a.line, b.line);
  }
});

test("hold to bowl: letting go a little early or late gives nearly the same ball", () => {
  const on = held(60, 10)!;
  for (const late of [-60, 60, 120]) {
    const r = held(60, 10, late)!;
    assert.ok(r, `let go ${late} ms from the peak still bowls`);
    // Game speed differs by under 0.6 m/s (5–10 m/s range).
    assert.ok(Math.abs(r.speed - on.speed) * 5 < 0.6, `${late} ms: ${r.speed} vs ${on.speed}`);
  }
});

test("hold to bowl: harder swing = faster ball; letting go without a swing doesn't bowl", () => {
  assert.ok(held(60, 13)!.speed > held(60, 6)!.speed + 0.3);
  const still: HeldSample[] = Array.from({ length: 60 }, (_, i) => ({ t: i * 16, rad: 0.4, up: 0, side: 0 }));
  assert.equal(readHeld(still, 950, DEFAULT_BOWL_PROFILE, 0), null);
});

test("hold to bowl: the curve is the tilt locked at the press", () => {
  const s: HeldSample[] = Array.from({ length: 40 }, (_, i) => ({ t: i * 16, rad: 8, up: 0.9, side: 0 }));
  assert.equal(readHeld(s, 620, DEFAULT_BOWL_PROFILE, 0)!.hook, 0);
  assert.ok(readHeld(s, 620, DEFAULT_BOWL_PROFILE, -30)!.hook < -0.5);
  assert.equal(readHeld(s, 620, DEFAULT_BOWL_PROFILE, 25)!.hook, curveFrom(25));
});

test("a normal straight swing with some sideways wobble stays on the lane near the head pin", () => {
  // Wobble up to ±0.3 in the swing's sideways reading: inside the dead zone, or a small nudge.
  for (const side of [-0.3, -0.15, 0, 0.15, 0.3]) {
    const r = held(60, 9, 0, side)!;
    const l = phoneLaunch({ ...bowler("a", "A"), board: 0 }, { strength: r.speed, side: r.line, hook: 0 } as Input);
    const end = pathAt(l);
    assert.ok(!end.gutter, `side ${side}: no gutter`);
    assert.ok(Math.abs(end.x) < 0.15, `side ${side}: crosses at ${end.x.toFixed(2)} m`);
  }
  assert.equal(lineFrom(0.2), 0);
  // A deliberate swing across the body still moves the ball, and from the edge it can gutter.
  assert.ok(lineFrom(0.8) > 0.9);
  const edge = phoneLaunch({ ...bowler("a", "A"), board: 1 }, { strength: 0.3, side: 1, hook: 0 } as Input);
  assert.ok(pathAt(edge).gutter);
});

test("predicted trail: starts at the bowler's spot and ends where the ball really crosses", () => {
  for (const [board, hook] of [
    [0, 0],
    [0.5, -0.6],
    [-0.4, 0.8],
  ]) {
    const l = phoneLaunch({ ...bowler("a", "A"), board }, { strength: 0.6, side: 0, hook } as Input);
    const t = trace(l);
    assert.ok(t.length >= 20, "about 20 points down the lane");
    assert.ok(Math.abs(t[0] - board * 0.4) < 0.01, "starts at the spot");
    const real = pathAt(l);
    assert.ok(Math.abs(t[t.length - 2] - real.x) < 0.02, `ends at ${t[t.length - 2]} vs ${real.x.toFixed(2)}`);
    assert.ok(t[t.length - 1] >= LANE.length - 0.01);
  }
});
