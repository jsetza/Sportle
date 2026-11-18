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

test("far-team aim is mirrored so a swing to the right sends the ball to the player's right", () => {
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
    assert.ok(hit(m, p, { ...ZERO_INPUT, strength: 0.4, side: 0.8 }));
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
  m.ball = { x: fx, y: 0.8, z: 3.4 }; // inside reach, approaching (bounced: half speed)
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

test("keyboard movement: manual after first key press, speed-limited, own side only", async () => {
  const { setMove, HUMAN_SPEED } = await import("../src/server/engine.ts");
  const m = singles(),
    p = m.players[0];
  rally(m, 0);
  m.ball = { x: 3, y: 2, z: -5 };
  m.velocity = { x: 0, y: 0, z: 0 };
  p.pos = { x: 0, y: 0, z: 5 };
  m.players[1].target = { ...m.players[1].pos };
  m.players[1].reactionAt = 1e9;
  assert.equal(p.manual, false);
  // D = +x (screen right). One second of holding, refreshed like the display does.
  for (let i = 0; i < 120; i++) {
    if (i % 18 === 0) setMove(m, p, 1, 0);
    step(m);
  }
  assert.equal(p.manual, true);
  assert.ok(p.pos.x > 2.5, `moved ${p.pos.x}`);
  assert.ok(p.pos.x <= HUMAN_SPEED * 1.0 + 0.01);
  // Releasing keys: intent expires and the player stops (no auto-positioning any more).
  setMove(m, p, 0, 0);
  for (let i = 0; i < 120; i++) step(m);
  const x = p.pos.x;
  for (let i = 0; i < 60; i++) step(m);
  assert.ok(Math.abs(p.pos.x - x) < 1e-6);
  // W toward the net cannot cross it.
  for (let i = 0; i < 600; i++) {
    if (i % 18 === 0) setMove(m, p, 0, -1);
    step(m);
    if (m.phase !== "rally") break;
  }
  assert.ok(p.pos.z > 0, "stayed on own side");
});

test("keyboard: walking into the kitchen right after a volley is a momentum fault", async () => {
  const { setMove } = await import("../src/server/engine.ts");
  const m = singles(),
    p = m.players[0];
  rally(m, 1);
  freeze(m);
  p.manual = true;
  p.pos = { x: 0, y: 0, z: COURT.kitchen + 0.35 };
  p.volleyMomentum = true;
  p.momentumAt = m.time;
  m.ball = { x: 0, y: 3, z: -3 };
  m.velocity = { x: 0, y: 0, z: -1 };
  for (let i = 0; i < 40 && m.phase === "rally"; i++) {
    setMove(m, p, 0, -1);
    step(m);
  }
  assert.match(m.message, /Kitchen momentum/);
});

test("bots and untouched humans keep auto-positioning", () => {
  const m = singles(),
    p = m.players[0];
  rally(m, 1);
  m.bounces = 0;
  m.ball = { x: 1.5, y: 1.2, z: -3 };
  m.velocity = { x: 0.5, y: 2, z: 8 };
  p.pos = { x: -1, y: 0, z: 5 };
  const before = p.pos.x;
  for (let i = 0; i < 30; i++) step(m);
  assert.equal(p.manual, false);
  assert.ok(p.pos.x > before, "auto movement chased the ball");
});

test("display keyboard maps WASD/arrows to its own paired players only", async () => {
  const {
    createRoom,
    joinController,
    begin,
    issuePair,
    checkPair,
    acceptMove,
    localPlayers,
    rooms,
  } = await import("../src/server/rooms.ts");
  const r = createRoom("doubles", "easy");
  const host = r.sessions.get(r.host)!;
  const remote = {
    role: "display" as const,
    expires: Date.now() + 1e6,
    lastSeq: -1,
    lastInput: 0,
  };
  r.sessions.set("remote", remote);
  const hp = checkPair(r, issuePair(r, host, 0).pair);
  const rp = checkPair(r, issuePair(r, remote, 1).pair);
  const a1 = joinController(
    r,
    "A1",
    "right",
    undefined,
    hp.team,
    hp.display,
  ).player;
  const a2 = joinController(
    r,
    "A2",
    "right",
    undefined,
    hp.team,
    hp.display,
  ).player;
  const b1 = joinController(
    r,
    "B1",
    "right",
    undefined,
    rp.team,
    rp.display,
  ).player;
  const b2 = joinController(r, "B2", "left", undefined, null, "").player; // manual code
  assert.deepEqual(
    localPlayers(r, host).map((p) => p.name),
    ["A1", "A2", "B2"],
  );
  assert.deepEqual(
    localPlayers(r, remote).map((p) => p.name),
    ["B1"],
  );
  for (const p of r.state.players) {
    p.ready = true;
    p.lastSeen = Date.now();
  }
  begin(r);
  r.state.phase = "rally";
  // Host: WASD → A1, arrows → A2.
  assert.ok(
    acceptMove(r, host, {
      seq: 1,
      keys: [
        { slot: 0, x: 1, z: 0 },
        { slot: 1, x: 0, z: -1 },
      ],
    }),
  );
  assert.equal(a1.moveX, 1);
  assert.equal(a2.moveZ, -1);
  // Remote display: WASD → B1 only; its arrows map to nobody.
  assert.ok(
    acceptMove(r, remote, {
      seq: 1,
      keys: [
        { slot: 0, x: -1, z: 0 },
        { slot: 1, x: 1, z: 0 },
      ],
    }),
  );
  assert.equal(b1.moveX, -1);
  assert.equal(b2.moveX, 0);
  // Stale, malformed and out-of-range messages are rejected.
  assert.equal(acceptMove(r, host, { seq: 1, keys: [] }), false);
  assert.equal(
    acceptMove(r, host, { seq: 2, keys: [{ slot: 0, x: 5, z: 0 }] }),
    false,
  );
  assert.equal(
    acceptMove(r, host, { seq: 3, keys: [{ slot: 2, x: 0, z: 0 }] }),
    false,
  );
  const phone = r.sessions.get(
    [...r.sessions.keys()].find(
      (k) => r.sessions.get(k)!.role === "controller",
    )!,
  )!;
  assert.equal(
    acceptMove(r, phone, { seq: 9, keys: [{ slot: 0, x: 1, z: 0 }] }),
    false,
  );
  rooms.delete(r.code);
});

test("phone thumb pad moves the player relative to their facing; validated on input", async () => {
  const { createRoom, joinController, begin, acceptInput, rooms } =
    await import("../src/server/rooms.ts");
  const r = createRoom("singles", "easy");
  const a = joinController(r, "A", "right").player;
  const b = joinController(r, "B", "right").player;
  for (const p of r.state.players) {
    p.ready = true;
    p.lastSeen = Date.now();
  }
  begin(r);
  const m = r.state;
  m.phase = "rally";
  m.lastTeam = 0;
  m.ball = { x: 0, y: 3, z: 0.5 };
  m.velocity = { x: 0, y: 0, z: 0 };
  const sessions = [...r.sessions.values()].filter(
    (s) => s.role === "controller",
  );
  const sa = sessions.find((s) => s.playerId === a.id)!,
    sb = sessions.find((s) => s.playerId === b.id)!;
  const base = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    strength: 0,
    direction: 0,
    swing: false,
    sensors: true,
    calibrated: true,
  };
  let now = Date.now();
  const send = (s: typeof sa, extra: object) =>
    acceptInput(
      r,
      s,
      { ...base, seq: s.lastSeq + 1, t: now, ...extra } as never,
      (now += 20),
    );
  const za = a.pos.z,
    zb = b.pos.z;
  // Both push "forward" (thumb up): each runs toward the net from their own side.
  for (let i = 0; i < 40; i++) {
    assert.ok(send(sa, { ctl: 2, mx: 0, mz: 1 }));
    assert.ok(send(sb, { ctl: 2, mx: 0, mz: 1 }));
    // Keep the ball parked in the air so the rally does not end mid-test.
    m.ball = { x: 0, y: 3, z: -1 };
    m.velocity = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < 3; k++) step(m);
  }
  assert.equal(a.moveStyle, "phone");
  assert.ok(a.manual && b.manual);
  assert.ok(a.pos.z < za, "blue moved toward the net (-z)");
  assert.ok(b.pos.z > zb, "red moved toward the net (+z)");
  // Out-of-range thumb values and unknown styles are rejected.
  assert.equal(send(sa, { ctl: 2, mx: 3, mz: 0 }), false);
  assert.equal(send(sa, { ctl: 7 }), false);
  // Switching to automatic hands movement back to the policy.
  assert.ok(send(sa, { ctl: 0 }));
  assert.equal(a.manual, false);
  rooms.delete(r.code);
});

