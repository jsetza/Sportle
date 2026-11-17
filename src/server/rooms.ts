import { randomBytes } from "node:crypto";
import { match, player, start, queueSwing } from "./engine.ts";
import { slots, teamFor } from "../shared/types.ts";
import type { Mode, Difficulty, Match, Input } from "../shared/types.ts";
export const token = () => randomBytes(24).toString("base64url");
export type Session = {
  role: "host" | "display" | "controller";
  /** Pairing token currently shown by this host/display, if any. */
  pair?: string;
  playerId?: string;
  expires: number;
  lastSeq: number;
  lastInput: number;
};
export type Room = {
  code: string;
  state: Match;
  host: string;
  pair: string;
  pairExpires: number;
  /** Every live pairing token (one per display), with an optional team for phones it pairs. */
  pairs: Map<string, { expires: number; team: number | null }>;
  sessions: Map<string, Session>;
  updated: number;
};
export const rooms = new Map<string, Room>();
export const PAIR_TTL = 600000;
/** Teams that make sense to choose in a mode (null = no choice, e.g. co-op or practice). */
export const teamChoice = (m: Mode) => m === "singles" || m === "doubles";
/** Issue (or rotate) the pairing token a host/display shows in its QR. */
export function issuePair(r: Room, s: Session, team: number | null = null) {
  if (s.pair) r.pairs.delete(s.pair);
  const pair = token(),
    expires = Date.now() + PAIR_TTL;
  r.pairs.set(pair, {
    expires,
    team: teamChoice(r.state.mode) && (team === 0 || team === 1) ? team : null,
  });
  s.pair = pair;
  if (s.role === "host") {
    r.pair = pair;
    r.pairExpires = expires;
  }
  return { pair, pairExpires: expires };
}
/** Validate a pairing token, or a manual room-code join while any display's pairing is live. */
export function checkPair(r: Room, pair: unknown, now = Date.now()) {
  for (const [k, v] of r.pairs) if (v.expires < now) r.pairs.delete(k);
  if (typeof pair === "string" && pair) {
    const p = r.pairs.get(pair);
    if (!p) throw Error("Pairing link expired. Rescan the QR on your display.");
    return p.team;
  }
  if (!r.pairs.size)
    throw Error("Pairing expired. Ask the host to refresh the QR code.");
  return null;
}
const capacity = (m: Mode, team: number) =>
  m === "doubles" ? 2 : m === "singles" ? 1 : team === 0 ? slots(m) : 0;
