/** Real browser and HTTP, synthetic sensor events. NOT a physical phone test. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { setUpPhone, sensors, holdToAim, FOREHAND, setPose } from "./phone-setup.mjs";
const child = spawn(process.execPath, ["src/server/index.ts"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: "31492" },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  await new Promise((ok, no) => {
    child.stdout.once("data", ok);
    child.once("error", no);
    child.once("exit", (c) => no(Error("Server exited " + c)));
    setTimeout(() => no(Error("Server startup timeout")), 5000).unref();
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const display = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  for (const p of [display, phone])
    p.on("pageerror", (e) => errors.push(e.message));
  await display.goto("http://127.0.0.1:31492/#test");
  // Start screen: Play → Offline → (Motion lab is preselected) → Create game.
  await display.locator("#play").click();
  // "← All games" goes back to the game picker; Pickleball again opens the steps.
  await display.locator("#stepWhere [data-back]").click();
  await display.locator("#hubPick").waitFor({ state: "visible" });
  await display.locator("#play").click();
  await display.locator("#goOffline").click();
  await display.locator("label[for=map-tokyo]").click();
  await display.locator("#create").click();
  await display.locator("#lobby").waitFor({ state: "visible" });
  const room = await display.locator("#roomcode").textContent();
  assert.match(await display.locator("#pairHint").textContent(), /HTTPS/);
  await phone.goto("http://127.0.0.1:31492/controller?room=" + room);
  await phone.locator("#nickname").fill("Test phone");
  await phone.locator("#connect").click();
  // The typed-in fields are removed after joining (no iOS "Undo Typing" when swinging).
  await phone.locator("#controls").waitFor({ state: "visible" });
  if ((await phone.locator("#nickname, #code").count()) !== 0)
    throw Error("Text fields still on the page after joining");
  // Four-step setup with synthetic sensors; the phone reads left/right reversed, and the
  // setup must learn that from the forehand/backhand swings.
  const profile = await setUpPhone(phone, { reversed: true });
  if (await phone.locator("#setup").isVisible())
    throw Error("Setup still visible after finishing");
  const swing = async (rate) => {
    // Practice shots: low-to-high swings in the forehand grip (−beta = upward path).
    await phone.evaluate(async (value) => {
      for (let i = 0; i < 4; i++) {
        window.dispatchEvent(
          new DeviceMotionEvent("devicemotion", {
            acceleration: { x: 0, y: 0, z: 0 },
            rotationRate: { alpha: 0, beta: -value, gamma: 0 },
          }),
        );
        await new Promise((ok) => setTimeout(ok, 16));
      }
    }, rate);
  };
  void profile;
  await display.locator("#start").click();
  const host = JSON.parse(
      await display.evaluate(() => sessionStorage.getItem("visual-host")),
    ),
    abort = new AbortController();
  const res = await fetch("http://127.0.0.1:31492/api/events?room=" + room, {
    headers: { authorization: "Bearer " + host.credential },
    signal: abort.signal,
  });
  const reader = res.body.getReader();
  let buffer = "",
    fired = false,
    contacts = 0;
  const results = [];
  const timer = setTimeout(() => abort.abort(), 60000);
  try {
    while (results.length < 2) {
      const chunk = await reader.read();
      if (chunk.done) throw Error("Stream closed");
      buffer += new TextDecoder().decode(chunk.value);
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const { state: m } = JSON.parse(buffer.slice(6, end));
        buffer = buffer.slice(end + 2);
        const p = m.players.find((p) => !p.bot);
        if (fired && m.contacts > contacts) {
          results.push({
            shot: m.shot,
            message: m.message,
            velocity: m.velocity,
          });
          fired = false;
        }
        // A test swing that missed (slow machine, late snapshot): try again on the next ball.
        if (fired && m.phase !== "rally") fired = false;
        if (
          !fired &&
          results.length < 2 &&
          m.phase === "rally" &&
          m.lastTeam === 1 &&
          m.bounces === 1 &&
          Math.hypot(m.ball.x - p.pos.x, m.ball.z - p.pos.z) < 0.85 &&
          m.ball.y > 0.25
        ) {
          contacts = m.contacts;
          fired = true;
          await swing(results.length ? 950 : 480); // a firm swing, then a hard one
        }
      }
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel();
    abort.abort();
  }
  assert.equal(results.length, 2);
  assert.notDeepEqual(results[0].velocity, results[1].velocity);
  assert.notEqual(results[0].message, results[1].message);
  // Ball lock: in first- and third-person views the ball stays near the middle of the screen
  // while it is in front of the player (measured as the angle off the view's centre line).
  const lock = {};
  for (const mode of ["first", "third"]) {
    lock[mode] = await display.evaluate(
      (mode) =>
        new Promise((done) => {
          const s = window.__povScene;
          s.viewMode = mode;
          const out = [];
          // Measure for 4 s, longer on slow software rendering (CI), until enough frames are seen.
          const start = performance.now();
          const tick = () => {
            const v = s.views[0] || s.view,
              b = s.lastBallPos,
              facing = s.followTeam ? -1 : 1;
            if (b && (v.eye[2] - b.z) * facing > 2.2) {
              const d = v.target.map((t, i) => t - v.eye[i]),
                e = [b.x - v.eye[0], b.y - v.eye[1], b.z - v.eye[2]];
              const dot = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
              const cos = dot / (Math.hypot(...d) * Math.hypot(...e));
              out.push((Math.acos(Math.min(1, cos)) * 180) / Math.PI);
            }
            const t = performance.now() - start;
            if (t < 4000 || (out.length < 8 && t < 25000)) requestAnimationFrame(tick);
            else {
              out.sort((a, b) => a - b);
              done({
                frames: out.length,
                median: out[Math.floor(out.length / 2)],
                p90: out[Math.floor(out.length * 0.9)],
              });
            }
          };
          tick();
        }),
      mode,
    );
    // Software (SwiftShader) rendering is slow: a handful of frames is enough to measure.
    if (!(lock[mode].frames > 5)) throw Error("Ball lock: no frames with the ball ahead · " + JSON.stringify(lock[mode]) + JSON.stringify(await display.evaluate(() => { const m = window.__povScene.state; return { phase: m.phase, paused: m.paused, msg: m.message, ball: m.ball, follow: window.__povScene.follow, fp: window.__povScene.followPos }; })));
    // Headless Chrome renders slowly (few frames), so allow some lag; on real screens it's tighter.
    if (lock[mode].median > 12)
      throw Error(`Ball lock (${mode}): ball ${lock[mode].median.toFixed(1)}° off centre`);
  }
  console.log("ball lock (degrees off centre):", JSON.stringify(lock));
  // Phone reloads mid-match: it takes its seat back, one tap on Enable, play resumes itself.
  await phone.reload();
  const state = async () =>
    (
      await (
        await fetch("http://127.0.0.1:31492/api/state?room=" + room, {
          headers: { authorization: "Bearer " + host.credential },
        })
      ).json()
    ).state;
  for (let i = 0; i < 40 && !(await state()).paused; i++)
    await phone.waitForTimeout(100);
  if (!(await state()).paused) throw Error("Reload did not pause the match");
  // WELCOME BACK: allow motion, hold to aim, and the saved swings are used — no swing steps.
  await phone.locator("#welcomeBack").waitFor({ state: "visible", timeout: 5000 });
  await phone.locator("#hold").click(); // first tap turns motion on
  await sensors(phone);
  await holdToAim(phone);
  await phone.locator("#ingame").waitFor({ state: "visible", timeout: 5000 });
  await setPose(phone, FOREHAND);
  let resumed = false;
  for (let i = 0; i < 80 && !resumed; i++) {
    await phone.waitForTimeout(100);
    resumed = !(await state()).paused;
  }
  if (!resumed) throw Error("Match did not resume after the phone came back");
  const qr = await display.evaluate(async () => {
    const { drawQR } = await import("/qr.js");
    const c = document.createElement("canvas"),
      value =
        "https://visual.example.com/controller?room=ABC123#pair=abcdefghijklmnopqrstuv";
    drawQR(c, value);
    if (typeof BarcodeDetector === "undefined") return { supported: false };
    const r = await new BarcodeDetector({ formats: ["qr_code"] }).detect(c);
    return { supported: true, value, decoded: r[0]?.rawValue };
  });
  if (qr.supported) assert.equal(qr.decoded, qr.value);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: display → phone join → synthetic sensors → 3-step setup (learned reversed left/right) → ready → practice → 2 distinct shots → reload → welcome back (tap + hold to aim) → auto resume",
  );
  console.log(JSON.stringify({ results, qr }, null, 2));
  await phone.evaluate(() => {
    clearInterval(window.testSensors);
    document.dispatchEvent(new Event("visibilitychange"));
  });
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
}
