/** Real browser + server: a redeploy/restart loses rooms. The big screen and a joined phone
 * must stop retrying and say what happened (not loop on "Reconnecting…"). Synthetic phone. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const PORT = 31501;
const boot = async () => {
  const c = spawn(process.execPath, ["src/server/index.ts"], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    c.stdout.once("data", ok);
    c.once("exit", (code) => no(Error("Server exited " + code)));
    setTimeout(() => no(Error("Server startup timeout")), 5000).unref();
  });
  return c;
};
let child = await boot(),
  browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const d = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const phone = await (await browser.newContext()).newPage({ viewport: { width: 390, height: 844 } });
  await d.goto(`http://127.0.0.1:${PORT}/#test`);
  await d.locator("#play").click();
  await d.locator("#goOffline").click();
  await d.locator("label[for=m-here-solo]").click();
  await d.locator("#create").click();
  await d.locator("#lobby").waitFor({ state: "visible" });
  const room = await d.locator("#roomcode").textContent();
  await phone.goto(`http://127.0.0.1:${PORT}/controller?room=${room}`);
  await phone.locator("#nickname").fill("Restart");
  await phone.locator("#connect").click();
  await phone.locator("#enable").waitFor({ state: "visible" });
  // Restart the server: the room is gone.
  child.kill();
  await new Promise((r) => child.once("exit", r));
  child = await boot();
  await d.locator("#error").filter({ hasText: "has ended" }).waitFor({ timeout: 10000 });
  assert.ok(!(await d.locator("#lobby").isVisible()), "big screen left the dead lobby");
  assert.ok(await d.locator("#create").isVisible(), "big screen is back at the menu");
  await phone.locator("#error").filter({ hasText: "has ended" }).waitFor({ timeout: 10000 });
  // And it stays quiet: no more requests to the dead room.
  let calls = 0;
  for (const p of [d, phone]) p.on("request", (r) => r.url().includes("room=" + room) && calls++);
  await d.waitForTimeout(2000);
  assert.ok(calls <= 2, calls + " requests to the dead room after giving up");
  console.log("PASS: server restart · big screen back to the menu, phone says the room ended, no retry loop");
} finally {
  await browser?.close();
  child.kill();
}
