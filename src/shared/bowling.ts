/**
 * Sportle Bowling: shared types, lane geometry, ten-pin scoring, split detection and the
 * phone's release reader. Physics, pinfall, scoring and turns are decided on the server
 * (src/server/bowling.ts); this file is pure and shared with the browser.
 */
import { clamp } from "./types.ts";
import type { Gear, Outfit } from "./types.ts";
import { SwingCapture } from "./motion.ts";
import type { SwingSample } from "./motion.ts";

/** Lanes to bowl on. Original Sportle art only (no real alley or lane-maker branding). */
export type LaneId = "neon" | "championship" | "rooftop" | "beach";
export const LANES: { id: LaneId; name: string; note: string }[] = [
  { id: "neon", name: "Neon alley", note: "Retro bowling alley at night" },
  { id: "championship", name: "Championship", note: "TV arena, packed stands" },
  { id: "rooftop", name: "Rooftop", note: "City lights, open air" },
  { id: "beach", name: "Beach", note: "Palms, surf and a volcano" },
];
export type BotLevel = "" | "easy" | "medium" | "hard";
export const BOT_NAMES: Record<Exclude<BotLevel, "">, string> = {
  easy: "Rookie",
  medium: "Club",
  hard: "Pro",
};
export type BowlMode = "practice" | "game";
/** Up to six phones on one screen (plus an optional bot). */
export const MAX_BOWLERS = 6;

/**
 * Lane geometry in metres. x runs across the lane (+ = the bowler's right), d runs down the
 * lane from the foul line. Regulation-like proportions: 60 ft foul line to head pin, 41.5 in
 * wide, 9.25 in gutters, pins 12 in apart, a pin deck ending in the pit.
 */
export const LANE = {
  length: 18.288,
  half: 0.527,
  gutter: 0.235,
  /** Side walls (kickbacks) on the pin deck, outside the gutters. */
  wall: 0.762,
  approach: 4.6,
  /** Head pin to the pit edge. */
  deck: 0.868,
  ballR: 0.1085,
  pinR: 0.0605,
  pinH: 0.381,
  spacing: 0.3048,
  /** Oil covers the front of the lane; the ball hooks once it reaches dry boards. */
  oil: 12.2,
  /** One board is 1/39 of the lane width. */
  board: 1.054 / 39,
};
/** Pin spots, pins 1–10 (index 0–9): 1 = head pin, 7 = left corner, 10 = right corner. */
export const PIN_SPOTS: { x: number; d: number }[] = (() => {
  const out: { x: number; d: number }[] = [];
  const row = LANE.spacing * Math.sin(Math.PI / 3);
  for (let k = 0; k < 4; k++)
    for (let j = 0; j <= k; j++)
      out.push({ x: (j - k / 2) * LANE.spacing, d: LANE.length + k * row });
  return out;
})();

