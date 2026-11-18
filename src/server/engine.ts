import {
  SWING_RELOAD,
  COURT as C,
  ZERO_INPUT,
  clamp,
} from "../shared/types.ts";
import type {
  Match,
  Mode,
  Difficulty,
  MapId,
  Player,
  Input,
  Vec,
} from "../shared/types.ts";
import {
  rotateService,
  serviceX,
  rightPlayer,
  contactFault,
  landingFault,
  doubles,
  inKitchen,
} from "../shared/rules.ts";
const vec = (x = 0, y = 0, z = 0): Vec => ({ x, y, z });
export function player(
  id: string,
  name: string,
  team: number,
  bot = false,
): Player {
  return {
    id,
    name,
    team,
    bot,
    connected: true,
    ready: bot,
    hand: "right",
    pos: vec(team ? -1.5 : 1.5, 0, team ? -5 : 5),
    velocity: vec(),
    input: { ...ZERO_INPUT },
    lastHit: -10,
    swingUntil: 0,
    swingAt: -10,
    swingInput: { ...ZERO_INPUT },
    swingBest: -1,
    lastSeen: Date.now(),
    volleyMomentum: false,
    kitchenClearAt: -10,
    momentumAt: -10,
    moveX: 0,
    moveZ: 0,
    moveUntil: 0,
    manual: false,
    display: "",
    moveStyle: "keys",
    outfit: "classic",
    reactionAt: 0,
    target: vec(),
  };
}
export function match(
  mode: Mode = "practice",
  difficulty: Difficulty = "easy",
  map: MapId = "arena",
): Match {
  return {
    mode,
    difficulty,
    map,
    phase: "lobby",
    paused: false,
    pauseReason: "",
    resumeAt: 0,
    score: [0, 0],
    serving: 0,
    serverNumber: 2,
    serverId: "",
    receiverId: "",
    players: [],
    ball: vec(0, 1, 4),
    velocity: vec(),
    spin: 0,
    lastTeam: 1,
    lastPlayer: "",
    bounces: 0,
    hits: 0,
    serveX: 1.5,
    message: "Connect your phone to begin",
    event: 0,
    time: 0,
    nextServe: 0,
    winner: null,
    shot: "",
    contacts: 0,
    shotAt: 0,
    seed: 0x5eed,
    quality: 0,
    popup: false,
    popupAt: null,
  };
}
/** mulberry32 on match state: deterministic bot variety without Math.random. */
export function rand(m: Match) {
  m.seed = (m.seed + 0x6d2b79f5) | 0;
  let t = m.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const REACTION = { easy: 0.22, medium: 0.16, hard: 0.1 };
/** Assist (owner request): after bouncing, the ball moves at this fraction of real speed (0.8 ≈ bounce lasts 1.25×). */
export const BOUNCE_TIME_SCALE = 0.8;
export const HUMAN_SPEED = 4.3;
const ACCEL = 14;
/** Phone thumb pad: player-relative (forward = toward the net) converted to world axes. */
export function setPhoneMove(
  m: Match,
  p: Player,
  right: number,
  forward: number,
) {
  const f = p.team ? -1 : 1;
  setMove(m, p, clamp(right, -1, 1) * f, -clamp(forward, -1, 1) * f);
}
/** Apply a keyboard movement message to a human player (validated by the caller). */
export function setMove(m: Match, p: Player, x: number, z: number) {
  if (p.bot) return;
  p.moveX = clamp(x, -1, 1);
  p.moveZ = clamp(z, -1, 1);
  p.moveUntil = m.time + 0.35;
  if (x || z) p.manual = true;
}
const SPEED = { easy: 3.3, medium: 3.8, hard: 4.3 };
/** Characters stand beside the ball's path on their forehand side, so the paddle, not the torso, meets it. */
export const FOREHAND_OFFSET = 0.6;
export const forehandSide = (p: Player) =>
  (p.hand === "right" ? 1 : -1) * (p.team ? -1 : 1);
/** Ball slowdown: 15% of its speed lost every 0.2 s → exponential rate per second. */
export const BALL_DRAG = -Math.log(0.85) / 0.2;
/** Cap on launch speed relative to the shot's average speed (owner: "max velocity ~3x"). */
export const MAX_LAUNCH_FACTOR = 3;
/** Horizontal distance covered in time t starting at speed v under BALL_DRAG. */
export const travel = (v: number, t: number) =>
  (v * (1 - Math.exp(-BALL_DRAG * t))) / BALL_DRAG;
/** Time to cover distance d starting at speed v (Infinity if the ball stops short). */
const timeToCover = (v: number, d: number) => {
  const r = 1 - (BALL_DRAG * Math.abs(d)) / Math.max(1e-6, Math.abs(v));
  return r <= 0 ? Infinity : -Math.log(r) / BALL_DRAG;
};
/** Horizontal speed (m/s) of a 100% forehand/backhand drive; lower swings scale down from it. */
export const GROUND_MAX_SPEED = 12.5;
/** Speed multiplier for overheads and attacking volleys (owner request: +75%). */
export const VOLLEY_SPEEDUP = 1.75;
/**
 * The shortest flight time from `fast` up to `normal` whose arc still clears the net by
 * ~12 cm (a faster shot to the same spot is flatter).
 */
function netSafeFlight(
  m: Match,
  targetZ: number,
  fast: number,
  normal: number,
) {
  const b = m.ball;
  if (Math.sign(b.z) === Math.sign(targetZ) || b.z === 0) return fast;
  for (let t = fast; t < normal; t += 0.02) {
    const vy = (0.07 - b.y + 4.905 * t * t) / t;
    // When does the (slowing) ball reach the net plane?
    const boost = Math.min(
      MAX_LAUNCH_FACTOR,
      (BALL_DRAG * t) / (1 - Math.exp(-BALL_DRAG * t)),
    );
    const vz = ((targetZ - b.z) / t) * boost;
    const tn = Math.min(t, timeToCover(vz, b.z));
    if (b.y + vy * tn - 4.905 * tn * tn > C.netCenter + 0.12) return t;
  }
  return normal;
}
/** Where the ball (before bouncing) comes down through height `h`, ballistically. */
export function descentPoint(m: Match, h: number): Vec | null {
  const g = 9.81 + m.spin,
    { x, y, z } = m.ball,
    v = m.velocity;
  const disc = v.y * v.y - 2 * g * (h - y);
  if (disc < 0) return null;
  const t = (v.y + Math.sqrt(disc)) / g;
  return vec(x + travel(v.x, t), h, z + travel(v.z, t));
}
/**
 * Where an incoming ball will be at a comfortable hitting height (~0.8 m) on the way down
 * after its bounce (ballistic, no drag; movement anticipation only, never used for scoring).
 */
export function intercept(m: Match) {
  const g = 9.81 + m.spin,
    H = 0.8;
  let { x, y, z } = m.ball,
    vx = m.velocity.x,
    vy = m.velocity.y,
    vz = m.velocity.z;
  if (m.bounces === 0) {
    const l = landing(m);
    x = l.x;
    z = l.z;
    y = C.radius;
    vy = Math.abs(vy - g * l.t) * 0.76;
    const slow = Math.exp(-BALL_DRAG * l.t);
    vx *= 0.86 * slow;
    vz *= 0.86 * slow;
  }
  const disc = vy * vy - 2 * g * (H - y);
  const t = disc > 0 ? (vy + Math.sqrt(disc)) / g : Math.max(0, vy / g);
  return { x: x + travel(vx, t), z: z + travel(vz, t), t };
}
/** Ballistic landing estimate (no drag) used for movement anticipation only, never for scoring. */
export function landing(m: Match) {
  const g = 9.81 + m.spin,
    y = m.ball.y - C.radius,
    vy = m.velocity.y;
  const t = Math.max(0, (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * y))) / g);
  return {
    t,
    x: m.ball.x + travel(m.velocity.x, t),
    z: m.ball.z + travel(m.velocity.z, t),
  };
}
export function announce(m: Match, s: string) {
  m.message = s;
  m.event++;
}
export function start(m: Match) {
  m.score = [0, 0];
  m.serving = 0;
  m.serverNumber = doubles(m) ? 2 : 1;
  m.serverId = rightPlayer(m, 0).id;
  m.winner = null;
  m.paused = false;
  m.pauseReason = "";
  m.resumeAt = 0;
  m.contacts = 0;
  prepare(m);
}
export function prepare(m: Match) {
  m.phase = "serve";
  m.nextServe = m.time + 2;
  m.hits = 0;
  m.bounces = 0;
  m.spin = 0;
  m.velocity = vec();
  for (const p of m.players) {
    p.pos = vec(serviceX(m, p), 0, (p.team ? -1 : 1) * 7.05);
    p.velocity = vec();
    p.volleyMomentum = false;
    p.kitchenClearAt = -10;
    p.swingUntil = 0;
    p.moveUntil = 0;
  }
  const s = m.players.find((p) => p.id === m.serverId)!;
  m.serveX = s.pos.x;
  m.receiverId = m.players
    .filter((p) => p.team !== m.serving)
    .sort(
      (a, b) => Math.abs(a.pos.x + m.serveX) - Math.abs(b.pos.x + m.serveX),
    )[0].id;
  m.ball = vec(s.pos.x, 0.7, s.pos.z);
  announce(
    m,
    `${m.score[m.serving]} – ${m.score[1 - m.serving]}${doubles(m) ? " – " + m.serverNumber : ""} • ${s.name} serves`,
  );
}
export function fault(m: Match, loser: number, reason: string) {
  holds.delete(m);
  if (m.mode === "practice") {
    m.phase = "serve";
    m.nextServe = m.time + 1.6;
    announce(m, reason + " • next practice ball");
    return;
  }
  rotateService(m, 1 - loser);
  if (m.phase === "over") {
    announce(
      m,
      `${m.winner ? "Red" : "Blue"} wins ${m.score[m.winner!]}–${m.score[1 - m.winner!]}!`,
    );
    return;
  }
  prepare(m);
  announce(m, reason + " • " + m.message);
}
// Assisted serve: legal feet and low underhand contact are generated, not inferred from phone position.
export function serve(m: Match) {
  const p = m.players.find((p) => p.id === m.serverId)!;
  m.ball = vec(p.pos.x, 0.65, p.pos.z);
  launch(m, p, -p.pos.x, (p.team ? 1 : -1) * 4.9, 1.35, 0);
  m.hits = 1;
  m.phase = "rally";
  m.serveX = p.pos.x;
}
function launch(
  m: Match,
  p: Player,
  x: number,
  z: number,
  t: number,
  spin: number,
) {
  // Start fast enough that, slowing down under BALL_DRAG, the ball reaches (x, z) in t.
  const boost = Math.min(
    MAX_LAUNCH_FACTOR,
    (BALL_DRAG * t) / (1 - Math.exp(-BALL_DRAG * t)),
  );
  m.velocity = vec(
    ((x - m.ball.x) / t) * boost,
    (0.07 - m.ball.y + 4.905 * t * t) / t,
    ((z - m.ball.z) / t) * boost,
  );
  m.spin = spin;
  m.shotAt = m.time;
  m.bounces = 0;
  m.popup = false;
  m.popupAt = null;
  m.lastTeam = p.team;
  m.lastPlayer = p.id;
  p.lastHit = m.time;
  p.reactionAt = m.time + 0.2;
  for (const other of m.players)
    if (other.team !== p.team)
      other.reactionAt =
        m.time +
        (other.bot
          ? { easy: 0.22, medium: 0.16, hard: 0.1 }[m.difficulty]
          : 0.05);
  m.contacts++;
}
/** Reach (m, horizontal from the body) for a human swing; bots keep 1.15 m. */
export const HUMAN_REACH = 1.3;
/** Owner request: human hitbox size by game difficulty (hard = the base hitbox). */
export const HITBOX = { easy: 2.3, medium: 1.6, hard: 1 } as const;
/** Reach (m) for a human player at this match's difficulty. */
export const humanReach = (m: Match) => HUMAN_REACH * HITBOX[m.difficulty];
/** An early swing waits this long (s) for the ball to arrive. */
export const EARLY_WINDOW = 0.25;
/**
 * A late swing still connects if the ball was in reach this recently (s). The player swings
 * at what their screen shows, which runs behind the server (stream + phone network delay),
 * so without this the same swing hits or misses depending on that moment's lag.
 */
