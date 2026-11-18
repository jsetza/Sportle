import { randomBytes } from "node:crypto";
import {
  match,
  player,
  start,
  queueSwing,
  setMove,
  setPhoneMove,
} from "./engine.ts";
import { MOVE_STYLES } from "../shared/types.ts";
import { slots, teamFor } from "../shared/types.ts";
import type { Mode, Difficulty, Match, Input } from "../shared/types.ts";
export const token = () => randomBytes(24).toString("base64url");
export type Session = {
  role: "host" | "display" | "controller";
  /** Pairing token currently shown by this host/display, if any. */
  pair?: string;
  /** Public (non-secret) id of a host/display session, used to attribute paired phones. */
  displayId?: string;
  playerId?: string;
  expires: number;
  lastSeq: number;
  /** Highest swing id already applied (swings repeat across packets). */
  lastSwingId?: number;
  lastInput: number;
};
export type Room = {
  code: string;
  state: Match;
  host: string;
  pair: string;
  pairExpires: number;
  /** Every live pairing token (one per display), with an optional team for phones it pairs. */
  pairs: Map<string, { expires: number; team: number | null; display: string }>;
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
  s.displayId ||= token().slice(0, 8);
  r.pairs.set(pair, {
    display: s.displayId,
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
    return { team: p.team, display: p.display };
  }
  if (!r.pairs.size)
    throw Error("Pairing expired. Ask the host to refresh the QR code.");
  return { team: null, display: "" };
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
  r.pairs.set(r.pair, { expires: r.pairExpires, team: null, display: "host" });
  r.sessions.set(r.host, {
    role: "host",
    displayId: "host",
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
  display = "",
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
  p.display = display;
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
  if (
    a.swingId !== undefined &&
    (!Number.isSafeInteger(a.swingId) || a.swingId < 0)
  )
    return false;
  for (const k of ["mx", "mz", "side"] as const)
    if (
      a[k] !== undefined &&
      (typeof a[k] !== "number" ||
        !Number.isFinite(a[k]) ||
        Math.abs(a[k]!) > 1)
    )
      return false;
  if (a.ctl !== undefined && a.ctl !== 0 && a.ctl !== 1 && a.ctl !== 2)
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
  if (a.ctl !== undefined) {
    p.moveStyle = MOVE_STYLES[a.ctl];
    if (p.moveStyle === "auto") p.manual = false;
  }
  if (p.moveStyle === "phone" && r.state.phase !== "lobby" && !r.state.paused)
    setPhoneMove(r.state, p, a.mx ?? 0, a.mz ?? 0);
  if (a.swing && a.sensors && a.calibrated) {
    if (a.swingId === undefined) queueSwing(r.state, p, a);
    else if (a.swingId > (s.lastSwingId ?? -1)) {
      s.lastSwingId = a.swingId;
      queueSwing(r.state, p, a);
    }
  }
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

/**
 * Humans this display controls with its keyboard: phones it paired, in join order.
 * The host also controls phones that joined by manual room code.
 */
export function localPlayers(r: Room, s: Session) {
  return r.state.players.filter(
    (p) =>
      !p.bot &&
      (p.display === s.displayId || (s.role === "host" && p.display === "")),
  );
}
/** Keyboard movement from a display: slot 0 = WASD, slot 1 = arrow keys. */
export function acceptMove(
  r: Room,
  s: Session,
  a: { seq?: unknown; keys?: unknown },
): boolean {
  if (s.role !== "host" && s.role !== "display") return false;
  if (!Number.isSafeInteger(a.seq) || (a.seq as number) <= s.lastSeq)
    return false;
  if (!Array.isArray(a.keys) || a.keys.length > 2) return false;
  const local = localPlayers(r, s);
  for (const k of a.keys) {
    if (!k || typeof k !== "object") return false;
    const { slot, x, z } = k as Record<string, unknown>;
    if (
      (slot !== 0 && slot !== 1) ||
      typeof x !== "number" ||
      typeof z !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      Math.abs(x) > 1 ||
      Math.abs(z) > 1
    )
      return false;
  }
  s.lastSeq = a.seq as number;
  r.updated = Date.now();
  if (r.state.paused || r.state.phase === "lobby") return true;
  for (const k of a.keys as { slot: number; x: number; z: number }[]) {
    const p = local.filter((q) => q.moveStyle === "keys")[k.slot];
    if (p) setMove(r.state, p, k.x, k.z);
  }
  return true;
}

/** Host action after a finished match: same players, same mode, fresh score. */
export function rematch(r: Room) {
  const m = r.state;
  if (m.phase !== "over") throw Error("The match is still in progress");
  const humans = m.players.filter((p) => !p.bot);
  if (humans.some((p) => !p.connected || Date.now() - p.lastSeen > 2500))
    throw Error("Every phone must be connected to play again");
  for (const p of m.players) {
    p.lastHit = -10;
    p.volleyMomentum = false;
    if (p.moveStyle !== "keys" && p.moveStyle !== "phone") p.manual = false;
  }
  start(m);
}
