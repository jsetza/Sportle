/**
 * Sportle Bowling regression tests for bugs found in the 2026-11-26 bug hunt. Each test failed
 * before its fix. Server logic only; no phone hardware.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  addBowler,
  botForTurn,
  newBowl,
  release,
  skipTurn,
  startBowl,
  stepBowl,
} from "../src/server/bowling.ts";
import { DEFAULT_GEAR } from "../src/shared/types.ts";
import type { Bowl } from "../src/shared/bowling.ts";
import { LANE } from "../src/shared/bowling.ts";
import { launch, moveBall, simulate } from "../src/server/bowlphysics.ts";

let ids = 0;
function join(b: Bowl, name: string) {
  const p = addBowler(b, "id" + ids++, name, "right", "classic", { ...DEFAULT_GEAR });
  Object.assign(p, { ready: true, sensors: true, calibrated: true, lastSeen: Date.now() });
  return p;
}
/** Keep phones live and run until the phase changes to `want` (or the game ends). */
function runUntil(b: Bowl, want: Bowl["phase"], max = 120 * 30) {
  for (let i = 0; i < max; i++) {
    for (const p of b.players) if (!p.bot && p.connected) p.lastSeen = Date.now();
    stepBowl(b);
    if (b.phase === want || b.phase === "over") return;
  }
  throw Error(`never reached ${want} (stuck in ${b.phase})`);
}
const gutter = { x: 0.4, speed: 7, angle: 0.05, hook: 0 };

test("practice: a phone joining while the bot is up doesn't take over the bot's ball", () => {
  const b = newBowl("practice", "neon", "medium", 6);
  const me = join(b, "Me");
  startBowl(b);
  // Me bowls two gutter balls, then the bot is up.
  for (let i = 0; i < 2; i++) {
    assert.ok(release(b, me, gutter));
    runUntil(b, "aim");
  }
  const bot = b.players[b.turn];
  assert.ok(bot.bot, "the bot is up");
  runUntil(b, "rolling"); // the bot lets go
  const late = join(b, "Late");
  assert.equal(b.players[b.turn], bot, "the bot is still the one bowling");
  runUntil(b, "result");
  assert.equal(late.bowls, 0, "the newcomer was not credited with the bot's ball");
  assert.equal(late.practice.length, 0);
  assert.equal(bot.bowls, 1);
});

test("game: a phone joining during the result keeps the turn with the bowler who just bowled", () => {
  const b = newBowl("game", "neon", "", 6);
  const a = join(b, "A"),
    c = join(b, "C");
  startBowl(b);
  release(b, a, gutter);
  runUntil(b, "aim");
  release(b, a, gutter); // A's frame 1 is done
  runUntil(b, "result");
  join(b, "Late");
  assert.equal(b.players[b.turn], a, "during A's result the turn is still A's");
  assert.equal(b.ballNo, 1);
  runUntil(b, "aim");
  assert.equal(b.players[b.turn], c, "then C is up");
  assert.equal(b.frame, 0);
});

test("skip turn after 'Let a bot bowl' doesn't leave the bot bowling that player's later frames", () => {
  const b = newBowl("game", "neon", "", 6);
  const a = join(b, "A"),
    c = join(b, "C");
  startBowl(b);
  botForTurn(b); // host: a bot bowls A's frame…
  skipTurn(b); // …then changes their mind and skips it
  assert.equal(a.botFor, false);
  // C bowls frame 1; then A is up for frame 2 and nothing bowls for them by itself.
  release(b, c, gutter);
  runUntil(b, "aim");
  release(b, c, gutter);
  runUntil(b, "aim");
  assert.equal(b.players[b.turn], a);
  for (let i = 0; i < 120 * 4; i++) stepBowl(b);
  assert.equal(b.phase, "aim", "A's phone is up; no bot bowled for them");
  assert.equal(a.rolls.length, 2);
});

test("physics: fallen pins never lie through the side kickbacks", () => {
  let through = 0;
  for (let s = 1; s <= 240; s++) {
    const r = simulate(
      { x: ((s % 9) - 4) * 0.09, speed: 5 + (s % 6), angle: ((s % 7) - 3) * 0.004, hook: ((s % 5) - 2) * 0.4 },
      undefined,
      { seed: s * 31 },
    );
    for (const p of r.pins) {
      if (p.gone) continue;
      const top = p.x + Math.sin(p.dir) * LANE.pinH * 0.85 * Math.sin(p.tilt);
      if (Math.abs(top) + 0.05 > LANE.wall + 0.005 || Math.abs(p.x) > LANE.wall) through++;
    }
  }
  assert.equal(through, 0, "pins poking through a side wall");
});

test("physics: past the pin deck the ball drops into the pit instead of floating over it", () => {
  for (const l of [
    { x: 0, speed: 8, angle: 0, hook: 0 },
    { x: 0.4, speed: 7, angle: 0.05, hook: 0 }, // gutter ball
  ]) {
    const b = launch(l);
    let seen = false;
    for (let i = 0; i < 4000 && b.phase !== "pit"; i++) {
      moveBall(b, 1 / 480);
      if (b.d > LANE.length + LANE.deck + 0.1 && (b.phase as string) !== "pit") {
        seen = true;
        assert.ok(b.y < 0, `ball at d=${b.d.toFixed(2)} is below the deck (y=${b.y.toFixed(3)})`);
      }
    }
    assert.ok(seen && (b.phase as string) === "pit");
  }
});
