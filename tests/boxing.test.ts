/**
 * Sportle Boxing: punch reading from SYNTHETIC motion (no phone hardware), guard and dodge
 * reading, hit/block/dodge/counter outcomes, stamina, knockdowns and the count, KO/TKO,
 * rounds and the decision, bots, two-phone gloves, drop → pause → rejoin and input checks.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOTS,
  COUNTER_BONUS,
  CHIP,
  PUNCH,
  PUNCH_TYPES,
  PoseReader,
  PunchReader,
  TKO_DOWNS,
  damage,
  learnPunches,
  outcome,
} from "../src/shared/boxing.ts";
import type { Box, Fighter, PunchType, ReadPunch } from "../src/shared/boxing.ts";
import type { Vec3 } from "../src/shared/motion.ts";
import {
  addBoxer,
  boxAway,
  boxInput,
  gloveOf,
  newBox,
  setReady,
  startBox,
  startDodge,
  stepBox,
  throwPunch,
} from "../src/server/boxing.ts";
import { acceptInput, createBoxRoom, joinBoxer } from "../src/server/rooms.ts";
import type { Room } from "../src/server/rooms.ts";
import { DEFAULT_GEAR } from "../src/shared/types.ts";

// ——— Synthetic phone ———
/** Phone upright, screen toward the thumb (inward) of a right hand; the player faces north. */
const AX = { X: [0, -1, 0] as Vec3, Y: [0, 0, 1] as Vec3, Z: [-1, 0, 0] as Vec3 };
/** Player frame [forward, right, up] → device frame for that pose (forward = north, right = east). */
const dev = (p: Vec3): Vec3 => {
  const w: Vec3 = [p[1], p[0], p[2]];
  return [AX.X[0] * w[0] + AX.X[1] * w[1] + AX.X[2] * w[2], AX.Y[0] * w[0] + AX.Y[1] * w[1] + AX.Y[2] * w[2], AX.Z[0] * w[0] + AX.Z[1] * w[1] + AX.Z[2] * w[2]];
};
/** World rotation (player frame: about forward, right, up; deg/s) → DeviceMotion rotationRate. */
const rate = (p: Vec3) => {
  const w: Vec3 = [p[1], p[0], p[2]];
  const d = (v: Vec3) => v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
  return { beta: d(AX.X), gamma: d(AX.Y), alpha: d(AX.Z) };
};
type Shape = (t: number) => { a: Vec3; w?: Vec3 };
/** A punch: half a sine of push then half of stopping, in direction `dir`, peak `A` m/s². */
const punchShape = (dir: Vec3, A: number, T = 0.1, spin: Vec3 = [0, 0, 0]): Shape => (t) => {
  if (t < 0 || t > 2 * T) return { a: [0, 0, 0] };
  const k = Math.sin((Math.PI * t) / T) * A;
  return { a: [dir[0] * k, dir[1] * k, dir[2] * k], w: t < 2 * T ? spin : [0, 0, 0] };
};
const SHAPES: Record<PunchType, (A: number) => Shape> = {
  jab: (A) => punchShape([1, 0, 0.05], A),
  hook: (A) => punchShape([0.4, -0.9, 0.05], A, 0.11, [0, 0, 520]),
  upper: (A) => punchShape([0.3, 0, 0.95], A, 0.11, [0, 420, 0]),
};
/** Feed a motion shape at `hz` for `dur` seconds; returns every punch read. */
function run(reader: PunchReader, shape: Shape, hz: number, dur: number, t0 = 0) {
  const out: ReadPunch[] = [];
  for (let i = 0; i <= dur * hz; i++) {
    const t = i / hz;
    const s = shape(t);
    const p = reader.feed(dev(s.a), rate(s.w ?? [0, 0, 0]), AX, (t0 + t) * 1000);
    if (p) out.push(p);
  }
  return out;
}
const fresh = () => {
  const r = new PunchReader("right");
  assert.ok(r.setForward(AX), "forward from the guard pose");
  return r;
};

