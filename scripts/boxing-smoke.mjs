/**
 * Sportle Boxing browser smoke test. Real server, real browser pages and HTTP/SSE; the phones are
 * pages with SYNTHETIC sensor events (NOT a physical phone test).
 * Hub → Boxing; two phones join one QR room and finish setup (hand, guard, six punches); split
 * screen; a jab lands and lowers health (the loopback delay from the phone's punch to the
 * server's hit is printed); a guard blocks; uppercuts knock a fighter down, the count runs and
 * shaking the phone gets them up; the round ends. Every check reads the server's state (via the
 * phone's snapshot), polled on a timer, because GPU-less CI machines draw very few frames.
 * Optional: SHOTS=<dir> saves screenshots (each ring, split screen, the phone page).
 */
import { chromium } from "playwright";
import { patientBrowser, slow } from "./patient.mjs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import { joinPhone, pose, punch, play, drained, POSE, shakeSamples } from "./boxing-phone.mjs";

const PORT = 31497;
const SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const child = spawn(process.execPath, ["src/server/index.ts"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
child.stderr.on("data", (d) => serverErr.push(String(d)));
let browser;
const BASE = `http://127.0.0.1:${PORT}`;
/** Poll a condition on a timer (not per frame: CI draws few frames). */
async function until(what, fn, ms = 15000) {
  const end = Date.now() + slow(ms);
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw Error("Timed out: " + what + (serverErr.length ? "\nServer errors:\n" + serverErr.join("") : ""));
    await new Promise((ok) => setTimeout(ok, 100));
  }
}
try {
  await new Promise((ok, no) => {
    child.stdout.once("data", ok);
    child.once("exit", (c) => no(Error("Server exited " + c)));
    setTimeout(() => no(Error("Server startup timeout")), 5000).unref();
  });
  child.stdout.resume();
  browser = patientBrowser(
    await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    }),
  );
  const errors = [];
  const tv = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // Phones in portrait, held like a glove.
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ctxA.newPage(),
    b = await ctxB.newPage();
  for (const p of [tv, a, b]) p.on("pageerror", (e) => errors.push(e.message));
  // Start screen: Boxing is the fourth card; Enter opens it.
  await tv.goto(BASE + "/");
  await tv.locator("#hubIntro").waitFor({ state: "visible" });
  await tv.keyboard.press("x");
  await tv.locator("#hubPick").waitFor({ state: "visible" });
  assert.equal(await tv.locator("#playBoxing").getAttribute("href"), "/boxing");
  for (let i = 0; i < 3; i++) await tv.keyboard.press("ArrowRight");
  await tv.locator("#playBoxing.active").waitFor();
  await until("hub shows Boxing", async () => (await tv.locator("#hubName").textContent()) === "Boxing");
  if (SHOTS) {
    await tv.waitForTimeout(900);
    await tv.screenshot({ path: SHOTS + "/hub-boxing.png" });
  }
  await tv.keyboard.press("Enter");
  await tv.waitForURL(/\/boxing$/, { waitUntil: "commit" });
  // A quick 2-player match (30 s rounds, 25 health so a knockdown comes fast; fights are 3 × 60 s at 100).
  await tv.goto(BASE + "/boxing?round=30&hp=25#test");
  await tv.locator("#goVersus").click();
  await tv.locator("label[for=br-arena]").click();
  await tv.locator("#create").click();
  await tv.locator("#lobby").waitFor({ state: "visible" });
  const room = (await tv.locator("#roomcode").textContent()).trim();
  assert.match(room, /^[A-F0-9]{6}$/);
  assert.match(await tv.locator("#pairHint").textContent(), /HTTPS/);
  await joinPhone(a, BASE, room, "Ana", { hand: "right" });
  await joinPhone(b, BASE, room, "Ben", { hand: "right" });
  const st = (p) => p.evaluate(() => window.__boxPhone.state);
  const fighter = async (p, name) => (await st(p))?.fighters.find((f) => f.name === name);
  await until("both fighters ready", async () => {
    const s = await st(a);
    return s && s.fighters.length === 2 && s.fighters.every((f) => f.ready);
  });
  if (SHOTS) {
    await a.screenshot({ path: SHOTS + "/phone-ready.png" });
    await tv.screenshot({ path: SHOTS + "/lobby.png" });
  }
  await tv.locator("#start").click();
  await until("fight starts", async () => (await st(a))?.phase === "fight", 20000);
  // Split screen on the TV: one view per fighter.
  await until("split screen", () => tv.evaluate(() => document.querySelectorAll(".bview").length === 2));
  // A jab from Ana lands on Ben and lowers his health.
  const ben0 = (await fighter(a, "Ben")).hp;
  await punch(a, "jab", 55);
  const hit = await until("jab lands", async () => {
    const s = await st(a);
    return s?.hits.find((h) => h.by === s.fighters.find((f) => f.name === "Ana").id && h.type === "jab");
  });
  assert.equal(hit.result, "hit", "jab landed: " + JSON.stringify(hit));
  await until("Ben's health drops", async () => (await fighter(a, "Ben")).hp < ben0);
  console.log(`Jab landed (power ${hit.power}). Punch read on the phone → server: ${(await fighter(a, "Ana")).lagMs} ms (server-measured; synthetic sensors on the same machine, not a real-phone measurement). The hit is decided a jab wind-up (110 ms) after the throw, minus that delay.`);
  if (SHOTS) {
    await tv.waitForTimeout(400);
    await tv.screenshot({ path: SHOTS + "/split-arena.png" });
    await a.screenshot({ path: SHOTS + "/phone-fight.png" });
  }
  // Ben raises his guard (phone upright, still): Ana's next jab is blocked.
  await pose(b, POSE.guard());
  await until("Ben guards", async () => (await fighter(a, "Ben")).guard);
  await a.waitForTimeout(slow(300));
  await punch(a, "jab", 55);
  await until("guard blocks", async () => {
    const s = await st(a);
    const ana = s.fighters.find((f) => f.name === "Ana").id;
    return s.hits.some((h) => h.by === ana && h.result === "block");
  });
  console.log("Guard blocked a jab");
  // Guard down; uppercuts until Ben is knocked down and the count starts.
  await pose(b, POSE.stance());
  await until("Ben's guard down", async () => !(await fighter(a, "Ben")).guard);
  await until(
    "knockdown",
    async () => {
      const s = await st(a);
      if (s.phase === "down") return true;
      if (s.phase === "fight") await punch(a, "upper", 60);
      await a.waitForTimeout(250);
      return false;
    },
    60000,
  );
  await until("the count reaches 2", async () => (await st(a)).count.n >= 2, 8000);
  await until("TV shows the count", () => tv.evaluate(() => [...document.querySelectorAll(".bcount")].some((el) => !el.classList.contains("hidden") && /\d/.test(el.textContent))));
  if (SHOTS) await tv.screenshot({ path: SHOTS + "/knockdown.png" });
  // Ben shakes his phone to get up before ten.
  await play(b, shakeSamples(6));
  await until("Ben beats the count", async () => (await st(a)).phase !== "down", 12000);
  const s1 = await st(a);
  assert.equal(s1.phase, "fight", "back to fighting (not KO): " + s1.phase + " " + JSON.stringify(s1.result));
  await drained(b);
  console.log("Knockdown, count and get-up OK");
  // The round ends: the bell, the break.
  await until("round ends", async () => {
    const s = await st(a);
    return s.phase === "break" || s.round > 1 || s.phase === "over";
  }, 60000);
  console.log("Round ended:", (await st(a)).phase);
  // Screenshots of every ring (split screen and the broadcast camera).
  if (SHOTS) {
    await tv.locator("#view").click();
    await tv.waitForTimeout(600);
    await tv.screenshot({ path: SHOTS + "/broadcast-arena.png" });
    await tv.locator("#view").click();
    // Host actions straight to the server (the room panel is tucked away during a fight).
    const host = (path, body = {}) =>
      tv.evaluate(async ([path, body]) => {
        const h = JSON.parse(sessionStorage.getItem("box-host"));
        const r = await fetch(`/api/${path}?room=${h.room}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + h.credential }, body: JSON.stringify(body) });
        return r.json();
      }, [path, body]);
    for (const ring of ["neon", "rooftop"]) {
      await host("box/lobby");
      await until("lobby", async () => (await st(a)).phase === "lobby");
      await host("box/options", { ring });
      await until("ring " + ring, async () => (await st(a)).ring === ring);
      await host("start");
      await until("fight " + ring, async () => (await st(a)).phase === "fight", 20000);
      await tv.waitForTimeout(800);
      await tv.screenshot({ path: SHOTS + `/split-${ring}.png` });
      await tv.locator("#view").click();
      await tv.waitForTimeout(800);
      await tv.screenshot({ path: SHOTS + `/broadcast-${ring}.png` });
      await tv.locator("#view").click();
    }
  }
  // Two phones, one fighter: a third phone opens Ana's glove link and becomes her left glove.
  const code = await a.evaluate(() => window.__boxPhone.gloveCode);
  const pair = await tv.evaluate(() => JSON.parse(sessionStorage.getItem("box-host")).pair);
  const c = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  c.on("pageerror", (e) => errors.push(e.message));
  await c.goto(`${BASE}/boxing/phone?room=${room}#pair=${pair}&glove=${code}&test`);
  await c.locator("#connect").click();
  await c.locator("#hold").waitFor({ state: "visible" });
  const gl = await until("second glove joins Ana", async () => {
    const f = await fighter(a, "Ana");
    return f.gloves.length === 2 && f.gloves;
  });
  assert.deepEqual(gl.map((g) => g.hand).sort(), ["left", "right"], "left and right gloves");
  assert.equal((await st(a)).fighters.length, 2, "still two fighters");
  await until("SWITCH hidden with two gloves", () => a.evaluate(() => getComputedStyle(document.getElementById("switchBtn")).display === "none"));
  console.log("Second phone joined as Ana's other glove");
  assert.deepEqual(errors, [], "no page errors");
  console.log("Boxing smoke OK: hub → boxing, two phones set up, split screen, jab lands, guard blocks, knockdown + count + get up, round ends, second phone as the other glove");
} finally {
  await browser?.close();
  child.kill();
}
