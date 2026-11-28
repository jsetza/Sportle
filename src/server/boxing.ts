/**
 * Sportle Boxing on the server: fighters, gloves (one or two phones per fighter), punches,
 * guard, dodges, stamina, knockdowns and the count, rounds, the decision, bots and the
 * training drills. Runs inside the same fixed 120 Hz loop as the other games; every hit,
 * block, dodge and knockdown is decided here. Phones send a punch as one input (type, hand,
 * power, timestamp) with an id that is applied once.
 */
import { randomBytes } from "node:crypto";
import {
  BOTS,
  BREAK_TIME,
  COUNT_STEP,
  DODGE_REST,
  DODGE_TIME,
  GUARD_BREAK,
  INTRO_TIME,
  LEVEL,
  MAX_HP,
  PUNCH,
  PUNCH_TYPES,
  RING,
  ROUNDS,
  ROUND_TIME,
  STAMINA_REGEN,
  STAMINA_REST,
  TKO_DOWNS,
  WAIT_LIMIT,
  botDef,
  damage,
  emptyStats,
  getUpHealth,
  other,
  outcome,
  punchCost,
  riseRate,
  score,
  windup,
} from "../shared/boxing.ts";
import type {
  BotId,
  BotLevel,
  Box,
  BoxMode,
  DodgeDir,
  Drill,
  Fighter,
  Glove,
  Hand,
  Punch,
  PunchType,
  RingId,
} from "../shared/boxing.ts";
import { clamp } from "../shared/types.ts";
import type { Gear, Input, Outfit } from "../shared/types.ts";

const DT = 1 / 120;
/** Server-only state of a glove (phone). */
type GloveS = { lastSeen: number; live: boolean; guard: boolean; rise: number; ids: { punch: number; dodge: number } };
/** Server-only state of a fighter. */
type FightS = {
  /** Secret code a second phone uses to join this fighter as the other glove. */
  code: string;
  buffered: { type: PunchType; hand: Hand; power: number } | null;
  dodgeRest: number;
  /** Seconds since the last punch was thrown (stamina recovers faster after a rest). */
  idle: number;
  punchIds: number;
  brain: Brain | null;
};
type Brain = {
  next: number;
  combo: PunchType[];
  guardUntil: number;
  reacted: number;
  counterAt: number;
  breatheAt: number;
  breatheUntil: number;
  danceUntil: number;
  riseAt: number;
  /** A visible tell playing until this time. */
  tellUntil: number;
  tellKind: string;
  /** Bot for a human whose phone is away (plays like a club-level Gusto). */
  stand: BotId;
};
const gloves = new WeakMap<Glove, GloveS>();
const fights = new WeakMap<Fighter, FightS>();
const G = (g: Glove) => gloves.get(g)!;
const F = (f: Fighter) => fights.get(f)!;