/** Host lobby action: move a human to a team, if that team has room. */
export function setTeam(r: Room, playerId: string, team: number) {
  const m = r.state;
  if (m.phase !== "lobby") throw Error("Teams are fixed once play starts");
  if (!teamChoice(m.mode)) throw Error("This mode has fixed teams");
  if (team !== 0 && team !== 1) throw Error("Invalid team");
  const p = m.players.find((p) => p.id === playerId && !p.bot);
  if (!p) throw Error("Player not found");
  if (p.team === team) return p;
  const others = m.players.filter((q) => !q.bot && q.team === team);
  if (others.length >= capacity(m.mode, team)) {
    // Full team: swap with the most recent joiner on that team.
    others[others.length - 1].team = p.team;
  }
  p.team = team;
  return p;
}
export function createRoom(mode: Mode, difficulty: Difficulty): Room {
  let code: string;
  do {
    code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  } while (rooms.has(code));
  const r: Room = {
    code,
    state: match(mode, difficulty),
    host: token(),
    pair: token(),
    pairExpires: Date.now() + PAIR_TTL,
    pairs: new Map(),
    sessions: new Map(),
    updated: Date.now(),
  };
  r.pairs.set(r.pair, { expires: r.pairExpires, team: null });
  r.sessions.set(r.host, {
    role: "host",
    pair: r.pair,
    expires: Date.now() + 86400000,
    lastSeq: -1,
    lastInput: 0,
  });
  rooms.set(code, r);
  return r;
}
export function joinController(
  r: Room,
  name: string,
  hand: "left" | "right",
  credential?: string,
  preferTeam: number | null = null,
) {
  if (credential) {
    const session = r.sessions.get(credential);
    if (
      !session ||
      session.role !== "controller" ||
      session.expires < Date.now()
    )
      throw Error("Reconnect expired. Ask the host to create a new room.");
    const p = r.state.players.find((p) => p.id === session.playerId)!;
    p.connected = true;
    p.ready = false;
    p.lastSeen = Date.now();
    if (r.state.phase !== "lobby") {
      r.state.paused = true;
      r.state.message = p.name + " reconnected. Calibrate, ready, then resume.";
    }
    return { credential, player: p, seq: session.lastSeq };
  }
  if (r.state.phase !== "lobby") throw Error("Match already started");
  const humans = r.state.players.filter((p) => !p.bot);
  if (humans.length >= slots(r.state.mode))
    throw Error("All controller slots are occupied");
  let team = teamFor(r.state.mode, humans.length);
  if (teamChoice(r.state.mode)) {
    const count = (t: number) => humans.filter((p) => p.team === t).length;
    if (
      preferTeam !== null &&
      count(preferTeam) < capacity(r.state.mode, preferTeam)
    )
      team = preferTeam;
    else if (count(team) >= capacity(r.state.mode, team)) team = 1 - team;
  }
  const p = player(token().slice(0, 10), name, team);
  p.hand = hand;
  r.state.players.push(p);
  const key = token();
  r.sessions.set(key, {
    role: "controller",
    playerId: p.id,
    expires: Date.now() + 86400000,
    lastSeq: -1,
    lastInput: 0,
  });
  return { credential: key, player: p, seq: -1 };
}
export function begin(r: Room) {
  const m = r.state,
    humans = m.players.filter((p) => !p.bot);
  if (
    humans.length !== slots(m.mode) ||
    humans.some(
      (p) => !p.connected || !p.ready || Date.now() - p.lastSeen > 2500,
    )
  )
    throw Error("Every required phone must be connected, calibrated and ready");
  for (const t of [0, 1])
    if (humans.filter((p) => p.team === t).length !== capacity(m.mode, t))
      throw Error("Teams are uneven. Switch a player's team in the lobby.");
  m.players = humans;
  if (m.mode === "solo") m.players.push(player("bot-1", "Orbit", 1, true));
  if (m.mode === "coop")
    m.players.push(
      player("bot-1", "Orbit", 1, true),
      player("bot-2", "Nova", 1, true),
    );
  if (m.mode === "practice")
    m.players.push(player("practice-feed", "Ball machine", 1, true));
  start(m);
}
export function acceptInput(
  r: Room,
  s: Session,
  a: Input,
  now = Date.now(),
): boolean {
  if (
    s.role !== "controller" ||
    !a ||
    !Number.isSafeInteger(a.seq) ||
    a.seq <= s.lastSeq ||
    !Number.isFinite(a.t) ||
    Math.abs(now - a.t) > 1200
  )
    return false;
  for (const k of ["pitch", "roll", "yaw", "strength", "direction"] as const)
    if (typeof a[k] !== "number" || !Number.isFinite(a[k])) return false;
  if (
    Math.abs(a.pitch) > 180 ||
    Math.abs(a.roll) > 180 ||
    Math.abs(a.yaw) > 180 ||
    a.strength < 0 ||
    a.strength > 1 ||
    Math.abs(a.direction) > 1 ||
    typeof a.swing !== "boolean" ||
    typeof a.sensors !== "boolean" ||
    typeof a.calibrated !== "boolean"
  )
    return false;
  if (now - s.lastInput < 15) return false;
  s.lastSeq = a.seq;
  s.lastInput = now;
  const p = r.state.players.find((p) => p.id === s.playerId);
  if (!p) return false;
  p.input = { ...a };
  p.lastSeen = now;
  p.connected = true;
  r.updated = now;
  if (!a.sensors || !a.calibrated) {
    p.ready = false;
    if (r.state.phase !== "lobby" && r.state.phase !== "over") {
      r.state.paused = true;
      r.state.message = p.name + " needs live sensors and calibration";
    }
  }
  if (a.swing && a.sensors && a.calibrated) queueSwing(r.state, p, a);
  return true;
}
export function housekeeping(r: Room, now = Date.now()) {
  for (const p of r.state.players) {
    if (!p.bot && p.connected && now - p.lastSeen > 2500) {
      p.connected = false;
      p.ready = false;
      if (r.state.phase !== "lobby") {
        r.state.paused = true;
        r.state.message =
          p.name + " disconnected. Reconnect, ready, then resume.";
        r.state.event++;
      }
    }
  }
  for (const [k, s] of r.sessions) if (s.expires < now) r.sessions.delete(k);
  if (now - r.updated > 3600000) rooms.delete(r.code);
}
