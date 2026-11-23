# Prompt: build Sportle Bowling

Paste everything below the line into a new Claude Code session opened on this repo.

---

Build **Sportle Bowling**, the second game in Sportle, inside this repo (jsetza/Sportle). Read `CLAUDE.md`, `README.md` and `docs/STATUS.md` first. The pickleball game must keep working exactly as it does now.

## Goal

A 3D bowling game in the browser where each player's phone is the bowling ball, swung underhand like a real bowl. It should look and feel like the same product as Sportle pickleball: same renderer, same characters, same menu style, same phone pairing and setup feel.

## Reuse, don't rebuild

Use what already exists, and pull out shared pieces where needed rather than copying them:

- **Rendering:** `src/client/renderer.ts` (WebGL2 lighting, soft shadows, reflections, bloom, ACES, FXAA, Auto/High/Medium/Low quality, WebGL1 fallback) and the box/blob/text builder from `scene.ts`/`maps.ts`.
- **Look:** the same capsule characters, outfits and gear, LED boards with the pixel font (add any missing letters), the menu/wordmark/typography, the timing-callout style, sparks and effects, Music & sound panel and music files.
- **Connection:** `src/server/rooms.ts` pairing tokens and QR (`src/client/qr.ts`), `src/client/net.ts` authenticated HTTP input + SSE snapshots and reconnect, rate limits, timestamp/sequence validation, drop → pause → auto-resume, reload → one-tap rejoin.
- **Phone:** the setup flow's style (header, ruler, big hold button, gauge, saved-on-this-phone card, Skip) and `src/shared/motion.ts` (`MotionFilter`, time-based smoothing, `SwingCapture` peak reading, `aimFrom`/`paddlePose`/`swingPath`). Saved phone data stays per phone.
- **Server:** the fixed 120 Hz authoritative loop pattern from `engine.ts`. All physics, pinfall, scoring and turns are decided on the server.

Add a game choice to the start screen: **Pickleball** and **Bowling** tiles in the same visual style, the first step toward a scrollable Sportle game hub. Keep pickleball's URLs and flow unchanged.

## How bowling works on the phone

