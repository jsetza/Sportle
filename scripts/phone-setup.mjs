/**
 * Drives the four-step phone setup in a real browser page with SYNTHETIC sensor events
 * (tests only — not a physical phone): 01 allow motion · 02 hold to aim (phone flat, top
 * edge at the screen) · 03 three forehands · 04 three backhands · finish.
 *
 * Poses for a screen straight ahead: flat = {0, 0, 0}; forehand grip (screen toward the TV,
 * top edge up) = {180, 90, 0}; backhand grip (back toward the TV) = {0, 90, 0}.
 */
export const FLAT = { alpha: 0, beta: 0, gamma: 0 };
export const FOREHAND = { alpha: 180, beta: 90, gamma: 0 };
export const BACKHAND = { alpha: 0, beta: 90, gamma: 0 };

/** Start a 60 Hz stream of orientation + (quiet) motion events from `window.testPose`. */
export async function sensors(phone, pose = FLAT) {
  await phone.evaluate((pose) => {
    window.testPose = pose;
    clearInterval(window.testSensors);
    window.testSensors = setInterval(() => {
      window.dispatchEvent(
        new DeviceOrientationEvent("deviceorientation", window.testPose),
      );
      window.dispatchEvent(
        new DeviceMotionEvent("devicemotion", {
          acceleration: { x: 0, y: 0, z: 0 },
          rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        }),
      );
    }, 16);
  }, pose);
}
export const setPose = (phone, pose) =>
  phone.evaluate((pose) => (window.testPose = pose), pose);
/** One swing: a single rotation-rate sample (deg/s, device axes), then quiet again. */
export async function swing(phone, rate, wait = 450) {
  await phone.evaluate(
    (r) =>
      window.dispatchEvent(
        new DeviceMotionEvent("devicemotion", {
          acceleration: { x: 0, y: 0, z: 0 },
          rotationRate: r,
        }),
      ),
    rate,
  );
  await phone.waitForTimeout(wait);
}
/** Press and hold HOLD TO SET until the bar fills. */
export async function holdToAim(phone) {
  await setPose(phone, FLAT);
  await phone.waitForTimeout(150);
  await phone.locator("#hold").scrollIntoViewIfNeeded();
  const box = await phone.locator("#hold").boundingBox();
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await phone.mouse.down();
  await phone.waitForTimeout(1600);
  await phone.mouse.up();
  await phone.waitForTimeout(100);
}
/**
 * Full setup from the join → setup screen. `hand` "right" swings forehands right→left
 * (+gamma in the forehand grip) and backhands left→right (−gamma in the backhand grip).
 */
export async function setUpPhone(phone, { reversed = false } = {}) {
  await phone.locator("#enable").click();
  await sensors(phone, FLAT);
  await phone.locator("#hold").waitFor({ state: "visible" });
  await holdToAim(phone);
  await phone.locator("#gauge").waitFor({ state: "visible" });
  // A phone that reads left/right the other way round: the setup must learn the flip.
  const k = reversed ? -1 : 1;
  await setPose(phone, FOREHAND);
  await phone.waitForTimeout(200);
  // First forehand with a real backswing first (the other way, slower): it must count once.
  await swing(phone, { alpha: 0, beta: 0, gamma: -260 * k }, 40);
  await swing(phone, { alpha: 0, beta: 0, gamma: 0 }, 40);
  await swing(phone, { alpha: 0, beta: 0, gamma: 0 }, 40);
  await swing(phone, { alpha: 0, beta: 0, gamma: 460 * k }, 900);
  for (let i = 0; i < 2; i++) await swing(phone, { alpha: 0, beta: 0, gamma: 420 * k }, 800);
  const fore = await phone.locator("#gDashes i.done").count();
  if (fore !== 3) throw Error("Setup counted " + fore + " of 3 forehands");
  await phone.locator("#next").click();
  await setPose(phone, BACKHAND);
  await phone.waitForTimeout(200);
  for (let i = 0; i < 3; i++) await swing(phone, { alpha: 0, beta: 0, gamma: -420 * k }, 800);
  const back = await phone.locator("#gDashes i.done").count();
  if (back !== 3) throw Error("Setup counted " + back + " of 3 backhands");
  await phone.locator("#next").click(); // FINISH
  await phone.locator("#ingame").waitFor({ state: "visible" });
  await setPose(phone, FOREHAND);
  const saved = await phone.evaluate(() => JSON.parse(localStorage.getItem("pov-paddle") || "null"));
  if (!saved || (saved.sideSign !== 1 && saved.sideSign !== -1))
    throw Error("Setup did not save a swing profile");
  if (saved.sideSign !== (reversed ? -1 : 1))
    throw Error("Setup learned the wrong left/right sign: " + saved.sideSign);
  return saved;
}