test("punch reading: jab, hook and uppercut from synthetic motion", () => {
  for (const type of PUNCH_TYPES) {
    const got = run(fresh(), SHAPES[type](45), 60, 0.6);
    assert.equal(got.length, 1, type + ": one punch");
    assert.equal(got[0].type, type, type + " read as " + got[0].type);
    assert.ok(got[0].power > 0.4 && got[0].power < 0.9, type + " power " + got[0].power);
  }
  // Forward is learned from the guard pose: the default face matches an inward screen.
  assert.deepEqual(fresh().fwd.map((v) => Math.round(v)), [0, 1]);
});

test("punch reading: the same motion at 60 Hz and 120 Hz reads the same", () => {
  for (const type of PUNCH_TYPES) {
    const a = run(fresh(), SHAPES[type](40), 60, 0.6)[0],
      b = run(fresh(), SHAPES[type](40), 120, 0.6)[0];
    assert.equal(a.type, b.type, type);
    assert.ok(Math.abs(a.power - b.power) < 0.06, `${type}: ${a.power.toFixed(3)} vs ${b.power.toFixed(3)}`);
  }
  // Harder punches read stronger.
  const soft = run(fresh(), SHAPES.jab(30), 60, 0.6)[0],
    hard = run(fresh(), SHAPES.jab(65), 60, 0.6)[0];
  assert.ok(hard.power > soft.power + 0.25, `${soft.power} → ${hard.power}`);
});

test("punch reading: gentle shakes, walking and pulling back throw nothing", () => {
  const walk: Shape = (t) => ({ a: [1.5 * Math.sin(2 * Math.PI * 0.9 * t), 0.8 * Math.sin(2 * Math.PI * 0.9 * t + 1), 3.5 * Math.sin(2 * Math.PI * 1.8 * t) + (t % 0.55 < 0.04 ? 6 : 0)] });
  assert.equal(run(fresh(), walk, 60, 10).length, 0, "walking");
  const shake: Shape = (t) => ({ a: [5 * Math.sin(2 * Math.PI * 4 * t), 4 * Math.sin(2 * Math.PI * 5 * t), 3 * Math.sin(2 * Math.PI * 3 * t)] });
  assert.equal(run(fresh(), shake, 60, 6).length, 0, "gentle shake");
  // Pulling the fist back after a punch is not a second punch.
  const back = run(fresh(), punchShape([-1, 0, 0], 45), 60, 0.6);
  assert.equal(back.length, 0, "pull back");
});

test("punch reading: waggle spam stays weak and loses to one real punch", () => {
  const waggle: Shape = (t) => ({ a: [0, 30 * Math.sin(2 * Math.PI * 7 * t), 0] });
  const reads = run(fresh(), waggle, 60, 2);
  for (const p of reads) assert.ok(p.power < 0.2, "waggle power " + p.power);
  // Through the server: two seconds of waggle punches against an open opponent.
  const b = fight("versus");
  const [a, o] = b.fighters;
  let t = 0;
  for (const p of reads) {
    while (t < (reads.indexOf(p) + 1) * (2 / Math.max(1, reads.length))) {
      stepBox(b, 1 / 120);
      t += 1 / 120;
    }
    throwPunch(b, a, p.type, "right", p.power);
  }
  for (let i = 0; i < 120; i++) stepBox(b, 1 / 120);
  const spam = b.startHp - o.hp;
  const real = damage("hook", run(fresh(), SHAPES.hook(55), 60, 0.6)[0].power, 1, 1);
  assert.ok(spam < real, `2 s of waggles did ${spam.toFixed(1)}, one real hook ${real.toFixed(1)}`);
});

test("punch reading: learns this player's style from setup punches", () => {
  const r = fresh();
  const samples = PUNCH_TYPES.flatMap((type) => [40, 50].map((A) => ({ type, read: run(fresh(), SHAPES[type](A), 60, 0.6)[0] })));
  const res = learnPunches(samples, r.profile);
  assert.ok(res.ok);
  if (!res.ok) return;
  r.profile = res.profile;
  assert.ok(res.profile.gain >= 0.9 && res.profile.gain <= 1.2);
  PUNCH_TYPES.forEach((type, i) => assert.equal(run(r, SHAPES[type](45), 60, 0.6, 10 + i)[0]?.type, type));
  // A player whose hooks are loopier (more forward) still reads as hooks after learning.
  const loopy = (A: number) => punchShape([0.75, -0.55, 0.05], A, 0.11, [0, 0, 480]);
  const r2 = fresh();
  const res2 = learnPunches([...samples.filter((s) => s.type !== "hook"), ...[40, 50].map((A) => ({ type: "hook" as PunchType, read: run(fresh(), loopy(A), 60, 0.6)[0] }))], r2.profile);
  assert.ok(res2.ok);
  if (res2.ok) r2.profile = res2.profile;
  assert.equal(run(r2, loopy(45), 60, 0.6)[0].type, "hook");
});

