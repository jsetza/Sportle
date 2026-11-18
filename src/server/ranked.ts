// Ranked matchmaking (owner request): households queue from their own ranked lobby and are
// matched with others of similar rating, each on its own screen with its own phones.
//
// Flow: a display opens a ranked lobby room (its phones pair and get ready there) → "Find
// match" queues it → the matchmaker creates a match room, copies everyone's sessions and
// players into it and tells each client to switch (state.moves) → the match starts by itself
// once every phone is live → ratings change at the end → everyone is moved back to their
// own lobby, still ready, to search again.
import {
  rooms,
  createRoom,
  token,
  begin,
  everyoneBack,
  type Room,
} from "./rooms.ts";
import { applyResult, profile, ratings, saveRatings } from "./ratings.ts";
import { START_RR, type MapId, type RankedQueue } from "../shared/types.ts";

type Ticket = {
  code: string;
  queue: RankedQueue;
  size: number;
  rr: number;
  since: number;
};
type Household = {
  code: string;
  displays: Map<string, string>;
  players: string[];
};
type MatchInfo = {
  households: Household[];
  createdAt: number;
  applied: boolean;
  returnAt: number;
  dropSince: number;
  pausedAt: number;
};
export const tickets: Ticket[] = [];
/** Phone player id → ranked id (hash of the phone's ranked key), per room. */
export const rankIds = new WeakMap<Room, Map<string, string>>();
const matches = new WeakMap<Room, MatchInfo>();
/** A ranked match waits this long for every phone to arrive before it is called off. */
export const ARRIVAL_LIMIT = 60000;
/** A player who stays disconnected this long during a ranked match forfeits it. */
export const FORFEIT_AFTER = 60000;
/** Rating gap allowed when matching: starts at 100 and widens 10 RR per second of waiting. */
export const searchWindow = (waitMs: number) =>
  Math.min(800, 100 + Math.floor(waitMs / 1000) * 10);

export function createLobby(queue: RankedQueue, map: MapId): Room {
  const r = createRoom(queue === "1v1" ? "singles" : "doubles", "hard", map);
  r.state.ranked = { queue, stage: "lobby", since: 0, window: 0, results: [] };
  rankIds.set(r, new Map());
  return r;
}
/** Phones a ranked lobby holds: one for 1v1, one or two (a party) for 2v2. */
export const lobbyCap = (r: Room) => (r.state.ranked?.queue === "1v1" ? 1 : 2);
export const isLobby = (r: Room) =>
  !!r.state.ranked && r.state.ranked.stage !== "match";

/** Record a phone's ranked identity and show its rating. */
export function setRank(r: Room, playerId: string, id: string | null) {
  const p = r.state.players.find((q) => q.id === playerId);
  if (!p) return;
  const ids = rankIds.get(r) ?? new Map();
  rankIds.set(r, ids);
  if (id) {
    ids.set(playerId, id);
    p.rr = profile(id, p.name).rr;
  }
}

const humans = (r: Room) => r.state.players.filter((p) => !p.bot);
const avgRR = (r: Room) => {
  const h = humans(r);
  return h.reduce((s, p) => s + (p.rr || START_RR), 0) / Math.max(1, h.length);
};

export function search(r: Room, now = Date.now()) {
  const rk = r.state.ranked;
  if (!rk || rk.stage !== "lobby") throw Error("Not in a ranked lobby");
  const h = humans(r);
  if (!h.length) throw Error("Pair your phone first");
  if (h.length > lobbyCap(r)) throw Error("Too many phones for this queue");
  const ids = rankIds.get(r);
  if (h.some((p) => !ids?.get(p.id)))
    throw Error("Every phone needs a ranked profile — rejoin from the QR code");
  if (!everyoneBack(r, now) || h.some((p) => !p.ready))
    throw Error("Every phone must be connected and ready");
  tickets.push({
    code: r.code,
    queue: rk.queue,
    size: h.length,
    rr: avgRR(r),
    since: now,
  });
  rk.stage = "searching";
  rk.since = now;
  rk.window = searchWindow(0);
  r.state.message = "Searching for an opponent…";
  r.state.event++;
}
export function cancel(r: Room, message = "Search cancelled") {
  const i = tickets.findIndex((t) => t.code === r.code);
  if (i >= 0) tickets.splice(i, 1);
  const rk = r.state.ranked;
  if (rk && rk.stage === "searching") {
    rk.stage = "lobby";
    r.state.message = message;
    r.state.event++;
  }
}

