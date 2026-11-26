/**
 * Kart exploration (developer tool, not part of the test suite): drives many TV and phone flows
 * with synthetic phones and reports problems: console errors, HUD/layout issues, split screen,
 * drop → bot → rejoin, results/next/change track, memory growth across races.
 * Run: node scripts/dev/kart-explore.mjs [outDir]
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { joinPhone, wheel, pose } from "../kart-phone.mjs";
import { track, pointAt } from "../../src/shared/kart.ts";

const OUT = process.argv[2] || "";
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const PORT = 31581,
  BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/server/index.ts"], { env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
let serverErr = "";
child.stderr.on("data", (d) => (serverErr += d));
await new Promise((ok) => child.stdout.once("data", ok));
const browser = await chromium.launch({ headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-precise-memory-info"] });
const problems = [];
const note = (m) => {
  problems.push(m);
  console.log("PROBLEM:", m);
};
const errors = [];
const watch = (p, name) => {
  p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`${name} console: ${m.text()}`));
};
/** Phone setup after joining (motion → centre → range if asked). */
async function setupOnly(p, grip) {
  await p.locator("#hold").waitFor({ state: "visible" });
  await p.locator("#hold").click();
  await p.evaluate((pose) => { window.testPose = pose; clearInterval(window.testSensors); window.testSensors = setInterval(() => { window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", window.testPose)); window.dispatchEvent(new DeviceMotionEvent("devicemotion", { acceleration: { x: 0, y: 0, z: 0 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 } })); }, 16); }, wheel(0, grip));
  await p.locator("#stepTag", { hasText: "CENTRE" }).waitFor();
  const box = await p.locator("#hold").boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(1500);
  await p.mouse.up();
  if (await p.locator("#stepTag", { hasText: "RANGE" }).isVisible()) {
    await pose(p, wheel(38, grip));
    await p.locator("#stepTitle", { hasText: "right" }).waitFor({ timeout: 6000 });
    await pose(p, wheel(-38, grip));
  }
  await p.locator("#race").waitFor({ state: "visible", timeout: 8000 });
  await pose(p, wheel(0, grip));
}
const shot = async (p, n) => OUT && p.screenshot({ path: `${OUT}/${n}.png` });
try {
  const tv = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(tv, "tv");
  await tv.goto(`${BASE}/kart?laps=1#test`);
  // ——— Menu: cups and track picker ———
  await tv.locator("#goMulti").click();
  await tv.locator("label[for=km-cup]").click();
  if (!(await tv.locator("#cupRow").isVisible())) note("cup row hidden in cup mode");
  await tv.locator("label[for=kc-wild]").click();
  const hint = await tv.locator("#trackHint").textContent();
  if (!/Frost Pass/.test(hint)) note("wild cup hint: " + hint);
  if (await tv.locator(".mappick").isVisible()) note("track picker visible in cup mode");
  await tv.locator("label[for=km-race]").click();
  if (!(await tv.locator(".mappick").isVisible())) note("track picker hidden after leaving cup mode");
  if (await tv.locator("label[for=km-trial]").isVisible()) note("time trial offered in multiplayer");
  await tv.locator("label[for=kt-stadium]").click();
  await shot(tv, "menu");
  await tv.locator("#create").click();
  await tv.locator("#lobby").waitFor({ state: "visible" });
  const room = (await tv.locator("#roomcode").textContent()).trim();
  const k0 = await tv.evaluate(() => window.__kartScene.kart);
  if (k0.track !== "stadium") note("created on " + k0.track);
  // ——— Phones: 4 (both grips; one starts in portrait) ———
  const phones = [];
  const grips = [1, -1, 1, -1];
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext({ viewport: i === 2 ? { width: 390, height: 844 } : { width: 844, height: 390 } });
    const p = await ctx.newPage();
    watch(p, "phone" + i);
    phones.push({ p, ctx, name: ["Ana", "Ben", "Cy", "Dee"][i], grip: grips[i] });
  }
  // Portrait phone: the join form works in portrait; after joining, the turn card shows.
  const pc = phones[2];
  await pc.p.goto(`${BASE}/kart/phone?room=${room}#test`);
  await shot(pc.p, "phone-portrait-join");
  const formOk = await pc.p.evaluate(() => {
    const b = document.getElementById("connect").getBoundingClientRect();
    return b.bottom <= document.documentElement.scrollHeight && b.width > 100;
  });
  if (!formOk) note("portrait join button off-screen");
  for (const ph of phones) {
    if (ph === pc) {
      await pc.p.locator("#nickname").fill(pc.name);
      await pc.p.locator("#connect").click();
      await pc.p.locator("#hold").waitFor({ state: "attached" });
      await pc.p.waitForTimeout(500);
      if (!(await pc.p.locator("#turn").isVisible())) note("portrait: no 'turn sideways' card after joining");
      await shot(pc.p, "phone-portrait-turn");
      await pc.p.setViewportSize({ width: 844, height: 390 });
      await pc.p.waitForTimeout(300);
      if (await pc.p.locator("#turn").isVisible()) note("turn card stays after rotating to landscape");
      await setupOnly(pc.p, 1).catch((e) => note("portrait phone setup: " + e.message.split("\n")[0]));
      continue;
    }
    await joinPhone(ph.p, BASE, room, ph.name, { grip: ph.grip });
  }
  await tv.waitForFunction(() => window.__kartScene.kart?.racers.filter((r) => !r.bot).length === 5 || window.__kartScene.kart?.racers.filter((r) => !r.bot).length === 4, null, { timeout: 15000 });
  const humans = await tv.evaluate(() => window.__kartScene.kart.racers.filter((r) => !r.bot).map((r) => r.name));
  console.log("humans:", humans);
  if (humans.length !== 4) note("expected 4 humans in the lobby, got " + humans.length + " " + humans);
  await shot(tv, "lobby");
  await shot(phones[0].p, "phone-landscape-ready");
  // ——— Phone menu settings ———
  const a = phones[0].p;
  await a.locator("#menuBtn").click();
  await a.locator("#menu").waitFor({ state: "visible" });
  await shot(a, "phone-menu");
  if (!(await a.locator("#pauseRace").isDisabled())) note("phone pause enabled in a multi-driver race");
  await a.locator("#sensSeg button[data-v=sharp]").click();
  await a.locator("#assistSeg button[data-v=off]").click();
  await a.locator("#gasSeg button[data-v=tilt]").click();
  const saved = await a.evaluate(() => [localStorage.getItem("kart-sens"), localStorage.getItem("kart-assist"), localStorage.getItem("kart-gas"), window.__kartPhone.reader.sensitivity]);
  if (saved.join() !== "sharp,off,tilt,sharp") note("menu settings not saved: " + saved);
  const menuFits = await a.evaluate(() => {
    const d = document.getElementById("menu").getBoundingClientRect();
    return d.top >= -1 && d.bottom <= innerHeight + 1;
  });
  if (!menuFits) note("phone menu taller than the landscape screen (844×390): needs scrolling");
  await a.locator("#gasSeg button[data-v=auto]").click();
  await a.locator("#assistSeg button[data-v=on]").click();
  await a.locator("#sensSeg button[data-v=normal]").click();
  await a.locator("#menuClose").click();
  // ——— Race ———
  const t = track("stadium");
  const measure = () =>
    tv.evaluate(() => ({
      heap: performance.memory ? performance.memory.usedJSHeapSize : 0,
      nodes: document.getElementsByTagName("*").length,
      tags: window.__kartScene.tagEls.size,
      shown: window.__kartScene.shown.size,
      cams: window.__kartScene.cams.size,
      tape: window.__kartScene.tape.length,
    }));
  const mem = [];
  let auto = true;
  const steerOf = (r) => {
    const look = pointAt(t, r.s + 9 + Math.max(0, r.v) * 0.35, 0);
    const err = Math.atan2(Math.sin(Math.atan2(look.z - r.z, look.x - r.x) - r.h), Math.cos(Math.atan2(look.z - r.z, look.x - r.x) - r.h));
    return Math.max(-1, Math.min(1, err * 2.4 - r.d * 0.04));
  };
  const turnFor = (s) => {
    const q = Math.min(1, Math.abs(s));
    if (q < 0.005) return 0;
    const u = (-0.3 + Math.sqrt(0.09 + 2.8 * q)) / 1.4;
    return -Math.sign(s) * (0.06 + u * 0.94) * 38 * 0.85;
  };
  const pilot = async () => {
    while (auto) {
      for (const ph of phones) {
        if (ph.p.isClosed()) continue;
        const s = await ph.p.evaluate(() => window.__kartPhone?.state).catch(() => null);
        const r = s?.racers.find((q) => q.name === ph.name || (ph === pc && q.name === "Cy"));
        if (r) await pose(ph.p, wheel(turnFor(steerOf(r)), ph.grip === -1 ? -1 : 1)).catch(() => {});
      }
      await new Promise((ok) => setTimeout(ok, 60));
    }
  };
  for (let raceNo = 0; raceNo < 3; raceNo++) {
    if (raceNo === 0) await tv.locator("#start").click();
    await tv.waitForFunction(() => window.__kartScene.kart.phase === "countdown", null, { timeout: 15000 });
    if (raceNo === 0) {
      await tv.waitForTimeout(800);
      if (!(await tv.locator("#kcount").isVisible())) note("no countdown on the TV");
      const st = await a.locator("#pStatus").textContent();
      if (!/start boost/i.test(st)) note("phone countdown hint missing: " + st);
      await shot(tv, "countdown-4split");
    }
    await tv.waitForFunction(() => window.__kartScene.kart.phase === "race", null, { timeout: 15000 });
    const views = await tv.locator(".kview").count();
    if (views !== 4) note(`race ${raceNo}: ${views} views for 4 local phones`);
    auto = true;
    const piloting = pilot();
    if (raceNo === 0) {
      await tv.waitForTimeout(4000);
      await shot(tv, "race-4split");
      // HUD inside each quadrant
      const rects = await tv.evaluate(() => [...document.querySelectorAll(".kview")].map((v) => { const b = v.getBoundingClientRect(); const p = v.querySelector(".kplace").getBoundingClientRect(); return { b: [b.left, b.top, b.width, b.height], p: [p.left, p.top, p.width, p.height] }; }));
      for (const r of rects) if (r.p[1] + r.p[3] > r.b[1] + r.b[3] + 2 || r.p[0] < r.b[0] - 2) note("place HUD outside its quadrant " + JSON.stringify(r));
      // Cameras: each mode, and the shared layout.
      for (const v of ["bumper", "broadcast", "chase"]) {
        await tv.keyboard.press("v");
        await tv.waitForTimeout(1200);
        await shot(tv, "cam-" + (await tv.locator("#view").textContent()).replace(/\W+/g, "-"));
      }
      await tv.locator("#layout").click();
      await tv.waitForFunction(() => document.querySelectorAll(".kview").length === 1, null, { timeout: 5000 }).catch(() => note("shared layout didn't switch to one view"));
      if (!(await tv.locator("#kboard").isVisible())) note("shared view without the leaderboard");
      await shot(tv, "shared");
      await tv.locator("#layout").click();
      await tv.waitForFunction(() => document.querySelectorAll(".kview").length === 4, null, { timeout: 5000 }).catch(() => note("couldn't switch back to split"));
      // ——— Drop: close Dee's phone; the kart waits; the host lets a bot drive; Dee rejoins.
      const dee = phones[3];
      await dee.p.close();
      await tv.waitForFunction(() => window.__kartScene.kart.racers.find((r) => r.name === "Dee").away > 0, null, { timeout: 10000 }).catch(() => note("Dee's drop not noticed in 10 s"));
      const waitTxt = await tv.locator(".kwait:not(.hidden)").first().textContent().catch(() => "");
      if (!/Waiting for Dee/.test(waitTxt)) note("no 'Waiting for Dee's phone' on the TV: " + waitTxt);
      await shot(tv, "dee-waiting");
      const botBtn = tv.locator("#drivers [data-bot]");
      if (!(await botBtn.count())) note("no 'Let a bot drive' button for the host");
      else {
        // The panel is hidden while racing: open it first like the host would.
        await tv.locator("#panelToggle").click();
        await botBtn.first().click().catch((e) => note("bot button click: " + e.message.split("\n")[0]));
        await tv.locator("#panelToggle").click();
      }
      await tv.waitForFunction(() => window.__kartScene.kart.racers.find((r) => r.name === "Dee").botFor, null, { timeout: 5000 }).catch(() => note("bot didn't take Dee's kart"));
      dee.p = await dee.ctx.newPage();
      watch(dee.p, "dee2");
      await dee.p.goto(`${BASE}/kart/phone?room=${room}#test`);
      await dee.p.locator("#hold").waitFor({ state: "visible", timeout: 15000 }).catch(() => note("rejoin: no setup shown"));
      await dee.p.locator("#hold").click();
      await dee.p.evaluate((pose) => { window.testPose = pose; window.testSensors = setInterval(() => { window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", window.testPose)); window.dispatchEvent(new DeviceMotionEvent("devicemotion", { acceleration: { x: 0, y: 0, z: 0 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 } })); }, 16); }, wheel(0, -1));
      await dee.p.locator("#stepTag", { hasText: "CENTRE" }).waitFor().catch(() => note("rejoin: no centre step"));
      const box = await dee.p.locator("#hold").boundingBox();
      await dee.p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await dee.p.mouse.down();
      await dee.p.waitForTimeout(1500);
      await dee.p.mouse.up();
      await dee.p.locator("#race").waitFor({ state: "visible", timeout: 8000 }).catch(() => note("rejoin: saved steering not reused (asked for range again)"));
      await tv.waitForFunction(() => { const r = window.__kartScene.kart.racers.find((r) => r.name === "Dee"); return !r.botFor && !r.away; }, null, { timeout: 8000 }).catch(() => note("Dee didn't take the kart back"));
    }
    await tv.locator("#results").waitFor({ state: "visible", timeout: 150000 }).catch(() => note(`race ${raceNo}: no results in 150 s`));
    auto = false;
    await piloting;
    const rows = await tv.locator("#resTable tbody tr").count();
    if (rows !== 8) note("results rows " + rows);
    await shot(tv, "results-" + raceNo);
    mem.push(await measure());
    if (raceNo === 0) await tv.locator("#again").click(); // Race again
    else if (raceNo === 1) {
      await tv.locator("#resLobby").click(); // Change track
      await tv.locator("#trackSeg button[data-v=frost]").click({ timeout: 5000 }).catch(async () => {
        await tv.locator("#panelToggle").click();
        await tv.locator("#trackSeg button[data-v=frost]").click().catch((e) => note("change track: " + e.message.split("\n")[0]));
      });
      await tv.waitForFunction(() => window.__kartScene.kart.track === "frost", null, { timeout: 5000 }).catch(() => note("track didn't change"));
      await tv.locator("#start").click().catch((e) => note("start after change track: " + e.message.split("\n")[0]));
    }
  }
  console.log("memory per race:", JSON.stringify(mem));
  // ——— 3 views, then 2 views: close phones and re-check the layout in the lobby/race ———
  console.log("server stderr:", serverErr.slice(0, 2000));
} catch (e) {
  note("script stopped: " + e.message.split("\n")[0]);
} finally {
  console.log("ERRORS:", JSON.stringify(errors.slice(0, 30), null, 1));
  console.log("PROBLEMS:", JSON.stringify(problems, null, 1));
  await browser.close();
  child.kill();
}
