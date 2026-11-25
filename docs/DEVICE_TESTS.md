# Physical-device acceptance checklist

**Not run on physical phones in the initial session.** Chromium tests injected synthetic sensor events. They cannot validate Safari permission prompts, gyroscope direction, device noise, comfort, background lifecycle, or real wireless latency.

Record for every run: phone model, OS/browser version, screen orientation, dominant hand, network (same Wi-Fi / separate cellular), public server origin, approximate RTT, pass/fail and notes.

Run on **iPhone Safari** and **Android Chrome**, with both left/right hand selections and portrait/landscape calibration.

## Connect and calibrate

- [ ] Desktop shows a public HTTPS QR and six-character room code.
- [ ] Camera scan opens the controller; manual room-code entry works.
- [ ] Nickname and team slot appear on the correct display.
- [ ] Enable motion is an explicit gesture. Safari grants the required motion/orientation permissions; Android receives actual samples.
- [ ] Permission denial gives a useful explanation; no false claim of live sensors.
- [ ] Unsupported sensor device stays unready and shows the sensor message.
- [ ] Neutral calibration gives a stable paddle; holding still for 30 seconds creates zero shots.
- [ ] Gentle then moderately quicker compact swings complete onboarding without full-force motion.
- [ ] Sensitivity works at comfortable range; a too-strong first calibration swing can be retried.
- [ ] Pitch/roll/yaw visibly track the paddle. Left hand does not invert intended aim incorrectly.
- [ ] Rotating the screen requires recalibration and does not silently swap shot axes.

## Initial success criterion

- [ ] Scan → join → enable → calibrate → visible paddle follows angle.
- [ ] Start Motion lab, let the ball bounce, and hit it inside the reach window.
- [ ] Gentle and stronger compact swings produce visibly different trajectories/speeds.
- [ ] Open-face upward motion lobs; upward brushing rolls; downward low-ball motion never smashes.
- [ ] Early/late/out-of-reach swings miss; one swing cannot double-hit.
- [ ] Sensor/test display values reflect actual samples and readable estimated intent.

## Game and multiplayer

- [ ] Solo bot sustains beginner rallies and can miss. Medium/hard stay within movement limits.
- [ ] Serve and return must bounce; side-out scoring is correct; 11 requires a two-point margin.
- [ ] All required human slots must ready before singles / co-op / doubles start.
- [ ] Two phones on one display work. Four-phone doubles has predictable coverage and clear teams.
- [ ] A second household display sees the same rally and score over a different network.
- [ ] The second display shows its own QR; with **Team 2** selected there, its phones join team 2.
- [ ] Host **→ Team** buttons move players; Start stays disabled while teams are uneven.
- [ ] A far-team (team 2) player tilting the paddle right sends the ball to their own right.
- [ ] Well-timed compact swings show `sweet spot`; early/late swings show `off-centre` and stray more.
- [ ] On one screen, WASD moves player 1 and arrow keys move player 2 while both phones swing; a remote display's keys move only its own phones' players.
- [ ] Phone thumb pad: thumb up runs toward the net for both Blue and Red players; holding the pad while swinging is comfortable.
- [ ] First-person and third-person views are comfortable (no motion sickness) on a TV and a laptop.
- [ ] Music is pleasant and balanced against hit sounds; Music toggle is remembered.
- [ ] Play again starts a rematch with the same phones; Change mode returns to the menu.
- [ ] Swinging left→right shows “→” on the phone and sends the ball to the player's right; right→left goes left. If reversed, Swap left / right fixes it. Record which grip (screen facing net / facing you).
- [ ] Shots are announced as Forehand/Backhand correctly for right- and left-handed players.
- [ ] Auto positioning: the character waits beside and slightly behind the ball's path, not on top of it.
- [ ] A mistimed shot sometimes pops up; the display shows POP-UP and a target ring; the receiving phone alerts (Android also vibrates); a downward swing smashes it.
- [ ] A soft dink lands in the opponent's kitchen; the opponent's character steps in to play it after the bounce.
- [ ] Invalid/stale inputs cannot move the score or impersonate another player's slot.

## Lifecycle and performance

- [ ] Screen lock, app switch, permission loss, and network disconnect pause the match.
- [ ] Reconnect restores the original slot. Recalibration and readiness precede host resume.
- [ ] Returning from background does not fire a stored swing.
- [ ] Refresh the host and controller tabs; sessions recover or show a clear expiry error.
- [ ] Ten-minute pairing expiry and refresh behave as described.
- [ ] Measure Wi-Fi/cellular RTT and perceived swing-to-contact delay. Record jitter, not only averages.
- [ ] Run 20 minutes with two and four controllers: check dropped packets, heating, battery, memory, and screen wake lock.
- [ ] Small screens remain usable without overlapping buttons; buttons and sensor status are accessible.

Do not mark an unchecked item complete based on unit tests. Add dated device results here after actual testing.


## Four-step phone setup (added 2026-11-19, not yet tried on a real phone)

