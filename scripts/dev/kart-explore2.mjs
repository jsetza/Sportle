/**
 * Kart exploration, part 2 (developer tool, not part of the test suite): 3 phones (fourth
 * quadrant + minimap), 8 phones (forced shared view, lobby list, 9th refused), a phone joining
 * on the results screen, the phone menu at 844×390, and a time trial with the ghost.
 * Run: node scripts/dev/kart-explore2.mjs [outDir]
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { joinPhone, wheel, pose } from "../kart-phone.mjs";
import { track, pointAt } from "../../src/shared/kart.ts";

const OUT = process.argv[2] || "";
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const PORT = 31582,
  BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/server/index.ts"], { env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((ok) => child.stdout.once("data", ok));
const browser = await chromium.launch({ headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist"] });
const problems = [],
  errors = [];
const note = (m) => (problems.push(m), console.log("PROBLEM:", m));
const watch = (p, n) => {
  p.on("pageerror", (e) => errors.push(`${n}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`${n}: ${m.text()}`));
};
const shot = (p, n) => OUT && p.screenshot({ path: `${OUT}/${n}.png` });
const turnFor = (s) => {
  const q = Math.min(1, Math.abs(s));
  if (q < 0.005) return 0;
  const u = (-0.3 + Math.sqrt(0.09 + 2.8 * q)) / 1.4;
  return -Math.sign(s) * (0.06 + u * 0.94) * 38 * 0.85;
};
async function tvRoom(q, single = false, trial = false) {
  const tv = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(tv, "tv");
  await tv.goto(`${BASE}/kart?${q}#test`);
  await tv.locator(single ? "#goSingle" : "#goMulti").click();
  if (trial) await tv.locator("label[for=km-trial]").click();
  await tv.locator("label[for=kt-court]").click();
  await tv.locator("#create").click();
  await tv.locator("#lobby").waitFor({ state: "visible" });
  return { tv, room: (await tv.locator("#roomcode").textContent()).trim() };
}
async function phonesJoin(room, n, prefix) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
    const p = await ctx.newPage();
    watch(p, prefix + i);
    await joinPhone(p, BASE, room, prefix + i, { grip: i % 2 ? -1 : 1 });
    out.push({ p, ctx, name: prefix + i, grip: i % 2 ? -1 : 1 });
  }
  return out;
}
function pilot(phones, id) {
  const t = track(id);
  let on = true;
  const run = (async () => {
    while (on) {
      for (const ph of phones) {
        const s = await ph.p.evaluate(() => window.__kartPhone?.state).catch(() => null);
        const r = s?.racers.find((q) => q.name === ph.name);
        if (!r) continue;
        const look = pointAt(t, r.s + 9 + Math.max(0, r.v) * 0.35, 0);
        const want = Math.atan2(look.z - r.z, look.x - r.x);
        const err = Math.atan2(Math.sin(want - r.h), Math.cos(want - r.h));
        await pose(ph.p, wheel(turnFor(Math.max(-1, Math.min(1, err * 2.4 - r.d * 0.04))), ph.grip)).catch(() => {});
      }
      await new Promise((ok) => setTimeout(ok, 60));
    }
  })();
  return async () => {
    on = false;
    await run;
  };
}
try {
  // ——— 3 phones: fourth quadrant follows the leader; minimap in the middle; phone menu fits ———
  {
    const { tv, room } = await tvRoom("laps=1");
    const ph = await phonesJoin(room, 3, "T");
    const p0 = ph[0].p;
    await p0.locator("#menuBtn").click();
    const fits = await p0.evaluate(() => ["menuClose", "gasSeg", "assistSeg", "sensSeg", "redo"].every((id) => { const b = document.getElementById(id).getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0 && b.height > 0; }));
    await shot(p0, "phone-menu-844x390");
    if (!fits) note("phone menu: some settings below the bottom of an 844×390 screen");
    await p0.locator("#menuClose").click();
    await tv.waitForFunction(() => window.__kartScene.kart.racers.filter((r) => !r.bot).every((r) => r.ready));
    await tv.locator("#start").click();
    await tv.waitForFunction(() => window.__kartScene.kart.phase === "race", null, { timeout: 15000 });
    const stop = pilot(ph, "court");
    await tv.waitForTimeout(3000);
    const n = await tv.locator(".kview").count();
    if (n !== 4) note("3 phones: " + n + " views (want 3 + leader)");
    const quad = await tv.evaluate(() => document.body.classList.contains("kquad"));
    if (!quad) note("3 phones: minimap not moved to the middle");
    // The minimap must not cover any quadrant's place, lap or item readout.
    const overlap = await tv.evaluate(() => {
      const m = document.getElementById("kmap").getBoundingClientRect();
      const hit = (b) => b.width > 0 && b.left < m.right && b.right > m.left && b.top < m.bottom && b.bottom > m.top;
      return [...document.querySelectorAll(".kview .kplace, .kview .klap, .kview .kitem")].filter((e) => hit(e.getBoundingClientRect())).map((e) => e.id);
    });
    if (overlap.length) note("minimap covers " + overlap.join(", "));
    await shot(tv, "three-phones");
    // Join on the results screen: the bots stay, 8 karts next race.
    await tv.locator("#results").waitFor({ state: "visible", timeout: 150000 });
    await stop();
    const late = await phonesJoin(room, 1, "Late");
    const k = await tv.evaluate(() => window.__kartScene.kart);
    if (k.racers.length !== 8 || k.racers.filter((r) => r.bot).length !== 4) note(`join on results: ${k.racers.length} karts, ${k.racers.filter((r) => r.bot).length} bots`);
    await shot(tv, "results-after-join");
    await tv.locator("#again").click();
    await tv.waitForFunction(() => window.__kartScene.kart.phase === "countdown", null, { timeout: 10000 }).catch(() => note("Race again after a late join didn't start"));
    const k2 = await tv.evaluate(() => window.__kartScene.kart);
    if (k2.racers.length !== 8) note("race after a late join: " + k2.racers.length + " karts");
    for (const q of [...ph, ...late]) await q.ctx.close();
    await tv.close();
  }
  // ——— 8 phones: lobby lists 8, forced shared view, a 9th is refused ———
  {
    const { tv, room } = await tvRoom("laps=1");
    const ph = await phonesJoin(room, 8, "P");
    await tv.waitForFunction(() => window.__kartScene.kart.racers.length === 8);
    const items = await tv.locator("#drivers li").count();
    if (items !== 8) note("lobby lists " + items + " drivers");
    const nine = await browser.newPage({ viewport: { width: 844, height: 390 } });
    await nine.goto(`${BASE}/kart/phone?room=${room}#test`);
    await nine.locator("#nickname").fill("Nine");
    await nine.locator("#connect").click();
    await nine.waitForTimeout(1200);
    const err = await nine.locator("#error").textContent();
    if (!/eight/i.test(err)) note("9th phone message: " + err);
    await tv.waitForFunction(() => window.__kartScene.kart.racers.filter((r) => !r.bot).every((r) => r.ready));
    await tv.locator("#start").click();
    await tv.waitForFunction(() => window.__kartScene.kart.phase === "race", null, { timeout: 15000 });
    await tv.waitForTimeout(1500);
    if ((await tv.locator(".kview").count()) !== 1) note("8 local phones: not one shared view");
    if (!(await tv.locator("#kboard").isVisible())) note("8 phones: no leaderboard");
    await shot(tv, "eight-shared");
    for (const q of ph) await q.ctx.close();
    await nine.close();
    await tv.close();
  }
  // ——— Time trial: 2 laps; after lap 1 a ghost is saved and shown on lap 2 ———
  {
    const { tv, room } = await tvRoom("laps=2", true, true);
    const ph = await phonesJoin(room, 1, "Solo");
    await tv.waitForFunction(() => window.__kartScene.kart.racers[0]?.ready);
    await tv.locator("#start").click();
    await tv.waitForFunction(() => window.__kartScene.kart.phase === "race", null, { timeout: 15000 });
    const k = await tv.evaluate(() => window.__kartScene.kart);
    if (k.racers.length !== 1) note("time trial with " + k.racers.length + " karts");
    const stop = pilot(ph, "court");
    await tv.waitForFunction(() => window.__kartScene.kart.racers[0].laps.length >= 1, null, { timeout: 90000 });
    await tv.waitForTimeout(1500);
    const g = await tv.evaluate(() => ({ saved: !!localStorage.getItem("kart-ghost-court"), shown: !!window.__kartScene.ghost }));
    if (!g.saved) note("time trial: no ghost saved after lap 1");
    if (!g.shown) note("time trial: no ghost on lap 2");
    await shot(tv, "trial-ghost");
    await tv.locator("#results").waitFor({ state: "visible", timeout: 90000 });
    await stop();
    const title = await tv.locator("#resTitle").textContent();
    if (!/Best lap \d/.test(title)) note("trial results title: " + title);
    await shot(tv, "trial-results");
  }
} catch (e) {
  note("script stopped: " + e.message.split("\n")[0]);
} finally {
  console.log("ERRORS:", JSON.stringify(errors.slice(0, 30), null, 1));
  console.log("PROBLEMS:", JSON.stringify(problems, null, 1));
  await browser.close();
  child.kill();
}
