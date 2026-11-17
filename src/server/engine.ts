import { COURT as C, ZERO_INPUT, clamp } from "../shared/types.ts";
import type {
  Match,
  Mode,
  Difficulty,
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
    reactionAt: 0,
    target: vec(),
  };
}
export function match(
  mode: Mode = "practice",
  difficulty: Difficulty = "easy",
): Match {
  return {
    mode,
    difficulty,
    phase: "lobby",
    paused: false,
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
export const FOREHAND_OFFSET = 0.45;
export const forehandSide = (p: Player) =>
  (p.hand === "right" ? 1 : -1) * (p.team ? -1 : 1);
/** Ballistic landing estimate (no drag) used for movement anticipation only, never for scoring. */
export function landing(m: Match) {
  const g = 9.81 + m.spin,
    y = m.ball.y - C.radius,
    vy = m.velocity.y;
  const t = Math.max(0, (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * y))) / g);
  return { t, x: m.ball.x + m.velocity.x * t, z: m.ball.z + m.velocity.z * t };
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
  m.velocity = vec(
    (x - m.ball.x) / t,
    (0.07 - m.ball.y + 4.905 * t * t) / t,
    (z - m.ball.z) / t,
  );
  m.spin = spin;
  m.shotAt = m.time;
  m.bounces = 0;
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
export function queueSwing(m: Match, p: Player, input: Input) {
  if (m.paused || m.phase !== "rally" || m.time - p.swingAt < 0.32) return;
  p.swingAt = m.time;
  p.swingUntil = m.time + 0.12;
  p.swingInput = { ...input };
  p.swingBest = -1;
}
export function hit(m: Match, p: Player, input: Input): boolean {
  if (
    m.paused ||
    m.phase !== "rally" ||
    m.lastTeam === p.team ||
    m.time - p.lastHit < 0.32
  )
    return false;
  const b = m.ball;
  if (
    (p.team === 0 ? b.z < 0.04 : b.z > -0.04) ||
    Math.hypot(b.x - p.pos.x, b.z - p.pos.z) > 1.15 ||
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
  const smash = direction < -0.45 && b.y > 1.8;
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
  const miss = (1 - quality) * (0.45 + power);
  const x =
    clamp((input.roll + input.yaw * 0.25) / 35, -1, 1) *
      2.8 *
      (p.team ? -1 : 1) +
    (rand(m) * 2 - 1) * miss * 2.8;
  const flight = smash ? 0.58 : lob ? 1.95 : dink ? 1.05 : 1.5 - power * 0.55;
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
  m.shot = smash
    ? "Smash"
    : lob
      ? "Lob"
      : roll
        ? "Roll"
        : dink
          ? "Dink / drop"
          : "Drive";
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
export function contactQuality(m: Match, p: Player) {
  const b = m.ball,
    px = p.pos.x + forehandSide(p) * FOREHAND_OFFSET;
  const d = Math.hypot(b.x - px, (b.z - p.pos.z) * 1.2);
  const h = b.y < 0.35 ? 0.35 - b.y : b.y > 1.5 ? (b.y - 1.5) * 0.4 : 0;
  return clamp(1 - (d / 1.3) ** 2 * 0.75 - h, 0.15, 1);
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
    const look = m.bounces === 0 ? land.t : 0.15;
    const ahead = Math.abs(b.z + m.velocity.z * look);
    // Entering the NVZ is legal to play a ball that has bounced (or will bounce) there.
    // While volley momentum is active, or when the ball will land deep, stay outside the line.
    const bouncesInKitchen =
      (m.bounces > 0 && Math.abs(b.z) < C.kitchen + 0.9) ||
      (m.bounces === 0 &&
        Math.sign(land.z) === sign &&
        Math.abs(land.z) < C.kitchen);
    const minZ =
      bouncesInKitchen && !p.volleyMomentum ? 0.55 : C.kitchen + 0.42;
    return vec(
      clamp(b.x + m.velocity.x * look - side, -3.65, 3.65),
      0,
      sign * clamp(ahead + 0.4, minZ, 7.5),
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
  m.velocity.y -= (9.81 + m.spin) * dt;
  m.velocity.x *= 1 - 0.055 * dt;
  m.velocity.z *= 1 - 0.055 * dt;
  m.ball.x += m.velocity.x * dt;
  m.ball.y += m.velocity.y * dt;
  m.ball.z += m.velocity.z * dt;
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
    m.bounces++;
    if (m.bounces >= 2) {
      fault(m, 1 - m.lastTeam, "Double bounce");
      return;
    }
    m.velocity.y = Math.abs(m.velocity.y) * 0.76;
    m.velocity.x *= 0.86;
    m.velocity.z *= 0.86;
  }
  if (Math.abs(m.ball.z) > 13 || Math.abs(m.ball.x) > 10) {
    fault(m, m.bounces ? 1 - m.lastTeam : m.lastTeam, "Out of reach");
    return;
  }
  for (const p of m.players) {
    if (!p.bot && p.swingUntil > m.time) {
      // Within the short swing window, meet the ball at its best point rather than the first
      // reachable tick, so a well-timed compact swing gets clean contact.
      const reach = Math.hypot(m.ball.x - p.pos.x, m.ball.z - p.pos.z) <= 1.15;
      const q = contactQuality(m, p);
      if (reach && m.time + dt < p.swingUntil && q > p.swingBest + 0.002) {
        p.swingBest = q;
        continue;
      }
      if (hit(m, p, p.swingInput)) p.swingUntil = 0;
      if (m.phase !== "rally") return;
    }
  }
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
  const roll = (aimX / 2.8) * 35 * (p.team ? -1 : 1);
  const base = { ...ZERO_INPUT, roll, yaw: 0, sensors: true, calibrated: true };
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
