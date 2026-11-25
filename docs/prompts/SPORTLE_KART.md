# Prompt: build Sportle Kart

Paste everything below the line into a new Claude Code session opened on this repo.

---

Build **Sportle Kart**, the third game in Sportle, inside this repo (jsetza/Sportle). Read `CLAUDE.md`, `README.md` and `docs/STATUS.md` first. Pickleball and Bowling must keep working exactly as they do now.

## Goal

A 3D kart racing game in the browser. Each player holds their phone **sideways (landscape) like a steering wheel**: tilting it left and right steers, and on-screen buttons under the thumbs handle drifting and items. It should look and feel like the same product as Sportle Pickleball and Bowling: same renderer, same capsule characters, same menus, same phone pairing and setup feel.

This is an **original game**. Don't copy any existing kart racer: no borrowed characters, item names or looks, track names or layouts, sounds or logos. The items below are Sportle's own and are themed on Sportle's sports.

## Reuse, don't rebuild

Use what already exists, and pull out shared pieces where needed rather than copying them:

- **Rendering:** `src/client/renderer.ts` (lighting, soft shadows, reflections, bloom, quality levels, WebGL1 fallback), the box/blob/text builder from `scene.ts`/`maps.ts`, and the multi-view support in the scene for split screen.
- **Look:** the same capsule characters, outfits and gear, LED boards with the pixel font, the menu/wordmark/typography, the comic/LED callout style, sparks and effects, the Music & sound panel and music files.
- **Connection:** `src/server/rooms.ts` pairing tokens and QR (`src/client/qr.ts`), `src/client/net.ts` authenticated HTTP input + SSE snapshots and reconnect, rate limits, timestamp/sequence validation, drop → pause → auto-resume, reload → one-tap rejoin.
- **Phone:** the setup flow's style (header, big hold button, gauge, "✓ Saved on this phone" card, Skip) and `src/shared/motion.ts` (`MotionFilter`, time-based smoothing). Saved phone data stays per phone.
- **Server:** the fixed 120 Hz authoritative loop pattern from `engine.ts` and the turn/lobby pattern from `src/server/bowling.ts`. All driving physics, item effects, laps and placings are decided on the server.
- **Hub:** add a **Kart** card to the start screen's side-scrolling game picker (`src/client/hub.ts`) in place of "More soon" (keep a "More soon" card after it). The card gets original animated art like the others. Kart lives at `/kart` (TV) and `/kart/phone`. Keep the pickleball and bowling URLs and flows unchanged.

## How driving works on the phone

- **Grip:** both hands, phone in landscape with the screen facing you, like a small steering wheel. Detect which way it's turned (left or right side up) and handle both. Try to lock the page to landscape; if the browser won't, show a "turn your phone sideways" card.
- **Setup (short, same style as the other games):**
  1. Allow motion (iOS permission tap).
  2. Hold the phone level like a wheel and tap: this sets **center**.
  3. Turn it all the way left, then all the way right: this sets the player's comfortable steering range.
  4. Show "✓ Saved on this phone" and offer Skip next time.
- **Steering = tilt:** rotating the phone like a wheel (around the axis that points out of the screen, read from gravity) steers.
  - Small dead zone near center so the kart drives straight when you hold still.
  - A gentle response curve: small tilts give fine control, big tilts give full lock.
  - Smooth it with `MotionFilter`, time-based, not per-event, so 60 Hz and 120 Hz phones steer the same.
  - Steering sensitivity is a setting (Gentle / Normal / Sharp) and is saved per phone.
- **Gas and brake:**
  - Default: **auto-gas**, so new players only have to steer.
  - Option, saved per phone: **tilt to drive**. Tilting the top of the phone away from you accelerates and toward you brakes or reverses, measured from the center you set.
- **Buttons (big, thumb-sized, in the bottom corners):**
  - **Left thumb: DRIFT/HOP.** Tap to hop; hold while steering to drift. Drift charges a boost: sparks change color through 3 levels, and letting go gives a short speed boost.
  - **Right thumb: ITEM.** Tap to use the held item forward. Hold and tilt the phone toward you before letting go to throw it behind you.
  - **Top center: small pause/menu button.** Pausing works only for the host, or during solo play.
  - Buttons give haptic taps where the phone supports it (Android `navigator.vibrate`). iPhone Safari has no web vibration, so show a visual flash instead.
