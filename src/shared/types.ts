export type Mode = "practice" | "solo" | "singles" | "coop" | "doubles";
export type Difficulty = "easy" | "medium" | "hard";
/** Swing reload (owner request): a player can swing again this many seconds after the last swing. */
export const SWING_RELOAD = 0.2;
export type MoveStyle = "auto" | "keys" | "phone";
export const MOVE_STYLES: MoveStyle[] = ["auto", "keys", "phone"];
/** Courts to play on (owner request). "arena" is the original indoor arena. */
export type MapId =
  | "arena"
  | "tokyo"
  | "manila"
  | "sf"
  | "centralpark"
  | "nyc"
  | "berkeley"
  | "haas"
  | "ucla"
  | "usc";
export const MAPS: { id: MapId; name: string; short: string; note: string }[] =
  [
    {
      id: "arena",
      name: "Arena",
      short: "Arena",
      note: "Indoor, packed stands",
    },
    {
      id: "tokyo",
      name: "Tokyo",
      short: "Tokyo",
      note: "Neon streets at night",
    },
    {
      id: "manila",
      name: "Manila rooftop",
      short: "Manila",
      note: "Sunset over the bay",
    },
    {
      id: "sf",
      name: "San Francisco rooftop",
      short: "San Francisco",
      note: "Bridge in the fog",
    },
    {
      id: "centralpark",
      name: "Central Park, New York",
      short: "Central Park",
      note: "Grass, trees, skyline",
    },
    {
      id: "nyc",
      name: "New York rooftop",
      short: "NYC night",
      note: "Skyscraper roof at night",
    },
    {
      id: "berkeley",
      name: "UC Berkeley campus",
      short: "Berkeley",
      note: "Blue and gold, clock tower",
    },
    {
      id: "haas",
      name: "Fancy",
      short: "Fancy",
      note: "Shingle-style courtyard in the hills",
    },
    {
      id: "ucla",
      name: "UCLA campus",
      short: "UCLA",
      note: "Brick towers, palm trees",
    },
    {
      id: "usc",
      name: "USC campus",
      short: "USC",
      note: "Cardinal and gold, brick arches",
    },
  ];
/** Character outfits (owner request). Team colour still shows which side you're on. */
export type Outfit =
  | "classic"
  | "cap"
  | "headband"
  | "chef"
  | "astro"
  | "cowboy";