export const LATE_GRACE = 0.22;
interface Chance {
  at: number;
  q: number;
  ball: Vec;
  velocity: Vec;
  contacts: number;
  bounces: number;
}
/** Hittable moments each human had within LATE_GRACE (server-only, not sent to clients). */
const chances = new WeakMap<Player, Chance[]>();
/**
 * When the ball would end the point (second bounce, or leaving the area) while a human still
 * has a late-swing chance, the call waits until that chance runs out. Server-only.
 */
const holds = new WeakMap<
  Match,
  { until: number; team: number; reason: string; bounces: number }
>();
function holdCall(m: Match, team: number, reason: string, bounces = m.bounces) {
  if (holds.has(m)) return true;
  let until = -1;
  for (const p of m.players) {
    if (p.bot || p.team === m.lastTeam) continue;
    const c = lateChance(m, p, bounces);
    if (c) until = Math.max(until, c.at + LATE_GRACE);
  }
  if (until <= m.time) return false;
  holds.set(m, { until, team, reason, bounces });
  return true;
}
function hittable(m: Match, p: Player) {
  const b = m.ball;
  return (
    !holds.has(m) &&
    m.phase === "rally" &&
    m.lastTeam !== p.team &&
    (p.team === 0 ? b.z >= 0.04 : b.z <= -0.04) &&
    Math.hypot(b.x - p.pos.x, b.z - p.pos.z) <= humanReach(m) &&
    b.y >= 0.12 &&
    b.y <= 2.65
  );
}
function remember(m: Match, p: Player) {
  const list = (chances.get(p) ?? []).filter(
    (c) => m.time - c.at <= LATE_GRACE && c.contacts === m.contacts,
  );
  if (hittable(m, p))
    list.push({
      at: m.time,
      q: contactQuality(m, p),
      ball: { ...m.ball },
      velocity: { ...m.velocity },
      contacts: m.contacts,
      bounces: m.bounces,
    });
  chances.set(p, list);
}
/** The best moment the player had recently, if the ball is still in the same state. */
function lateChance(m: Match, p: Player, bounces = m.bounces) {
  let best: Chance | undefined;
  for (const c of chances.get(p) ?? [])
    if (
      m.time - c.at <= LATE_GRACE &&
      c.contacts === m.contacts &&
      c.bounces === bounces &&
      (!best || c.q > best.q)
    )
      best = c;
  return best;
}
export function queueSwing(m: Match, p: Player, input: Input) {
  if (m.paused || m.phase !== "rally" || m.time - p.swingAt < SWING_RELOAD)
    return;
  p.swingAt = m.time;
  p.swingInput = { ...input };
  p.swingBest = -1;
  // Late swing: the ball already went past. Play the contact at the best moment the player
  // had (within LATE_GRACE), as long as nobody has touched the ball since and it hasn't
  // bounced again — i.e. the moment their screen was showing when they swung.
  const held = holds.get(m);
  const c = hittable(m, p)
    ? undefined
    : held
      ? p.team !== m.lastTeam
        ? lateChance(m, p, held.bounces)
        : undefined
      : lateChance(m, p);
  if (c) {
    const ball = m.ball,
      velocity = m.velocity,
      bounces = m.bounces;
    m.ball = { ...c.ball };
    m.velocity = { ...c.velocity };
    m.bounces = c.bounces;
    holds.delete(m);
    chances.delete(p);
    if (hit(m, p, p.swingInput)) {
      p.swingUntil = 0;
      return;
    }
    if (m.phase === "rally") {
      m.ball = ball;
      m.velocity = velocity;
      m.bounces = bounces;
      if (held) holds.set(m, held);
    }
  }
  p.swingUntil = m.time + EARLY_WINDOW;
}
export function hit(m: Match, p: Player, input: Input): boolean {
  if (
    holds.has(m) ||
    m.paused ||
    m.phase !== "rally" ||
    m.lastTeam === p.team ||
    m.time - p.lastHit < SWING_RELOAD
  )
    return false;
  const b = m.ball;
  if (
    (p.team === 0 ? b.z < 0.04 : b.z > -0.04) ||
    Math.hypot(b.x - p.pos.x, b.z - p.pos.z) > (p.bot ? 1.15 : humanReach(m)) ||
    b.y < 0.12 ||
    b.y > 2.65
  )
    return false;
  const f = contactFault(m, p);
  if (f) {
    fault(m, p.team, f);
    return false;
  }
  // Bots position perfectly, so they get execution noise in place of human sensor/timing error.
  const quality = p.bot
    ? botExecution(m, contactQuality(m, p))
    : contactQuality(m, p);
  const power = clamp(input.strength, 0.15, 1),
    open = clamp(input.pitch / 55, -1, 1),
    direction = input.direction;
  const smash = smashIntent(m, input);
  const lob = !smash && open > 0.45 && direction > 0.1;
  const roll = !lob && direction > 0.35;
  const dink = power < 0.42;
  // Soft dinks land inside the opponent's kitchen; slightly firmer ones become drops just beyond it.
  const depth = smash
    ? 5.5
    : lob
      ? 5.8
      : dink
        ? 1.55 + power * 2.7
        : 3.4 + power * 2.5;
  // Roll/yaw are in the player's own frame (handedness already normalised on the phone);
  // the far team faces +z, so its left/right is mirrored in world X.
  // Off-centre or badly timed contact spreads the shot; big swings magnify the error.
  // This is how shots go wide or long: comfortable compact swings stay reliable.
  // Players get half the error spread of earlier builds; bots keep theirs so matches end.
  const miss = (1 - quality) * (0.45 + power) * (p.bot ? 1 : 0.5);
  // Aim in the player's own frame: the swing path (left→right sends it right) leads,
  // the paddle-face angle fine-tunes. The far team faces +z, so its frame is mirrored in X.
  // Left/right comes from the swing path the phone learned in the movement test.
  // (Paddle tilt is still shown on screen but no longer bends the aim, so it can't fight it.)
  const side = clamp(input.side ?? 0, -1, 1);
  const aim = clamp(side * 2.5, -2.7, 2.7);
  // Badly timed contact can pop the ball up instead: high, short and slow, an easy smash
  // for the other side. Same chance for players and bots.
  const popup = !smash && !lob && quality < 0.55 && rand(m) < 0.5;
  if (popup) {
    const px = aim * 0.5 * (p.team ? -1 : 1) + (rand(m) * 2 - 1) * 0.6;
    const pz = (p.team ? 1 : -1) * (C.kitchen + 2.3 + rand(m) * 1.5);
    p.volleyMomentum = m.bounces === 0;
    if (p.volleyMomentum) p.momentumAt = m.time;
    launch(m, p, clamp(px, -2.6, 2.6), pz, 1.62 + rand(m) * 0.2, 0);
    m.popup = true;
    m.popupAt = descentPoint(m, 2.0);
    m.quality = quality;
    m.hits++;
    m.shot = strokeSide(m, p, side) + " pop-up";
    announce(m, "Pop-up! • " + m.shot + " • smash it!");
    return true;
  }
  const x = aim * (p.team ? -1 : 1) + (rand(m) * 2 - 1) * miss * 2.8;
  let flight = smash ? 0.58 : lob ? 1.95 : dink ? 1.05 : 1.5 - power * 0.55;
  // Owner request: ball speed follows the swing percentage for forehand/backhand drives,
  // rolls and dinks — a gentle swing sends a proportionally slower (loopier) ball to the
  // same spot. Smashes and lobs keep their own speeds.
  if (!smash && !lob) {
    const tz = (p.team ? 1 : -1) * Math.max(0.6, depth);
    const dist = Math.hypot(x - b.x, tz - b.z);
    if (dink) flight = 1.05 + (0.42 - power) * 1.3;
    else {
      flight = clamp(dist / (GROUND_MAX_SPEED * power ** 0.8), 0.7, 2.4);
      // Fast drives are flat: make sure the arc still clears the net.
      flight = netSafeFlight(m, tz, flight, flight * 1.8);
    }
  }
  // Owner request: overheads and attacking volleys (hit before the bounce) fly 1.75× faster.
  // Soft volleys (dinks) and lob volleys keep their touch. A safety check keeps the faster,
  // flatter ball above the net.
  if (smash || (m.bounces === 0 && !dink && !lob)) {
    const targetZ = (p.team ? 1 : -1) * Math.max(0.6, depth);
    flight = netSafeFlight(m, targetZ, flight / VOLLEY_SPEEDUP, flight);
  }
  p.volleyMomentum = m.bounces === 0;
  if (p.volleyMomentum) p.momentumAt = m.time;
  const long = (rand(m) * 1.4 - 0.4) * miss * 2.2;
  launch(
    m,
    p,
    x,
    (p.team ? 1 : -1) * Math.max(0.6, depth + long),
    // A mishit also flattens the arc, which is how balls find the net.
    flight * (1 - rand(m) * Math.min(0.6, miss * 0.7)),
    roll ? power * 1.8 : 0,
  );
  m.quality = quality;
  m.hits++;
  m.shot =
    strokeSide(m, p, side) +
    " " +
    (smash ? "smash" : lob ? "lob" : roll ? "roll" : dink ? "dink" : "drive");
  announce(
    m,
    m.shot +
      " • " +
      Math.round(power * 100) +
      "%" +
      (quality > 0.85
        ? " • sweet spot"
        : quality < 0.55
          ? " • off-centre"
          : ""),
  );
  return true;
}
/** Bot contact: occasional mistimed hits (unforced errors), rarer on harder settings. */
const BOT_ERROR = { easy: 0.09, medium: 0.07, hard: 0.045 };
function botExecution(m: Match, q: number) {
  if (rand(m) < BOT_ERROR[m.difficulty]) return 0.15 + rand(m) * 0.2;
  return q - rand(m) ** 2 * 0.25;
}
/**
 * 0..1 contact quality from where the ball is relative to the paddle side of the body
 * at the moment of contact (i.e. timing), and contact height. Not a physical measurement.
 */