test("guard and dodge reading from the phone's pose", () => {
  const p = new PoseReader();
  const up: Vec3 = [0, 0, 1];
  // Upright and still for 0.2 s → guard.
  let t = 0;
  for (; t < 150; t += 16) p.feed(up, 0.5, 10, t);
  assert.equal(p.guard, false, "not before 0.2 s");
  for (; t < 300; t += 16) p.feed(up, 0.5, 10, t);
  assert.equal(p.guard, true, "guard after 0.2 s still");
  // A punch-sized movement drops it.
  p.feed(up, 12, 300, (t += 16));
  assert.equal(p.guard, false, "guard drops when punching");
  // Fight stance (top edge tipped toward the TV) is not a guard.
  const stance: Vec3 = [0.7, 0, 0.71];
  for (let i = 0; i < 30; i++) p.feed(stance, 0.5, 10, (t += 16));
  assert.equal(p.guard, false);
  // Tip sideways → one slip; holding it doesn't repeat; back up re-arms.
  assert.equal(p.feed([0, 0.7, 0.7], 1, 30, (t += 16)), "right");
  for (let i = 0; i < 20; i++) assert.equal(p.feed([0, 0.7, 0.7], 1, 30, (t += 16)), null);
  p.feed(stance, 1, 30, (t += 16));
  assert.equal(p.feed([0, -0.75, 0.66], 1, 30, (t += 16)), "left");
  p.feed(stance, 1, 30, (t += 16));
  // Tip the top edge forward and down → duck.
  assert.equal(p.feed([0.97, 0, 0.2], 1, 30, (t += 16)), "duck");
});

test("outcomes: guard, slips, ducks and counters", () => {
  const open = { guard: false, dodge: "" as const, punching: false };
  assert.deepEqual(outcome("jab", open), { result: "hit", mult: 1 });
  assert.deepEqual(outcome("jab", { ...open, guard: true }), { result: "block", mult: CHIP });
  assert.equal(outcome("hook", { ...open, guard: true }).result, "around");
  assert.equal(outcome("upper", { ...open, guard: true }).result, "guardbreak");
  for (const dir of ["left", "right"] as const) {
    assert.equal(outcome("jab", { ...open, dodge: dir }).result, "dodge");
    assert.equal(outcome("upper", { ...open, dodge: dir }).result, "dodge");
    assert.equal(outcome("hook", { ...open, dodge: dir }).result, "hit", "hooks catch a slip");
  }
  assert.equal(outcome("jab", { ...open, dodge: "duck" }).result, "dodge");
  assert.equal(outcome("hook", { ...open, dodge: "duck" }).result, "dodge", "hooks can be ducked");
  assert.equal(outcome("upper", { ...open, dodge: "duck" }).result, "hit");
  assert.deepEqual(outcome("jab", { ...open, punching: true }), { result: "counter", mult: COUNTER_BONUS });
  // Jabs weakest, uppercuts strongest; effort matters a lot.
  assert.ok(damage("jab", 0.8, 1, 1) < damage("hook", 0.8, 1, 1) && damage("hook", 0.8, 1, 1) < damage("upper", 0.8, 1, 1));
  assert.ok(damage("hook", 0.1, 1, 1) < damage("hook", 0.8, 1, 1) * 0.15);
  assert.ok(PUNCH.jab.windup < PUNCH.hook.windup && PUNCH.hook.windup < PUNCH.upper.windup);
});

