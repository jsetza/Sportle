// Paddle control (owner request): the shot type comes from the paddle face angle,
// the swing path and the swing speed, and spin really changes the flight and the bounce.
import test from "node:test";
import assert from "node:assert/strict";
import {
  match,
  player,
  start,
  step,
  hit,
  classifyShot,
  forehandSide,
  FOREHAND_OFFSET,
} from "../src/server/engine.ts";
import { COURT, ZERO_INPUT } from "../src/shared/types.ts";
import type { Input, Match } from "../src/shared/types.ts";

/** A rally ball beside player A's forehand. `z` = where A stands. */
function setup(opts: { z?: number; y?: number; bounces?: number; incoming?: number } = {}) {
  const m = match("singles", "hard");
  m.players = [player("a", "A", 0), player("b", "B", 1)];
  start(m);
  m.phase = "rally";
  m.hits = 4;
  m.lastTeam = 1;
  m.time = 10;
  m.introUntil = 0;
  const p = m.players[0];
  const z = opts.z ?? 5;
  p.pos = { x: 0, y: 0, z };
  m.bounces = opts.bounces ?? 1;
  m.ball = { x: forehandSide(p) * FOREHAND_OFFSET, y: opts.y ?? 0.9, z };
  m.velocity = { x: 0, y: -1, z: opts.incoming ?? 3 };
  p.lastHit = -10;
  for (const q of m.players) {
    q.target = { ...q.pos };
    q.reactionAt = 1e9;
  }
  return { m, p };
}
const input = (o: Partial<Input>): Input => ({ ...ZERO_INPUT, sensors: true, calibrated: true, ...o });

/** Fly the shot: apex, net clearance, first landing point and the bounce that follows. */
function fly(m: Match) {
  let apex = m.ball.y,
    atNet = -1,
    land: { x: number; z: number } | null = null,
    vBefore = { h: 0, y: 0 },
    vAfter = { h: 0, y: 0 },
    bounceTop = 0;
  for (let i = 0; i < 1200 && m.phase === "rally"; i++) {
    const old = { ...m.ball },
      ov = { ...m.velocity };
    step(m);
    apex = Math.max(apex, m.ball.y);
    if (old.z > 0 && m.ball.z <= 0) atNet = old.y;
    if (!land && m.bounces > 0) {
      land = { x: m.ball.x, z: m.ball.z };
      vBefore = { h: Math.hypot(ov.x, ov.z), y: -ov.y };
      vAfter = { h: Math.hypot(m.velocity.x, m.velocity.z), y: m.velocity.y };
    }
    if (land) {
      bounceTop = Math.max(bounceTop, m.ball.y);
      if (m.velocity.y < 0 && m.ball.y < bounceTop - 0.01) break;
    }
  }
  return { apex, atNet, land, vBefore, vAfter, bounceTop };
}
function shoot(o: Parameters<typeof setup>[0], i: Partial<Input>) {
  const s = setup(o);
  const ok = hit(s.m, s.p, input(i));
  assert.ok(ok, "contact");
  const shot = s.m.shot,
    spin = s.m.spin,
    kmh = s.m.timing?.kmh ?? 0;
  return { ...s, shot, spin, kmh, f: fly(s.m) };
}
const inCourt = (l: { x: number; z: number } | null) =>
  !!l && Math.abs(l.x) <= COURT.halfWidth && l.z < 0 && l.z >= -COURT.halfLength;

const DRIVE = { strength: 0.75, direction: 0.1, pitch: 0 };

