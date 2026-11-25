/**
 * Sportle Kart on the server: lobby, grid, countdown, the 120 Hz arcade driving model, items,
 * bots, laps, placings, results and cups. Phones only send intent (steering, throttle, button
 * presses with ids applied once); everything that happens on the track is decided here.
 */
import { randomBytes } from "node:crypto";
import {
  BOT_NAMES,
  COUNTDOWN,
  CUPS,
  CUP,
  cupOf,
  DRIFT_BOOST,
  GRID,
  HIT,
  ITEMS,
  LAPS,
  POINTS,
  SECTORS,
  WAIT_LIMIT,
  bodyOf,
  driftLevel,
  indexAt,
  locate,
  onCut,
  ordinal,
  passSector,
  placings,
  pointAt,
  progressOf,
  rollItem,
  sectorOf,
  track,
} from "../shared/kart.ts";
import type {
  BodyId,
  BotLevel,
  ItemKind,
  Kart,
  KartMode,
  Racer,
  Shot,
  Track,
  TrackId,
} from "../shared/kart.ts";
import { DEFAULT_GEAR, PADDLES, clamp } from "../shared/types.ts";
import type { Gear, Input, Outfit } from "../shared/types.ts";

const DT = 1 / 120;
/** Arcade constants (metres, seconds). */
export const PHYS = {
  vmax: 23,
  accel: 13,
  brake: 24,
  reverse: 6,
  // Easier, consistent handling: one turn rate at any speed above walking pace, strong grip.
  turn: 2.0,
  grip: 13,
  driftGrip: 3.2,
  gravity: 18,
  boost: 1.3,
  offroad: 0.72,
  radius: 1.0,
};
const LEVEL = {
  rookie: { speed: 0.86, aim: 0.6, drift: 0.15, aggro: 0.3, maxLevel: 1 },
  club: { speed: 0.93, aim: 0.85, drift: 0.5, aggro: 0.55, maxLevel: 2 },
  pro: { speed: 0.975, aim: 1, drift: 0.85, aggro: 0.8, maxLevel: 2 },
};

/** Server-only state per kart (never sent to screens). */
type Phys = {
  hint: number;
  vy: number;
  /** Direction of travel (radians); `Racer.h` is where the nose points. */
  m: number;
  onCut: boolean;
  steerIn: number;
  steer: number;
  throttle: number;
  driftHeld: boolean;
  ids: { hop: number; item: number; flick: number; shake: number };
  lastSeen: number;
  live: boolean;
  /** Item roulette result once it stops. */
  pending: ItemKind | "";
  batted: { kind: ItemKind | "mball"; owner: string; until: number } | null;
  trick: boolean;
  wrongFor: number;
  /** Steering assist near the road edges (phone setting, on by default). */
  assist: boolean;
  /** Seconds left of the current wall contact (one speed loss per contact). */
  wallT: number;
  /** Wall contacts so far (tests and tuning). */
  walls: number;
  /** Countdown start boost: gas pressed early (burnout) or in the window. */
  early: boolean;
  good: boolean;
  stall: number;
  lapStart: number;
  safeS: number;
  cannon: { from: number; to: number; T: number; t: number } | null;
  airFor: number;
  tumbleHop: boolean;
  /** Bot personality. */
  bot: { level: BotLevel; drift: number; aggro: number; holdFor: number; side: number };
  lastPlace: number;
};
const phys = new WeakMap<Racer, Phys>();
const P = (r: Racer) => phys.get(r)!;
/** Server-only shot state. */
type ShotS = Shot & {
  s: number;
  d: number;
  vs: number;
  vd: number;
  vy: number;
  life: number;
  bounces: number;
  hint: number;
  target: string;
  hit: Set<string>;
  next: number;
  travelled: number;
};
const shotState = new WeakMap<Kart, ShotS[]>();
const cubeTimers = new WeakMap<Kart, number[]>();
let shotIds = 1;