- **Grip:** hold the phone in your bowling hand, screen facing forward (toward the TV), like holding the ball.
- **Setup (same style as pickleball's, short):** 01 aim at the screen (tap, hold), 02 two practice bowls so the phone learns this player's normal swing speed and left/right sign. Show "✓ Saved on this phone" and offer Skip.
- **Bowl:** a backswing, then an underhand forward swing. The release is read with `SwingCapture` at the swing's peak, not a fixed delay.
  - **Speed** comes from the peak forward-swing speed (rad/s). Gentle → slow ball, hard → fast ball, with sensible floor and cap values like `SWING_FLOOR`/`SWING_SPAN`.
  - **Line/aim** comes from the swing path's left/right component (`swingPath`), so swinging slightly across the body sends the ball across the lane.
  - **Curve (hook):** the phone's tilt/roll at release is the curve indicator.
    - Phone straight (screen facing the TV, upright) → straight ball.
    - Phone rolled/tilted one way (wrist turned like a real hook) → the ball hooks toward that side. More tilt means more hook, capped.
    - Wrist rotation speed around the phone's long axis during release can add spin.
    - Mirror everything for left-handers.
    - Before each bowl, show a live **curve indicator** on both the phone and the TV: a small arc that bends with the tilt and reads STRAIGHT / SLIGHT HOOK / BIG HOOK.
- **Move before bowling (optional):** drag the thumb pad left/right to choose the starting board, as in real bowling. Default is center.
- Gentle waves and walking with the phone must not count as a bowl, using the same effort thresholds idea as pickleball.

## The game

- **Lane:** regulation proportions (about 18.3 m foul line to head pin, 1.05 m wide, gutters, approach area, 10 pins in a triangle, pin deck, ball return). Lane oil can make the hook break late, in the back third.
- **Physics on the server:** ball rolling with sliding → hook → roll phases, gutters, pin-to-pin and ball-to-pin collisions with believable scatter, so strikes and splits happen naturally and the same bowl gives a similar (not identical) result. Pins that fall stay down for the second ball of a frame; the sweep and reset are animated.
- **Scoring:** real ten-pin rules. 10 frames, strikes (X) and spares (/) with bonuses, a 10th frame with up to 3 balls, foul line (stepping over is shown, but keep it forgiving: a warning, not a foul, in casual mode). Show a classic scoresheet on the TV for every player.
- **Camera views (like pickleball's View button):** behind the bowler; a ball-follow camera that tracks the ball down the lane and cuts to a pin-cam at impact; a broadcast angle. Replay of strikes from the pin-cam.
- **Presentation:** STRIKE! / SPARE! / GUTTER / SPLIT callouts in the same comic/LED style as the timing callouts, pin-crash sound, crowd/applause, LED boards that flash on strikes, a speed readout (km/h and mph) and the hook amount after each ball.
- **Maps:** a few lanes in Sportle style: a retro neon alley (night), a modern TV championship arena, and an outdoor one using existing map scenery (e.g. a rooftop or beach). Use `scripts/dev/find-zfighting.ts` to keep floors free of flicker.

## Single player and multiplayer

- **Single player:** you vs the pins (practice with free bowls, or a full 10-frame game), plus an optional bot opponent (Rookie / Club / Pro, varying accuracy and hook control) who bowls on the TV between your frames.
- **Multiplayer, one shared QR:** up to 6 players on one TV, all scanning the same room QR.
  - Each phone joins with a name, hand and outfit.
  - The bowling order is the join order. The host can drag to reorder in the lobby.
  - The **server runs the turns**: only the current bowler's phone is armed.
    - That phone buzzes and shows **YOUR TURN · Frame 4 · Ball 1** with the curve indicator.
    - Every other phone shows **Up next: Sam** / **3rd in line**, their running score, and can't bowl. Swings from a phone that isn't up are ignored on the server, not just hidden on the phone.
  - After each ball the server moves to the next ball or the next player automatically, with a short pause for the result and the pin reset, like real bowling.
  - A bowler who drops out or locks their phone: wait up to ~30 s ("Waiting for Sam's phone…"). Then the host can **Skip turn** or let a bot bowl that frame for them. Rejoining with the same phone resumes their seat and score.
  - Late joiners join at the next frame boundary, or the host can let them start at frame 1 with a handicap. Keep it simple and explain it on screen.
- **Online (later, not this task):** design the turn system so a second household could join a room later, but don't build ranked or online bowling now.

## Guardrails (same as the rest of the repo)

- Server-authoritative physics, scoring and turns. Keep timestamp/sequence validation and per-swing ids applied once. No runtime dependencies. Native DOM/WebGL. Strict TypeScript.
- No simulated multiplayer in place of real connections. Synthetic sensors only in tests.
- Never claim real-world ball speed or exact hand position from the phone. The km/h readout is the game's ball speed, not a measurement. Don't present untested phone behavior as tested.
- Original art only. No real bowling brand names, logos or lane-maker marks.

## Tests and checks

- **Unit tests:** scoring (perfect game 300, all spares, all gutters, 10th-frame bonus balls, splits), the turn order with 1–6 players including drop/skip/rejoin, ignored swings from phones not up, release reading (same synthetic bowl at 60/120 Hz gives the same speed/line/hook), straight vs tilted → straight vs hooking path, and pin physics sanity (a pocket hit at good speed strikes often; a gutter ball knocks nothing).
- **Browser smoke test** (like `scripts/browser-smoke.mjs`): TV + two synthetic phones join one QR → setup → turns alternate → each phone is armed only on its turn → a full frame scores correctly.
- Screenshots of each bowling map and view with `scripts/screenshots.mjs` (extend it for bowling).
- `npm run check` and `npm run test:browser` must pass, pickleball included.
- Update `README.md`, `docs/STATUS.md` (honestly: what was tested and what still needs a real phone) and `docs/DEVICE_TESTS.md` with bowling phone checks.

## Done looks like

From the Sportle start screen I pick Bowling, choose single player or multiplayer and a lane, and scan one QR with two or more phones. The game tells each of us when it's our turn. I swing my phone underhand: holding it straight bowls straight, tilting it hooks. The ball rolls down a lit 3D lane that looks like Sportle, knocks pins with real physics, and the scoresheet keeps real bowling scores until a winner is shown after frame 10.
