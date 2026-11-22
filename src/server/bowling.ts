/**
 * Sportle Bowling on the server: lobby, the bowling order, whose turn it is, physics steps,
 * pinfall, scoring and bots. Turns come from the bowlers' own pinfall lists (the lowest
 * unfinished frame, in bowling order), so reordering, skipping and late joins stay consistent.
 * Only the bowler who is up can release a ball; swings from any other phone are ignored here.
 */
import { randomBytes } from "node:crypto";
import {
  BOT_NAMES,
  LANE,
  MAX_BOWLERS,
  RESULT_TIME,
  SWEEP_TIME,
  WAIT_LIMIT,
  framePos,
  isSplit,
  leaveName,
  scoreSheet,
  strikeRun,
} from "../shared/bowling.ts";
import type {
  BotLevel,
  Bowl,
  Bowler,
  BowlMode,
  Callout,
  LaneId,
} from "../shared/bowling.ts";
import { DEFAULT_GEAR, clamp } from "../shared/types.ts";
import type { Gear, Input, Outfit } from "../shared/types.ts";
import {
  freshPins,
  launch,
  pathAt,
  rng,
  settled,
  stepLane,
  sweepDeadwood,
} from "./bowlphysics.ts";
import type { Launch } from "./bowlphysics.ts";

export function newBowl(
  mode: BowlMode = "game",
  lane: LaneId = "neon",
  bot: BotLevel = "",
  cap = MAX_BOWLERS,
): Bowl {
  return {
    game: "bowling",
    mode,
    lane,
    bot,
    cap: clamp(Math.round(cap), 1, MAX_BOWLERS),
    phase: "lobby",
    phaseAt: 0,
    time: 0,
    players: [],
    turn: 0,
    frame: 0,
    ballNo: 0,
    pins: freshPins(),
    ball: null,
    shot: null,
    message: "Scan the QR to join",
    event: 0,
    paused: false,
    waitSince: 0,
    handicap: false,
    winners: [],
    seed: randomBytes(4).readUInt32LE(0) | 0,
    bowls: 0,
  };
}
export function bowler(id: string, name: string, hand: "left" | "right" = "right"): Bowler {
  return {
    id,
    name,
    hand,
    outfit: "classic",
    gear: { ...DEFAULT_GEAR },
    bot: "",
    connected: true,
    lastSeen: Date.now(),
    ready: false,
    sensors: false,
    calibrated: false,
    curve: 0,
    board: 0,
    rolls: [],
    practice: [],
    startFrame: 0,
    handicap: 0,
    botFor: false,
    display: "",
    strikes: 0,
    bowls: 0,
  };
}
const humans = (b: Bowl) => b.players.filter((p) => !p.bot);
const say = (b: Bowl, msg: string) => {
  b.message = msg;
  b.event++;
};
/** Is the phone of this bowler live right now (connected, sensors on, calibrated)? */
export const live = (p: Bowler, now = Date.now()) =>
  !!p.bot || (p.connected && now - p.lastSeen < 2500 && p.sensors && p.calibrated);

/** Add a phone to the game. Late joiners start at the next frame (or frame 1 + handicap). */
export function addBowler(
  b: Bowl,
  id: string,
  name: string,
  hand: "left" | "right",
  outfit: Outfit,
  gear: Gear,
  display = "",
) {
  if (humans(b).length >= b.cap)
    throw Error(b.cap === 1 ? "This is a single-player game" : "All six bowler spots are taken");
  if (b.phase === "over") throw Error("This game is over. Ask the host for a new game.");
  const p = bowler(id, name, hand);
  p.outfit = outfit;
  p.gear = gear;
  p.display = display;
  if (b.phase !== "lobby" && b.mode === "game") {
    // Join at the next frame boundary: the frames already played count as empty
    // (or, with handicap on, are credited with the field's average per frame).
    const start = b.frame + (anyBowledIn(b, b.frame) ? 1 : 0);
    if (start > 9) throw Error("The game is in its last frame. Join the next game.");
    p.startFrame = start;
    for (let f = 0; f < start; f++) p.rolls.push(0, 0);
    if (b.handicap) p.handicap = handicapFor(b, start);
    say(b, `${name} joins at frame ${start + 1}`);
  }
  // Bots bowl last: insert humans before any bot.
  const firstBot = b.players.findIndex((q) => q.bot);
  if (firstBot >= 0) b.players.splice(firstBot, 0, p);
  else b.players.push(p);
  if (b.phase !== "lobby") syncTurn(b);
  return p;
}
const anyBowledIn = (b: Bowl, f: number) =>
  b.players.some((p) => {
    const fp = framePos(p.rolls);
    return fp.frame > f || (fp.frame === f && fp.ball > 0);
  });