export function newKart(mode: KartMode = "race", trackId: TrackId = "court", bot: BotLevel = "club", items = true, laps = LAPS): Kart {
  return {
    game: "kart",
    mode,
    track: mode === "cup" ? CUPS[Math.max(0, cupOf(trackId))].tracks[0] : trackId,
    cup: Math.max(0, cupOf(trackId)),
    bot,
    items: mode === "trial" ? false : items,
    phase: "lobby",
    time: 0,
    phaseAt: 0,
    clock: 0,
    racers: [],
    shots: [],
    cubes: [],
    pins: [],
    cupRace: 0,
    laps: clamp(Math.round(laps), 1, 5),
    paused: false,
    message: "Scan the QR to join",
    event: 0,
    callouts: [],
    shared: false,
    seed: randomBytes(4).readUInt32LE(0) | 0,
  };
}
/** Seeded random numbers (one stream per race), so tests can repeat a race. */
function rng(k: Kart) {
  k.seed = (k.seed + 0x6d2b79f5) | 0;
  let t = k.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const say = (k: Kart, msg: string) => {
  k.message = msg;
  k.event++;
};
let calls = 1;
function callout(k: Kart, who: string, text: string, kind = "") {
  k.callouts.push({ at: calls++, who, text, kind });
  if (k.callouts.length > 10) k.callouts.shift();
}
export const humans = (k: Kart) => k.racers.filter((r) => !r.bot);
export function racer(id: string, name: string): Racer {
  const r: Racer = {
    id,
    name,
    outfit: "classic",
    gear: { ...DEFAULT_GEAR },
    body: "classic",
    color: 0,
    bot: "",
    display: "",
    connected: true,
    ready: false,
    away: 0,
    botFor: false,
    grid: 0,
    x: 0,
    y: 0,
    z: 0,
    h: 0,
    yaw: 0,
    tilt: 0,
    v: 0,
    steer: 0,
    drift: 0,
    charge: 0,
    air: false,
    boost: 0,
    item: "",
    uses: 0,
    rolling: 0,
    spin: 0,
    wobble: 0,
    net: 0,
    guard: 0,
    sweet: 0,
    lift: 0,
    cannon: 0,
    lap: 0,
    sector: SECTORS - 1,
    s: 0,
    d: 0,
    progress: 0,
    place: 0,
    finished: 0,
    laps: [],
    best: 0,
    wrong: false,
    points: 0,
    gained: 0,
    tricks: 0,
    boosts: 0,
    hits: 0,
  };
  phys.set(r, freshPhys());
  return r;
}
function freshPhys(): Phys {
  return {
    hint: 0,
    vy: 0,
    m: 0,
    onCut: false,
    steerIn: 0,
    steer: 0,
    throttle: 0,
    driftHeld: false,
    ids: { hop: -1, item: -1, flick: -1, shake: -1 },
    lastSeen: Date.now(),
    live: false,
    pending: "",
    batted: null,
    trick: false,
    wrongFor: 0,
    assist: true,
    wallT: 0,
    walls: 0,
    early: false,
    good: false,
    stall: 0,
    lapStart: 0,
    safeS: 0,
    cannon: null,
    airFor: 0,
    tumbleHop: false,
    bot: { level: "club", drift: 0.5, aggro: 0.5, holdFor: 0, side: 0 },
    lastPlace: 0,
  };
}
/** Is this phone live now (connected, sensors on, set up)? */
export const live = (r: Racer, now = Date.now()) =>
  !!r.bot || (r.connected && now - P(r).lastSeen < 2500 && P(r).live);
/** Add a phone's kart in the lobby (or between races). */
export function addRacer(
  k: Kart,
  id: string,
  name: string,
  outfit: Outfit,
  gear: Gear,
  body: BodyId,
  color: number,
  display = "",
) {
  const cap = k.mode === "trial" ? 1 : GRID;
  if (humans(k).length >= cap)
    throw Error(cap === 1 ? "Time trial is for one driver" : "All eight kart spots are taken");
  if (k.phase === "countdown" || k.phase === "race")
    throw Error("A race is on. Join when it finishes.");
  const r = racer(id, name);
  r.outfit = outfit;
  r.gear = gear;
  r.body = body;
  r.color = clamp(Math.round(color), 0, PADDLES.length - 1);
  r.display = display;
  k.racers = humans(k);
  k.racers.push(r);
  say(k, `${name} joined`);
  return r;
}
export function setOptions(k: Kart, a: Record<string, unknown>) {
  if (typeof a.shared === "boolean") k.shared = a.shared;
  if (k.phase !== "lobby" && k.phase !== "results" && k.phase !== "podium") {
    k.event++;
    return;
  }
  if (a.bot === "rookie" || a.bot === "club" || a.bot === "pro") k.bot = a.bot;
  if (typeof a.items === "boolean" && k.mode !== "trial") k.items = a.items;
  if (typeof a.track === "string" && k.mode !== "cup" && CUP.includes(a.track as TrackId))
    k.track = a.track as TrackId;
  if (k.mode === "cup" && (a.cup === 0 || a.cup === 1)) {
    k.cup = a.cup;
    k.track = CUPS[k.cup].tracks[0];
  }
  k.event++;
}
/** Host: start the race (or the cup) once every phone that joined is set up. */
export function startKart(k: Kart, now = Date.now()) {
  if (k.phase === "countdown" || k.phase === "race") throw Error("Already racing");
  const h = humans(k);
  if (!h.length) throw Error("Scan the QR with a phone to join first");
  const notReady = h.filter((r) => !r.ready || !live(r, now));
  if (notReady.length)
    throw Error(`Waiting for ${notReady.map((r) => r.name).join(" & ")} to finish phone setup`);
  if (k.phase === "podium" || k.phase === "lobby") {
    k.cupRace = 0;
    for (const r of h) r.points = 0;
    if (k.mode === "cup") k.track = CUPS[k.cup].tracks[0];
  }
  // Bots fill the grid; their names and outfits stay the same through a cup.
  const bots = k.racers.filter((r) => r.bot);
  k.racers = h;
  if (k.mode !== "trial") {
    const outfits: Outfit[] = ["astro", "headband", "cap", "chef", "cowboy", "classic"];
    for (let i = 0; k.racers.length < GRID; i++) {
      const old = bots[i];
      const b = racer("bot-" + i, BOT_NAMES[(i + (k.seed & 7)) % BOT_NAMES.length]);
      b.bot = k.bot;
      b.outfit = outfits[i % outfits.length];
      b.body = (["classic", "paddle", "roller"] as BodyId[])[i % 3];
      b.color = (i + 1) % PADDLES.length;
      b.ready = true;
      if (old && k.phase === "results") {
        b.name = old.name;
        b.points = old.points;
      }
      k.racers.push(b);
    }
  }
  setupRace(k);
}
/** Grid, cubes and timers for the current track; humans start at the back. */
function setupRace(k: Kart) {
  const t = track(k.track);
  const order = [...k.racers.filter((r) => r.bot), ...k.racers.filter((r) => !r.bot)];
  // Leader of a cup so far starts at the back of the bots (a small handicap).
  order.forEach((r, i) => {
    const row = Math.floor(i / 2),
      col = i % 2 ? 1 : -1;
    const gridS = (t.S0 - 7 - row * 6.5 + t.L) % t.L;
    const p = pointAt(t, gridS, col * 2.8);
    const ph = freshPhys();
    const old = phys.get(r);
    if (old) ph.bot = old.bot;
    ph.hint = p.i;
    ph.m = p.h;
    ph.lastSeen = old?.lastSeen ?? Date.now();
    ph.live = old?.live ?? false;
    ph.ids = old?.ids ?? ph.ids;
    ph.safeS = gridS;
    if (r.bot) {
      const lv = LEVEL[r.bot];
      ph.bot = { level: r.bot, drift: lv.drift * (0.7 + rng(k) * 0.5), aggro: lv.aggro * (0.6 + rng(k) * 0.7), holdFor: 0, side: rng(k) * 2 - 1 };
    }
    phys.set(r, ph);
    Object.assign(r, {
      grid: i,
      x: p.x,
      y: p.y,
      z: p.z,
      h: p.h,
      yaw: 0,
      tilt: 0,
      v: 0,
      steer: 0,
      drift: 0,
      charge: 0,
      air: false,
      boost: 0,
      item: "",
      uses: 0,
      rolling: 0,
      spin: 0,
      wobble: 0,
      net: 0,
      guard: 0,
      sweet: 0,
      lift: 0,
      cannon: 0,
      lap: 0,
      sector: SECTORS - 1,
      s: gridS,
      d: col * 2.8,
      finished: 0,
      laps: [],
      best: 0,
      wrong: false,
      gained: 0,
      away: 0,
      botFor: false,
    });
    if (k.mode === "trial") {
      r.item = "tape";
      r.uses = 3;
    }
  });
  k.racers = order;
  for (const r of k.racers) r.progress = progressOf(t, r.lap, r.s, r.sector);
  rank(k);
  k.shots = [];
  shotState.set(k, []);
  k.cubes = [];
  if (k.items)
    for (const at of t.def.cubes) {
      const s = at * t.L;
      const w = pointAt(t, s).w;
      for (const f of [-0.6, -0.2, 0.2, 0.6]) k.cubes.push({ s, d: (f * w) / 2, up: true });
    }
  cubeTimers.set(k, k.cubes.map(() => 0));
  k.pins = t.def.pins ? Array(t.def.pins.n).fill(0) : [];
  k.callouts = [];
  k.paused = false;
  setPhase(k, "countdown");
  const name = t.def.name;
  say(k, k.mode === "cup" ? `Race ${k.cupRace + 1} of 4 · ${name}` : k.mode === "trial" ? `Time trial · ${name}` : name);
}
function setPhase(k: Kart, phase: Kart["phase"]) {
  k.phase = phase;
  k.phaseAt = k.time;
  k.event++;
}
/** Host: next race of the cup (after results), or race this track again. */
export function nextRace(k: Kart, now = Date.now()) {
  if (k.phase !== "results") throw Error("Finish the race first");
  if (k.mode === "cup") {
    if (k.cupRace >= CUPS[k.cup].tracks.length - 1) {
      setPhase(k, "podium");
      return;
    }
    k.cupRace++;
    k.track = CUPS[k.cup].tracks[k.cupRace];
  }
  const h = humans(k);
  const missing = h.filter((r) => !live(r, now));
  if (missing.length) throw Error(`Waiting for ${missing.map((r) => r.name).join(" & ")}'s phone`);
  setupRace(k);
}
/** Back to the lobby: pick another track or mode. */
export function toLobby(k: Kart) {
  k.racers = humans(k);
  k.shots = [];
  k.cubes = [];
  setPhase(k, "lobby");
  say(k, "Pick a track and start");
}
// ——————————————————————————— Inputs ———————————————————————————
/** Extra kart fields in a phone packet (validated here; the rest by admitInput). */
export function kartFieldsOk(a: Record<string, unknown>) {
  for (const k of ["hopId", "itemId", "flickId", "shakeId"])
    if (a[k] !== undefined && (!Number.isSafeInteger(a[k]) || (a[k] as number) < 0)) return false;
  for (const k of ["drift", "back", "assist"]) if (a[k] !== undefined && typeof a[k] !== "boolean") return false;
  for (const k of ["mx", "mz"]) if (a[k] === undefined) return false;
  return true;
}
/** Apply one validated phone packet (steering at ~40 Hz; button presses carry ids). */
export function kartInput(k: Kart, r: Racer, a: Input & Record<string, any>, now = Date.now()) {
  const p = P(r);
  p.lastSeen = now;
  p.live = a.sensors && a.calibrated;
  if (!r.connected) k.event++;
  r.connected = true;
  p.steerIn = clamp(a.mx ?? 0, -1, 1);
  p.throttle = clamp(a.mz ?? 0, -1, 1);
  p.driftHeld = !!a.drift;
  if (typeof a.assist === "boolean") p.assist = a.assist;
  const racing = k.phase === "race" && !k.paused && !r.finished;
  const fresh = (key: "hop" | "item" | "flick" | "shake", v: unknown) => {
    if (typeof v !== "number" || v <= p.ids[key]) return false;
    p.ids[key] = v;
    return true;
  };
  if (fresh("hop", a.hopId) && racing) hop(r);
  if (fresh("item", a.itemId) && racing) useItem(k, r, !!a.back, p.steerIn);
  if (fresh("flick", a.flickId) && racing) flick(k, r);
  if (fresh("shake", a.shakeId) && racing && r.net > 0) {
    r.net = Math.max(0, r.net - 0.75);
    if (!r.net) callout(k, r.id, "SHOOK FREE!", "good");
  }
}
/** A phone that rejoins (reload) starts its press counters again. */
export function resetIds(r: Racer) {
  P(r).ids = { hop: -1, item: -1, flick: -1, shake: -1 };
}
function hop(r: Racer) {
  const p = P(r);
  if (r.air || r.spin || r.lift || r.cannon) return;
  p.vy = 3.4;
  r.air = true;
  p.airFor = 0;
}
function flick(k: Kart, r: Racer) {
  const p = P(r);
  // Paddle Guard: a quick swing right after it batted something sends it back.
  if (p.batted && k.time <= p.batted.until) {
    const back = p.batted;
    p.batted = null;
    const from = k.racers.find((q) => q.id === back.owner);
    const dir = from && from.progress > r.progress ? 1 : -1;
    spawn(k, r, back.kind === "mball" ? "dink" : back.kind, dir > 0 ? 3 : -3, 0, { vs: dir * 34, target: back.owner });
    callout(k, r.id, "RETURNED!", "good");
    return;
  }
  // A flick while airborne off a ramp: a trick, paid out as a boost on landing.
  if (r.air && p.airFor > 0.12 && !p.trick && !r.spin) {
    p.trick = true;
    r.tricks++;
  }
}
// ——————————————————————————— Items ———————————————————————————
function spawn(
  k: Kart,
  r: Racer,
  kind: ItemKind | "mball",
  ahead: number,
  d: number,
  o: Partial<ShotS> = {},
) {
  const t = track(k.track);
  const list = shotState.get(k)!;
  const s = (((r.s + ahead) % t.L) + t.L) % t.L;
  const sh: ShotS = {
    id: shotIds++,
    kind,
    x: r.x,
    y: r.y + 0.6,
    z: r.z,
    h: r.h,
    owner: r.id,
    r: 0.25,
    s,
    d,
    vs: 0,
    vd: 0,
    vy: 0,
    life: 3,
    bounces: 0,
    hint: indexAt(t, s),
    target: "",
    hit: new Set([r.id]),
    next: 0,
    travelled: 0,
    ...o,
  };
  const pt = pointAt(t, s, sh.d);
  sh.x = pt.x;
  sh.z = pt.z;
  if (!o.y) sh.y = pt.y + 0.6;
  list.push(sh);
  return sh;
}
/** Use the held item. `back`: thrown behind (phone tilted toward you). `aim`: tilt at release. */
export function useItem(k: Kart, r: Racer, back: boolean, aim: number) {
  if (!r.item || r.rolling > 0 || r.lift || r.cannon || r.spin > 0.3) return false;
  const kind = r.item;
  const v = Math.max(8, r.v);
  r.uses--;
  if (r.uses <= 0) {
    r.item = "";
    r.uses = 0;
  }
  const t = track(k.track);
  switch (kind) {
    case "dink":
      if (back) spawn(k, r, "dink", -2.5, r.d, { vs: v - 13, vy: 6, life: 2.6, r: 0.35 });
      else spawn(k, r, "dink", 2.5, r.d, { vs: v + 15, vy: 7.5, life: 3, r: 0.35 });
      break;
    case "pinbowl":
      spawn(k, r, "pinbowl", back ? -2.5 : 2.5, r.d, { vs: back ? -14 : v + 12, life: 5, r: 0.5, y: 0 });
      break;
    case "strike":
      spawn(k, r, "strike", 4, r.d, { vs: v + 13, life: 10, r: 2.1, y: 0 });
      break;
    case "guard":
      r.guard = 12;
      break;
    case "serve":
      spawn(k, r, "serve", back ? -2 : 2.5, r.d, { vs: back ? -18 : v + 24, vd: clamp(aim, -1, 1) * 7, life: 2.2, r: 0.3 });
      break;
    case "fence":
      for (const f of [-1, 0, 1]) spawn(k, r, "fence", -4.5, r.d + f * 2.4, { life: 25, r: 0.45, y: 0 });
      break;
    case "tape":
      r.boost = Math.max(r.boost, 0.9);
      r.boosts++;
      break;
    case "sweet":
      r.sweet = 6;
      r.boost = Math.max(r.boost, 0.5);
      callout(k, r.id, "SWEET SPOT!", "good");
      break;
    case "net": {
      const ahead = k.racers
        .filter((q) => q !== r && q.progress > r.progress && q.progress - r.progress < 90 && !q.finished)
        .sort((a, b) => a.progress - b.progress)[0];
      spawn(k, r, "net", 2.5, r.d, { vs: v + 26, life: ahead ? 4 : 1.4, r: 0.8, target: ahead?.id ?? "" });
      break;
    }
    case "cannon": {
      const ahead = k.racers
        .filter((q) => q !== r && q.progress > r.progress && !q.finished)
        .sort((a, b) => a.progress - b.progress)[0];
      const to = ahead ? Math.min(ahead.progress - 9, r.progress + 220) : r.progress + 60;
      if (to <= r.progress + 5) {
        r.boost = Math.max(r.boost, 1.2);
        break;
      }
      const T = clamp((to - r.progress) / 75, 1, 3);
      P(r).cannon = { from: r.progress, to, T, t: 0 };
      r.cannon = T;
      r.air = true;
      callout(k, r.id, "COMEBACK CANNON!", "good");
      break;
    }
    case "wave":
      spawn(k, r, "wave", 1, 0, { vs: Math.max(v, 10) + 24, life: 3, r: t.w[P(r).hint] / 2, y: 0 });
      r.boost = Math.max(r.boost, 0.8);
      break;
    case "machine": {
      const w = t.w[P(r).hint];
      spawn(k, r, "machine", 3, (r.d > 0 ? -1 : 1) * (w / 2 + 1.2), { life: 6, r: 0.8, y: 0, next: 0.4 });
      break;
    }
  }
  k.event++;
  return true;
}
/** A kart is hit by an item. Returns false if it was shielded. */
export function hitKart(k: Kart, r: Racer, kind: ItemKind | "mball", owner: string) {
  if (r.lift || r.cannon || r.finished) return false;
  if (r.sweet > 0) return false;
  const p = P(r);
  const shieldable = kind !== "wave" && kind !== "strike";
  if (r.guard > 0 && shieldable) {
    r.guard = 0;
    p.batted = { kind, owner, until: k.time + 0.8 };
    callout(k, r.id, "BLOCKED!", "good");
    return false;
  }
  r.hits++;
  // Hit in the air (over a jump): the effect shows, but the kart keeps its speed so it still
  // reaches the other side of a gap.
  const keepSpeed = r.air;
  const v0 = r.v,
    vy0 = p.vy;
  r.drift = 0;
  r.charge = 0;
  if (kind === "net") {
    r.net = HIT.net;
    callout(k, r.id, "NETTED! SHAKE!", "bad");
  } else if (kind === "fence") {
    r.wobble = HIT.wobble;
    r.v *= 0.55;
  } else if (kind === "wave") {
    if (!r.air) {
      p.vy = 5.5;
      r.air = true;
      p.airFor = 0;
    }
    r.v *= 0.85;
  } else if (kind === "pinbowl" || kind === "strike") {
    r.spin = HIT.tumble;
    p.vy = 5;
    r.air = true;
    p.airFor = 0;
    r.v *= 0.4;
  } else {
    r.spin = kind === "serve" ? HIT.serve : kind === "mball" ? HIT.machine : HIT.spin;
    r.v *= 0.6;
  }
  if (keepSpeed) {
    r.v = v0;
    p.vy = Math.max(vy0, p.vy === 5 ? vy0 : p.vy);
  }
  return true;
}
function stepShots(k: Kart, t: Track) {
  const list = shotState.get(k)!;
  const keep: ShotS[] = [];
  for (const sh of list) {
    sh.life -= DT;
    if (sh.life <= 0) continue;
    const half = t.w[sh.hint] / 2;
    if (sh.kind === "machine") {
      // Fires a ball across the road every 0.6 s.
      sh.next -= DT;
      if (sh.next <= 0) {
        sh.next = 0.6;
        const ball = spawnAt(k, sh, "mball");
        ball.vd = (sh.d > 0 ? -1 : 1) * 13;
      }
      keep.push(sh);
      continue;
    }
    if (sh.kind === "fence") {
      if (!collideShot(k, t, sh, keep)) keep.push(sh);
      continue;
    }
    // Homing: nets (and returned items) steer toward their target.
    const tgt = sh.target ? k.racers.find((q) => q.id === sh.target) : undefined;
    if (tgt) {
      const ds = wrapS(t, tgt.s - sh.s);
      sh.vs = Math.sign(ds || 1) * Math.max(Math.abs(sh.vs), tgt.v + 18);
      sh.vd = clamp((tgt.d - sh.d) * 4, -14, 14);
    }
    if (sh.kind === "strike") {
      sh.vd = clamp(-sh.d * 1.5, -5, 5);
      // Rolls on through the leaders, then leaves the track.
      const leader = k.racers.find((q) => q.place === 1);
      if (leader && wrapS(t, sh.s - leader.s) > 25) sh.life = Math.min(sh.life, 0.3);
    }
    sh.s = (((sh.s + sh.vs * DT) % t.L) + t.L) % t.L;
    sh.travelled += Math.abs(sh.vs * DT);
    sh.d += sh.vd * DT;
    sh.hint = indexAt(t, sh.s);
    const ground = t.y[sh.hint];
    if (sh.kind === "mball") {
      if (Math.abs(sh.d) > half + 2) continue;
    } else if (Math.abs(sh.d) > half + 0.6) {
      sh.d = Math.sign(sh.d) * (half + 0.6);
      sh.vd = -sh.vd * 0.8;
      if (sh.kind === "pinbowl" || sh.kind === "net") sh.life = Math.min(sh.life, 1.2);
    }
    if (sh.kind === "dink") {
      sh.vy -= PHYS.gravity * 0.75 * DT;
      sh.y += sh.vy * DT;
      if (sh.y < ground + sh.r) {
        sh.y = ground + sh.r;
        sh.bounces++;
        if (sh.bounces > 2) continue;
        sh.vy = Math.abs(sh.vy) * 0.6;
        sh.vs *= 0.85;
      }
    } else if (sh.kind === "serve" || sh.kind === "mball" || sh.kind === "net") {
      sh.y = ground + (sh.kind === "net" ? 1.2 : 0.8);
    } else sh.y = (t.ground[sh.hint] ? ground : sh.y - 6 * DT) + sh.r;
    if (sh.kind === "wave") {
      sh.r = half + 1;
      if (sh.travelled > 90) continue;
    }
    const pt = pointAt(t, sh.s, sh.d);
    sh.x = pt.x;
    sh.z = pt.z;
    sh.h = pt.h + (sh.vs < 0 ? Math.PI : 0);
    if (collideShot(k, t, sh, keep)) continue;
    keep.push(sh);
  }
  // Balls a machine fired this step were appended to `list` and handled in the same loop.
  shotState.set(k, keep);
  k.shots = shotState.get(k)!.map((q) => ({ id: q.id, kind: q.kind, x: q.x, y: q.y, z: q.z, h: q.h, owner: q.owner, r: q.r }));
}
function spawnAt(k: Kart, from: ShotS, kind: ItemKind | "mball") {
  const t = track(k.track);
  const list = shotState.get(k)!;
  const sh: ShotS = { ...from, id: shotIds++, kind, r: 0.3, life: 3, vs: 0, vd: 0, vy: 0, hit: new Set([from.owner]), travelled: 0, next: 0 };
  sh.y = t.y[sh.hint] + 0.9;
  list.push(sh);
  return sh;
}
const wrapS = (t: Track, ds: number) => ((((ds + t.L / 2) % t.L) + t.L) % t.L) - t.L / 2;
/** Shot vs karts. Returns true when the shot is used up. */
function collideShot(k: Kart, t: Track, sh: ShotS, keep: ShotS[]) {
  for (const r of k.racers) {
    if (sh.hit.has(r.id) && !(sh.target === r.id)) continue;
    if (sh.target && sh.target !== r.id && sh.kind === "net") continue;
    const ds = wrapS(t, r.s - sh.s),
      dd = r.d - sh.d;
    if (sh.kind === "wave") {
      // The wave front sweeps over karts ahead of the thrower within range.
      if (ds < 0 && ds > -3 && Math.abs(r.y - t.y[sh.hint]) < 3) {
        sh.hit.add(r.id);
        hitKart(k, r, "wave", sh.owner);
      }
      continue;
    }
    if (Math.hypot(ds, dd) > sh.r + PHYS.radius || Math.abs(r.y + 0.5 - sh.y) > 1.6 + sh.r) continue;
    sh.hit.add(r.id);
    const landed = hitKart(k, r, sh.kind, sh.owner);
    if (sh.kind === "strike") continue; // rolls on through
    void keep;
    void landed;
    return true;
  }
  return false;
}
// ——————————————————————————— Driving ———————————————————————————
function botDrive(k: Kart, t: Track, r: Racer) {
  const p = P(r);
  const lv = LEVEL[p.bot.level] ?? LEVEL.club;
  const look = 7 + Math.max(0, r.v) * 0.42;
  const ahead = pointAt(t, r.s + look);
  const lineD = t.line[ahead.i] * lv.aim + p.bot.side * 1.2;
  const tp = pointAt(t, r.s + look, lineD);
  const want = Math.atan2(tp.z - r.z, tp.x - r.x);
  const diff = angle(want - r.h);
  let steer = clamp(diff * 2.4, -1, 1);
  // Drift through tighter corners (better bots drift more and longer).
  const bend = t.k[pointAt(t, r.s + look * 0.6).i];
  const tight = Math.abs(bend) > 0.022;
  if (r.drift) {
    p.bot.holdFor -= DT;
    const max = DRIFT_BOOST.length && driftLevel(r.charge) >= lv.maxLevel;
    if (p.bot.holdFor <= 0 || max || Math.abs(bend) < 0.008) p.driftHeld = false;
  } else if (tight && r.v > 15 && !r.air && rng(k) < p.bot.drift * DT * 4) {
    p.driftHeld = true;
    p.bot.holdFor = 1 + rng(k) * 1.6;
    hop(r);
  } else p.driftHeld = false;
  if (r.drift) steer = clamp(diff * 2.4 + r.drift * 0.25, -1, 1);
  p.steerIn = steer;
  p.throttle = 1;
  // Items: aggressive bots fire at the kart ahead; others wait for a moment.
  if (r.item && r.rolling <= 0 && !r.finished) {
    const near = k.racers.find((q) => q !== r && wrapS(t, q.s - r.s) > 4 && wrapS(t, q.s - r.s) < 30 && Math.abs(q.d - r.d) < 3);
    const behind = k.racers.find((q) => q !== r && wrapS(t, r.s - q.s) > 2 && wrapS(t, r.s - q.s) < 14);
    const kind = r.item;
    const chance = p.bot.aggro * DT * 2;
    if ((kind === "dink" || kind === "pinbowl" || kind === "serve") && near && rng(k) < chance * 3) useItem(k, r, false, 0);
    else if ((kind === "fence" || kind === "guard") && behind && rng(k) < chance) useItem(k, r, kind === "fence", 0);
    else if (["tape", "sweet", "cannon", "wave", "machine", "strike", "net"].includes(kind) && rng(k) < chance * 0.6) useItem(k, r, false, 0);
    else if (rng(k) < DT * 0.05) useItem(k, r, false, 0);
  }
}
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function respawn(k: Kart, t: Track, r: Racer) {
  const p = P(r);
  // Put the kart down past the gap it fell into (the drone carries it over).
  // Start from where it fell when that is over a gap (it never respawns short of a jump).
  let s = t.ground[indexAt(t, r.s)] ? p.safeS : r.s;
  let i = indexAt(t, s);
  for (let q = 0; q < 40 && !t.ground[i]; q++) {
    s += 1.5;
    i = indexAt(t, s);
  }
  for (let q = 0; q < 3; q++) {
    s += 1.5;
    i = indexAt(t, s);
  }
  const pt = pointAt(t, s, 0);
  Object.assign(r, { x: pt.x, z: pt.z, y: pt.y, h: pt.h, v: 0, drift: 0, charge: 0, air: false, spin: 0, net: 0, wobble: 0 });
  p.m = pt.h;
  p.vy = 0;
  p.hint = pt.i;
  p.onCut = false;
}
/** One kart for one 120 Hz step. */
function drive(k: Kart, t: Track, r: Racer, now: number) {
  const p = P(r);
  const body = bodyOf(r.body);
  // Who is driving: the phone, a bot, or nobody (phone away: coast to a stop and wait).
  // After the finish line a bot takes the wheel for the cool-down lap.
  const human = !r.bot && !r.botFor && !r.finished;
  if (!human) botDrive(k, t, r);
  else if (!live(r, now)) {
    // Phone away: brake gently to a stop and wait (never reverses).
    p.steerIn = 0;
    p.throttle = r.v > 0.3 ? -0.5 : 0;
    p.driftHeld = false;
  }
  if (r.finished && !human) {
    p.throttle = 0.6;
    p.driftHeld = false;
  }
  for (const key of ["boost", "spin", "wobble", "net", "guard", "sweet", "rolling"] as const)
    if (r[key] > 0) r[key] = Math.max(0, r[key] - DT);
  if (r.rolling === 0 && p.pending) {
    r.item = p.pending;
    r.uses = ITEMS[p.pending].uses;
    p.pending = "";
  }
  if (p.batted && k.time > p.batted.until) p.batted = null;
  // Drone lift after a fall, then back on the track.
  if (r.lift > 0) {
    r.lift = Math.max(0, r.lift - DT);
    if (r.lift === 0) respawn(k, t, r);
    return;
  }
  // Comeback Cannon: flying up the track, out of reach.
  if (p.cannon) {
    const c = p.cannon;
    c.t += DT;
    const u = Math.min(1, c.t / c.T);
    const e = u * u * (3 - 2 * u);
    const prog = c.from + (c.to - c.from) * e;
    const lapLen = t.L;
    const s = (((prog + t.S0) % lapLen) + lapLen) % lapLen;
    const pt = pointAt(t, s, 0);
    r.x = pt.x;
    r.z = pt.z;
    r.y = pt.y + 6 * Math.sin(Math.PI * u) + 0.2;
    r.h = pt.h;
    p.m = pt.h;
    p.hint = pt.i;
    r.cannon = Math.max(0, c.T - c.t);
    r.v = 24;
    // The flight passes every sector on the way, so laps keep counting.
    r.s = s;
    r.d = 0;
    passSector(r, sectorOf(t, s));
    r.progress = progressOf(t, r.lap, r.s, r.sector);
    if (u >= 1) {
      p.cannon = null;
      r.cannon = 0;
      r.air = false;
      r.y = pt.y;
      r.boost = Math.max(r.boost, 0.8);
    }
    return;
  }
  // Steering: the latest phone value, smoothed a little here too.
  p.steer += (1 - Math.exp(-DT / 0.07)) * (p.steerIn - p.steer);
  let steer = p.steer;
  let throttle = k.phase === "race" ? p.throttle : 0;
  if (p.stall > 0) {
    p.stall -= DT;
    throttle = 0;
  }
  const spinning = r.spin > 0;
  if (spinning) {
    steer = 0;
    throttle = 0;
  }
  // Steering assist (on by default; a phone setting): near the road edges a light pull back
  // toward the middle. It is small and fades out away from the edge, so a driver steering away
  // from the edge always wins.
  if (!r.bot && !r.botFor && p.assist && !spinning && !r.drift && !r.air && r.v > 4 && !p.onCut) {
    const i = p.hint,
      half = t.w[i] / 2;
    const edge = clamp((Math.abs(r.d) - (half - 2.2)) / 2.2, 0, 1);
    if (edge > 0) {
      const want = Math.atan2(t.tz[i], t.tx[i]) - Math.sign(r.d) * 0.22;
      steer = clamp(steer + clamp(angle(want - r.h) * 1.5, -0.35, 0.35) * edge, -1, 1);
    }
  }
  p.wallT = Math.max(0, p.wallT - DT);
  if (r.wobble > 0) steer *= 0.5;
  // Top speed: body, bot level, boosts, surfaces.
  let vmax = PHYS.vmax * body.speed;
  if (r.bot || r.botFor) {
    vmax *= (LEVEL[p.bot.level] ?? LEVEL.club).speed;
    // Mild catch-up for bots only: never more than a few percent.
    const best = Math.max(...k.racers.filter((q) => !q.bot).map((q) => q.progress), -1e9);
    if (best > -1e8) {
      if (r.progress > best + 70) vmax *= 0.95;
      else if (r.progress < best - 90) vmax *= 1.04;
    }
  }
  if (r.sweet > 0) vmax *= 1.08;
  const lap = locateOn(t, r, p);
  const surface = surfaceAt(t, r, lap.half, lap.d);
  if (surface === "off" && r.boost <= 0 && r.sweet <= 0 && !r.air) vmax *= t.def.offroad ?? PHYS.offroad;
  if (r.boost > 0) vmax *= PHYS.boost;
  if (r.net > 0) vmax *= 0.45;
  if (r.wobble > 0) vmax *= 0.7;
  // Speed.
  if (!r.air) {
    if (throttle > 0.05) {
      const a = PHYS.accel * body.accel * (r.boost > 0 ? 2.2 : 1) * throttle;
      if (r.v < vmax) r.v = Math.min(vmax, r.v + a * Math.max(0.15, 1 - r.v / vmax) * DT * 1.6);
      else r.v = Math.max(vmax, r.v - 14 * DT);
    } else if (throttle < -0.05) {
      if (r.v > 0) r.v = Math.max(-0.01, r.v - PHYS.brake * -throttle * DT);
      else r.v = Math.max(-PHYS.reverse, r.v - 8 * -throttle * DT);
    } else r.v -= Math.sign(r.v) * Math.min(Math.abs(r.v), (4 + Math.abs(r.v) * 0.12) * DT);
    if (r.v > vmax) r.v = Math.max(vmax, r.v - 10 * DT);
  }
  // A spin-out slows the kart on the ground only (mid-jump it keeps flying, so it can't fall short).
  if (spinning && !r.air) r.v *= Math.exp(-2.2 * DT);
  r.v = clamp(r.v, -PHYS.reverse, PHYS.vmax * 1.6);
  // Drift: hold the button while steering; charge builds while you lean into it.
  if (r.drift) {
    if (!p.driftHeld || r.v < 7 || spinning) {
      const lvl = driftLevel(r.charge);
      if (lvl && !spinning) {
        r.boost = Math.max(r.boost, DRIFT_BOOST[lvl - 1]);
        r.boosts++;
        if (lvl >= 2 && !r.bot) callout(k, r.id, lvl === 3 ? "MEGA DRIFT BOOST!" : "DRIFT BOOST!", "good");
      }
      r.drift = 0;
      r.charge = 0;
    } else if (!r.air) {
      const into = steer * r.drift;
      r.charge += DT * (0.55 + 0.65 * Math.max(0, into)) * (surface === "off" ? 0.4 : 1);
    }
  } else if (p.driftHeld && !r.air && Math.abs(steer) > 0.3 && r.v > 9 && !spinning) {
    r.drift = Math.sign(steer);
    r.charge = 0;
  }
  // Turning.
  const speedK = clamp(Math.abs(r.v) / 5, 0, 1) * (r.v < 0 ? -1 : 1);
  let yawRate: number;
  // Drifting: always turning into the drift; steering into it tightens the arc, counter-steering
  // widens it to a gentle arc (about 80 m radius at full speed).
  if (r.drift) yawRate = r.drift * (0.12 + 0.75 * ((steer * r.drift + 1) / 2)) * PHYS.turn * body.handling;
  else yawRate = steer * PHYS.turn * body.handling * speedK * (r.air ? 0.4 : 1);
  if (!spinning) r.h = angle(r.h + yawRate * DT);
  // Travel direction follows the nose; drifting slides more.
  // Ice and dirt grip less: the kart slides wider and drifts more.
  const tg = t.def.grip ?? 1;
  const grip = r.drift ? PHYS.driftGrip * (0.6 + 0.4 * tg) : r.air ? 0.8 : PHYS.grip * tg;
  p.m = angle(p.m + angle(r.h - p.m) * (1 - Math.exp(-grip * DT)));
  // In the air, the kart follows the road's curve (jumps on a bend land on the road).
  if (r.air && !p.onCut && t.ground[p.hint]) {
    const turn = t.k[p.hint] * Math.abs(r.v) * DT;
    p.m = angle(p.m + turn);
    r.h = angle(r.h + turn);
  }
  r.x += Math.cos(p.m) * r.v * DT;
  r.z += Math.sin(p.m) * r.v * DT;
  // Visual yaw: drift slip and spin-outs.
  if (spinning) r.yaw = angle(r.yaw + 12 * DT);
  else r.yaw += (r.drift * 0.42 - r.yaw) * (1 - Math.exp(-8 * DT)) + (Math.abs(r.yaw) > 3 ? -r.yaw : 0);
  r.tilt += ((r.drift ? -r.drift * 0.08 : steer * 0.05) - r.tilt) * (1 - Math.exp(-6 * DT));
  r.steer = steer;
  // Where are we now? Track position, surface, walls, ground.
  const at = locateOn(t, r, p);
  handleWalls(t, r, p, at);
  ground(k, t, r, p, at);
  // Boost pads.
  if (!r.air)
    for (const pad of t.def.pads) {
      const ps = pad.at * t.L;
      const ds = wrapS(t, r.s - ps),
        pd = (pad.d * t.w[indexAt(t, ps)]) / 2;
      if (ds > -2 && ds < 2.5 && Math.abs(r.d - pd) < 1.9) {
        const b = r.sweet > 0 ? 2.2 : 1.1;
        if (r.boost < b - 0.05) r.boosts++;
        r.boost = Math.max(r.boost, b);
      }
    }
  // Lap sectors, laps and lap times.
  const sec = sectorOf(t, r.s);
  const lapBefore = r.lap;
  passSector(r, sec);
  if (r.lap > lapBefore && k.phase === "race") {
    if (r.lap > 1) {
      const lt = k.clock - p.lapStart;
      r.laps.push(Math.round(lt * 1000) / 1000);
      if (!r.best || lt < r.best) r.best = Math.round(lt * 1000) / 1000;
    }
    p.lapStart = k.clock;
    if (r.lap === k.laps && !r.bot) callout(k, r.id, "FINAL LAP!", "lap");
    if (r.lap > k.laps && !r.finished) {
      r.finished = Math.max(0.001, Math.round(k.clock * 1000) / 1000);
      if (!r.bot) callout(k, r.id, "FINISH!", "finish");
    }
  }
  r.progress = progressOf(t, r.lap, r.s, r.sector);
  // Wrong way.
  const ti = at.i;
  const dot = Math.cos(p.m) * t.tx[ti] + Math.sin(p.m) * t.tz[ti];
  if (dot < -0.25 && r.v > 4 && !r.air) p.wrongFor += DT;
  else p.wrongFor = Math.max(0, p.wrongFor - DT * 2);
  r.wrong = p.wrongFor > 1.2;
  if (!r.air && t.ground[ti] && !p.onCut && Math.abs(r.d) < t.w[ti] / 2) p.safeS = r.s;
}
/** Track position (on the shortcut strip when on it). */
function locateOn(t: Track, r: Racer, p: Phys) {
  const c = t.cut;
  if (c && p.onCut) {
    const o = onCut(c, r.x, r.z);
    if (o.u >= 1 || o.u <= 0) {
      p.onCut = false;
      p.hint = o.u >= 1 ? c.to : c.from;
    } else {
      const span = (c.s1 - c.s0 + t.L) % t.L;
      r.s = (c.s0 + span * o.u) % t.L;
      r.d = o.d;
      return { i: indexAt(t, r.s), d: o.d, half: c.width / 2, y: c.y[0] + (c.y[c.y.length - 1] - c.y[0]) * o.u, cut: true, u: o.u, ground: true };
    }
  }
  const w = locate(t, r.x, r.z, r.y, p.hint);
  p.hint = w.i;
  r.s = w.s;
  r.d = w.d;
  const half = t.w[w.i] / 2;
  // Onto the shortcut strip from the road's edge near either end.
  if (c && Math.abs(w.d) > half - 0.5) {
    const o = onCut(c, r.x, r.z);
    if (o.dist < c.width / 2 && o.u > 0.01 && o.u < 0.99) {
      p.onCut = true;
      return locateOn(t, r, p);
    }
  }
  const j = (w.i + 1) % t.n;
  return { i: w.i, d: w.d, half, y: w.y, cut: false, u: 0, ground: !!(t.ground[w.i] && t.ground[j]) };
}
function surfaceAt(t: Track, r: Racer, half: number, d: number) {
  const p = P(r);
  if (p.onCut) return "off";
  return Math.abs(d) > half ? "off" : "road";
}
function handleWalls(t: Track, r: Racer, p: Phys, at: ReturnType<typeof locateOn>) {
  let limit: number, nx: number, nz: number;
  if (at.cut) {
    const c = t.cut!;
    // The strip is open at its ends (onto the road), walled along its sides.
    if (at.u < 0.06 || at.u > 0.94) return;
    limit = c.width / 2 + 0.6;
    const o = onCut(c, r.x, r.z);
    void o;
    // Strip normal from its direction near u.
    const q = Math.min(c.x.length - 2, Math.floor(at.u * (c.x.length - 1)));
    const ex = c.x[q + 1] - c.x[q],
      ez = c.z[q + 1] - c.z[q],
      l = Math.hypot(ex, ez) || 1;
    nx = -ez / l;
    nz = ex / l;
  } else {
    limit = at.half + t.def.verge;
    nx = -t.tz[at.i];
    nz = t.tx[at.i];
  }
  const d = at.d;
  if (Math.abs(d) <= limit) return;
  const side = Math.sign(d);
  // Push back inside and bounce off the barrier.
  const over = Math.abs(d) - limit;
  r.x -= nx * side * over;
  r.z -= nz * side * over;
  let vx = Math.cos(p.m) * r.v,
    vz = Math.sin(p.m) * r.v;
  const vn = vx * nx * side + vz * nz * side;
  if (vn > 0) {
    // Soft barrier: the push into the wall becomes a small bounce, the speed along the wall is
    // kept, and the kart turns to slide along it. Speed is lost once per contact (not every
    // tick), and never more than ~40 %, so a kart can't stop dead or grind to a halt on a wall.
    const fresh = p.wallT <= 0;
    p.wallT = 0.3;
    if (fresh) p.walls++;
    const speed = Math.abs(r.v);
    vx -= 1.15 * vn * nx * side;
    vz -= 1.15 * vn * nz * side;
    const along = Math.hypot(vx, vz);
    // Slide direction: along the wall, the way the kart was already going.
    const tx = -nz * side,
      tz = nx * side;
    const dir = vx * tx + vz * tz >= 0 ? 1 : -1;
    p.m = along > 0.5 ? Math.atan2(vz, vx) : Math.atan2(tz * dir, tx * dir);
    const keep = fresh ? (vn > 8 ? 0.72 : 0.88) : 1;
    r.v = Math.sign(r.v || 1) * Math.max(along, speed * 0.6) * keep;
    if (r.v > 0) r.h = angle(r.h + angle(p.m - r.h) * 0.6);
    if (vn > 8) {
      r.drift = 0;
      r.charge = 0;
    }
  }
  r.d = side * limit;
}
function ground(k: Kart, t: Track, r: Racer, p: Phys, at: ReturnType<typeof locateOn>) {
  const gy = at.ground ? at.y : -60;
  p.vy -= PHYS.gravity * DT;
  const ny = r.y + p.vy * DT;
  if (!r.air) {
    // Stay on the road over gentle slopes; a lip or a drop launches the kart.
    if (at.ground && gy >= ny - 0.06) {
      p.vy = clamp((gy - r.y) / DT, -8, 8);
      r.y = gy;
    } else {
      r.air = true;
      p.airFor = 0;
      r.y = ny;
      // Leaving a ramp lip with a gap ahead (river, canyon, pier, rooftops): a slowed kart
      // still gets enough speed and lift to clear it, so a hit before a jump isn't a fall.
      // (Also a kart creeping off the lip: it is already over the gap when it leaves the road.)
      if (!p.onCut) {
        let gapAhead = !t.ground[at.i];
        for (let q = 1; q < 16 && !gapAhead; q++) gapAhead = !t.ground[(at.i + q) % t.n];
        if (gapAhead && r.v >= 0) {
          r.v = Math.max(r.v, 19);
          p.vy = Math.max(p.vy, 4.5);
        }
      }
    }
  } else {
    p.airFor += DT;
    r.y = ny;
    if (at.ground && r.y <= gy) {
      r.y = gy;
      p.vy = 0;
      r.air = false;
      if (p.trick) {
        p.trick = false;
        r.boost = Math.max(r.boost, 0.7);
        r.boosts++;
        if (!r.bot) callout(k, r.id, "NICE TRICK!", "good");
      }
      // Holding drift on landing starts a drift (hop-drift).
      if (p.driftHeld && Math.abs(p.steer) > 0.3 && r.v > 9 && !r.drift) r.drift = Math.sign(p.steer);
      if (r.spin > 0 && p.tumbleHop) p.tumbleHop = false;
    }
  }
  // Fell into a gap: the drone comes.
  if (r.y < Math.min(at.y, t.y[at.i]) - 5) {
    r.lift = 1.5;
    r.air = false;
    r.v = 0;
    p.trick = false;
    callout(k, r.id, "DRONE PICKUP", "bad");
  }
}
/** Karts bump each other: heavier ones push lighter ones further. */
function bumps(k: Kart) {
  const rs = k.racers.filter((r) => !r.lift && !r.cannon);
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i],
        b = rs[j];
      if (Math.abs(a.y - b.y) > 1.5) continue;
      const dx = b.x - a.x,
        dz = b.z - a.z,
        dist = Math.hypot(dx, dz);
      const min = PHYS.radius * 2;
      if (dist >= min || dist < 1e-6) continue;
      const wa = bodyOf(a.body).weight * (a.sweet > 0 ? 4 : 1),
        wb = bodyOf(b.body).weight * (b.sweet > 0 ? 4 : 1);
      const over = min - dist,
        nx = dx / dist,
        nz = dz / dist;
      const ka = wb / (wa + wb),
        kb = wa / (wa + wb);
      a.x -= nx * over * ka;
      a.z -= nz * over * ka;
      b.x += nx * over * kb;
      b.z += nz * over * kb;
      // Closing speed along the contact: the kart running into the other loses a little
      // speed (more if it is the lighter one). Nobody gains speed from a bump.
      const va = (Math.cos(P(a).m) * nx + Math.sin(P(a).m) * nz) * a.v;
      const vb = (Math.cos(P(b).m) * nx + Math.sin(P(b).m) * nz) * b.v;
      const closing = va - vb;
      if (closing > 0) {
        const loss = Math.min(0.25, closing * 0.03);
        if (va > 0) a.v *= 1 - loss * ka * 2;
        if (vb < 0) b.v *= 1 - loss * kb * 2;
      }
    }
}
/** Places by finish time, then race distance. Position changes pop on the TV for humans. */
function rank(k: Kart) {
  placings(k.racers).forEach((r, i) => (r.place = i + 1));
}
const popTimer = new WeakMap<Racer, { place: number; since: number; said: number }>();
function placePops(k: Kart) {
  for (const r of k.racers) {
    if (r.bot || r.finished || k.phase !== "race") continue;
    let s = popTimer.get(r);
    if (!s) popTimer.set(r, (s = { place: r.place, since: k.time, said: r.place }));
    if (r.place !== s.place) {
      s.place = r.place;
      s.since = k.time;
    }
    if (s.place !== s.said && k.time - s.since > 0.8) {
      if (s.place < s.said) callout(k, r.id, "UP TO " + ordinal(s.place).toUpperCase() + "!", "up");
      s.said = s.place;
    }
  }
}
/** Item cubes: drive through one to start the roulette. */
function cubes(k: Kart, t: Track) {
  const timers = cubeTimers.get(k);
  if (!timers) return;
  k.cubes.forEach((c, ci) => {
    if (!c.up) {
      if (k.time >= timers[ci]) {
        c.up = true;
        k.event++;
      }
      return;
    }
    for (const r of k.racers) {
      if (r.lift || r.cannon || r.finished) continue;
      if (Math.abs(wrapS(t, r.s - c.s)) < 1.6 && Math.abs(r.d - c.d) < 1.8 && Math.abs(r.y - t.y[indexAt(t, c.s)]) < 2.2) {
        c.up = false;
        timers[ci] = k.time + 3;
        if (!r.item && r.rolling <= 0) {
          r.rolling = 1.2;
          P(r).pending = rollItem(r.place, k.racers.length, rng(k));
        }
        k.event++;
        break;
      }
    }
  });
}
/** Neon Lanes: giant pins slide across the bowling lane section. */
function movingPins(k: Kart, t: Track) {
  const pin = t.def.pins;
  if (!pin) return;
  const s0 = pin.at * t.L;
  for (let n = 0; n < pin.n; n++) {
    const s = s0 + ((n + 0.5) * pin.len) / pin.n;
    const half = t.w[indexAt(t, s)] / 2 - 1.6;
    const d = Math.sin(k.time * 0.9 + n * 1.9) * half;
    k.pins[n] = Math.round(d * 100) / 100;
    for (const r of k.racers) {
      if (r.lift || r.cannon || r.air || r.sweet > 0) continue;
      if (Math.abs(wrapS(t, r.s - s)) < 1.7 && Math.abs(r.d - d) < 1.7) {
        if (r.wobble <= 0) {
          r.wobble = HIT.wobble;
          r.v *= 0.5;
          r.hits++;
        }
        // Push off the pin.
        const side = Math.sign(r.d - d) || 1;
        const pt = pointAt(t, r.s, d + side * 1.75);
        r.x = pt.x;
        r.z = pt.z;
      }
    }
  }
}
/** Fixed-step update (120 Hz). */
export function stepKart(k: Kart, dt = DT, now = Date.now()) {
  if (k.paused || k.phase === "lobby" || k.phase === "podium") return;
  void dt;
  k.time += DT;
  const t = track(k.track);
  if (k.phase === "results") return;
  if (k.phase === "countdown") {
    k.clock = k.time - k.phaseAt - COUNTDOWN;
    for (const r of k.racers) {
      if (r.bot) continue;
      // Start boost: gas pressed in the last 0.7 s before GO; earlier than 1.6 s stalls.
      const p = P(r),
        gas = p.throttle > 0.5;
      if (gas && k.clock < -1.6) p.early = true;
      if (gas && k.clock >= -0.7) p.good = true;
    }
    if (k.clock >= 0) {
      setPhase(k, "race");
      k.phaseAt = k.time;
      for (const r of k.racers) {
        const p = P(r);
        p.lapStart = 0;
        if (r.bot) p.good = rng(k) < { rookie: 0.2, club: 0.5, pro: 0.8 }[r.bot];
        if (p.early) {
          p.stall = 0.7;
          if (!r.bot) callout(k, r.id, "TOO EARLY!", "bad");
        } else if (p.good) {
          r.boost = 1.2;
          r.boosts++;
          if (!r.bot) callout(k, r.id, "START BOOST!", "good");
        }
      }
      say(k, "GO!");
    }
    return;
  }
  // Racing.
  k.clock = k.time - k.phaseAt;
  for (const r of k.racers) {
    const p = P(r);
    // A phone that went away: its kart waits; after WAIT_LIMIT a bot drives it.
    if (!r.bot) {
      const ok = live(r, now);
      if (!ok && !r.finished) {
        if (!r.away) {
          r.away = now;
          say(k, `Waiting for ${r.name}'s phone…`);
        } else if (!r.botFor && now - r.away > WAIT_LIMIT * 1000) {
          r.botFor = true;
          p.bot = { level: "club", drift: 0.5, aggro: 0.4, holdFor: 0, side: 0 };
          say(k, `A bot drives for ${r.name} until their phone is back`);
        }
      } else if (ok && (r.away || r.botFor)) {
        r.away = 0;
        if (r.botFor) say(k, `${r.name} takes the wheel again`);
        else say(k, `${r.name} is back`);
        r.botFor = false;
        p.driftHeld = false;
      }
    }
    drive(k, t, r, now);
  }
  bumps(k);
  stepShots(k, t);
  cubes(k, t);
  movingPins(k, t);
  rank(k);
  placePops(k);
  // Race end: when every human has finished, or 30 s after the first finisher.
  const first = k.racers.filter((r) => r.finished).map((r) => r.finished);
  const allHumans = humans(k).every((r) => r.finished);
  if ((allHumans && humans(k).length) || (first.length && k.clock > Math.min(...first) + 30)) finishRace(k, t);
}
function finishRace(k: Kart, t: Track) {
  for (const r of k.racers)
    if (!r.finished) {
      // Projected finish: the distance left at a typical race pace.
      const left = k.laps * t.L - r.progress;
      r.finished = Math.round((k.clock + Math.max(0, left) / 19) * 1000) / 1000;
    }
  rank(k);
  if (k.mode !== "trial")
    for (const r of k.racers) {
      r.gained = POINTS[r.place - 1] ?? 0;
      r.points += r.gained;
    }
  setPhase(k, "results");
  const win = k.racers.find((r) => r.place === 1)!;
  say(k, k.mode === "trial" ? `Best lap ${win.best.toFixed(2)} s` : `${win.name} wins!`);
}
/** Host: skip waiting and let a bot drive for a missing phone now. */
export function botForNow(k: Kart, id: string) {
  const r = k.racers.find((q) => q.id === id && !q.bot);
  if (!r || !r.away) throw Error("That phone isn't away");
  r.botFor = true;
  P(r).bot = { level: "club", drift: 0.5, aggro: 0.4, holdFor: 0, side: 0 };
  say(k, `A bot drives for ${r.name}`);
}
/** Test hook: server-only state of a kart. */
export const physOf = (r: Racer) => P(r);
/** Snapshot for screens and phones, rounded to keep it small (cached per step). */
const viewCache = new WeakMap<Kart, { time: number; event: number; v: unknown }>();
export function kartView(k: Kart) {
  const c = viewCache.get(k);
  if (c && c.time === k.time && c.event === k.event) return c.v;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const v = {
    ...k,
    racers: k.racers.map((r) => ({
      ...r,
      x: r2(r.x),
      y: r2(r.y),
      z: r2(r.z),
      h: Math.round(r.h * 1000) / 1000,
      yaw: r2(r.yaw),
      tilt: r2(r.tilt),
      v: r2(r.v),
      steer: r2(r.steer),
      charge: r2(r.charge),
      boost: r2(r.boost),
      s: r2(r.s),
      d: r2(r.d),
      progress: r2(r.progress),
      rolling: r2(r.rolling),
      spin: r2(r.spin),
      wobble: r2(r.wobble),
      net: r2(r.net),
      guard: r2(r.guard),
      sweet: r2(r.sweet),
      lift: r2(r.lift),
      cannon: r2(r.cannon),
    })),
    shots: k.shots.map((q) => ({ ...q, x: r2(q.x), y: r2(q.y), z: r2(q.z), h: r2(q.h) })),
    time: r2(k.time),
    clock: r2(k.clock),
  };
  viewCache.set(k, { time: k.time, event: k.event, v });
  return v;
}
/** Housekeeping (30 Hz): a phone silent for 2.5 s counts as away. */
export function kartAway(k: Kart, now = Date.now()) {
  for (const r of k.racers)
    if (!r.bot && r.connected && now - P(r).lastSeen > 2500) {
      r.connected = false;
      k.event++;
    }
}
/** The phone left the page (locked screen, switched apps). */
export function kartBackground(k: Kart, r: Racer) {
  r.connected = false;
  P(r).lastSeen = 0;
  k.event++;
}
/** Is the phone set up and sending live sensor data? */
export function kartLive(r: Racer, now = Date.now()) {
  const p = P(r);
  return r.connected && now - p.lastSeen < 2000 && p.live;
}
