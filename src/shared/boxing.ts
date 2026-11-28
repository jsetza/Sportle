/**
 * Sportle Boxing: shared types, the punch table and outcome rules, the bot roster, and the
 * phone-side readers that turn motion into punches, guard and dodges.
 *
 * Everything the phone measures is an intent estimate from its own sensors: the direction of a
 * short burst of movement and how quick it was. Power numbers are the game's own scale, never a
 * measured punch force, speed or hand position.
 */
import { clamp } from "./types.ts";
import type { Gear, Outfit } from "./types.ts";
import { deviceAxes } from "./motion.ts";
import type { Vec3 } from "./motion.ts";

export type PunchType = "jab" | "hook" | "upper";
export const PUNCH_TYPES: PunchType[] = ["jab", "hook", "upper"];
export type Hand = "left" | "right";
export type DodgeDir = "left" | "right" | "duck";
export const DODGE_DIRS: DodgeDir[] = ["left", "right", "duck"];
export const other = (h: Hand): Hand => (h === "left" ? "right" : "left");

// ——————————————————————————— Fight rules ———————————————————————————

/** Seconds per round (default), rounds per fight and the break between rounds. */
export const ROUND_TIME = 60;
export const ROUNDS = 3;
export const BREAK_TIME = 8;
export const INTRO_TIME = 2.6;
/** Knockdowns in one round that end the fight (technical knockout). */
export const TKO_DOWNS = 3;
/** Seconds per count number while a fighter is down. */
export const COUNT_STEP = 1;
/** A phone away this long mid-fight: the host may let a bot box for it. */
export const WAIT_LIMIT = 30;
export const MAX_HP = 100;

/**
 * Per punch type. windup: seconds from the throw to the impact (the visible tell);
 * dmg: base damage on a 100 health bar; stun: seconds the one hit can't punch;
 * cost: stamina used; recover: seconds after the impact before the next punch.
 * Jabs are fast and weak; hooks stronger; uppercuts the strongest and slowest.
 */
export const PUNCH: Record<PunchType, { name: string; windup: number; dmg: number; stun: number; cost: number; recover: number }> = {
  jab: { name: "JAB", windup: 0.11, dmg: 6, stun: 0.22, cost: 0.06, recover: 0.14 },
  hook: { name: "HOOK", windup: 0.2, dmg: 11, stun: 0.34, cost: 0.1, recover: 0.22 },
  upper: { name: "UPPERCUT", windup: 0.28, dmg: 15, stun: 0.44, cost: 0.13, recover: 0.3 },
};
/** A dodge lasts this long, then can't be used again for DODGE_REST. */
export const DODGE_TIME = 0.45;
export const DODGE_REST = 0.3;
/** A guard broken by an uppercut stays down this long. */
export const GUARD_BREAK = 1.0;
/** Blocked punches still do this share of the damage (chip). */
export const CHIP = 0.2;
export const COUNTER_BONUS = 1.5;
/** Stamina regained per second; faster after a short rest from punching. */
export const STAMINA_REGEN = 0.09;
export const STAMINA_REST = 0.24;

export type Outcome = "hit" | "block" | "dodge" | "counter" | "guardbreak" | "around";
export type Defender = {
  guard: boolean;
  dodge: DodgeDir | "";
  /** Mid-punch (winding up or striking): a punch landing now is a counter. */
  punching: boolean;
};
/**
 * What happens when a punch reaches the defender. The rock-paper-scissors of the ring:
 * a duck beats jabs and hooks but runs into uppercuts; a slip (lean) beats jabs and uppercuts
 * but hooks arc around it; a guard blocks jabs, hooks get around it for less, uppercuts break it.
 * A punch landing while the defender is mid-punch is a counter.
 */