/** Average score per frame of the bowlers already playing, times the frames missed. */
function handicapFor(b: Bowl, frames: number) {
  const done = b.players
    .map((p) => scoreSheet(p.rolls).frames.filter((f) => f.total !== null).length)
    .reduce((a, n) => a + n, 0);
  const pins = b.players.map((p) => scoreSheet(p.rolls).total).reduce((a, n) => a + n, 0);
  return done ? Math.round((pins / done) * frames) : 0;
}
/** Host: change the bowling order in the lobby (a permutation of the current bowlers). */
export function reorder(b: Bowl, ids: unknown) {
  if (b.phase !== "lobby") throw Error("Change the order before the game starts");
  if (!Array.isArray(ids) || ids.length !== b.players.length)
    throw Error("Send every bowler once");
  const out: Bowler[] = [];
  for (const id of ids) {
    const p = b.players.find((q) => q.id === id);
    if (!p || out.includes(p)) throw Error("Send every bowler once");
    out.push(p);
  }
  b.players = out;
  b.event++;
}
export function setOptions(b: Bowl, a: Record<string, unknown>) {
  if (b.phase !== "lobby" && b.phase !== "over")
    throw Error("Change the game before it starts");
  if (a.mode === "practice" || a.mode === "game") b.mode = a.mode;
  if (a.bot === "" || a.bot === "easy" || a.bot === "medium" || a.bot === "hard")
    b.bot = a.bot;
  if (typeof a.handicap === "boolean") b.handicap = a.handicap;
  b.event++;
}
/** Host: start the game once every phone that joined is set up. */
export function startBowl(b: Bowl, now = Date.now()) {
  if (b.phase !== "lobby" && b.phase !== "over") throw Error("Already bowling");
  const h = humans(b);
  if (!h.length) throw Error("Scan the QR with a phone to join first");
  const notReady = h.filter((p) => !p.ready || !live(p, now));
  if (notReady.length)
    throw Error(
      `Waiting for ${notReady.map((p) => p.name).join(" & ")} to finish phone setup`,
    );
  b.players = b.players.filter((p) => !p.bot);
  if (b.bot) {
    const bot = bowler("bot-" + b.bot, BOT_NAMES[b.bot]);
    bot.bot = b.bot;
    bot.outfit = b.bot === "hard" ? "astro" : b.bot === "medium" ? "headband" : "cap";
    bot.ready = true;
    b.players.push(bot);
  }
  for (const p of b.players) {
    p.rolls = [];
    p.practice = [];
    p.startFrame = 0;
    p.handicap = 0;
    p.botFor = false;
    p.strikes = 0;
    p.bowls = 0;
  }
  b.pins = freshPins();
  b.ball = null;
  b.shot = null;
  b.winners = [];
  b.bowls = 0;
  b.turn = 0;
  b.frame = 0;
  b.ballNo = 0;
  b.paused = false;
  setPhase(b, "aim");
  syncTurn(b);
  say(b, b.mode === "practice" ? "Practice: free bowls" : `Frame 1 · ${b.players[0].name} is up`);
}
function setPhase(b: Bowl, phase: Bowl["phase"]) {
  b.phase = phase;
  b.phaseAt = b.time;
  b.event++;
}
/** Work out who is up (game mode): the lowest unfinished frame, first in bowling order. */
function syncTurn(b: Bowl) {
  if (b.mode === "practice") {
    if (b.turn >= b.players.length) b.turn = 0;
    b.ballNo = b.players[b.turn]?.practice.length ?? 0;
    return;
  }
  let best = -1,
    frame = 10;
  b.players.forEach((p, i) => {
    const fp = framePos(p.rolls);
    if (!fp.done && fp.frame < frame) {
      frame = fp.frame;
      best = i;
    }
  });
  if (best < 0) return finish(b);
  b.turn = best;
  b.frame = frame;
  b.ballNo = framePos(b.players[best].rolls).ball;
  b.waitSince = 0;
}
function finish(b: Bowl) {
  const totals = b.players.map((p) => scoreSheet(p.rolls).total + p.handicap);
  const top = Math.max(...totals);
  b.winners = b.players.filter((_, i) => totals[i] === top).map((p) => p.id);
  b.ball = null;
  setPhase(b, "over");
  const names = b.players.filter((p) => b.winners.includes(p.id)).map((p) => p.name);
  say(b, `${names.join(" & ")} ${names.length > 1 ? "tie" : "wins"} with ${top}`);
}
export const current = (b: Bowl): Bowler | undefined =>
  b.phase === "aim" || b.phase === "rolling" || b.phase === "result" || b.phase === "sweep"
    ? b.players[b.turn]
    : undefined;

