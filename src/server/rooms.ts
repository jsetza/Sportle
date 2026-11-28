import { randomBytes } from "node:crypto";
import {
  match,
  player,
  start,
  queueSwing,
  setMove,
  setPhoneMove,
} from "./engine.ts";
import {
  MOVE_STYLES,
  SERVE_STYLES,
  DEFAULT_GEAR,
  DEFAULT_RULES,
  cleanRules,
} from "../shared/types.ts";
import type { Gear, Rules } from "../shared/types.ts";
import { slots, teamFor } from "../shared/types.ts";
import type {
  Mode,
  Difficulty,
  Match,
  Input,
  MapId,
  Outfit,
} from "../shared/types.ts";
import type { Bowl } from "../shared/bowling.ts";
import { addBowler, bowlInput, newBowl } from "./bowling.ts";
import type { BotLevel, LaneId } from "../shared/bowling.ts";
import type { Kart, KartMode, TrackId, BodyId, BotLevel as KartBot } from "../shared/kart.ts";
import { addRacer, kartFieldsOk, kartInput, kartAway, newKart, resetIds } from "./kart.ts";
import type { Box, BoxMode, BotId as BoxBot, BotLevel as BoxLevel, Drill, Hand, RingId } from "../shared/boxing.ts";
import { addBoxer, addSecondGlove, boxAway, boxFieldsOk, boxInput, gloveCode, gloveOf, newBox, resetGlove } from "./boxing.ts";
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
  /** Set for a Sportle Bowling room (then `state` is an idle pickleball placeholder). */
  bowl?: Bowl;
  /** Set for a Sportle Kart room (then `state` is an idle pickleball placeholder). */
  kart?: Kart;
  /** Set for a Sportle Boxing room (then `state` is an idle pickleball placeholder). */
  box?: Box;
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
export function createRoom(
  mode: Mode,
  difficulty: Difficulty,
  map: MapId = "arena",
  rules: Rules = DEFAULT_RULES,
): Room {
  let code: string;
  do {
    code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  } while (rooms.has(code));
  const r: Room = {
    code,
    state: match(mode, difficulty, map, rules),
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
/** A Sportle Bowling room: same pairing, sessions and transport; its own game state. */
export function createBowlRoom(
  mode: "practice" | "game",
  lane: LaneId,
  bot: BotLevel,
  cap: number,
): Room {
  const r = createRoom("practice", "easy");
  r.bowl = newBowl(mode, lane, bot, cap);
  return r;
}
/** A Sportle Kart room: same pairing, sessions and transport as the other games. */
export function createKartRoom(mode: KartMode, trackId: TrackId, bot: KartBot, items: boolean, laps = 3): Room {
  const r = createRoom("practice", "easy");
  r.kart = newKart(mode, trackId, bot, items, laps);
  return r;
}
/** A Sportle Boxing room: same pairing, sessions and transport as the other games. */
export function createBoxRoom(
  mode: BoxMode,
  ring: RingId,
  level: BoxLevel,
  opponent: BoxBot,
  drill: Drill,
  opts: { roundTime?: number; hp?: number } = {},
): Room {
  const r = createRoom("practice", "easy");
  r.box = newBox(mode, ring, level, opponent, drill, opts);
  return r;
}
/**
 * A phone joins (or rejoins) a boxing room: as a new fighter, or with a glove code from a
 * fighter's first phone as that fighter's second glove. Rejoining takes back the same glove.
 */
export function joinBoxer(
  r: Room,
  name: string,
  hand: Hand,
  credential: string | undefined,
  display: string,
  outfit: Outfit,
  gear: Gear,
  glove: string,
) {
  const b = r.box!;
  if (credential) {
    const session = r.sessions.get(credential);
    const found = session?.playerId ? gloveOf(b, session.playerId) : null;
    if (!session || session.role !== "controller" || session.expires < Date.now() || !found)
      throw Error("Reconnect expired. Scan the QR again.");
    if (found.fighter.gloves[0] === found.glove) {
      found.fighter.outfit = outfit;
      found.fighter.gear = gear;
    }
    resetGlove(found.glove);
    b.event++;
    return { credential, player: { id: found.glove.id, fighter: found.fighter.id, hand: found.glove.hand }, gloveCode: gloveCode(found.fighter), seq: session.lastSeq };
  }
  const id = token().slice(0, 10);
  const { fighter, glove: g } = glove ? addSecondGlove(b, id, glove, hand) : addBoxer(b, id, name, hand, outfit, gear, display);
  const key = token();
  r.sessions.set(key, {
    role: "controller",
    playerId: g.id,
    expires: Date.now() + 86400000,
    lastSeq: -1,
    lastInput: 0,
  });
  return { credential: key, player: { id: g.id, fighter: fighter.id, hand: g.hand }, gloveCode: gloveCode(fighter), seq: -1 };
}
/** A phone joins (or rejoins) a kart room. Rejoining takes back the same kart, even mid-race. */
export function joinRacer(
  r: Room,
  name: string,
  credential: string | undefined,
  display: string,
  outfit: Outfit,
  gear: Gear,
  body: BodyId,
  color: number,
) {
  const k = r.kart!;
  if (credential) {
    const session = r.sessions.get(credential);
    const p = k.racers.find((q) => q.id === session?.playerId && !q.bot);
    if (!session || session.role !== "controller" || session.expires < Date.now() || !p)
      throw Error("Reconnect expired. Scan the QR again.");
    p.outfit = outfit;
    p.gear = gear;
    resetIds(p);
    k.event++;
    return { credential, player: p, seq: session.lastSeq };
  }
  const p = addRacer(k, token().slice(0, 10), name, outfit, gear, body, color, display);
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
/** A phone joins (or rejoins) a bowling room. Rejoining resumes the same seat and score. */
export function joinBowler(
  r: Room,
  name: string,
  hand: "left" | "right",
  credential: string | undefined,
  display: string,
  outfit: Outfit,
  gear: Gear,
) {
  const b = r.bowl!;
  if (credential) {
    const session = r.sessions.get(credential);
    const p = b.players.find((q) => q.id === session?.playerId);
    if (!session || session.role !== "controller" || session.expires < Date.now() || !p)
      throw Error("Reconnect expired. Scan the QR again.");
    p.outfit = outfit;
    p.gear = gear;
    p.connected = true;
    p.lastSeen = Date.now();
    return { credential, player: p, seq: session.lastSeq };
  }
  const p = addBowler(b, token().slice(0, 10), name, hand, outfit, gear, display);
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
export function joinController(
  r: Room,
  name: string,
  hand: "left" | "right",
  credential?: string,
  preferTeam: number | null = null,
  display = "",
  outfit: Outfit = "classic",
  gear: Gear = { ...DEFAULT_GEAR },
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
    p.outfit = outfit;
    p.gear = gear;
    p.connected = true;
    p.lastSeen = Date.now();
    // Keep "ready": the phone remembers its swings. Play waits until its sensors are live
    // again, then resumes by itself (see housekeeping).
    dropPause(
      r,
      p.name + " is reconnecting · play resumes when their paddle is live",
    );
    return { credential, player: p, seq: session.lastSeq };
  }
  if (r.state.phase !== "lobby") throw Error("Match already started");
  const rk = r.state.ranked;
  if (rk && rk.stage !== "lobby")
    throw Error("This ranked lobby is busy. Pair before searching.");
  const humans = r.state.players.filter((p) => !p.bot);
  // A ranked lobby holds just this household's phones: one for 1v1, up to two for 2v2.
  const cap = rk ? (rk.queue === "1v1" ? 1 : 2) : slots(r.state.mode);
  if (humans.length >= cap) throw Error("All controller slots are occupied");
  let team = rk ? 0 : teamFor(r.state.mode, humans.length);
  if (!rk && teamChoice(r.state.mode)) {
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
  p.outfit = outfit;
  p.gear = gear;
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
/** Host changes the match format in the lobby (not in ranked: ranked rules are fixed). */
export function setRules(r: Room, rules: unknown, difficulty: unknown) {
  const m = r.state;
  if (m.ranked) throw Error("Ranked matches use the standard rules");
  if (m.phase !== "lobby") throw Error("Change the rules before the match starts");
  m.rules = cleanRules(rules);
  if (difficulty === "easy" || difficulty === "medium" || difficulty === "hard")
    m.difficulty = difficulty;
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
  const bot = (id: string, name: string, outfit: Outfit) =>
    Object.assign(player(id, name, 1, true), { outfit });
  if (m.mode === "solo") m.players.push(bot("bot-1", "Orbit", "astro"));
  if (m.mode === "coop")
    m.players.push(
      bot("bot-1", "Orbit", "astro"),
      bot("bot-2", "Nova", "headband"),
    );
  if (m.mode === "practice")
    m.players.push(player("practice-feed", "Ball machine", 1, true));
  start(m);
}
/**
 * Validate a controller packet (types, ranges, timestamp within 1.2 s, increasing sequence,
 * per-session rate) and record its sequence. Shared by pickleball and bowling.
 */
export function admitInput(s: Session, a: Input, now = Date.now()): boolean {
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
  if (a.kb !== undefined && typeof a.kb !== "boolean") return false;
  if (a.face !== undefined && a.face !== 1 && a.face !== -1) return false;
  if (a.sv !== undefined && a.sv !== 0 && a.sv !== 1 && a.sv !== 2)
    return false;
  if (
    a.hook !== undefined &&
    (typeof a.hook !== "number" || !Number.isFinite(a.hook) || Math.abs(a.hook) > 1)
  )
    return false;
  if (now - s.lastInput < 15) return false;
  s.lastSeq = a.seq;
  s.lastInput = now;
  return true;
}
/** A swing id not applied before (swings repeat across packets so a late one can't lose it). */
function freshSwing(s: Session, a: Input) {
  if (a.swingId === undefined) return true;
  if (a.swingId <= (s.lastSwingId ?? -1)) return false;
  s.lastSwingId = a.swingId;
  return true;
}
export function acceptInput(
  r: Room,
  s: Session,
  a: Input,
  now = Date.now(),
): boolean {
  if (!admitInput(s, a, now)) return false;
  r.updated = now;
  if (r.kart) {
    const p = r.kart.racers.find((p) => p.id === s.playerId && !p.bot);
    if (!p || !kartFieldsOk(a as unknown as Record<string, unknown>)) return false;
    kartInput(r.kart, p, a, now);
    return true;
  }
  if (r.box) {
    const found = s.playerId ? gloveOf(r.box, s.playerId) : null;
    if (!found || !boxFieldsOk(a as unknown as Record<string, unknown>)) return false;
    boxInput(r.box, found.fighter, found.glove, a, now);
    return true;
  }
  if (r.bowl) {
    const p = r.bowl.players.find((p) => p.id === s.playerId);
    if (!p) return false;
    bowlInput(r.bowl, p, a, a.swing ? freshSwing(s, a) : false, now);
    return true;
  }
  const p = r.state.players.find((p) => p.id === s.playerId);
  if (!p) return false;
  p.input = { ...a };
  p.keyboard = a.kb === true;
  p.lastSeen = now;
  p.connected = true;
  r.updated = now;
  if ((!a.sensors || !a.calibrated) && !r.state.paused)
    dropPause(r, p.name + "'s paddle isn't live · resumes when it is");
  if (a.sv !== undefined) p.serveStyle = SERVE_STYLES[a.sv];
  if (a.ctl !== undefined) {
    p.moveStyle = MOVE_STYLES[a.ctl];
    if (p.moveStyle === "auto") p.manual = false;
  }
  if (p.moveStyle === "phone" && r.state.phase !== "lobby" && !r.state.paused)
    setPhoneMove(r.state, p, a.mx ?? 0, a.mz ?? 0);
  if (a.swing && a.sensors && a.calibrated && freshSwing(s, a))
    queueSwing(r.state, p, a);
  return true;
}
export function housekeeping(r: Room, now = Date.now()) {
  if (r.kart) kartAway(r.kart, now);
  if (r.box) boxAway(r.box, now);
  if (r.bowl)
    for (const p of r.bowl.players)
      if (!p.bot && p.connected && now - p.lastSeen > 2500) {
        p.connected = false;
        r.bowl.event++;
      }
  for (const p of r.state.players) {
    if (!p.bot && p.connected && now - p.lastSeen > 2500) {
      p.connected = false;
      dropPause(
        r,
        p.name + " lost connection · play resumes when they're back",
        now,
      );
    }
  }
  autoResume(r, now);
  for (const [k, s] of r.sessions) if (s.expires < now) r.sessions.delete(k);
  if (now - r.updated > 3600000) rooms.delete(r.code);
}

/**
 * Humans this display controls with its keyboard: phones it paired, in join order.
 * The host also controls phones that joined by manual room code.
 */
/** A screen's id for its local players ("host" for the host screen). */
const screenOf = (s: Session) => s.displayId || "host";
/** Players on one screen, in left-half/right-half order (the left half also has WASD). */
export function playersOn(r: Room, screen: string) {
  const list = r.state.players.filter(
    (p) => !p.bot && (p.display || "host") === screen,
  );
  return r.state.swapped.includes(screen) ? list.reverse() : list;
}
export function localPlayers(r: Room, s: Session) {
  return playersOn(r, screenOf(s));
}
/** Swap which player gets the left/right half (and WASD/arrows) on a screen. */
export function swapSides(r: Room, screen: string) {
  const i = r.state.swapped.indexOf(screen);
  if (i >= 0) r.state.swapped.splice(i, 1);
  else r.state.swapped.push(screen);
  r.state.event++;
}
/** A phone picks its half of the split screen: "left" or "right". */
export function chooseSide(r: Room, playerId: string, side: unknown) {
  if (side !== "left" && side !== "right") throw Error("Pick left or right");
  const p = r.state.players.find((q) => q.id === playerId);
  if (!p) throw Error("Unknown player");
  const screen = p.display || "host";
  const order = playersOn(r, screen);
  if (order.length < 2)
    throw Error("Sides only matter with two players on one screen");
  const at = order.findIndex((q) => q.id === playerId);
  if ((side === "left") !== (at === 0)) swapSides(r, screen);
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
    // Fixed seats: WASD = this screen's player 1, arrows = player 2 (split-screen halves),
    // and only for a player who chose keyboard movement on their phone.
    const p = local[k.slot];
    if (p && p.moveStyle === "keys") setMove(r.state, p, k.x, k.z);
  }
  return true;
}

/** Is every phone in this match connected with a live, calibrated paddle? */
export function everyoneBack(r: Room, now = Date.now()) {
  return r.state.players.every(
    (p) =>
      p.bot ||
      (p.connected &&
        now - p.lastSeen < 1500 &&
        p.input.sensors &&
        p.input.calibrated),
  );
}
/**
 * A phone dropped (lost signal, locked screen, switched apps, reloaded): pause the match.
 * Unlike a manual pause, this one lifts by itself when everyone is back.
 */
export function dropPause(r: Room, message: string, now = Date.now()) {
  const m = r.state;
  if (m.phase === "lobby" || m.phase === "over") return;
  m.paused = true;
  if (m.pauseReason !== "host") m.pauseReason = "drop";
  m.resumeAt = 0;
  m.message = message;
  m.event++;
}
/** Resume a drop-pause 3 s after every phone is back (a countdown shows on screen). */
export function autoResume(r: Room, now = Date.now()) {
  const m = r.state;
  if (!m.paused || m.pauseReason !== "drop") return;
  if (!everyoneBack(r, now)) {
    if (m.resumeAt) {
      m.resumeAt = 0;
      m.message = "Waiting for every phone to come back";
      m.event++;
    }
    return;
  }
  if (!m.resumeAt) {
    m.resumeAt = now + 3000;
    m.message = "Everyone's back · resuming in 3";
    m.event++;
    return;
  }
  const left = Math.ceil((m.resumeAt - now) / 1000);
  if (left > 0) {
    const msg = "Everyone's back · resuming in " + left;
    if (m.message !== msg) {
      m.message = msg;
      m.event++;
    }
    return;
  }
  m.paused = false;
  m.pauseReason = "";
  m.resumeAt = 0;
  m.message = "Play resumed";
  m.event++;
}
/** Pause / Resume buttons (big screen or any phone). */
export function hostPause(r: Room) {
  const m = r.state;
  if (m.phase === "lobby" || m.phase === "over") return;
  m.paused = true;
  m.pauseReason = "host";
  m.resumeAt = 0;
  m.message = "Paused · press Resume to keep playing";
  m.event++;
}
export function resume(r: Room) {
  const m = r.state;
  if (!m.paused) return;
  // If a phone is still missing, hand over to the automatic resume instead of failing.
  m.pauseReason = "drop";
  m.resumeAt = 0;
  if (!everyoneBack(r)) {
    const missing = m.players
      .filter((p) => !p.bot && (!p.connected || !p.input.calibrated))
      .map((p) => p.name);
    m.message =
      "Resuming as soon as " +
      (missing.join(" & ") || "every phone") +
      " is back";
    m.event++;
    return;
  }
  autoResume(r);
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
