/**
 * Sportle Bowling: scoring, splits, turns (1–6 bowlers, drop/skip/rejoin), server-side arming,
 * release reading and pin physics. Sensor input here is synthetic (no phone hardware).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BowlReader,
  curveFrom,
  framePos,
  isSplit,
  learnBowls,
  scoreSheet,
  strikeRun,
} from "../src/shared/bowling.ts";
import type { BowlSample } from "../src/shared/bowling.ts";
import { pathAt, simulate } from "../src/server/bowlphysics.ts";
import { createBowlRoom, joinBowler, acceptInput } from "../src/server/rooms.ts";
import type { Room } from "../src/server/rooms.ts";
import { bowlInput, release, skipTurn, botForTurn, startBowl, stepBowl } from "../src/server/bowling.ts";
import { DEFAULT_GEAR } from "../src/shared/types.ts";
import type { Input } from "../src/shared/types.ts";

const total = (rolls: number[]) => scoreSheet(rolls).total;

test("scoring: perfect game, all spares, all gutters, tenth-frame bonus balls", () => {
  assert.equal(total(Array(12).fill(10)), 300);
  assert.equal(total(Array(21).fill(5)), 150);
  assert.equal(total(Array(20).fill(0)), 0);
  assert.ok(framePos(Array(20).fill(0)).done);
  // Tenth frame: strike earns two more balls; spare earns one; open earns none.
  const nine = Array(18).fill(0);
  assert.equal(total([...nine, 10, 10, 10]), 30);
  assert.equal(total([...nine, 7, 3, 5]), 15);
  assert.equal(total([...nine, 10, 3, 4]), 17);
  assert.deepEqual(framePos([...nine, 10]), { frame: 9, ball: 1, standing: 10, fresh: true, done: false });
  assert.deepEqual(framePos([...nine, 10, 3]), { frame: 9, ball: 2, standing: 7, fresh: false, done: false });
  assert.equal(framePos([...nine, 3, 4]).done, true);
  assert.equal(framePos([...nine, 7, 3]).done, false);
  // Marks on the sheet.
  const sheet = scoreSheet([...nine, 10, 10, 10]).frames[9].marks;
  assert.deepEqual(sheet, ["X", "X", "X"]);
  assert.deepEqual(scoreSheet([...nine, 7, 3, 0]).frames[9].marks, ["7", "/", "-"]);
  // A known game: X, 7/, 9-, X, X, X, 8/, 9/, X, X 9 1  → 211? check frame by frame.
  const g = [10, 7, 3, 9, 0, 10, 10, 10, 8, 2, 9, 1, 10, 10, 9, 1];
  const fr = scoreSheet(g).frames.map((f) => f.total);
  assert.deepEqual(fr, [20, 39, 48, 78, 106, 126, 145, 165, 194, 214]);
  // Bonus pending: a strike's frame has no total until two more balls.
  assert.equal(scoreSheet([10, 3]).frames[0].total, null);
  assert.equal(strikeRun([10, 10, 10]), 3);
  assert.equal(strikeRun([10, 0, 10]), 0); // 0 then 10 is a spare, not a strike
});

test("splits: 7-10, 4-6 and 2-7 are splits; adjacent leaves and head pin standing are not", () => {
  assert.equal(isSplit([6, 9]), true); // 7-10
  assert.equal(isSplit([3, 5]), true); // 4-6
  assert.equal(isSplit([1, 6]), true); // 2-7
  assert.equal(isSplit([3, 4]), false); // 4-5 side by side
  assert.equal(isSplit([0, 6, 9]), false); // head pin still up
  assert.equal(isSplit([9]), false);
});

// ——— Turns ———
let seq = 1;
/** Packets are spaced 20 ms apart on a test clock (the server drops packets < 15 ms apart). */
let clock = Date.now();
const packet = (extra: Partial<Input> = {}): Input => ({
  seq: seq++,
  t: (clock = Math.max(clock + 20, Date.now())),
  pitch: 0,
  roll: 0,
  yaw: 0,
  strength: 0.6,
  direction: 0,
  swing: false,
  sensors: true,
  calibrated: true,
  ...extra,
});
function room(n: number, mode: "game" | "practice" = "game") {
  const r = createBowlRoom(mode, "neon", "", 6);
  const creds: string[] = [];
  for (let i = 0; i < n; i++) {
    const j = joinBowler(r, "P" + (i + 1), "right", undefined, "", "classic", { ...DEFAULT_GEAR });
    creds.push(j.credential);
    Object.assign(j.player, { ready: true, sensors: true, calibrated: true, lastSeen: Date.now() });
  }
  return { r, creds };
}
const session = (r: Room, cred: string) => r.sessions.get(cred)!;
let swingId = 1;
/** Send a release from this phone through the real input path. */
const bowlFrom = (r: Room, cred: string, extra: Partial<Input> = {}) => {
  const a = packet({ swing: true, swingId: swingId++, ...extra });
  return acceptInput(r, session(r, cred), a, a.t);
};
/** Keep every phone live and run the server until the next "aim" (or game over). */
function runToAim(r: Room) {
  const b = r.bowl!;
  // A bot (or a bot bowling for someone) is "up": let it bowl first.
  for (let i = 0; i < 120 * 5 && b.phase === "aim"; i++) stepBowl(b);
  for (let i = 0; i < 120 * 20; i++) {
    for (const p of b.players) if (!p.bot && p.connected) p.lastSeen = Date.now();
    stepBowl(b);
    if (b.phase === "aim" || b.phase === "over") return;
  }
  throw Error("Stuck in " + b.phase);
}