/** Turn a phone release (or a bot's choice) into a ball on the lane. */
export function release(b: Bowl, p: Bowler, l: Launch, foul = false) {
  if (b.phase !== "aim" || b.players[b.turn] !== p || b.paused) return false;
  b.ball = launch(l);
  b.bowls++;
  p.bowls++;
  const v = Math.hypot(b.ball.vx, b.ball.vd);
  b.shot = {
    by: p.id,
    name: p.name,
    kmh: Math.round(v * 3.6),
    mph: Math.round(v * 2.237),
    boards: 0,
    pins: 0,
    callout: "",
    extra: "",
    frame: b.frame,
    ball: b.ballNo,
    foul,
    at: b.event + 1,
    x0: b.ball.x,
    slope: b.ball.vx / b.ball.vd,
    before: b.pins.filter((q) => !q.gone && !q.down).length,
    gutter: false,
  };
  b.waitSince = 0;
  setPhase(b, "rolling");
  b.message = `${p.name} bowls · ${b.shot.kmh} km/h`;
  return true;
}
/** A phone's release, as sent in an input packet (strength = effort, side = line, hook). */
export function phoneLaunch(p: Bowler, a: Input): Launch {
  const speed = 4.5 + 6 * clamp(a.strength, 0, 1);
  return {
    x: clamp(p.board, -1, 1) * 0.4,
    speed,
    angle: clamp(a.side ?? 0, -1, 1) * 0.06,
    hook: clamp(a.hook ?? 0, -1, 1),
  };
}
/** Bot aim: pick a line to the pocket, then miss by an amount that depends on the level. */
export function botLaunch(b: Bowl, p: Bowler, level: Exclude<BotLevel, "">): Launch {
  const r = () => rng(b) * 2 - 1;
  const noise = { easy: 1, medium: 0.45, hard: 0.18 }[level];
  const speed = { easy: 6.4, medium: 7.6, hard: 8.3 }[level] + r() * 0.5 * noise;
  const hook = ({ easy: -0.15, medium: -0.4, hard: -0.6 }[level] + r() * 0.25 * noise) * (p.hand === "left" ? -1 : 1);
  const x = (p.hand === "left" ? -1 : 1) * { easy: 0.05, medium: 0.2, hard: 0.3 }[level];
  // Spare shooting: aim at the middle of what's standing.
  const up = b.pins.filter((q) => !q.gone && !q.down);
  const pocket = (p.hand === "left" ? -1 : 1) * 0.065;
  const target =
    up.length && up.length < 10 ? up.reduce((s, q) => s + q.x, 0) / up.length : pocket;
  let lo = -0.1,
    hi = 0.1;
  for (let i = 0; i < 28; i++) {
    const m = (lo + hi) / 2;
    if (pathAt({ x, speed, angle: m, hook }).x < target) lo = m;
    else hi = m;
  }
  return { x, speed, hook, angle: (lo + hi) / 2 + r() * 0.012 * noise };
}
/** Fixed-step update (120 Hz). */
export function stepBowl(b: Bowl, dt = 1 / 120, now = Date.now()) {
  if (b.paused || b.phase === "lobby" || b.phase === "over") return;
  b.time += dt;
  const age = b.time - b.phaseAt;
  const p = b.players[b.turn];
  if (!p) return;
  if (b.phase === "aim") {
    if (p.bot || p.botFor) {
      if (age > 1.8) {
        const l = botLaunch(b, p, p.bot || "medium");
        release(b, p, l);
      }
      return;
    }
    if (!live(p, now)) {
      if (!b.waitSince) b.waitSince = now;
      const waited = (now - b.waitSince) / 1000;
      const msg =
        waited >= WAIT_LIMIT
          ? `${p.name}'s phone is still away · Host: Skip turn or let a bot bowl`
          : `Waiting for ${p.name}'s phone… ${Math.ceil(WAIT_LIMIT - waited)} s`;
      if (b.message !== msg) say(b, msg);
    } else if (b.waitSince) {
      b.waitSince = 0;
      say(b, `${p.name} is back · your turn`);
    }
    return;
  }
  if (b.phase === "rolling") {
    const sub = 4;
    for (let i = 0; i < sub; i++) stepLane(b.ball, b.pins, dt / sub, b);
    const shot = b.shot!,
      ball = b.ball;
    if (ball?.phase === "gutter") shot.gutter = true;
    // Hook readout: how far the ball has moved off the straight line it was released on.
    if (ball && ball.d < LANE.length && ball.phase !== "gutter")
      shot.boards = Math.round((ball.x - (shot.x0 + shot.slope * ball.d)) / LANE.board);
    if ((age > 1 && settled(b.ball, b.pins)) || age > 9) score(b, p);
    return;
  }
  if (b.phase === "result" && age > RESULT_TIME) {
    setPhase(b, "sweep");
    return;
  }
  if (b.phase === "sweep" && age > SWEEP_TIME) nextBall(b, p);
}
/** Count pinfall, write the roll, and pick the callout. */
function score(b: Bowl, p: Bowler) {
  const shot = b.shot!;
  const standingNow = b.pins.filter((q) => !q.gone && !q.down).length;
  const fallen = shot.before - standingNow;
  shot.pins = fallen;
  const fresh = shot.before === 10;
  const standing = b.pins.map((q, i) => (!q.down ? i : -1)).filter((i) => i >= 0);
  let callout: Callout = "",
    extra = "";
  if (fresh && fallen === 10) {
    callout = "STRIKE";
    p.strikes++;
  } else if (!fresh && standing.length === 0) callout = "SPARE";
  else if (fresh && isSplit(standing)) {
    callout = "SPLIT";
    extra = leaveName(standing);
  } else if (fallen === 0 && shot.gutter) callout = "GUTTER";
  if (b.mode === "game") {
    p.rolls.push(fallen);
    if (callout === "STRIKE") {
      const n = strikeRun(p.rolls);
      extra = n === 2 ? "DOUBLE" : n === 3 ? "TURKEY" : n > 3 ? `${n}-BAGGER` : "";
    }
  } else p.practice.push(fallen);
  shot.callout = callout;
  shot.extra = extra;
  shot.at = b.event + 1;
  setPhase(b, "result");
  b.message =
    callout === "STRIKE"
      ? `STRIKE! ${p.name}`
      : callout === "SPARE"
        ? `Spare for ${p.name}`
        : callout === "SPLIT"
          ? `Split: ${extra}`
          : `${p.name}: ${fallen} pin${fallen === 1 ? "" : "s"}`;
}
/** After the sweep: same bowler's next ball (deadwood swept) or the next bowler (new rack). */
function nextBall(b: Bowl, p: Bowler) {
  b.ball = null;
  let sameBowler: boolean, fullRack: boolean;
  if (b.mode === "practice") {
    const done = p.practice[0] === 10 || p.practice.length >= 2;
    if (done) p.practice = [];
    sameBowler = !done;
    fullRack = done;
    if (done) b.turn = (b.turn + 1) % b.players.length;
    b.ballNo = b.players[b.turn].practice.length;
  } else {
    const before = b.frame;
    const fp = framePos(p.rolls);
    sameBowler = !fp.done && fp.frame === before;
    fullRack = !sameBowler || fp.fresh;
    if (p.botFor && !sameBowler) p.botFor = false;
  }
  if (fullRack) b.pins = freshPins();
  else sweepDeadwood(b.pins);
  if (b.mode === "game") syncTurn(b);
  if (b.phase === "over") return;
  setPhase(b, "aim");
  const up = b.players[b.turn];
  b.message =
    b.mode === "practice"
      ? `${up.name}: ball ${b.ballNo + 1}`
      : `Frame ${b.frame + 1} · Ball ${b.ballNo + 1} · ${up.name} is up`;
}
/** Host: skip the missing bowler's frame (it scores as open zeros). */
export function skipTurn(b: Bowl) {
  const p = b.players[b.turn];
  if (b.phase !== "aim" || !p) throw Error("Nobody is waiting to bowl");
  if (p.bot) throw Error("Bots bowl by themselves");
  if (b.mode === "practice") {
    p.practice = [];
    b.turn = (b.turn + 1) % b.players.length;
  } else {
    const f = b.frame;
    while (!framePos(p.rolls).done && framePos(p.rolls).frame === f) p.rolls.push(0);
  }
  b.pins = freshPins();
  if (b.mode === "game") syncTurn(b);
  if ((b.phase as string) !== "over") {
    setPhase(b, "aim");
    say(b, `${p.name}'s turn skipped · ${b.players[b.turn].name} is up`);
  }
}
/** Host: a bot bowls this frame for the missing bowler (their score keeps counting). */
export function botForTurn(b: Bowl) {
  const p = b.players[b.turn];
  if (b.phase !== "aim" || !p || p.bot) throw Error("Nobody is waiting to bowl");
  p.botFor = true;
  b.phaseAt = b.time;
  say(b, `A bot bowls this frame for ${p.name}`);
}
/** Apply one validated phone packet. Returns whether a release happened. */
export function bowlInput(b: Bowl, p: Bowler, a: Input, fresh: boolean, now = Date.now()) {
  p.lastSeen = now;
  p.connected = true;
  p.sensors = a.sensors;
  p.calibrated = a.calibrated;
  p.curve = clamp(a.hook ?? 0, -1, 1);
  // Moving before bowling: only while it's your turn and you haven't let go yet.
  if (a.mx !== undefined && !(b.phase === "rolling" && b.players[b.turn] === p))
    p.board = clamp(a.mx, -1, 1);
  if (!(a.swing && fresh && a.sensors && a.calibrated)) return false;
  // Only the bowler who is up is armed. Everyone else's swings are ignored here.
  if (b.phase !== "aim" || b.players[b.turn] !== p || p.botFor) return false;
  const l = phoneLaunch(p, a);
  // A very hard bowl carries the slide over the foul line: a warning (casual), not a foul.
  return release(b, p, l, a.strength > 0.93);
}
