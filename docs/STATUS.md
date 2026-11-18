# Handoff status — 2026-11-17 (Claude session)

## Implemented

- Real HTTP pairing/join with QR/manual room code, separate host/display/controller sessions, expiring pairing, reconnect tokens, and abandoned-room cleanup.
- **Per-display pairing:** every display (host or another household) gets its own pairing QR; a display can direct its phones to Team 1 or Team 2; the host can switch teams in the lobby; the start gate requires even teams.
- Phone permission UI, neutral orientation, two-swing calibration, live diagnostics, sensitivity, left-hand/screen orientation handling, and background/disconnect pause.
- **Arena redesign (user-directed, inspired by a reference menu style; original branding):** full-screen dark arena with tiered crowd, ad boards with original pixel lettering, spotlight pools and depth fog (static geometry cached in its own GPU buffer); capsule mascots with face plates, shades, jersey stripes, team rings (white ring marks the covering player in doubles), bot antennae; contact bursts (extra flash on sweet-spot hits) and ball trail; cinematic menu camera with a cosmetic attract-mode rally (shown only on the menu, never as a match), lobby camera, broadcast match camera with lens shift beside the panel. Left-panel menu: wordmark, grouped On this screen / Online lists, bot level pills, Create game, keyboard/TV-remote arrows + Enter; lobby pairing card; collapsible panel during play; How to play dialog; fullscreen. Teams are now Blue and Red. Phone controller restyled to match.
- Practice feeds and swing-dependent contact; fixed-step authoritative physics and scoring.
- **Contact quality:** timing/position relative to the forehand side and contact height set shot accuracy; mishits go wide/long or into the net, amplified by hard swings. Human swing windows meet the ball at the best point within 120 ms.
- **Rules additions:** kitchen entry to play bounced balls; volley before both feet re-established outside the NVZ is a fault; time-bounded volley momentum; net-post strikes; ball striking a player. Far-team aim mirroring bug fixed (team 2's left/right was inverted; its paddle was drawn behind the character).
- **Bots:** same Input shape and rule path as phones; drives, rolls, third-shot drops, dinks, lobs, smashes; medium/hard move to the NVZ line; difficulty-scaled accuracy, patience and unforced errors; seeded deterministic RNG. Matches now finish (previously bot rallies never ended because shots could not land out).
- **Keyboard movement (user request):** WASD = this display's player 1, arrow keys = player 2; phones stay the paddle. Server-authoritative (`/api/move`, sequence-checked, host/display sessions only, mapped to phones paired by that display); manual mode starts on first key press; speed limit, own-side clamp, kitchen/momentum rules apply. Verified in unit tests and a headless-Chrome run with real key presses on the display page (D moved player 1 right, ← moved player 2 left).
- **Movement styles (user request):** per player on the phone: thumb pad (phone-only movement, facing-relative, validated `mx/mz/ctl` fields on the existing timestamped input), keyboard on the display, or auto. Display keyboard slots map only to keyboard-style players.
- **Camera views (user request):** third person (default), first person (body hidden, paddle mirrors phone), broadcast; V key / top bar / lobby; remembered per browser; keys camera-relative in player views.
- **Play again (user request):** host-only `/api/rematch` after `over`; same roster/mode, fresh score; result card on the display, status on phones.
- **Music (user request):** procedural Web Audio loop (no files); on by default after first gesture, toggle remembered; intensity rises in play.
- **Removed (user request):** ball-striking-player fault.
- Verified in headless Chrome (synthetic sensors, not a real phone): thumb pad shows during play; full solo match to 11–0; Play again resets to 0:0; first/third/broadcast views render; no page errors. Music output itself was not listened to (headless).
- **Tunnel fix (found during the owner's first real-phone attempt):** Cloudflare quick tunnels don't support SSE and cap in-flight requests at 200; stalled streams led to Cloudflare error pages that iPhone Safari reported as “The string did not match the expected pattern” when tapping Ready. The client now polls `/api/state` on trycloudflare hosts (or when SSE stalls), and non-JSON proxy replies produce a readable error. Verified with a full headless-Chrome match forced onto polling. `npm run tunnel` now waits for a registered connection, picks a free port, and ignores Cloudflare's API hostname.
- **Swing feel (owner feedback after first real-phone session):** forehand/backhand naming from contact side; sideways swing path (`side` input, validated) steers the ball, face angle fine-tunes; Swap left/right toggle and per-swing direction readout on the phone because the sensor sign for this grip is **not yet verified on hardware**; human error spread halved; auto positioning now goes to the post-bounce waist-height intercept on the forehand side (fixes players standing on top of the ball, and a drift that made them back away from it). Tests added (46 passing).
- **Pop-ups (owner request):** poor contact (quality < 0.55) pops up half the time instead of straying wide/long/into the net; `popup`/`popupAt` in the snapshot drive a display callout, target ring and phone alert/vibration; auto movement goes to the smash point (outside the NVZ); smash contact is taken immediately during the swing window and not penalised for height on pop-ups. Tests: pop-up shape, and auto-positioned downward swings smash ≥ 20/30 pop-ups (48 tests passing). Easy bot-vs-bot rallies got longer (easy bots don't smash); medium/hard matches finish with no side bias.
- **Slow bounce (owner request):** post-bounce ball time runs at 0.5× (`BOUNCE_TIME_SCALE`), so the bounce lasts 2× with the same height and path; documented as an assist. Test verifies 2× hang time and unchanged bounce height (49 tests passing).
- Mode paths for singles vs bot, human singles, co-op doubles, and four-human doubles.
- `npm run tunnel`: Cloudflare quick tunnel + server with PUBLIC_ORIGIN set, for no-account phone testing.
- Rate limiting: per-IP only for unauthenticated traffic (strict for manual code joins, looser for QR-token joins); per-session budget for authenticated traffic, so households behind one NAT are not throttled together.
- Strict TypeScript, build script, lockfile, Docker recipe, CI workflow, setup/deployment/device-check docs.

## Actual verification (this session, Linux sandbox, Node 22.23)

- `npm run check`: **PASS** — strict typecheck, production build, **49 tests**.
- `npm run test:browser` with `CHROME_PATH=/usr/bin/google-chrome`: **PASS** — synthetic sensors, shots at 37% and 65%, both `sweet spot`. (BarcodeDetector unavailable in headless Linux Chrome, so QR decode was skipped there; it was verified by Codex earlier on desktop Chrome.)
- `tests/multiplayer.test.ts`: real Node HTTP/SSE with **two household displays and four controller sessions**: per-display QR tokens, team preference, host team swap, 5th phone refused, host-only actions enforced, both displays receive identical rally state, out-of-order / duplicate / 5 s-stale / out-of-range inputs rejected, silent phone pauses the match, reconnect restores slot and team, resume refused until ready.
- Load probe (`node scripts/load.mjs`, loopback, load generator on the same machine): 10 / 25 / 50 doubles rooms (40 / 100 / 200 controllers at 30 Hz) → 0 rejected inputs; input RTT p50 1.4 / 3.0 / 6.8 ms, p95 8.4 / 17.0 / 39.6 ms; ~30 snapshots/s per display.
- Bot-vs-bot simulation over 12 seeds: no systematic side bias; rallies average roughly 10–22 contacts; matches end at 11 win-by-2.
- Lobby rendering with a remote display inspected via screenshot.

## Not verified / incomplete

1. **No physical iPhone Safari or Android Chrome tests.** The success criterion is not yet certified on hardware. Contact-quality tuning was done in simulation only.
2. `npm run tunnel` could not be run end to end in the sandbox (no route to Cloudflare). No permanent public deployment exists.
3. No wide-area/cellular latency or jitter measurement with real phones.
4. Remaining rule limits are listed in RULES.md (serve assist, partner contact, tournament procedures, ball footprint).
5. Rooms are memory-only; a server restart drops matches.
6. Docker and GitHub Actions recipes have not been executed here.
7. Browser smoke test passed 3 of 4 consecutive runs after the redesign; the one failure was an aborted request under software (SwiftShader) rendering. Watch for flakiness in CI.

## Environment notes

Playwright's browser download is blocked in the sandbox; the system Chrome was used via CHROME_PATH. Do not commit `node_modules`, `dist`, `.env`, browser profiles, or test session credentials.
