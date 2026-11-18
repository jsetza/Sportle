/** Real browser and HTTP, synthetic sensor events. NOT a physical phone test. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
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
  await display.goto("http://127.0.0.1:31492");
  // Start screen: Play → Offline → (Motion lab is preselected) → Create game.
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
  await phone.locator("#enable").click();
  await phone.evaluate(() => {
    window.testSensors = setInterval(() => {
      window.dispatchEvent(
        new DeviceOrientationEvent("deviceorientation", {
          alpha: 0,
          beta: 35,
          gamma: 0,
        }),
      );
      window.dispatchEvent(
        new DeviceMotionEvent("devicemotion", {
          acceleration: { x: 0, y: 0, z: 0 },
          rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        }),
      );
    }, 16);
  });
  await phone.locator("#calibrate").click();
  await phone.waitForTimeout(150);
  const swing = async (rate) => {
    // Practice shots: upward swings (the learned "up" axis).
    await phone.evaluate(
      (value) =>
        window.dispatchEvent(
          new DeviceMotionEvent("devicemotion", {
            acceleration: { x: 0, y: 0, z: 0 },
            rotationRate: { alpha: 0, beta: value, gamma: 0 },
          }),
        ),
      rate,
    );
  };
  // Movement test: right, left, up, down. Right/left use the opposite sensor sign from what a
  // "screen forward" grip would give, to prove the phone learns whatever it actually reads.
  const rot = async (alpha, beta, gamma) => {
    await phone.evaluate(
      ([a, b, g]) =>
        window.dispatchEvent(
          new DeviceMotionEvent("devicemotion", {
            acceleration: { x: 0, y: 0, z: 0 },
            rotationRate: { alpha: a, beta: b, gamma: g },
          }),
        ),
      [alpha, beta, gamma],
    );
    await phone.waitForTimeout(450);
  };
  await rot(0, 0, -260); // right
  await rot(0, 0, 250); // left
  await rot(0, 240, 0); // up
  await rot(0, -250, 0); // down
  const checks = await phone.locator("#checks li.done").count();
  if (checks !== 4)
    throw Error("Movement test confirmed " + checks + " of 4 swings");
  await phone.locator("#ready").click();
  await phone.locator("#ingame").waitFor({ state: "visible" });
  if (await phone.locator("#setup").isVisible())
    throw Error("Movement tester still visible after Ready");
  const saved = await phone.evaluate(() => localStorage.getItem("pov-profile"));
  if (!saved || !JSON.parse(saved).axes) throw Error("Swings were not saved");
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
  const timer = setTimeout(() => abort.abort(), 20000);
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
          await swing(results.length ? 320 : 120);
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
  // Phone reloads mid-match: it takes its seat back, one tap on Enable, play resumes itself.
  const sensorsOn = () =>
    phone.evaluate(() => {
      window.testSensors = setInterval(() => {
        window.dispatchEvent(
          new DeviceOrientationEvent("deviceorientation", {
            alpha: 0,
            beta: 35,
            gamma: 0,
          }),
        );
        window.dispatchEvent(
          new DeviceMotionEvent("devicemotion", {
            acceleration: { x: 0, y: 0, z: 0 },
            rotationRate: { alpha: 0, beta: 0, gamma: 0 },
          }),
        );
      }, 16);
    });
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
  await phone.locator("#enable").click();
  await sensorsOn();
  await phone.locator("#ingame").waitFor({ state: "visible", timeout: 5000 });
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
    "PASS: display → phone join → synthetic sensors → calibration → ready → practice → 2 distinct shots → reload → one-tap rejoin → auto resume",
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
