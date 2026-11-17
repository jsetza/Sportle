import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
test("real HTTP room flow, SSE snapshots, authority and reconnect", async () => {
  const child = spawn(process.execPath, ["src/server/index.ts"], {
    env: {
      ...process.env,
      PORT: "31489",
      PUBLIC_ORIGIN: "https://play.example.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((ok, no) => {
      child.stdout.on("data", () => ok());
      child.on("error", no);
      child.on("exit", (c) => no(Error("Server exited " + c)));
      setTimeout(() => no(Error("startup timeout")), 5000).unref();
    });
    const base = "http://localhost:31489";
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
    const c = await call("create", { mode: "singles", difficulty: "easy" });
    assert.equal(c.status, 200);
    const room = c.data.code,
      host = c.data.credential;
    const d = await call("join?room=" + room, { role: "display" });
    assert.equal(d.status, 200);
    assert.equal(
      (await call("start?room=" + room, {}, d.data.credential)).status,
      403,
    );
    const players = [];
    for (const name of ["A", "B"]) {
      const p = await call("join?room=" + room, {
        name,
        pair: c.data.pair,
        hand: "right",
      });
      assert.equal(p.status, 200);
      players.push(p.data);
      const key = p.data.credential;
      await call(
        "input?room=" + room,
        {
          seq: 0,
          t: Date.now(),
          pitch: 0,
          roll: 0,
          yaw: 0,
          strength: 0,
          direction: 0,
          swing: false,
          sensors: true,
          calibrated: true,
        },
        key,
      );
      assert.equal(
        (await call("ready?room=" + room, { ready: true }, key)).status,
        200,
      );
    }
    assert.equal((await call("start?room=" + room, {}, host)).status, 200);
    const controller = new AbortController();
    const stream = await fetch(base + "/api/events?room=" + room, {
      headers: { authorization: "Bearer " + d.data.credential },
      signal: controller.signal,
    });
    assert.equal(stream.status, 200);
    const packet = await stream.body!.getReader().read();
    const text = new TextDecoder().decode(packet.value);
    assert.match(text, /"phase":"serve"/);
    assert.ok(!text.includes(host));
    controller.abort();
    const again = await call("join?room=" + room, {
      credential: players[0].credential,
    });
    assert.equal(again.data.player.id, players[0].player.id);
    assert.equal(again.data.player.ready, false);
    assert.equal(
      (await call("input?room=" + room, { seq: 2 }, "bad")).status,
      401,
    );
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
});