test("classification: face angle + swing path + speed pick the shot", () => {
  const cases: [Partial<Parameters<typeof setup>[0]>, Partial<Input>, string][] = [
    [{}, DRIVE, "drive"],
    [{}, { strength: 0.8, direction: 0.6, pitch: -10 }, "topspin"],
    [{}, { strength: 0.5, direction: 0.5, pitch: 0 }, "roll"],
    [{}, { strength: 0.5, direction: -0.5, pitch: 20 }, "slice"],
    [{}, { strength: 0.8, direction: -0.6, pitch: 25 }, "chop"],
    [{}, { strength: 0.6, direction: 0.6, pitch: 40 }, "lob"],
    [{ y: 2.2, bounces: 0 }, { strength: 0.8, direction: -0.8 }, "smash"],
    [{ z: 2.7 }, { strength: 0.2, direction: 0.05, pitch: 10 }, "dink"],
    [{ z: 6 }, { strength: 0.3, direction: 0.05, pitch: 10 }, "drop"],
    [{ z: 2.7, bounces: 0, incoming: 13 }, { strength: 0.3 }, "block"],
    [{ z: 4, bounces: 1, incoming: 13 }, { strength: 0.3 }, "reset"],
  ];
  for (const [o, i, want] of cases) {
    const { m, p } = setup(o);
    assert.equal(classifyShot(m, p, input(i)), want, JSON.stringify(i));
  }
});

test("drive: flat and fast, no spin, lands in the court", () => {
  const d = shoot({}, DRIVE);
  assert.match(d.shot, /drive/);
  assert.equal(d.spin, 0);
  assert.ok(inCourt(d.f.land), JSON.stringify(d.f.land));
  assert.ok(d.f.atNet > COURT.netCenter, "clears the net");
});

test("topspin drive: higher arc that dips into the court and kicks forward off the bounce", () => {
  const d = shoot({}, DRIVE),
    t = shoot({}, { strength: 0.75, direction: 0.6, pitch: -10 });
  assert.match(t.shot, /topspin/);
  assert.ok(t.spin > 3, `spin ${t.spin}`);
  assert.ok(t.f.apex > d.f.apex + 0.1, `apex ${t.f.apex.toFixed(2)} vs drive ${d.f.apex.toFixed(2)}`);
  assert.ok(t.f.atNet > d.f.atNet, "more net clearance");
  assert.ok(inCourt(t.f.land), JSON.stringify(t.f.land));
  const kick = t.f.vAfter.h / t.f.vBefore.h,
    flat = d.f.vAfter.h / d.f.vBefore.h;
  assert.ok(kick > flat + 0.08, `kick ${kick.toFixed(2)} vs flat ${flat.toFixed(2)}`);
});

test("roll: gentler topspin, lands in the court", () => {
  const r = shoot({}, { strength: 0.5, direction: 0.5, pitch: 0 });
  assert.match(r.shot, /roll/);
  assert.ok(r.spin > 0);
  assert.ok(inCourt(r.f.land));
});

test("slice and chop: backspin floats flatter and skids low off the bounce", () => {
  const d = shoot({}, { strength: 0.5, direction: 0.1, pitch: 0 }),
    s = shoot({}, { strength: 0.5, direction: -0.5, pitch: 20 }),
    c = shoot({}, { strength: 0.8, direction: -0.6, pitch: 25 });
  assert.match(s.shot, /slice/);
  assert.match(c.shot, /chop/);
  assert.ok(s.spin < 0 && c.spin < s.spin, `slice ${s.spin}, chop ${c.spin}`);
  for (const x of [s, c]) {
    assert.ok(inCourt(x.f.land), JSON.stringify(x.f.land));
    assert.ok(x.f.atNet > COURT.netCenter, "clears the net");
  }
  // Skids: the bounce comes up lower relative to how hard it came down.
  const skid = s.f.vAfter.y / s.f.vBefore.y,
    flat = d.f.vAfter.y / d.f.vBefore.y;
  assert.ok(skid < flat - 0.1, `slice bounce ${skid.toFixed(2)} vs drive ${flat.toFixed(2)}`);
  assert.ok(s.f.bounceTop < d.f.bounceTop, "stays lower after the bounce");
});

test("lob: big open-face swing goes high and deep", () => {
  const l = shoot({}, { strength: 0.6, direction: 0.6, pitch: 40 });
  assert.match(l.shot, /lob/);
  assert.ok(l.f.apex > 3.5, `apex ${l.f.apex.toFixed(2)}`);
  assert.ok(inCourt(l.f.land) && l.f.land!.z < -4, JSON.stringify(l.f.land));
});