test("turns: 1 to 6 bowlers alternate frame by frame; only the bowler who is up is armed", () => {
  for (let n = 1; n <= 6; n++) {
    const { r, creds } = room(n);
    const b = r.bowl!;
    startBowl(b);
    const order: string[] = [];
    for (let k = 0; k < n * 2; k++) {
      const up = b.turn;
      // Everyone else tries to bowl first: ignored on the server.
      for (let i = 0; i < n; i++) if (i !== up) bowlFrom(r, creds[i]);
      assert.equal(b.phase, "aim", "a phone that isn't up must not release");
      // The bowler who is up bowls a gutter (so frames stay two balls).
      bowlFrom(r, creds[up], { strength: 0.3, side: 1 });
      assert.equal(b.phase, "rolling");
      order.push(b.players[up].name);
      runToAim(r);
    }
    // Each bowler bowls two balls of frame 1, in order, then the next bowler.
    const expect = Array.from({ length: n }, (_, i) => ["P" + (i + 1), "P" + (i + 1)]).flat();
    assert.deepEqual(order, expect, `order with ${n} bowlers`);
    assert.equal(b.frame, n === 1 ? 1 : 1);
  }
});

test("turns: a dropped bowler is waited for, can be skipped or bowled for by a bot, and rejoins", () => {
  const { r, creds } = room(3);
  const b = r.bowl!;
  startBowl(b);
  // P1 bowls a frame.
  bowlFrom(r, creds[0], { side: 1 });
  runToAim(r);
  bowlFrom(r, creds[0], { side: 1 });
  runToAim(r);
  assert.equal(b.players[b.turn].name, "P2");
  // P2's phone goes away: the game waits and says so.
  b.players[1].connected = false;
  b.players[1].lastSeen = Date.now() - 10000;
  stepBowl(b, 1 / 120, Date.now());
  assert.match(b.message, /Waiting for P2/);
  // Host skips P2's turn: frame scored as open zeros, P3 is up.
  skipTurn(b);
  assert.deepEqual(b.players[1].rolls, [0, 0]);
  assert.equal(b.players[b.turn].name, "P3");
  bowlFrom(r, creds[2], { side: 1 });
  runToAim(r);
  bowlFrom(r, creds[2], { side: 1 });
  runToAim(r);
  // Frame 2: P1, then P2 is still away → a bot bowls the frame for them.
  bowlFrom(r, creds[0], { side: 1 });
  runToAim(r);
  bowlFrom(r, creds[0], { side: 1 });
  runToAim(r);
  assert.equal(b.players[b.turn].name, "P2");
  botForTurn(b);
  const before = b.players[1].rolls.length;
  runToAim(r); // the bot bowls ball 1 …
  if (b.players[b.turn].name === "P2") runToAim(r); // … and ball 2 unless it struck
  while (b.phase === "rolling" || b.players[b.turn].name === "P2") runToAim(r);
  assert.ok(b.players[1].rolls.length > before, "the bot's balls count for P2");
  assert.equal(b.players[1].botFor, false, "the bot only bowls that frame");
  // P2 rejoins with the same phone: same seat, same score.
  const again = joinBowler(r, "P2", "right", creds[1], "", "classic", { ...DEFAULT_GEAR });
  assert.equal(again.player.id, b.players[1].id);
  assert.equal(again.player.rolls.length, b.players[1].rolls.length);
});

