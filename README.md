# Sportle — motion-controlled pickleball and bowling

_(Formerly “visual”. The GitHub repository is still named `visual-pickleball`.)_

An experimental browser-based hub of 3D motion games. A computer renders the court or lane; phones provide orientation and swing intent. No phone app and no runtime packages are required. The start screen offers **Pickleball** (your phone is the paddle) and **Bowling** (your phone is the ball); see [Sportle Bowling](#sportle-bowling) below.

**Status:** Working local prototype with a real authoritative server, real controller connections, practice, singles, and doubles mode paths. TypeScript/build and 42 automated tests pass, including a real-HTTP/SSE four-phone, two-household doubles scenario. A Chromium smoke test connects a synthetic phone, calibrates, starts practice, and hits distinct 37% and 65% shots. `npm run tunnel` provides a no-account public HTTPS URL for phone testing. **No physical iPhone/Android testing or permanent public deployment has been completed.** Do not interpret browser sensor simulation as device validation.

## Run

Use Node.js 24 or newer.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:3000` for a **desktop preview only**. The UI deliberately does not generate a localhost QR code.

### Put it online for everyone (Render)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/jsetza/visual-pickleball)

1. Sign in at render.com with GitHub and allow access to this repository.
2. Click the button above (or Dashboard → **New → Blueprint** → this repo). `render.yaml` creates one web service, `povpickle`, with a health check at `/healthz`.
3. Open the `https://povpickle….onrender.com` address Render shows. The phone QR address is detected automatically from Render's `RENDER_EXTERNAL_URL`, so no settings are needed. For a custom domain, set `PUBLIC_ORIGIN` to it.
4. The blueprint uses the **free** plan, which sleeps after 15 idle minutes (the first visit then takes about a minute). Switch the service to **Starter** for an always-on game. Keep it at **one instance**: rooms live in memory.

Railway and Fly.io also work with zero configuration of the phone address (detected from `RAILWAY_PUBLIC_DOMAIN` / `FLY_APP_NAME`); the Dockerfile builds the same server. On these hosts the server reads the visitor address from the platform's own header (Render: `True-Client-IP`, Fly: `Fly-Client-IP`, Railway: `X-Real-IP`) so per-visitor limits work behind their proxies.

### Play with real phones today (no hosting account)

Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared` on macOS, `winget install --id Cloudflare.cloudflared` on Windows), then:

```sh
npm ci
npm run tunnel
```

It opens a free Cloudflare quick tunnel (`https://<random>.trycloudflare.com`, a real trusted certificate), starts the server with `PUBLIC_ORIGIN` set to that URL, and prints it. Open **that URL** on the computer/TV (not localhost), create a room, and scan the QR. The URL changes on every run; for a stable address, deploy as described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

```sh
npm run check         # strict TypeScript, production build, unit + real HTTP tests
npm run build
npm start            # serves the built client AND persistent authoritative server
npx playwright install chromium
npm run test:browser # synthetic sensors, NOT physical-device testing
npm run test:load    # loopback load probe: node scripts/load.mjs [rooms] [seconds]
```

An existing Chrome installation may be used with `CHROME_PATH=/absolute/path/to/chrome npm run test:browser`.

## Play

1. Create a **Motion lab** room on the display.
2. Scan its QR code on a phone, or open `/controller` on the same public origin and enter its six-character room code.
3. Choose nickname and hand, then the three setup steps: **01 Aim** — hold the phone flat like a TV remote, top edge at the screen; tap **TAP TO START** (allow motion if asked), then press and hold until the bar fills · **02 three forehands** (screen facing the TV, swing across your body) · **03 three backhands** (turn the phone over). Each step moves on by itself after the third swing. Your swings are then saved on that phone (it says so), so next time it's just tap, hold to aim, and you're in. **Skip: use standard swings** goes straight in without the swing steps.
4. You're in (no separate Ready tap). Next time it says **WELCOME BACK**: tap, hold to aim, and you're in; **Set up my swings again** redoes the swings. Swings take real effort: gentle waves don't count, and full power needs a hard swing.
5. Tap **Ready**. On the display, select **Start practice**. Let the practice ball bounce and swing when it comes within your character's reach.
6. For matches, create a new room in the desired mode. Every required human slot must be connected and ready before starting.

| Mode            | Phones | Assignment                                |
| --------------- | -----: | ----------------------------------------- |
| Motion lab      |      1 | Repeating practice feeds; no scoring      |
| You vs. Orbit   |      1 | Human vs. bot singles                     |
| Head to head    |      2 | One human on each team                    |
| Better together |      2 | Both humans on team 1, two bots on team 2 |
| The full court  |      4 | Two per team; by display choice or host   |

Another household opens the same origin, expands **Join another household’s display**, and enters the room code. That display gets **its own pairing QR** for its own phones. In Head to head and The full court, each display can set **Phones paired on this screen join: Team 1 / Team 2**, so a household's phones land on the same team; otherwise teams auto-balance. The host can move players with the **→ Team** buttons in the lobby, and the start gate requires even teams. Display sessions cannot start/pause a game; the original host controls it.

Phones must stay visible. Backgrounding, lost sensor data, or a disconnected phone pauses the match and clears readiness. Reconnect restores the reserved player slot using a credential stored on that phone; recalibrate and ready, then the host resumes. Refreshing the host tab restores its session within that browser tab.

## Sportle Bowling

Pick **Bowling** on the start screen (or open `/bowling`). Choose **Single player** (one phone; practice or a 10-frame game, optional bot: Rookie / Club / Pro) or **Multiplayer** (up to six phones on one TV, all scanning the **same QR**), then a lane: **Neon alley**, **Championship**, **Rooftop** (New York scenery) or **Beach** (Hawaii scenery).

1. Each phone scans the QR (`/bowling/phone`), enters a name, bowling hand, outfit and ball colour.
2. **Setup, two steps:** 01 hold the phone in your bowling hand, upright, screen toward the TV; tap, then press and hold until the bar fills. 02 two practice bowls (one normal, one a little toward the left) teach the phone which way is your forward swing, your normal swing speed and its left/right sign. It's saved on that phone (**✓ Saved on this phone**); **Skip** uses a standard bowl.
3. The host starts the game; the bowling order is the join order and the host can drag (or ▲) to reorder it in the lobby.
4. **Turns are run by the server.** Only the bowler who is up is armed: that phone buzzes and shows **YOUR TURN · Frame 4 · Ball 1**; every other phone shows **You're up next** / **3rd in line** and its score. Swings from a phone that isn't up are ignored on the server.
5. **Bowl (hold to bowl, the default):** when it's your turn the phone shows a big **HOLD TO BOWL** button. Press and hold it (this locks the curve from how the phone is tilted), swing back, and let go as you swing forward: letting go is the release. Speed is the fastest part of the swing from just before the let-go to ~0.1 s after it (so letting go a touch early or late gives nearly the same ball); the line only shifts if you clearly swing across your body (small sideways wobble reads straight). **Predicted trail:** before each bowl, a dotted yellow path on the lane (and on the phone's mini lane) shows where a normal-speed ball from your spot with your current curve will go; after the bowl, a solid line shows where it really went. Settings → *Bowl without the button* switches to the swing-only release below.

   **Swing only (optional):** a backswing, then an underhand forward swing. The release is read at the swing's peak (`SwingCapture`). Speed comes from the peak forward-swing speed (gentle → slow, hard → fast, with a floor and a cap); the line comes from the swing path's left/right part; the **hook** comes from the phone's tilt (roll) at release, plus a little from wrist twist: upright = straight, tilted = hooks toward that side, more tilt = more hook (capped). A live curve indicator on the phone and the TV reads STRAIGHT / SLIGHT HOOK / BIG HOOK before you bowl. Drag the strip on the phone to choose where you stand.
