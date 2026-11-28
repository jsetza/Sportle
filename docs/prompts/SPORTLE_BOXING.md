# Prompt: build Sportle Boxing

Paste everything below the line into a new Claude Code session opened on this repo.

---

Build **Sportle Boxing**, the fourth game in Sportle, inside this repo (jsetza/Sportle). Read `CLAUDE.md`, `README.md` and `docs/STATUS.md` first. Pickleball, Bowling and Kart must keep working exactly as they do now.

## Goal

An arcade motion-boxing game in the browser: you see your opponent across the ring from just behind your own fighter, and you throw real punches with your phone. Jab, hook and uppercut come from how you move. You block by raising your guard and dodge by leaning. It should feel quick, physical and funny, a party game for families, and look like the same product as the other Sportle games: same renderer, capsule characters, menus, phone pairing and setup feel.

This is an **original game**. Don't copy any existing boxing game: no borrowed characters, names, opponents, arenas, sounds or looks. The capsule fighters wear Sportle gear and big padded gloves.

## Reuse, don't rebuild

- **Rendering:** `src/client/renderer.ts` and the box/blob/text builder and characters from `scene.ts`. Add a `BoxScene` like `BowlScene`/`KartScene`.
- **Look:** the same capsule characters and outfits, LED boards, callout style (comic/LED text), sparks and effects, and the Music & sound panel (`mountSound`).
- **Connection:** rooms, pairing QR, `net.ts` HTTP input + SSE snapshots, reconnect, drop → pause → resume, reload → one-tap rejoin, timestamp/sequence validation.
- **Phone:** the same setup style and `src/shared/motion.ts` filtering. Saved phone data stays per phone.
- **Server:** the fixed 120 Hz authoritative loop. Hits, blocks, dodges, damage, knockdowns and rounds are all decided on the server.
- **Hub:** add a **Boxing** card to the start screen strip (`src/client/hub.ts`) with original card art. When Boxing is picked, its ring scene fills the screen like the other games. It lives at `/boxing` (TV) and `/boxing/phone`.

## Controls (phone in your hand like a glove)

- **Default: one phone, held in your punching hand,** screen facing sideways. Each player picks left- or right-handed in setup.
  - **That phone's hand punches:**
    - **Jab:** a quick straight thrust forward.
    - **Hook:** a sideways swing that arcs around.
    - **Uppercut:** an upward swing.
  - **The other hand's punch:** a big **SWITCH** button on the screen (thumb). Hold it while punching to throw with your other hand. Mirror the animation.
- **Optional: two phones, one per hand.** Both pair to the same fighter as LEFT and RIGHT gloves. This should be the most natural way to play. Design the pairing for it from the start.
- **Guard (block):** hold the phone upright in front of your face, about still, for about 0.2 s. The fighter raises their gloves.
- **Dodge:** lean (tilt the phone) left or right, or duck by tipping it down. The fighter slips that way for a moment.
- **Punch strength:** the peak speed of the motion, with sensible floor and cap values like `SWING_FLOOR`/`SWING_SPAN`.
  - Gentle shakes and walking must not throw punches.
  - Small "punch spam" waggles must do little damage: hits need real effort.
- **Setup:**
  1. Allow motion.
  2. Choose your hand.
  3. Hold your guard up: this sets the guard pose.
  4. Throw 2 jabs, 2 hooks and 2 uppercuts so the phone learns your style.
  5. Show "✓ Saved on this phone".
- **Feedback:** a short haptic buzz on Android when a punch lands or is blocked; a visual flash on iPhone, which has no web vibration.

## The fight

- **View:** from just behind your own fighter, with your gloves big on screen and the opponent across the ring. In 2-player on one TV, use split screen (side by side), each view from its own fighter. Also offer a broadcast camera.
- **Hits:** the server decides each punch, by type, hand and timing, against the opponent's guard and dodge:
  - jabs are fast and weak;
  - hooks are stronger and beat a straight guard from the side, but can be ducked;
  - uppercuts are the strongest, slowest, and break a high guard.
  - Blocked punches do chip damage. A punch thrown while the opponent is mid-punch is a counter, with bonus damage and a "COUNTER!" callout.
