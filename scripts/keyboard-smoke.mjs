/** Real browser + server: "Use the keyboard instead" claims a seat, gets ready, serves with Space. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const PORT = 31498;
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
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  d.on("pageerror", (e) => errors.push(e.message));
  await d.goto(`http://127.0.0.1:${PORT}/#test`);
  await d.locator("#play").click();
  await d.locator("#goOffline").click();
  await d.locator("label[for=m-here-solo]").click();
  await d.locator("#create").click();
  await d.locator("#lobby").waitFor({ state: "visible" });
  await d.locator("#useKeys").click();
  await d.waitForFunction(
    () => window.__povScene.state?.players.some((p) => p.keyboard && p.ready),
    null,
    { timeout: 5000 },
  );
  await d.locator("#start").click();
  const st = () =>
    d.evaluate(() => {
      const m = window.__povScene.state;
      return { phase: m.phase, contacts: m.contacts, intro: m.introUntil - m.time };
    });
  // Wait for the intro and serve delay, then serve with Space.
  await d.waitForFunction(
    () => {
      const m = window.__povScene.state;
      return m.phase === "serve" && m.time > m.introUntil + 0.6;
    },
    null,
    { timeout: 10000 },
  );
  await d.keyboard.down("Space");
  await d.waitForTimeout(150);
  await d.keyboard.up("Space");
  await d.waitForFunction(() => window.__povScene.state.contacts > 0, null, {
    timeout: 3000,
  });
  const s = await st();
  assert.equal(s.phase, "rally");
  assert.deepEqual(errors, []);
  console.log("PASS: keyboard paddle · seat claimed → ready → Space serves (contacts " + s.contacts + ")");
} finally {
  await browser?.close();
  child.kill();
}
