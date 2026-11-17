/**
 * Local load probe: N rooms × 4 synthetic controllers posting input at ~60 Hz, plus one SSE
 * display per room. Measures input round-trip on loopback. NOT a wide-area/phone benchmark.
 * Usage: node scripts/load.mjs [rooms=10] [seconds=10]
 */
import { spawn } from "node:child_process";
const rooms = Number(process.argv[2] || 10),
  seconds = Number(process.argv[3] || 10),
  PORT = 31494,
  base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/server/index.ts"], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((ok) => child.stdout.once("data", ok));
const call = async (path, data, key) =>
  (
    await fetch(base + "/api/" + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: "Bearer " + key } : {}),
      },
      body: JSON.stringify(data),
    })
  ).json();
const inp = (seq) => ({
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
});
const lat = [],
  streams = [],
  phones = [];
let snapshots = 0;
for (let i = 0; i < rooms; i++) {
  const h = await call("create", { mode: "doubles", difficulty: "easy" });
  for (let k = 0; k < 4; k++) {
    const j = await call("join?room=" + h.code, {
      name: "P" + k,
      pair: h.pair,
    });
    phones.push({ room: h.code, key: j.credential, seq: 0 });
    await call("input?room=" + h.code, inp(0), j.credential);
    await call("ready?room=" + h.code, { ready: true }, j.credential);
  }
  await call("start?room=" + h.code, {}, h.credential);
  const ctl = new AbortController();
  streams.push(ctl);
  fetch(`${base}/api/events?room=${h.code}`, {
    headers: { authorization: "Bearer " + h.credential },
    signal: ctl.signal,
  })
    .then(async (r) => {
      for await (const c of r.body)
        snapshots += (String(Buffer.from(c)).match(/\n\n/g) || []).length;
    })
    .catch(() => {});
}
const end = Date.now() + seconds * 1000;
let failures = 0;
const cpu0 = process.cpuUsage();
await Promise.all(
  phones.map(async (p) => {
    while (Date.now() < end) {
      const t = performance.now();
      const r = await call("input?room=" + p.room, inp(++p.seq), p.key).catch(
        () => null,
      );
      if (!r || !r.accepted) {
        failures++;
        if (process.env.DEBUG && failures < 4) console.error(JSON.stringify(r));
      }
      lat.push(performance.now() - t);
      await new Promise((ok) => setTimeout(ok, 33)); // phones send at ~30 Hz
    }
  }),
);
lat.sort((a, b) => a - b);
const q = (x) => lat[Math.floor(lat.length * x)].toFixed(1);
console.log(
  JSON.stringify({
    rooms,
    controllers: phones.length,
    seconds,
    inputs: lat.length,
    rejected: failures,
    rttMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99) },
    snapshotsPerDisplayPerSec: (snapshots / rooms / seconds).toFixed(1),
  }),
);
for (const s of streams) s.abort();
child.kill("SIGTERM");