export type Pin = {
  x: number;
  d: number;
  vx: number;
  vd: number;
  /** 0 = standing … π/2 = lying on the deck. */
  tilt: number;
  tiltRate: number;
  /** Direction the pin falls toward (radians: 0 = down the lane, + = toward +x). */
  dir: number;
  /** Knocked down (counts as pinfall). */
  down: boolean;
  /** Swept away / in the pit / in a gutter: no longer on the deck. */
  gone: boolean;
  /** Small standing wobble for the picture (radians). */
  wob: number;
};
export type BallPhase = "skid" | "hook" | "roll" | "gutter" | "pit";
export type Ball = {
  x: number;
  d: number;
  /** Height of the ball's centre above the lane surface (drops in a gutter). */
  y: number;
  vx: number;
  vd: number;
  phase: BallPhase;
  /** -1..1 hook at release (+ = breaks toward +x). */
  hook: number;
  /** Lateral speed the hook can still add (m/s). */
  hookLeft: number;
  /** Rolling angle for the picture (radians). */
  roll: number;
};
export type Callout = "" | "STRIKE" | "SPARE" | "GUTTER" | "SPLIT";
export type Shot = {
  by: string;
  name: string;
  /** Game speed of the ball at release; not a real-world measurement. */
  kmh: number;
  mph: number;
  /** Hook in boards (+ = toward +x), from where a straight ball would have gone. */
  boards: number;
  pins: number;
  callout: Callout;
  /** Extra word: "DOUBLE", "TURKEY", "7-10", "WASHOUT"… */
  extra: string;
  frame: number;
  ball: number;
  /** Stepped over the foul line: warning only (casual). */
  foul: boolean;
  /** Event counter of this shot (for one-off sounds and callouts). */
  at: number;
  /** Release point and slope of the straight line (for the hook readout). */
  x0: number;
  slope: number;
  /** Pins standing when the ball was released. */
  before: number;
  /** The ball went into a gutter. */
  gutter: boolean;
};
export type Bowler = {
  id: string;
  name: string;
  hand: "left" | "right";
  outfit: Outfit;
  gear: Gear;
  bot: BotLevel;
  connected: boolean;
  lastSeen: number;
  ready: boolean;
  sensors: boolean;
  calibrated: boolean;
  /** Live curve indicator from the phone's tilt (-1..1). */
  curve: number;
  /** Starting board chosen with the thumb pad (-1 left … 1 right). */
  board: number;
  /** Pinfall per ball, ten-pin order. Missed frames of a late joiner are zeros. */
  rolls: number[];
  /** Practice: the current frame's balls. */
  practice: number[];
  /** First frame this bowler bowls (late joiners). */
  startFrame: number;
  handicap: number;
  /** A bot bowls this frame for a missing phone (host choice). */
  botFor: boolean;
  display: string;
  strikes: number;
  bowls: number;
};
export type BowlPhase = "lobby" | "aim" | "rolling" | "result" | "sweep" | "over";
export type Bowl = {
  game: "bowling";
  mode: BowlMode;
  lane: LaneId;
  bot: BotLevel;
  /** Single player rooms take one phone (plus an optional bot); multiplayer up to six. */
  cap: number;
  phase: BowlPhase;
  /** Sim time when the phase began. */
  phaseAt: number;
  time: number;
  players: Bowler[];
  /** Index of the bowler who is up. */
  turn: number;
  frame: number;
  /** Ball number within the frame (0, 1, 2). */
  ballNo: number;
  pins: Pin[];
  ball: Ball | null;
  shot: Shot | null;
  message: string;
  event: number;
  paused: boolean;
  /** Epoch ms since the bowler who is up has been missing (0 = not waiting). */
  waitSince: number;
  /** Late joiners start with a handicap instead of empty frames. */
  handicap: boolean;
  winners: string[];
  seed: number;
  /** Total balls thrown in this game (for one-off client effects). */
  bowls: number;
  /**
   * Predicted path for the bowler who is up (flat x,d pairs, metres): where a normal-speed
   * ball from their spot with their current curve would roll. Frozen at release.
   */
  aim: number[];
  /** Where the ball actually rolled this ball (flat x,d pairs), kept until the sweep. */
  trail: number[];
};
/** Seconds the TV shows the result before the sweep, and how long the sweep takes. */
export const RESULT_TIME = 2.2;
export const SWEEP_TIME = 1.5;
/** Seconds to wait for a missing bowler before the host may skip or hand the frame to a bot. */
export const WAIT_LIMIT = 30;

// ——— Scoring ———

