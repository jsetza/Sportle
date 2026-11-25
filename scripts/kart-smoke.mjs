/**
 * Sportle Kart browser smoke test. Real server, real browser pages and HTTP/SSE; the phones are
 * pages with SYNTHETIC sensor events (NOT a physical phone test).
 * Hub → Kart; two phones join one room (one in each landscape grip) and finish setup; split
 * screen; tilting a phone left turns its kart left on the server (and the loopback delay from
 * the tilt to the server's steering is printed); drift + release gives a boost; an item is
 * picked up and used; a lap is counted; results are shown. While racing, a small autopilot in
 * this script turns each phone like a wheel (synthetic orientation events) to follow the track.
 * Optional: SHOTS=<dir> saves screenshots along the way.
 */
import { chromium } from "playwright";
import { patientBrowser, slow } from "./patient.mjs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import { joinPhone, wheel, pose } from "./kart-phone.mjs";
import { track, pointAt } from "../src/shared/kart.ts";

const PORT = 31495;
const SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const child = spawn(process.execPath, ["src/server/index.ts"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
const BASE = `http://127.0.0.1:${PORT}`;
/** Wheel turn (degrees, + = left) that gives steering `s` with the range learned in setup (38°). */
function turnFor(s) {
  const a = Math.min(1, Math.abs(s));
  if (a < 0.005) return 0;
  const u = (-0.35 + Math.sqrt(0.35 * 0.35 + 4 * 0.65 * a)) / (2 * 0.65);
  const x = 0.06 + u * (1 - 0.06);
  return -Math.sign(s) * x * 38 * 0.85;
}
try {
  await new Promise((ok, no) => {
    child.stdout.once("data", ok);
    child.once("exit", (c) => no(Error("Server exited " + c)));
    setTimeout(() => no(Error("Server startup timeout")), 5000).unref();
  });
  browser = patientBrowser(
    await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    }),
  );
  const errors = [];
  const tv = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // Phones in landscape, like a steering wheel.
  const ctxA = await browser.newContext({ viewport: { width: 844, height: 390 } }),
    ctxB = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const a = await ctxA.newPage(),
    b = await ctxB.newPage();
  for (const p of [tv, a, b]) p.on("pageerror", (e) => errors.push(e.message));
  // Start screen: Kart is the third card in the picker; Enter opens it.
  await tv.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await tv.locator("#hubIntro").waitFor({ state: "visible" });
  await tv.keyboard.press("x");
  await tv.locator("#hubPick").waitFor({ state: "visible" });
  assert.equal(await tv.locator("#playKart").getAttribute("href"), "/kart");
  assert.ok(await tv.locator("#playSoon").count(), "a 'More soon' card follows Kart");
  await tv.keyboard.press("ArrowRight");
  await tv.keyboard.press("ArrowRight");
  await tv.locator("#playKart.active").waitFor();
  if (SHOTS) {
    await tv.waitForTimeout(700);
    await tv.screenshot({ path: SHOTS + "/hub-kart.png" });
  }
  await tv.keyboard.press("Enter");
  await tv.waitForURL(/\/kart$/);
  // A one-lap multiplayer race on Court Circuit (laps=1 keeps the test short; races are 3 laps).
  await tv.goto(BASE + "/kart?laps=1#test");
  await tv.locator("#goMulti").click();
  await tv.locator("label[for=kt-court]").click();
  await tv.locator("#create").click();
  await tv.locator("#lobby").waitFor({ state: "visible" });
  const room = (await tv.locator("#roomcode").textContent()).trim();
  assert.match(room, /^[A-F0-9]{6}$/);
  assert.match(await tv.locator("#pairHint").textContent(), /HTTPS/);
  await joinPhone(a, BASE, room, "Ana", { grip: 1 });
  await joinPhone(b, BASE, room, "Ben", { grip: -1, body: "paddle" });
  await tv.locator("#drivers li", { hasText: "Ben" }).waitFor();
  await tv.waitForFunction(() => window.__kartScene.kart?.racers.filter((r) => !r.bot).every((r) => r.ready));
  if (SHOTS) {
    await tv.screenshot({ path: SHOTS + "/kart-lobby.png" });
    await a.screenshot({ path: SHOTS + "/kart-phone-ready.png" });
  }
  const state = (p) => p.evaluate(() => window.__kartPhone.state);
  const me = async (p, name) => (await state(p)).racers.find((r) => r.name === name);
  await tv.locator("#start").click();
  await a.waitForFunction(() => window.__kartPhone.state?.phase === "race", null, { timeout: slow(15000) });
  // Split screen on the TV: one view per phone.
  await tv.waitForFunction(() => document.querySelectorAll(".kview").length === 2, null, { timeout: slow(8000) });
  // Tilt Ana's phone left: her kart steers left and turns left (heading decreases).
  const before = await me(a, "Ana");
  const t0 = Date.now();
  await pose(a, wheel(30, 1));
  await a.waitForFunction(() => window.__kartPhone.state.racers.find((r) => r.name === "Ana").steer < -0.2, null, { timeout: slow(4000) });
  const delay = Date.now() - t0;
  await a.waitForTimeout(slow(900));
  const after = await me(a, "Ana");
  const turned = Math.atan2(Math.sin(after.h - before.h), Math.cos(after.h - before.h));
  assert.ok(after.steer < -0.3, "server steering is left: " + after.steer);
  assert.ok(turned < -0.1, "the kart turned left: " + turned.toFixed(2) + " rad");
  console.log(`Loopback tilt → server steering seen on the phone: ${delay} ms (synthetic sensors, same machine; not a real-phone measurement)`);
  if (SHOTS) {
    await tv.screenshot({ path: SHOTS + "/kart-split.png" });
    await a.screenshot({ path: SHOTS + "/kart-phone-race.png" });
  }
  // Autopilot: each phone is turned like a wheel to follow the track's racing line.
  const t = track("court");
  const grips = { Ana: 1, Ben: -1 };
  let auto = true;
  const steerOf = (r, k) => {
    // Aim at an item cube that is still there in the next row ahead (others may take them).
    let aim = 0;
    const ahead = k.cubes.filter((c) => c.up && ((c.s - r.s + t.L) % t.L) < 45 && ((c.s - r.s + t.L) % t.L) > 3);
    if (ahead.length && !r.item) aim = ahead.sort((p, q) => Math.abs(p.d - r.d) - Math.abs(q.d - r.d))[0].d;
    const look = pointAt(t, r.s + 9 + Math.max(0, r.v) * 0.35, aim);
    const want = Math.atan2(look.z - r.z, look.x - r.x);
    const err = Math.atan2(Math.sin(want - r.h), Math.cos(want - r.h));
    return Math.max(-1, Math.min(1, err * 2.4 - (r.d - aim) * 0.04));
  };
  const pilot = async () => {
    while (auto) {
      for (const [name, page] of [["Ana", a], ["Ben", b]]) {
        const s = await state(page).catch(() => null);
        const r = s?.racers.find((q) => q.name === name);
        if (r) await pose(page, wheel(turnFor(steerOf(r, s)), grips[name])).catch(() => {});
      }
      await new Promise((ok) => setTimeout(ok, 40));
    }
  };
  const piloting = pilot();
  // Drift + release: entering a corner, hold DRIFT until the sparks reach level 1, let go.
  // (Retried at the next corner if an item hit or a wall ends the drift first.)
  const btn = async (p, id) => {
    const box = await p.locator(id).boundingBox();
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
  const [dx, dy] = await btn(a, "#driftBtn");
  let drifted = false,
    charged = 0;
  for (let attempt = 0; attempt < 5 && !drifted; attempt++) {
    // Wait for a bend ahead.
    const until = Date.now() + slow(20000);
    for (;;) {
      const r = await me(a, "Ana");
      if (r.v > 12 && !r.spin && Math.abs(t.k[pointAt(t, r.s + 14).i]) > 0.012) break;
      if (Date.now() > until) throw Error("no corner reached");
      await a.waitForTimeout(50);
    }
    const boostsBefore = (await me(a, "Ana")).boosts;
    await a.mouse.move(dx, dy);
    await a.mouse.down();
    charged = 0;
    for (let i = 0; i < 30; i++) {
      await a.waitForTimeout(100);
      const r = await me(a, "Ana");
      charged = Math.max(charged, r.drift ? r.charge : 0);
      if (process.env.DEBUG) console.log("drift", r.drift, r.charge.toFixed(2), "v", r.v.toFixed(1), "d", r.d.toFixed(1), "steer", r.steer);
      if (r.charge >= 1.2 || (!r.drift && i > 8)) break;
    }
    await a.mouse.up();
    await a.waitForTimeout(slow(300));
    drifted = charged >= 1 && (await me(a, "Ana")).boosts > boostsBefore;
    if (!drifted) await a.waitForTimeout(1500);
  }
  assert.ok(drifted, "drift charged to level 1+ and letting go gave a boost (charge " + charged.toFixed(2) + ")");
  if (SHOTS) await tv.screenshot({ path: SHOTS + "/kart-drift.png" });
  // An item: drive through a row of cubes, wait for the roulette, then use it.
  await a.waitForFunction(() => window.__kartPhone.state.racers.find((q) => q.name === "Ana").item, null, { timeout: slow(40000) });
  const held = await me(a, "Ana");
  const [ix, iy] = await btn(a, "#itemBtn");
  await a.mouse.click(ix, iy);
  await a.waitForFunction((u) => {
    const r = window.__kartPhone.state.racers.find((q) => q.name === "Ana");
    return r.uses < u || !r.item;
  }, held.uses, { timeout: slow(4000) });
  console.log("Item picked up and used:", held.item);
  // A lap: the one-lap race finishes for both phones, then the TV shows the results.
  await a.waitForFunction(() => window.__kartPhone.state.racers.find((q) => q.name === "Ana").lap >= 2, null, { timeout: slow(60000) });
  const done = await me(a, "Ana");
  assert.ok(done.finished > 0 && done.laps.length === 1, "lap counted with a lap time: " + JSON.stringify(done.laps));
  await tv.locator("#results").waitFor({ state: "visible", timeout: slow(60000) });
  auto = false;
  await piloting;
  const table = await tv.locator("#resTable").textContent();
  assert.ok(table.includes("Ana") && table.includes("Ben"), "results list both drivers");
  assert.match(await a.locator("#pStatus").textContent(), /pts|\d(st|nd|rd|th)/);
  if (SHOTS) await tv.screenshot({ path: SHOTS + "/kart-results.png" });
  assert.deepEqual(errors, [], "no page errors");
  console.log("Kart smoke OK: hub → kart, two phones, split screen, steering, drift boost, item, lap, results");
} finally {
  await browser?.close();
  child.kill();
}
