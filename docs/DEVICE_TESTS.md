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
