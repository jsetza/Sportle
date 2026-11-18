import test from "node:test";
import assert from "node:assert/strict";
import { ZERO_INPUT } from "../src/shared/types.ts";
import {
  rooms,
  joinController,
  acceptInput,
  housekeeping,
} from "../src/server/rooms.ts";
import {
  createLobby,
  search,
  matchmake,
  rankedTick,
  setRank,
  tickets,
  searchWindow,
  FORFEIT_AFTER,
} from "../src/server/ranked.ts";
import {
  ratings,
  rankId,
  applyResult,
  expected,
} from "../src/server/ratings.ts";

let n = 0;
/** A household: its ranked lobby with `phones` ready phones that stream live input. */
function household(queue: "1v1" | "2v2", phones: number, rr?: number) {
  const r = createLobby(queue, "tokyo");
  const people = [];
  for (let i = 0; i < phones; i++) {
    const key = "test-rank-key-" + ++n + "-xxxxxxxxxxxxxxxx";
    const j = joinController(r, "P" + n, "right");
    const id = rankId(key)!;
    setRank(r, j.player.id, id);
    if (rr !== undefined) {
      ratings.get(id)!.rr = rr;
      j.player.rr = rr;
    }
    j.player.ready = true;
    people.push({ ...j, id, seq: 1 });
  }
  return { r, people };
}
const live = (
  rm: { sessions: Map<string, any> },
  h: { people: any[] },
  t = Date.now(),
) => {
  for (const p of h.people) {
    const s = rm.sessions.get(p.credential);
    acceptInput(
      rm as any,
      s,
      { ...ZERO_INPUT, seq: ++p.seq, t, sensors: true, calibrated: true },
      t,
    );
  }
};

test("ranked 1v1: queue, match by rating, auto start, rating change, back to lobby", () => {
  tickets.length = 0;
  const a = household("1v1", 1, 1200),
    b = household("1v1", 1, 1180),
    far = household("1v1", 1, 1900);
  const now = Date.now();
  for (const h of [a, b, far]) {
    live(h.r, h);
    search(h.r, now);
  }
  matchmake(now);
  // The two close ratings are matched; the 1900 player keeps waiting.
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].code, far.r.code);
  const move = a.r.state.moves[a.people[0].player.id];
  assert.ok(move, "phone told to switch rooms");
  assert.equal(b.r.state.moves[b.people[0].player.id].code, move.code);
  assert.ok(a.r.state.moves.host?.displayId, "display gets its new id");
  const m = rooms.get(move.code)!;
  assert.equal(m.state.ranked?.stage, "match");
  assert.equal(m.state.players.length, 2);
  assert.deepEqual(m.state.players.map((p) => p.team).sort(), [0, 1]);
  // Old credentials work in the new room (no new pairing needed).
  live(m, a);
  live(m, b);
  rankedTick(m);
  assert.equal(m.state.phase, "serve");
  // Team 0's player wins.
  const winner = m.state.players.find((p) => p.team === 0)!;
  m.state.phase = "over";
  m.state.winner = 0;
  rankedTick(m);
  const res = m.state.ranked!.results;
  assert.equal(res.length, 2);
  const w = res.find((x) => x.name === winner.name)!,
    l = res.find((x) => x.name !== winner.name)!;
  assert.ok(w.after > w.before && l.after < l.before);
  assert.equal(w.after - w.before, l.before - l.after);
  // Later: everyone goes home to their own lobby, ready to search again.
  rankedTick(m, Date.now() + 16000);
  const home = m.state.moves[a.people[0].player.id];
  assert.equal(home.code, a.r.code);
  assert.equal(a.r.state.ranked?.stage, "lobby");
  assert.equal(a.r.state.players[0].ready, true);
  for (const h of [a, b, far]) rooms.delete(h.r.code);
  rooms.delete(m.code);
  tickets.length = 0;
});