test("turns: a full game ends after frame 10 with a winner; late joiner starts at the next frame", () => {
  const { r, creds } = room(2);
  const b = r.bowl!;
  startBowl(b);
  let guard = 0;
  while (b.phase !== "over" && guard++ < 200) {
    const up = b.turn;
    // P1 bowls into the pocket, P2 into the gutter.
    bowlFrom(r, creds[up], up === 0 ? { strength: 0.6, side: 0, hook: 0 } : { strength: 0.4, side: 1 });
    runToAim(r);
    if (guard === 3) {
      const late = joinBowler(r, "Late", "left", undefined, "", "classic", { ...DEFAULT_GEAR });
      Object.assign(late.player, { ready: true, sensors: true, calibrated: true });
      creds.push(late.credential);
      assert.ok(late.player.startFrame >= 1, "a late joiner starts at a later frame");
    }
  }
  assert.equal(b.phase, "over");
  assert.ok(b.players.every((p) => framePos(p.rolls).done));
  assert.ok(b.winners.includes(b.players[0].id));
  assert.equal(scoreSheet(b.players[1].rolls).total, 0);
});

test("practice: free bowls keep going and racks reset after two balls or a strike", () => {
  const { r, creds } = room(1, "practice");
  const b = r.bowl!;
  startBowl(b);
  for (let i = 0; i < 5; i++) {
    bowlFrom(r, creds[0], { side: 1 });
    runToAim(r);
  }
  assert.equal(b.phase, "aim");
  assert.equal(b.players[0].bowls, 5);
});

// ——— Release reading ———

/** A synthetic underhand bowl sampled at `hz`: backswing, then a forward swing. */
function bowlSamples(hz: number, opts: { peak: number; side: number; tilt: number }) {
  const out: BowlSample[] = [];
  const dt = 1000 / hz;
  for (let t = 0; t < 1100; t += dt) {
    let rad = 0.3,
      up = 0;
    if (t < 450) {
      rad = 3.6 * Math.sin((Math.PI * t) / 450);
      up = -0.8;
    } else if (t > 520 && t < 920) {
      rad = opts.peak * Math.sin((Math.PI * (t - 520)) / 400);
      up = 0.8;
    }
    out.push({
      t: 1000 + t,
      rad,
      strength: 0,
      direction: 0,
      side: 0,
      path: { side: up > 0 ? opts.side : 0, up },
      face: 1,
      pitch: 0,
      roll: opts.tilt,
      yaw: 0,
      twist: 0,
    });
  }
  return out;
}
const read = (samples: BowlSample[]) => {
  const r = new BowlReader();
  for (const s of samples) {
    const out = r.feed(s);
    if (out) return out;
  }
  return null;
};

test("release: the same bowl reads the same at 60 Hz and 120 Hz, at its peak", () => {
  for (const peak of [6, 9, 13]) {
    const a = read(bowlSamples(60, { peak, side: 0.2, tilt: 25 }))!,
      b = read(bowlSamples(120, { peak, side: 0.2, tilt: 25 }))!;
    assert.ok(a && b, "both rates read a bowl");
    assert.ok(Math.abs(a.speed - b.speed) < 0.04, `speed ${a.speed} vs ${b.speed}`);
    assert.ok(Math.abs(a.line - b.line) < 0.02);
    assert.ok(Math.abs(a.hook - b.hook) < 0.02);
    assert.ok(a.rad > peak * 0.9, "read near the peak, not at the trigger");
  }
  // Harder bowl → faster ball.
  const soft = read(bowlSamples(60, { peak: 6, side: 0, tilt: 0 }))!,
    hard = read(bowlSamples(60, { peak: 13, side: 0, tilt: 0 }))!;
  assert.ok(hard.speed > soft.speed + 0.3);
  // Upright = straight; tilted = hook toward the tilt.
  assert.equal(soft.hook, 0);
  assert.ok(read(bowlSamples(60, { peak: 9, side: 0, tilt: -30 }))!.hook < -0.5);
});

test("release: gentle waves and a swing with no backswing don't bowl", () => {
  assert.equal(read(bowlSamples(60, { peak: 3.5, side: 0, tilt: 0 })), null);
  const noBack = bowlSamples(60, { peak: 10, side: 0, tilt: 0 }).map((s) =>
    s.path.up < 0 ? { ...s, rad: 0.5 } : s,
  );
  assert.equal(read(noBack), null);
});

