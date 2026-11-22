// Paddle consistency (owner request): the same physical swing should give the same shot on
// every phone. Synthetic sensor readings only — NOT a physical phone test.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MotionFilter,
  SwingCapture,
  sampleOf,
  ease,
} from "../src/shared/motion.ts";
import type { SwingShot } from "../src/shared/motion.ts";

/**
 * One swing as a bell of rotation speed (deg/s) over `ms`, sampled at `hz`, run through the
 * same steps as the controller: filter → notice the swing → read it at its peak.
 * `tilt` adds an upward component (low-to-high swing) as a share of the speed.
 */
function swing(
  hz: number,
  peakRadS: number,
  ms = 220,
  tilt = 0,
  spike = false,
) {
  const f = new MotionFilter();
  f.orientation(0, 0, 0, 0, 0); // flat, aimed at the screen
  assert.ok(f.aim());
  for (let t = 0; t <= 200; t += 1000 / hz) f.orientation(180, 90, 0, 0, t); // forehand face
  const cap = new SwingCapture();
  const dt = 1000 / hz,
    t0 = 300;
  let shot: SwingShot | null = null,
    sentAt = -1;
  for (let t = t0 - 100; t < t0 + ms + 300 && !shot; t += dt) {
    const k = t < t0 || t > t0 + ms ? 0 : Math.sin((Math.PI * (t - t0)) / ms);
    const deg = (peakRadS * 180) / Math.PI;
    let g = deg * k * Math.sqrt(1 - tilt * tilt),
      b = -deg * k * tilt;
    // One noisy reading pointing the other way, right after the swing is noticed.
    if (spike && t > t0 + 60 && t <= t0 + 60 + dt) b = deg * k * 0.9;
    const hit = f.motion(
      { x: 0, y: 0, z: 0 },
      { alpha: 0, beta: b, gamma: g },
      0,
      t,
    );
    if (hit && !cap.active) cap.start(t);
    if (cap.active) cap.add(sampleOf(f, t));
    if (cap.ready(t)) {
      shot = cap.finish();
      sentAt = t - t0;
    }
  }
  assert.ok(shot, "swing noticed and read");
  return { shot: shot!, sentAt };
}

test("same swing, different sensor rates: same power and direction", () => {
  for (const peak of [8, 12, 18]) {
    const a = swing(60, peak, 220, 0.5),
      b = swing(120, peak, 220, 0.5),
      c = swing(200, peak, 220, 0.5);
    for (const o of [b, c]) {
      assert.ok(
        Math.abs(o.shot.strength - a.shot.strength) < 0.06,
        `${peak} rad/s: ${o.shot.strength.toFixed(2)} vs ${a.shot.strength.toFixed(2)}`,
      );
      assert.ok(
        Math.abs(o.shot.direction - a.shot.direction) < 0.12,
        `${peak} rad/s direction`,
      );
      assert.ok(
        Math.abs(o.shot.rad - a.shot.rad) < peak * 0.05,
        `${peak} rad/s peak`,
      );
    }
  }
});

test("power comes from the swing's peak, even when the peak comes late", () => {
  // A long, hard swing peaks ~150 ms in; reading it only 65 ms after it's noticed under-reads.
  const hard = swing(60, 18, 320);
  assert.ok(hard.shot.rad > 17, `peak ${hard.shot.rad.toFixed(1)} rad/s`);
  assert.ok(
    hard.shot.strength > 0.9,
    `strength ${hard.shot.strength.toFixed(2)}`,
  );
  // …and the shot is still sent promptly (peak + a little, never past the cap).
  assert.ok(
    hard.sentAt < 320 * 0.5 + 150,
    `sent ${hard.sentAt.toFixed(0)} ms into the swing`,
  );
});

test("harder swings hit harder; a gentle swing still counts but stays soft", () => {
  const gentle = swing(60, 7.5),
    medium = swing(60, 11),
    hard = swing(60, 17);
  assert.ok(gentle.shot.strength < medium.shot.strength - 0.1);
  assert.ok(medium.shot.strength < hard.shot.strength - 0.1);
  assert.ok(
    gentle.shot.strength < 0.45,
    `gentle ${gentle.shot.strength.toFixed(2)}`,
  );
});

test("one noisy reading doesn't flip the swing direction", () => {
  const clean = swing(60, 12, 220, 0.5),
    noisy = swing(60, 12, 220, 0.5, true);
  assert.ok(
    clean.shot.direction > 0.5,
    `up swing reads up (${clean.shot.direction.toFixed(2)})`,
  );
  assert.ok(
    noisy.shot.direction > 0.4,
    `still up with a spike (${noisy.shot.direction.toFixed(2)})`,
  );
});

test("paddle angle smoothing takes the same time at 60 Hz and 120 Hz", () => {
  const settle = (hz: number) => {
    const f = new MotionFilter();
    f.orientation(0, 0, 0, 0, 0);
    f.aim();
    for (let t = 0; t <= 300; t += 1000 / hz) f.orientation(180, 90, 0, 0, t);
    for (let t = 300; t <= 360; t += 1000 / hz) f.orientation(180, 60, 0, 0, t); // open 30°
    return f.angle.pitch;
  };
  assert.ok(
    Math.abs(settle(60) - settle(120)) < 3,
    `${settle(60).toFixed(1)} vs ${settle(120).toFixed(1)}`,
  );
  assert.ok(
    ease(1000 / 60, 10) > ease(1000 / 120, 10),
    "per-event step scales with the gap",
  );
});
