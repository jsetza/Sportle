export type Mode = "practice" | "solo" | "singles" | "coop" | "doubles";
export type Difficulty = "easy" | "medium" | "hard";
/** Swing reload (owner request): a player can swing again this many seconds after the last swing. */
export const SWING_RELOAD = 0.2;
export type MoveStyle = "auto" | "keys" | "phone";
export const MOVE_STYLES: MoveStyle[] = ["auto", "keys", "phone"];
/** Courts to play on (owner request). "arena" is the original indoor arena. */
export type MapId = "arena" | "tokyo" | "manila" | "sf" | "centralpark";
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
};
export type Match = {
  mode: Mode;
  difficulty: Difficulty;
  map: MapId;
  phase: "lobby" | "serve" | "rally" | "over";
  paused: boolean;
  /**
   * Why play is paused: "host" = someone pressed Pause (waits for Resume); "drop" = a phone
   * dropped out (play resumes by itself once everyone is back). "" when not paused.
   */
  pauseReason: "" | "host" | "drop";
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
