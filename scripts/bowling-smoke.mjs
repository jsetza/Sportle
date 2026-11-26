/**
 * Sportle Bowling browser smoke test. Real server, real browser pages and HTTP/SSE; the phones
 * are pages with SYNTHETIC sensor events (NOT a physical phone test).
 * TV + two phones join one room → phone setup → turns alternate → only the phone that is up
 * is armed (a bowl from the other phone does nothing) → a full frame scores. The server-side
 * rejection of swings from phones that are not up is covered by tests/bowling.test.ts.
 * Optional: SHOTS=<dir> saves screenshots along the way. THROTTLE=<n> slows the pages' CPU n×
 * (Chrome DevTools CPU throttling), to reproduce slow CI machines locally. SLOWTV=<scale> renders the TV
 * at that device-pixel scale in software (SwiftShader), so it draws only a frame every second or
 * more, like GitHub's GPU-less runners.
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
// Server errors (a caught simulation error pauses the game and is only logged there).
let serverErr = "";
child.stderr.on("data", (d) => (serverErr = (serverErr + d).slice(-4000)));
let browser;
const BASE = `http://127.0.0.1:${PORT}`;
/**
 * Server-side phase log: the test polls the server's own state (not the TV page) every 100 ms,
 * so a timeout can say what really happened even when the TV page is too slow to keep up.
 */