export type FramePos = {
  /** Frame (0–9) the next ball belongs to; 10 when the game is done. */
  frame: number;
  ball: number;
  /** Pins standing for the next ball (10 = a fresh rack). */
  standing: number;
  /** The next ball faces a full, freshly set rack. */
  fresh: boolean;
  done: boolean;
};
/** Where a bowler is in their game, from their pinfall list. */
export function framePos(rolls: number[]): FramePos {
  const at = (frame: number, ball: number, standing: number, fresh: boolean): FramePos => ({
    frame,
    ball,
    standing,
    fresh,
    done: frame >= 10,
  });
  let i = 0;
  for (let f = 0; f < 9; f++) {
    if (i >= rolls.length) return at(f, 0, 10, true);
    if (rolls[i] === 10) {
      i++;
      continue;
    }
    if (i + 1 >= rolls.length) return at(f, 1, 10 - rolls[i], false);
    i += 2;
  }
  const r = rolls.slice(i);
  if (r.length === 0) return at(9, 0, 10, true);
  if (r.length === 1) return r[0] === 10 ? at(9, 1, 10, true) : at(9, 1, 10 - r[0], false);
  if (r[0] !== 10 && r[0] + r[1] < 10) return at(10, 0, 0, false);
  if (r.length === 2) {
    if (r[0] !== 10) return at(9, 2, 10, true); // spare
    return r[1] === 10 ? at(9, 2, 10, true) : at(9, 2, 10 - r[1], false);
  }
  return at(10, 0, 0, false);
}
export type FrameScore = { marks: string[]; total: number | null };
/** Classic scoresheet: marks per frame (X, /, -, digits) and running totals where known. */
export function scoreSheet(rolls: number[]): { frames: FrameScore[]; total: number } {
  const frames: FrameScore[] = [];
  const mark = (n: number) => (n === 0 ? "-" : String(n));
  let i = 0,
    total = 0,
    known = true;
  for (let f = 0; f < 10; f++) {
    const a = rolls[i],
      b = rolls[i + 1],
      c = rolls[i + 2];
    if (a === undefined) {
      frames.push({ marks: [], total: null });
      known = false;
      continue;
    }
    if (f < 9) {
      if (a === 10) {
        const ok = b !== undefined && c !== undefined;
        if (ok && known) total += 10 + b + c;
        frames.push({ marks: ["", "X"], total: ok && known ? total : null });
        if (!ok) known = false;
        i += 1;
        continue;
      }
      if (b === undefined) {
        frames.push({ marks: [mark(a)], total: null });
        known = false;
        i += 1;
        continue;
      }
      if (a + b === 10) {
        const ok = c !== undefined;
        if (ok && known) total += 10 + c;
        frames.push({ marks: [mark(a), "/"], total: ok && known ? total : null });
        if (!ok) known = false;
      } else {
        if (known) total += a + b;
        frames.push({ marks: [mark(a), mark(b)], total: known ? total : null });
      }
      i += 2;
      continue;
    }
    // Tenth frame: up to three balls, fresh racks after strikes and spares.
    const r = rolls.slice(i, i + 3);
    const marks: string[] = [];
    let fresh = true,
      standing = 10;
    for (const n of r) {
      if (fresh && n === 10) {
        marks.push("X");
        standing = 10;
        fresh = true;
      } else if (!fresh && n === standing) {
        marks.push("/");
        standing = 10;
        fresh = true;
      } else {
        marks.push(mark(n));
        standing -= n;
        fresh = false;
      }
    }
    const done = framePos(rolls).done;
    if (done && known) total += r.reduce((s, n) => s + n, 0);
    frames.push({ marks, total: done && known ? total : null });
  }
  // Running total so far (only fully known frames count).
  return { frames, total };
}
/** Strikes in a row at the end of a pinfall list (a strike = 10 on a fresh rack). */
export function strikeRun(rolls: number[]) {
  let n = 0;
  for (let i = 0; i < rolls.length; i++) {
    const fresh = framePos(rolls.slice(0, i)).fresh;
    n = fresh && rolls[i] === 10 ? n + 1 : 0;
  }
  return n;
}

// ——— Splits ———

const ADJ: boolean[][] = PIN_SPOTS.map((a) =>
  PIN_SPOTS.map(
    (b) => a !== b && Math.hypot(a.x - b.x, a.d - b.d) < LANE.spacing * 1.05,
  ),
);
/** Pins standing after the first ball (indexes 0–9). A split: head pin down and the
 * standing pins form two or more groups with fallen pins between them. */
export function isSplit(standing: number[]): boolean {
  if (standing.length < 2 || standing.includes(0)) return false;
  const seen = new Set([standing[0]]),
    todo = [standing[0]];
  while (todo.length) {
    const p = todo.pop()!;
    for (const q of standing)
      if (!seen.has(q) && ADJ[p][q]) {
        seen.add(q);
        todo.push(q);
      }
  }
  return seen.size < standing.length;
}
/** Pin numbers for a leave, e.g. "7-10". */
export const leaveName = (standing: number[]) =>
  standing
    .map((i) => i + 1)
    .sort((a, b) => a - b)
    .join("-");

// ——— Curve indicator ———

