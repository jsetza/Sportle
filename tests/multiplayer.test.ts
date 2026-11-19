/**
 * Real Node HTTP server, real fetch + SSE connections, four controller sessions and two
 * household displays. Controller inputs are synthetic (no phone hardware) — this tests
 * connectivity, authority and room logic, not sensor feel.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 31493,
  base = `http://localhost:${PORT}`;
async function call(path: string, data?: unknown, key?: string) {
  const r = await fetch(base + "/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: "Bearer " + key } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: r.status, data: await r.json() };
}
const input = (seq: number, extra: Record<string, unknown> = {}) => ({
  seq,
  t: Date.now(),
  pitch: 0,
  roll: 0,
  yaw: 0,
  strength: 0,
  direction: 0,
  swing: false,
  sensors: true,
  calibrated: true,
  ...extra,
});
/** Collect SSE snapshots for a display until `until` returns true or timeout. */
async function watch(
  room: string,
  key: string,
  until: (s: any) => boolean,
  ms = 4000,
) {
  const ctl = new AbortController();
  const res = await fetch(`${base}/api/events?room=${room}`, {
    headers: { authorization: "Bearer " + key },
    signal: ctl.signal,
  });
  const reader = res.body!.getReader(),
    dec = new TextDecoder();
  let buf = "",
    last: any = null;
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).replace(/^data: /, "");
        buf = buf.slice(i + 2);
        last = JSON.parse(line);
        if (until(last)) return last;
      }
    }
  } catch {
    /* aborted */
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
  return last;
}