test("display keyboard only drives players whose style is keyboard", async () => {
  const { createRoom, joinController, begin, acceptMove, rooms } = await import(
    "../src/server/rooms.ts"
  );
  const r = createRoom("singles", "easy");
  const host = r.sessions.get(r.host)!;
  const a = joinController(r, "A", "right").player;
  const b = joinController(r, "B", "right").player;
  a.moveStyle = "phone";
  for (const p of r.state.players) {
    p.ready = true;
    p.lastSeen = Date.now();
  }
  begin(r);
  r.state.phase = "rally";
  // Fixed seats: WASD = player 1 (A), arrows = player 2 (B). A chose the phone pad, so
  // WASD does nothing; B chose keyboard, so the arrow keys move B.
  assert.ok(
    acceptMove(r, host, {
      seq: 1,
      keys: [
        { slot: 0, x: 1, z: 0 },
        { slot: 1, x: -1, z: 0 },
      ],
    }),
  );
  assert.equal(a.moveX, 0);
  assert.equal(b.moveX, -1);
  rooms.delete(r.code);
});

test("play again: rematch resets score with the same players after a finished game", async () => {
  const { createRoom, joinController, begin, rematch, rooms } = await import(
    "../src/server/rooms.ts"
  );
  const r = createRoom("solo", "easy");
  joinController(r, "A", "right");
  for (const p of r.state.players) {
    p.ready = true;
    p.lastSeen = Date.now();
  }
  begin(r);
  assert.throws(() => rematch(r), /still in progress/);
  r.state.score = [11, 6];
  r.state.phase = "over";
  r.state.winner = 0;
  const ids = r.state.players.map((p) => p.id);
  rematch(r);
  assert.deepEqual(r.state.score, [0, 0]);
  assert.equal(r.state.phase, "serve");
  assert.equal(r.state.winner, null);
  assert.deepEqual(
    r.state.players.map((p) => p.id),
    ids,
  );
  // A disconnected phone blocks the rematch.
  r.state.phase = "over";
  r.state.players[0].connected = false;
  assert.throws(() => rematch(r), /connected/);
  rooms.delete(r.code);
});