- **Motion gestures (extras on top of the buttons):**
  - A quick **upward flick** while airborne off a ramp does a trick for a small landing boost.
  - **Shaking** the phone breaks free faster from a sticky item.
  - Make the thresholds strict enough that normal steering never triggers them.
- **What the phone shows while racing:** your place (e.g. 3rd/8), lap, held item (big icon), a steering arc that shows your current tilt, and the drift charge meter. Keep it readable at a glance. The race itself is watched on the TV, not the phone.

## Unique power-ups (original, Sportle-themed)

Items come from glowing **Sportle item cubes** on the track. Odds depend on position: players near the back get stronger catch-up items, and the leader mostly gets defensive ones. Each player holds one item at a time; some items have 3 uses.

- **Dink Shot:** a pickleball you lob forward. It arcs and bounces twice, and a kart hit by it spins out briefly. Can be thrown backward as a short lob.
- **Pin Bowl:** a bowling ball that rolls straight down the track and knocks over anyone in its lane. Uncommon item **Strike Bowl**: a giant ball that follows the track's center line through the first few places.
- **Paddle Guard:** a spinning paddle shield around your kart that bats away the next incoming item. A quick swing gesture with the phone sends it back the way it came.
- **Spin Serve (×3):** three fast curving pickleballs. The tilt at release bends their path left or right, the same idea as the bowling hook.
- **Pin Fence:** drops a row of 3 bowling pins behind you. Karts hitting them wobble and lose speed.
- **Turbo Tape (×3):** short speed boosts, one per tap.
- **Sweet Spot:** for a few seconds your kart glows, can't be knocked over, and every boost pad gives double speed. Rare; mostly given to players near the back.
- **Net Toss:** throws a net that sticks to the first kart ahead within range, slowing it until its driver shakes their phone to break free or about 2 s pass.
- **Comeback Cannon:** shoots your kart forward along the track to just behind the player ahead of you. Only for the last two places.
- **Crowd Wave:** a stadium wave ripples down the track from your kart. Every kart ahead of you within range gets a brief bump in the air (no spin), and you get a small boost. Rare; for players near the back.
- **Ball Machine:** places a pitching machine on the track for 6 s that fires pickleballs across the road at a steady rhythm. Timing your way through it is a skill.

All item hits are decided on the server. Keep hits short and readable (a ~1 s spin or wobble), never longer than about 2 s of lost control, so it stays fun for families.

## The game

- **Driving model (server):**
  - Arcade, not simulation: speed, acceleration, grip, a drift state with a slip angle and boost charge, off-road slowdown, wall bounces, jumps with gravity, boost pads and ramps.
  - Each kart has a few stats (speed, acceleration, handling, weight) from the chosen kart body. Keep the differences small.
  - Bump physics between karts: heavier karts push lighter ones.
  - Respawn: a little drone lifts a fallen kart back onto the track after ~1.5 s.
- **Tracks:** 4 to start, built with the existing map scenery and the zero-flicker check (`scripts/dev/find-zfighting.ts`):
  - **Court Circuit:** loops through a giant pickleball complex, over the nets and under the scoreboard.
  - **Neon Lanes:** a night city with a section running down a giant bowling lane, where the pins are moving obstacles.
  - **Beach Boardwalk:** sand off-road, a pier jump, boost pads on the boardwalk.
  - **Skyline Rooftops:** rooftop-to-rooftop jumps and a tight spiral down a parking garage.
  - Each track has a racing line, item cube rows, boost pads, at least one shortcut that needs a boost or a good drift, and a minimap.