test("ranked 1v1: the search window widens with waiting time", () => {
  tickets.length = 0;
  const a = household("1v1", 1, 1000),
    b = household("1v1", 1, 1350);
  const t0 = Date.now();
  live(a.r, a, t0);
  live(b.r, b, t0);
  search(a.r, t0);
  search(b.r, t0);
  matchmake(t0);
  assert.equal(tickets.length, 2, "350 RR apart: no match at first");
  assert.equal(searchWindow(0), 100);
  // 30 seconds later the window is 400 RR: matched (phones still live).
  const t1 = t0 + 30000;
  live(a.r, a, t1);
  live(b.r, b, t1);
  matchmake(t1);
  assert.equal(tickets.length, 0);
  for (const h of [a, b]) rooms.delete(h.r.code);
  tickets.length = 0;
});

test("ranked 2v2: two parties, or a party plus two solo players, make a match", () => {
  tickets.length = 0;
  const party = household("2v2", 2, 1100),
    solo1 = household("2v2", 1, 1080),
    solo2 = household("2v2", 1, 1120);
  const now = Date.now();
  for (const h of [party, solo1, solo2]) {
    live(h.r, h);
    search(h.r, now);
  }
  matchmake(now);
  assert.equal(tickets.length, 0);
  const m = rooms.get(party.r.state.moves[party.people[0].player.id].code)!;
  assert.equal(m.state.players.length, 4);
  // The party stays together; the two solo players form the other team.
  const pt = m.state.players.filter((p) =>
    party.people.some((q) => q.player.id === p.id),
  );
  assert.equal(pt[0].team, pt[1].team);
  const others = m.state.players.filter((p) => p.team !== pt[0].team);
  assert.equal(others.length, 2);
  // Each solo household's display shows only its own player.
  assert.notEqual(others[0].display, others[1].display);
  for (const h of [party, solo1, solo2]) live(m, h);
  rankedTick(m);
  assert.equal(m.state.phase, "serve");
  for (const h of [party, solo1, solo2]) rooms.delete(h.r.code);
  rooms.delete(m.code);
  tickets.length = 0;
});

test("ranked: a player who leaves for too long forfeits; ratings follow Elo", () => {
  tickets.length = 0;
  const a = household("1v1", 1, 1000),
    b = household("1v1", 1, 1000);
  const now = Date.now();
  live(a.r, a, now);
  live(b.r, b, now);
  search(a.r, now);
  search(b.r, now);
  matchmake(now);
  const m = rooms.get(a.r.state.moves[a.people[0].player.id].code)!;
  live(m, a, now);
  live(m, b, now);
  rankedTick(m, now);
  assert.equal(m.state.phase, "serve");
  // b's phone goes silent; a keeps playing.
  const gone = now + 3000;
  live(m, a, gone);
  housekeeping(m, gone);
  rankedTick(m, gone);
  assert.notEqual(m.state.phase, "over", "not yet: they may come back");
  const later = gone + FORFEIT_AFTER + 1000;
  live(m, a, later);
  housekeeping(m, later);
  rankedTick(m, later);
  assert.equal(m.state.phase, "over");
  const aTeam = m.state.players.find(
    (p) => p.id === a.people[0].player.id,
  )!.team;
  assert.equal(m.state.winner, aTeam);
  assert.match(m.state.message, /forfeit/);
  assert.equal(
    m.state.ranked!.results.find((x) => x.name === a.people[0].player.name)!
      .after,
    1016,
  );
  // Elo basics.
  assert.equal(expected(1000, 1000), 0.5);
  const x = rankId("elo-test-key-aaaaaaaaaaaaaaaaaaaa")!,
    y = rankId("elo-test-key-bbbbbbbbbbbbbbbbbbbb")!;
  ratings.set(x, { name: "x", rr: 1400, games: 0, wins: 0, updated: 0 });
  ratings.set(y, { name: "y", rr: 1000, games: 0, wins: 0, updated: 0 });
  const r = applyResult([[x], [y]], 0);
  assert.ok(r.get(x)!.after - 1400 < 5, "favourite gains little");
  for (const h of [a, b]) rooms.delete(h.r.code);
  rooms.delete(m.code);
});