/** Downward swing at a ball above 1.8 m. Pop-ups are easier: a softer downward swing counts. */
export function smashIntent(m: Match, input: Input) {
  return input.direction < (m.popup ? -0.3 : -0.45) && m.ball.y > 1.8;
}
export function contactQuality(m: Match, p: Player) {
  const b = m.ball,
    side = forehandSide(p) * FOREHAND_OFFSET;
  // Clean contact on either side of the body: forehand, or a slightly less forgiving backhand.
  const at = (px: number) => Math.hypot(b.x - px, (b.z - p.pos.z) * 1.2);
  // A bigger hitbox (easier difficulty) also keeps contact clean further from the body.
  const d =
    Math.min(at(p.pos.x + side), at(p.pos.x - side) * 1.08) /
    (p.bot ? 1 : HITBOX[m.difficulty]);
  // High contact is awkward for ordinary shots, but it is exactly where a smash happens.
  const high = m.popup && m.bounces === 0 ? 2.5 : 1.5;
  const h = b.y < 0.35 ? 0.35 - b.y : b.y > high ? (b.y - high) * 0.4 : 0;
  return clamp(1 - (d / 1.3) ** 2 * 0.75 - h, 0.15, 1);
}
/**
 * Forehand or backhand: which side of the body the ball is on at contact (relative to the
 * paddle hand). When the ball is nearly central, the swing path decides — a forehand swings
 * across toward the non-paddle side.
 */