export function outcome(type: PunchType, d: Defender): { result: Outcome; mult: number } {
  if (d.dodge === "duck") return type === "upper" ? { result: "hit", mult: 1.3 } : { result: "dodge", mult: 0 };
  if (d.dodge === "left" || d.dodge === "right") return type === "hook" ? { result: "hit", mult: 1.1 } : { result: "dodge", mult: 0 };
  if (d.punching) return { result: "counter", mult: COUNTER_BONUS };
  if (d.guard) {
    if (type === "jab") return { result: "block", mult: CHIP };
    if (type === "hook") return { result: "around", mult: 0.75 };
    return { result: "guardbreak", mult: 1 };
  }
  return { result: "hit", mult: 1 };
}
/** Damage on the 100-point bar: real effort matters (power curve), tired punches are weaker. */
export function damage(type: PunchType, power: number, stamina: number, mult: number) {
  const p = clamp(power, 0, 1);
  return PUNCH[type].dmg * (0.05 + 0.95 * p ** 1.6) * (0.55 + 0.45 * clamp(stamina, 0, 1)) * mult;
}
/** Wind-up time: tired fighters punch slower. */
export const windup = (type: PunchType, stamina: number) => PUNCH[type].windup * (1 + 0.5 * (1 - clamp(stamina, 0, 1)));
/** Stamina used by one punch. */
export const punchCost = (type: PunchType, power: number) => PUNCH[type].cost * (0.6 + 0.4 * clamp(power, 0, 1));
/** Health after getting up from the n-th knockdown of the fight. */
export const getUpHealth = (downs: number) => Math.max(20, 55 - 12 * (downs - 1));
/** Get-up meter gained per second at full effort (shaking/raising the phone), by knockdowns so far. */
export const riseRate = (downs: number) => 0.5 / (1 + 0.45 * (downs - 1));
/** Points decision: clean hits landed, plus 3 per knockdown scored. */
export const score = (f: { stats: FightStats }) => f.stats.landed + 3 * f.stats.knockdowns;

// ——————————————————————————— Bots ———————————————————————————

