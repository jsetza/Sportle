// Match format (owner request): game to 5/7/11, best of three, warm-up,
// bot styles, match intro and the keyboard paddle flag.
import test from "node:test";
import assert from "node:assert/strict";
import {
  match,
  player,
  start,
  step,
  fault,
  hit,
  botShot,
  INTRO,
  GAME_PAUSE,
} from "../src/server/engine.ts";
import {
  createRoom,
  joinController,
  setRules,
  acceptInput,
} from "../src/server/rooms.ts";
import {
  ZERO_INPUT,
  WARMUP_HITS,
  cleanRules,
  DEFAULT_RULES,
} from "../src/shared/types.ts";
import type { Match, Rules } from "../src/shared/types.ts";

const solo = (rules: Partial<Rules> = {}) => {
  const m = match("solo", "medium", "arena", { ...DEFAULT_RULES, ...rules });
  m.players = [player("me", "Me", 0), player("bot-1", "Orbit", 1, true)];
  start(m);
  return m;
};
/** Team `t` wins rallies until it has served and scored `n` more points. */
function win(m: Match, t: number, n = 1) {
  let scored = 0;
  for (let i = 0; i < 200 && scored < n && m.phase !== "over"; i++) {
    const before = m.score[t] + m.games[t] * 100;
    m.phase = "rally";
    fault(m, 1 - t, "Test point");
    if (m.score[t] + m.games[t] * 100 !== before) scored++;
    if ((m.phase as string) === "point" && m.gameWinner !== null) return;
  }
}

test("rules from a client are validated; anything odd falls back to the default", () => {
  assert.deepEqual(cleanRules({ to: 7, bestOf: 3, warmup: true, style: "defender" }), {
    to: 7,
    bestOf: 3,
    warmup: true,
    style: "defender",
  });
  assert.deepEqual(cleanRules({ to: 9, bestOf: 5, warmup: "yes", style: "x" }), DEFAULT_RULES);
  assert.deepEqual(cleanRules(null), DEFAULT_RULES);
});

test("game to 5 ends at 5 with a two-point lead", () => {
  const m = solo({ to: 5 });
  win(m, 0, 4);
  assert.equal(m.score[0], 4);
  assert.notEqual(m.phase, "over");
  win(m, 0, 1);
  assert.equal(m.phase, "over");
  assert.equal(m.winner, 0);
  assert.deepEqual(m.games, [1, 0]);
});

test("win by two still applies to short games", () => {
  const m = solo({ to: 5 });
  m.score = [4, 4];
  m.serving = 0;
  m.serverId = "me";
  m.phase = "rally";
  fault(m, 1, "Test");
  assert.deepEqual(m.score, [5, 4]);
  assert.notEqual(m.phase, "over", "5–4 is not a win");
});

test("best of three: a game win pauses, the next game starts 0–0 with the loser serving", () => {
  const m = solo({ to: 5, bestOf: 3 });
  win(m, 0, 5);
  assert.equal(m.gameWinner, 0);
  assert.deepEqual(m.games, [1, 0]);
  assert.equal(m.phase, "point");
  const t0 = m.time;
  while (m.phase === "point") step(m);
  assert.ok(m.time - t0 >= GAME_PAUSE - 0.01);
  assert.deepEqual(m.score, [0, 0]);
  assert.equal(m.serving, 1, "the team that lost the game serves first");
  assert.equal(m.gameWinner, null);
  // Second game to team 0 ends the match 2–0.
  win(m, 0, 5);
  while (m.phase === "point") step(m);
  if (m.phase !== "over") win(m, 0, 5);
  assert.equal(m.phase, "over");
  assert.equal(m.winner, 0);
  assert.equal(m.games[0], 2);
});

test("the match intro holds the first serve", () => {
  const m = solo();
  assert.ok(m.introUntil > m.time);
  let served = -1;
  for (let i = 0; i < 120 * 8 && served < 0; i++) {
    step(m);
    if (m.phase === "rally") served = m.time;
  }
  // The bot does not serve first here (team 0 serves); force the bot to be the server.
  const b = solo();
  b.serving = 1;
  b.serverId = "bot-1";
  let t = -1;
  for (let i = 0; i < 120 * 8 && t < 0; i++) {
    step(b);
    if (b.phase === "rally") t = b.time;
  }
  assert.ok(t >= INTRO, `bot served at ${t.toFixed(2)} s, intro ${INTRO} s`);
  void served;
});