export function newBox(
  mode: BoxMode = "solo",
  ring: RingId = "neon",
  level: BotLevel = "club",
  opponent: BotId = "zola",
  drill: Drill = "bag",
  opts: { roundTime?: number; hp?: number } = {},
): Box {
  return {
    game: "boxing",
    mode,
    ring,
    level,
    opponent,
    drill,
    phase: "lobby",
    round: 0,
    clock: 0,
    roundTime: clamp(Math.round(opts.roundTime ?? ROUND_TIME), 10, 180),
    startHp: clamp(Math.round(opts.hp ?? MAX_HP), 10, MAX_HP),
    time: 0,
    phaseAt: 0,
    fighters: [],
    count: { who: "", n: 0 },
    hits: [],
    callouts: [],
    result: { winner: "", how: "", scores: {} },
    paused: false,
    pauseReason: "",
    message: "Scan the QR to join",
    event: 0,
    seed: randomBytes(4).readUInt32LE(0) | 0,
  };
}
/** Seeded random numbers, so tests can repeat a fight. */
export function rng(b: Box) {
  b.seed = (b.seed + 0x6d2b79f5) | 0;
  let t = b.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const say = (b: Box, msg: string) => {
  b.message = msg;
  b.event++;
};
let calls = 1,
  hitIds = 1;
export function callout(b: Box, who: string, text: string, kind = "good") {
  b.callouts.push({ at: calls++, who, text, kind });
  if (b.callouts.length > 12) b.callouts.shift();
}
export const humans = (b: Box) => b.fighters.filter((f) => !f.bot);
const capacity = (b: Box) => (b.mode === "solo" ? 1 : 2);
function fighter(id: string, name: string, bot: BotId | ""): Fighter {
  const f: Fighter = {
    id,
    name,
    bot,
    outfit: "classic",
    gear: { paddle: 0, shoes: 0, eyes: 0 },
    display: "",
    corner: 0,
    x: 0,
    hp: MAX_HP,
    stamina: 1,
    downs: 0,
    downsTotal: 0,
    guard: false,
    guardBroken: 0,
    dodge: "",
    dodgeLeft: 0,
    punch: null,
    stun: 0,
    rise: 0,
    gloves: [],
    ready: !!bot,
    connected: true,
    away: 0,
    botFor: false,
    stats: emptyStats(),
    lagMs: 0,
    tellAnim: "",
    drill: null,
    beat: [],
    last: null,
  };
  fights.set(f, { code: randomBytes(6).toString("base64url"), buffered: null, dodgeRest: 0, idle: 9, punchIds: 0, brain: null });
  return f;
}
function addGlove(f: Fighter, id: string, hand: Hand) {
  const g: Glove = { id, hand, connected: true, ready: false };
  gloves.set(g, { lastSeen: Date.now(), live: false, guard: false, rise: 0, ids: { punch: -1, dodge: -1 } });
  f.gloves.push(g);
  f.ready = false;
  return g;
}
/** The secret code for this fighter's second phone (only sent to the fighter's own phone). */
export const gloveCode = (f: Fighter) => F(f).code;
/** A phone joins as a new fighter (lobby only). Returns the fighter and its first glove. */
export function addBoxer(b: Box, gloveId: string, name: string, hand: Hand, outfit: Outfit, gear: Gear, display = "") {
  if (b.phase !== "lobby" && b.phase !== "over") throw Error("A fight is on. Join when it ends.");
  if (humans(b).length >= capacity(b))
    throw Error(b.mode === "solo" ? "This is a one-player fight. Pick 2 players on the TV for two fighters." : "Both corners are taken");
  const f = fighter(randomBytes(5).toString("base64url"), name, "");
  f.outfit = outfit;
  f.gear = gear;
  f.display = display;
  if (b.phase === "over") toLobby(b);
  b.fighters = humans(b);
  b.fighters.push(f);
  f.corner = b.fighters.length > 1 ? 1 : 0;
  const g = addGlove(f, gloveId, hand);
  say(b, `${name} joined`);
  return { fighter: f, glove: g };
}
/** A second phone joins an existing fighter as the other glove (secret code from that fighter's phone). */
export function addSecondGlove(b: Box, gloveId: string, code: string, hand?: Hand) {
  const f = b.fighters.find((q) => !q.bot && F(q).code === code);
  if (!f) throw Error("That glove code isn't in this room. Scan the code on your first phone again.");
  if (f.gloves.length >= 2) throw Error(`${f.name} already has two gloves`);
  const g = addGlove(f, gloveId, f.gloves[0] ? other(f.gloves[0].hand) : (hand ?? "left"));
  say(b, `${f.name}'s second glove joined (${g.hand.toUpperCase()})`);
  return { fighter: f, glove: g };
}
/** Find a glove and its fighter by the glove (phone) id. */
export function gloveOf(b: Box, id: string) {
  for (const f of b.fighters) {
    const g = f.gloves.find((q) => q.id === id);
    if (g) return { fighter: f, glove: g };
  }
  return null;
}
/** A phone reloaded: its press counters start again. */
export function resetGlove(g: Glove) {
  const s = G(g);
  s.ids = { punch: -1, dodge: -1 };
  s.lastSeen = Date.now();
  g.connected = true;
}
/** A phone changed its hand in setup (one-phone fighters only; two gloves are left + right). */
export function setHand(f: Fighter, g: Glove, hand: Hand) {
  if (f.gloves.length === 2) {
    const o = f.gloves.find((q) => q !== g)!;
    o.hand = other(hand);
  }
  g.hand = hand;
}
/** Is this glove live now (connected, sensors on, set up)? */
export const gloveLive = (g: Glove, now = Date.now()) => g.connected && now - G(g).lastSeen < 2500 && G(g).live;
export const fighterLive = (f: Fighter, now = Date.now()) => !!f.bot || f.botFor || (f.gloves.length > 0 && f.gloves.some((g) => gloveLive(g, now)));
export function setOptions(b: Box, a: Record<string, unknown>) {
  if (b.phase !== "lobby" && b.phase !== "over") throw Error("Change options between fights");
  if (a.ring === "neon" || a.ring === "arena" || a.ring === "rooftop") b.ring = a.ring;
  if (a.level === "rookie" || a.level === "club" || a.level === "pro") b.level = a.level;
  if (typeof a.opponent === "string" && BOTS.some((x) => x.id === a.opponent)) b.opponent = a.opponent as BotId;
  if (a.drill === "bag" || a.drill === "mitts") b.drill = a.drill;
  if (b.phase === "over") toLobby(b);
  b.event++;
}
// ——————————————————————————— Phases ———————————————————————————
function setPhase(b: Box, phase: Box["phase"]) {
  b.phase = phase;
  b.phaseAt = b.time;
  b.event++;
}
function fresh(f: Fighter, b: Box) {
  f.hp = b.startHp;
  f.stamina = 1;
  f.downs = 0;
  f.downsTotal = 0;
  f.guard = false;
  f.guardBroken = 0;
  f.dodge = "";
  f.dodgeLeft = 0;
  f.punch = null;
  f.stun = 0;
  f.rise = 0;
  f.stats = emptyStats();
  f.last = null;
  f.away = 0;
  f.botFor = false;
  f.tellAnim = "";
  const s = F(f);
  s.buffered = null;
  s.dodgeRest = 0;
  s.idle = 9;
  if (f.bot) s.brain = brain(f.bot);
}
function brain(stand: BotId): Brain {
  return { next: 0.8, combo: [], guardUntil: 0, reacted: -1, counterAt: 0, breatheAt: 0, breatheUntil: 0, danceUntil: 0, riseAt: 0, tellUntil: 0, tellKind: "", stand };
}
/** Host: start the fight (or training) once every phone is set up. */
export function startBox(b: Box, now = Date.now()) {
  if (b.phase !== "lobby" && b.phase !== "over") throw Error("Already boxing");
  // A phone that left the lobby long ago is dropped (it can scan again).
  const gone = humans(b).filter((f) => !fighterLive(f, now) && f.gloves.every((g) => now - G(g).lastSeen > WAIT_LIMIT * 1000));
  if (gone.length) {
    b.fighters = b.fighters.filter((f) => !gone.includes(f));
    say(b, `${gone.map((f) => f.name).join(" & ")} left`);
  }
  const hs = humans(b);
  const need = b.mode === "versus" ? 2 : 1;
  if (hs.length < need) throw Error(b.mode === "versus" ? "Two fighters needed: scan the QR with a second phone" : "Scan the QR with your phone first");
  const notReady = hs.filter((f) => !f.ready || !fighterLive(f, now));
  if (notReady.length) throw Error(`Waiting for ${notReady.map((f) => f.name).join(" & ")} to finish setup`);
  b.fighters = hs;
  hs.forEach((f, i) => {
    f.corner = (i ? 1 : 0) as 0 | 1;
    f.x = b.mode === "training" && hs.length > 1 ? (i ? 1.3 : -1.3) : 0;
    fresh(f, b);
    f.drill = b.mode === "training" ? { call: "", callAt: 0, score: 0, streak: 0, misses: 0, count: { jab: 0, hook: 0, upper: 0 }, bagAt: -9, bagDir: 0, bagPower: 0 } : null;
  });
  if (b.mode === "solo") {
    const def = botDef(b.opponent);
    const bot = fighter("bot-" + def.id, def.name, def.id);
    bot.corner = 1;
    bot.outfit = def.outfit;
    bot.gear = { paddle: 0, shoes: 1, eyes: def.eyes };
    fresh(bot, b);
    b.fighters.push(bot);
  }
  b.hits = [];
  b.callouts = [];
  b.count = { who: "", n: 0 };
  b.result = { winner: "", how: "", scores: {} };
  b.paused = false;
  b.pauseReason = "";
  if (b.mode === "training") {
    b.round = 0;
    setPhase(b, "training");
    say(b, b.drill === "bag" ? "Training: hit the bag. Every punch shows its type and power." : `Training: ${"Coach Kip"} calls a move, you do it.`);
    return;
  }
  b.round = 1;
  b.clock = b.roundTime;
  setPhase(b, "intro");
  say(b, "ROUND 1");
}
export function toLobby(b: Box) {
  b.fighters = humans(b);
  for (const f of b.fighters) {
    fresh(f, b);
    f.drill = null;
  }
  b.round = 0;
  b.count = { who: "", n: 0 };
  b.paused = false;
  b.pauseReason = "";
  setPhase(b, "lobby");
  say(b, "Pick a ring and start");
}
/** Solo: after a win, face the next opponent on the ladder (or the same one again). */
export function nextOpponent(b: Box) {
  if (b.mode !== "solo") throw Error("Ladder is for solo fights");
  const i = BOTS.findIndex((x) => x.id === b.opponent);
  const won = b.result.winner && !b.fighters.find((f) => f.id === b.result.winner)?.bot;
  if (won && i < BOTS.length - 1) b.opponent = BOTS[i + 1].id;
  toLobby(b);
}
// ——————————————————————————— Inputs ———————————————————————————
/** Extra boxing fields in a phone packet (the rest are checked by admitInput). */
export function boxFieldsOk(a: Record<string, unknown>) {
  if (typeof a.guard !== "boolean") return false;
  for (const k of ["punchId", "dodgeId"]) if (a[k] !== undefined && (!Number.isSafeInteger(a[k]) || (a[k] as number) < 0)) return false;
  if (a.punchId !== undefined) {
    if (a.ptype !== 0 && a.ptype !== 1 && a.ptype !== 2) return false;
    if (a.phand !== 0 && a.phand !== 1) return false;
    if (typeof a.power !== "number" || !Number.isFinite(a.power) || a.power < 0 || a.power > 1) return false;
    if (typeof a.pt !== "number" || !Number.isFinite(a.pt)) return false;
  }
  if (a.dodgeId !== undefined && a.ddir !== 0 && a.ddir !== 1 && a.ddir !== 2) return false;
  if (a.rise !== undefined && (typeof a.rise !== "number" || !Number.isFinite(a.rise) || a.rise < 0 || a.rise > 1)) return false;
  return true;
}
const canAct = (b: Box, f: Fighter) => (b.phase === "fight" || b.phase === "training") && !b.paused && f.hp > 0;
/** Apply one validated phone packet from a glove. */
export function boxInput(b: Box, f: Fighter, g: Glove, a: Input & Record<string, any>, now = Date.now()) {
  const s = G(g);
  s.lastSeen = now;
  s.live = a.sensors && a.calibrated;
  if (!g.connected) b.event++;
  g.connected = true;
  f.connected = true;
  s.guard = !!a.guard;
  s.rise = typeof a.rise === "number" ? a.rise : 0;
  if (typeof a.punchId === "number" && a.punchId > s.ids.punch) {
    s.ids.punch = a.punchId;
    const lag = clamp(now - a.pt, 0, 1000);
    f.lagMs = f.lagMs ? f.lagMs * 0.8 + lag * 0.2 : lag;
    // Two phones: each is one hand. One phone: the phone says which hand (SWITCH = other hand).
    const hand: Hand = f.gloves.length === 2 ? g.hand : a.phand === 0 ? "left" : "right";
    if (s.live && canAct(b, f) && !f.botFor) throwPunch(b, f, PUNCH_TYPES[a.ptype], hand, a.power, lag / 1000);
  }
  if (typeof a.dodgeId === "number" && a.dodgeId > s.ids.dodge) {
    s.ids.dodge = a.dodgeId;
    if (s.live && canAct(b, f) && !f.botFor) startDodge(b, f, (["left", "right", "duck"] as DodgeDir[])[a.ddir]);
  }
}
// ——————————————————————————— Fighting ———————————————————————————
const opponentOf = (b: Box, f: Fighter) => (b.mode === "training" ? null : b.fighters.find((q) => q !== f) ?? null);
/** Is this fighter mid-punch (winding up or striking)? A hit now is a counter. */
const punching = (f: Fighter) => !!f.punch && f.punch.t < f.punch.windup + 0.08;
/**
 * Throw a punch. `age` is how long ago the phone read it (s): the wind-up starts that much
 * further along (up to most of it), so phone→server delay doesn't add to the wind-up.
 */
export function throwPunch(b: Box, f: Fighter, type: PunchType, hand: Hand, power: number, age = 0) {
  const s = F(f);
  if (f.hp <= 0 || f.stun > 0.15) return false;
  if (f.punch || f.stun > 0) {
    // Mid-punch: keep the next one ready (a combo flows on as soon as this one is back).
    s.buffered = { type, hand, power };
    return false;
  }
  const def = f.bot ? botDef(f.bot) : null;
  let w = windup(type, f.stamina);
  if (def) w += def.style.tell[type] * (1.25 - 0.45 * LEVEL[b.level].skill);
  const p: Punch = {
    id: ++s.punchIds,
    type,
    hand,
    power: clamp(power, 0, 1),
    t: f.bot ? 0 : clamp(age, 0, Math.max(0, w - 0.05)),
    windup: w,
    tell: !!def && def.style.tell[type] >= 0.15,
    landed: "",
  };
  f.punch = p;
  f.dodge = "";
  f.dodgeLeft = 0;
  f.guard = false;
  f.stamina = clamp(f.stamina - punchCost(type, power) * (def ? def.style.tire : 1), 0, 1);
  s.idle = 0;
  f.stats.thrown++;
  f.stats.byType[type]++;
  f.last = { type, power: p.power, at: b.time };
  if (!f.bot && f.stamina < 0.18 && f.stamina + punchCost(type, power) >= 0.18) callout(b, f.id, "TIRED! EASE OFF", "bad");
  b.event++;
  return true;
}
export function startDodge(b: Box, f: Fighter, dir: DodgeDir) {
  const s = F(f);
  if (f.hp <= 0 || f.stun > 0 || punching(f) || f.dodgeLeft > 0 || s.dodgeRest > 0) return false;
  f.dodge = dir;
  f.dodgeLeft = DODGE_TIME;
  f.guard = false;
  b.event++;
  return true;
}
function event(b: Box, by: Fighter, to: Fighter | null, p: Punch, result: Box["hits"][number]["result"], dmg: number) {
  b.hits.push({ at: hitIds++, by: by.id, to: to?.id ?? "", type: p.type, hand: p.hand, result, dmg: Math.round(dmg * 10) / 10, power: Math.round(p.power * 100) / 100 });
  if (b.hits.length > 10) b.hits.shift();
}
/** The punch reaches its target: decided against the defender's state right now. */
function impact(b: Box, f: Fighter, p: Punch) {
  if (b.mode === "training") return drillHit(b, f, p);
  const o = opponentOf(b, f);
  if (!o || o.hp <= 0) return;
  const res = outcome(p.type, { guard: o.guard, dodge: o.dodge, punching: punching(o) });
  const def = f.bot ? botDef(f.bot) : null;
  const dmg = damage(p.type, p.power, f.stamina, res.mult) * (def ? def.style.power * LEVEL[b.level].power : 1);
  p.landed = res.result;
  const name = PUNCH[p.type].name;
  if (res.result === "dodge") {
    o.stats.dodged++;
    event(b, f, o, p, "dodge", 0);
    callout(b, o.id, "DODGED!", "good");
    callout(b, f.id, "MISSED", "bad");
    reactBot(b, o, f, true);
    return;
  }
  o.hp = Math.max(0, o.hp - dmg);
  if (res.result === "block") {
    o.stats.blocked++;
    o.stun = Math.max(o.stun, 0.06);
    event(b, f, o, p, "block", dmg);
    callout(b, f.id, "BLOCKED", "bad");
    callout(b, o.id, "BLOCKED", "good");
    reactBot(b, o, f, true);
  } else {
    f.stats.landed++;
    f.stats.power += p.power;
    f.stats.best = Math.max(f.stats.best, p.power);
    const counter = res.result === "counter";
    const armored = counter && !!o.bot && !!botDef(o.bot).style.armor && !!o.punch?.tell;
    if (counter) {
      f.stats.counters++;
      if (!armored) {
        o.punch = null;
        F(o).buffered = null;
      }
    }
    if (!armored) o.stun = Math.max(o.stun, PUNCH[p.type].stun * (counter ? 1.3 : 1));
    o.dodge = "";
    o.dodgeLeft = 0;
    if (res.result === "guardbreak") {
      o.guardBroken = GUARD_BREAK;
      o.guard = false;
      callout(b, o.id, "GUARD BROKEN!", "bad");
    }
    event(b, f, o, p, res.result, dmg);
    callout(b, f.id, counter ? "COUNTER!" : res.result === "guardbreak" ? name + " · GUARD BREAK!" : res.result === "around" ? name + " · AROUND THE GUARD" : name, counter ? "perfect" : "good");
  }
  if (o.hp <= 0) knockdown(b, o, f);
}
function knockdown(b: Box, o: Fighter, by: Fighter) {
  o.hp = 0;
  o.downs++;
  o.downsTotal++;
  by.stats.knockdowns++;
  o.punch = null;
  by.punch = null;
  F(o).buffered = null;
  F(by).buffered = null;
  o.guard = false;
  o.dodge = "";
  o.rise = 0;
  callout(b, by.id, "DOWN!", "perfect");
  callout(b, o.id, "DOWN!", "bad");
  if (o.downs >= TKO_DOWNS) return finish(b, by, "TKO");
  b.count = { who: o.id, n: 1 };
  if (o.bot || o.botFor) {
    // Bots get up later each time; rookies are slower, pros quicker. Past 9 they stay down.
    const lvl = b.level === "rookie" ? 1 : b.level === "pro" ? -1 : 0;
    const s = F(o);
    s.brain ??= brain("gusto");
    s.brain.riseAt = 2.5 + 2 * (o.downsTotal - 1) + rng(b) * 3 + lvl;
  }
  setPhase(b, "down");
  say(b, `${o.name} is down!`);
}
function finish(b: Box, winner: Fighter | null, how: Box["result"]["how"]) {
  const scores: Record<string, number> = {};
  for (const f of b.fighters) scores[f.id] = score(f);
  b.result = { winner: winner?.id ?? "", how, scores };
  b.count = { who: "", n: 0 };
  for (const f of b.fighters) {
    f.punch = null;
    F(f).buffered = null;
  }
  if (winner && b.mode === "solo" && !winner.bot) {
    const bot = b.fighters.find((f) => f.bot);
    if (bot && !winner.beat.includes(bot.bot as BotId)) winner.beat.push(bot.bot as BotId);
  }
  setPhase(b, "over");
  if (winner) {
    callout(b, winner.id, how === "DECISION" ? "WINNER!" : how + "!", "perfect");
    const loser = b.fighters.find((f) => f !== winner);
    if (loser && how !== "DECISION") callout(b, loser.id, how + "!", "bad");
  }
  say(b, winner ? `${winner.name} wins by ${how === "DECISION" ? "decision" : how}!` : "A draw!");
}
function endRound(b: Box) {
  if (b.round < ROUNDS) {
    setPhase(b, "break");
    say(b, `End of round ${b.round}`);
    return;
  }
  const [a, c] = b.fighters;
  const sa = score(a),
    sc = c ? score(c) : -1;
  finish(b, sa === sc ? null : sa > sc ? a : c, sa === sc ? "DRAW" : "DECISION");
}
/** One fighter's timers, stamina, guard and punch progress for this tick. */
function stepFighter(b: Box, f: Fighter, dt: number, now: number) {
  const s = F(f);
  f.stun = Math.max(0, f.stun - dt);
  f.guardBroken = Math.max(0, f.guardBroken - dt);
  if (f.dodgeLeft > 0) {
    f.dodgeLeft -= dt;
    if (f.dodgeLeft <= 0) {
      f.dodge = "";
      f.dodgeLeft = 0;
      s.dodgeRest = DODGE_REST;
    }
  } else s.dodgeRest = Math.max(0, s.dodgeRest - dt);
  s.idle += dt;
  if (!f.punch) f.stamina = clamp(f.stamina + (s.idle > 1.2 ? STAMINA_REST : STAMINA_REGEN) * dt, 0, 1);
  if (f.bot || f.botFor) botStep(b, f, now);
  else f.guard = f.gloves.filter((g) => gloveLive(g, now)).every((g) => G(g).guard) && f.gloves.some((g) => gloveLive(g, now));
  if (f.punch || f.guardBroken > 0 || f.dodge || f.stun > 0.1) f.guard = false;
  const p = f.punch;
  if (!p) return;
  const before = p.t;
  p.t += dt;
  if (before < p.windup && p.t >= p.windup) impact(b, f, p);
  if (f.punch === p && p.t >= p.windup + 0.08 + PUNCH[p.type].recover) {
    f.punch = null;
    const nx = s.buffered;
    s.buffered = null;
    if (nx && (b.phase === "fight" || b.phase === "training")) throwPunch(b, f, nx.type, nx.hand, nx.power);
  }
}
/** The 120 Hz step. */
export function stepBox(b: Box, dt = DT, now = Date.now()) {
  if (b.phase === "lobby" || b.phase === "over") return;
  presence(b, now);
  if (b.paused) return;
  b.time += dt;
  const age = b.time - b.phaseAt;
  if (b.phase === "intro") {
    if (age >= INTRO_TIME) {
      setPhase(b, "fight");
      for (const f of b.fighters) callout(b, f.id, "FIGHT!", "perfect");
      say(b, "FIGHT!");
    }
    return;
  }
  if (b.phase === "break") {
    for (const f of b.fighters) {
      f.stamina = Math.min(1, f.stamina + dt * 0.4);
      f.hp = Math.min(b.startHp, f.hp + dt * 1.2);
    }
    if (age >= BREAK_TIME) {
      b.round++;
      b.clock = b.roundTime;
      for (const f of b.fighters) {
        f.downs = 0;
        f.punch = null;
        f.stun = 0;
        f.dodge = "";
        f.dodgeLeft = 0;
        F(f).buffered = null;
      }
      setPhase(b, "intro");
      say(b, "ROUND " + b.round);
    }
    return;
  }
  if (b.phase === "down") return stepDown(b, dt, now);
  if (b.phase === "fight") {
    b.clock = Math.max(0, b.clock - dt);
  }
  for (const f of b.fighters) {
    stepFighter(b, f, dt, now);
    if (b.phase !== "fight" && b.phase !== "training") return;
  }
  if (b.phase === "training") for (const f of b.fighters) drillStep(b, f, now);
  if (b.phase === "fight" && b.clock <= 0) endRound(b);
}
/** The count: one number a second. The downed fighter gets up by moving the phone (or a bot by its plan). */
function stepDown(b: Box, dt: number, now: number) {
  const o = b.fighters.find((f) => f.id === b.count.who);
  if (!o) return setPhase(b, "fight");
  const age = b.time - b.phaseAt;
  const n = Math.min(10, 1 + Math.floor(age / COUNT_STEP));
  if (n !== b.count.n) {
    b.count.n = n;
    b.event++;
  }
  if (o.bot || o.botFor) {
    const at = F(o).brain?.riseAt ?? 99;
    o.rise = clamp(age / Math.max(1, at), 0, 1);
  } else {
    const live = o.gloves.filter((g) => gloveLive(g, now));
    const effort = live.length ? Math.max(...live.map((g) => G(g).rise)) : 0;
    o.rise = clamp(o.rise + effort * riseRate(o.downsTotal) * dt, 0, 1);
  }
  if (o.rise >= 1 && n >= 2) {
    o.hp = Math.min(b.startHp, getUpHealth(o.downsTotal));
    o.stun = 0.5;
    o.rise = 0;
    b.count = { who: "", n: 0 };
    const keep = b.phaseAt;
    setPhase(b, "fight");
    void keep;
    callout(b, o.id, "BACK UP!", "good");
    say(b, `${o.name} beats the count!`);
    return;
  }
  if (age >= 10 * COUNT_STEP) {
    const by = b.fighters.find((f) => f !== o) ?? null;
    finish(b, by, "KO");
  }
}
/** Drop → pause → resume: a fighter whose phones are all away pauses the fight until one is back. */
function presence(b: Box, now: number) {
  for (const f of humans(b)) {
    const ok = fighterLive(f, now);
    if (!ok) {
      if (!f.away) {
        f.away = now;
        if (!b.paused) {
          b.paused = true;
          b.pauseReason = "away";
        }
        say(b, `Waiting for ${f.name}'s phone…`);
      }
    } else if (f.away) {
      f.away = 0;
      say(b, `${f.name} is back`);
    }
  }
  if (b.paused && b.pauseReason === "away" && humans(b).every((f) => !f.away)) {
    b.paused = false;
    b.pauseReason = "";
    say(b, b.phase === "training" ? "Training" : "Box!");
  }
}
/** Host: a bot boxes for a fighter whose phone is away (until it's back). */
export function botForNow(b: Box, id: string) {
  const f = b.fighters.find((q) => q.id === id && !q.bot);
  if (!f || !f.away) throw Error("That phone isn't away");
  f.botFor = true;
  F(f).brain = brain("gusto");
  f.away = 0;
  say(b, `A bot boxes for ${f.name} until their phone is back`);
}
// ——————————————————————————— Bots ———————————————————————————
function botStep(b: Box, f: Fighter, now: number) {
  const s = F(f);
  const br = (s.brain ??= brain(f.bot || "gusto"));
  const def = botDef(f.bot || br.stand);
  const st = def.style;
  const lv = f.bot ? LEVEL[b.level] : LEVEL.club;
  // A human's phone came back: hand the fighter back.
  if (f.botFor && f.gloves.some((g) => gloveLive(g, now))) {
    f.botFor = false;
    s.brain = null;
    say(b, `${f.name} is boxing again`);
    return;
  }
  f.tellAnim = b.time < br.tellUntil ? br.tellKind : "";
  if (b.phase === "training") return;
  const o = opponentOf(b, f);
  if (!o || f.hp <= 0) return;
  const t = b.time;
  // Tortuga's breather: the guard drops for a moment every few seconds.
  if (st.breather) {
    if (!br.breatheAt) br.breatheAt = t + st.breather;
    if (t >= br.breatheAt) {
      br.breatheUntil = t + st.breathe;
      br.breatheAt = t + st.breather + st.breathe + rng(b) * 2;
    }
  }
  const breathing = t < br.breatheUntil;
  if (breathing) f.tellAnim = "breathe";
  const huffing = f.bot === "gusto" && f.stamina < 0.35;
  if (huffing) f.tellAnim = "huff";
  // React to an incoming punch after this level's reaction time: slip/duck the right way or guard.
  const ip = o.punch;
  if (ip && ip.t < ip.windup && br.reacted !== ip.id && ip.t >= lv.react * (0.8 + rng(b) * 0.4)) {
    br.reacted = ip.id;
    const r = rng(b);
    const pd = st.dodge * lv.skill,
      pb = st.block * lv.skill;
    if (!breathing && !f.punch && r < pd) {
      const dir: DodgeDir = ip.type === "hook" ? "duck" : ip.type === "upper" ? (rng(b) < 0.5 ? "left" : "right") : rng(b) < 0.5 ? "duck" : rng(b) < 0.5 ? "left" : "right";
      startDodge(b, f, dir);
    } else if (!breathing && !f.punch && r < pd + pb && !(ip.type === "upper" && lv.skill > 0.8 && rng(b) < 0.5)) br.guardUntil = t + 0.6;
  }
  // Parry taps his gloves when he's set to counter.
  if (f.bot === "parry" && br.guardUntil > t && !f.punch) f.tellAnim = "tap";
  f.guard = !breathing && br.guardUntil > t;
  // Counter-punch after blocking or dodging.
  if (br.counterAt && t >= br.counterAt) {
    br.counterAt = 0;
    if (!f.punch && f.stun <= 0) throwPunch(b, f, rng(b) < 0.6 ? "jab" : "hook", rng(b) < 0.5 ? "left" : "right", 0.6 + 0.3 * lv.skill);
  }
  if (t < br.next || f.punch || f.stun > 0 || f.dodge) return;
  // Next move: keep a combo going, stand in guard, or start an attack.
  if (br.combo.length) {
    const type = br.combo.shift()!;
    throwPunch(b, f, type, rng(b) < 0.5 ? "left" : "right", 0.55 + 0.4 * rng(b));
    br.next = t + 0.05;
    return;
  }
  if (huffing || breathing) {
    br.next = t + 0.4;
    return;
  }
  const pace = st.rate * lv.pace;
  if (rng(b) < st.weave) {
    startDodge(b, f, (["left", "right", "duck"] as DodgeDir[])[Math.floor(rng(b) * 3)]);
    br.next = t + 0.55 + rng(b) * 0.3;
    return;
  }
  if (rng(b) < st.guard) {
    // Guard-heavy bots hold it longer (a turtle stays in its shell).
    const hold = (0.6 + rng(b) * 0.8) * (1 + 2 * st.guard);
    br.guardUntil = t + hold;
    br.next = t + hold * 0.85;
    return;
  }
  // Disco Dina: two dance steps before her combo. Zola bounces quicker before a flurry.
  if (f.bot === "dina" && t >= br.danceUntil + 0.3) {
    br.danceUntil = t + 0.7;
    br.tellUntil = t + 0.7;
    br.tellKind = "dance";
    br.next = t + 0.7;
    return;
  }
  const pickCombo = rng(b) < 0.55;
  if (pickCombo) br.combo = [...st.combos[Math.floor(rng(b) * st.combos.length)]];
  else {
    const r = rng(b) * (st.mix.jab + st.mix.hook + st.mix.upper);
    br.combo = [r < st.mix.jab ? "jab" : r < st.mix.jab + st.mix.hook ? "hook" : "upper"];
  }
  if (f.bot === "zola" && br.combo.length > 1) {
    br.tellUntil = t + 0.45;
    br.tellKind = "bounce";
    br.next = t + 0.45;
    return;
  }
  br.next = t + Math.max(0.15, (1 / pace) * (0.6 + rng(b) * 0.8));
}
/** After a block or a dodge: counter-punchers fire straight back. */
function reactBot(b: Box, f: Fighter, _o: Fighter, _defended: boolean) {
  if (!f.bot && !f.botFor) return;
  const br = F(f).brain;
  if (!br) return;
  const st = botDef(f.bot || br.stand).style;
  if (rng(b) < st.counter * (f.bot ? LEVEL[b.level].skill : 0.75)) br.counterAt = b.time + 0.05 + (f.bot ? LEVEL[b.level].react * 0.4 : 0.15);
}
/** Test hook: let a test fix a bot's next decision time. */
export const brainOf = (f: Fighter) => F(f).brain;
// ——————————————————————————— Training ———————————————————————————
const CALLS: { call: NonNullable<Fighter["drill"]>["call"]; w: number }[] = [
  { call: "jab", w: 3 },
  { call: "hook", w: 3 },
  { call: "upper", w: 3 },
  { call: "guard", w: 1 },
  { call: "duck", w: 1 },
  { call: "left", w: 0.5 },
  { call: "right", w: 0.5 },
];
const CALL_TIME = 2.6;
export const callName = (c: string) => ({ jab: "JAB", hook: "HOOK", upper: "UPPERCUT", guard: "GUARD UP", duck: "DUCK", left: "SLIP LEFT", right: "SLIP RIGHT" })[c] ?? "";
function drillHit(b: Box, f: Fighter, p: Punch) {
  const d = f.drill;
  if (!d) return;
  p.landed = "hit";
  f.stats.landed++;
  f.stats.power += p.power;
  f.stats.best = Math.max(f.stats.best, p.power);
  d.count[p.type]++;
  d.bagAt = b.time;
  d.bagDir = p.type === "hook" ? (p.hand === "right" ? -1 : 1) : 0;
  d.bagPower = p.power;
  event(b, f, null, p, "hit", damage(p.type, p.power, f.stamina, 1));
  const pow = Math.round(p.power * 100);
  if (b.drill === "bag") return callout(b, f.id, `${PUNCH[p.type].name} · ${pow}`, pow >= 70 ? "perfect" : "good");
  if (d.call === p.type) {
    d.streak++;
    d.score += 1 + Math.min(4, d.streak - 1);
    callout(b, f.id, `NICE ${PUNCH[p.type].name}! ${pow}`, pow >= 70 ? "perfect" : "good");
    d.call = "";
    d.callAt = b.time;
  } else if (d.call) {
    d.streak = 0;
    callout(b, f.id, `THAT WAS A ${PUNCH[p.type].name}`, "bad");
  }
}
const guardSince = new WeakMap<Fighter, number>();
function drillStep(b: Box, f: Fighter, _now: number) {
  const d = f.drill;
  if (!d || b.drill !== "mitts") return;
  const t = b.time;
  if (!d.call) {
    if (t - d.callAt < 0.9) return;
    const total = CALLS.reduce((a, c) => a + c.w, 0);
    let r = rng(b) * total;
    d.call = CALLS.find((c) => (r -= c.w) < 0)?.call ?? "jab";
    d.callAt = t;
    b.event++;
    return;
  }
  // Guard calls: hold the guard for half a second. Dodge calls: the matching dodge (any slip for slips).
  let done = false;
  if (d.call === "guard") {
    if (f.guard) {
      if (!guardSince.has(f)) guardSince.set(f, t);
      if (t - guardSince.get(f)! >= 0.5) done = true;
    } else guardSince.delete(f);
  } else if (d.call === "duck" || d.call === "left" || d.call === "right") done = f.dodge === d.call || (d.call !== "duck" && (f.dodge === "left" || f.dodge === "right"));
  if (done) {
    d.streak++;
    d.score += 1 + Math.min(4, d.streak - 1);
    callout(b, f.id, d.call === "guard" ? "SOLID GUARD!" : "NICE MOVE!", "good");
    if (d.call !== "guard" && d.call !== "jab" && d.call !== "hook" && d.call !== "upper") f.stats.dodged++;
    d.call = "";
    d.callAt = t;
    guardSince.delete(f);
    return;
  }
  if (t - d.callAt > CALL_TIME) {
    d.streak = 0;
    d.misses++;
    callout(b, f.id, "TOO SLOW!", "bad");
    d.call = "";
    d.callAt = t;
  }
}
// ——————————————————————————— Housekeeping & view ———————————————————————————
/** 30 Hz: a phone silent for 2.5 s counts as away. */
export function boxAway(b: Box, now = Date.now()) {
  for (const f of humans(b)) {
    for (const g of f.gloves)
      if (g.connected && now - G(g).lastSeen > 2500) {
        g.connected = false;
        b.event++;
      }
    f.connected = f.gloves.some((g) => g.connected);
  }
}
/** The phone left the page (locked screen, switched apps). */
export function boxBackground(b: Box, g: Glove) {
  g.connected = false;
  G(g).lastSeen = 0;
  b.event++;
}
/** Set up and sending live sensor data? */
export const boxLive = (g: Glove, now = Date.now()) => g.connected && now - G(g).lastSeen < 2000 && G(g).live;
/** Phone ready: the fighter is ready once all its gloves are. */
export function setReady(b: Box, f: Fighter, g: Glove, ready: boolean) {
  g.ready = ready;
  f.ready = f.gloves.length > 0 && f.gloves.every((q) => q.ready);
  b.event++;
}
const viewCache = new WeakMap<Box, { time: number; event: number; v: unknown }>();
export function boxView(b: Box) {
  const c = viewCache.get(b);
  if (c && c.time === b.time && c.event === b.event) return c.v;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const v = {
    ...b,
    time: r2(b.time),
    clock: r2(b.clock),
    fighters: b.fighters.map((f) => ({
      ...f,
      hp: r2(f.hp),
      stamina: r2(f.stamina),
      guardBroken: r2(f.guardBroken),
      dodgeLeft: r2(f.dodgeLeft),
      stun: r2(f.stun),
      rise: r2(f.rise),
      lagMs: Math.round(f.lagMs),
      punch: f.punch ? { ...f.punch, t: r2(f.punch.t), windup: r2(f.punch.windup) } : null,
      gloves: f.gloves.map((g) => ({ ...g })),
    })),
  };
  viewCache.set(b, { time: b.time, event: b.event, v });
  return v;
}
export { RING };