export type BotId = "zola" | "tortuga" | "mellow" | "parry" | "dina" | "gusto";
export type BotLevel = "rookie" | "club" | "pro";
export const BOT_LEVELS: { id: BotLevel; name: string }[] = [
  { id: "rookie", name: "Rookie" },
  { id: "club", name: "Club" },
  { id: "pro", name: "Pro" },
];
/** How a bot level plays: reaction time to a thrown punch, and scales on skill and speed. */
export const LEVEL: Record<BotLevel, { react: number; skill: number; power: number; pace: number }> = {
  rookie: { react: 0.45, skill: 0.4, power: 0.55, pace: 0.6 },
  club: { react: 0.3, skill: 0.7, power: 0.8, pace: 0.85 },
  pro: { react: 0.19, skill: 0.95, power: 1, pace: 1 },
};
export type BotStyle = {
  /** Punches per second while attacking. */
  rate: number;
  mix: Record<PunchType, number>;
  /** Punch sequences thrown in one go. */
  combos: PunchType[][];
  /** Chance per decision to stand in guard instead of attacking. */
  guard: number;
  /** Chance to read an incoming punch and slip/duck it correctly (before the level's skill). */
  dodge: number;
  /** Chance per decision to slip or duck on its own (bobbing and weaving). */
  weave: number;
  /** Chance to raise the guard against an incoming punch when not dodging. */
  block: number;
  /** Chance to fire straight back after blocking or dodging (counter-punching). */
  counter: number;
  /** Extra wind-up per punch type: the tell you learn to read. */
  tell: Record<PunchType, number>;
  /** Stamina use multiplier (tires faster above 1). */
  tire: number;
  /** Every `breather` seconds the guard drops for `breathe` seconds (0 = never). */
  breather: number;
  breathe: number;
  /** Damage multiplier. */
  power: number;
  /** Heavy hitter: a counter hurts but doesn't stop the punch coming. */
  armor?: boolean;
};
export type BotDef = {
  id: BotId;
  name: string;
  note: string;
  /** The tell, said plainly on the select screen. */
  tell: string;
  /** Body colour (linear-ish RGB 0..1) and glove colour. */
  body: [number, number, number];
  glove: [number, number, number];
  outfit: Outfit;
  eyes: number;
  style: BotStyle;
};
const t0 = { jab: 0, hook: 0, upper: 0 };
/** The ladder, easiest first. All original characters. */
export const BOTS: BotDef[] = [
  {
    id: "zola",
    name: "Zippy Zola",
    note: "Fast jabs, slips a lot",
    tell: "Bounces quicker right before a jab flurry. Hooks catch her mid-slip.",
    body: [0.15, 0.75, 0.72],
    glove: [0.98, 0.85, 0.2],
    outfit: "headband",
    eyes: 2,
    style: { rate: 1.9, mix: { jab: 0.8, hook: 0.15, upper: 0.05 }, combos: [["jab", "jab"], ["jab", "jab", "jab"]], guard: 0.15, weave: 0.3, dodge: 0.55, block: 0.2, counter: 0.15, tell: { jab: 0.1, hook: 0.25, upper: 0.35 }, tire: 0.8, breather: 0, breathe: 0, power: 0.75 },
  },
  {
    id: "tortuga",
    name: "Tank Tortuga",
    note: "Turtles behind a big guard",
    tell: "Lowers the guard to breathe every few seconds. Uppercuts break the shell.",
    body: [0.3, 0.6, 0.25],
    glove: [0.85, 0.2, 0.25],
    outfit: "cap",
    eyes: 0,
    style: { rate: 1.2, mix: { jab: 0.3, hook: 0.6, upper: 0.1 }, combos: [["hook"], ["jab", "hook"]], guard: 0.6, weave: 0, dodge: 0.05, block: 0.9, counter: 0.3, tell: { jab: 0.15, hook: 0.3, upper: 0.4 }, tire: 1, breather: 5, breathe: 1.4, power: 0.9 },
  },
  {
    id: "mellow",
    name: "Marsh Mellow",
    note: "Slow, soft, hits like a truck",
    tell: "Winds right back and glows before the big uppercut. Slip it, then punish.",
    body: [0.95, 0.9, 0.84],
    glove: [0.95, 0.3, 0.62],
    outfit: "chef",
    eyes: 1,
    style: { rate: 0.8, mix: { jab: 0.2, hook: 0.35, upper: 0.45 }, combos: [["upper"], ["hook", "upper"]], guard: 0.25, weave: 0, dodge: 0.05, block: 0.4, counter: 0.1, tell: { jab: 0.2, hook: 0.45, upper: 0.7 }, tire: 1.3, breather: 0, breathe: 0, power: 1.45, armor: true },
  },
  {
    id: "parry",
    name: "Professor Parry",
    note: "Waits for you, then counters",
    tell: "Taps his gloves together when he's set to counter. Throw nothing, or uppercut his guard.",
    body: [0.55, 0.36, 0.9],
    glove: [0.95, 0.95, 0.93],
    outfit: "astro",
    eyes: 1,
    style: { rate: 1.0, mix: { jab: 0.4, hook: 0.4, upper: 0.2 }, combos: [["jab", "hook"], ["hook"]], guard: 0.7, weave: 0, dodge: 0.45, block: 0.6, counter: 0.85, tell: { jab: 0.1, hook: 0.22, upper: 0.35 }, tire: 0.9, breather: 0, breathe: 0, power: 1.05 },
  },
  {
    id: "dina",
    name: "Disco Dina",
    note: "Boxes to the beat",
    tell: "Two dance steps, then jab-jab-hook every time. Duck the hook.",
    body: [0.98, 0.52, 0.16],
    glove: [0.55, 0.36, 0.9],
    outfit: "cowboy",
    eyes: 2,
    style: { rate: 1.8, mix: { jab: 0.5, hook: 0.4, upper: 0.1 }, combos: [["jab", "jab", "hook"]], guard: 0.3, weave: 0.1, dodge: 0.35, block: 0.4, counter: 0.3, tell: { jab: 0.08, hook: 0.28, upper: 0.32 }, tire: 1, breather: 0, breathe: 0, power: 1.05 },
  },
  {
    id: "gusto",
    name: "Grandpa Gusto",
    note: "Old champ, every trick, short on breath",
    tell: "Mixes everything. Huffs and puffs after each flurry: that's your moment.",
    body: [0.62, 0.62, 0.68],
    glove: [0.93, 0.74, 0.32],
    outfit: "classic",
    eyes: 0,
    style: { rate: 2.0, mix: { jab: 0.4, hook: 0.35, upper: 0.25 }, combos: [["jab", "hook"], ["jab", "upper"], ["hook", "hook"], ["jab", "jab", "upper"]], guard: 0.45, weave: 0.12, dodge: 0.5, block: 0.6, counter: 0.5, tell: { jab: 0.06, hook: 0.16, upper: 0.24 }, tire: 1.6, breather: 0, breathe: 0, power: 1.15 },
  },
];
export const botDef = (id: BotId) => BOTS.find((b) => b.id === id) ?? BOTS[0];
/** Trainer for the mitt drill (not a fighter). */
export const COACH = { name: "Coach Kip" };

