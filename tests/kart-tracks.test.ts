/**
 * Sportle Kart track audit (2026-11-25): checks that keep the bugs found on the eight tracks
 * fixed: road width and hairpins, pads/cubes on solid road, LED boards that fit and aren't
 * crossed by another road, chase cameras that stay out of scenery, soft walls, steering that
 * turns the same at any speed, the edge assist, jumps that can't be fallen short of, respawns,
 * and full bot races with no falls, stalls or wall grinding. Synthetic inputs only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_WIDTH,
  SECTORS,
  TRACKS,
  boardWidth,
  cameraReach,
  ledSize,
  ledUnits,
  locate,
  pointAt,
  sectorOf,
  track,
} from "../src/shared/kart.ts";
import type { Kart, Racer, TrackId } from "../src/shared/kart.ts";
import { addRacer, hitKart, kartInput, newKart, physOf, startKart, stepKart } from "../src/server/kart.ts";
import { DEFAULT_GEAR } from "../src/shared/types.ts";
import type { Input } from "../src/shared/types.ts";

let now = 5_000_000,
  seq = 1;
const tick = (k: Kart, n = 1) => {
  for (let i = 0; i < n; i++) {
    now += 1000 / 120;
    stepKart(k, 1 / 120, now);
  }
};
const feed = (k: Kart, r: Racer, a: Partial<Input> & Record<string, unknown> = {}) =>
  kartInput(k, r, { seq: seq++, t: now, pitch: 0, roll: 0, yaw: 0, strength: 0, direction: 0, swing: false, sensors: true, calibrated: true, mx: 0, mz: 1, ...a } as Input, now);
/** One phone, bots parked, past the countdown. */
function solo(id: TrackId) {
  const k = newKart("race", id, "club", false);
  const me = addRacer(k, "h", "Me", "classic", { ...DEFAULT_GEAR }, "classic", 0);
  feed(k, me);
  me.ready = true;
  startKart(k, now);
  while (k.phase === "countdown") {
    feed(k, me, { mz: 0 });
    tick(k, 4);
  }
  for (const r of k.racers) if (r.bot) r.lift = 1e6;
  return { k, me, t: track(id) };
}
function put(k: Kart, r: Racer, s: number, d = 0, v = 0, turn = 0) {
  const t = track(k.track);
  const p = pointAt(t, s, d);
  Object.assign(r, { x: p.x, y: p.y, z: p.z, h: p.h + turn, v, s, d, air: false, spin: 0, net: 0, wobble: 0, drift: 0, charge: 0, boost: 0, lap: 1, sector: sectorOf(t, s), lift: 0 });
  const ph = physOf(r);
  Object.assign(ph, { hint: p.i, m: p.h + turn, vy: 0, onCut: false, steer: 0, steerIn: 0, wallT: 0 });
}
/** Drive for `secs` with fixed inputs (fed at 40 Hz like a phone). */
function drive(k: Kart, r: Racer, secs: number, a: Partial<Input> & Record<string, unknown> = {}) {
  for (let i = 0; i < secs * 120; i++) {
    if (i % 3 === 0) feed(k, r, a);
    tick(k);
  }
}