test("setup: two practice bowls learn the forward direction, speed and left/right sign", () => {
  const strip = (s: BowlSample[]) => s.map((q) => ({ up: q.path.up * -1, side: q.path.side, rad: q.rad }));
  // This phone reads the swing path upside down and left/right reversed.
  const res = learnBowls([
    strip(bowlSamples(60, { peak: 9, side: 0, tilt: 0 })),
    strip(bowlSamples(60, { peak: 9, side: 0.3, tilt: 0 })),
  ]);
  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.profile.upSign, -1);
    assert.equal(res.profile.sideSign, -1);
    assert.ok(res.profile.typical > 8);
  }
  assert.equal(learnBowls([strip(bowlSamples(60, { peak: 3, side: 0, tilt: 0 }))]).ok, false);
});

// ——— Physics ———

const aimAt = (x: number, hook: number, speed: number, target: number) => {
  let lo = -0.1,
    hi = 0.1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (pathAt({ x, speed, angle: m, hook }).x < target) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};

test("physics: straight phone → straight ball, tilted phone → hooking ball", () => {
  const straight = pathAt({ x: 0, speed: 8, angle: 0, hook: curveFrom(2) });
  const tilted = pathAt({ x: 0, speed: 8, angle: 0, hook: curveFrom(-25) });
  assert.ok(Math.abs(straight.x) < 0.01, "upright release rolls straight");
  assert.ok(tilted.x < -0.15, "tilted left hooks left");
  // The hook breaks late (back third, off the oil).
  const mid = pathAt({ x: 0, speed: 8, angle: 0, hook: -0.8 }, 9);
  assert.ok(Math.abs(mid.x) < Math.abs(tilted.x) * 0.25);
});

test("physics: a pocket hit at good speed strikes often; a gutter ball knocks nothing", () => {
  let strikes = 0,
    pins = 0;
  const angle = aimAt(0.3, -0.6, 8, 0.065);
  for (let s = 1; s <= 40; s++) {
    const r = simulate({ x: 0.3, speed: 8, angle, hook: -0.6 }, undefined, { seed: s * 977 });
    if (r.down === 10) strikes++;
    pins += r.down;
  }
  assert.ok(strikes >= 16, `pocket strikes ${strikes}/40`);
  assert.ok(pins / 40 > 8.5);
  // Same bowl, different seeds: similar, not identical.
  const results = new Set<number>();
  for (let s = 1; s <= 20; s++)
    results.add(simulate({ x: 0, speed: 8, angle: 0, hook: 0 }, undefined, { seed: s }).down);
  assert.ok(results.size > 1);
  const g = simulate({ x: 0.4, speed: 7, angle: 0.05, hook: 0 });
  assert.equal(g.gutter, true);
  assert.equal(g.down, 0);
});

test("bots bowl by themselves and hard bots score better than rookies", () => {
  const avg = (level: "easy" | "hard") => {
    let sum = 0;
    for (let k = 0; k < 3; k++) {
      const r = createBowlRoom("game", "neon", level, 1);
      const j = joinBowler(r, "Me", "right", undefined, "", "classic", { ...DEFAULT_GEAR });
      Object.assign(j.player, { ready: true, sensors: true, calibrated: true });
      const b = r.bowl!;
      b.seed = 1234 + k;
      startBowl(b);
      // The human skips every turn; only the bot bowls.
      let guard = 0;
      while (b.phase !== "over" && guard++ < 400) {
        if (b.phase === "aim" && b.players[b.turn] === j.player) skipTurn(b);
        else runToAim(r);
      }
      sum += scoreSheet(b.players[1].rolls).total;
    }
    return sum / 3;
  };
  const easy = avg("easy"),
    hard = avg("hard");
  assert.ok(hard > easy, `hard ${hard} vs easy ${easy}`);
  assert.ok(hard > 120);
});

test("release is applied once per swing id and never from a phone that isn't up", () => {
  const { r, creds } = room(2);
  const b = r.bowl!;
  startBowl(b);
  const p2 = b.players[1];
  assert.equal(bowlInput(b, p2, packet({ swing: true }), true), false);
  assert.equal(b.phase, "aim");
  // Same swing id twice → one ball.
  const s = session(r, creds[0]);
  let a = packet({ swing: true, swingId: 900 });
  acceptInput(r, s, a, a.t);
  const bowls = b.bowls;
  assert.equal(bowls, 1);
  runToAim(r);
  a = packet({ swing: true, swingId: 900 });
  acceptInput(r, s, a, a.t);
  assert.equal(b.bowls, bowls);
  const notUp = b.players.find((_, i) => i !== b.turn)!;
  assert.equal(release(b, notUp, { x: 0, speed: 8, angle: 0, hook: 0 }), false);
});
