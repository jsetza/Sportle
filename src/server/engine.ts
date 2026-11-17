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
    lastSeen: Date.now(),
    volleyMomentum: false,
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
    p.swingUntil = 0;
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
    announce(m, `Team ${m.winner! + 1} wins!`);
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
  if (hit(m, p, input)) p.swingUntil = 0;
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
  const power = clamp(input.strength, 0.15, 1),
    open = clamp(input.pitch / 55, -1, 1),
    direction = input.direction;
  const smash = direction < -0.45 && b.y > 1.8;
  const lob = !smash && open > 0.45 && direction > 0.1;
  const roll = !lob && direction > 0.35;
  const dink = power < 0.42;
  const depth = smash ? 5.5 : lob ? 5.8 : dink ? 2.7 : 3.4 + power * 2.5;
  const x = clamp((input.roll + input.yaw * 0.25) / 35, -1, 1) * 2.8;
  const flight = smash ? 0.58 : lob ? 1.95 : dink ? 1.05 : 1.5 - power * 0.55;
  p.volleyMomentum = m.bounces === 0;
  launch(m, p, x, (p.team ? 1 : -1) * depth, flight, roll ? power * 1.8 : 0);
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
  announce(m, m.shot + " • " + Math.round(power * 100) + "%");
  return true;
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
  if (incoming && p.id === owner.id) {
    const look =
      m.bounces === 0
        ? Math.max(
            0,
            (m.velocity.y +
              Math.sqrt(
                m.velocity.y * m.velocity.y +
                  2 * 9.81 * Math.max(0, b.y - 0.037),
              )) /
              9.81,
          )
        : 0.15;
    return vec(
      clamp(b.x + m.velocity.x * look, -3.65, 3.65),
      0,
      sign * clamp(Math.abs(b.z + m.velocity.z * look) + 0.4, 2.55, 7.5),
    );
  }
  return vec(teammates.length === 1 ? 0 : serviceX(m, p), 0, sign * 4.5);
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
    if (m.time >= p.reactionAt) {
      p.target = movementTarget(m, p);
      p.reactionAt =
        m.time +
        (p.bot ? { easy: 0.22, medium: 0.16, hard: 0.1 }[m.difficulty] : 0.05);
    }
    const dx = p.target.x - p.pos.x,
      dz = p.target.z - p.pos.z,
      len = Math.hypot(dx, dz),
      speed = p.bot ? { easy: 3.3, medium: 3.8, hard: 4.3 }[m.difficulty] : 4.3;
    const rate = Math.min(speed, len / dt);
    p.velocity = vec(
      len ? (dx / len) * rate : 0,
      0,
      len ? (dz / len) * rate : 0,
    );
    p.pos.x += p.velocity.x * dt;
    p.pos.z += p.velocity.z * dt;
    // Auto movement stops outside NVZ; a volley cannot carry feet through its line.
    if (p.volleyMomentum && Math.abs(p.pos.z) <= C.kitchen + 0.22) {
      fault(m, p.team, "Kitchen momentum fault");
      return;
    }
    if (len < 0.03) p.volleyMomentum = false;
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
    if (Math.abs(x) < 3.35 && y - C.radius < net) {
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
      if (hit(m, p, p.swingInput)) p.swingUntil = 0;
      if (m.phase !== "rally") return;
    }
  }
  for (const p of m.players) {
    if (!p.bot || p.id === "practice-feed") continue;
    if (
      m.time - p.lastHit < 0.5 ||
      m.time - m.shotAt <
        { easy: 0.22, medium: 0.16, hard: 0.1 }[m.difficulty] ||
      m.ball.y > 1.5
    )
      continue;
    if (contactFault(m, p)) continue;
    hit(m, p, {
      ...ZERO_INPUT,
      strength:
        m.difficulty === "easy"
          ? 0.48
          : m.difficulty === "medium"
            ? 0.62
            : 0.78,
      roll: m.difficulty === "easy" ? 0 : Math.sin(m.time * 1.9) * 24,
      pitch: 0,
      direction: 0.15,
    });
  }
}
