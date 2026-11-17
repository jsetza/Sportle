import test from "node:test";
import assert from "node:assert/strict";
import {
  match,
  player,
  start,
  step,
  hit,
  queueSwing,
  movementTarget,
  contactQuality,
  botShot,
  forehandSide,
  FOREHAND_OFFSET,
} from "../src/server/engine.ts";
import { contactFault } from "../src/shared/rules.ts";
import { COURT, ZERO_INPUT } from "../src/shared/types.ts";
import type { Match } from "../src/shared/types.ts";

const singles = (mode: "singles" | "solo" = "singles") => {
  const m = match(mode, "medium");
  m.players = [player("a", "A", 0), player("b", "B", 1, mode === "solo")];
  start(m);
  return m;
};
const rally = (m: Match, lastTeam: number) => {
  m.phase = "rally";
  m.hits = 4;
  m.lastTeam = lastTeam;
  m.time = 10;
};
const freeze = (m: Match) => {
  for (const p of m.players) {
    p.target = { ...p.pos };
    p.reactionAt = 1e9;
  }
};

test("player may enter the kitchen to play a ball that will bounce there", () => {
  const m = singles(),
    p = m.players[0];
  rally(m, 1);
  m.bounces = 0;
  m.ball = { x: 0, y: 1.0, z: -0.5 };
  m.velocity = { x: 0, y: 0.5, z: 2.0 }; // short dink landing ~1.5 m on team 0's side
  const t = movementTarget(m, p);
  assert.ok(Math.abs(t.z) < COURT.kitchen, `target z ${t.z} not in kitchen`);
});

test("player stays outside the kitchen for a deep ball and while momentum is active", () => {
  const m = singles(),
    p = m.players[0];
  rally(m, 1);
  m.bounces = 0;
  m.ball = { x: 0, y: 1.2, z: -3 };
  m.velocity = { x: 0, y: 2, z: 8 }; // deep drive
  assert.ok(Math.abs(movementTarget(m, p).z) > COURT.kitchen + 0.22);
  m.ball = { x: 0, y: 1.0, z: -0.5 };
  m.velocity = { x: 0, y: 0.5, z: 2.0 };
  p.volleyMomentum = true;
  assert.ok(Math.abs(movementTarget(m, p).z) > COURT.kitchen + 0.22);
});

test("volley right after leaving the kitchen is a fault until both feet are re-established", () => {
  const m = singles(),
    p = m.players[0];
  rally(m, 1);
  m.bounces = 0;
  p.pos = { x: 0, y: 0, z: COURT.kitchen + 0.5 };
  p.kitchenClearAt = m.time - 0.05;
  assert.match(contactFault(m, p) ?? "", /re-established/);
  p.kitchenClearAt = m.time - 1;
  assert.equal(contactFault(m, p), null);
  m.bounces = 1;
  p.pos.z = 1.0; // inside the kitchen, bounced ball: legal
  p.kitchenClearAt = m.time;
  assert.equal(contactFault(m, p), null);
});

test("moving out of the kitchen records the exit time", () => {
  const m = singles(),
    p = m.players[0];
  rally(m, 0);
  m.ball = { x: 0, y: 3, z: 2 };
  m.velocity = { x: 0, y: 0, z: 0 };
  p.pos = { x: 0, y: 0, z: COURT.kitchen + 0.2 };
  p.target = { x: 0, y: 0, z: 4 };
  p.reactionAt = 1e9;
  m.players[1].target = { ...m.players[1].pos };
  m.players[1].reactionAt = 1e9;
  for (let i = 0; i < 10; i++) step(m);
  assert.ok(Math.abs(p.kitchenClearAt - m.time) < 0.09);
});

test("ball striking the net post is a fault on the hitting team", () => {
  const m = singles();
  rally(m, 0);
  freeze(m);
  m.ball = { x: COURT.post, y: 0.5, z: 0.05 };
  m.velocity = { x: 0, y: 0, z: -8 };
  const before = m.score.slice();
  step(m);
  assert.match(m.message, /Net post/);
  assert.notEqual(m.phase, "rally");
  assert.deepEqual(m.score, before); // team 0 served and lost the rally: side out, no point
});

test("ball passing around the post below net height is not a net fault", () => {
  const m = singles();
  rally(m, 0);
  freeze(m);
  m.ball = { x: COURT.post + 0.4, y: 0.4, z: 0.05 };
  m.velocity = { x: 0, y: 1, z: -6 };
  step(m);
  assert.equal(m.phase, "rally");
});