// ——— Server fights ———
/** Fights are seeded so every run is the same (BOX_SEED=<n> to try another). */
const SEED = Number(process.env.BOX_SEED) || 7;
function fight(mode: "versus" | "solo" | "training", opts: { hp?: number; roundTime?: number; bot?: string } = {}) {
  const b = newBox(mode, "neon", "club", (opts.bot ?? "zola") as never, "bag", opts);
  b.seed = SEED;
  const n = mode === "solo" ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const { fighter, glove } = addBoxer(b, "g" + i, ["Ana", "Ben"][i], "right", "classic", DEFAULT_GEAR);
    live(b, fighter);
    setReady(b, fighter, glove, true);
  }
  startBox(b);
  if (mode !== "training") for (let i = 0; i < 400 && b.phase === "intro"; i++) tick(b);
  return b;
}
/** Keep a fighter's phones live (as if they kept sending packets). */
function live(b: Box, f: Fighter, extra: Record<string, unknown> = {}) {
  for (const g of f.gloves) boxInput(b, f, g, { seq: 0, t: Date.now(), pitch: 0, roll: 0, yaw: 0, strength: 0, direction: 0, swing: false, sensors: true, calibrated: true, guard: false, ...extra } as never);
}
function tick(b: Box, n = 1) {
  for (let i = 0; i < n; i++) {
    for (const f of b.fighters) if (!f.bot && !f.botFor) for (const g of f.gloves) boxInput(b, f, g, { seq: 0, t: Date.now(), pitch: 0, roll: 0, yaw: 0, strength: 0, direction: 0, swing: false, sensors: true, calibrated: true, guard: (f as any)._guard ?? false, rise: (f as any)._rise ?? 0 } as never);
    stepBox(b, 1 / 120);
  }
}
const land = (b: Box, f: Fighter, type: PunchType, power = 0.8) => {
  throwPunch(b, f, type, "right", power);
  tick(b, Math.ceil((PUNCH[type].windup * 1.5 + 0.1 + PUNCH[type].recover) * 120));
};

test("fight: a jab lands, a guard blocks it, a counter does more", () => {
  const b = fight("versus");
  const [a, o] = b.fighters;
  assert.equal(b.phase, "fight");
  land(b, a, "jab");
  const hit = b.startHp - o.hp;
  assert.ok(hit > 2, "jab lowered health by " + hit);
  assert.equal(a.stats.landed, 1);
  assert.ok(b.callouts.some((c) => c.who === a.id && c.text === "JAB"));
  // Guard up (both phones' poses): the next jab is blocked and does chip damage only.
  (o as any)._guard = true;
  tick(b, 10);
  assert.ok(o.guard, "guard up");
  const before = o.hp;
  land(b, a, "jab");
  assert.ok(before - o.hp < hit * 0.4, "blocked: chip " + (before - o.hp));
  assert.equal(o.stats.blocked, 1);
  assert.ok(b.hits.some((h) => h.result === "block"));
  // Counter: hit Ben while his own hook is winding up.
  (o as any)._guard = false;
  tick(b, 60);
  const hp0 = o.hp;
  throwPunch(b, o, "upper", "left", 0.8);
  tick(b, 2);
  throwPunch(b, a, "jab", "right", 0.8);
  tick(b, 40);
  assert.equal(a.stats.counters, 1, "counter scored");
  assert.ok(hp0 - o.hp > hit * 1.2, "counter bonus");
  assert.ok(b.callouts.some((c) => c.who === a.id && c.text === "COUNTER!"));
});

test("fight: slips and ducks dodge, hooks beat slips", () => {
  const b = fight("versus");
  const [a, o] = b.fighters;
  startDodge(b, o, "duck");
  land(b, a, "hook");
  assert.equal(o.hp, b.startHp, "hook ducked");
  assert.equal(o.stats.dodged, 1);
  tick(b, 60);
  startDodge(b, o, "left");
  land(b, a, "hook");
  assert.ok(o.hp < b.startHp, "hook catches a slip");
});