test("swing path steers the ball: left-to-right goes right, right-to-left goes left (both teams)", () => {
  for (const team of [0, 1]) {
    const results: number[] = [];
    for (const side of [1, -1, 0]) {
      const m = singles(),
        p = m.players[team];
      rally(m, 1 - team);
      m.bounces = 1;
      p.pos = { x: 0, y: 0, z: team ? -4 : 4 };
      m.ball = { x: forehandSide(p) * FOREHAND_OFFSET, y: 0.8, z: p.pos.z };
      p.lastHit = -10;
      assert.ok(hit(m, p, { ...ZERO_INPUT, strength: 0.5, side }));
      // Convert the world-space sideways velocity into the player's own left/right.
      results.push(m.velocity.x * (team ? -1 : 1));
    }
    const [right, left, straight] = results;
    assert.ok(right > 0.8, `team ${team} right ${right}`);
    assert.ok(left < -0.8, `team ${team} left ${left}`);
    assert.ok(
      Math.abs(straight) < Math.abs(right) / 2,
      `team ${team} straight ${straight}`,
    );
  }
});

test("shots are named forehand or backhand from the contact side and paddle hand", async () => {
  const { strokeSide } = await import("../src/server/engine.ts");
  const m = singles(),
    p = m.players[0];
  p.pos = { x: 0, y: 0, z: 4 };
  m.ball = { x: 0.5, y: 0.9, z: 4 }; // right of a right-hander facing the net
  assert.equal(strokeSide(m, p), "Forehand");
  m.ball.x = -0.5;
  assert.equal(strokeSide(m, p), "Backhand");
  p.hand = "left";
  assert.equal(strokeSide(m, p), "Forehand");
  // Central ball: the swing path decides (a right-hander's forehand swings toward the left).
  p.hand = "right";
  m.ball.x = 0;
  assert.equal(strokeSide(m, p, -1), "Forehand");
  assert.equal(strokeSide(m, p, 1), "Backhand");
  // The far team's right is world -x.
  const q = m.players[1];
  q.pos = { x: 0, y: 0, z: -4 };
  m.ball = { x: -0.5, y: 0.9, z: -4 };
  assert.equal(strokeSide(m, q), "Forehand");
  // Announcements carry the stroke.
  rally(m, 0);
  m.bounces = 1;
  q.lastHit = -10;
  assert.ok(hit(m, q, { ...ZERO_INPUT, strength: 0.6 }));
  assert.match(m.shot, /^Forehand drive$/);
});

