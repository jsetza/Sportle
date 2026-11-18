// Ranked ratings ("RR"). A phone keeps a random secret ranked key in its own storage; the
// server only stores a hash of it, with the player's latest name, rating and record.
// Saved as JSON in DATA_DIR (default ./data). Hosts without a persistent disk (e.g. Render's
// free plan) lose this file on restart/redeploy — see docs/DEPLOYMENT.md.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { START_RR } from "../shared/types.ts";

export type Rating = {
  name: string;
  rr: number;
  games: number;
  wins: number;
  updated: number;
};
const DIR = process.env.DATA_DIR || "data";
const FILE = join(DIR, "ratings.json");
export const ratings = new Map<string, Rating>();
let dirty = false;

/** Server-side id for a phone's ranked key (the key itself is never stored). */
export const rankId = (key: unknown) =>
  typeof key === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(key)
    ? createHash("sha256")
        .update("povpickle:" + key)
        .digest("hex")
        .slice(0, 24)
    : null;

export function loadRatings(file = FILE) {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    for (const [k, v] of Object.entries(data))
      if (v && typeof (v as Rating).rr === "number")
        ratings.set(k, v as Rating);
  } catch {
    /* first run: no file yet */
  }
}
export function saveRatings(file = FILE) {
  if (!dirty) return;
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file + ".tmp", JSON.stringify(Object.fromEntries(ratings)));
    renameSync(file + ".tmp", file);
    dirty = false;
  } catch (e) {
    console.error("[ratings] could not save:", e);
  }
}
export function profile(id: string, name: string): Rating {
  let r = ratings.get(id);
  if (!r) {
    r = { name, rr: START_RR, games: 0, wins: 0, updated: Date.now() };
    ratings.set(id, r);
    dirty = true;
  } else if (name && r.name !== name) {
    r.name = name;
    dirty = true;
  }
  return r;
}
/** Expected score of rating a against b (Elo). */
export const expected = (a: number, b: number) =>
  1 / (1 + 10 ** ((b - a) / 400));
export const K = 32;
/**
 * Apply a finished ranked match. Teams are compared by average rating; every player on a
 * team gets that team's change. Returns each player's before/after.
 */
export function applyResult(
  teams: [string[], string[]],
  winner: 0 | 1,
): Map<string, { before: number; after: number }> {
  const avg = (ids: string[]) =>
    ids.reduce((s, id) => s + (ratings.get(id)?.rr ?? START_RR), 0) /
    Math.max(1, ids.length);
  const a = avg(teams[0]),
    b = avg(teams[1]);
  const delta0 = Math.round(K * ((winner === 0 ? 1 : 0) - expected(a, b)));
  const out = new Map<string, { before: number; after: number }>();
  teams.forEach((ids, t) => {
    const d = t === 0 ? delta0 : -delta0;
    for (const id of ids) {
      const r = ratings.get(id);
      if (!r) continue;
      const before = r.rr;
      r.rr = Math.max(0, r.rr + d);
      r.games++;
      if (t === winner) r.wins++;
      r.updated = Date.now();
      out.set(id, { before, after: r.rr });
    }
  });
  dirty = true;
  return out;
}
export function leaderboard(n = 20) {
  return [...ratings.values()]
    .filter((r) => r.games > 0)
    .sort((x, y) => y.rr - x.rr || y.wins - x.wins)
    .slice(0, n)
    .map(({ name, rr, games, wins }) => ({ name, rr, games, wins }));
}