export const OUTFITS: { id: Outfit; name: string }[] = [
  { id: "classic", name: "Classic jersey" },
  { id: "cap", name: "Ball cap" },
  { id: "headband", name: "Sweatband" },
  { id: "chef", name: "Chef" },
  { id: "astro", name: "Astronaut" },
  { id: "cowboy", name: "Cowboy" },
];
/** Serve types a player picks on the phone (owner request). */
export type ServeStyle = "drive" | "roll" | "slice";
export const SERVE_STYLES: ServeStyle[] = ["drive", "roll", "slice"];
/** Custom gear chosen on the phone before playing (owner request). Cosmetic only. */
export type Gear = { paddle: number; shoes: number; eyes: number };
export const PADDLES = [
  { name: "Graphite", color: [0.16, 0.17, 0.2] },
  { name: "Lime", color: [0.62, 0.86, 0.2] },
  { name: "Hot pink", color: [0.95, 0.3, 0.62] },
  { name: "Sky blue", color: [0.32, 0.7, 0.98] },
  { name: "Sunset orange", color: [0.98, 0.52, 0.16] },
  { name: "Gold", color: [0.95, 0.76, 0.2] },
  { name: "Purple", color: [0.55, 0.36, 0.9] },
  { name: "White", color: [0.95, 0.95, 0.93] },
] as const;
export const SHOES = [
  { name: "White", color: [0.94, 0.94, 0.92] },
  { name: "Black", color: [0.1, 0.1, 0.12] },
  { name: "Neon green", color: [0.4, 0.95, 0.3] },
  { name: "Red", color: [0.9, 0.18, 0.2] },
  { name: "Teal", color: [0.15, 0.75, 0.72] },
  { name: "Yellow", color: [0.98, 0.85, 0.2] },
] as const;
export const EYEWEAR = [
  "Classic shades",
  "Mirror shades",
  "Sport goggles",
] as const;
export const DEFAULT_GEAR: Gear = { paddle: 0, shoes: 0, eyes: 0 };
/** Clamp a client-supplied gear choice to valid indexes. */
export function cleanGear(g: unknown): Gear {
  const o = (g ?? {}) as Record<string, unknown>;
  const pick = (v: unknown, n: number) =>
    Number.isInteger(v) && (v as number) >= 0 && (v as number) < n
      ? (v as number)
      : 0;
  return {
    paddle: pick(o.paddle, PADDLES.length),
    shoes: pick(o.shoes, SHOES.length),
    eyes: pick(o.eyes, EYEWEAR.length),
  };
}
export type RankedQueue = "1v1" | "2v2";
export type Ranked = {
  queue: RankedQueue;
  /**
   * lobby: a household's own ranked lobby (pair phones, then search)
   * searching: waiting in the matchmaking queue · matched: moving to the match
   * match: the ranked match itself
   */
  stage: "lobby" | "searching" | "matched" | "match";
  /** When searching started (epoch ms) and how wide the rating search is right now. */
  since: number;
  window: number;
  /** Final rating changes, filled in when a ranked match ends. */
  results: { name: string; team: number; before: number; after: number }[];
};
/** Starting rating for new players; Elo-style changes of up to 32 per match. */
export const START_RR = 1000;
export type Vec = { x: number; y: number; z: number };
export type Input = {
  seq: number;
  t: number;
  pitch: number;
  roll: number;
  yaw: number;
  strength: number;
  direction: number;
  swing: boolean;
  sensors: boolean;
  calibrated: boolean;
  /** Identifies one swing; repeated in a few packets so a late packet cannot lose it. */
  swingId?: number;
  /** Sideways swing direction, player frame: +1 toward their right, -1 toward their left. */
  side?: number;
  /** Serve type chosen on the phone: 0 drive, 1 roll (topspin), 2 slice (curves back in). */
  sv?: number;
  /** Movement style chosen on the phone: 0 automatic, 1 keyboard on the display, 2 phone thumb pad. */
  ctl?: number;
  /** Thumb-pad movement, player-relative: mx = right(+)/left(-), mz = forward toward the net (+). */
  mx?: number;
  mz?: number;
};
export type Player = {
  id: string;
  name: string;
  team: number;
  bot: boolean;
  connected: boolean;
  ready: boolean;
  hand: "left" | "right";
  pos: Vec;
  velocity: Vec;
  input: Input;
  lastHit: number;
  swingUntil: number;
  swingAt: number;
  swingInput: Input;
  /** Best contact quality seen so far in the current swing window. */
  swingBest: number;
  lastSeen: number;
  volleyMomentum: boolean;
  /** Sim time when the player's feet were last confirmed outside the NVZ after being inside it. */
  kitchenClearAt: number;
  /** Sim time of the volley that started the current momentum window. */
  momentumAt: number;
  reactionAt: number;
  target: Vec;
  /** Keyboard movement intent from this player's display (-1..1, screen-relative). */
  moveX: number;
  moveZ: number;
  /** Sim time until which the last movement message is honoured (keys held = refreshed). */
  moveUntil: number;
  /** True once the player has used keyboard movement this match; auto-positioning then stops. */
  manual: boolean;
  /** Public id of the display that paired this phone ("" = unknown / manual code). */
  display: string;
  /** How this player moves: automatic positioning, display keyboard, or the phone's thumb pad. */
  moveStyle: MoveStyle;
  outfit: Outfit;
  gear: Gear;
  /** Serve this player will hit next time they serve. */
  serveStyle: ServeStyle;
  /** Ranked rating, shown in ranked rooms (0 when the phone has no ranked profile). */
  rr: number;
};
export type Match = {
  mode: Mode;
  difficulty: Difficulty;
  map: MapId;
  /** point = the rally just ended: the ball keeps flying for a moment before the reset. */
  phase: "lobby" | "serve" | "rally" | "point" | "over";
  paused: boolean;
  /**
   * Why play is paused: "host" = someone pressed Pause (waits for Resume); "drop" = a phone
   * dropped out (play resumes by itself once everyone is back). "" when not paused.
   */
  pauseReason: "" | "host" | "drop";
  /** Competitive play (owner request: "RR" ranked matchmaking). null for casual rooms. */
  ranked: Ranked | null;
  /**
   * Clients that must switch rooms (matchmaking moves a household into its match and back):
   * keyed by a display's id or a phone's player id → the room to switch to.
   */
  moves: Record<string, { code: string; displayId?: string }>;
  /**
   * Screens whose two local players are swapped (owner request: choose left or right half in
   * split screen). Keyed by display id ("host" for the host screen). Left half = WASD seat.
   */
  swapped: string[];
  /**
   * Timing verdict for the latest human contact (owner request: red/green spark).
   * great/good = clean swing that clears the net; early/late = mistimed into the net or a pop-up.
   */
  timing: {
    at: number;
    by: string;
    kind: "great" | "good" | "early" | "late";
  } | null;
  /** Epoch ms when an automatic resume happens (0 = none scheduled). */
  resumeAt: number;
  score: number[];
  serving: number;
  serverNumber: number;
  serverId: string;
  receiverId: string;
  players: Player[];
  ball: Vec;
  velocity: Vec;
  spin: number;
  lastTeam: number;
  lastPlayer: string;
  bounces: number;
  hits: number;
  serveX: number;
  message: string;
  event: number;
  time: number;
  nextServe: number;
  winner: number | null;
  shot: string;
  contacts: number;
  shotAt: number;
  /** Deterministic bot RNG state, so simulations and tests replay identically. */
  seed: number;
  /** Contact quality (0..1) of the most recent paddle contact, for UI feedback. */
  quality: number;
  /** The last shot was a mistimed pop-up: high, short and attackable. */
  popup: boolean;
  /** Where that pop-up comes down through smash height (~2 m), for positioning and the target ring. */
  popupAt: Vec | null;
  /** Where the ball touched down when a landing ended the rally (shown as a ball mark). */
  mark: { x: number; z: number; out: boolean } | null;
  /** Sideways acceleration (m/s², world X) of a slice serve; 0 otherwise. */
  curve: number;
  /** Serve type of the ball in play ("" once anyone else has hit it). */
  serveKind: "" | ServeStyle;
};
export const ZERO_INPUT: Input = {
  seq: -1,
  t: 0,
  pitch: 0,
  roll: 0,
  yaw: 0,
  strength: 0,
  direction: 0,
  swing: false,
  sensors: false,
  calibrated: false,
};
export const COURT = {
  halfWidth: 3.048,
  halfLength: 6.7056,
  kitchen: 2.1336,
  radius: 0.037,
  netCenter: 0.8636,
  netSide: 0.9144,
  /** Net posts sit 12 in (0.3048 m) outside each sideline. */
  post: 3.048 + 0.3048,
  postRadius: 0.045,
};
export const slots = (m: Mode) =>
  m === "doubles" ? 4 : m === "coop" || m === "singles" ? 2 : 1;
export const teamFor = (m: Mode, i: number) =>
  m === "coop" ? 0 : m === "doubles" ? i % 2 : m === "singles" ? i : 0;
export const clamp = (n: number, a: number, b: number) =>
  Math.max(a, Math.min(b, n));
