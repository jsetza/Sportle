import { randomBytes } from "node:crypto";
import { match, player, start, queueSwing } from "./engine.ts";
import { slots, teamFor } from "../shared/types.ts";
import type { Mode, Difficulty, Match, Input } from "../shared/types.ts";
export const token = () => randomBytes(24).toString("base64url");
export type Session = {
  role: "host" | "display" | "controller";
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
  sessions: Map<string, Session>;
  updated: number;
};
export const rooms = new Map<string, Room>();
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
    pairExpires: Date.now() + 600000,
    sessions: new Map(),
    updated: Date.now(),
  };
  r.sessions.set(r.host, {
    role: "host",
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
  const p = player(
    token().slice(0, 10),
    name,
    teamFor(r.state.mode, humans.length),
  );
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
