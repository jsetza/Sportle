# POVpickle — motion-controlled pickleball

_(Formerly “visual”. The GitHub repository is still named `visual-pickleball`.)_

An experimental browser-based 3D pickleball game. A computer renders the court; phones provide paddle orientation and swing intent. No phone app and no runtime packages are required.

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
3. Choose nickname and hand; tap **Enable motion controls**. Allow the browser permission prompt.
4. Hold a comfortable neutral position and tap **Set neutral position**. Make a gentle swing, pause, then a slightly quicker compact swing. Adjust sensitivity or recalibrate if necessary.
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

## Controls and simulation

- Acceleration, rotation rate, and relative orientation estimate **intent**, not real-world velocity or position. There is no sustained acceleration integration.
- Orientation filtering, a neutral dead zone, screen-axis normalization, left-hand mirroring, a rearm threshold, a 320 ms cooldown, and a 65 ms peak capture reduce noise.
- Gentle/stronger swings change shot speed and depth. Face angle changes placement; upward intent produces roll/lob behavior. Downward intent only produces a smash above 1.8 m. Very soft swings are dinks into the opponent's kitchen.
- A 120 ms server-side swing window still requires valid ball height and reach. It cannot teleport the paddle to the ball. Within that window, contact happens where the ball is closest to the paddle side of the body.
- **Movement test (phone):** after Enable, the phone asks for four swings — **right, left, up, down** — and records how this phone reports each one, so any grip works (screen forward or back). It checks that right/left and up/down are truly opposite and different from each other, and asks to redo any swing that doesn't fit; each confirmed swing gets a ✓. The learned swings are saved on the phone and offered next time (**Use my saved swings**). After **Ready** the phone switches to an in-game screen with only the status, Pause, the thumb pad (if used) and a two-tap **Redo movement test**, so settings can't be changed by accident.
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
- **Maps:** Arena, Tokyo, Manila rooftop, San Francisco rooftop, Central Park NY — pick one on the start screen.
- **Outfits:** pick one on your phone when you join (jersey, cap, sweatband, chef, astronaut, cowboy).
- **Dropouts:** if a phone drops out the game pauses and resumes by itself when it's back; a reloaded phone needs one tap to rejoin.
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
src/shared/    Shared types, motion filter, pure scoring and rule decisions
src/server/    Node HTTP/SSE transport, rooms/auth, authoritative simulation
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