export function strokeSide(m: Match, p: Player, swingSide = 0) {
  const lateral = (m.ball.x - p.pos.x) * forehandSide(p);
  if (Math.abs(lateral) > 0.12) return lateral > 0 ? "Forehand" : "Backhand";
  const hand = p.hand === "left" ? -1 : 1;
  return swingSide * hand > 0 ? "Backhand" : "Forehand";
}
export function feed(m: Match) {
  const p = m.players.find((p) => !p.bot)!;
  m.phase = "rally";
  p.pos = vec(0, 0, 4.8);
  m.ball = vec(0, 1.2, -2);
  m.velocity = vec(0, 4.1, 5.2);
  m.hits = 3;
  m.bounces = 0;
  m.lastTeam = 1;
  m.lastPlayer = "feed";
  m.spin = 0;
  m.shotAt = m.time;
  announce(m, "Let it bounce. Swing as the ball reaches you.");
}
// Modular coverage policy: one chaser per team, stable left/right ownership in doubles.
export function movementTarget(m: Match, p: Player): Vec {
  const sign = p.team ? -1 : 1,
    b = m.ball;
  const incoming = m.lastTeam !== p.team;
  const teammates = m.players.filter((q) => q.team === p.team);
  let owner = teammates[0];
  if (teammates.length > 1)
    owner = teammates.reduce((a, q) =>
      Math.abs(q.pos.x - b.x) < Math.abs(a.pos.x - b.x) ? q : a,
    );
  if (m.hits === 1) owner = m.players.find((q) => q.id === m.receiverId)!;
  const side = forehandSide(p) * FOREHAND_OFFSET;
  if (incoming && p.id === owner.id) {
    const land = landing(m);
    // Entering the NVZ is legal to play a ball that has bounced (or will bounce) there.
    // While volley momentum is active, or when the ball will land deep, stay outside the line.
    const bouncesInKitchen =
      (m.bounces > 0 && Math.abs(b.z) < C.kitchen + 0.9) ||
      (m.bounces === 0 &&
        Math.sign(land.z) === sign &&
        Math.abs(land.z) < C.kitchen);
    const minZ =
      bouncesInKitchen && !p.volleyMomentum ? 0.55 : C.kitchen + 0.42;
    // Stand behind the ball, not inside it: go to where it comes back down to waist height
    // after its bounce, on the forehand side. That point does not drift as the ball travels,
    // so the player settles early and the ball comes to them.
    // Pop-up coming: go to where it drops through smash height, outside the kitchen
    // (a smash is a volley). If it would come down inside the kitchen, let it bounce instead.
    const pu = m.popup && m.bounces === 0 ? m.popupAt : null;
    if (
      pu &&
      Math.sign(pu.z) === sign &&
      Math.abs(pu.z) > C.kitchen + 0.35 &&
      !p.volleyMomentum
    )
      return vec(
        clamp(pu.x - side * 0.6, -3.65, 3.65),
        0,
        sign * clamp(Math.abs(pu.z) + 0.15, C.kitchen + 0.42, 7.5),
      );
    const ic = intercept(m);
    return vec(
      clamp(ic.x - side, -3.65, 3.65),
      0,
      sign * clamp(Math.abs(ic.z) + 0.15, minZ, 7.5),
    );
  }
  // Recovery: get out of the kitchen first, then return to the base position.
  // Medium/hard bots advance to the NVZ line once the return of serve is struck.
  const advance = p.bot && m.difficulty !== "easy" && m.hits >= 2;
  return vec(
    teammates.length === 1 ? -side * 0.5 : serviceX(m, p),
    0,
    sign * (advance ? C.kitchen + 0.5 : 4.5),
  );
}
export function step(m: Match, dt = 1 / 120) {
  if (m.paused || m.phase === "lobby" || m.phase === "over") return;
  m.time += dt;
  if (m.phase === "serve") {
    if (m.time >= m.nextServe) {
      if (m.mode === "practice") feed(m);
      else serve(m);
    }
    return;
  }
  for (const p of m.players) {
    let len: number;
    if (!p.bot && p.manual) {
      // Keyboard movement (WASD / arrows on the display): screen-relative, same speed limit as auto.
      const held = m.time < p.moveUntil;
      const ix = held ? p.moveX : 0,
        iz = held ? p.moveZ : 0;
      const mag = Math.min(1, Math.hypot(ix, iz)) || 0;
      const nx = mag ? ix / Math.hypot(ix, iz) : 0,
        nz = mag ? iz / Math.hypot(ix, iz) : 0;
      const want = vec(nx * HUMAN_SPEED * mag, 0, nz * HUMAN_SPEED * mag);
      // Short acceleration ramp so taps feel controllable rather than teleporty.
      const k = Math.min(1, ACCEL * dt);
      p.velocity = vec(
        p.velocity.x + (want.x - p.velocity.x) * k,
        0,
        p.velocity.z + (want.z - p.velocity.z) * k,
      );
      len = Math.hypot(p.velocity.x, p.velocity.z) < 0.05 ? 0 : 1;
    } else {
      if (m.time >= p.reactionAt) {
        p.target = movementTarget(m, p);
        p.reactionAt = m.time + (p.bot ? REACTION[m.difficulty] : 0.05);
      }
      const dx = p.target.x - p.pos.x,
        dz = p.target.z - p.pos.z,
        speed = p.bot ? SPEED[m.difficulty] : HUMAN_SPEED;
      len = Math.hypot(dx, dz);
      const rate = Math.min(speed, len / dt);
      p.velocity = vec(
        len ? (dx / len) * rate : 0,
        0,
        len ? (dz / len) * rate : 0,
      );
    }
    const wasIn = inKitchen(p);
    p.pos.x += p.velocity.x * dt;
    p.pos.z += p.velocity.z * dt;
    // Stay on your own side of the net and within the run-off area.
    const sideSign = p.team ? -1 : 1;
    p.pos.x = clamp(p.pos.x, -4.6, 4.6);
    p.pos.z = sideSign * clamp(sideSign * p.pos.z, 0.35, 9.2);
    const nowIn = inKitchen(p);
    if (wasIn && !nowIn) p.kitchenClearAt = m.time;
    if (nowIn) p.kitchenClearAt = m.time;
    // Rule 9.C: volley momentum may not carry the player into the NVZ.
    if (p.volleyMomentum && nowIn) {
      fault(m, p.team, "Kitchen momentum fault");
      return;
    }
    // Momentum ends once the player has stopped or regained balance after the volley.
    if (len < 0.03 || m.time - p.momentumAt > 0.6) p.volleyMomentum = false;
  }
  const old = { ...m.ball };
  // After the bounce the ball follows the same path at half speed, so it hangs in the
  // hitting zone twice as long (same height, same spot). Players and bots move at normal speed.
  const bdt = m.bounces > 0 ? dt * BOUNCE_TIME_SCALE : dt;
  m.velocity.y -= (9.81 + m.spin) * bdt;
  // Owner request: the ball is fastest right off the paddle and loses 15% of its speed
  // every 0.2 s (horizontal). Launches compensate, so shots still land where aimed.
  const drag = Math.exp(-BALL_DRAG * bdt);
  m.velocity.x *= drag;
  m.velocity.z *= drag;
  m.ball.x += m.velocity.x * bdt;
  m.ball.y += m.velocity.y * bdt;
  m.ball.z += m.velocity.z * bdt;
  if (old.z * m.ball.z <= 0 && old.z !== m.ball.z) {
    const t = old.z / (old.z - m.ball.z);
    const x = old.x + (m.ball.x - old.x) * t,
      y = old.y + (m.ball.y - old.y) * t;
    const net =
      C.netCenter +
      (C.netSide - C.netCenter) * Math.min(1, Math.abs(x) / C.halfWidth);
    const ax = Math.abs(x);
    if (
      ax > C.post - C.postRadius - C.radius &&
      ax < C.post + C.postRadius + C.radius &&
      y - C.radius < C.netSide + 0.05
    ) {
      fault(m, m.lastTeam, "Net post");
      return;
    }
    if (ax < C.post && y - C.radius < net) {
      m.ball.z = Math.sign(old.z) * 0.045;
      m.velocity.z *= -0.16;
      m.velocity.x *= 0.6;
      m.velocity.y *= 0.6;
      announce(m, "Net");
    }
  }
  if (m.ball.y <= C.radius && m.velocity.y < 0) {
    const t = (old.y - C.radius) / (old.y - m.ball.y);
    m.ball.x = old.x + (m.ball.x - old.x) * clamp(t, 0, 1);
    m.ball.z = old.z + (m.ball.z - old.z) * clamp(t, 0, 1);
    m.ball.y = C.radius;
    if (m.bounces === 0) {
      const f = landingFault(m, m.ball.x, m.ball.z);
      if (f) {
        fault(m, m.lastTeam, f);
        return;
      }
    }
    if (!holds.has(m)) {
      m.bounces++;
      if (
        m.bounces >= 2 &&
        !holdCall(m, 1 - m.lastTeam, "Double bounce", m.bounces - 1)
      ) {
        fault(m, 1 - m.lastTeam, "Double bounce");
        return;
      }
    }
    m.velocity.y = Math.abs(m.velocity.y) * 0.76;
    m.velocity.x *= 0.86;
    m.velocity.z *= 0.86;
  }
  const team = m.bounces ? 1 - m.lastTeam : m.lastTeam;
  if (
    (Math.abs(m.ball.z) > 13 || Math.abs(m.ball.x) > 10) &&
    !holdCall(m, team, "Out of reach")
  ) {
    fault(m, team, "Out of reach");
    return;
  }
  const hold = holds.get(m);
  if (hold && m.time >= hold.until) {
    holds.delete(m);
    fault(m, hold.team, hold.reason);
    return;
  }
  for (const p of m.players) {
    if (!p.bot && p.swingUntil > m.time) {
      // Within the short swing window, meet the ball at its best point rather than the first
      // reachable tick, so a well-timed compact swing gets clean contact.
      const reach =
        Math.hypot(m.ball.x - p.pos.x, m.ball.z - p.pos.z) <= humanReach(m);
      const q = contactQuality(m, p);
      // A downward swing at a high ball is a smash: take it now, while it is still up there.
      const smashNow = smashIntent(m, p.swingInput);
      if (
        reach &&
        !smashNow &&
        m.time + dt < p.swingUntil &&
        q > p.swingBest + 0.002
      ) {
        p.swingBest = q;
        continue;
      }
      if (hit(m, p, p.swingInput)) p.swingUntil = 0;
      if (m.phase !== "rally") return;
    }
  }
  for (const p of m.players) if (!p.bot) remember(m, p);
  for (const p of m.players) {
    if (!p.bot || p.id === "practice-feed") continue;
    if (
      m.time - p.lastHit < 0.5 ||
      m.time - m.shotAt < REACTION[m.difficulty] ||
      m.lastTeam === p.team ||
      Math.hypot(m.ball.x - p.pos.x, m.ball.z - p.pos.z) > 1.15
    )
      continue;
    const smashable = m.difficulty !== "easy" && m.ball.y > 1.85;
    if (m.ball.y > 1.5 && !smashable) continue;
    const q = contactQuality(m, p),
      nx = m.ball.x + m.velocity.x / 60,
      nz = m.ball.z + m.velocity.z / 60,
      leaving = Math.hypot(nx - p.pos.x, nz - p.pos.z) > 1.1;
    if (q < { easy: 0.6, medium: 0.72, hard: 0.82 }[m.difficulty] && !leaving)
      continue;
    if (contactFault(m, p)) continue;
    hit(m, p, botShot(m, p));
    if (m.phase !== "rally") return;
  }
}
/**
 * Bot shot choice. Bots produce the same Input shape a phone does and go through hit(),
 * so they obey identical reach, timing, kitchen and shot-shape rules.
 */
