# Handoff status — 2026-11-17

## Implemented

- Real HTTP pairing/join with QR/manual room code, separate host/display/controller sessions, expiring pairing, reconnect tokens, and abandoned-room cleanup.
- Phone permission UI, neutral orientation, two-swing calibration, live diagnostics, sensitivity, left-hand/screen orientation handling, and background/disconnect pause.
- Original restrained sports UI, 3D WebGL court, low-poly avatars, paddle orientation mirror, interpolated state, opt-in contact sound.
- Practice feeds and swing-dependent contact; fixed-step authoritative physics and scoring.
- Mode paths for singles vs bot, human singles, co-op doubles, and four-human doubles with start gates and automatic team assignment.
- Strict TypeScript, build script, lockfile, Docker recipe, CI workflow, setup/deployment/device-check docs.

## Actual verification

- `npm run check`: **PASS** — strict typecheck, production build, **21 tests**.
- `npm run test:browser`: **PASS** on installed desktop Chrome, through real Node HTTP/SSE connections.
- Browser test: synthetic orientation/motion → neutral calibration → gentle/stronger calibration → ready → practice → two contacts. Captured shot strengths **37% and 65%**, with different server-authoritative velocities.
- QR generated locally and decoded by Chrome BarcodeDetector to the exact expected HTTPS URL.
- Desktop rendering and mobile-sized controller layout inspected. No page errors in the successful smoke test.
- Bot-v-bot simulation verifies multiple return contacts and bounded movement.
- HTTP integration covers two-controller singles, spectator read-only authority, state streaming, and reconnecting to the same slot.
- All four match roster configurations tested in room/engine tests. Four _physical_ controllers and cross-household network play remain untested.

## Not verified / incomplete

1. No real public HTTPS deployment or tunnel. The local preview is not phone-accessible by QR. This is the first next step.
2. No actual iPhone Safari or Android Chrome sensor tests. The user's physical-device success criterion is **not yet certified**.
3. No wide-area latency/jitter/load benchmark. HTTP POST + SSE may warrant WebSocket transport after measurement.
4. Rules include assists and exclusions documented in RULES.md. In particular, kitchen entry, full momentum lifecycle, body/support collisions, and tournament edge cases are incomplete.
5. Bot tactical variety, avatar detail, and visual contact effects need more polish. The current bot mainly drives with variable placement.
6. Rooms are memory-only; a server restart drops matches. No shared persistence or horizontal scaling.
7. Docker and GitHub Actions recipes have not been executed here. Local equivalent checks passed.
8. E2E test uses a fixed local port and synthetic sensor events; it is not a substitute for hardware tests. Additional four-controller HTTP/browser scenarios would improve coverage.

## Environment notes

The original workspace had no Node/npm on PATH and no Git CLI developer tools. A bundled Node 24 runtime was used, with npm obtained from the official registry into a temporary workspace folder. The repository itself uses standard npm commands and has no dependency on those machine-specific paths. Development dependencies were installed from npm; no runtime package download is needed to play.

Do not commit `node_modules`, `dist`, `.env`, temporary tool downloads, browser profiles, or test session credentials. The original local preview process may be stale; restart after pulling changes.
