import test from "node:test";
import assert from "node:assert/strict";
import {
  match,
  player,
  start,
  step,
  hit,
  feed,
  serve,
  movementTarget,
} from "../src/server/engine.ts";
import {
  rotateService,
  contactFault,
  landingFault,
  serviceX,
} from "../src/shared/rules.ts";
import {
  createRoom,
  joinController,
  begin,
  acceptInput,
  housekeeping,
  rooms,
} from "../src/server/rooms.ts";
import { ZERO_INPUT } from "../src/shared/types.ts";
import { MotionFilter } from "../src/shared/motion.ts";
import { qrMatrix } from "../src/client/qr.ts";
const singles = () => {
  const m = match("singles");
  m.players = [player("a", "A", 0), player("b", "B", 1)];
  start(m);
  return m;
};
const doubles = () => {
  const m = match("doubles");
  m.players = [
    player("a", "A", 0),
    player("b", "B", 1),
    player("c", "C", 0),
    player("d", "D", 1),
  ];
  start(m);
  return m;
};
test("traditional side-out scoring and win by two", () => {
  const m = singles();
  rotateService(m, 1);
  assert.deepEqual(m.score, [0, 0]);
  assert.equal(m.serving, 1);
  rotateService(m, 1);
  assert.deepEqual(m.score, [0, 1]);
  m.score = [10, 10];
  rotateService(m, 1);
  assert.notEqual(m.phase, "over");
  rotateService(m, 1);
  assert.equal(m.phase, "over");
  assert.equal(m.winner, 1);
});
test("singles service side alternates by server score", () => {
  const m = singles(),
    p = m.players[0];
  assert.ok(serviceX(m, p) > 0);
  rotateService(m, 0);
  assert.ok(serviceX(m, p) < 0);
});
test("doubles opens 0-0-2 then both servers get a turn", () => {
  const m = doubles();
  assert.equal(m.serverNumber, 2);
  assert.equal(m.serverId, "a");
  rotateService(m, 1);
  assert.equal(m.serverId, "b");
  assert.equal(m.serverNumber, 1);
  rotateService(m, 0);
  assert.equal(m.serverId, "d");
  assert.equal(m.serverNumber, 2);
  rotateService(m, 0);
  assert.equal(m.serverId, "a");
  assert.equal(m.serverNumber, 1);
});
test("doubles right player after odd score retains correct service order", () => {
  const m = doubles();
  rotateService(m, 0);
  assert.ok(serviceX(m, m.players[0]) < 0);
  rotateService(m, 1);
  rotateService(m, 0);
  rotateService(m, 0);
  assert.equal(m.serverId, "c");
});
test("serve and return must bounce; kitchen line is non-volley zone", () => {
  const m = singles(),
    p = m.players[1];
  m.hits = 1;
  m.bounces = 0;
  assert.equal(contactFault(m, p), "Two-bounce fault");
  m.hits = 2;
  assert.equal(contactFault(m, p), null);
  m.hits = 1;
  m.bounces = 1;
  assert.equal(contactFault(m, p), null);
  m.hits = 2;
  m.bounces = 0;
  p.pos.z = -2.2;
  assert.equal(contactFault(m, p), "Kitchen volley fault");
});
test("doubles correct receiver and diagonal serve including kitchen line", () => {
  const m = doubles();
  m.hits = 1;
  m.bounces = 1;
  const wrong = m.players.find((p) => p.team === 1 && p.id !== m.receiverId)!;
  assert.equal(contactFault(m, wrong), "Wrong receiver");
  m.lastTeam = 0;
  m.serveX = 1.5;
  assert.equal(landingFault(m, -1, -4), null);
  assert.equal(landingFault(m, 1, -4), "Service court fault");
  assert.equal(landingFault(m, -1, -2.1336), "Service court fault");
  assert.equal(landingFault(m, -3.048, -6.7056), null);
  assert.equal(landingFault(m, -3.049, -5), "Out");
});
test("stationary sensor stream never swings", () => {
  const f = new MotionFilter();
  f.orientation(20, 50, 10, 0);
  f.calibrate();
  for (let i = 0; i < 500; i++)
    assert.equal(
      f.motion(
        { x: 0, y: 0, z: 0 },
        { alpha: 0, beta: 0, gamma: 0 },
        0,
        i * 16,
      ),
      false,
    );
});
test("swing requires neutral rearm and cooldown", () => {
  const f = new MotionFilter();
  f.calibrate();
  f.motion({ x: 0, y: 0, z: 0 }, { alpha: 0, beta: 0, gamma: 0 }, 0, 0);
  assert.equal(
    f.motion({ x: 2, y: 0, z: 0 }, { alpha: 0, beta: 170, gamma: 0 }, 0, 400),
    true,
  );
  assert.equal(
    f.motion({ x: 2, y: 0, z: 0 }, { alpha: 0, beta: 170, gamma: 0 }, 0, 800),
    false,
  );
});
test("screen orientation axes normalize and neutral resets", () => {
  const f = new MotionFilter();
  f.orientation(0, 20, 10, 90);
  assert.ok(Math.abs(f.raw.pitch - 10) < 0.001);
  assert.ok(Math.abs(f.raw.roll + 20) < 0.001);
  f.calibrate();
  assert.equal(f.angle.pitch, 0);
});
test("no hit outside reach, no smash on low ball, power changes velocity", () => {
  const m = singles(),
    p = m.players[0];
  m.phase = "rally";
  m.hits = 3;
  m.bounces = 1;
  m.lastTeam = 1;
  m.ball = { x: 0, y: 0.8, z: 4 };
  p.pos = { x: 3, y: 0, z: 4 };
  assert.equal(hit(m, p, { ...ZERO_INPUT, strength: 0.8 }), false);
  p.pos.x = 0;
  assert.equal(
    hit(m, p, { ...ZERO_INPUT, strength: 0.3, direction: -1 }),
    true,
  );
  assert.notEqual(m.shot, "Smash");
  const soft = Math.hypot(m.velocity.x, m.velocity.y, m.velocity.z);
  m.time += 1;
  m.lastTeam = 1;
  m.ball = { x: 0, y: 0.8, z: 4 };
  m.bounces = 1;
  hit(m, p, { ...ZERO_INPUT, strength: 0.9, direction: 0 });
  assert.ok(Math.hypot(m.velocity.x, m.velocity.y, m.velocity.z) > soft);
});
test("fast net crossing collides rather than tunneling", () => {
  const m = singles();
  m.phase = "rally";
  m.hits = 3;
  m.lastTeam = 0;
  m.ball = { x: 0, y: 0.3, z: 0.1 };
  m.velocity = { x: 0, y: 0, z: -80 };
  step(m);
  assert.ok(m.ball.z > 0);
  assert.ok(m.velocity.z > 0);
});
test("momentum kitchen fault is enforced", () => {
  const m = singles();
  m.phase = "rally";
  const p = m.players[0];
  p.pos.z = 2.1;
  p.volleyMomentum = true;
  p.target = { ...p.pos };
  p.reactionAt = 100;
  step(m);
  assert.match(m.message, /Kitchen momentum/);
});
test("room assignment, start gate, authenticated slot reconnect", () => {
  const r = createRoom("doubles", "easy");
  const sessions = [];
  for (let i = 0; i < 4; i++)
    sessions.push(joinController(r, "P" + i, "right"));
  assert.deepEqual(
    r.state.players.map((p) => p.team),
    [0, 1, 0, 1],
  );
  assert.throws(() => joinController(r, "extra", "right"));
  assert.throws(() => begin(r));
  const old = sessions[2];
  r.state.players[2].connected = false;
  const rejoin = joinController(r, "ignored", "left", old.credential);
  assert.equal(rejoin.player.id, old.player.id);
  assert.equal(r.state.players.length, 4);
  assert.equal(rejoin.player.ready, false);
  assert.throws(() => joinController(r, "bad", "right", "invalid"));
  rooms.delete(r.code);
});
test("stale, duplicate, impossible input rejected and disconnect pauses", () => {
  const r = createRoom("solo", "easy"),
    j = joinController(r, "P", "left"),
    s = r.sessions.get(j.credential)!,
    now = Date.now();
  const a = { ...ZERO_INPUT, seq: 1, t: now, sensors: true, calibrated: true };
  assert.equal(acceptInput(r, s, a, now), true);
  assert.equal(acceptInput(r, s, a, now + 40), false);
  assert.equal(
    acceptInput(r, s, { ...a, seq: 2, t: now - 5000 }, now + 80),
    false,
  );
  assert.equal(
    acceptInput(r, s, { ...a, seq: 2, strength: Infinity }, now + 80),
    false,
  );
  j.player.ready = true;
  begin(r);
  housekeeping(r, now + 3000);
  assert.equal(r.state.paused, true);
  assert.equal(j.player.ready, false);
  rooms.delete(r.code);
});
test("assisted serve lands diagonally and reaches rally", () => {
  const m = singles();
  serve(m);
  for (let i = 0; i < 180 && m.bounces === 0 && m.phase === "rally"; i++)
    step(m);
  assert.equal(m.phase, "rally");
  assert.equal(m.bounces, 1);
  assert.ok(m.ball.x * m.serveX < 0);
});
test("QR has correct dimensions, finder patterns, capacity limit", () => {
  const q = qrMatrix("https://example.com/controller?room=ABC123#pair=abc");
  assert.equal(q.length, 41);
  assert.equal(q[0][0], true);
  assert.equal(q[1][1], false);
  assert.equal(q[3][3], true);
  assert.equal(q[34][34], true);
  assert.throws(() => qrMatrix("x".repeat(135)));
});
test("all modes build the correct roster and require exact human count", () => {
  for (const mode of [
    "practice",
    "solo",
    "singles",
    "coop",
    "doubles",
  ] as const) {
    const count =
      mode === "doubles" ? 4 : mode === "coop" || mode === "singles" ? 2 : 1;
    const r = createRoom(mode, "medium");
    for (let i = 0; i < count; i++) {
      const j = joinController(r, "P" + i, "right");
      j.player.ready = true;
      j.player.input = { ...ZERO_INPUT, sensors: true, calibrated: true };
    }
    begin(r);
    assert.equal(
      r.state.players.length,
      mode === "coop" || mode === "doubles" ? 4 : 2,
    );
    assert.equal(r.state.phase, "serve");
    rooms.delete(r.code);
  }
});
test("sensor loss pauses a live match and clears readiness", () => {
  const r = createRoom("solo", "easy"),
    j = joinController(r, "P", "right");
  j.player.ready = true;
  begin(r);
  const s = r.sessions.get(j.credential)!;
  acceptInput(r, s, { ...ZERO_INPUT, seq: 1, t: Date.now() }, Date.now());
  assert.equal(r.state.paused, true);
  assert.equal(j.player.ready, false);
  rooms.delete(r.code);
});
test("bots sustain rallies with bounded movement", () => {
  const m = match("solo", "medium");
  m.players = [player("a", "A", 0, true), player("b", "B", 1, true)];
  start(m);
  let rallyContacts = 0;
  for (let i = 0; i < 120 * 60; i++) {
    const before = m.contacts;
    const old = m.players.map((p) => ({ ...p.pos }));
    step(m);
    if (m.hits > 1 && m.contacts > before) rallyContacts++;
    if (m.phase === "rally")
      for (let j = 0; j < 2; j++)
        assert.ok(
          Math.hypot(
            m.players[j].pos.x - old[j].x,
            m.players[j].pos.z - old[j].z,
          ) < 0.04,
        );
  }
  assert.ok(rallyContacts >= 5, `Only ${rallyContacts} return contacts`);
});
test("a short swing window contacts an approaching ball without repeated hits", async () => {
  const { queueSwing } = await import("../src/server/engine.ts");
  const m = singles(),
    p = m.players[0];
  m.phase = "rally";
  m.hits = 3;
  m.lastTeam = 1;
  m.bounces = 1;
  m.ball = { x: 0, y: 0.7, z: 2.8 };
  m.velocity = { x: 0, y: 1, z: 7 };
  p.pos = { x: 0, y: 0, z: 4.1 };
  p.target = { ...p.pos };
  p.reactionAt = 100;
  queueSwing(m, p, { ...ZERO_INPUT, strength: 0.5 });
  assert.equal(m.contacts, 0);
  for (let i = 0; i < 15; i++) step(m);
  assert.equal(m.contacts, 1);
});