test("smash: high ball + downward swing is fast and lands in", () => {
  const s = shoot({ y: 2.2, bounces: 0, z: 4 }, { strength: 0.8, direction: -0.8 });
  assert.match(s.shot, /smash/);
  assert.ok(s.kmh > 60, `${s.kmh} km/h`);
  assert.ok(inCourt(s.f.land));
});

test("dink near the kitchen lands in the kitchen; drop from the back lands short", () => {
  const k = shoot({ z: 2.7 }, { strength: 0.18, direction: 0.05, pitch: 10 });
  assert.match(k.shot, /dink/);
  assert.ok(k.f.land && Math.abs(k.f.land.z) <= COURT.kitchen, JSON.stringify(k.f.land));
  const d = shoot({ z: 6 }, { strength: 0.3, direction: 0.05, pitch: 10 });
  assert.match(d.shot, /drop/);
  assert.ok(d.f.land && Math.abs(d.f.land.z) < COURT.kitchen + 1.2, JSON.stringify(d.f.land));
  assert.ok(d.spin < 0, "a touch of backspin");
});

test("block and reset: firm face, little swing against a hard ball sends it back soft and short", () => {
  const b = shoot({ z: 2.7, bounces: 0, incoming: 13 }, { strength: 0.3 });
  assert.match(b.shot, /block/);
  assert.ok(b.kmh < 13 * 3.6, `${b.kmh} km/h out vs ${13 * 3.6} in`);
  assert.ok(b.f.land && Math.abs(b.f.land.z) < 3.5 && inCourt(b.f.land), JSON.stringify(b.f.land));
  const r = shoot({ z: 4, bounces: 1, incoming: 13 }, { strength: 0.3 });
  assert.match(r.shot, /reset/);
  assert.ok(r.f.land && Math.abs(r.f.land.z) < 3.5 && inCourt(r.f.land), JSON.stringify(r.f.land));
});

test("forehand / backhand comes from which side of the phone faced the screen", () => {
  const f = shoot({}, { ...DRIVE, face: 1 }),
    b = shoot({}, { ...DRIVE, face: -1 });
  assert.match(f.shot, /^Forehand/);
  assert.match(b.shot, /^Backhand/);
});

test("timing verdict still matches the real outcome for every shot type", () => {
  const shots: Partial<Input>[] = [
    DRIVE,
    { strength: 0.8, direction: 0.6, pitch: -10 },
    { strength: 0.5, direction: 0.5 },
    { strength: 0.5, direction: -0.5, pitch: 20 },
    { strength: 0.8, direction: -0.6, pitch: 25 },
    { strength: 0.6, direction: 0.6, pitch: 40 },
    { strength: 0.3, direction: 0.05, pitch: 10 },
  ];
  let wrong = 0,
    checked = 0,
    bad = 0;
  for (let i = 0; i < 280; i++) {
    const dz = -0.9 + (i % 19) * 0.1;
    const { m, p } = setup({ y: 0.35 + ((i * 3) % 7) * 0.12 });
    m.seed = 700 + i;
    m.ball = { ...m.ball, x: forehandSide(p) * (0.2 + ((i * 7) % 9) * 0.1), z: 5 + dz };
    if (!hit(m, p, input(shots[i % shots.length]))) continue;
    const t = m.timing!;
    const popup = m.popup;
    let netted = false;
    for (let k = 0; k < 900 && m.phase === "rally"; k++) {
      const before = m.velocity.z;
      step(m);
      if (Math.sign(m.velocity.z) !== Math.sign(before) && Math.abs(m.ball.z) < 0.1) netted = true;
      if (m.ball.z < -0.1 || m.bounces > 0) break;
    }
    const failed = popup || netted || m.ball.z > -0.1;
    if (failed !== (t.kind === "early" || t.kind === "late")) wrong++;
    if (failed) bad++;
    checked++;
  }
  assert.ok(checked > 200, `checked ${checked}`);
  assert.ok(bad > 5, `some mistimed shots (${bad})`);
  assert.equal(wrong, 0, `${wrong} of ${checked} verdicts disagreed with the ball`);
});