- **Stamina:** throwing lots of punches tires you, and tired punches are weaker and slower. It recovers when you stop. This keeps flailing from winning.
- **Health and knockdowns:** a health bar per fighter. At zero, a knockdown with a 10-count. The downed player gets up by shaking or raising their phone, and gets up faster the more they move. Three knockdowns in a round is a TKO, and a knockdown not beaten by 10 is a KO.
- **Rounds:** 3 rounds of about 1 minute with a short break between. If nobody is knocked out, there's a simple points decision (clean hits landed).
- **Presentation:**
  - Callouts: JAB / HOOK / UPPERCUT, COUNTER!, BLOCKED, DODGED!, DOWN!, the 10-count, KO! / TKO!
  - Faces react (squash and stretch on hits), plus sparks, a crowd, a bell, and LED boards with the round, time and punch stats.
  - After the fight, a stats screen: punches thrown/landed, power, counters, dodges.
- **Rings:** 2–3 to start in Sportle style, e.g. a neon night club ring, a big TV championship arena, and an outdoor rooftop ring. Use `scripts/dev/find-zfighting.ts` so floors don't flicker.

## Modes

- **Solo vs bots:** a ladder of original opponents (at least 5) with personalities and patterns, e.g. a slow heavy hitter, a fast jabber who dodges a lot, a counter-puncher, a guard-turtle. Each is beatable once you learn their tells. Rookie / Club / Pro levels.
- **Training:** a punching bag and a mitt drill that shows punch type and power, so players learn the moves.
- **2 players, one TV, one QR:** split screen, each with their own phone (or two phones each).
- **Online (later, not this task):** keep the room design ready for two households, but don't build it now.

## Latency (be honest)

Punches are short events, so send each detected punch as one input with its type, power and a timestamp. The server checks it against the opponent's state at that moment. Measure the delay from a phone punch to the hit on the TV over Wi-Fi and record it in `docs/STATUS.md`. Don't claim it feels instant until it's been measured with real phones.

## Guardrails (same as the rest of the repo)

- Server-authoritative fighting. Keep timestamp/sequence validation and per-input ids applied once. No runtime dependencies. Native DOM/WebGL. Strict TypeScript.
- No simulated multiplayer in place of real connections. Synthetic sensors only in tests.
- Never claim real punch force, speed or hand position from the phone. Power numbers are the game's, not measurements. Don't present untested phone behavior as tested.
- Original art, names and sounds only. Keep the violence cartoonish: no blood, just stars, wobbles and big squishy gloves.

## Tests and checks

- **Unit tests:**
  - Punch reading: jab/hook/uppercut from synthetic motion; the same motion at 60/120 Hz gives the same result; gentle motion and walking throw nothing; spam waggles stay weak.
  - Guard and dodge detection.
  - Hit/block/dodge/counter outcomes.
  - Stamina.
  - Knockdown, 10-count, get-up, KO/TKO, rounds and the decision.
  - Bot patterns.
  - Two-phone pairing (left/right gloves) and drop/rejoin.
  - Inputs from a phone not in the fight are ignored.
- **Browser smoke test `scripts/boxing-smoke.mjs`** (use `scripts/patient.mjs` for CI timing; read state from the server, not just the TV page):
  - The TV opens Boxing from the hub, two synthetic phones join one QR and finish setup.
  - A jab lands and lowers health.
  - A guard blocks.
  - A knockdown and count happen.
  - The round ends.
- Add it to `npm run test:browser`. Screenshots of each ring, the split screen and the phone page go in `docs/screenshots/boxing/`.
- `npm run check` and `npm run test:browser` must pass, with every other game included, and GitHub CI must stay green.
- Update `README.md`, `CLAUDE.md` (file list), `docs/STATUS.md` (honestly: what was tested and what still needs a real phone) and `docs/DEVICE_TESTS.md` with boxing phone checks.

## Done looks like

From the Sportle start screen I scroll to Boxing, pick solo or 2 players and a ring, and scan the QR with my phone. I hold it like a glove and throw a jab, a hook and an uppercut. My fighter does the same on the TV, the opponent reacts, and their health drops. I raise my phone to block and lean to dodge. After three rounds, or a KO, the stats screen shows who won.