test("an unplayed ball that strikes a player is that player's fault", () => {
  const m = singles(),
    b = m.players[1];
  rally(m, 0);
  freeze(m);
  b.pos = { x: 0, y: 0, z: -4 };
  m.ball = { x: 0, y: 1.0, z: -3.97 };
  m.velocity = { x: 0, y: 0, z: -6 };
  step(m);
  assert.match(m.message, /Ball hit B/);
});

test("far-team aim is mirrored so roll right sends the ball to the player's right", () => {
  const m = singles();
  for (const [team, sign] of [
    [0, 1],
    [1, -1],
  ] as const) {
    rally(m, 1 - team);
    m.bounces = 1;
    const p = m.players[team];
    p.pos = { x: 0, y: 0, z: team ? -4 : 4 };
    m.ball = {
      x: forehandSide(p) * FOREHAND_OFFSET,
      y: 0.8,
      z: p.pos.z,
    };
    p.lastHit = -10;
    assert.ok(hit(m, p, { ...ZERO_INPUT, strength: 0.4, roll: 30 }));
    assert.equal(Math.sign(m.velocity.x), sign, `team ${team}`);
  }
});

test("clean timing beats edge-of-reach contact", () => {
  const m = singles(),
    p = m.players[0];
  p.pos = { x: 0, y: 0, z: 4 };
  m.ball = { x: forehandSide(p) * FOREHAND_OFFSET, y: 0.9, z: 4 };
  const clean = contactQuality(m, p);
  m.ball = { x: 0.3, y: 0.9, z: 4 - 1.1 };
  const early = contactQuality(m, p);
  assert.ok(clean > 0.95, `clean ${clean}`);
  assert.ok(early < clean - 0.3, `early ${early}`);
});

test("a swing window waits for the best contact point, still one contact", () => {
  const m = singles(),
    p = m.players[0];
  rally(m, 1);
  m.bounces = 1;
  p.pos = { x: 0, y: 0, z: 4.1 };
  freeze(m);
  const fx = forehandSide(p) * FOREHAND_OFFSET;
  m.ball = { x: fx, y: 0.8, z: 2.95 }; // just inside reach, approaching
  m.velocity = { x: 0, y: 0, z: 7 };
  queueSwing(m, p, { ...ZERO_INPUT, strength: 0.5 });
  for (let i = 0; i < 15; i++) step(m);
  assert.equal(m.contacts, 1);
  assert.ok(m.quality > 0.8, `quality ${m.quality}`);
});

test("bots choose a variety of legal shots and matches finish", () => {
  for (const mode of ["solo", "coop"] as const) {
    const m = match(mode, "hard");
    m.players =
      mode === "solo"
        ? [player("a", "A", 0, true), player("b", "B", 1, true)]
        : [
            player("a", "A", 0, true),
            player("c", "C", 0, true),
            player("b", "B", 1, true),
            player("d", "D", 1, true),
          ];
    start(m);
    const shots = new Set<string>();
    for (let i = 0; i < 120 * 1500 && m.phase !== "over"; i++) {
      const c = m.contacts;
      step(m);
      if (m.contacts > c && m.hits > 1) shots.add(m.shot);
    }
    assert.equal(m.phase, "over", `${mode} did not finish: ${m.score}`);
    assert.ok(m.score.some((s) => s >= 11));
    assert.ok(Math.abs(m.score[0] - m.score[1]) >= 2);
    assert.ok(shots.size >= 3, `${mode} shots ${[...shots]}`);
  }
});

test("bot simulations replay deterministically from the match seed", () => {
  const run = () => {
    const m = match("solo", "medium");
    m.players = [player("a", "A", 0, true), player("b", "B", 1, true)];
    start(m);
    for (let i = 0; i < 120 * 120; i++) step(m);
    return JSON.stringify([m.score, m.contacts, m.ball]);
  };
  assert.equal(run(), run());
});

test("bot shots use the same input ranges a phone may send", () => {
  const m = singles("solo"),
    p = m.players[1];
  rally(m, 0);
  for (let i = 0; i < 200; i++) {
    m.ball = { x: 0, y: 0.4 + (i % 10) * 0.2, z: -4 };
    m.hits = 2 + (i % 3);
    const s = botShot(m, p);
    assert.ok(s.strength >= 0 && s.strength <= 1);
    assert.ok(Math.abs(s.direction) <= 1);
    assert.ok(Math.abs(s.roll) <= 180 && Math.abs(s.pitch) <= 180);
  }
});