test("warm-up: no points until the warm-up hits are done, then a fresh 0–0 game", () => {
  const m = solo({ warmup: true });
  assert.equal(m.warmupLeft, WARMUP_HITS);
  assert.equal(m.serving, 1, "the bot feeds the warm-up");
  // Faults during the warm-up never score.
  for (let i = 0; i < 5; i++) {
    m.phase = "rally";
    fault(m, i % 2, "Test");
  }
  assert.deepEqual(m.score, [0, 0]);
  // Human hits count it down.
  const me = m.players[0];
  for (let i = 0; i < WARMUP_HITS; i++) {
    m.phase = "rally";
    m.lastTeam = 1;
    m.hits = 3;
    m.bounces = 1;
    me.pos = { x: 0, y: 0, z: 5 };
    me.lastHit = -10;
    m.time += 1;
    m.ball = { x: 0.45, y: 0.8, z: 5 };
    m.velocity = { x: 0, y: 0, z: 3 };
    assert.ok(hit(m, me, { ...ZERO_INPUT, strength: 0.5 }), "warm-up hit " + i);
  }
  assert.equal(m.warmupLeft, -1, "warm-up over; scoring starts after this rally");
  m.phase = "rally";
  fault(m, 1, "Test");
  assert.deepEqual(m.score, [0, 0], "the last warm-up rally does not score");
  while ((m.phase as string) === "point") step(m);
  assert.equal(m.warmupLeft, 0);
  assert.deepEqual(m.score, [0, 0]);
  assert.ok(m.introUntil > m.time, "a match intro before the real game");
  m.phase = "rally";
  fault(m, 1, "Test");
  assert.ok(m.score[0] + m.score[1] > 0 || (m.serving as number) !== 0, "now rallies count");
});

test("bot style: defenders lob and reset more, attackers hit harder", () => {
  const sample = (style: Rules["style"]) => {
    const m = solo({ style });
    m.difficulty = "hard";
    const bot = m.players[1];
    bot.pos = { x: 0, y: 0, z: -5 };
    m.players[0].pos = { x: 0, y: 0, z: 2.6 }; // opponent at the kitchen line
    m.ball = { x: 0, y: 0.8, z: -5 };
    m.bounces = 1;
    m.hits = 5;
    let soft = 0,
      power = 0;
    for (let i = 0; i < 400; i++) {
      const s = botShot(m, bot);
      power += s.strength;
      if (s.strength < 0.42 || s.pitch > 30) soft++;
    }
    return { soft, power: power / 400 };
  };
  const a = sample("attacker"),
    n = sample("allround"),
    d = sample("defender");
  assert.ok(d.soft > n.soft && n.soft >= a.soft, JSON.stringify({ a, n, d }));
  assert.ok(a.power > n.power && n.power > d.power, JSON.stringify({ a, n, d }));
});

test("the host can set rules in the lobby only, and never in ranked", () => {
  const r = createRoom("solo", "easy");
  setRules(r, { to: 7, bestOf: 3, warmup: true, style: "attacker" }, "hard");
  assert.deepEqual(r.state.rules, { to: 7, bestOf: 3, warmup: true, style: "attacker" });
  assert.equal(r.state.difficulty, "hard");
  r.state.phase = "serve";
  assert.throws(() => setRules(r, { to: 5 }, "easy"));
  const k = createRoom("singles", "hard");
  k.state.ranked = { queue: "1v1" } as Match["ranked"];
  assert.throws(() => setRules(k, { to: 5 }, "easy"), /Ranked/);
});

test("the keyboard paddle flag is validated and recorded on the player", () => {
  const r = createRoom("solo", "easy");
  const j = joinController(r, "Keys", "right");
  const s = r.sessions.get(j.credential)!;
  const base = {
    ...ZERO_INPUT,
    t: Date.now(),
    sensors: true,
    calibrated: true,
  };
  assert.equal(acceptInput(r, s, { ...base, seq: 1, kb: "yes" as unknown as boolean }), false);
  assert.equal(acceptInput(r, s, { ...base, seq: 2, kb: true }, Date.now() + 100), true);
  assert.equal(j.player.keyboard, true);
});