1. Scan the QR, join, tap **ALLOW MOTION** and Allow. The header should read PADDLE · P1 · ● LIVE · <ms>.
2. Step 02: hold the phone flat like a TV remote, top edge at the screen; press and hold **HOLD TO SET**. The bar should fill in about a second (it restarts if the phone is tilted or moving).
3. Step 03: three forehands with the screen facing the TV. The SWING SPEED gauge should move live and each swing should fill one dash. REDO LAST removes one.
4. Step 04: turn the phone over (back toward the TV), three backhands, FINISH. The phone should switch to the in-game card.
5. In play: open-face high-to-low swings should come out as slices/chops, low-to-high closed-face swings as rolls/topspin, gentle swings near the kitchen as dinks. The display's paddle should tilt with the phone, and the timing callout should name the shot.
6. Reload the controller page mid-match: it should show WELCOME BACK; Allow motion + HOLD TO SET should put you back in, and the match should resume by itself.
7. Turn off Wi-Fi for a few seconds: only the header status should change (RECONNECTING); the screen should stay usable.
8. Left hand: the diagrams and instructions should be mirrored.

## Sportle Bowling phone checks (added 2026-11-22, not yet tried on a real phone)

Use `npm run tunnel`, pick **Bowling** on the TV, then Multiplayer and a lane.

1. Two or more phones scan the **same** QR; each lands on `/bowling/phone`, enters a name/hand/outfit/ball colour, and the page reloads once into setup (no text fields left).
2. Step 01: hold the phone upright in your bowling hand, screen to the TV. Tap (allow motion), then press and hold: the bar should fill in about a second.
3. Step 02: two practice bowls. Each should fill one dash and show the peak rad/s. Note the typical values for a gentle, normal and hard bowl: ____ / ____ / ____ rad/s. Check that walking around or waving the phone gently never counts.
4. The TV lists everyone in join order; drag (or ▲) to reorder; Start.
5. Only the bowler who is up should see **YOUR TURN** (orange card, a buzz). The others show Up next / Nth in line. A swing from a phone that isn't up must not bowl (it shows "Not your turn yet").
6. Bowl with the phone upright: the curve indicator should read STRAIGHT and the ball should go straight. Tilt the top edge left by ~20–40° before releasing: SLIGHT/BIG HOOK and the ball hooks left late on the lane. Repeat to the right, and with a left-handed player.
7. Gentle vs hard bowls: the km/h readout should clearly differ (it is game speed, not your real arm speed). Swing across your body: the ball should start across the lane.
8. Drag the strip to stand left/right; the bowler and the ball's starting point should move.
9. Lock one phone during its turn: the TV says "Waiting for <name>'s phone…"; after 30 s the host gets **Skip turn** / **Let a bot bowl**. Unlock: the turn resumes. Reload a phone: it rejoins the same seat and score after aim (tap, hold).
10. Play a full 10-frame game with two phones: check the scoresheet (strikes/spares/10th frame) and the winner card.
11. **Hold to bowl:** on your turn, press and hold the orange button, swing back, let go swinging forward. Bowl 10 normal straight balls from the centre: how many reach the pins without a gutter? ____ / 10. Do the ball's speed and line feel the same ball to ball? Does the dotted predicted path match where the ball goes (the solid line after)? Does the thumb slip off the button during a hard swing (pointer cancel)?
12. Record: does underhand bowling feel right with the phone screen-forward? Is the hook amount controllable? Any accidental releases during the backswing?

## Sportle Kart phone checks (added 2026-11-24, not yet tried on a real phone)

Use `npm run tunnel`, pick **Kart** on the TV, then Multiplayer and a track. Do each check on **iPhone Safari** and **Android Chrome**.

1. Two or more phones scan the **same** QR; each lands on `/kart/phone`, enters a name/outfit/kart/paint, and reloads once into setup.
2. **Landscape:** after the tap in step 01, does the page lock to landscape (Android Chrome goes full screen)? On iPhone, does the "Turn your phone sideways" card show in portrait and go away in landscape?
3. **Both grips:** do the setup and a lap with the phone's left edge up, then again with the right edge up. Left must steer left in both. Record any grip where it is mirrored: ____.
4. Step 02 (centre): hold level like a wheel; the bar fills in about a second. Step 03: full left and hold, full right and hold. Note the range it saved (`localStorage["sportle-kart"]`): left ____° right ____°.
5. **Steering feel:** drive a few laps of Court Circuit. Is the dead zone right (straight when holding still, no drift on the straights)? Are small corrections fine enough? Is full lock reachable without straining the wrists? Try Gentle / Normal / Sharp and note the favourite: ____.
6. **Buttons:** are DRIFT and ITEM reachable with the thumbs while holding the phone like a wheel? Any accidental presses? Does the hop/drift feel responsive? Do Android presses buzz, and do iPhone presses flash?
7. **Drift:** hold DRIFT around the long right-hander after the start: the sparks should go blue → orange → pink; letting go gives a boost. Is the arc controllable (counter-steer widens it)?
8. **Items:** tap ITEM to throw forward; hold, tilt the phone toward you, let go to throw back. Does a normal grip ever throw backwards by accident?
9. **Gestures:** flick the phone up sharply off the Court Circuit net jumps (NICE TRICK!). Shake to break free of a Net Toss. Check that hard steering never triggers either.
10. **Tilt to drive** (menu): top edge away = gas, toward you = brake/reverse. Is the neutral zone comfortable?
11. **Drop and rejoin:** lock one phone mid-race: the TV says "Waiting for <name>'s phone…", the kart stops; after 30 s a bot drives it. Unlock/reload: the same kart comes back to the phone.
12. **Delay:** film the phone and the TV together at 120/240 fps and count frames from a quick tilt to the kart turning on the TV, over home Wi-Fi and over the tunnel. Wi-Fi: ____ ms. Tunnel: ____ ms. Does steering feel late?
13. Split screen with 2, 3 and 4 phones on one TV: does each quarter follow its own kart, and are the place/lap/item readable from the couch?
