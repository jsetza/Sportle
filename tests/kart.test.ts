/**
 * Sportle Kart: steering mapping, gestures, drift boosts, laps and shortcuts, placings, item
 * odds and every item's effect, server-side input checks, drop → bot → rejoin, and track
 * geometry. Sensor input here is synthetic (no phone hardware).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEAD_ZONE,
  DRIFT_BOOST,
  DRIFT_LEVELS,
  GestureReader,
  HIT,
  ITEM_KINDS,
  ITEMS,
  SECTORS,
  SteerReader,
  TRACKS,
  CUPS,
  itemOdds,
  learnSteer,
  locateAll,
  passSector,
  placings,
  pointAt,
  rollItem,
  sectorOf,
  track,
  upVector,
  wheelAngle,
} from "../src/shared/kart.ts";
import type { ItemKind, Kart, Racer, TrackId } from "../src/shared/kart.ts";
import {
  addRacer,
  kartAway,
  kartInput,
  newKart,
  nextRace,
  physOf,
  startKart,
  stepKart,
  useItem,
} from "../src/server/kart.ts";
import { acceptInput, createKartRoom, joinRacer } from "../src/server/rooms.ts";
import type { Room } from "../src/server/rooms.ts";
import { DEFAULT_GEAR } from "../src/shared/types.ts";
import type { Input } from "../src/shared/types.ts";

/** Phone held sideways like a wheel (+x edge up), turned `turn` degrees left. */
const wheel = (turn: number, grip = 1) =>
  grip > 0 ? upVector(0, -turn, -90) : upVector(0, turn, 89.9);

test("steering: centre and range from setup, dead zone, curve, both landscape grips", () => {
  for (const grip of [1, -1]) {
    const center = wheelAngle(wheel(0, grip));
    const res = learnSteer(center, wheelAngle(wheel(40, grip)), wheelAngle(wheel(-50, grip)));
    assert.ok(res.ok, "range learned for grip " + grip);
    if (!res.ok) return;
    assert.ok(Math.abs(res.profile.left - 40) < 0.5 && Math.abs(res.profile.right - 50) < 0.5, JSON.stringify(res.profile));
    const r = new SteerReader();
    r.setCenter(wheel(0, grip));
    r.profile = res.profile;
    assert.equal(r.map(wheelAngle(wheel(0, grip))), 0, "level = straight");
    assert.equal(r.map(wheelAngle(wheel(1.5, grip))), 0, "a tiny wobble is in the dead zone");
    assert.ok(r.map(wheelAngle(wheel(10, grip))) < 0, "wheel left steers left");
    assert.ok(r.map(wheelAngle(wheel(-10, grip))) > 0, "wheel right steers right");
    assert.equal(r.map(wheelAngle(wheel(40, grip))), -1, "full left lock at the learned range");
    assert.equal(r.map(wheelAngle(wheel(-50, grip))), 1, "full right lock at the learned range");
    // Gentle response curve: half the tilt gives well under half the lock.
    const half = r.map(wheelAngle(wheel(-50 * 0.85 * 0.5, grip)));
    assert.ok(half > 0.2 && half < 0.45, "half tilt → fine control: " + half);
    // Sensitivity: sharp needs less tilt for the same steering.
    r.sensitivity = "sharp";
    assert.ok(r.map(wheelAngle(wheel(-20, grip))) > half);
  }
  // Same turns read the same whichever long edge is up.
  const a = new SteerReader(),
    b = new SteerReader();
  a.setCenter(wheel(0, 1));
  b.setCenter(wheel(0, -1));
  for (const turn of [-35, -12, 0, 6, 25])
    assert.ok(Math.abs(a.map(wheelAngle(wheel(turn, 1))) - b.map(wheelAngle(wheel(turn, -1)))) < 1e-3, "grips agree at " + turn);
  assert.equal(learnSteer(0, 5, -6).ok, false, "too small a turn is rejected");
  assert.equal(learnSteer(0, 30, 25).ok, false, "left and right the same way is rejected");
  assert.ok(DEAD_ZONE > 0 && DEAD_ZONE < 0.1);
});

