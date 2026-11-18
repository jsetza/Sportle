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
    const health = await fetch(base + "/healthz");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
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
    // Polling fallback (for tunnels without SSE) returns the same snapshot, authenticated.
    const polled = await call(
      "state?room=" + room,
      undefined,
      d.data.credential,
    );
    assert.equal(polled.status, 200);
    assert.equal(polled.data.code, room);
    assert.ok(["serve", "rally"].includes(polled.data.state.phase));
    assert.equal(
      (await call("state?room=" + room, undefined, "nope")).status,
      401,
    );
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

test("hosting: origin and client address detection per platform", async () => {
  const { detectOrigin, detectPlatform, clientIp } = await import(
    "../src/server/hosting.ts"
  );
  assert.equal(
    detectOrigin({
      PUBLIC_ORIGIN: "https://a.example",
      RENDER_EXTERNAL_URL: "https://b.onrender.com",
    }),
    "https://a.example",
  );
  assert.equal(
    detectOrigin({ RENDER_EXTERNAL_URL: "https://b.onrender.com" }),
    "https://b.onrender.com",
  );
  assert.equal(
    detectOrigin({ RAILWAY_PUBLIC_DOMAIN: "c.up.railway.app" }),
    "https://c.up.railway.app",
  );
  assert.equal(
    detectOrigin({ FLY_APP_NAME: "povpickle" }),
    "https://povpickle.fly.dev",
  );
  assert.equal(detectOrigin({}), "");
  assert.equal(detectPlatform({ RENDER: "true" }), "render");
  assert.equal(detectPlatform({ FLY_APP_NAME: "x" }), "fly");
  assert.equal(
    detectPlatform({ RAILWAY_ENVIRONMENT_NAME: "production" }),
    "railway",
  );
  assert.equal(detectPlatform({ TRUST_PROXY: "1" }), "proxy");
  assert.equal(detectPlatform({}), "direct");
  const h = {
    "x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.9",
    "true-client-ip": "1.2.3.4",
    "fly-client-ip": "5.5.5.5",
    "x-real-ip": "7.7.7.7",
  };
  assert.equal(clientIp(h, "10.0.0.1", "render"), "1.2.3.4");
  assert.equal(clientIp(h, "10.0.0.1", "fly"), "5.5.5.5");
  assert.equal(clientIp(h, "10.0.0.1", "railway"), "7.7.7.7");
  assert.equal(clientIp(h, "10.0.0.1", "proxy"), "10.0.0.9");
  // Running directly, client-supplied headers are ignored (spoofable).
  assert.equal(clientIp(h, "10.0.0.1", "direct"), "10.0.0.1");
  // Missing platform header falls back to the socket address.
  assert.equal(clientIp({}, "10.0.0.1", "render"), "10.0.0.1");
});