test("layout: roads at least MIN_WIDTH, round hairpins, pads/cubes/ramps on solid road, no seams", () => {
  for (const d of TRACKS) {
    const t = track(d.id);
    for (let i = 0; i < t.n; i++) {
      assert.ok(t.w[i] >= MIN_WIDTH - 1e-9, `${d.id}: road ${t.w[i].toFixed(1)} m wide at ${i}`);
      assert.ok(Math.abs(t.k[i]) < 1 / 12, `${d.id}: bend radius ${(1 / Math.abs(t.k[i])).toFixed(1)} m at ${i}`);
      // No steps in the road surface except where a ramp's lip drops away.
      const j = (i + 1) % t.n;
      if (t.ground[i] && t.ground[j] && Math.abs(t.y[i] - t.y[j]) > 0.5) {
        const lip = d.ramps.some((r) => Math.abs(t.s[i] - (t.s[Math.round(r.at * t.n) % t.n] + r.len)) < 3);
        assert.ok(lip, `${d.id}: ${(t.y[i] - t.y[j]).toFixed(2)} m step in the road at ${i}`);
      }
    }
    for (const pad of d.pads) {
      const p = pointAt(t, pad.at * t.L);
      assert.ok(Math.abs((pad.d * p.w) / 2) + 1.7 <= p.w / 2, `${d.id}: boost pad at ${pad.at} sticks off the road`);
      assert.ok(t.ground[p.i], `${d.id}: boost pad at ${pad.at} over a gap`);
    }
    for (const c of d.cubes) {
      const p = pointAt(t, c * t.L);
      assert.ok(t.ground[p.i], `${d.id}: item cubes at ${c} over a gap`);
    }
    // A gap always follows a ramp (no holes in the road by accident).
    for (let i = 0; i < t.n; i++)
      if (!t.ground[i] && t.ground[(i - 1 + t.n) % t.n])
        assert.ok(d.ramps.some((r) => r.gap && Math.abs(t.s[i] - (t.s[Math.round(r.at * t.n) % t.n] + r.len)) < 3), `${d.id}: hole in the road at ${i}`);
  }
});

test("LED boards: the longest standings fit, and no other road passes through a board", () => {
  const longest = "8 WWWWWW  8 WWWWWW  8 WWWWWW";
  for (const d of TRACKS) {
    const t = track(d.id);
    for (const g of d.gantries) {
      const w = boardWidth(t, g);
      assert.ok(ledUnits(longest) * ledSize(longest, w) <= w * 0.92, `${d.id}: LED text wider than the board at ${g}`);
      assert.ok(ledSize("GET READY", w) >= 0.12, `${d.id}: short messages stay big`);
      const p = pointAt(t, g * t.L);
      for (let i = 0; i < t.n; i++) {
        const ds = Math.min(Math.abs(t.s[i] - g * t.L), t.L - Math.abs(t.s[i] - g * t.L));
        if (ds < 30) continue;
        const near = Math.hypot(t.x[i] - p.x, t.z[i] - p.z) < w / 2 + t.w[i] / 2;
        assert.ok(!(near && t.y[i] > p.y + 3 && t.y[i] < p.y + 9.5), `${d.id}: road ${i} runs through the board at ${g}`);
      }
    }
  }
});

test("cameras: the chase camera always stays over the road (never inside walls or scenery)", () => {
  for (const d of TRACKS) {
    const t = track(d.id);
    for (let i = 0; i < t.n; i += 4) {
      if (!t.ground[i]) continue;
      for (const turn of [0, 0.7, -0.7]) {
        const h = Math.atan2(t.tz[i], t.tx[i]) + turn;
        const from = [t.x[i], t.y[i] + 1.2, t.z[i]];
        const eye = [t.x[i] - Math.cos(h) * 6.3, t.y[i] + 2.5, t.z[i] - Math.sin(h) * 6.3];
        const f = cameraReach(t, t.s[i], from, eye);
        const e = eye.map((v, q) => from[q] + (v - from[q]) * f);
        const w = locate(t, e[0], e[2], e[1], i, 14);
        assert.ok(Math.abs(w.d) <= t.w[w.i] / 2 + d.verge, `${d.id}: camera outside the barriers at ${i} (turn ${turn})`);
        assert.ok(e[1] >= w.y + 0.7, `${d.id}: camera below the road at ${i}`);
      }
    }
  }
});

test("walls are soft: a kart glances off and keeps going, never stops dead or grinds", () => {
  for (const id of ["court", "frost", "stadium"] as TrackId[]) {
    const { k, me, t } = solo(id);
    const p0 = pointAt(t, t.S0 + 40);
    // 35° into the wall at full speed, hands off the wheel.
    put(k, me, t.S0 + 40, p0.w / 2 + 1, 22, 0.6);
    drive(k, me, 1.2, { mx: 0, assist: false });
    assert.ok(physOf(me).walls >= 1, id + ": hit the wall");
    assert.ok(me.v > 13, `${id}: kept speed after a glancing hit: ${me.v.toFixed(1)}`);
    // Almost head-on: slows, but still rolls away along the wall.
    put(k, me, t.S0 + 40, p0.w / 2 + 2, 20, 1.4);
    drive(k, me, 1.5, { mx: 0, assist: false });
    assert.ok(me.v > 6, `${id}: not stopped dead by a head-on hit: ${me.v.toFixed(1)}`);
    // Steering into the wall for two seconds: it slides along, it doesn't stick.
    put(k, me, t.S0 + 40, p0.w / 2 + 2, 18, 0.3);
    const s0 = me.s;
    drive(k, me, 2, { mx: 1, assist: false });
    assert.ok(me.v > 8 && (me.s - s0 + t.L) % t.L > 15, `${id}: slid along the wall (v ${me.v.toFixed(1)})`);
  }
});