/** All the ways to split these tickets (parties stay together) into two teams of `per`. */
function splits(group: Ticket[], per: number) {
  const out: [Ticket[], Ticket[]][] = [];
  for (let mask = 0; mask < 1 << group.length; mask++) {
    if (mask & 1) continue; // first ticket always on team 0 (avoid mirrored duplicates)
    const a = group.filter((_, i) => !(mask & (1 << i))),
      b = group.filter((_, i) => mask & (1 << i));
    const size = (t: Ticket[]) => t.reduce((s, x) => s + x.size, 0);
    if (size(a) === per && size(b) === per) out.push([a, b]);
  }
  return out;
}
const teamAvg = (t: Ticket[]) =>
  t.reduce((s, x) => s + x.rr * x.size, 0) / t.reduce((s, x) => s + x.size, 0);

/** Find matches among queued tickets. Run about once a second. */
export function matchmake(now = Date.now()) {
  // Drop tickets whose lobby vanished or whose phones went away.
  for (const t of [...tickets]) {
    const r = rooms.get(t.code);
    if (!r || r.state.ranked?.stage !== "searching") {
      tickets.splice(tickets.indexOf(t), 1);
      continue;
    }
    if (!everyoneBack(r, now)) {
      cancel(
        r,
        "A phone disconnected · search stopped. Find match again when ready.",
      );
      continue;
    }
    r.state.ranked.window = searchWindow(now - t.since);
    r.updated = now;
  }
  for (const queue of ["1v1", "2v2"] as const) {
    const per = queue === "1v1" ? 1 : 2;
    let found = true;
    while (found) {
      found = false;
      const q = tickets
        .filter((t) => t.queue === queue)
        .sort((a, b) => a.since - b.since);
      outer: for (const first of q) {
        const win = searchWindow(now - first.since);
        // Groups that include the longest-waiting ticket and fill both teams.
        const others = q.filter((t) => t !== first).slice(0, 10);
        const need = per * 2 - first.size;
        const combos: Ticket[][] = [];
        const pick = (start: number, left: number, acc: Ticket[]) => {
          if (left === 0) return void combos.push(acc);
          for (let i = start; i < others.length; i++)
            if (others[i].size <= left)
              pick(i + 1, left - others[i].size, [...acc, others[i]]);
        };
        pick(0, need, []);
        let best: [Ticket[], Ticket[]] | null = null,
          gap = Infinity;
        for (const c of combos) {
          const group = [first, ...c];
          // Everyone's own search window must allow everyone else in the group.
          const lo = Math.min(...group.map((t) => t.rr)),
            hi = Math.max(...group.map((t) => t.rr));
          const minWin = Math.min(
            ...group.map((t) => searchWindow(now - t.since)),
          );
          if (hi - lo > minWin) continue;
          for (const s of splits(group, per)) {
            const g = Math.abs(teamAvg(s[0]) - teamAvg(s[1]));
            if (g <= win && g < gap) {
              gap = g;
              best = s;
            }
          }
        }
        if (best) {
          for (const t of [...best[0], ...best[1]])
            tickets.splice(tickets.indexOf(t), 1);
          startMatch(queue, best, now);
          found = true;
          break outer;
        }
      }
    }
  }
}

/** Create the match room and move every household's display and phones into it. */
export function startMatch(
  queue: RankedQueue,
  teams: [Ticket[], Ticket[]],
  now = Date.now(),
) {
  const lobbies = teams.map((ts) => ts.map((t) => rooms.get(t.code)!));
  const first = lobbies[0][0];
  const m = createRoom(
    queue === "1v1" ? "singles" : "doubles",
    "hard",
    first.state.map,
  );
  // No host and no pairing: only the matched households' sessions get in.
  m.sessions.clear();
  m.pairs.clear();
  m.state.ranked = {
    queue,
    stage: "match",
    since: now,
    window: 0,
    results: [],
  };
  const ids = new Map<string, string>();
  rankIds.set(m, ids);
  const info: MatchInfo = {
    households: [],
    createdAt: now,
    applied: false,
    returnAt: 0,
    dropSince: 0,
    pausedAt: 0,
  };
  matches.set(m, info);
  lobbies.forEach((group, team) => {
    for (const a of group) {
      const displays = new Map<string, string>(); // old display id → new
      for (const [key, s] of a.sessions) {
        if (s.role === "controller") {
          m.sessions.set(key, { ...s });
          continue;
        }
        const old = s.displayId || "host",
          id = token().slice(0, 8);
        displays.set(old, id);
        m.sessions.set(key, {
          ...s,
          role: "display",
          displayId: id,
          pair: undefined,
        });
      }
      const players: string[] = [];
      for (const p of humans(a)) {
        const c = structuredClone(p);
        c.team = team;
        c.display = displays.get(p.display || "host") ?? c.display;
        m.state.players.push(c);
        players.push(p.id);
        const rid = rankIds.get(a)?.get(p.id);
        if (rid) ids.set(p.id, rid);
      }
      for (const [old, id] of displays)
        a.state.moves[old] = { code: m.code, displayId: id };
      for (const id of players) a.state.moves[id] = { code: m.code };
      a.state.ranked!.stage = "matched";
      a.state.message = "Match found! Heading to the court…";
      a.state.event++;
      info.households.push({ code: a.code, displays, players });
    }
  });
  const names = (t: number) =>
    m.state.players
      .filter((p) => p.team === t)
      .map((p) => `${p.name} (${p.rr})`)
      .join(" & ");
  m.state.message = `Ranked ${queue}: ${names(0)} vs ${names(1)} · starting when everyone's in`;
  m.state.event++;
  return m;
}

