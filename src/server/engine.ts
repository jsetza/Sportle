import {
  SWING_RELOAD,
  COURT as C,
  ZERO_INPUT,
  DEFAULT_GEAR,
  clamp,
  PERFECT_ZONE,
  DEFAULT_RULES,
  WARMUP_HITS,
} from "../shared/types.ts";
import type {
  Match,
  Mode,
  Difficulty,
  MapId,
  Player,
  Input,
  Vec,
  ServeStyle,
  Rules,
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
    gear: { ...DEFAULT_GEAR },
    serveStyle: "drive",
    rr: 0,
    keyboard: false,
    reactionAt: 0,
    target: vec(),
  };
}
export function match(
  mode: Mode = "practice",
  difficulty: Difficulty = "easy",
  map: MapId = "arena",
  rules: Rules = DEFAULT_RULES,
): Match {
  return {
    mode,
    difficulty,
    map,
    rules: { ...rules },
    games: [0, 0],
    gameWinner: null,
    warmupLeft: 0,
    introUntil: 0,
    phase: "lobby",
    paused: false,
    pauseReason: "",
    resumeAt: 0,
    ranked: null,
    moves: {},
    swapped: [],
    timing: null,
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
    mark: null,
    curve: 0,
    serveKind: "",
  };
}
/** Owner request: pause (s) after each point while the ball finishes its flight. */
export const POINT_PAUSE = 2;
/** After the reset, a bot server waits this long (s); a human may swing after HUMAN_SERVE_READY. */
export const SERVE_DELAY = 1.5;
export const HUMAN_SERVE_READY = 0.5;
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
  g = 9.81,
) {
  const b = m.ball;
  if (Math.sign(b.z) === Math.sign(targetZ) || b.z === 0) return fast;
  for (let t = fast; t < normal; t += 0.02) {
    const vy = (0.07 - b.y + (g / 2) * t * t) / t;
    // When does the (slowing) ball reach the net plane?
    const boost = Math.min(
      MAX_LAUNCH_FACTOR,
      (BALL_DRAG * t) / (1 - Math.exp(-BALL_DRAG * t)),
    );
    const vz = ((targetZ - b.z) / t) * boost;
    const tn = Math.min(t, timeToCover(vz, b.z));
    if (b.y + vy * tn - (g / 2) * tn * tn > C.netCenter + 0.12) return t;
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
/** Match intro length (s): the display shows "YOU vs …" and swoops in; serving waits. */
export const INTRO = 2.6;
/** Longer pause after a game is won in a best-of-three. */
export const GAME_PAUSE = 3.5;
export function start(m: Match) {
  m.games = [0, 0];
  m.winner = null;
  m.paused = false;
  m.pauseReason = "";
  m.resumeAt = 0;
  m.contacts = 0;
  m.warmupLeft =
    m.rules.warmup && m.mode !== "practice" && !m.ranked ? WARMUP_HITS : 0;
  newGame(m, 0);
  m.introUntil = m.mode === "practice" ? 0 : m.time + INTRO;
  m.nextServe += m.introUntil ? INTRO : 0;
  if (m.warmupLeft) {
    announce(m, "Warm-up · forehands, then backhands: find your timing. No points yet");
  }
}
/** Fresh score for a new game; `first` serves first (the bot side during a warm-up). */
export function newGame(m: Match, first: number) {
  const bots = m.players.filter((p) => p.bot && p.id !== "practice-feed");
  if (m.warmupLeft && bots.length) first = bots[0].team;
  m.score = [0, 0];
  m.gameWinner = null;
  m.serving = first;
  m.serverNumber = doubles(m) ? 2 : 1;
  m.serverId = rightPlayer(m, first).id;
  prepare(m);
}
const scoreLine = (m: Match) =>
  `${m.score[m.serving]} – ${m.score[1 - m.serving]}${doubles(m) ? " – " + m.serverNumber : ""}`;
export function prepare(m: Match) {
  m.phase = "serve";
  m.nextServe = m.time + SERVE_DELAY;
  m.curve = 0;
  m.serveKind = "";
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
  // Singles (owner report: receivers in the wrong square): both sides follow the server's
  // score, so the receiver always stands diagonally across from the server.
  if (!doubles(m))
    for (const p of m.players) if (p.team !== m.serving) p.pos.x = -s.pos.x;
  m.serveX = s.pos.x;
  m.receiverId = m.players
    .filter((p) => p.team !== m.serving)
    .sort(
      (a, b) => Math.abs(a.pos.x + m.serveX) - Math.abs(b.pos.x + m.serveX),
    )[0].id;
  m.ball = vec(s.pos.x, 0.7, s.pos.z);
  announce(
    m,
    `${scoreLine(m)} • ${s.name} ${s.bot ? "serves" : "· swing to serve"}`,
  );
}
export function fault(m: Match, loser: number, reason: string) {
  holds.delete(m);
  for (const p of m.players) {
    p.velocity = vec();
    p.swingUntil = 0;
  }
  if (m.mode === "practice") {
    m.phase = "point";
    m.nextServe = m.time + POINT_PAUSE;
    announce(m, reason + " • next practice ball");
    return;
  }
  if (m.warmupLeft !== 0) {
    // Warm-up: no points. The same side serves again after a short pause.
    m.phase = "point";
    m.nextServe = m.time + 1.2;
    announce(
      m,
      reason +
        (m.warmupLeft > 0
          ? " • warm-up · " + m.warmupLeft + " to go"
          : " • warm-up done"),
    );
    return;
  }
  rotateService(m, 1 - loser);
  if (m.gameWinner !== null) {
    m.phase = "point";
    m.nextServe = m.time + GAME_PAUSE;
    announce(
      m,
      `${m.gameWinner ? "Red" : "Blue"} wins game ${m.games[0] + m.games[1]} • ${m.score[m.gameWinner]}–${m.score[1 - m.gameWinner]}`,
    );
    return;
  }
  if (m.phase === "over") {
    announce(
      m,
      `${m.winner ? "Red" : "Blue"} wins ${m.score[m.winner!]}–${m.score[1 - m.winner!]}!`,
    );
    return;
  }
  // Owner request: a short pause after each point; the ball finishes its flight first.
  m.phase = "point";
  m.nextServe = m.time + POINT_PAUSE;
  announce(m, reason + " • " + scoreLine(m));
}
/** Dead ball during the post-point pause: keeps flying, bouncing and rolling. No rules. */
function deadBall(m: Match, dt: number) {
  const b = m.ball,
    v = m.velocity;
  if (b.y <= C.radius + 1e-4 && Math.hypot(v.x, v.y, v.z) < 0.03) return;
  const old = { ...b };
  v.y -= (9.81 + m.spin) * dt;
  v.x += m.curve * dt;
  const drag = Math.exp(-BALL_DRAG * dt);
  v.x *= drag;
  v.z *= drag;
  b.x += v.x * dt;
  b.y += v.y * dt;
  b.z += v.z * dt;
  if (
    old.z * b.z <= 0 &&
    old.z !== b.z &&
    Math.abs(b.x) < C.post &&
    b.y - C.radius < C.netSide
  ) {
    b.z = Math.sign(old.z || 1) * 0.045;
    v.z *= -0.16;
    v.x *= 0.6;
    v.y *= 0.6;
  }
  if (b.y <= C.radius) {
    b.y = C.radius;
    if (v.y < 0) {
      v.y = Math.abs(v.y) * 0.62;
      v.x *= 0.86;
      v.z *= 0.86;
      if (v.y < 0.35) v.y = 0;
    }
  }
}
/** Serve shape per type: flight-time scale, topspin (extra gravity) and side curve (m/s²). */
const SERVE_SHAPE: Record<
  ServeStyle,
  { t: number; spin: number; curve: number }
> = {
  drive: { t: 1, spin: 0, curve: 0 },
  roll: { t: 0.92, spin: 4, curve: 0 },
  slice: { t: 1.08, spin: 0, curve: 2.6 },
};
function botServeStyle(m: Match): ServeStyle {
  if (m.difficulty === "easy") return "drive";
  const r = rand(m);
  return r < 0.5 ? "drive" : r < 0.75 ? "roll" : "slice";
}
/**
 * Serve. Bots (and tests) call it without input; human servers swing their phone, and the
 * swing's strength sets pace/depth while a sideways swing steers within the service box.
 * Legal feet and an underhand contact point are still generated, not inferred from the phone.
 */
export function serve(m: Match, input?: Input) {
  const p = m.players.find((p) => p.id === m.serverId)!;
  const style: ServeStyle = p.bot ? botServeStyle(m) : p.serveStyle;
  const shape = SERVE_SHAPE[style];
  const power = input ? clamp(input.strength, 0.2, 1) : 0.55;
  const side = input ? clamp(input.side ?? 0, -1, 1) : 0;
  m.ball = vec(p.pos.x, 0.65, p.pos.z);
  m.mark = null;
  m.serveX = p.pos.x;
  // Aim at the diagonal service box (centre x = -server x); harder swings are less exact.
  const miss = input ? power * power * 0.45 : 0;
  const tx =
    -p.pos.x + side * 0.9 * (p.team ? -1 : 1) + (rand(m) * 2 - 1) * miss;
  const depth = 3.9 + power * 1.9 + (rand(m) * 2 - 1) * miss;
  const t = (1.5 - power * 0.45) * shape.t;
  // Slice: curves back toward the centre line, so it starts out wide of the target.
  const curve = shape.curve * Math.sign(p.pos.x || 1);
  launch(
    m,
    p,
    tx - 0.5 * curve * t * t * 0.85,
    (p.team ? 1 : -1) * depth,
    t,
    shape.spin,
    true,
  );
  m.curve = curve;
  m.serveKind = style;
  m.hits = 1;
  m.phase = "rally";
  if (!p.bot)
    announce(
      m,
      p.name +
        " · " +
        (style === "roll"
          ? "roll serve"
          : style === "slice"
            ? "slice serve"
            : "serve") +
        " • " +
        Math.round(power * 100) +
        "%",
    );
}
function launch(
  m: Match,
  p: Player,
  x: number,
  z: number,
  t: number,
  spin: number,
  /** Serves: account for topspin in the arc so the ball still lands on target. */
  exact = false,
) {
  // Start fast enough that, slowing down under BALL_DRAG, the ball reaches (x, z) in t.
  const boost = Math.min(
    MAX_LAUNCH_FACTOR,
    (BALL_DRAG * t) / (1 - Math.exp(-BALL_DRAG * t)),
  );
  m.velocity = vec(
    ((x - m.ball.x) / t) * boost,
    (0.07 - m.ball.y + (exact ? (9.81 + spin) / 2 : 4.905) * t * t) / t,
    ((z - m.ball.z) / t) * boost,
  );
  m.spin = spin;
  m.curve = 0;
  m.serveKind = "";
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
  // Owner request: players hit their own serve with a swing.
  if (
    !m.paused &&
    m.phase === "serve" &&
    m.mode !== "practice" &&
    !p.bot &&
    p.id === m.serverId &&
    m.time >= m.nextServe - SERVE_DELAY + HUMAN_SERVE_READY &&
    m.time - p.swingAt >= SWING_RELOAD
  ) {
    p.swingAt = m.time;
    serve(m, input);
    return;
  }
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
  const power = clamp(input.strength, 0.15, 1);
  const stroke = classifyShot(m, p, input);
  const shape = SHOTS[stroke](power);
  const smash = stroke === "smash",
    lob = stroke === "lob",
    dink = stroke === "dink" || stroke === "drop",
    soft = dink || stroke === "block" || stroke === "reset";
  const depth = shape.depth;
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
  const popup = !smash && !lob && quality < 0.55 && rand(m) < (stroke === "roll" || stroke === "topspin" ? 0.12 : 0.5);
  void soft;
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
    warmupHit(m, p);
    m.shot = strokeSide(m, p, side, input.face) + " pop-up";
    judge(m, p, true, "pop-up");
    announce(m, "Pop-up! • " + m.shot + " • smash it!");
    return true;
  }
  const x = aim * (p.team ? -1 : 1) + (rand(m) * 2 - 1) * miss * 2.8;
  // Spin changes the flight: topspin adds downward pull (a higher, dipping arc), backspin
  // takes some away (a flatter, floating ball). Launches account for it so shots still land
  // where aimed; the bounce then kicks (topspin) or skids low (backspin).
  const g = 9.81 + shape.spin;
  let flight = shape.flight ?? 1.5 - power * 0.55;
  // Owner request: ball speed follows the swing percentage for drives, rolls and slices —
  // a gentle swing sends a proportionally slower (loopier) ball to the same spot.
  if (shape.flight === undefined) {
    const tz = (p.team ? 1 : -1) * Math.max(0.6, depth);
    const dist = Math.hypot(x - b.x, tz - b.z);
    const maxFlight = stroke === "roll" || stroke === "topspin" ? 0.82 : 2.4;
    flight = clamp(dist / (GROUND_MAX_SPEED * shape.pace * power ** 0.8), 0.7, maxFlight);
    // Fast drives are flat: make sure the arc still clears the net.
    flight = netSafeFlight(m, tz, flight, flight * 1.8, g);
  } else if (!smash && !lob) {
    const tz = (p.team ? 1 : -1) * Math.max(0.6, depth);
    flight = netSafeFlight(m, tz, flight, flight * 1.8, g);
  }
  // Owner request: overheads and attacking volleys (hit before the bounce) fly 1.75× faster.
  // Touch volleys (dinks, drops, blocks, resets) and lob volleys keep their touch. A safety
  // check keeps the faster, flatter ball above the net.
  if (smash || (m.bounces === 0 && !soft && !lob)) {
    const targetZ = (p.team ? 1 : -1) * Math.max(0.6, depth);
    flight = netSafeFlight(m, targetZ, flight / VOLLEY_SPEEDUP, flight, g);
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
    shape.spin,
    true,
  );
  m.quality = quality;
  m.hits++;
  warmupHit(m, p);
  m.shot = strokeSide(m, p, side, input.face) + " " + stroke;
  judge(m, p, false, stroke);
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
/**
 * Will the ball just launched clear the net? Answered by running the real physics step on a
 * copy of the match until the ball crosses the net plane, hits the net or lands short, so the
 * spark can never disagree with what the ball then does.
 */
export function clearsNet(m: Match) {
  const side = Math.sign(m.ball.z);
  if (!side || Math.sign(m.velocity.z) === side) return true;
  const sim = structuredClone(m);
  for (const p of sim.players) p.reactionAt = 1e9; // nobody reaches for it in the copy
  for (let k = 0; k < 600; k++) {
    const vz = sim.velocity.z;
    step(sim);
    if (sim.phase !== "rally") return false; // net post / didn't cross
    if (Math.sign(sim.velocity.z) !== Math.sign(vz)) return false; // bounced off the net
    if (Math.sign(sim.ball.z) === -side) return true;
    if (sim.bounces > 0) return false; // landed short on its own side
  }
  return false;
}
/**
 * Timing verdict for a human swing, shown as a red or green spark: mistimed contact that pops
 * up or finds the net is "early"/"late" (was the ball still in front of you, or behind?);
 * anything else is "good", or "great" on the sweet spot.
 */
/** A human warm-up hit counts down; at zero the rally plays out and then scoring starts. */
function warmupHit(m: Match, p: Player) {
  if (p.bot || m.warmupLeft <= 0) return;
  m.warmupLeft--;
  // -1 marks "warm-up over, start the match at the next pause".
  if (m.warmupLeft === 0) m.warmupLeft = -1;
}
export function judge(m: Match, p: Player, popup: boolean, stroke: string) {
  if (p.bot) return;
  const net = !popup && !clearsNet(m);
  const bad = popup || net;
  // m.ball is the contact point; in front of the player means the swing came early.
  const front = (p.pos.z - m.ball.z) * (p.team ? -1 : 1);
  const offset = clamp(-front / 0.8, -1, 1);
  const v = m.velocity;
  m.timing = {
    at: m.contacts,
    by: p.id,
    kind: bad
      ? front > 0
        ? "early"
        : "late"
      : m.quality > 0.85 && Math.abs(offset) <= PERFECT_ZONE
        ? "perfect"
        : "good",
    offset: Math.round(offset * 100) / 100,
    kmh: Math.round(Math.hypot(v.x, v.y, v.z) * 3.6),
    stroke,
    why: popup ? "popup" : net ? "net" : "",
  };
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
export type Stroke =
  | "smash"
  | "lob"
  | "topspin"
  | "roll"
  | "drive"
  | "slice"
  | "chop"
  | "dink"
  | "drop"
  | "block"
  | "reset";
/**
 * Shot type from the paddle face angle (pitch: + open, − closed), the swing path
 * (direction: + low-to-high, − high-to-low) and swing speed (strength), plus where the ball
 * and player are (owner request):
 * - high ball + downward swing → smash
 * - deliberate steep upward swing with a very open face → lob
 * - high-to-low with an open face → slice (backspin), harder → chop
 * - gentle with little swing against a fast ball → block (volley) / reset (after the bounce)
 * - gentle → dink near the kitchen, drop from further back
 * - ordinary low-to-high brush → roll, harder → topspin drive
 * - anything else → flat drive
 */
export function classifyShot(m: Match, p: Player, input: Input): Stroke {
  const power = clamp(input.strength, 0.15, 1),
    open = clamp(input.pitch / 55, -1, 1),
    dir = input.direction;
  if (smashIntent(m, input)) return "smash";
  if (open > 0.82 && dir > 0.65 && power >= 0.55) return "lob";
  if (dir < -0.2 && open > 0.05) return power >= 0.62 ? "chop" : "slice";
  if (dir > 0.22 && power >= 0.32) return power >= 0.68 ? "topspin" : "roll";
  if (power < 0.42) {
    const v = m.velocity,
      incoming = Math.hypot(v.x, v.y, v.z);
    if (Math.abs(dir) < 0.15 && Math.abs(open) < 0.3 && incoming > 9)
      return m.bounces === 0 ? "block" : "reset";
    return Math.abs(p.pos.z) < C.kitchen + 1.3 ? "dink" : "drop";
  }
  return "drive";
}
/**
 * Flight per shot: target depth (m from the net), a fixed flight time (s) for touch shots or
 * undefined to derive it from swing speed × pace, and spin (m/s² of extra downward pull:
 * + topspin, − backspin).
 */
export const SHOTS: Record<
  Stroke,
  (power: number) => { depth: number; flight?: number; pace: number; spin: number }
> = {
  smash: () => ({ depth: 5.5, flight: 0.58, pace: 1, spin: 0 }),
  lob: () => ({ depth: 5.8, flight: 1.95, pace: 1, spin: 0.5 }),
  topspin: (p) => ({ depth: Math.min(6.0, 4.3 + p * 1.6), pace: 1, spin: 3 + p * 3 }),
  roll: (p) => ({ depth: 3.4 + p * 2.5, pace: 0.95, spin: 2 + p * 2 }),
  drive: (p) => ({ depth: 3.4 + p * 2.5, pace: 1, spin: 0 }),
  slice: (p) => ({ depth: 3.4 + p * 2.2, pace: 0.85, spin: -(2 + p * 2) }),
  chop: (p) => ({ depth: Math.min(6.0, 4.2 + p * 1.5), pace: 0.8, spin: -(4 + p * 1.5) }),
  dink: (p) => ({ depth: 1.55 + p * 2.7, flight: 1.05 + (0.42 - p) * 1.3, pace: 1, spin: -1.2 }),
  drop: (p) => ({ depth: 1.55 + p * 2.7, flight: 1.3 + (0.42 - p) * 1.3, pace: 1, spin: -1 }),
  block: (p) => ({ depth: 2.0 + p * 1.2, flight: 0.95, pace: 1, spin: 0 }),
  reset: (p) => ({ depth: 1.8 + p * 1.2, flight: 1.1, pace: 1, spin: -0.6 }),
};
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
export function strokeSide(
  m: Match,
  p: Player,
  swingSide = 0,
  face?: number,
) {
  // The phone knows which side of it faced the screen: screen = forehand, back = backhand.
  if (face === 1) return "Forehand";
  if (face === -1) return "Backhand";
  const lateral = (m.ball.x - p.pos.x) * forehandSide(p);
  if (Math.abs(lateral) > 0.12) return lateral > 0 ? "Forehand" : "Backhand";
  const hand = p.hand === "left" ? -1 : 1;
  return swingSide * hand > 0 ? "Backhand" : "Forehand";
}
export function feed(m: Match) {
  const p = m.players.find((p) => !p.bot)!;
  m.phase = "rally";
  m.mark = null;
  m.curve = 0;
  m.serveKind = "";
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
  const style = m.rules.style;
  const advance =
    p.bot &&
    m.hits >= 2 &&
    style !== "defender" &&
    (m.difficulty !== "easy" || style === "attacker");
  return vec(
    teammates.length === 1 ? -side * 0.5 : serviceX(m, p),
    0,
    sign * (advance ? C.kitchen + 0.5 : 4.5),
  );
}
export function step(m: Match, dt = 1 / 120) {
  if (m.paused || m.phase === "lobby" || m.phase === "over") return;
  m.time += dt;
  if (m.phase === "point") {
    deadBall(m, dt);
    if (m.time >= m.nextServe) {
      if (m.mode === "practice") {
        m.phase = "serve";
        m.nextServe = m.time + 0.3;
      } else if (m.gameWinner !== null) newGame(m, 1 - m.gameWinner);
      else if (m.warmupLeft < 0) {
        // Warm-up finished: the real match starts at 0–0 with its own intro.
        m.warmupLeft = 0;
        newGame(m, 0);
        m.introUntil = m.time + INTRO;
        m.nextServe += INTRO;
        announce(m, "Warm-up done · game on! " + m.rules.to + " points, win by 2");
      } else prepare(m);
    }
    return;
  }
  if (m.phase === "serve") {
    if (m.time >= m.nextServe) {
      if (m.mode === "practice") feed(m);
      else if (m.players.find((p) => p.id === m.serverId)?.bot) serve(m);
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
  m.velocity.x += m.curve * bdt;
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
        // Ball mark (owner request) so everyone can see whether it was really out.
        if (f === "Out" || f === "Service court fault")
          m.mark = { x: m.ball.x, z: m.ball.z, out: true };
        // The ball carries on past the line during the pause.
        m.velocity.y = Math.abs(m.velocity.y) * 0.76;
        m.velocity.x *= 0.86;
        m.velocity.z *= 0.86;
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
    // Serve spin on the bounce: a roll serve skips low and kicks forward; a slice skids low
    // and breaks further sideways.
    if (m.serveKind === "roll") {
      m.velocity.y *= 0.75;
      m.velocity.x *= 1.15;
      m.velocity.z *= 1.15;
    } else if (m.serveKind === "slice") {
      m.velocity.y *= 0.72;
      m.velocity.x += m.curve * 0.45;
      m.curve = 0;
    } else if (m.spin > 0.5) {
      // Topspin kicks forward and stays a little lower off the bounce.
      const k = clamp(m.spin / 6, 0, 1);
      m.velocity.y *= 1 - 0.15 * k;
      m.velocity.x *= 1 + 0.18 * k;
      m.velocity.z *= 1 + 0.18 * k;
      m.spin *= 0.4;
    } else if (m.spin < -0.5) {
      // Backspin skids low and checks up.
      const k = clamp(-m.spin / 6, 0, 1);
      m.velocity.y *= 1 - 0.4 * k;
      m.velocity.x *= 1 - 0.18 * k;
      m.velocity.z *= 1 - 0.18 * k;
      m.spin = 0;
    }
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
  const style = m.rules.style;
  if (style === "defender") {
    // Defender: lobs over a net-rusher, resets and drops, rarely hits hard.
    if (oppNet && pick < 0.08) return { ...base, strength: 0.6, direction: 0.75, pitch: 50 };
    if (pick < 0.45 + skill * 0.2)
      return { ...base, strength: 0.26 + r() * 0.12, direction: 0.05 };
  }
  if (b.y > 1.85 && m.bounces === 0)
    return {
      ...base,
      strength: 0.6 + skill * 0.3,
      direction: -0.8,
      pitch: -10,
    };
  if (d !== "easy" && oppNet && pick < (d === "hard" ? 0.05 : 0.02))
    return { ...base, strength: 0.6, direction: 0.75, pitch: 50 };
  // Third shot: better bots favour a drop to get to the net (attackers drive instead).
  if (m.hits === 2 && pick < skill * (style === "attacker" ? 0.2 : 0.6))
    return { ...base, strength: 0.3 + r() * 0.08, direction: 0.05 };
  if (nearNet && oppNet && pick < 0.35 + skill * 0.4)
    return { ...base, strength: 0.22 + r() * 0.12, direction: 0.05 };
  const power =
    { easy: 0.48, medium: 0.62, hard: 0.76 }[d] +
    (r() - 0.5) * 0.1 +
    (style === "attacker" ? 0.12 : style === "defender" ? -0.08 : 0);
  return {
    ...base,
    strength: clamp(power, 0.43, 0.9),
    direction: pick > 0.4 ? 0.45 : 0.15,
  };
}
