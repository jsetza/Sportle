/**
 * Drives the Sportle Bowling phone page with SYNTHETIC sensor events (tests only — not a
 * physical phone): join → 01 tap + hold to aim (upright, screen toward the TV) → 02 two
 * practice bowls → in game. Shared by the bowling smoke test and the screenshot script.
 */
import { slow } from "./patient.mjs";
import assert from "node:assert/strict";
export const UPRIGHT = { alpha: 180, beta: 90, gamma: 0 }; // screen toward the TV, top edge up
/** Upright, screen toward the TV, wrist rolled so the top edge leans right (+deg) or left. */
export const tilted = (deg) => ({ alpha: 270, beta: 90 - deg, gamma: -90 });
/** 60 Hz orientation + quiet motion, paused while a synthetic bowl is being sent. */
export async function sensors(page, pose = UPRIGHT) {
  await page.evaluate((pose) => {
    window.testPose = pose;
    clearInterval(window.testSensors);
    window.testSensors = setInterval(() => {
      window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", window.testPose));
      if (!window.bowlBusy)
        window.dispatchEvent(
          new DeviceMotionEvent("devicemotion", {
            acceleration: { x: 0, y: 0, z: 0 },
            rotationRate: { alpha: 0, beta: 0, gamma: 0 },
          }),
        );
    }, 16);
  }, pose);
}
/**
 * One underhand bowl: backswing (+beta), then a faster forward swing (−beta), at 60 Hz.
 * When the phone shows the hold-to-bowl button (its turn, button mode), the button is held
 * from the backswing and let go just after the forward swing peaks, like a player would.
 */
export async function bowl(page, { peak = 560, back = 230, yaw = 0 } = {}) {
  const btn = page.locator("#bowlBtn");
  const useBtn = (await btn.count()) > 0 && (await btn.isVisible());
  if (!useBtn) return swingPart(page, { peak, back, yaw, part: "all" });
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await swingPart(page, { peak, back, yaw, part: "start" });
  await page.mouse.up();
  await swingPart(page, { peak, back, yaw, part: "end" });
}
async function swingPart(page, { peak, back, yaw, part }) {
  await page.evaluate(
    async ({ peak, back, yaw, part }) => {
      window.bowlBusy = true;
      const send = (beta, alpha = 0) =>
        window.dispatchEvent(
          new DeviceMotionEvent("devicemotion", {
            acceleration: { x: 0, y: 0, z: 0 },
            rotationRate: { alpha, beta, gamma: 0 },
          }),
        );
      const wait = () => new Promise((ok) => setTimeout(ok, 16));
      const first = part !== "end",
        last = part !== "start";
      if (first) {
        for (let i = 0; i < 18; i++) {
          send(back * Math.sin((Math.PI * (i + 1)) / 19));
          await wait();
        }
        for (let i = 0; i < 3; i++) {
          send(0);
          await wait();
        }
      }
      // Forward swing: the button is let go after sample 8 (just past the peak).
      for (let i = first ? 0 : 8; i < (last ? 14 : 8); i++) {
        send(-peak * Math.sin((Math.PI * (i + 1)) / 15), yaw);
        await wait();
      }
      if (last) {
        for (let i = 0; i < 25; i++) {
          send(0);
          await wait();
        }
        window.bowlBusy = false;
      }
    },
    { peak, back, yaw, part },
  );
}
/** Join a bowling room from the phone page and finish the setup. */
export async function joinPhone(page, base, room, name) {
  await page.goto(`${base}/bowling/phone?room=${room}`);
  await page.locator("#nickname").fill(name);
  await page.locator("#connect").click();
  // The page reloads itself after joining (fresh page, no typed fields left).
  await page.locator("#hold").waitFor({ state: "visible" });
  assert.equal(await page.locator("#nickname").count(), 0);
  await page.locator("#hold").click(); // tap: turns motion on
  await sensors(page);
  await page.waitForTimeout(200);
  const box = await page.locator("#hold").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await page.locator("#gauge").waitFor({ state: "visible" });
  // Two practice bowls: one straight, one a little toward the left.
  await bowl(page);
  await page.waitForTimeout(400);
  await bowl(page, { yaw: 80 });
  await page.locator("#ingame").waitFor({ state: "visible", timeout: slow(5000) });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("sportle-bowl") || "null"));
  assert.ok(saved && saved.upSign === 1, "setup learned the forward swing direction");
}