// ——————————————————————————— Rings ———————————————————————————

export type RingId = "neon" | "arena" | "rooftop";
export const RINGS: { id: RingId; name: string; note: string }[] = [
  { id: "neon", name: "Neon Club", note: "Night club ring under purple lights" },
  { id: "arena", name: "Championship Arena", note: "Big TV night, full stands" },
  { id: "rooftop", name: "Rooftop", note: "Open-air ring above the city" },
];
/** Ring size: half the side of the canvas (metres) and where the fighters start. */
export const RING = { half: 3, start: 0.62 };

// ——————————————————————————— State ———————————————————————————

export type BoxMode = "solo" | "versus" | "training";
export type Drill = "bag" | "mitts";
export type BoxPhase = "lobby" | "intro" | "fight" | "down" | "break" | "over" | "training";
export type FightStats = {
  thrown: number;
  landed: number;
  blocked: number;
  /** Punches of the opponent this fighter dodged. */
  dodged: number;
  counters: number;
  knockdowns: number;
  /** Sum and best of landed power (game units 0..1, not a measurement). */
  power: number;
  best: number;
  byType: Record<PunchType, number>;
};
export const emptyStats = (): FightStats => ({ thrown: 0, landed: 0, blocked: 0, dodged: 0, counters: 0, knockdowns: 0, power: 0, best: 0, byType: { ...t0 } });
export type Glove = {
  /** Public id (the phone's player id). */
  id: string;
  hand: Hand;
  connected: boolean;
  ready: boolean;
};
export type Punch = {
  id: number;
  type: PunchType;
  hand: Hand;
  power: number;
  /** Seconds since thrown; impact at `windup`. */
  t: number;
  windup: number;
  /** Bot tell: the long, visible wind-up. */
  tell: boolean;
  landed: Outcome | "";
};
export type Fighter = {
  id: string;
  name: string;
  bot: BotId | "";
  outfit: Outfit;
  gear: Gear;
  display: string;
  corner: 0 | 1;
  /** Training station (x offset) when training side by side. */
  x: number;
  hp: number;
  stamina: number;
  /** Knockdowns this round and in the fight. */
  downs: number;
  downsTotal: number;
  guard: boolean;
  guardBroken: number;
  dodge: DodgeDir | "";
  dodgeLeft: number;
  punch: Punch | null;
  stun: number;
  /** Get-up meter 0..1 while down. */
  rise: number;
  /** Phones (one or two gloves) for a human fighter. */
  gloves: Glove[];
  ready: boolean;
  connected: boolean;
  /** Since when the phone is away mid-fight (ms, 0 = here). */
  away: number;
  botFor: boolean;
  stats: FightStats;
  /** Recent phone → server punch delay (ms, rolling average), for the latency readout. */
  lagMs: number;
  /** Bot tells for the scene: "bounce", "glow", "tap", "breathe", "dance". */
  tellAnim: string;
  /** Training drill state. */
  drill: DrillState | null;
  /** Ladder: bots this fighter beat in this room. */
  beat: BotId[];
  /** The last punch this fighter threw (type, power), for the HUD and phone. */
  last: { type: PunchType; power: number; at: number } | null;
};
export type DrillState = {
  /** Mitts: the call (a punch, "guard" or a dodge) and when it was made (room time). */
  call: PunchType | "guard" | DodgeDir | "";
  callAt: number;
  score: number;
  streak: number;
  misses: number;
  /** Bag: punches by type. */
  count: Record<PunchType, number>;
  /** Room time the bag was last hit (for the swing animation) and which way. */
  bagAt: number;
  bagDir: number;
  bagPower: number;
};
export type HitEvent = {
  at: number;
  by: string;
  to: string;
  type: PunchType;
  hand: Hand;
  result: Outcome | "miss";
  dmg: number;
  power: number;
};
export type Callout = { at: number; who: string; text: string; kind: string };
export type Box = {
  game: "boxing";
  mode: BoxMode;
  ring: RingId;
  level: BotLevel;
  /** Solo: the opponent picked from the ladder. */
  opponent: BotId;
  drill: Drill;
  phase: BoxPhase;
  round: number;
  /** Seconds left in the round. */
  clock: number;
  roundTime: number;
  /** Starting health (100; lower only for quick matches). */
  startHp: number;
  time: number;
  phaseAt: number;
  fighters: Fighter[];
  /** Knockdown count: who is down and the number shown (0 = not counting). */
  count: { who: string; n: number };
  hits: HitEvent[];
  callouts: Callout[];
  result: { winner: string; how: "KO" | "TKO" | "DECISION" | "DRAW" | ""; scores: Record<string, number> };
  paused: boolean;
  /** Why it is paused: the host, or a fighter's phone is away (resumes by itself). */
  pauseReason: "" | "host" | "away";
  message: string;
  event: number;
  seed: number;
};