/** Tilt (degrees, + = top edge leaning right) → curve -1..1, with a dead zone for "straight". */
export function curveFrom(tiltDeg: number) {
  const t = Math.abs(tiltDeg) < 6 ? 0 : tiltDeg - Math.sign(tiltDeg) * 6;
  return clamp(t / 34, -1, 1);
}
export const curveLabel = (c: number) =>
  Math.abs(c) < 0.12 ? "STRAIGHT" : Math.abs(c) < 0.55 ? "SLIGHT HOOK" : "BIG HOOK";

// ——— Phone: reading a bowl ———

/** Swing-path left/right below this reads as a straight bowl (normal swings wobble a bit). */
export const LINE_DEAD = 0.25;
/** Swing path's left/right part → line -1..1, with a dead zone so a straight bowl is straight. */
export function lineFrom(side: number) {
  const a = Math.abs(side);
  return a < LINE_DEAD ? 0 : clamp((a - LINE_DEAD) / 0.5, 0, 1) * Math.sign(side);
}
/** Hold-to-bowl: a let-go with less arm speed than this (rad/s) doesn't bowl. */
export const HELD_MIN = 2;
/** The arm keeps swinging after the thumb lets go: read this long after the let-go too (ms),
 * so letting go a touch early still counts the swing's full speed. */
export const HELD_AFTER = 110;
export type HeldSample = { t: number; rad: number; up: number; side: number };
/**
 * Hold-to-bowl: the player holds the button through the backswing and lets go on the way
 * forward. The let-go is the release moment, so nothing has to guess it from the motion.
 * Speed = the fastest forward motion from ~0.45 s before the let-go to HELD_AFTER after it, line = median left/right over the
 * fast part of it, hook = the tilt locked when the button was pressed (the phone is still at
 * that moment, so the reading is steady). Intent estimates, not measured positions.
 */
export function readHeld(
  samples: HeldSample[],
  releaseT: number,
  profile: BowlProfile,
  tilt: number,
): Release | null {
  const win = samples.filter((q) => q.t > releaseT - 450 && q.t <= releaseT + HELD_AFTER);
  if (!win.length) return null;
  let fwd = win.filter((q) => q.up * profile.upSign > 0.2);
  if (!fwd.some((q) => q.rad >= HELD_MIN)) fwd = win;
  const rad = Math.max(...fwd.map((q) => q.rad));
  if (rad < HELD_MIN) return null;
  const sides = fwd
    .filter((q) => q.rad >= rad * 0.6)
    .map((q) => q.side)
    .sort((a, b) => a - b);
  const side = sides[sides.length >> 1] ?? 0;
  return {
    speed: bowlSpeed(rad, profile.typical),
    line: lineFrom(side * profile.sideSign),
    hook: curveFrom(tilt),
    tilt,
    rad,
  };
}

/** Forward-swing speed (rad/s) below which nothing counts as a bowl. */
export const BOWL_FLOOR = 2.5;
/** Forward swing speed needed to release (gentle waves and walking stay below it). */
export const BOWL_TRIGGER = 4.5;
/** A backswing (the other way, at least this fast) must come first. */
export const BOWL_BACK = 2.2;
/** How long after a backswing the forward swing may come (ms). */
export const BOWL_WINDOW = 1800;
export type BowlProfile = {
  /** +1/-1: which way of the swing path reads as the forward (release) swing. */
  upSign: number;
  /** +1/-1: corrects the left/right sign if this phone reads it reversed. */
  sideSign: number;
  /** Typical forward-swing speed (rad/s) from the practice bowls. */
  typical: number;
};
export const DEFAULT_BOWL_PROFILE: BowlProfile = { upSign: 1, sideSign: 1, typical: 8 };
export type Release = {
  /** 0..1 effort → game ball speed. */
  speed: number;
  /** -1..1 line across the lane (+ = toward the right). */
  line: number;
  /** -1..1 hook from the tilt at release plus wrist twist (+ = breaks right). */
  hook: number;
  /** Tilt at release (degrees) and peak forward-swing speed (rad/s), for the readout. */
  tilt: number;
  rad: number;
};
/** Effort (0..1) for a peak swing speed: the player's typical bowl ≈ 0.6. */
export function bowlSpeed(rad: number, typical: number) {
  const span = Math.max(4, (clamp(typical, 5, 20) - BOWL_FLOOR) / 0.6);
  return clamp((rad - BOWL_FLOOR) / span, 0, 1);
}
export type BowlSample = SwingSample & {
  /** Rotation rate about the phone's long axis (deg/s), for wrist twist. */
  twist: number;
};
/**
 * Reads an underhand bowl from motion samples: a backswing, then a forward swing read at its
 * peak with SwingCapture (not a fixed delay), so the same bowl reads the same at 60 or 120 Hz.
 * Speed from the peak forward-swing speed, line from the swing path's left/right part, hook
 * from the phone's tilt at release plus wrist twist. Intent estimates, not measured positions.
 */