/** Send every household of a match back to its own lobby (still paired and ready). */
function sendHome(m: Room, info: MatchInfo, message: string) {
  for (const h of info.households) {
    const a = rooms.get(h.code);
    if (!a || !a.state.ranked) continue;
    for (const [old, id] of h.displays)
      m.state.moves[id] = { code: a.code, displayId: old };
    for (const id of h.players) m.state.moves[id] = { code: a.code };
    a.state.moves = {};
    a.state.ranked.stage = "lobby";
    a.state.ranked.results = m.state.ranked?.results ?? [];
    const aIds = rankIds.get(a);
    for (const p of humans(a)) {
      const rid = aIds?.get(p.id);
      if (rid) p.rr = ratings.get(rid)?.rr ?? p.rr;
    }
    a.state.message = message;
    a.state.event++;
    a.updated = Date.now();
  }
  m.state.event++;
}

function finish(m: Room, info: MatchInfo, winner: 0 | 1, now: number) {
  info.applied = true;
  const ids = rankIds.get(m)!;
  const team = (t: number) =>
    m.state.players
      .filter((p) => !p.bot && p.team === t)
      .map((p) => ids.get(p.id))
      .filter(Boolean) as string[];
  const result = applyResult([team(0), team(1)], winner);
  m.state.ranked!.results = m.state.players
    .filter((p) => !p.bot)
    .map((p) => {
      const r = result.get(ids.get(p.id) ?? "");
      if (r) p.rr = r.after;
      return {
        name: p.name,
        team: p.team,
        before: r?.before ?? p.rr,
        after: r?.after ?? p.rr,
      };
    });
  saveRatings();
  info.returnAt = now + 15000;
  m.state.event++;
}

/** Per-room ranked upkeep: auto start, forfeits, ratings, returning home. Run ~4×/s. */
export function rankedTick(m: Room, now = Date.now()) {
  const info = matches.get(m);
  if (!info) {
    // A lobby of a household that's in a match: keep it alive.
    if (m.state.ranked?.stage === "matched") m.updated = now;
    return;
  }
  m.updated = now;
  for (const h of info.households) {
    const a = rooms.get(h.code);
    if (a) a.updated = now;
  }
  const s = m.state;
  if (s.phase === "lobby") {
    if (everyoneBack(m, now) && s.players.every((p) => p.ready)) {
      try {
        begin(m);
        s.message = `Ranked ${s.ranked!.queue} · first to 11, win by 2`;
        s.event++;
      } catch (e) {
        console.error("[ranked] could not start:", e);
      }
    } else if (now - info.createdAt > ARRIVAL_LIMIT && !info.returnAt) {
      info.applied = true;
      info.returnAt = now + 1000;
      s.message =
        "Not everyone made it to the court · match cancelled, no rating change";
      s.event++;
    }
  } else if (s.phase !== "over") {
    // In ranked, a manual pause lasts at most a minute, then play resumes once everyone's live.
    if (s.paused && s.pauseReason === "host") {
      info.pausedAt ||= now;
      if (now - info.pausedAt > 60000) {
        s.pauseReason = "drop";
        s.message = "Ranked pauses last up to a minute · resuming";
        s.event++;
      }
    } else info.pausedAt = 0;
    // Forfeit: a player gone for too long during play loses it for their team.
    const gone = s.players.filter(
      (p) => !p.bot && (!p.connected || now - p.lastSeen > 2500),
    );
    if (gone.length) {
      info.dropSince ||= now;
      if (now - info.dropSince > FORFEIT_AFTER) {
        const loser = gone[0].team;
        s.phase = "over";
        s.paused = false;
        s.pauseReason = "";
        s.winner = 1 - loser;
        s.message = `${gone.map((p) => p.name).join(" & ")} left the match · forfeit`;
        s.event++;
      }
    } else info.dropSince = 0;
  }
  if (s.phase === "over" && !info.applied && s.winner !== null)
    finish(m, info, s.winner as 0 | 1, now);
  if (info.returnAt && now >= info.returnAt && !Object.keys(s.moves).length)
    sendHome(
      m,
      info,
      s.ranked?.results.length
        ? "Back in your lobby · Find match to play again"
        : "Back in your lobby · the match didn't start",
    );
  // The match room is no longer needed a minute after everyone went home.
  if (info.returnAt && now - info.returnAt > 60000) rooms.delete(m.code);
}
