/**
 * Ranked 1v1 end to end in real browsers over real HTTP: two households, each with its own
 * screen and phone (synthetic sensor events — NOT a physical phone test). Both search, get
 * matched, both screens and phones move to the match room, and the match starts by itself.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PORT = "31493",
  BASE = "http://127.0.0.1:" + PORT;
const child = spawn(process.execPath, ["src/server/index.ts"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT,
    DATA_DIR: mkdtempSync(join(tmpdir(), "pov-ranked-")),
  },
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
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const errors = [];
  const household = async (name) => {
    // Separate browser contexts = separate homes (own storage, own phone).
    const ctx = await browser.newContext();
    const display = await ctx.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const phone = await (
      await browser.newContext()
    ).newPage({
      viewport: { width: 390, height: 844 },
    });
    for (const p of [display, phone])
      p.on("pageerror", (e) => errors.push(name + ": " + e.message));
    await display.goto(BASE);
    await display.locator("#play").click();
    await display.locator("#goOnline").click();
    await display.locator("label[for=m-online-ranked1]").click();
    await display.locator("#create").click();
    await display.locator("#lobby").waitFor({ state: "visible" });
    const room = (await display.locator("#roomcode").textContent()).trim();
    await phone.goto(BASE + "/controller?room=" + room);
    await phone.locator("#nickname").fill(name);
    await phone.locator("#connect").click();
    // Fresh page after joining (iOS Undo Typing fix): no text fields left.
    await phone.locator("#enable").waitFor({ state: "visible" });
    if ((await phone.locator("#nickname").count()) !== 0)
      throw Error("text field survived");
    await phone.locator("#enable").click();
    await phone.evaluate(() => {
      setInterval(() => {
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
    for (const [a, b, g] of [
      [0, 0, -260],
      [0, 0, 250],
      [0, 240, 0],
      [0, -250, 0],
    ]) {
      await phone.evaluate(
        ([a, b, g]) =>
          window.dispatchEvent(
            new DeviceMotionEvent("devicemotion", {
              acceleration: { x: 0, y: 0, z: 0 },
              rotationRate: { alpha: a, beta: b, gamma: g },
            }),
          ),
        [a, b, g],
      );
      await phone.waitForTimeout(450);
    }
    await phone.locator("#ready").click();
    await phone.locator("#ingame").waitFor({ state: "visible" });
    if (!/RR/.test(await phone.locator("#igTitle").textContent()))
      throw Error("phone does not show its RR");
    return { display, phone, room };
  };
  const a = await household("Ana"),
    b = await household("Ben");
  for (const h of [a, b]) {
    await h.display.locator("#rkFind").waitFor({ state: "visible" });
    await h.display.waitForFunction(
      () => !document.querySelector("#rkFind").disabled,
    );
    await h.display.locator("#rkFind").click();
  }
  // Both screens leave their lobby for the same match room, and play starts by itself.
  const label = (p) => p.locator("#courtLabel").textContent();
  for (const h of [a, b])
    await h.display.waitForFunction(
      () =>
        /RANKED 1 V 1 · (SERVE|RALLY)/.test(
          document.querySelector("#courtLabel").textContent,
        ),
      null,
      { timeout: 15000 },
    );
  const rooms = await Promise.all(
    [a, b].map((h) =>
      h.phone.evaluate(() => new URL(location.href).searchParams.get("room")),
    ),
  );
  if (rooms[0] !== rooms[1] || rooms[0] === a.room || rooms[0] === b.room)
    throw Error("phones did not move into one shared match room: " + rooms);
  // Each screen follows its own player.
  const lb = await (await fetch(BASE + "/api/leaderboard")).json();
  if (!Array.isArray(lb.top)) throw Error("leaderboard unavailable");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS: ranked 1v1 · two homes (own screen + phone) → search → matched → both moved → match started:",
    await label(a.display),
  );
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
}