const phaseLog = [];
/** The server's own result for each ball (keyed by the bowl count): trail and shot. */
const results = new Map();
let watcher = null;
function watchServer(room, credential) {
  let last = "";
  const t0 = Date.now();
  watcher = setInterval(async () => {
    try {
      const r = await fetch(`${BASE}/api/state?room=${room}`, { headers: { authorization: "Bearer " + credential } });
      const { state: b } = await r.json();
      const key = [b.phase, b.bowls, b.turn, b.ballNo].join("|");
      if (b.phase === "result" && !results.has(b.bowls))
        results.set(b.bowls, { trail: b.trail, shot: b.shot });
      if (key !== last) {
        last = key;
        phaseLog.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${b.phase} bowls=${b.bowls} turn=${b.players[b.turn]?.name} frame=${b.frame + 1} ball=${b.ballNo + 1} sim=${b.time.toFixed(1)} "${b.message}"`);
      }
    } catch {}
  }, 100);
}
/** What the TV page and the server showed, for a failed wait. */
async function diag(tv, what) {
  const tvState = await tv
    .evaluate(() => { const b = window.__bowlScene.bowl; return b && { phase: b.phase, bowls: b.bowls, turn: b.players[b.turn]?.name, ballNo: b.ballNo, message: b.message, time: b.time }; })
    .catch((e) => "unavailable: " + e.message);
  console.error(`\n--- ${what} timed out ---\nTV page state: ${JSON.stringify(tvState)}\nServer phases (newest last):\n  ${phaseLog.slice(-25).join("\n  ")}\nServer stderr (last 4 kB):\n${serverErr.replace(/.*ExperimentalWarning.*\n.*trace-warnings.*\n?/g, "") || "(none)"}\n`);
}
/**
 * Wait for the server to score this ball. The result shows for only 2.2 s; a TV page drawing a
 * frame every few seconds (CI without a GPU) can miss it entirely, so the server's state, polled
 * every 100 ms, is the source of truth here.
 */
async function serverResult(tv, bowls, timeout) {
  const end = Date.now() + timeout;
  while (!results.has(bowls)) {
    if (Date.now() > end) {
      await diag(tv, "result of ball " + bowls);
      throw Error("No result for ball " + bowls + " within " + timeout + " ms");
    }
    await new Promise((ok) => setTimeout(ok, 100));
  }
  return results.get(bowls);
}
/** Wait on the TV page, printing the TV and server state if it times out. */
async function tvWait(tv, what, fn, arg, timeout) {
  try {
    // Checked on a timer, not once per drawn frame: on GPU-less CI runners the TV draws a frame
    // only every second or so.
    await tv.waitForFunction(fn, arg, { timeout, polling: 100 });
  } catch (e) {
    await diag(tv, what);
    throw e;
  }
}
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
  const tv = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    ...(process.env.SLOWTV ? { deviceScaleFactor: Number(process.env.SLOWTV) } : {}),
  });
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ctxA.newPage(),
    b = await ctxB.newPage();
  if (process.env.THROTTLE)
    for (const p of [tv, a, b]) {
      const cdp = await p.context().newCDPSession(p);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE) });
    }
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
  // The picked game's own scene fills the screen above the strip, with its name and Play.
  await tv.waitForFunction(() => document.getElementById("hubName").textContent.trim() === "Bowling", null, { timeout: slow(3000), polling: 100 });
  await tv.locator("#hubStage .hubscene.on").waitFor({ state: "visible" });
  const [stripH, screenH] = await tv.evaluate(() => [document.querySelector(".hubstrip").getBoundingClientRect().height, innerHeight]);
  assert.ok(stripH <= screenH / 6 + 1, `game strip takes at most a sixth of the screen: ${stripH} of ${screenH}`);
  assert.equal(await tv.locator("#joinAt").count(), 0, "no 'Phones join at' label");
  if (SHOTS) {
    await tv.waitForTimeout(700);
    await tv.screenshot({ path: SHOTS + "/hub.png" });
  }
  await tv.keyboard.press("Enter");
  await tv.waitForURL(/\/bowling$/, { waitUntil: "commit" });
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
  watchServer(room, JSON.parse(await tv.evaluate(() => sessionStorage.getItem("bowl-host"))).credential);
  assert.match(room, /^[A-F0-9]{6}$/);
  assert.match(await tv.locator("#pairHint").textContent(), /HTTPS/);
  await joinPhone(a, room, "Ana");
  await joinPhone(b, room, "Ben");
  await tv.locator("#order li", { hasText: "Ben" }).waitFor();
  await tv.waitForFunction(() => window.__bowlScene.bowl?.players.every((p) => p.ready), null, { polling: 100 });
  if (SHOTS) await tv.screenshot({ path: SHOTS + "/lobby.png" });
  // The lobby message follows the phones (it used to keep saying "Scan the QR to join").
  await tv.waitForFunction(() => /Everyone's ready/.test(document.getElementById("message").textContent), null, { timeout: slow(5000), polling: 100 });
  // Connected phones show the green dot (the class the shared CSS styles is "live").
  for (const p of [a, b]) await p.waitForFunction(() => document.getElementById("pDot").classList.contains("live"));
  await tv.locator("#start").click();
  // Music & sound like Pickleball: music started on the first click and plays during the game.
  await tv.waitForFunction(() => { const m = window.__sportleMusic; return m?.ctx?.state === "running" && (m.filePlaying || m.playing); }, null, { timeout: slow(8000), polling: 100 });
  assert.ok(await tv.locator("#settingsOpen").isVisible(), "Music & sound button");
  await tv.waitForFunction(() => window.__bowlScene.bowl?.phase === "aim", null, { polling: 100 });
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
      await tv.waitForFunction(() => /HOOK/.test(document.getElementById("turn").textContent), null, { timeout: slow(3000), polling: 100 });
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
    await tvWait(tv, "ball released", (n) => window.__bowlScene.bowl.bowls === n, before + 1, slow(4000));
    seen.push(upName);
    if (SHOTS && k === 0) {
      await tv.waitForTimeout(1300);
      await tv.screenshot({ path: SHOTS + "/rolling.png" });
    }
    const result = await serverResult(tv, before + 1, slow(12000));
    if (SHOTS && k === 0) await tv.screenshot({ path: SHOTS + "/result.png" });
    assert.ok(result.trail.length >= 20, "the ball's real path is kept for the result");
    if (hookBall) {
      const shot = result.shot;
      assert.ok(shot.boards <= -3, "a tilted-left release hooks left: " + shot.boards + " boards");
    }
    await tvWait(tv, "next ball", () => window.__bowlScene.bowl.phase === "aim" || window.__bowlScene.bowl.phase === "over", null, slow(8000));
  }
  // The scoresheet doesn't cover the top bar's buttons (View, Music & sound, …).
  const covered = await tv.evaluate(() => {
    const r = document.getElementById("sheet").getBoundingClientRect();
    return [...document.querySelectorAll(".topbar nav > *")]
      .filter((e) => { const q = e.getBoundingClientRect(); return q.width && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top; })
      .map((e) => e.textContent.trim());
  });
  assert.deepEqual(covered, [], "scoresheet covers top-bar buttons");
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
      await tv.waitForFunction(() => window.__bowlScene.bowl.phase !== "rolling", null, { timeout: slow(12000), polling: 100 });
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
  // The phone that is up goes away: the TV waits for it, then (after 30 s) shows Skip turn and
  // Let a bot bowl where the host can see them (the Room panel opens), and Skip works.
  {
    await tv.waitForFunction(() => window.__bowlScene.bowl.phase === "aim", null, { timeout: slow(15000), polling: 100 });
    const st = await state();
    const away = st.players[st.turn].name;
    await phones[away].close();
    await tv.waitForFunction((n) => new RegExp("Waiting for " + n).test(document.getElementById("message").textContent), away, { timeout: slow(8000), polling: 100 });
    await tv.locator("#skip").waitFor({ state: "visible", timeout: slow(40000) });
    // The Room panel slides in (0.45 s): the button must end up fully on screen.
    await tv
      .waitForFunction(() => { const r = document.getElementById("skip").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }, null, { timeout: slow(3000), polling: 100 })
      .catch(async () => assert.fail("Skip turn is off screen: " + JSON.stringify(await tv.locator("#skip").boundingBox())));
    await tv.locator("#skip").click();
    await tv.waitForFunction((n) => { const b = window.__bowlScene.bowl; return b.players[b.turn].name !== n; }, away, { timeout: slow(5000), polling: 100 });
    await tv.waitForFunction(() => !document.body.classList.contains("panel-open"), null, { timeout: slow(5000), polling: 100 });
  }
  // Game over, Bowl again and Change game: a single-player game skipped to the end by the host.
  {
    const ctxT = await browser.newContext({ viewport: { width: 1280, height: 720 } }),
      ctxC = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const tv2 = await ctxT.newPage(),
      c = await ctxC.newPage();
    for (const p of [tv2, c]) p.on("pageerror", (e) => errors.push(e.message));
    await tv2.goto(BASE + "/bowling#test");
    await tv2.locator("#goSingle").click();
    await tv2.locator("#create").click();
    await tv2.locator("#lobby").waitFor({ state: "visible" });
    const room2 = (await tv2.locator("#roomcode").textContent()).trim();
    await joinPhone(c, room2, "Cy");
    await tv2.waitForFunction(() => window.__bowlScene.bowl?.players[0]?.ready, null, { polling: 100 });
    const skipAll = () =>
      tv2.evaluate(async () => {
        const h = JSON.parse(sessionStorage.getItem("bowl-host"));
        for (let i = 0; i < 10; i++) {
          const r = await fetch("/api/bowl/skip?room=" + h.room, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer " + h.credential },
            body: "{}",
          });
          if (!r.ok) return await r.text();
        }
        return "ok";
      });
    await tv2.locator("#start").click();
    await tv2.waitForFunction(() => window.__bowlScene.bowl?.phase === "aim", null, { polling: 100 });
    assert.equal(await skipAll(), "ok");
    await tv2.locator("#gameover").waitFor({ state: "visible", timeout: slow(5000) });
    // Bowl again: a fresh game with the same phone.
    await tv2.locator("#again").click();
    await tv2.waitForFunction(() => { const b = window.__bowlScene.bowl; return b.phase === "aim" && b.players[0].rolls.length === 0; }, null, { timeout: slow(5000), polling: 100 });
    assert.equal(await tv2.locator("#gameover").isVisible(), false);
    assert.equal(await skipAll(), "ok");
    await tv2.locator("#gameover").waitFor({ state: "visible", timeout: slow(5000) });
    // With the phone gone, Bowl again says why on the card instead of doing nothing.
    await c.close();
    await tv2.waitForFunction(() => window.__bowlScene.bowl.players[0].connected === false, null, { timeout: slow(8000), polling: 100 });
    await tv2.locator("#again").click();
    await tv2.waitForFunction(() => /Waiting for Cy/.test(document.getElementById("goErr").textContent), null, { timeout: slow(5000), polling: 100 });
    assert.ok(await tv2.locator("#goErr").isVisible(), "the reason shows on the game-over card");
    // Change game: back to the bowling menu, not back into this finished room.
    await tv2.locator("#changeGame").click();
    await tv2.waitForURL(/\/bowling$/, { waitUntil: "commit", timeout: slow(20000) });
    await tv2.locator("#goSingle").waitFor({ state: "visible", timeout: slow(60000) }).catch(async (e) => {
      const info = await tv2.evaluate(() => ({
        url: location.href,
        body: document.body.className,
        setup: !!document.getElementById("setup") && getComputedStyle(document.getElementById("setup")).display,
        lobby: !!document.getElementById("lobby") && !document.getElementById("lobby").classList.contains("hidden"),
        host: sessionStorage.getItem("bowl-host"),
        error: document.getElementById("error")?.textContent,
      })).catch((x) => "unavailable: " + x.message);
      console.error("Change game didn't reach the menu:", JSON.stringify(info), "page errors:", errors);
      if (process.env.SHOTS) await tv2.screenshot({ path: process.env.SHOTS + "/change-game.png" });
      throw e;
    });
    await ctxT.close();
    await ctxC.close();
  }
  assert.deepEqual(errors, []);
  console.log("Bowling smoke passed: one QR, two phones, turns alternate, only the bowler who is up is armed, frame scored.", seen.join(" → "));
} finally {
  clearInterval(watcher);
  await browser?.close();
  child.kill();
}