6. Real ten-pin scoring: strikes, spares, bonuses, a 10th frame with up to three balls, and a classic scoresheet on the TV. STRIKE! / SPARE! / GUTTER / SPLIT callouts, the LED board flashes on strikes, a slow-motion pin-cam replay plays after a strike, and each ball shows its speed (km/h and mph) and hook in boards. The winner shows after frame 10.
7. Cameras (**View** or `V`): ball cam (follows the ball and cuts to the pin cam), **first person** (through the bowler's eyes with the ball in hand; you step up to the line as you bowl and the view tightens on the pins as the ball rolls), behind the bowler, broadcast.

If the bowler who is up drops out or locks their phone, the game waits (“Waiting for Sam's phone…”); after 30 s the host can **Skip turn** (scores an open frame of zeros) or **Let a bot bowl** that frame for them. Rejoining with the same phone resumes the same seat and score. Late joiners start at the next frame; their missed frames count as empty, or, with **Handicap** on, they're credited with the field's average per frame.

Simplifications (honest list): the ball is simulated as sliding on the oiled front and hooking on the dry back third, then rolling; pins are simulated on the deck as standing circles that tip over into falling capsules (2D plus tilt, not full 3D rigid bodies), with a seeded random scatter so the same bowl gives a similar, not identical, result. Stepping over the foul line is a warning only (casual), triggered by very hard bowls since the phone can't see your feet. The km/h readout is the game's ball speed, not a measurement of your arm, and the phone does not track your hand's exact position. Online bowling between households is not built yet; the turn system is per room and could take a second display later.

## Controls and simulation

- Acceleration, rotation rate, and relative orientation estimate **intent**, not real-world velocity or position. There is no sustained acceleration integration.
- Orientation filtering, a neutral dead zone, screen-axis normalization, left-hand mirroring, a rearm threshold, a 320 ms cooldown, and a 65 ms peak capture reduce noise.
- Gentle/stronger swings change shot speed and depth. Face angle changes placement; upward intent produces roll/lob behavior. Downward intent only produces a smash above 1.8 m. Very soft swings are dinks into the opponent's kitchen.
- A 120 ms server-side swing window still requires valid ball height and reach. It cannot teleport the paddle to the ball. Within that window, contact happens where the ball is closest to the paddle side of the body.
- **Phone setup (4 steps):** step 02 records which horizontal direction points at the screen. From then on the paddle face angle (open/closed), which side of the phone faces the TV (screen = forehand, back = backhand) and the swing path (the rotation rate as ω × "toward the screen": left/right and low-to-high/high-to-low) are all screen-relative, whatever the grip. The three forehands and three backhands teach the phone its left/right sign (corrected if this phone reads it reversed), which side counts as the forehand face, and the player's normal swing speed (set as a medium, ~60% shot). Saved on the phone (`pov-paddle`). Header: SPORTLE · PADDLE · P1 · ● LIVE · ms; losing the connection only changes that status (no banner over the setup). Left-handed players get mirrored diagrams and instructions. The in-game card keeps Pause, the thumb pad and a "Paddle settings" drawer (how you move, swing feel, two-tap "Aim at the screen again" / "Set up my swings again").
- **Old movement test (replaced 2026-11-19, kept as a fallback in code only):** after Enable, the phone asks for four swings — **right, left, up, down** — and records how this phone reports each one, so any grip works (screen forward or back). It checks that right/left and up/down are truly opposite and different from each other, and asks to redo any swing that doesn't fit; each confirmed swing gets a ✓. The learned swings are saved on the phone and offered next time (**Use my saved swings**). After **Ready** the phone switches to an in-game screen with only the status, Pause, the thumb pad (if used) and a two-tap **Redo movement test**, so settings can't be changed by accident.
- **Forehand / backhand and swing direction:** each shot is named by the side of the body it was hit on (relative to the paddle hand), e.g. “Backhand drive”. The _sideways path_ of the swing aims the ball: swinging left→right sends it to your right, right→left to your left; the paddle-face angle fine-tunes. The phone reads this from the rotation rate about its long axis (an intent estimate). If it comes out reversed for your grip, turn on **Swap left / right** on the phone; the phone shows the direction of each swing.
- **Slow bounce (assist):** after the ball bounces it follows the same path at 0.8× speed until it is hit, so it stays in the hitting zone about 1.25× as long — same height and landing spot, more time to swing. This is a deliberate game assist, not real ball physics (`BOUNCE_TIME_SCALE = 0.8` in `src/server/engine.ts`; 1 = realistic).
- **Pop-ups and smashes:** badly timed contact (for players and bots alike) can pop the ball up — high, short and past the kitchen. The display shows **POP-UP! Swing down to smash** and a pulsing target ring where the ball drops to smash height; the receiving player's phone shows an alert (and buzzes where the browser supports vibration). In auto movement the player runs to that spot. A downward swing above 1.8 m smashes; on a pop-up a softer downward swing counts. Easy bots don't smash pop-ups.
- **Contact quality** (timing/position of the ball relative to the forehand side, and height) decides how true a shot flies. Off-centre contact spreads the shot wide/long and flattens its arc into the net; hard swings magnify the error. Human players get half the error spread that bots do. This is what makes compact, well-timed swings the reliable choice. The banner shows `sweet spot` / `off-centre`.
- **Movement styles (each player picks on their phone under “How you move”):**
  - **Phone · thumb pad:** a joystick on the phone screen, relative to your facing: thumb up runs toward the net, down backs off, sideways slides. The phone's tilt still aims the paddle, which is why movement is on the thumb instead of tilt.
  - **Keyboard + phone:** WASD / arrow keys on the display (below).
  - **Auto:** the character positions itself.
    In every style, a player stays on auto-positioning until they first move, and the server applies the same speed limit, own-side clamp and kitchen/momentum rules.
- **Camera views:** Third person (chase camera behind this screen's player 1, default), First person (your eyes, with your paddle in the lower right mirroring the phone), or Broadcast. Pick from **View** in the top bar, the lobby, or press **V**. In player views, movement keys are camera-relative.
- **Play again:** when a match ends, the display shows the result and the host's **Play again** starts a rematch with the same players and mode (every phone must still be connected). **Change mode** returns to the menu.
- **Shot types (server-decided from the paddle):** face angle + swing path + swing speed choose the shot — topspin drive/roll (low-to-high, closed face), slice/chop (high-to-low, open face; backspin), dink (gentle near the kitchen) / drop (gentle from the back), drive (fast, flat), lob (big upward, open face), smash (high ball, downward), block/reset (firm face, little swing, hard incoming ball). Spin changes the flight (topspin dips from a higher arc, backspin floats flatter) and the bounce (topspin kicks forward, backspin skids low). Forehand/backhand is named from which side of the phone faced the screen when the phone reports it, otherwise from the contact side. The paddle is drawn large and two-sided (bright hitting face with a stripe, sweet-spot ring on the back, team-colour edge) and follows the phone's orientation.
- **Match setup (lobby):** Opponent Rookie / Club / Pro (bot modes; "Hitbox" otherwise), bot Style All-round / Attacker / Defender, Game to 5 / 7 / 11 (win by 2), 1 game or Best of 3, Warm-up On / Off (10 warm-up hits with no score, bots feed). Start match stays disabled until every phone is set up; the pairing card turns into a big ✓ PAIRED with a checklist (Phone connected · Motion sensors on · Set up). Ranked keeps the fixed rules (11, one game, no warm-up).
- **Use the keyboard instead:** the lobby can give one seat a keyboard paddle on this screen (Space = swing, hold longer = harder; Shift dink, E topspin, Q slice, R lob, F smash; A/D aim; 1/2/3 serve type). It uses the same server rules and input validation as a phone; inputs are flagged as keyboard, not sensors.
- **Face photo (optional):** "Your face on the player" opens the screen's camera with an oval guide; the photo is kept in this browser only (localStorage), never uploaded, and only this screen shows it on its player 1. "Use a drawn face" removes it.
- **Presentation:** Scoreboard (YOU [0][0] OPPONENT, team-coloured edges, serving dot, game pips), context pills (WARM-UP · n TO GO, GAME/MATCH POINT, SIDE OUT), slanted "YOU vs …" match intro with a close-up then a swoop to the play camera (serving waits 2.6 s), POINT!/GAME!/MATCH! banners with confetti in the winner's colour, cheering characters, a crowd roar and a short camera move, flip-animated score digits.
- **Graphics:** lit 3D arena on WebGL2 (per-pixel lighting, soft shadows, court reflections, bloom, tone mapping, FXAA). The top-bar **Graphics** button picks Auto (default, lowers itself if frames run slow), High, Medium or Low. Browsers without WebGL2 get a simpler lit view.
- **Music & sound settings:** the top-bar **Music & sound** button opens a panel with the music style (or Off), music volume, sound effects on/off and sound-effects volume (a sample hit plays when you let go of the slider). Saved per browser. House music is "COULD BE WRONG (Edit)" by LOSTBOYJAY, used with the artist's permission.
- **Your own music file:** put a licensed audio file at `src/client/music/house.mp3` (or .m4a/.ogg/.wav; also `chill`, `synthwave`, `lofi`) and that Music style plays it on loop instead of the synthesised loop — quieter on the menu, fuller in a match. The server lists available files in `/api/config` and serves audio with byte ranges (needed by Safari). Only add music you have the rights to publish (see `src/client/music/README.md`).
- **Music:** original background music synthesised live in the browser (Web Audio, no audio files), louder drums during play. It starts on your first click/key; toggle with **Music** in the top bar (remembered).
- **Keyboard movement:** on each display, <kbd>W A S D</kbd> moves that screen's player 1 and the <kbd>arrow keys</kbd> move player 2 (screen-relative: up = away from the camera). "Player 1/2" means the phones paired through that screen's QR, in join order; the host screen also controls phones that joined by typing the room code. The phone remains the paddle. A player switches to manual movement on their first key press and keeps it for the match; the server applies the same speed limit (4.3 m/s), keeps players on their own side, and still enforces kitchen volley and momentum faults. With four phones on one screen, players 3–4 stay on auto-positioning.
- Without keys, characters auto-position with bounded speed and reaction updates, standing beside the ball's path on their forehand side. They may enter the kitchen to play a ball that bounces there, then recover outside. Doubles chooses one covering player. Movement is isolated in `movementTarget()` for a later manual-movement implementation.
- 120 Hz physics; gravity, drag, rebound, simple topspin; swept net-plane collision; interpolated display snapshots around 30 Hz. This is intentionally a lightweight sports simulation, not a calibrated equipment simulator.
- Bots produce the same input shape a phone sends and go through the same contact/rules functions, with speed/reaction limits. They choose drives, rolls, third-shot drops, dinks, lobs and (medium/hard) smashes; medium/hard bots advance to the kitchen line after the return. Difficulty changes placement accuracy, patience for clean contact, and unforced-error rate (easy 9%, medium 7%, hard 4.5% mishits). Bot randomness is a seeded per-match generator, so simulations replay deterministically.
- **Split screen:** two players on one screen in third- or first-person view get a half each (player 1 left, player 2 right). Player 1 moves with **WASD**, player 2 with the **arrow keys** (if they chose Keyboard on their phone); every phone also has its own thumb pad. Broadcast view stays one shared picture.
- **Volleys and overheads** (hit before the bounce) fly 1.75× faster; soft volleys (dinks) and lob volleys don't.
- **Swing strength sets speed:** weaker forehand/backhand swings send slower balls.
- **Ball slowdown:** the ball leaves the paddle fastest (up to 3× its average speed) and loses 15% of its speed every 0.2 s, still landing where aimed.
- **Difficulty** (every mode) sets your hitbox: Easy 2.3×, Medium 1.6×, Hard normal. In bot modes it also sets bot strength.
- **Maps (22):** Arena, Tokyo, Manila rooftop, San Francisco rooftop, Central Park NY, NYC rooftop at night, Fancy, campus impressions (Berkeley, UCLA, USC, Stanford, Harvard, MIT, Michigan, Texas, Notre Dame — school colours only, no logos), Iceland waterfall, Swiss Alps, Hawaii beach, Sahara, Paris and the Grand Canyon — pick one on the start screen.
- **Outfits:** pick one on your phone when you join (jersey, cap, sweatband, chef, astronaut, cowboy).
- **Dropouts:** if a phone drops out the game pauses and resumes by itself when it's back; a reloaded phone needs one tap to rejoin.
- **Ranked:** Online → Ranked 1 v 1 or 2 v 2 finds players near your rating (RR), each on their own screen and phone. Ratings live on the server in `DATA_DIR` (they reset on hosts without a persistent disk, like Render's free plan).
- Each player's name floats above their head in their team colour (hidden for your own player in first person).
- Sound is opt-in (contact and fault tones). The scoreboard and status banner announce service and faults visually.
- The display is a full-screen 3D arena. The menu shows a cosmetic demo rally between two mascots; it is decoration only and never presented as a match. During play the panel tucks away behind a **Room** tab. Arrow keys + Enter navigate the menu (TV remotes).

## Rules

Baseline: **2026 USA Pickleball Official Rulebook**, consulted November 17, 2026, especially sections 3–7, 8, 10, 11, and 13: https://usapickleball.org/docs/rules/USAP-Official-Rulebook.pdf?court=2026

Court dimensions, diagonal service, two-bounce restrictions, kitchen volleys/momentum, line calls, traditional side-out scoring, singles/doubles service rotation, and 11 win-by-two are modeled. Opening doubles score is 0–0–2.

**Serving assist:** the server generates the player's legal position and a low underhand serve after the score banner. The phone does not measure feet, waist, release legality, or paddle/wrist relationship. Serve timing and trajectory are automated. Players may enter the kitchen to play bounced balls; volleys inside it, volleys before both feet are re-established outside, and volley momentum carrying into it are faults. Net-post strikes are faults. A ball striking a player is deliberately _not_ a fault in this game (see docs/RULES.md). See [rules and remaining limits](docs/RULES.md). This is not a tournament-certified or exhaustive rulebook implementation.

## Architecture

```text
src/client/    Typed DOM menus, phone sensors, WebGL renderer, QR encoder, transport
               (bowling: bowling.ts TV + phone pages, bowlscene.ts lane/pins on the same renderer)
src/shared/    Shared types, motion filter, pure scoring and rule decisions
src/server/    Node HTTP/SSE transport, rooms/auth, authoritative simulation
               (bowling: bowling.ts turns/scoring/bots, bowlphysics.ts ball and pins)
scripts/       Type-stripping build, browser smoke test, HTTPS tunnel launcher, load probe
tests/         Rules, physics, input/room lifecycle and real HTTP integration
```

The stack is TypeScript + native browser/WebGL APIs + Node HTTP. It uses persistent Server-Sent Events for state and small authenticated POSTs for controller inputs at up to 30 Hz. There are no runtime dependencies; TypeScript, Playwright, and Prettier are development tools. The build strips erasable types and rewrites module extensions. Strict checking runs separately with `tsc`.

Rooms have separate host/display/controller roles, random credentials, ten-minute pairing credentials, and 24-hour reconnect sessions. The short room code also permits manual pairing during the pairing window. Controller packets include clock-corrected timestamps and sequence numbers; stale, duplicate, non-finite and out-of-range inputs are rejected. Credentials are excluded from snapshots. The QR stores its pairing credential in the URL fragment. Request limits apply per IP only to unauthenticated traffic (strict for guessable manual room-code joins, looser for QR-token joins); authenticated traffic is budgeted per session, so several households behind one NAT are not throttled together. One-hour abandoned-room cleanup is implemented.

Room state is in memory, so a server restart loses matches. Use one server instance; horizontal scaling would require shared room ownership and session/state storage. A loopback load probe sustains 50 doubles rooms (200 controllers at 30 Hz) with no rejected input and ~30 snapshots/s per display; wide-area and cellular behaviour has not been measured.

## Hosting and GitHub

GitHub stores the source. **GitHub Pages alone cannot run this game server.** Use a persistent Node/container host behind a trusted HTTPS reverse proxy. The simplest deployment serves both frontend and backend from this server; splitting onto a static host requires routing `/api/*` to the same backend and adjusting origin policy deliberately.

[Deployment instructions](docs/DEPLOYMENT.md) include a Docker option and proxy requirements. No hosting account, domain, or paid service has been provisioned. `npm run tunnel` is the no-account development path.

## Verification and handoff

- [Test results and implementation status](docs/STATUS.md)
- [iPhone Safari / Android Chrome checklist](docs/DEVICE_TESTS.md)
- [Claude project context](CLAUDE.md)
- [Copy-paste continuation prompt](docs/CLAUDE_PROMPT.md)