test("steering turns at the same rate at any speed (above walking pace)", () => {
  const { k, me, t } = solo("canyon");
  const rates: number[] = [];
  for (const v of [8, 15, 23]) {
    put(k, me, t.S0 + 30, -3, v);
    drive(k, me, 0.35, { mx: 0.6, mz: 0, assist: false });
    const h0 = me.h,
      v0 = me.v;
    drive(k, me, 0.1, { mx: 0.6, mz: 0, assist: false });
    rates.push(Math.atan2(Math.sin(me.h - h0), Math.cos(me.h - h0)) / 0.1);
    assert.ok(v0 > 5, "still moving");
  }
  for (const r of rates) assert.ok(Math.abs(r - rates[0]) / rates[0] < 0.06, "yaw rates " + rates.map((x) => x.toFixed(2)));
});

test("steering assist pulls back from the road edge, and can be switched off", () => {
  for (const on of [true, false]) {
    const { k, me, t } = solo("court");
    const p0 = pointAt(t, t.S0 + 20);
    put(k, me, t.S0 + 20, p0.w / 2 - 0.6, 15);
    const d0 = me.d;
    drive(k, me, 0.8, { mx: 0, assist: on });
    if (on) assert.ok(me.d < d0 - 0.8, `assist moved the kart in from the edge: ${d0.toFixed(1)} → ${me.d.toFixed(1)}`);
    else assert.ok(me.d > d0 - 0.4, `assist off: no pull (${d0.toFixed(1)} → ${me.d.toFixed(1)})`);
  }
});

test("jumps: a slow kart still clears every gap, a hit mid-air doesn't drop it, falls respawn past the gap", () => {
  for (const d of TRACKS) {
    for (const rp of d.ramps.filter((r) => r.gap)) {
      const t = track(d.id);
      const lipS = rp.at * t.L;
      for (const v of [7, 22]) {
        const { k, me } = solo(d.id);
        put(k, me, lipS - 3, 0, v);
        let fell = false,
          hit = false;
        for (let i = 0; i < 120 * 3; i++) {
          if (i % 3 === 0) feed(k, me, { mx: 0 });
          tick(k);
          // A Pin Bowl hit while flying over the gap.
          if (!hit && me.air && !t.ground[physOf(me).hint] && v > 10) {
            hitKart(k, me, "pinbowl", "x");
            hit = true;
          }
          fell ||= me.lift > 0;
        }
        assert.ok(!fell, `${d.id}: ${v} m/s at the ramp at ${rp.at} fell into the gap${hit ? " (hit mid-air)" : ""}`);
        assert.ok(t.ground[physOf(me).hint] && !me.air, `${d.id}: landed on the far side`);
      }
      // A kart that does end up in the gap (pushed in at a standstill) is put back past it.
      const { k, me } = solo(d.id);
      const gapS = lipS + rp.len + (rp.gap ?? 0) / 2;
      const gp = pointAt(t, gapS);
      put(k, me, gapS, 0, 0);
      me.air = true;
      me.y = gp.y + 0.5;
      tick(k, 120 * 4);
      const p = physOf(me);
      assert.ok(t.ground[p.hint] && Math.abs(me.d) < t.w[p.hint] / 2, `${d.id}: respawned on solid road`);
      assert.ok((me.s - gapS + t.L) % t.L < 40, `${d.id}: respawned just past the gap`);
    }
  }
});

