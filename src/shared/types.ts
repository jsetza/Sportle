export type Mode = "practice" | "solo" | "singles" | "coop" | "doubles";
export type Difficulty = "easy" | "medium" | "hard";
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
  lastSeen: number;
  volleyMomentum: boolean;
  reactionAt: number;
  target: Vec;
};
export type Match = {
  mode: Mode;
  difficulty: Difficulty;
  phase: "lobby" | "serve" | "rally" | "over";
  paused: boolean;
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
};
export const slots = (m: Mode) =>
  m === "doubles" ? 4 : m === "coop" || m === "singles" ? 2 : 1;
export const teamFor = (m: Mode, i: number) =>
  m === "coop" ? 0 : m === "doubles" ? i % 2 : m === "singles" ? i : 0;
export const clamp = (n: number, a: number, b: number) =>
  Math.max(a, Math.min(b, n));