test("stamina: flailing tires you, tired punches are weaker and slower, rest recovers", () => {
  // Training: no opponent to knock down while flailing.
  const b = fight("training");
  const [a] = b.fighters;
  const fresh = damage("hook", 0.8, a.stamina, 1);
  for (let i = 0; i < 14; i++) land(b, a, "upper", 0.9);
  assert.ok(a.stamina < 0.35, "tired: " + a.stamina);
  const tired = damage("hook", 0.8, a.stamina, 1);
  assert.ok(tired < fresh * 0.8, `${fresh.toFixed(1)} → ${tired.toFixed(1)}`);
  throwPunch(b, a, "jab", "right", 0.5);
  assert.ok(a.punch!.windup > PUNCH.jab.windup * 1.2, "slower wind-up when tired");
  const low = a.stamina;
  tick(b, 120 * 4);
  assert.ok(a.stamina > low + 0.5, "recovers when you stop");
});

test("knockdown, 10-count, getting up by moving the phone, KO and TKO", () => {
  // Down and up: shaking the phone fills the get-up meter.
  let b = fight("versus", { hp: 12 });
  let [a, o] = b.fighters;
  while (b.phase === "fight") land(b, a, "upper", 1);
  assert.equal(b.phase, "down");
  assert.equal(b.count.who, o.id);
  tick(b, 130);
  assert.equal(b.count.n, 2, "counting");
  (o as any)._rise = 1;
  for (let i = 0; i < 120 * 6 && b.phase === "down"; i++) tick(b);
  assert.equal(b.phase, "fight", "beat the count");
  assert.ok(o.hp > 0 && o.downs === 1);
  // KO: stays down through 10.
  b = fight("versus", { hp: 12 });
  [a, o] = b.fighters;
  while (b.phase === "fight") land(b, a, "upper", 1);
  tick(b, 120 * 10.5);
  assert.equal(b.phase, "over");
  assert.equal(b.result.how, "KO");
  assert.equal(b.result.winner, a.id);
  // TKO: the third knockdown in a round ends it.
  b = fight("versus", { hp: 12 });
  [a, o] = b.fighters;
  (o as any)._rise = 1;
  for (let k = 0; k < TKO_DOWNS && b.phase !== "over"; k++) {
    while (b.phase === "fight") land(b, a, "upper", 1);
    for (let i = 0; i < 120 * 8 && b.phase === "down"; i++) tick(b);
  }
  assert.equal(b.result.how, "TKO");
});

test("rounds, the break and a points decision", () => {
  const b = fight("versus", { roundTime: 10 });
  const [a, o] = b.fighters;
  land(b, a, "jab");
  land(b, a, "jab");
  land(b, o, "jab");
  for (let i = 0; i < 120 * 12 && b.phase === "fight"; i++) tick(b);
  assert.equal(b.phase as string, "break");
  assert.equal(b.round, 1);
  for (let i = 0; i < 120 * 12 && (b.phase as string) !== "fight"; i++) tick(b);
  assert.equal(b.round, 2);
  for (let r = 2; r <= 3; r++) for (let i = 0; i < 120 * 25 && (b.phase as string) !== "over" && b.round === r; i++) tick(b);
  assert.equal(b.phase as string, "over");
  assert.equal(b.result.how, "DECISION");
  assert.equal(b.result.winner, a.id, "more clean hits wins");
  assert.ok(b.result.scores[a.id] > b.result.scores[o.id]);
});

test("bots: every ladder bot fights, attacks and shows its tell; the ladder moves on", () => {
  for (const def of BOTS) {
    const b = fight("solo", { bot: def.id });
    const [h, bot] = b.fighters;
    assert.equal(bot.bot, def.id);
    const tells = new Set<string>();
    let guarded = 0,
      dodged = 0;
    for (let i = 0; i < 120 * 25 && b.phase !== "over"; i++) {
      tick(b);
      if (bot.tellAnim) tells.add(bot.tellAnim);
      if (bot.guard) guarded++;
      if (i % 180 === 0 && b.phase === "fight") throwPunch(b, h, ["jab", "hook", "upper"][i % 3] as PunchType, "right", 0.7);
      if (bot.dodge) dodged++;
    }
    assert.ok(bot.stats.thrown > 3, def.id + " attacks: " + bot.stats.thrown);
    assert.ok(h.hp < b.startHp, def.id + " lands something");
    if (def.id === "tortuga") assert.ok(guarded > 600 && tells.has("breathe"), "turtle guards and breathes: " + guarded);
    if (def.id === "zola") assert.ok(dodged > 0 && tells.has("bounce"), "zola slips and bounces");
    if (def.id === "dina") assert.ok(tells.has("dance"));
  }
  // Winning moves the ladder to the next opponent.
  const b = fight("solo", { hp: 10, bot: "zola" });
  const [h] = b.fighters;
  for (let i = 0; i < 400 && b.phase !== "over"; i++) {
    if (b.phase === "fight" && !h.punch) throwPunch(b, h, "upper", "right", 1);
    tick(b, 10);
  }
  if (b.phase === "over" && b.result.winner === h.id) {
    assert.ok(h.beat.includes("zola"));
  }
});