/**
 * One full seeded race (Club bots, items, 2 laps; the phone's kart driven by a Pro bot). Races only
 * depend on the room's seed, so any failure can be replayed exactly with that seed (and the dev
 * stress version, scripts/dev/kart-falls.ts, runs many seeds).
 */
function seededRace(id: TrackId, seed: number) {
  const k = newKart("race", id, "club", true, 2);
  k.seed = seed;
  const me = addRacer(k, "h", "Me", "classic", { ...DEFAULT_GEAR }, "classic", 0);
  feed(k, me);
  me.ready = true;
  startKart(k, now);
  me.bot = "pro";
  const stuck = new Map<string, number>();
  const falls: string[] = [];
  let longest = 0,
    order = 0;
  const last = new Map(k.racers.map((r) => [r.id, r.sector]));
  for (let i = 0; i < 120 * 160 && k.phase !== "results"; i++) {
    tick(k);
    if (k.phase !== "race") continue;
    for (const r of k.racers) {
      // A fall starts the 1.5 s drone pickup: count it once.
      if (r.lift > 1.5 - 1 / 240) falls.push(`${r.name} at ${(r.s / track(id).L).toFixed(3)} of the lap`);
      const s = Math.abs(r.v) < 2 && !r.spin && !r.lift && !r.finished && k.clock > 3 ? (stuck.get(r.id) ?? 0) + 1 : 0;
      stuck.set(r.id, s);
      longest = Math.max(longest, s);
      const was = last.get(r.id)!;
      if (r.sector !== was) {
        if (r.sector !== (was + 1) % SECTORS && r.sector !== (was - 1 + SECTORS) % SECTORS) order++;
        last.set(r.id, r.sector);
      }
    }
  }
  return { k, falls, longest, order };
}
/** Fixed seeds per track (and the replay hint printed with every failure). */
const SEEDS = [11, 22, 33];
test("bots: full seeded races with items on every track: no falls, no stalls, no grinding, all finish", () => {
  for (const d of TRACKS)
    for (const seed of SEEDS) {
      const { k, falls, longest, order } = seededRace(d.id, seed);
      const at = `${d.id} seed ${seed} (replay: node scripts/dev/kart-falls.ts ${d.id} 1 ${seed} verbose)`;
      assert.equal(k.phase, "results", at + ": race finished");
      assert.ok(k.racers.every((r) => r.laps.length >= 2 || r.finished), at + ": laps counted");
      assert.equal(order, 0, at + ": checkpoints passed in order");
      assert.deepEqual(falls, [], at + ": no falls");
      assert.ok(longest < 120 * 1.5, `${at}: a kart stalled for ${(longest / 120).toFixed(1)} s`);
      const walls = k.racers.reduce((a, r) => a + physOf(r).walls, 0);
      assert.ok(walls <= 8, `${at}: ${walls} wall hits in one race`);
    }
});

test("regression: Beach seeds where a kart tumbled off the pier ramp at low speed and fell (CI, 2026-11-26)", () => {
  // A Pin Bowl hit on the ramp threw the kart into the air at 40 % speed; the jump assist only
  // ran for karts leaving the lip normally, so it dropped into the water. Now a glide assist
  // keeps any kart in the air near a gap fast and high enough to reach the far side.
  for (const seed of [13, 96, 146]) {
    const { falls } = seededRace("beach", seed);
    assert.deepEqual(falls, [], `beach seed ${seed}: no falls`);
  }
});

test("glide assist: a kart knocked into the air on a gap's ramp at low speed still lands on the far side", () => {
  for (const d of TRACKS)
    for (const rp of d.ramps.filter((r) => r.gap)) {
      const { k, me, t } = solo(d.id);
      const at = rp.at * t.L + rp.len * 0.6;
      put(k, me, at, 0, 21);
      tick(k, 2);
      hitKart(k, me, "pinbowl", "x"); // a tumble on the ramp: 40 % speed, thrown into the air
      assert.ok(me.air && me.v < 10, d.id + ": knocked up and slowed");
      let fell = false;
      for (let i = 0; i < 120 * 3; i++) {
        tick(k);
        fell ||= me.lift > 0;
      }
      assert.ok(!fell, `${d.id}: fell into the gap at ${rp.at}`);
    }
});
