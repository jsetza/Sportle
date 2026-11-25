/**
 * Drives the Sportle Kart phone page with SYNTHETIC sensor events (tests only — not a physical
 * phone): join → 01 motion → 02 centre (held level like a wheel) → 03 full left, full right →
 * racing. The phone is in landscape with its +x edge up (`grip` -1 flips to the other side).
 * Shared by the kart smoke test and the screenshot script.
 */
import { slow } from "./patient.mjs";
import assert from "node:assert/strict";
/** Wheel pose: `turn` degrees counter-clockwise (left) from level, either landscape grip. */
export const wheel = (turn = 0, grip = 1) =>
  grip > 0 ? { alpha: 0, beta: -turn, gamma: -90 } : { alpha: 0, beta: turn, gamma: 89.9 };
/** 60 Hz orientation + quiet motion (acceleration without gravity). */
export async function sensors(page, pose = wheel(0)) {
  await page.evaluate((pose) => {
    window.testPose = pose;
    window.testAcc = { x: 0, y: 0, z: 0 };
    clearInterval(window.testSensors);
    window.testSensors = setInterval(() => {
      window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", window.testPose));
      window.dispatchEvent(
        new DeviceMotionEvent("devicemotion", {
          acceleration: window.testAcc,
          accelerationIncludingGravity: { x: 9.8, y: 0, z: 0 },
          rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        }),
      );
    }, 16);
  }, pose);
}
export const pose = (page, p) => page.evaluate((p) => (window.testPose = p), p);
/** Join a kart room from the phone page and finish the steering setup. */
export async function joinPhone(page, base, room, name, { grip = 1, body = "classic" } = {}) {
  await page.goto(`${base}/kart/phone?room=${room}#test`);
  await page.locator("#nickname").fill(name);
  await page.locator("#body").selectOption(body);
  await page.locator("#connect").click();
  await page.locator("#hold").waitFor({ state: "visible" });
  assert.equal(await page.locator("#nickname").count(), 0);
  await page.locator("#hold").click(); // 01: turns motion on
  await sensors(page, wheel(0, grip));
  await page.locator("#stepTag", { hasText: "CENTRE" }).waitFor();
  const box = await page.locator("#hold").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  // 03: all the way left, hold; all the way right, hold (skipped once a range is saved).
  if (await page.locator("#stepTag", { hasText: "RANGE" }).isVisible()) {
    await pose(page, wheel(38, grip));
    await page.locator("#stepTitle", { hasText: "right" }).waitFor({ timeout: slow(6000) });
    await pose(page, wheel(-38, grip));
  }
  await page.locator("#race").waitFor({ state: "visible", timeout: slow(8000) });
  await pose(page, wheel(0, grip));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("sportle-kart") || "null"));
  assert.ok(saved && saved.left > 30 && saved.right > 30, "setup learned the steering range: " + JSON.stringify(saved));
}