test("auto positioning stands a step behind the bounce, not on top of the ball", () => {
  const m = singles(),
    p = m.players[0];
  rally(m, 1);
  m.bounces = 0;
  m.ball = { x: 0, y: 1.2, z: -2 };
  m.velocity = { x: 0, y: 2, z: 7 };
  const land = (() => {
    const g = 9.81,
      y = m.ball.y - COURT.radius,
      vy = m.velocity.y;
    const t = (vy + Math.sqrt(vy * vy + 2 * g * y)) / g;
    return m.ball.z + m.velocity.z * t;
  })();
  const t = movementTarget(m, p);
  assert.ok(t.z - land >= 0.9, `behind by ${t.z - land}`);
  assert.ok(
    Math.abs(t.x - m.ball.x) >= FOREHAND_OFFSET - 0.05,
    "beside the ball's path",
  );
});

test("players get half the error spread of bots for the same mistimed contact", () => {
  // Same off-centre contact, many trials: compare how far shots stray from the aim point.
  const spread = (bot: boolean) => {
    let sum = 0;
    for (let i = 0; i < 200; i++) {
      const m = singles();
      m.seed = 1000 + i;
      const p = m.players[0];
      p.bot = bot;
      rally(m, 1);
      m.bounces = 1;
      p.pos = { x: 0, y: 0, z: 4 };
      m.ball = { x: 0.95, y: 2.3, z: 3.5 }; // in reach, but late and high: poor contact
      p.lastHit = -10;
      assert.ok(hit(m, p, { ...ZERO_INPUT, strength: 0.7 }));
      const t = 1;
      sum += Math.abs(m.ball.x + m.velocity.x * t);
    }
    return sum / 200;
  };
  const human = spread(false),
    bot = spread(true);
  assert.ok(
    human < bot * 0.7,
    `human ${human.toFixed(2)} vs bot ${bot.toFixed(2)}`,
  );
});

test("badly timed contact can pop the ball up: high, short, past the kitchen", () => {
  let popups = 0,
    clean = 0;
  for (let i = 0; i < 120; i++) {
    const m = singles();
    m.seed = 77 + i;
    const p = m.players[0];
    rally(m, 1);
    m.bounces = 1;
    p.pos = { x: 0, y: 0, z: 4 };
    m.ball = { x: 0.95, y: 2.3, z: 3.5 }; // late and high: poor contact
    p.lastHit = -10;
    assert.ok(hit(m, p, { ...ZERO_INPUT, strength: 0.6 }));
    if (!m.popup) continue;
    popups++;
    assert.match(m.shot, /pop-up/);
    const apex = m.ball.y + (m.velocity.y * m.velocity.y) / (2 * 9.81);
    assert.ok(apex > 3, `apex ${apex}`);
    assert.ok(
      m.popupAt && m.popupAt.z < -(COURT.kitchen + 0.3),
      "comes down past the kitchen",
    );
  }
  // Clean contact never pops up.
  for (let i = 0; i < 40; i++) {
    const m = singles();
    m.seed = 500 + i;
    const p = m.players[0];
    rally(m, 1);
    m.bounces = 1;
    p.pos = { x: 0, y: 0, z: 4 };
    m.ball = { x: forehandSide(p) * FOREHAND_OFFSET, y: 0.9, z: 4 };
    p.lastHit = -10;
    hit(m, p, { ...ZERO_INPUT, strength: 0.6 });
    if (!m.popup) clean++;
  }
  assert.ok(popups > 25 && popups < 95, `popups ${popups}/120`);
  assert.equal(clean, 40);
});

