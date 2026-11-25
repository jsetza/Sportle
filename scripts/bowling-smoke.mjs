/**
 * Sportle Bowling browser smoke test. Real server, real browser pages and HTTP/SSE; the phones
 * are pages with SYNTHETIC sensor events (NOT a physical phone test).
 * TV + two phones join one room → phone setup → turns alternate → only the phone that is up
 * is armed (a bowl from the other phone does nothing) → a full frame scores. The server-side
 * rejection of swings from phones that are not up is covered by tests/bowling.test.ts.
 * Optional: SHOTS=<dir> saves screenshots along the way.
 */
import { chromium } from "playwright";
import { patientBrowser, slow } from "./patient.mjs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import { UPRIGHT, tilted, bowl, joinPhone as joinPhoneAt } from "./bowling-phone.mjs";

const PORT = 31494;
const SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const child = spawn(process.execPath, ["src/server/index.ts"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
const BASE = `http://127.0.0.1:${PORT}`;
const joinPhone = (page, room, name) => joinPhoneAt(page, BASE, room, name);
try {
  await new Promise((ok, no) => {
    child.stdout.once("data", ok);
    child.once("exit", (c) => no(Error("Server exited " + c)));
    setTimeout(() => no(Error("Server startup timeout")), 5000).unref();
  });
  browser = patientBrowser(await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  }));
  const errors = [];
  const tv = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ctxA.newPage(),
    b = await ctxB.newPage();
  for (const p of [tv, a, b]) p.on("pageerror", (e) => errors.push(e.message));
  // Start screen: the hub shows both games; Bowling opens the bowling page.
  await tv.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  // Welcome intro first, then the side-scrolling picker: any key skips the intro, → moves to
  // Bowling, Enter plays it.
  await tv.locator("#hubIntro").waitFor({ state: "visible" });
  assert.match(await tv.locator("#hubIntro").textContent(), /Welcome to/);
  if (SHOTS) {
    await tv.waitForTimeout(2400);
    await tv.screenshot({ path: SHOTS + "/hub-intro.png" });
  }
  await tv.keyboard.press("x"); // any key (a letter does nothing once the picker is up)
  await tv.locator("#hubPick").waitFor({ state: "visible" });
  assert.ok(await tv.locator("#play.active").isVisible(), "Pickleball is picked first");
  assert.equal(await tv.locator("#playBowling").getAttribute("href"), "/bowling");
  await tv.keyboard.press("ArrowRight");
  await tv.locator("#playBowling.active").waitFor();
  if (SHOTS) {
    await tv.waitForTimeout(700);
    await tv.screenshot({ path: SHOTS + "/hub.png" });
  }
  await tv.keyboard.press("Enter");
  await tv.waitForURL(/\/bowling$/);
  // Coming back from Bowling skips the intro and goes straight to the picker.
  await tv.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  await tv.locator("#hubPick").waitFor({ state: "visible" });
  assert.equal(await tv.locator("#hubIntro").isVisible(), false);
  await tv.goto(`http://127.0.0.1:${PORT}/bowling#test`);
  await tv.locator("#goMulti").click();
  await tv.locator("label[for=bl-neon]").click();
  await tv.locator("#create").click();
  await tv.locator("#lobby").waitFor({ state: "visible" });
  const room = (await tv.locator("#roomcode").textContent()).trim();
  assert.match(room, /^[A-F0-9]{6}$/);
  assert.match(await tv.locator("#pairHint").textContent(), /HTTPS/);
  await joinPhone(a, room, "Ana");
  await joinPhone(b, room, "Ben");
  await tv.locator("#order li", { hasText: "Ben" }).waitFor();
  await tv.waitForFunction(() => window.__bowlScene.bowl?.players.every((p) => p.ready));
  if (SHOTS) await tv.screenshot({ path: SHOTS + "/lobby.png" });
  await tv.locator("#start").click();
  // Music & sound like Pickleball: music started on the first click and plays during the game.
  await tv.waitForFunction(() => { const m = window.__sportleMusic; return m?.ctx?.state === "running" && (m.filePlaying || m.playing); }, null, { timeout: slow(8000) });
  assert.ok(await tv.locator("#settingsOpen").isVisible(), "Music & sound button");
  await tv.waitForFunction(() => window.__bowlScene.bowl?.phase === "aim");
  const state = () => tv.evaluate(() => window.__bowlScene.bowl);
  const phones = { Ana: a, Ben: b };
  const armed = async (p) => p.evaluate(() => document.body.classList.contains("myturn"));
  const seen = [];
  // Frame 1 for both bowlers (two or one balls each), then the first ball of frame 2.
  for (let k = 0; k < 6; k++) {
    let s = await state();
    if (s.frame >= 1 && seen.filter((n) => n === "Ana").length && s.players[s.turn].name === "Ana" && s.ballNo === 0 && k > 1) break;
    const upName = s.players[s.turn].name,
      other = upName === "Ana" ? "Ben" : "Ana";
    await phones[upName].waitForFunction(() => document.body.classList.contains("myturn"));
    assert.equal(await armed(phones[other]), false, `${other} must not be armed while ${upName} is up`);
    assert.match(await phones[other].locator("#igTitle").textContent(), /next|line/i);
    // The phone that isn't up swings: nothing happens on the server.
    const before = s.bowls;
    await bowl(phones[other]);
    await tv.waitForTimeout(300);
    s = await state();
    assert.equal(s.bowls, before, "a bowl from a phone that is not up does nothing");
    assert.equal(s.phase, "aim");
    // The phone that is up bowls. Ana's first ball: wrist rolled left, so the TV's curve
    // indicator reads a hook before the bowl, and the ball hooks left.
    const hookBall = upName === "Ana" && k === 0;
    if (hookBall) {
      await phones.Ana.evaluate((p) => (window.testPose = p), tilted(-30));
      await tv.waitForFunction(() => /HOOK/.test(document.getElementById("turn").textContent), null, { timeout: slow(3000) });
      if (SHOTS) await tv.screenshot({ path: SHOTS + "/aim-hook.png" });
      if (SHOTS) await phones.Ana.screenshot({ path: SHOTS + "/phone-turn.png" });
    }
    // Hold-to-bowl: only the phone that is up shows the button; the TV shows a predicted path,
    // and for the hooking ball that path bends left.
    assert.ok(await phones[upName].locator("#bowlBtn").isVisible(), "hold-to-bowl button on the phone that is up");
    assert.equal(await phones[other].locator("#bowlBtn").isVisible(), false);
    const aim = (await state()).aim;
    assert.ok(aim.length >= 20, "predicted path shown");
    if (hookBall) assert.ok(aim[aim.length - 2] < -0.1, "predicted path bends left for a left tilt: " + aim[aim.length - 2]);
    assert.ok(await phones[upName].locator("#pLane polyline.paim").count(), "phone shows the predicted path");
    await bowl(phones[upName]);
    if (hookBall) await phones.Ana.evaluate((p) => (window.testPose = p), UPRIGHT);
    await tv.waitForFunction((n) => window.__bowlScene.bowl.bowls === n, before + 1, { timeout: slow(4000) });
    seen.push(upName);
    if (SHOTS && k === 0) {
      await tv.waitForTimeout(1300);
      await tv.screenshot({ path: SHOTS + "/rolling.png" });
    }
    await tv.waitForFunction(() => window.__bowlScene.bowl.phase === "result", null, { timeout: slow(12000) });
    if (SHOTS && k === 0) await tv.screenshot({ path: SHOTS + "/result.png" });
    assert.ok((await state()).trail.length >= 20, "the ball's real path is kept for the result");
    if (hookBall) {
      const shot = (await state()).shot;
      assert.ok(shot.boards <= -3, "a tilted-left release hooks left: " + shot.boards + " boards");
    }
    await tv.waitForFunction(() => window.__bowlScene.bowl.phase === "aim" || window.__bowlScene.bowl.phase === "over", null, { timeout: slow(8000) });
  }
  const s = await state();
  // Turns alternate frame by frame: Ana's frame 1, then Ben's frame 1.
  const firstBen = seen.indexOf("Ben");
  assert.ok(firstBen >= 1 && seen.slice(0, firstBen).every((n) => n === "Ana"), "Ana bowls frame 1 first: " + seen);
  // Ana's frame 1 scores correctly on the TV sheet.
  const ana = s.players.find((p) => p.name === "Ana");
  const [r1, r2] = ana.rolls;
  const sheetRow = await tv.locator("#sheet tr", { hasText: "Ana" }).first().textContent();
  if (r1 + r2 < 10) assert.ok(sheetRow.includes(String(r1 + r2)), `frame total ${r1 + r2} in "${sheetRow}"`);
  assert.ok(s.shot && s.shot.kmh > 0, "speed readout");
  for (const p of [a, b]) {
    const txt = await p.locator("#igStatus").textContent();
    assert.match(txt, /Score|Up now|Backswing/);
  }
  if (SHOTS) {
    // First person: aiming, the ball rolling away, and the result.
    await tv.evaluate(() => (window.__bowlScene.viewMode2 = "first"));
    await tv.waitForTimeout(500);
    await tv.screenshot({ path: SHOTS + "/first-aim.png" });
    const st = await state();
    if (st.phase === "aim") {
      await bowl(phones[st.players[st.turn].name]);
      await tv.waitForTimeout(700);
      await tv.screenshot({ path: SHOTS + "/first-rolling.png" });
      await tv.waitForFunction(() => window.__bowlScene.bowl.phase === "result", null, { timeout: slow(12000) });
      await tv.waitForTimeout(300);
      await tv.screenshot({ path: SHOTS + "/first-result.png" });
    }
    for (const v of ["behind", "broadcast"]) {
      await tv.evaluate((v) => (window.__bowlScene.viewMode2 = v), v);
      await tv.waitForTimeout(400);
      await tv.screenshot({ path: `${SHOTS}/view-${v}.png` });
    }
    await a.screenshot({ path: SHOTS + "/phone.png" });
  }
  assert.deepEqual(errors, []);
  console.log("Bowling smoke passed: one QR, two phones, turns alternate, only the bowler who is up is armed, frame scored.", seen.join(" → "));
} finally {
  await browser?.close();
  child.kill();
}
