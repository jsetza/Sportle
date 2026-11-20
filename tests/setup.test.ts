// Four-step phone setup math (synthetic orientation/rotation readings — NOT a phone test):
// aim at the screen, paddle face angle and side, swing path, and learning from 3+3 swings.
import test from "node:test";
import assert from "node:assert/strict";
import {
  aimFrom,
  paddlePose,
  swingPath,
  learnSwings,
  MotionFilter,
} from "../src/shared/motion.ts";
import type { SetupSwing } from "../src/shared/motion.ts";

// Poses for a TV straight ahead (north) of a player, phone held by the bottom like a handle:
const FOREHAND = { alpha: 180, beta: 90, gamma: 0 }; // screen toward the TV, top edge up
const BACKHAND = { alpha: 0, beta: 90, gamma: 0 }; // back toward the TV
const near = (a: number, b: number, eps = 2) =>
  assert.ok(Math.abs(a - b) <= eps, `${a.toFixed(2)} vs ${b}`);

test("aim: the top edge of a flat phone points at the screen; an upright phone can't aim", () => {
  const f = aimFrom(0, 0, 0)!;
  near(f[0], 0, 1e-9);
  near(f[1], 1, 1e-9);
  const g = aimFrom(90, 5, -4)!;
  assert.ok(g[0] < -0.99, "turned 90° left");
  assert.equal(aimFrom(0, 88, 0), null);
});

test("paddle pose: forehand/backhand side and open/closed face, whatever the aim heading", () => {
  for (const turn of [0, 37, -120]) {
    const fwd = aimFrom(turn, 0, 0)!;
    const fh = paddlePose(FOREHAND.alpha + turn, FOREHAND.beta, FOREHAND.gamma, fwd);
    assert.equal(fh.face, 1);
    near(fh.pitch, 0);
    near(fh.yaw, 0);
    const bh = paddlePose(BACKHAND.alpha + turn, BACKHAND.beta, BACKHAND.gamma, fwd);
    assert.equal(bh.face, -1);
    near(bh.pitch, 0);
    // Tilting the hitting face up opens it; down closes it.
    near(paddlePose(180 + turn, 60, 0, fwd).pitch, 30);
    near(paddlePose(180 + turn, 120, 0, fwd).pitch, -30);
    // On the backhand side, opening the (back) face works the same way.
    near(paddlePose(turn, 120, 0, fwd).pitch, 30);
  }
});

test("swing path: forehands go right→left, backhands left→right, low-to-high reads as up", () => {
  const fwd = aimFrom(0, 0, 0)!;
  const fore = swingPath({ alpha: 0, beta: 0, gamma: 400 }, 180, 90, 0, fwd);
  assert.ok(fore.side < -0.8 && Math.abs(fore.up) < 0.2, JSON.stringify(fore));
  near(fore.rad, (400 * Math.PI) / 180, 0.01);
  const back = swingPath({ alpha: 0, beta: 0, gamma: -400 }, 0, 90, 0, fwd);
  assert.ok(back.side > 0.8, JSON.stringify(back));
  const up = swingPath({ alpha: 0, beta: -400, gamma: 0 }, 180, 90, 0, fwd);
  assert.ok(up.up > 0.8 && Math.abs(up.side) < 0.2, JSON.stringify(up));
  const down = swingPath({ alpha: 0, beta: 400, gamma: 0 }, 180, 90, 0, fwd);
  assert.ok(down.up < -0.8, JSON.stringify(down));
});

const swings = (side: number, face: number, rad = 3): SetupSwing[] =>
  [0.9, 1, 1.1].map((k) => ({ side: side * k, up: 0.1, rad: rad * k, face }));

test("learning from 3 forehands + 3 backhands: side sign, face sign and swing feel", () => {
  const r = learnSwings(swings(-0.9, 1), swings(0.9, -1), "right");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.profile.sideSign, 1);
  assert.equal(r.profile.faceSign, 1);
  // A typical 3 rad/s (172°/s) swing becomes a ~60% shot.
  near(r.profile.sensitivity, (0.6 * 210) / ((3 * 180) / Math.PI), 0.01);
  // A phone that reads left/right reversed gets corrected.
  const rev = learnSwings(swings(0.9, 1), swings(-0.9, -1), "right");
  assert.ok(rev.ok && rev.profile.sideSign === -1);
  // Left-handers: forehands go left→right.
  const left = learnSwings(swings(0.9, 1), swings(-0.9, -1), "left");
  assert.ok(left.ok && left.profile.sideSign === 1);
  // Faces reported the other way round (consistently) → corrected, not rejected.
  const flipped = learnSwings(swings(-0.9, -1), swings(0.9, 1), "right");
  assert.ok(flipped.ok && flipped.profile.faceSign === -1);
});

test("learning refuses swings it can't tell apart", () => {
  const same = learnSwings(swings(-0.9, 1), swings(-0.8, -1), "right");
  assert.ok(!same.ok && same.redo === "both");
  const noFlip = learnSwings(swings(-0.9, 1), swings(0.9, 1), "right");
  assert.ok(!noFlip.ok && noFlip.redo === "back", "backhands must turn the phone over");
  assert.ok(!learnSwings(swings(-0.9, 1).slice(0, 2), swings(0.9, -1), "right").ok);
});

test("motion filter after aiming: screen-relative face angle, side and swing direction", () => {
  const f = new MotionFilter();
  f.orientation(25, 2, -3, 0); // flat, aimed at a screen 25° to the left
  assert.ok(f.aim());
  for (let i = 0; i < 30; i++) f.orientation(180 + 25, 60, 0, 0); // forehand, face opened 30°
  assert.equal(f.face, 1);
  near(f.angle.pitch, 30, 3);
  for (let i = 0; i < 30; i++) f.orientation(25, 90, 0, 0); // turned over: backhand
  assert.equal(f.face, -1);
  f.orientation(180 + 25, 90, 0, 0);
  f.motion({ x: 0, y: 0, z: 0 }, { alpha: 0, beta: 0, gamma: 0 }, 0, 900); // still first
  const swing = f.motion({ x: 0, y: 0, z: 0 }, { alpha: 0, beta: 0, gamma: 420 }, 0, 1000);
  assert.ok(swing, "a clear swing is detected");
  assert.ok(f.side < -0.8, `forehand swing goes left (${f.side})`);
  f.sideSign = -1;
  f.motion({ x: 0, y: 0, z: 0 }, { alpha: 0, beta: 0, gamma: 0 }, 0, 1300);
  f.motion({ x: 0, y: 0, z: 0 }, { alpha: 0, beta: 0, gamma: 420 }, 0, 1400);
  assert.ok(f.side > 0.8, "the learned sign flips it");
});
