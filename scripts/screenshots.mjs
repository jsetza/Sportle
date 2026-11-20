/**
 * Screenshots of real matches for visual review: `node scripts/screenshots.mjs <outDir> [maps]`.
 * Real server and browser; the phone is a synthetic-sensor page (NOT a physical phone test).
 * Uses the machine's GPU (no SwiftShader) so the renderer looks the way it does for players.
 * Env: CHROME_PATH, QUALITY (high/medium/low), VIEWS (comma list of third,first,broadcast).
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { setUpPhone } from "./phone-setup.mjs";
const out = process.argv[2] || "screens";
const maps = (process.argv[3] || "arena,tokyo,nyc,centralpark,haas").split(",");
const views = (process.env.VIEWS || "third,broadcast").split(",");
fs.mkdirSync(out, { recursive: true });
const PORT = 31493;
const child = spawn(process.execPath, ["src/server/index.ts"], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  await new Promise((ok, no) => {
    child.stdout.once("data", ok);
    child.once("exit", (c) => no(Error("Server exited " + c)));
    setTimeout(() => no(Error("Server startup timeout")), 5000).unref();
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
    args: ["--enable-gpu", "--ignore-gpu-blocklist"],
  });
  for (const map of maps) {
    const ctx = await browser.newContext();
    const display = await ctx.newPage({
        viewport: { width: 1440, height: 900 },
      }),
      phone = await ctx.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    for (const p of [display, phone])
      p.on("pageerror", (e) => errors.push(e.message));
    if (process.env.QUALITY)
      await display.addInitScript(
        (q) => localStorage.setItem("pov-quality", q),
        process.env.QUALITY,
      );
    await display.goto(`http://127.0.0.1:${PORT}/${process.env.BASIC ? "?renderer=basic" : ""}#test`);
    await display.locator("#play").click();
    await display.locator("#goOffline").click();
    await display.locator("label[for=m-here-solo]").click();
    await display.locator(`label[for=map-${map}]`).click();
    await display.locator("#create").click();
    await display.locator("#lobby").waitFor({ state: "visible" });
    const room = await display.locator("#roomcode").textContent();
    await phone.goto(`http://127.0.0.1:${PORT}/controller?room=${room}`);
    await phone.locator("#nickname").fill("Jordan");
    await phone.locator("#connect").click();
    await phone.locator("#controls").waitFor({ state: "visible" });
    await setUpPhone(phone);
    await display.locator("#start").click();
    await display.waitForTimeout(2500);
    const swing = () =>
      phone.evaluate(() =>
        window.dispatchEvent(
          new DeviceMotionEvent("devicemotion", {
            acceleration: { x: 0, y: 0, z: 0 },
            rotationRate: { alpha: 0, beta: -330, gamma: 0 },
          }),
        ),
      );
    for (const v of views) {
      for (let i = 0; i < 3; i++) {
        const label = await display.locator("#view").textContent();
        if (label.toLowerCase().includes(v === "third" ? "third" : v)) break;
        await display.keyboard.press("v");
      }
      await swing(); // serve / return so the ball is in the air
      await display.waitForTimeout(700);
      await display.screenshot({ path: `${out}/${map}-${v}.png` });
    }
    const fps = await display.evaluate(
      () =>
        new Promise((ok) => {
          let n = 0;
          const t0 = performance.now();
          const tick = () =>
            ++n < 120 ? requestAnimationFrame(tick) : ok(n / ((performance.now() - t0) / 1000));
          requestAnimationFrame(tick);
        }),
    );
    const info = await display.evaluate(() => {
      const s = window.__povScene;
      return { cpu: s.cpuMs.toFixed(1), q: s.gl.quality, verts: s.gl.staticCount };
    });
    console.log(
      map,
      "fps≈" + fps.toFixed(0),
      "cpu " + info.cpu + " ms/frame",
      info.q,
      info.verts + " static verts",
      errors.length ? errors : "",
    );
    await ctx.close();
  }
} finally {
  await browser?.close();
  child.kill();
}