// ——— Phones and rooms ———
const input = (seq: number, extra: Record<string, unknown> = {}) => ({ seq, t: Date.now(), pitch: 0, roll: 0, yaw: 0, strength: 0, direction: 0, swing: false, sensors: true, calibrated: true, guard: false, ...extra });
function room(mode: "versus" | "solo" = "versus") {
  const r = createBoxRoom(mode, "neon", "club", "zola", "bag", {});
  r.pairs.set("P", { expires: Date.now() + 60000, team: null, display: "host" });
  return r;
}

test("two phones: left and right gloves for one fighter, guard needs both, rejoin keeps the glove", () => {
  const r: Room = room();
  const first = joinBoxer(r, "Ana", "right", undefined, "host", "classic", DEFAULT_GEAR, "");
  const second = joinBoxer(r, "", "right", undefined, "host", "classic", DEFAULT_GEAR, first.gloveCode);
  const b = r.box!;
  assert.equal(b.fighters.length, 1, "one fighter");
  const f = b.fighters[0];
  assert.deepEqual(f.gloves.map((g) => g.hand), ["right", "left"]);
  assert.throws(() => joinBoxer(r, "", "right", undefined, "host", "classic", DEFAULT_GEAR, first.gloveCode), /two gloves/);
  assert.throws(() => joinBoxer(r, "", "right", undefined, "host", "classic", DEFAULT_GEAR, "nope"), /glove code/);
  const s1 = r.sessions.get(first.credential)!,
    s2 = r.sessions.get(second.credential)!;
  assert.ok(acceptInput(r, s1, input(1, { guard: true }) as never));
  assert.ok(acceptInput(r, s2, input(1) as never));
  joinBoxer(r, "Ben", "right", undefined, "host", "classic", DEFAULT_GEAR, "");
  for (const g of f.gloves) setReady(b, f, g, true);
  const o = b.fighters[1];
  setReady(b, o, o.gloves[0], true);
  acceptInput(r, r.sessions.get([...r.sessions.entries()].find(([, s]) => s.playerId === o.gloves[0].id)![0])!, input(1) as never);
  startBox(b);
  for (let i = 0; i < 400 && b.phase === "intro"; i++) stepBox(b, 1 / 120);
  stepBox(b, 1 / 120);
  assert.equal(f.guard, false, "one glove up is not a guard");
  s1.lastInput = s2.lastInput = 0;
  acceptInput(r, s2, input(2, { guard: true }) as never);
  stepBox(b, 1 / 120);
  assert.equal(f.guard, true, "both gloves up");
  // A punch from the left-glove phone is a left punch, whatever it says.
  s2.lastInput = 0;
  acceptInput(r, s2, input(3, { punchId: 1, ptype: 0, phand: 1, power: 0.7, pt: Date.now() }) as never);
  assert.equal(f.punch?.hand, "left");
  // Rejoin with the saved credential: the same glove, press ids start again.
  const again = joinBoxer(r, "Ana", "right", second.credential, "host", "classic", DEFAULT_GEAR, "");
  assert.equal(again.player.id, second.player.id);
  for (let i = 0; i < 40; i++) stepBox(b, 1 / 120);
  s2.lastInput = 0;
  acceptInput(r, s2, input(4, { punchId: 1, ptype: 1, phand: 0, power: 0.7, pt: Date.now() }) as never);
  assert.equal(f.punch?.type, "hook", "punch id 1 accepted again after a reload");
});