test("auto mode runs to the smash spot and a downward swing smashes the pop-up", () => {
  let smashed = 0;
  for (let i = 0; i < 30; i++) {
    const m = singles();
    m.seed = 900 + i;
    const [a, b] = m.players;
    rally(m, 0);
    b.pos = { x: 0, y: 0, z: -4.5 };
    // A pops the ball up toward B.
    do {
      a.pos = { x: 0, y: 0, z: 4 };
      m.ball = { x: 0.95, y: 2.3, z: 3.5 };
      m.lastTeam = 1;
      m.bounces = 1;
      a.lastHit = -10;
      hit(m, a, { ...ZERO_INPUT, strength: 0.6 });
    } while (!m.popup && m.seed++);
    // B (auto movement) waits for the ball to drop to ~2 m in reach, then swings down.
    for (let k = 0; k < 400 && m.phase === "rally" && m.lastTeam === 0; k++) {
      step(m);
      const reach = Math.hypot(m.ball.x - b.pos.x, m.ball.z - b.pos.z);
      if (
        m.bounces === 0 &&
        m.velocity.y < 0 &&
        m.ball.y < 2.3 &&
        m.ball.y > 1.85 &&
        reach < 1.1 &&
        b.swingUntil < m.time
      )
        queueSwing(m, b, { ...ZERO_INPUT, strength: 0.7, direction: -0.4 });
    }
    if (/smash/.test(m.shot) && m.lastTeam === 1) smashed++;
  }
  assert.ok(smashed >= 20, `smashed ${smashed}/30`);
});

test("the slow bounce: same height and spot, longer hang (0.8 speed)", async () => {
  const { BOUNCE_TIME_SCALE } = await import("../src/server/engine.ts");
  assert.equal(BOUNCE_TIME_SCALE, 0.8);
  const m = singles();
  rally(m, 1);
  freeze(m);
  // Ball drops onto team 0's court from 1 m with no horizontal motion.
  m.ball = { x: 0, y: 1, z: 4 };
  m.velocity = { x: 0, y: 0, z: 0 };
  let bounceAt = -1,
    peak = 0,
    end = -1;
  for (let i = 0; i < 120 * 6 && m.phase === "rally"; i++) {
    step(m);
    if (m.bounces === 1 && bounceAt < 0) bounceAt = m.time;
    if (m.bounces === 1) peak = Math.max(peak, m.ball.y);
  }
  end = m.time;
  // Real ballistic time between bounces: 2·v/g with v = 0.76·sqrt(2·g·h).
  const v = 0.76 * Math.sqrt(2 * 9.81 * (1 - COURT.radius));
  const real = (2 * v) / 9.81;
  const hang = end - bounceAt;
  assert.ok(
    Math.abs(hang - real / BOUNCE_TIME_SCALE) < 0.06,
    `hang ${hang.toFixed(2)} vs ${(real / BOUNCE_TIME_SCALE).toFixed(2)}`,
  );
  // Same bounce height as before (0.76² of the drop, ±1 cm).
  assert.ok(
    Math.abs(peak - (COURT.radius + (v * v) / (2 * 9.81))) < 0.02,
    `peak ${peak}`,
  );
});

test("a swing repeated across packets is applied once; a stale packet cannot lose it", async () => {
  const { createRoom, joinController, begin, acceptInput, rooms } =
    await import("../src/server/rooms.ts");
  const r = createRoom("practice", "easy");
  const a = joinController(r, "A", "right").player;
  for (const p of r.state.players) {
    p.ready = true;
    p.lastSeen = Date.now();
  }
  begin(r);
  r.state.phase = "rally"; // swings only count during a rally
  const s = [...r.sessions.values()].find((x) => x.playerId === a.id)!;
  let now = Date.now();
  const base = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    strength: 0.6,
    direction: 0,
    sensors: true,
    calibrated: true,
  };
  const send = (seq: number, extra: object) =>
    acceptInput(
      r,
      s,
      { ...base, seq, t: now, swing: true, ...extra } as never,
      (now += 20),
    );
  // Packet 2 arrives first (packet 1 is late and gets rejected as stale): the swing still lands.
  assert.ok(send(2, { swingId: 1 }));
  const queued = a.swingUntil;
  assert.ok(queued > 0);
  assert.equal(send(1, { swingId: 1 }), false);
  // The third copy is accepted but does not start a second swing.
  a.swingUntil = 0;
  assert.ok(send(3, { swingId: 1 }));
  assert.equal(a.swingUntil, 0);
  // A new swing id is a new swing (after the short gap required between swings).
  r.state.time += 0.4;
  assert.ok(send(4, { swingId: 2 }));
  assert.ok(a.swingUntil > 0);
  rooms.delete(r.code);
});

