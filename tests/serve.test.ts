import test from "node:test";
import assert from "node:assert/strict";
import {
  match,
  player,
  start,
  step,
  prepare,
  queueSwing,
  POINT_PAUSE,
} from "../src/server/engine.ts";
import { COURT, ZERO_INPUT, cleanGear } from "../src/shared/types.ts";
import type { ServeStyle } from "../src/shared/types.ts";

const swingInput = (strength: number) => ({
  ...ZERO_INPUT,
  strength,
  swing: true,
  sensors: true,
  calibrated: true,
});
const singles = () => {
  const m = match("singles", "medium");
  m.players = [player("a", "A", 0), player("b", "B", 1)];
  start(m);
  return m;
};

test("1v1 receiver always stands diagonally from the server", () => {
  for (const [a, b, serving] of [
    [0, 0, 0],
    [1, 0, 0],
    [2, 1, 0],
    [0, 1, 1],
    [3, 2, 1],
  ]) {
    const m = singles();
    m.score = [a, b];
    m.serving = serving;
    m.serverId = m.players[serving].id;
    prepare(m);
    const s = m.players[serving],
      r = m.players[1 - serving];
    assert.equal(Math.sign(r.pos.x), -Math.sign(s.pos.x), `score ${a}-${b}`);
  }
});

test("a human server must swing; the serve waits for it", () => {
  const m = singles();
  for (let i = 0; i < 120 * 6; i++) step(m);
  assert.equal(m.phase, "serve");
  queueSwing(m, m.players[1], swingInput(0.6)); // not the server: ignored
  assert.equal(m.phase, "serve");
  queueSwing(m, m.players[0], swingInput(0.6));
  assert.equal(m.phase, "rally");
  assert.equal(m.hits, 1);
});

for (const style of ["drive", "roll", "slice"] as ServeStyle[])
  test(`${style} serve lands in the diagonal service box`, () => {
    for (const power of [0.25, 0.6, 1]) {
      const m = singles();
      m.players[0].serveStyle = style;
      for (let i = 0; i < 120; i++) step(m);
      queueSwing(m, m.players[0], swingInput(power));
      assert.equal(m.serveKind, style);
      const startVx = m.velocity.x;
      for (let i = 0; i < 600 && m.bounces === 0 && m.phase === "rally"; i++)
        step(m);
      assert.equal(m.phase, "rally", `${style} ${power} faulted: ${m.message}`);
      const serverX = m.serveX;
      assert.ok(m.ball.x * serverX < 0, "diagonal side");
      assert.ok(Math.abs(m.ball.x) <= COURT.halfWidth);
      assert.ok(Math.abs(m.ball.z) > COURT.kitchen);
      if (style === "slice")
        // Starts out wider than a drive, then curves back into the box.
        assert.ok(Math.abs(startVx) > 4.5, "slice starts wide");
    }
  });

test("after a point the ball keeps flying for the pause, with a mark if it was out", () => {
  const m = singles();
  for (let i = 0; i < 120; i++) step(m);
  queueSwing(m, m.players[0], swingInput(0.6));
  // Replace the serve with a ball sailing long over the far baseline.
  m.ball = { x: 0, y: 1, z: -5 };
  m.velocity = { x: 0, y: -2, z: -9 };
  m.curve = 0;
  m.spin = 0;
  let calledAt = -1,
    zAtCall = 0,
    farthest = 0;
  for (let i = 0; i < 120 * 4; i++) {
    step(m);
    if (m.phase === "point" && calledAt < 0) {
      calledAt = m.time;
      zAtCall = m.ball.z;
      assert.ok(m.mark?.out);
      assert.ok(Math.abs(m.mark!.z) > COURT.halfLength);
    }
    if (m.phase === "point") farthest = Math.max(farthest, Math.abs(m.ball.z));
    if (calledAt > 0 && m.phase === "serve") break;
  }
  assert.ok(calledAt > 0, "the out ball ended the point");
  assert.equal(m.phase, "serve");
  assert.ok(m.time - calledAt >= POINT_PAUSE - 0.01);
  // The ball carried on past the line during the pause.
  assert.ok(farthest > Math.abs(zAtCall) + 1);
});

test("gear choices are clamped to valid options", () => {
  assert.deepEqual(cleanGear({ paddle: 3, shoes: 2, eyes: 1 }), {
    paddle: 3,
    shoes: 2,
    eyes: 1,
  });
  assert.deepEqual(cleanGear({ paddle: 99, shoes: -1, eyes: "x" }), {
    paddle: 0,
    shoes: 0,
    eyes: 0,
  });
  assert.deepEqual(cleanGear(null), { paddle: 0, shoes: 0, eyes: 0 });
});
