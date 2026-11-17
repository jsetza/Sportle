# visual° — motion-controlled pickleball

An experimental browser-based 3D pickleball game. A computer renders the court; phones provide paddle orientation and swing intent. No phone app and no runtime packages are required.

**Status:** Working local prototype with a real authoritative server, real controller connections, practice, singles, and doubles mode paths. TypeScript/build and 36 automated tests pass, including a real-HTTP/SSE four-phone, two-household doubles scenario. A Chromium smoke test connects a synthetic phone, calibrates, starts practice, and hits distinct 37% and 65% shots. `npm run tunnel` provides a no-account public HTTPS URL for phone testing. **No physical iPhone/Android testing or permanent public deployment has been completed.** Do not interpret browser sensor simulation as device validation.

## Run

Use Node.js 24 or newer.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:3000` for a **desktop preview only**. The UI deliberately does not generate a localhost QR code.

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
- **Contact quality** (timing/position of the ball relative to the forehand side, and height) decides how true a shot flies. Off-centre contact spreads the shot wide/long and flattens its arc into the net; hard swings magnify the error. This is what makes compact, well-timed swings the reliable choice. The banner shows `sweet spot` / `off-centre`.
- Characters auto-position with bounded speed and reaction updates, standing beside the ball's path on their forehand side. They may enter the kitchen to play a ball that bounces there, then recover outside. Doubles chooses one covering player. Movement is isolated in `movementTarget()` for a later manual-movement implementation.
- 120 Hz physics; gravity, drag, rebound, simple topspin; swept net-plane collision; interpolated display snapshots around 30 Hz. This is intentionally a lightweight sports simulation, not a calibrated equipment simulator.
- Bots produce the same input shape a phone sends and go through the same contact/rules functions, with speed/reaction limits. They choose drives, rolls, third-shot drops, dinks, lobs and (medium/hard) smashes; medium/hard bots advance to the kitchen line after the return. Difficulty changes placement accuracy, patience for clean contact, and unforced-error rate (easy 9%, medium 7%, hard 4.5% mishits). Bot randomness is a seeded per-match generator, so simulations replay deterministically.
- Sound is opt-in (contact and fault tones). The scoreboard and status banner announce service and faults visually.
- The display is a full-screen 3D arena. The menu shows a cosmetic demo rally between two mascots; it is decoration only and never presented as a match. During play the panel tucks away behind a **Room** tab. Arrow keys + Enter navigate the menu (TV remotes).

## Rules

Baseline: **2026 USA Pickleball Official Rulebook**, consulted November 17, 2026, especially sections 3–7, 8, 10, 11, and 13: https://usapickleball.org/docs/rules/USAP-Official-Rulebook.pdf?court=2026

Court dimensions, diagonal service, two-bounce restrictions, kitchen volleys/momentum, line calls, traditional side-out scoring, singles/doubles service rotation, and 11 win-by-two are modeled. Opening doubles score is 0–0–2.

**Serving assist:** the server generates the player's legal position and a low underhand serve after the score banner. The phone does not measure feet, waist, release legality, or paddle/wrist relationship. Serve timing and trajectory are automated. Players may enter the kitchen to play bounced balls; volleys inside it, volleys before both feet are re-established outside, and volley momentum carrying into it are faults. Net-post strikes and balls striking a player are faults. See [rules and remaining limits](docs/RULES.md). This is not a tournament-certified or exhaustive rulebook implementation.

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