test("drop → pause → resume, and the bot-for-now", () => {
  const b = fight("versus");
  const [a] = b.fighters;
  const now = Date.now();
  boxAway(b, now + 3000);
  stepBox(b, 1 / 120, now + 3000);
  assert.equal(b.paused, true, "paused while a phone is away");
  assert.equal(b.pauseReason, "away");
  assert.ok(a.away);
  const clock = b.clock;
  stepBox(b, 1 / 120, now + 3100);
  assert.equal(b.clock, clock, "clock stopped");
  for (const f of b.fighters) live(b, f);
  stepBox(b, 1 / 120);
  assert.equal(b.paused, false, "resumes when the phones are back");
});

test("input checks: phones not in the fight, bad fields, repeats and stale packets are ignored", () => {
  const r = room();
  const ana = joinBoxer(r, "Ana", "right", undefined, "host", "classic", DEFAULT_GEAR, "");
  joinBoxer(r, "Ben", "right", undefined, "host", "classic", DEFAULT_GEAR, "");
  const b = r.box!;
  for (const f of b.fighters) {
    live(b, f);
    setReady(b, f, f.gloves[0], true);
  }
  startBox(b);
  for (let i = 0; i < 400 && b.phase === "intro"; i++) stepBox(b, 1 / 120);
  const s = r.sessions.get(ana.credential)!;
  // A session that isn't a glove in this room.
  const stranger = { role: "controller" as const, playerId: "nobody", expires: Date.now() + 1e6, lastSeq: -1, lastInput: 0 };
  assert.equal(acceptInput(r, stranger, input(1, { punchId: 1, ptype: 0, phand: 1, power: 1, pt: Date.now() }) as never), false);
  assert.equal(acceptInput(r, s, input(1, { guard: "yes" }) as never), false, "bad guard");
  s.lastInput = 0;
  assert.equal(acceptInput(r, s, input(2, { punchId: 1, ptype: 5, phand: 1, power: 1, pt: Date.now() }) as never), false, "bad type");
  s.lastInput = 0;
  assert.equal(acceptInput(r, s, input(3, { punchId: 1, ptype: 0, phand: 1, power: 3, pt: Date.now() }) as never), false, "power over 1");
  s.lastInput = 0;
  assert.equal(acceptInput(r, s, { ...input(4, { punchId: 1, ptype: 0, phand: 1, power: 1, pt: Date.now() }), t: Date.now() - 5000 } as never), false, "stale");
  s.lastInput = 0;
  assert.equal(acceptInput(r, s, input(5, { punchId: 1, ptype: 0, phand: 1, power: 0.9, pt: Date.now() }) as never), true);
  const f = gloveOf(b, ana.player.id)!.fighter;
  assert.equal(f.stats.thrown, 1);
  // The same punch repeated in later packets is applied once.
  for (let i = 0; i < 40; i++) stepBox(b, 1 / 120);
  s.lastInput = 0;
  acceptInput(r, s, input(6, { punchId: 1, ptype: 0, phand: 1, power: 0.9, pt: Date.now() }) as never);
  assert.equal(f.stats.thrown, 1, "applied once");
  s.lastInput = 0;
  assert.equal(acceptInput(r, s, input(6) as never), false, "old sequence");
});

test("training: the bag shows every punch; the mitt drill scores matching moves", () => {
  const b = fight("training");
  const [a] = b.fighters;
  assert.equal(b.phase, "training");
  land(b, a, "hook", 0.75);
  assert.equal(a.drill!.count.hook, 1);
  assert.ok(b.callouts.some((c) => c.who === a.id && /^HOOK · \d+/.test(c.text)));
  const m = newBox("training", "neon", "club", "zola", "mitts");
  const { fighter, glove } = addBoxer(m, "g", "Ana", "right", "classic", DEFAULT_GEAR);
  live(m, fighter);
  setReady(m, fighter, glove, true);
  startBox(m);
  for (let i = 0; i < 240 && !fighter.drill!.call; i++) tick(m);
  const call = fighter.drill!.call;
  assert.ok(call, "coach calls a move");
  if (call === "jab" || call === "hook" || call === "upper") land(m, fighter, call);
  else if (call === "guard") {
    (fighter as any)._guard = true;
    tick(m, 90);
  } else {
    startDodge(m, fighter, call);
    tick(m, 5);
  }
  assert.ok(fighter.drill!.score >= 1, "scored " + call);
});