export function botShot(m: Match, p: Player): Input {
  const d = m.difficulty,
    b = m.ball,
    r = () => rand(m);
  const opponents = m.players.filter((q) => q.team !== p.team);
  const oppNet = opponents.every((q) => Math.abs(q.pos.z) < C.kitchen + 1.3);
  const nearNet = Math.abs(p.pos.z) < C.kitchen + 1.0;
  const skill = { easy: 0.35, medium: 0.65, hard: 0.9 }[d];
  // Aim into the widest gap on the far court; easy bots stay central to sustain rallies.
  const gap =
    opponents.length === 1
      ? -Math.sign(opponents[0].pos.x || 1) * 1.6
      : (r() < 0.5 ? -1 : 1) * 0.4;
  const noise = { easy: 0.9, medium: 0.55, hard: 0.3 }[d] * (r() * 2 - 1);
  const aimX = clamp((d === "easy" ? 0 : gap) + noise, -2.5, 2.5);
  // Same aiming path as a phone: a sideways swing in the bot's own frame.
  const side = clamp((aimX * (p.team ? -1 : 1)) / 1.9, -1, 1);
  const base = {
    ...ZERO_INPUT,
    side,
    roll: 0,
    yaw: 0,
    sensors: true,
    calibrated: true,
  };
  const pick = r();
  if (b.y > 1.85 && m.bounces === 0)
    return {
      ...base,
      strength: 0.6 + skill * 0.3,
      direction: -0.8,
      pitch: -10,
    };
  if (d !== "easy" && oppNet && pick < 0.12 + (d === "hard" ? 0.08 : 0))
    return { ...base, strength: 0.55, direction: 0.4, pitch: 40 };
  // Third shot: better bots favour a drop to get to the net.
  if (m.hits === 2 && pick < skill * 0.6)
    return { ...base, strength: 0.3 + r() * 0.08, direction: 0.05 };
  if (nearNet && oppNet && pick < 0.35 + skill * 0.4)
    return { ...base, strength: 0.22 + r() * 0.12, direction: 0.05 };
  const power = { easy: 0.48, medium: 0.62, hard: 0.76 }[d] + (r() - 0.5) * 0.1;
  return {
    ...base,
    strength: clamp(power, 0.43, 0.9),
    direction: d !== "easy" && pick > 0.7 ? 0.45 : 0.15,
  };
}