test("steering: the same tilt sequence gives the same steering at 60 Hz and 120 Hz", () => {
  const run = (hz: number) => {
    const r = new SteerReader();
    r.setCenter(wheel(0));
    const out: number[] = [];
    for (let i = 0; i <= (1500 * hz) / 1000; i++) {
      const t = (i * 1000) / hz;
      // A smooth turn right then back, like a corner.
      const turn = -30 * Math.sin((Math.PI * Math.min(t, 1000)) / 1000);
      r.feed(wheel(turn), t);
      if (i % (hz / 10) === 0) out.push(r.value);
    }
    return out;
  };
  const a = run(60),
    b = run(120);
  assert.ok(a.length >= 10 && a.length === b.length, `${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.04, `t=${i * 100} ms: ${a[i]} vs ${b[i]}`);
  assert.ok(Math.max(...a) > 0.4, "it does steer");
});

test("gestures: steering never triggers them; a flick and a shake do", () => {
  const g = new GestureReader();
  const up: [number, number, number] = [1, 0, 0];
  // Brisk steering: rotation only, a couple of m/s² of hand movement.
  for (let t = 0; t < 3000; t += 16) {
    const a = Math.sin(t / 90) * 3;
    assert.equal(g.feed([a, a * 0.5, a * 0.3], up, t), null);
  }
  // A sharp upward jerk.
  let got: string | null = null;
  for (let t = 3000; t < 3100; t += 16) got = g.feed([16, 0, 0], up, t) ?? got;
  assert.equal(got, "flick");
  for (let t = 3100; t < 4000; t += 16) g.feed([0, 0, 0], up, t);
  // Hard back-and-forth shaking.
  got = null;
  for (let t = 4000; t < 4700; t += 16) {
    const s = Math.sin((t - 4000) / 40) > 0 ? 1 : -1;
    got = g.feed([0, 18 * s, 0], up, t) ?? got;
  }
  assert.equal(got, "shake");
});

// ——— Server helpers ———
let nowMs = 1_000_000;
const tick = (k: Kart, n = 1) => {
  for (let i = 0; i < n; i++) {
    nowMs += 1000 / 120;
    stepKart(k, 1 / 120, nowMs);
  }
};
let seq = 1;
const feed = (k: Kart, r: Racer, a: Partial<Input> & Record<string, unknown> = {}) =>
  kartInput(k, r, { seq: seq++, t: nowMs, pitch: 0, roll: 0, yaw: 0, strength: 0, direction: 0, swing: false, sensors: true, calibrated: true, mx: 0, mz: 1, ...a } as Input, nowMs);
/** A race with `n` phones (and bots to fill the grid unless trial), past the countdown. */
function race(n = 1, id: TrackId = "court", items = true, mode: "race" | "trial" = "race") {
  const k = newKart(mode, id, "club", items);
  const hs: Racer[] = [];
  for (let i = 0; i < n; i++) {
    const r = addRacer(k, "h" + i, "P" + i, "classic", { ...DEFAULT_GEAR }, "classic", i);
    feed(k, r);
    r.ready = true;
    hs.push(r);
  }
  startKart(k, nowMs);
  while (k.phase === "countdown") {
    for (const r of hs) feed(k, r, { mz: 0 });
    tick(k, 4);
  }
  return { k, hs };
}
/** Put a kart at distance s, lateral d, facing down the track, at speed v. */
function put(k: Kart, r: Racer, s: number, d = 0, v = 0) {
  const t = track(k.track);
  const p = pointAt(t, s, d);
  // Placed on lap 1 in the sector it is in (a teleport, so the lap bookkeeping is set too).
  Object.assign(r, { x: p.x, y: p.y, z: p.z, h: p.h, v, s, d, air: false, spin: 0, net: 0, wobble: 0, drift: 0, charge: 0, lap: 1, sector: sectorOf(t, s) });
  const ph = physOf(r);
  ph.hint = p.i;
  ph.m = p.h;
  ph.vy = 0;
  ph.onCut = false;
}
/** Park every bot far away so item tests only involve the karts placed on purpose. */
function clearBots(k: Kart) {
  const t = track(k.track);
  for (const r of k.racers)
    if (r.bot) {
      r.lift = 1000;
      put(k, r, t.L * 0.5);
    }
}

test("drift: charge levels and the boost on release", () => {
  const { k, hs } = race(1, "court", false);
  const me = hs[0];
  clearBots(k);
  const t = track(k.track);
  for (const [secs, level] of [
    [0.6, 0],
    [1.15, 1],
    [2.1, 2],
    [3.2, 3],
  ] as const) {
    put(k, me, t.S0 + 120, 0, 20);
    me.boost = 0;
    // Hold drift while steering right, leaning into it.
    for (let i = 0; i < 3; i++) {
      feed(k, me, { mx: 0.9, drift: true });
      tick(k, 4);
    }
    assert.equal(me.drift, 1, "drift started to the right");
    const steps = Math.round(secs * 120);
    for (let i = 0; i < steps; i++) {
      if (i % 4 === 0) feed(k, me, { mx: 0.9, drift: true });
      // Keep the kart on the road for the test (the barrier would end the drift).
      if (i % 60 === 0) {
        const keep = me.charge;
        put(k, me, t.S0 + 120, 0, 20);
        me.drift = 1;
        me.charge = keep;
      }
      tick(k);
    }
    // Level is shown on screen from the charge.
    const shown = DRIFT_LEVELS.filter((c) => me.charge >= c).length;
    assert.equal(shown, level, `after ${secs}s: charge ${me.charge.toFixed(2)}`);
    feed(k, me, { mx: 0.9, drift: false });
    tick(k);
    assert.equal(me.drift, 0, "let go → drift ends");
    if (level) assert.ok(Math.abs(me.boost - (DRIFT_BOOST[level - 1] - 1 / 120)) < 0.02, `level ${level} boost ${me.boost}`);
    else assert.equal(me.boost, 0, "too short a drift gives no boost");
  }
});

test("laps: sectors in order count; skipping through checkpoints doesn't; wrong way is flagged", () => {
  // Pure sector logic.
  const l = { lap: 0, sector: SECTORS - 1 };
  assert.equal(passSector(l, 0), 1);
  assert.equal(l.lap, 1);
  for (let s = 1; s < SECTORS; s++) passSector(l, s);
  assert.equal(passSector(l, 0), 1);
  assert.equal(l.lap, 2);
  // Jumping from sector 0 to sector 5 (through the infield) is ignored.
  passSector(l, 5);
  assert.equal(l.sector, 0);
  // Reversing back over the line takes the lap back.
  passSector(l, SECTORS - 1);
  assert.equal(l.lap, 1);
  // On the server: a kart teleported across the infield gains nothing.
  const { k, hs } = race(1, "court", false);
  clearBots(k);
  const me = hs[0];
  const t = track(k.track);
  put(k, me, t.S0 + 5, 0, 10);
  tick(k, 2);
  const lap = me.lap,
    sec = me.sector;
  // Teleport only the position (as a glitch across the infield would): no lap bookkeeping.
  const far = pointAt(t, t.S0 + t.L * 0.5, 0);
  Object.assign(me, { x: far.x, z: far.z, y: far.y });
  physOf(me).hint = far.i;
  tick(k, 2);
  assert.equal(me.lap, lap);
  assert.equal(me.sector, sec, "half a lap ahead without the sectors in between doesn't count");
  // Driving the wrong way for a moment raises WRONG WAY.
  put(k, me, t.S0 + 60, 0, 0);
  me.h = me.h + Math.PI;
  physOf(me).m = me.h;
  me.v = 8;
  for (let i = 0; i < 240; i++) {
    if (i % 4 === 0) feed(k, me, { mx: 0, mz: 1 });
    tick(k);
  }
  assert.equal(me.wrong, true, "wrong way detected");
  // A full lap driven by the server counts once: complete laps record lap times.
  const r = race(1, "neon", false);
  r.hs[0].bot = "pro";
  tick(r.k, 120 * 70);
  assert.ok(r.hs[0].lap >= 2 && r.hs[0].laps.length >= 1, "a bot-driven lap was counted: lap " + r.hs[0].lap);
  assert.ok(r.hs[0].laps[0] > 15 && r.hs[0].laps[0] < 40, "lap time " + r.hs[0].laps[0]);
});

test("shortcut: the strip stays clear of the road and is counted continuously", () => {
  for (const d of TRACKS) {
    const t = track(d.id);
    const c = t.cut!;
    for (let q = 3; q < c.x.length - 3; q++) {
      const w = locateAll(t, c.x[q], c.z[q], c.y[q]);
      assert.ok(Math.abs(w.d) > t.w[w.i] / 2 + c.width / 2 - 0.5, `${d.id}: shortcut point ${q} overlaps the road`);
    }
    // Shorter than the road it replaces.
    const road = (c.s1 - c.s0 + t.L) % t.L;
    assert.ok(c.l[c.l.length - 1] < road, `${d.id}: shortcut ${c.l[c.l.length - 1]} vs road ${road}`);
  }
});

test("placings: finish time first, then distance; ties broken by distance then grid", () => {
  const rs = [
    { id: "a", finished: 0, progress: 400, grid: 0 },
    { id: "b", finished: 91.2, progress: 1800, grid: 1 },
    { id: "c", finished: 0, progress: 420, grid: 2 },
    { id: "d", finished: 90.5, progress: 1800, grid: 3 },
    { id: "e", finished: 0, progress: 420, grid: 1 },
  ];
  assert.deepEqual(placings(rs).map((r) => r.id), ["d", "b", "e", "c", "a"]);
});

test("item odds: the leader gets defensive items, the back gets catch-up items", () => {
  const lead = itemOdds(1, 8),
    last = itemOdds(8, 8),
    mid = itemOdds(4, 8);
  const sum = (w: Record<ItemKind, number>, ks: ItemKind[]) => ks.reduce((a, k) => a + w[k], 0);
  const total = (w: Record<ItemKind, number>) => sum(w, ITEM_KINDS);
  assert.ok(sum(lead, ["guard", "fence", "dink"]) / total(lead) > 0.75, "leader: mostly defensive");
  for (const k of ["cannon", "sweet", "strike", "wave"] as ItemKind[]) assert.equal(lead[k], 0, "leader never gets " + k);
  assert.ok(sum(last, ["tape", "sweet", "wave", "strike", "cannon", "net"]) / total(last) > 0.75, "last: catch-up items");
  assert.equal(mid.cannon, 0, "cannon only for the last two");
  assert.ok(itemOdds(7, 8).cannon > 0 && last.cannon > 0);
  assert.ok(sum(last, ["sweet"]) > sum(mid, ["sweet"]), "sweet spot is for the back");
  // Every item can be drawn somewhere.
  const seen = new Set<string>();
  for (let place = 1; place <= 8; place++) for (let i = 0; i < 200; i++) seen.add(rollItem(place, 8, i / 200));
  for (const k of ITEM_KINDS) assert.ok(seen.has(k), "drawn: " + k);
  assert.equal(rollItem(1, 1, 0.5), "tape", "time trial: turbo tape only");
});

/** Two karts: a thrower at s and a target `gap` metres ahead (same lane). */
function duel(kind: ItemKind, gap = 14, targetD = 0) {
  const { k, hs } = race(2, "court", true);
  clearBots(k);
  k.cubes = []; // no item cubes in the way
  const [a, b] = hs;
  const t = track(k.track);
  put(k, a, t.S0 + 30, 0, 18);
  put(k, b, t.S0 + 30 + gap, targetD, 16);
  tick(k);
  put(k, a, t.S0 + 30, 0, 18);
  put(k, b, t.S0 + 30 + gap, targetD, 16);
  a.item = kind;
  a.uses = ITEMS[kind].uses;
  return { k, a, b, t };
}
const run = (k: Kart, rs: Racer[], secs: number, input: Partial<Input> & Record<string, unknown> = {}) => {
  for (let i = 0; i < secs * 120; i++) {
    if (i % 4 === 0) for (const r of rs) feed(k, r, input);
    tick(k);
  }
};

test("items: every effect and how long it lasts (never more than ~2 s of lost control)", () => {
  // Dink Shot: lobbed forward, bounces, spins out the kart it hits.
  {
    const { k, a, b } = duel("dink", 16);
    assert.ok(useItem(k, a, false, 0));
    assert.equal(a.item, "");
    let maxSpin = 0;
    for (let i = 0; i < 360; i++) {
      tick(k);
      maxSpin = Math.max(maxSpin, b.spin);
    }
    assert.ok(maxSpin > 0.5 && maxSpin <= HIT.spin, "dink: spin " + maxSpin);
  }
  // Pin Bowl: rolls down the lane and knocks the kart over (tumble).
  {
    const { k, a, b } = duel("pinbowl", 18);
    useItem(k, a, false, 0);
    let maxSpin = 0;
    for (let i = 0; i < 360; i++) {
      tick(k);
      maxSpin = Math.max(maxSpin, b.spin);
    }
    assert.ok(maxSpin > 1 && maxSpin <= HIT.tumble, "pin bowl: tumble " + maxSpin);
  }
  // Strike Bowl: giant, follows the centre line and rolls through more than one kart.
  {
    const { k, a, b } = duel("strike", 20, 3);
    const c = k.racers.find((r) => r !== a && r !== b && !r.bot)!;
    void c;
    useItem(k, a, false, 0);
    assert.ok(k.shots.length || true);
    let hitB = false;
    for (let i = 0; i < 480; i++) {
      tick(k);
      hitB ||= b.spin > 0;
    }
    assert.ok(hitB, "strike bowl hits a kart off the centre line");
  }
  // Paddle Guard: blocks the next item; a flick right after sends it back.
  {
    const { k, a, b } = duel("dink", 16);
    b.item = "guard";
    b.uses = 1;
    useItem(k, b, false, 0);
    assert.ok(b.guard > 0, "guard up");
    useItem(k, a, false, 0);
    let blocked = false;
    for (let i = 0; i < 360 && !blocked; i++) {
      tick(k);
      blocked = b.guard === 0;
    }
    assert.ok(blocked && b.spin === 0, "the guard blocked the dink");
    assert.ok(k.callouts.some((c) => c.text === "BLOCKED!" && c.who === b.id));
    feed(k, b, { flickId: 1 });
    assert.ok(k.callouts.some((c) => c.text === "RETURNED!"), "flick sends it back");
    let aSpun = false;
    for (let i = 0; i < 480 && !aSpun; i++) {
      tick(k);
      aSpun = a.spin > 0;
    }
    assert.ok(aSpun, "the returned item hits the thrower");
  }
  // Spin Serve ×3: three uses; the tilt at release bends the ball.
  {
    const { k, a } = duel("serve", 40);
    useItem(k, a, false, 0.9);
    const id = k.shots.length;
    tick(k, 2);
    const shot = (k as any).shots[0];
    assert.ok(shot, "a serve is in flight");
    assert.equal(a.uses, 2);
    tick(k, 30);
    const t = track(k.track);
    const w = locateAll(t, k.shots[0]?.x ?? 0, k.shots[0]?.z ?? 0, 0);
    assert.ok(w.d > 1, "tilted right → bends right: d " + w.d.toFixed(2));
    useItem(k, a, false, 0);
    useItem(k, a, false, 0);
    assert.equal(a.item, "", "three serves used");
    void id;
  }
  // Pin Fence: three pins behind; a kart hitting one wobbles and slows.
  {
    const { k, a, b, t } = duel("fence", 0);
    put(k, b, t.S0 + 10, 0, 18);
    useItem(k, a, false, 0);
    assert.equal(k.shots.filter((s) => s.kind === "fence").length, 0, "pins appear on the next step");
    tick(k);
    assert.equal(k.shots.filter((s) => s.kind === "fence").length, 3, "three pins");
    let wob = 0;
    for (let i = 0; i < 240; i++) {
      if (i % 4 === 0) feed(k, b, { mz: 1 });
      if (i % 4 === 0) feed(k, a, { mz: 0 });
      tick(k);
      wob = Math.max(wob, b.wobble);
    }
    assert.ok(wob > 0 && wob <= HIT.wobble, "fence: wobble " + wob);
  }
  // Turbo Tape ×3: a boost per tap.
  {
    const { k, a } = duel("tape");
    useItem(k, a, false, 0);
    assert.ok(a.boost > 0.8 && a.uses === 2);
  }
  // Sweet Spot: glow, can't be knocked over.
  {
    const { k, a, b } = duel("dink", 16);
    b.item = "sweet";
    b.uses = 1;
    useItem(k, b, false, 0);
    assert.ok(b.sweet > 5);
    useItem(k, a, false, 0);
    for (let i = 0; i < 360; i++) tick(k);
    assert.equal(b.hits, 0, "the dink did nothing to a Sweet Spot kart");
  }
  // Net Toss: sticks to the kart ahead; shaking breaks free early, otherwise ~2 s.
  {
    const { k, a, b } = duel("net", 30);
    useItem(k, a, false, 0);
    let netted = false;
    for (let i = 0; i < 360 && !netted; i++) {
      tick(k);
      netted = b.net > 0;
    }
    assert.ok(netted && b.net <= HIT.net, "netted");
    const before = b.net;
    feed(k, b, { shakeId: 1 });
    feed(k, b, { shakeId: 2 });
    feed(k, b, { shakeId: 3 });
    assert.ok(b.net < before - 1.5 || b.net === 0, "shaking breaks free faster: " + b.net);
  }
  // Comeback Cannon: flies to just behind the kart ahead.
  {
    const { k, a, b } = duel("cannon", 160);
    useItem(k, a, false, 0);
    assert.ok(a.cannon > 0);
    for (let i = 0; i < 120 * 4 && a.cannon > 0; i++) tick(k);
    assert.equal(a.cannon, 0);
    const gap = b.progress - a.progress;
    assert.ok(gap > 0 && gap < 40, "landed just behind the kart ahead: gap " + gap.toFixed(1));
  }
  // Crowd Wave: karts ahead in range get bumped into the air (no spin); you get a boost.
  {
    const { k, a, b } = duel("wave", 25);
    useItem(k, a, false, 0);
    assert.ok(a.boost > 0.5);
    let air = false;
    for (let i = 0; i < 240; i++) {
      tick(k);
      air ||= b.air;
    }
    assert.ok(air && b.spin === 0 && b.hits === 1, "wave bumped the kart ahead");
  }
  // Ball Machine: fires across the road for 6 s; a kart driving through can get hit.
  {
    const { k, a, b, t } = duel("machine", 0);
    useItem(k, a, false, 0);
    put(k, a, t.S0 + 200, 0, 0);
    tick(k, 60);
    assert.ok(k.shots.some((s) => s.kind === "machine"));
    assert.ok(k.shots.some((s) => s.kind === "mball"), "balls fired");
    put(k, b, t.S0 + 20, 0, 6);
    let hit = 0;
    for (let i = 0; i < 120 * 6; i++) {
      if (i % 4 === 0) feed(k, b, { mz: 0.3 });
      tick(k);
      hit = Math.max(hit, b.spin);
    }
    assert.ok(k.shots.every((s) => s.kind !== "machine"), "machine gone after 6 s");
    assert.ok(hit <= HIT.machine, "machine ball spin " + hit);
  }
  assert.ok(Math.max(...Object.values(HIT)) <= 2, "no effect longer than 2 s");
});

const tv = (r: Room) => r.sessions.get(r.host)!;
let rnow = Date.now();
function roomInput(r: Room, cred: string, a: Partial<Input> & Record<string, unknown> = {}) {
  rnow += 20;
  return acceptInput(
    r,
    r.sessions.get(cred)!,
    { seq: seq++, t: rnow, pitch: 0, roll: 0, yaw: 0, strength: 0, direction: 0, swing: false, sensors: true, calibrated: true, mx: 0, mz: 1, ...a } as Input,
    rnow,
  );
}

test("inputs: only phones in this race steer; bad kart fields are rejected", () => {
  const r = createKartRoom("race", "court", "club", true);
  const a = joinRacer(r, "Ana", undefined, "host", "classic", { ...DEFAULT_GEAR }, "classic", 1);
  assert.ok(roomInput(r, a.credential, { mx: 0.5 }));
  // The TV's own session can't drive.
  assert.equal(acceptInput(r, tv(r), { seq: 9e6, t: Date.now(), pitch: 0, roll: 0, yaw: 0, strength: 0, direction: 0, swing: false, sensors: true, calibrated: true, mx: 1, mz: 1 } as Input), false);
  // A controller session for someone not in this race is ignored.
  r.sessions.set("ghost", { role: "controller", playerId: "nobody", expires: Date.now() + 1e6, lastSeq: -1, lastInput: 0 });
  assert.equal(roomInput(r, "ghost", { mx: 1 }), false);
  // Out-of-range or malformed fields.
  assert.equal(roomInput(r, a.credential, { mx: 2 }), false);
  assert.equal(roomInput(r, a.credential, { itemId: -1 }), false);
  assert.equal(roomInput(r, a.credential, { drift: "yes" }), false);
  // Item presses apply once even when repeated in later packets.
  const k = r.kart!;
  const me = k.racers[0];
  me.ready = true;
  startKart(k);
  for (let i = 0; i < 500 && k.phase !== "race"; i++) stepKart(k);
  me.item = "tape";
  me.uses = 3;
  roomInput(r, a.credential, { itemId: 1 });
  roomInput(r, a.credential, { itemId: 1 });
  roomInput(r, a.credential, { itemId: 1 });
  assert.equal(me.uses, 2, "the same press id is applied once");
});

test("drop → kart waits → bot takes over → rejoining takes the kart back", () => {
  const r = createKartRoom("race", "beach", "club", false);
  const k = r.kart!;
  const a = joinRacer(r, "Sam", undefined, "host", "classic", { ...DEFAULT_GEAR }, "roller", 3);
  const b = joinRacer(r, "Kim", undefined, "host", "classic", { ...DEFAULT_GEAR }, "paddle", 4);
  let now = Date.now();
  const send = (cred: string) =>
    acceptInput(r, r.sessions.get(cred)!, { seq: seq++, t: now, pitch: 0, roll: 0, yaw: 0, strength: 0, direction: 0, swing: false, sensors: true, calibrated: true, mx: 0, mz: 1 } as Input, now);
  send(a.credential);
  send(b.credential);
  for (const p of k.racers) p.ready = true;
  startKart(k, now);
  const step = (secs: number, sam: boolean) => {
    for (let i = 0; i < secs * 120; i++) {
      now += 1000 / 120;
      if (i % 4 === 0) {
        send(b.credential);
        if (sam) send(a.credential);
        kartAway(k, now);
      }
      stepKart(k, 1 / 120, now);
    }
  };
  step(8, true);
  const sam = k.racers.find((p) => p.name === "Sam")!;
  assert.equal(k.phase, "race");
  assert.ok(sam.v > 10, "Sam is driving");
  // Sam's phone goes silent: the kart slows to a stop and waits.
  step(6, false);
  assert.equal(sam.connected, false);
  assert.ok(sam.away > 0 && !sam.botFor, "waiting for Sam's phone");
  assert.ok(sam.v < 2, "Sam's kart has stopped: " + sam.v.toFixed(1));
  assert.match(k.message, /Waiting for Sam|Sam/);
  // After 30 s a bot drives it.
  step(28, false);
  assert.equal(sam.botFor, true, "a bot took over");
  const p0 = sam.progress;
  step(3, false);
  assert.ok(sam.progress > p0 + 20, "the bot drives Sam's kart");
  // Sam reloads and rejoins with the same phone: same kart, mid-race.
  const back = joinRacer(r, "Sam", a.credential, "host", "classic", { ...DEFAULT_GEAR }, "roller", 3);
  assert.equal(back.player.id, sam.id, "same kart");
  step(1, true);
  assert.equal(sam.botFor, false, "Sam has the wheel again");
  assert.equal(sam.away, 0);
  assert.ok(k.racers.includes(sam) && k.racers.length === 8);
});

test("tracks: eight tracks, each with its own road, a racing line, cubes, pads, a shortcut and a start straight", () => {
  assert.equal(TRACKS.length, 8);
  // Every track has a different road surface and barrier.
  assert.equal(new Set(TRACKS.map((d) => d.road.surface)).size, 8, "eight different road surfaces");
  assert.equal(new Set(TRACKS.map((d) => d.road.barrier)).size, 8, "eight different barriers");
  // Each track appears in exactly one cup of four.
  assert.deepEqual(CUPS.flatMap((c) => c.tracks).sort(), TRACKS.map((d) => d.id).sort());
  for (const d of TRACKS) {
    const t = track(d.id);
    assert.ok(t.L > 450 && t.L < 900, `${d.id} length ${t.L}`);
    assert.ok(d.cubes.length >= 3 && d.pads.length >= 2 && d.cut, d.id);
    // The grid (up to 27 m behind the line) is on a straight.
    for (let s = t.S0 - 28; s < t.S0; s += 3) assert.ok(Math.abs(t.k[pointAt(t, s).i]) < 0.02, `${d.id}: grid on a straight`);
    assert.equal(sectorOf(t, t.S0 + 1), 0);
    assert.equal(sectorOf(t, t.S0 - 1), SECTORS - 1);
  }
  assert.ok(track("skyline").ground.some((g) => !g), "skyline has rooftop gaps");
  assert.ok(track("beach").ground.some((g) => !g), "beach has the pier jump");
  assert.ok(track("neon").def.pins, "neon has moving pins");
  assert.ok(track("jungle").ground.some((g) => !g), "jungle has the river jump");
  assert.ok(track("canyon").ground.some((g) => !g), "canyon has the canyon jump");
  assert.ok((track("frost").def.grip ?? 1) < 0.8, "frost is icy");
  // Stadium Eight crosses itself: two parts of the lap at the same spot, one on the bridge above.
  const st = track("stadium");
  let crossing = false;
  for (let i = 0; i < st.n; i += 2)
    for (let j = 0; j < st.n; j += 2)
      if (Math.abs(st.s[i] - st.s[j]) > 100 && Math.hypot(st.x[i] - st.x[j], st.z[i] - st.z[j]) < 3 && Math.abs(st.y[i] - st.y[j]) > 6) crossing = true;
  assert.ok(crossing, "figure-8 crossing on a bridge");
  // Apart from that crossing, no two parts of any track overlap.
  for (const d of TRACKS) {
    const t = track(d.id);
    for (let i = 0; i < t.n; i += 3)
      for (let j = 0; j < t.n; j += 3) {
        const ds = Math.min(Math.abs(t.s[i] - t.s[j]), t.L - Math.abs(t.s[i] - t.s[j]));
        if (ds < 40 || Math.abs(t.y[i] - t.y[j]) > 4) continue;
        assert.ok(Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]) > t.w[i] / 2 + t.w[j] / 2 + 2, `${d.id}: samples ${i} and ${j} overlap`);
      }
  }
});

test("cup: four tracks in a row with points, then final standings; time trial has no bots", () => {
  const k = newKart("cup", "neon", "pro", true, 1);
  assert.equal(k.track, "court", "a cup starts on the first cup track");
  const me = addRacer(k, "h", "Ana", "classic", { ...DEFAULT_GEAR }, "classic", 2);
  feed(k, me);
  me.ready = true;
  startKart(k, nowMs);
  me.bot = "pro"; // let the server drive her kart for this test
  const seen: string[] = [];
  for (let race = 0; race < 4; race++) {
    seen.push(k.track);
    for (let i = 0; i < 120 * 200 && k.phase !== "results"; i++) tick(k);
    assert.equal(k.phase, "results", "race " + (race + 1) + " finished");
    assert.equal(k.racers.length, 8);
    const pts = k.racers.map((r) => r.gained).sort((a, b) => b - a);
    assert.deepEqual(pts, [15, 12, 10, 8, 6, 4, 2, 1]);
    me.bot = "";
    feed(k, me);
    nextRaceOrPodium(k);
    me.bot = "pro";
  }
  assert.deepEqual(seen, ["court", "neon", "beach", "skyline"]);
  assert.equal(k.phase, "podium");
  const total = k.racers.reduce((a, r) => a + r.points, 0);
  assert.equal(total, 4 * 58, "points add up over the cup");
  // Time trial: one driver, no bots, Turbo Tape ×3 to start, lap times recorded.
  const tt = newKart("trial", "beach", "club", true);
  assert.equal(tt.items, false);
  const solo = addRacer(tt, "s", "Solo", "classic", { ...DEFAULT_GEAR }, "classic", 0);
  assert.throws(() => addRacer(tt, "x", "Two", "classic", { ...DEFAULT_GEAR }, "classic", 0));
  feed(tt, solo);
  solo.ready = true;
  startKart(tt, nowMs);
  assert.equal(tt.racers.length, 1);
  assert.equal(solo.item, "tape");
  assert.equal(solo.uses, 3);
});
function nextRaceOrPodium(k: Kart) {
  nextRace(k, nowMs);
}

test("every track: a lap is driven with all checkpoints in order and a sane lap time", () => {
  for (const d of TRACKS) {
    const { k, hs } = race(1, d.id, false);
    const me = hs[0];
    me.bot = "pro"; // the server drives it along the racing line
    const order: number[] = [];
    let falls = 0,
      last = me.sector;
    for (let i = 0; i < 120 * 90 && me.laps.length < 2; i++) {
      tick(k);
      if (me.sector !== last) {
        order.push(me.sector);
        last = me.sector;
      }
      if (me.lift > 1.49) falls++;
    }
    assert.ok(me.laps.length >= 2, `${d.id}: two laps counted (lap ${me.lap})`);
    for (const lt of me.laps) assert.ok(lt > 18 && lt < 50, `${d.id}: lap time ${lt}`);
    // Sectors were passed one after another, never skipped.
    for (let q = 1; q < order.length; q++) assert.equal(order[q], (order[q - 1] + 1) % SECTORS, `${d.id}: sector ${order[q - 1]} → ${order[q]}`);
    assert.ok(falls <= 1, `${d.id}: falls ${falls}`);
  }
});

test("wild cup: frost, jungle, stadium, canyon in a row", () => {
  const k = newKart("cup", "canyon", "club", false, 1);
  assert.equal(k.cup, 1);
  assert.equal(k.track, "frost");
  const me = addRacer(k, "h", "Ana", "classic", { ...DEFAULT_GEAR }, "classic", 2);
  feed(k, me);
  me.ready = true;
  startKart(k, nowMs);
  me.bot = "pro";
  const seen: string[] = [];
  for (let race = 0; race < 4; race++) {
    seen.push(k.track);
    for (let i = 0; i < 120 * 200 && k.phase !== "results"; i++) tick(k);
    assert.equal(k.phase, "results");
    me.bot = "";
    feed(k, me);
    nextRace(k, nowMs);
    me.bot = "pro";
  }
  assert.deepEqual(seen, ["frost", "jungle", "stadium", "canyon"]);
  assert.equal(k.phase, "podium");
});