test("cross-household four-phone doubles over real HTTP/SSE", async () => {
  const child = spawn(process.execPath, ["src/server/index.ts"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      PUBLIC_ORIGIN: "https://play.example.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((ok, no) => {
      child.stdout.on("data", () => ok());
      child.on("exit", (c) => no(Error("Server exited " + c)));
      setTimeout(() => no(Error("startup timeout")), 5000).unref();
    });
    // Household A creates the room; household B opens its own display.
    const host = await call("create", { mode: "doubles", difficulty: "easy" });
    const room = host.data.code;
    const remote = await call("join?room=" + room, { role: "display" });
    assert.equal(remote.status, 200);
    assert.ok(remote.data.pair, "remote display receives its own pairing QR");
    assert.notEqual(remote.data.pair, host.data.pair);
    assert.equal(remote.data.publicOrigin, "https://play.example.com");

    // Each household points its QR at its own team.
    const pairA = (
      await call("pair?room=" + room, { team: 0 }, host.data.credential)
    ).data.pair;
    const pairB = (
      await call("pair?room=" + room, { team: 1 }, remote.data.credential)
    ).data.pair;
    // The host's rotated token invalidates its old one, but not the remote display's.
    assert.equal(
      (await call("join?room=" + room, { name: "x", pair: host.data.pair }))
        .status,
      400,
    );

    // Phones join household by household (A, A, B, B) — teams must follow households, not join order.
    const phones: { name: string; key: string; id: string; team: number }[] =
      [];
    for (const [name, pair] of [
      ["Ana", pairA],
      ["Ari", pairA],
      ["Ben", pairB],
      ["Bo", pairB],
    ]) {
      const j = await call("join?room=" + room, { name, pair, hand: "right" });
      assert.equal(j.status, 200, JSON.stringify(j.data));
      phones.push({
        name,
        key: j.data.credential,
        id: j.data.player.id,
        team: j.data.player.team,
      });
    }
    assert.deepEqual(
      phones.map((p) => p.team),
      [0, 0, 1, 1],
    );
    // A fifth phone is refused.
    assert.equal(
      (await call("join?room=" + room, { name: "Extra", pair: pairA })).status,
      400,
    );
    // Controllers and the remote display cannot perform host actions.
    assert.equal(
      (
        await call(
          "team?room=" + room,
          { playerId: phones[0].id, team: 1 },
          phones[0].key,
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("start?room=" + room, {}, remote.data.credential)).status,
      403,
    );

    // Host swaps Ari to team 2: full team, so the latest team-2 joiner (Bo) swaps back.
    assert.equal(
      (
        await call(
          "team?room=" + room,
          { playerId: phones[1].id, team: 1 },
          host.data.credential,
        )
      ).status,
      200,
    );
    const lobby = await watch(room, remote.data.credential, () => true);
    const teamOf = (id: string) =>
      lobby.state.players.find((p: any) => p.id === id).team;
    assert.equal(teamOf(phones[1].id), 1);
    assert.equal(teamOf(phones[3].id), 0);

    // All four phones stream calibrated input and ready up.
    const seq = new Map<string, number>();
    for (const p of phones) {
      seq.set(p.key, 0);
      assert.equal(
        (await call("input?room=" + room, input(0), p.key)).data.accepted,
        true,
      );
      assert.equal(
        (await call("ready?room=" + room, { ready: true }, p.key)).status,
        200,
      );
    }
    assert.equal(
      (await call("start?room=" + room, {}, host.data.credential)).status,
      200,
    );
    // Keep phones alive (lastSeen) like real controllers do. Players hit their own serve,
    // so every phone keeps swinging; only the server's swing counts during the serve phase.
    let swingId = 0;
    const keepAlive = setInterval(() => {
      swingId++;
      for (const p of phones) {
        const n = seq.get(p.key)! + 1;
        seq.set(p.key, n);
        call(
          "input?room=" + room,
          input(n, { swing: true, swingId, strength: 0.5 }),
          p.key,
        ).catch(() => {});
      }
    }, 120);
    try {
      // Both households see the same authoritative match.
      const [a, b] = await Promise.all([
        watch(room, host.data.credential, (s) => s.state.phase === "rally"),
        watch(room, remote.data.credential, (s) => s.state.phase === "rally"),
      ]);
      assert.equal(a.state.phase, "rally");
      assert.equal(b.state.phase, "rally");
      assert.deepEqual(a.state.score, b.state.score);
      assert.equal(a.state.serverId, b.state.serverId);
      assert.equal(a.state.players.length, 4);
      assert.ok(a.state.players.every((p: any) => !p.bot));

      // The serve is in: stop the background swings so they cannot race the packets below
      // (inputs closer than 15 ms apart are rejected by design).
      clearInterval(keepAlive);
      await new Promise((r) => setTimeout(r, 40));
      // Jitter: a late, out-of-order packet is rejected; a far-stale timestamp is rejected.
      const ben = phones[2];
      const n = seq.get(ben.key)! + 50;
      seq.set(ben.key, n);
      assert.equal(
        (await call("input?room=" + room, input(n), ben.key)).data.accepted,
        true,
      );
      assert.equal(
        (await call("input?room=" + room, input(n - 3), ben.key)).data.accepted,
        false,
      );
      assert.equal(
        (await call("input?room=" + room, input(n), ben.key)).data.accepted,
        false,
      );
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(
        (
          await call(
            "input?room=" + room,
            { ...input(n + 1), t: Date.now() - 5000 },
            ben.key,
          )
        ).data.accepted,
        false,
      );
      // Out-of-range values are rejected rather than clamped into a shot.
      assert.equal(
        (
          await call(
            "input?room=" + room,
            input(n + 2, { strength: 7, swing: true }),
            ben.key,
          )
        ).data.accepted,
        false,
      );
      seq.set(ben.key, n + 2);
    } finally {
      clearInterval(keepAlive);
    }

    // A phone goes silent (backgrounded); the match pauses for everyone.
    const paused = await watch(
      room,
      remote.data.credential,
      (s) => s.state.paused,
      6000,
    );
    assert.equal(paused.state.paused, true);
    // It reconnects to the same slot and team with its stored credential.
    const back = await call("join?room=" + room, { credential: phones[0].key });
    assert.equal(back.data.player.id, phones[0].id);
    assert.equal(back.data.player.team, 0);
    // Resume while a phone is still missing: no error, it hands over to the automatic resume.
    assert.equal(
      (await call("resume?room=" + room, {}, host.data.credential)).status,
      200,
    );
    // Every phone streams a live paddle again → countdown → play resumes by itself.
    const live = setInterval(() => {
      for (const p of phones) {
        const n = seq.get(p.key)! + 1;
        seq.set(p.key, n);
        call("input?room=" + room, input(n), p.key).catch(() => {});
      }
    }, 120);
    try {
      const resumed = await watch(
        room,
        remote.data.credential,
        (s) => !s.state.paused,
        9000,
      );
      assert.equal(resumed.state.paused, false);
      assert.equal(resumed.state.message, "Play resumed");
    } finally {
      clearInterval(live);
    }
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((r) => child.once("exit", () => r()));
    }
  }
});

test("singles respects household team choice; teams lock at start; pairing expires", async () => {
  const {
    createRoom,
    joinController,
    setTeam,
    begin,
    issuePair,
    checkPair,
    rooms,
  } = await import("../src/server/rooms.ts");
  const r = createRoom("singles", "easy");
  const host = r.sessions.get(r.host)!;
  const { pair } = issuePair(r, host, 1);
  const { team } = checkPair(r, pair);
  assert.equal(team, 1);
  const a = joinController(r, "A", "right", undefined, team).player;
  assert.equal(a.team, 1);
  const b = joinController(r, "B", "left", undefined, 1).player;
  assert.equal(b.team, 0, "full team falls back to the open one");
  for (const p of r.state.players) {
    p.ready = true;
    p.lastSeen = Date.now();
  }
  setTeam(r, b.id, 1); // swap: A moves to team 0
  assert.equal(a.team, 0);
  assert.doesNotThrow(() => begin(r));
  assert.throws(() => setTeam(r, a.id, 1), /fixed once play starts/);
  // Expired pairing tokens are refused.
  const r2 = createRoom("doubles", "easy");
  for (const v of r2.pairs.values()) v.expires = Date.now() - 1;
  assert.throws(() => checkPair(r2, r2.pair), /expired/);
  assert.throws(() => checkPair(r2, undefined), /expired/);
  rooms.delete(r.code);
  rooms.delete(r2.code);
});