// ——————————————————————————— Phone readers ———————————————————————————

/** Punch power scale: nothing below PUNCH_FLOOR (a game speed index), full power at FLOOR + SPAN. */
export const PUNCH_FLOOR = 1.0;
export const PUNCH_SPAN = 3.0;
/** A burst of movement starts above this (m/s², gravity removed) and is over below PUNCH_QUIET. */
export const PUNCH_START = 6;
export const PUNCH_QUIET = 2.5;
/** Weakest movement read as a punch (speed index): below it, nothing is thrown. */
export const PUNCH_MIN = PUNCH_FLOOR + 0.2;
/** Shortest gap between two punches read from one phone (s). */
export const PUNCH_REST = 0.24;
/** Longest burst read as one punch (s). */
export const PUNCH_MAX = 0.35;

/** A punch as read on the phone (the phone's hand; SWITCH may give it to the other hand). */
export type ReadPunch = { type: PunchType; power: number; speed: number; features: number[] };
/** Learned on this phone in setup: grip direction, style centroids and a small power gain. */
export type PunchProfile = {
  /** +1: screen faces the thumb side (inward) for a right hand as forward = n × up; -1 flips it. */
  face: 1 | -1;
  centroids: Partial<Record<PunchType, number[]>>;
  gain: number;
};
export const defaultProfile = (hand: Hand): PunchProfile => ({ face: hand === "right" ? 1 : -1, centroids: {}, gain: 1 });

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
type Axes = { X: Vec3; Y: Vec3; Z: Vec3 };
export const axesOf = (alpha: number, beta: number, gamma: number): Axes => deviceAxes(alpha, beta, gamma);
/** Device-frame vector → world (x east, y north, z up). */
export const toWorld = (ax: Axes, v: Vec3): Vec3 => [
  ax.X[0] * v[0] + ax.Y[0] * v[1] + ax.Z[0] * v[2],
  ax.X[1] * v[0] + ax.Y[1] * v[1] + ax.Z[1] * v[2],
  ax.X[2] * v[0] + ax.Y[2] * v[1] + ax.Z[2] * v[2],
];
/**
 * Forward (toward the TV, horizontal) from the guard pose: the phone upright, screen facing
 * sideways. Forward is perpendicular to the screen's normal; `face` says which way.
 */
export function forwardFrom(ax: Axes, face: 1 | -1): [number, number] | null {
  const n = [ax.Z[0], ax.Z[1]];
  const l = Math.hypot(n[0], n[1]);
  if (l < 0.5) return null; // screen facing up or down: not a sideways grip
  return [(face * n[1]) / l, (-face * n[0]) / l];
}
/**
 * Reads punches from motion. Feed it every motion event: linear acceleration (device frame,
 * m/s², gravity removed), rotation rate (device frame, deg/s, as DeviceMotionEvent gives it)
 * and the device axes at that moment. A punch is one burst of movement: its velocity is
 * integrated with the real time step (so 60 Hz and 120 Hz phones read the same), the peak gives
 * the power and the direction at the peak gives the type, from this player's forward direction.
 */