export class BowlReader {
  profile: BowlProfile = { ...DEFAULT_BOWL_PROFILE };
  /** Tilt (deg) the phone showed when aimed: "straight" for this grip. */
  zero = 0;
  backAt = -1e9;
  lastRelease = -1e9;
  private capture = new SwingCapture();
  private twist = 0;
  private tilts: number[] = [];
  /** Feed one sample; returns a release once a forward swing has peaked. */
  feed(s: BowlSample): Release | null {
    const fwd = s.path.up * this.profile.upSign;
    if (!this.capture.active) {
      if (s.rad > BOWL_BACK && fwd < -0.35) this.backAt = s.t;
      if (
        s.rad > BOWL_TRIGGER &&
        fwd > 0.35 &&
        s.t - this.backAt < BOWL_WINDOW &&
        s.t - this.lastRelease > 1500
      ) {
        this.capture.start(s.t, 40, 160);
        this.twist = 0;
        this.tilts = [];
      } else return null;
    }
    if (fwd > 0) {
      this.capture.add(s);
      if (Math.abs(s.twist) > Math.abs(this.twist)) this.twist = s.twist;
      this.tilts.push(s.roll);
    }
    if (!this.capture.ready(s.t)) return null;
    const shot = this.capture.finish();
    this.lastRelease = s.t;
    this.backAt = -1e9;
    const tilts = this.tilts.sort((a, b) => a - b);
    const tilt = (tilts[tilts.length >> 1] ?? shot.roll) - this.zero;
    return {
      speed: bowlSpeed(shot.rad, this.profile.typical),
      line: lineFrom(shot.path.side * this.profile.sideSign),
      hook: clamp(curveFrom(tilt) + clamp(this.twist / 1800, -0.12, 0.12), -1, 1),
      tilt,
      rad: shot.rad,
    };
  }
  cancel() {
    this.capture.cancel();
  }
}
/**
 * Learn from two practice bowls (raw samples of each, backswing included): which swing-path
 * direction is the forward swing (the faster, later one), the typical forward speed, and,
 * from the second bowl aimed toward the left, whether this phone reads left/right reversed.
 */
export function learnBowls(
  bowls: { up: number; side: number; rad: number }[][],
): { ok: true; profile: BowlProfile } | { ok: false; reason: string } {
  if (bowls.length < 2) return { ok: false, reason: "Two practice bowls, please." };
  const peaks = bowls.map((b) => {
    // Forward swing = the last fast stretch of motion; its direction is the release direction.
    const fast = b.filter((q) => q.rad > BOWL_BACK);
    if (!fast.length) return null;
    const lastSign = Math.sign(fast[fast.length - 1].up) || 1;
    const fwd = fast.filter((q) => Math.sign(q.up) === lastSign);
    const peak = fwd.reduce((a, q) => (q.rad > a.rad ? q : a));
    return { sign: lastSign, rad: peak.rad, side: peak.side };
  });
  if (peaks.some((p) => !p || p.rad < BOWL_TRIGGER))
    return { ok: false, reason: "That bowl was too gentle to read. Swing like a real bowl." };
  const [a, b] = peaks as { sign: number; rad: number; side: number }[];
  if (a.sign !== b.sign)
    return { ok: false, reason: "The two bowls didn't read the same way. Try again." };
  // Bowl 2 goes a little toward the left: its sideways reading should be negative.
  const sideSign = b.side > 0.08 ? -1 : 1;
  return {
    ok: true,
    profile: { upSign: a.sign, sideSign, typical: (a.rad + b.rad) / 2 },
  };
}