- **Race format:** 3 laps, 8 karts per race (players + bots fill the rest). There's a countdown with a start boost if gas is pressed at the right moment, lap and final-lap callouts, a finish-line slow-motion and a results board with points.
- **Cups:** 4 tracks in a row with points (like a season), plus single race and time trial (with ghost replay of your best lap, saved in the browser).
- **Camera views:** chase camera (default), a closer first-person/bumper camera, and a TV broadcast mode for spectators. On the shared TV, split screen for 2–4 local players (2 = side by side, 3–4 = quadrants), each view following its player.
- **Presentation:** same callout style as pickleball/bowling (DRIFT BOOST!, NICE TRICK!, FINAL LAP!, position change pops), engine hum that rises with speed, item sounds, crowd at the finish, LED boards around the track showing positions.
- **Characters and karts:** the existing capsule characters and outfits drive. Add a few kart bodies (e.g. a cart built like a pickleball paddle, a bowling-ball roller, a classic go-kart), built from the same box/blob builder and tinted with the player's color.

## Single player and multiplayer

- **Solo:** you vs 7 bots (Rookie / Club / Pro). Bots follow the racing line with personality: some drift well, some use items aggressively. Pro bots must be beatable with good drifting.
- **Same TV, one shared QR:** up to 4 players in split screen (5–8 phones possible if one big shared view is used with a leader camera; show that as an option, not the default).
  - Each phone joins with a name, outfit and kart.
  - The host picks the track/cup and starts the race.
  - A phone that drops out: its kart slows to a stop and waits up to ~30 s ("Waiting for Sam's phone…"). Then a bot takes over the kart until the phone rejoins. Rejoining with the same phone takes the kart back mid-race.
- **Online (later, not this task):** keep the room design ready for a second household to join, but don't build online racing now.

## Latency (be honest)

Steering is continuous, unlike a single swing or bowl, so input delay matters more here.

- Send steering at a steady rate (about 30–60 Hz) with sequence numbers and timestamps through the existing input path.
- The server applies the most recent value and smooths it.
- Measure the real end-to-end delay from a tilt to the kart turning on screen, over Wi-Fi and the tunnel, and record it in `docs/STATUS.md`.
- If the delay hurts, consider small client-side smoothing on the TV (never changing the server's result). Don't claim it feels instant until it's been measured with real phones.

## Guardrails (same as the rest of the repo)

- Server-authoritative physics, items, laps and placings. Keep timestamp/sequence validation and per-input ids applied once. No runtime dependencies. Native DOM/WebGL. Strict TypeScript.
- No simulated multiplayer in place of real connections. Synthetic sensors only in tests.
- Never claim real-world steering angle or exact phone position. Don't present untested phone behavior as tested.
- Original art, names and sounds only. No real brands, and nothing copied from existing kart games.

## Tests and checks

- **Unit tests:**
  - Steering mapping: center/range from setup; dead zone; the same tilt sequence gives the same steering at 60 and 120 Hz; both landscape orientations.
  - Drift charge levels and boost.
  - Lap counting, including no shortcut through checkpoints and wrong-way detection.
  - Placings with ties broken by distance.
  - Item odds by position.
  - Every item's effect and duration, including Paddle Guard blocking and Net Toss breaking free on shake.
  - Inputs from a phone not in the race are ignored.
  - Drop → bot takes over → rejoin gets the kart back.
- **Browser smoke test** (like `scripts/bowling-smoke.mjs`, using `scripts/patient.mjs` for CI timing):
  - The TV opens Kart from the hub picker, and two synthetic phones join one QR and finish setup.
  - Tilting a phone left turns its kart left on the server.
  - Drift + release gives a boost.
  - An item is picked up and used.
  - A lap is counted.
  - Results are shown.
- Screenshots of each track, split screen and the phone controls with `scripts/screenshots.mjs` (extend it).
- `npm run check` and `npm run test:browser` must pass, pickleball and bowling included, and GitHub CI must stay green.
- Update `README.md`, `docs/STATUS.md` (honestly: what was tested and what still needs a real phone, plus the measured steering delay) and `docs/DEVICE_TESTS.md` with kart phone checks (both landscape orientations, iPhone Safari and Android Chrome, steering feel, buttons reachable with thumbs).

## Done looks like

From the Sportle start screen I scroll to Kart, pick solo or multiplayer and a track, and scan one QR with my phone (and my friends scan the same one). I hold my phone sideways like a wheel. Tilting it steers my kart smoothly, holding the drift button around a corner charges a boost, and tapping the item button fires a Sportle power-up like a Dink Shot or a Pin Bowl. We race 3 laps on a lit 3D track that looks like Sportle, in split screen on the TV, and a results board shows who won.