test("swing reload: a player can swing again 0.2 s after the last swing, not sooner", async () => {
  const { SWING_RELOAD } = await import("../src/shared/types.ts");
  const { MotionFilter } = await import("../src/shared/motion.ts");
  assert.equal(SWING_RELOAD, 0.2);
  // Server side.
  const m = singles(),
    p = m.players[0];
  rally(m, 1);
  queueSwing(m, p, { ...ZERO_INPUT, strength: 0.5 });
  const first = p.swingAt;
  m.time += 0.15;
  queueSwing(m, p, { ...ZERO_INPUT, strength: 0.5 });
  assert.equal(p.swingAt, first, "too soon: ignored");
  m.time += 0.06; // 0.21 s after the first swing
  queueSwing(m, p, { ...ZERO_INPUT, strength: 0.5 });
  assert.ok(p.swingAt > first, "reloaded: accepted");
  // Phone side: the motion filter also re-arms after 0.2 s.
  const f = new MotionFilter();
  f.calibrated = true;
  const burst = (t: number) =>
    f.motion({ x: 0, y: 0, z: 0 }, { alpha: 0, beta: 300, gamma: 0 }, 0, t);
  const calm = (t: number) =>
    f.motion({ x: 0, y: 0, z: 0 }, { alpha: 0, beta: 0, gamma: 0 }, 0, t);
  assert.equal(burst(1000), true);
  calm(1050);
  calm(1080);
  assert.equal(burst(1150), false, "150 ms later: still reloading");
  calm(1170);
  calm(1190);
  assert.equal(burst(1210), true, "210 ms later: swing again");
});

test("volleys and overheads fly 1.75x faster; soft volleys keep their touch; still clear the net", async () => {
  const { VOLLEY_SPEEDUP } = await import("../src/server/engine.ts");
  assert.equal(VOLLEY_SPEEDUP, 1.75);
  const speedOf = (bounces: number, y: number, input: object) => {
    const m = singles(),
      p = m.players[0];
    rally(m, 1);
    m.bounces = bounces;
    p.pos = { x: 0, y: 0, z: 4 };
    m.ball = { x: forehandSide(p) * FOREHAND_OFFSET, y, z: 4 };
    p.lastHit = -10;
    assert.ok(hit(m, p, { ...ZERO_INPUT, ...input }));
    return { m, speed: Math.hypot(m.velocity.x, m.velocity.z) };
  };
  // Attacking volley vs the same drive off the bounce, same contact height.
  const ground = speedOf(1, 1.2, { strength: 0.6 }).speed;
  const volley = speedOf(0, 1.2, { strength: 0.6 });
  const ratio = volley.speed / ground;
  assert.ok(ratio > 1.4 && ratio <= 1.76, `volley ratio ${ratio.toFixed(2)}`);
  // The faster, flatter volley still clears the net.
  const m = volley.m;
  freeze(m);
  for (let i = 0; i < 240 && m.phase === "rally" && m.bounces === 0; i++)
    step(m);
  assert.doesNotMatch(m.message, /net/i);
  assert.equal(m.bounces, 1, "landed in the opponent's court");
  // Overhead: faster than the old smash speed.
  const smash = speedOf(0, 2.2, { strength: 0.7, direction: -0.8 });
  assert.match(smash.m.shot, /smash/);
  const oldSmashSpeed = Math.hypot(5.5 + 4, 0) / 0.58; // depth 5.5 from z=4, old 0.58 s flight
  assert.ok(
    smash.speed > oldSmashSpeed * 1.3,
    `smash ${smash.speed.toFixed(1)}`,
  );
  // A soft volley (dink) is not sped up.
  const dinkGround = speedOf(1, 0.9, { strength: 0.2 }).speed;
  const dinkVolley = speedOf(0, 0.9, { strength: 0.2 }).speed;
  assert.ok(Math.abs(dinkVolley / dinkGround - 1) < 0.05);
});