export class PunchReader {
  fwd: [number, number] = [0, 1];
  profile: PunchProfile;
  hand: Hand;
  private burst: { v: Vec3; peak: number; dir: Vec3; yaw: number; pitch: number; dur: number; quiet: number } | null = null;
  private lastT = -1;
  private lastEnd = -1e9;
  /** 0..1 smoothed movement energy (for the get-up meter and the setup gauge). */
  energy = 0;
  constructor(hand: Hand = "right", profile?: PunchProfile) {
    this.hand = hand;
    this.profile = profile ?? defaultProfile(hand);
  }
  /** Set forward from the current pose (call while the guard is up). False if not sideways. */
  setForward(ax: Axes) {
    const f = forwardFrom(ax, this.profile.face);
    if (!f) return false;
    this.fwd = f;
    return true;
  }
  /** Player frame of a world vector: [forward, right, up]. */
  frame(w: Vec3): Vec3 {
    const [fx, fy] = this.fwd;
    // right = forward × up
    return [w[0] * fx + w[1] * fy, w[0] * fy - w[1] * fx, w[2]];
  }
  /** One motion reading at time t (ms). Returns a punch when one just finished. */
  feed(acc: Vec3, rot: { alpha: number; beta: number; gamma: number }, ax: Axes, t: number): ReadPunch | null {
    const dt = this.lastT < 0 ? 1 / 60 : clamp(t - this.lastT, 1, 60) / 1000;
    this.lastT = t;
    const a = this.frame(toWorld(ax, acc));
    const mag = Math.hypot(a[0], a[1], a[2]);
    this.energy += (1 - Math.exp(-dt / 0.15)) * (clamp(mag / 14, 0, 1) - this.energy);
    // World rotation rate (deg/s): about the vertical (yaw, hooks) and the sideways axis (uppercuts).
    const w = toWorld(ax, [rot.beta, rot.gamma, rot.alpha]);
    const wf = this.frame(w);
    if (!this.burst) {
      if (mag < PUNCH_START || t - this.lastEnd < PUNCH_REST * 1000) return null;
      this.burst = { v: [0, 0, 0], peak: 0, dir: [0, 0, 0], yaw: 0, pitch: 0, dur: 0, quiet: 0 };
    }
    const b = this.burst;
    for (let i = 0; i < 3; i++) b.v[i] += a[i] * dt;
    const speed = Math.hypot(b.v[0], b.v[1], b.v[2]);
    if (speed > b.peak) {
      b.peak = speed;
      b.dir = [b.v[0], b.v[1], b.v[2]];
    }
    b.yaw = Math.max(b.yaw, Math.abs(wf[2]));
    b.pitch = Math.max(b.pitch, Math.abs(wf[1]));
    b.dur += dt;
    b.quiet = mag < PUNCH_QUIET ? b.quiet + dt : 0;
    const settled = b.dur > 0.05 && speed < b.peak * 0.35;
    if (!(settled || b.quiet >= 0.04 || b.dur >= PUNCH_MAX)) return null;
    this.burst = null;
    this.lastEnd = t;
    return this.classify(b.peak, b.dir, b.yaw, b.pitch);
  }
  /** Type and power from a finished burst; null for pull-backs and anything under the floor. */
  classify(peak: number, dir: Vec3, yaw: number, pitch: number): ReadPunch | null {
    if (peak < PUNCH_MIN) return null;
    const n = [dir[0] / peak, dir[1] / peak, dir[2] / peak];
    // Pulling the fist back (retracting) or dropping it is not a punch.
    if (n[0] < -0.35 || n[2] < -0.6) return null;
    const features = [n[0], Math.abs(n[1]), n[2], clamp(yaw / 600, 0, 1.5), clamp(pitch / 600, 0, 1.5)];
    const type = this.typeOf(features);
    const power = clamp(((peak - PUNCH_FLOOR) / PUNCH_SPAN) * this.profile.gain, 0, 1);
    return { type, power, speed: peak, features };
  }
  typeOf(q: number[]): PunchType {
    const c = this.profile.centroids;
    const learned = PUNCH_TYPES.filter((k) => c[k]);
    // Rule of thumb: forward = jab, sideways or a fast turn = hook, upward = uppercut.
    const rule: Record<PunchType, number> = {
      jab: q[0] - 0.25 * q[3],
      hook: q[1] * 0.85 + q[3] * 0.55,
      upper: q[2] * 1.05 + q[4] * 0.2,
    };
    if (learned.length === 3) {
      // This player's own style from setup: nearest learned punch, nudged by the rule.
      let best: PunchType = "jab",
        bd = Infinity;
      for (const k of PUNCH_TYPES) {
        const m = c[k]!;
        let d = 0;
        for (let i = 0; i < m.length; i++) d += (q[i] - m[i]) ** 2;
        d = Math.sqrt(d) - 0.35 * rule[k];
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      return best;
    }
    return (Object.keys(rule) as PunchType[]).reduce((a, b) => (rule[b] > rule[a] ? b : a));
  }
}
/**
 * Learn this player's style from the setup punches (two of each, already read by a default
 * PunchReader): centroids per type, the grip direction from the jabs, and a gentle power gain
 * (0.9–1.2) so a smaller puncher still reaches full power with full effort.
 */
export function learnPunches(samples: { type: PunchType; read: ReadPunch }[], prev: PunchProfile): { ok: true; profile: PunchProfile } | { ok: false; reason: string } {
  const centroids: Partial<Record<PunchType, number[]>> = {};
  for (const k of PUNCH_TYPES) {
    const s = samples.filter((x) => x.type === k);
    if (s.length < 1) return { ok: false, reason: "Throw two of each punch" };
    const m = s[0].read.features.map((_, i) => s.reduce((a, x) => a + x.read.features[i], 0) / s.length);
    centroids[k] = m;
  }
  const mean = samples.reduce((a, x) => a + x.read.speed, 0) / samples.length;
  const gain = clamp((PUNCH_FLOOR + 0.7 * PUNCH_SPAN) / Math.max(0.1, mean), 0.9, 1.2);
  return { ok: true, profile: { face: prev.face, centroids, gain } };
}
/** Guard and dodge from the phone's pose (top edge direction) and how still it is. */
export type PoseRead = { guard: boolean; lean: DodgeDir | "" };
export class PoseReader {
  /** Tilt of the top edge from vertical in the guard pose saved in setup (degrees). */
  guardTilt = 8;
  private stillSince = -1;
  private armed = true;
  guard = false;
  /** Current zone, for the phone's gauge. */
  zone: "guard" | "stance" | "left" | "right" | "duck" = "stance";
  /**
   * One reading. `y` is the phone's top edge in the player frame [forward, right, up];
   * `move` the movement (m/s²) and `turn` the rotation rate (deg/s) right now.
   * Returns a dodge direction on the reading that starts one.
   */
  feed(y: Vec3, move: number, turn: number, t: number): DodgeDir | null {
    const tilt = (Math.acos(clamp(y[2], -1, 1)) * 180) / Math.PI;
    const side = y[1],
      fwd = y[0];
    const still = move < 2.5 && turn < 90;
    // Guard: upright like the setup pose and nearly still for 0.2 s.
    if (this.guard) {
      if (tilt > this.guardTilt + 28 || move > 7) this.guard = false;
    } else if (tilt < this.guardTilt + 18 && still) {
      if (this.stillSince < 0) this.stillSince = t;
      if (t - this.stillSince >= 200) this.guard = true;
    } else this.stillSince = -1;
    if (!still && !this.guard) this.stillSince = -1;
    // Dodges: tipping the top edge sideways (slip) or forward and down (duck). Each tip is one
    // dodge; it re-arms when the phone comes back up.
    let zone: PoseReader["zone"] = this.guard ? "guard" : "stance";
    if (Math.abs(side) > 0.5 && Math.abs(side) > Math.abs(fwd)) zone = side > 0 ? "right" : "left";
    else if (y[2] < 0.3 && fwd > 0.2) zone = "duck";
    this.zone = zone;
    if (zone === "stance" || zone === "guard") {
      if (Math.abs(side) < 0.32 && y[2] > 0.45) this.armed = true;
      return null;
    }
    if (!this.armed || move > 8) return null;
    this.armed = false;
    this.guard = false;
    return zone;
  }
}
/** Ordinals for the round. */
export const roundName = (n: number) => "ROUND " + n;
