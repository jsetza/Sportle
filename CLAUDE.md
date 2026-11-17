# Claude project context

Read README.md and docs/STATUS.md before editing. Preserve the working phone-to-practice path while extending the game.

## Goal

A browser-based 3D pickleball game named visual, with phones as motion-controlled paddles, shared or remote household displays, solo bots, online singles, co-op doubles, and four-human doubles. The most important acceptance criterion is a real phone scanning a public HTTPS QR, enabling sensors, calibrating, moving a visible paddle, and hitting a practice ball differently with gentle and stronger swings.

## Stack and commands

Node 24+, TypeScript, native DOM/WebGL, HTTP POST input + persistent SSE snapshots. No runtime dependencies. `npm ci`, `npm run check`, `npm run dev`. Browser test: `npx playwright install chromium && npm run test:browser`.

- src/client/app.ts: display and controller UI + sensor flow.
- src/client/scene.ts: WebGL court/characters and interpolation.
- src/client/qr.ts: locally generated version-6-L QR; verified with Chrome decoder.
- src/client/net.ts: authenticated HTTP and streaming reconnect.
- src/shared/motion.ts: motion filtering/calibration, no physical-position integration.
- src/shared/rules.ts: scoring, service order and contact/landing faults.
- src/server/engine.ts: fixed 120 Hz physics, contacts, bots, movement policy.
- src/server/rooms.ts: assignments, per-display pairing tokens with team preference, host team switching, start gates, stale input and reconnect.
- src/server/index.ts: HTTP/SSE server, static delivery and lifecycle loop.

## Priorities

1. Deploy this server at a real trusted HTTPS origin and set PUBLIC_ORIGIN (`npm run tunnel` is the no-account dev path). Do not generate localhost pairing QR codes or claim local loopback is remote hosting.
2. Complete docs/DEVICE_TESTS.md on real iPhone Safari and Android Chrome. Tune compact-swing feel using real measurements.
3. Measure wide-area/cellular latency and jitter with real phones (loopback load + four-phone/two-household HTTP tests exist).
4. Remaining rule limits in docs/RULES.md, phone-based movement option (keyboard movement exists), visual/contact effects and audio polish.

## Guardrails

Do not replace real connectivity with simulated multiplayer. Synthetic sensors belong only in tests. Do not claim exact paddle position or real-world velocity. Keep authoritative rules/physics on the server and retain timestamp/sequence validation. Do not present untested physical-device behavior as tested. Explain assisted serving and other simplifications honestly. Prefer incremental improvements over a full stack rewrite unless measurements justify it.

Current milestone implementations are functional local prototype paths; hardware and public-host acceptance are still pending. Use docs/STATUS.md as the truthful handoff, and update it with actual results after each meaningful change.
