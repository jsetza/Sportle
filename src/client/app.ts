import { Connection } from "./net.ts";
import { MotionFilter, wrap } from "../shared/motion.ts";
import { slots } from "../shared/types.ts";
import type { Match, Input } from "../shared/types.ts";
import { Scene } from "./scene.ts";
import { drawQR } from "./qr.ts";
const app = document.querySelector<HTMLDivElement>("#app")!;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const net = new Connection();
let current: Match | null = null;
function error(e: unknown) {
  $("error").textContent = e instanceof Error ? e.message : String(e);
}
function action(id: string, fn: () => unknown) {
  $(id).onclick = () => {
    $("error").textContent = "";
    Promise.resolve().then(fn).catch(error);
  };
}
const params = new URLSearchParams(location.search),
  hash = new URLSearchParams(location.hash.slice(1));
if (location.pathname === "/controller") phone();
else display();
function display() {
  app.innerHTML = `<header><div class="logo">visual<i>°</i></div><div class="tag">Less setup. More rally.</div><span class="pill"><span class="dot"></span> Motion-powered pickleball</span></header><main><div class="hero"><div><div class="eyebrow">A new way to play together</div><h1>Your phone.<br><em>Your paddle.</em></h1></div><p>A little movement. A great rally.<br>Connect your phone, find your angle, and step onto the court.</p></div><div class="layout"><section class="court" aria-label="3D pickleball court"><canvas id="court"></canvas><div class="court-top"><span class="court-label" id="courtLabel">COURT 01 / OPEN PLAY</span><div class="score" id="score">0 : 0</div></div><div class="court-bottom"><div class="message" id="message">Start with a practice ball. Find your feel.</div><button class="small secondary" id="sound">Sound off</button></div></section><aside class="card"><div id="setup"><div class="eyebrow">Make it your court</div><h2>Let’s play.</h2><p>Choose your rally.</p><div id="modes">${[
    ["practice", "Motion lab", "1 phone · calibration & practice"],
    ["solo", "You vs. Orbit", "1 phone · singles against a bot"],
    ["singles", "Head to head", "2 phones · online singles"],
    ["coop", "Better together", "2 phones · doubles against bots"],
    ["doubles", "The full court", "4 phones · online doubles"],
  ]
    .map(
      ([v, n, d], i) =>
        `<div class="mode"><input type="radio" name="mode" id="m-${v}" value="${v}" ${i === 0 ? "checked" : ""}><label for="m-${v}">${n}<span>${d}</span></label></div>`,
    )
    .join(
      "",
    )}</div><label for="difficulty">Bot level</label><select id="difficulty"><option value="easy">Easy · find your rhythm</option><option value="medium">Medium · keep moving</option><option value="hard">Hard · find the corners</option></select><button class="full" id="create">Create game ↗</button><p class="fine">No app. Just your phone and a little space.</p><details><summary class="fine">Join another household’s display</summary><label for="displayCode">Room code</label><input id="displayCode" maxlength="6" placeholder="ABC123"><button class="secondary full" id="joinDisplay">Join display</button></details></div><div id="lobby" class="hidden"><div class="eyebrow" id="connection">Connecting</div><h2>Your court is ready.</h2><div id="pairing"><canvas id="qr" class="qr"></canvas><div class="roomcode" id="roomcode"></div><p class="fine" id="pairHint">Scan with your camera. Keep this display open.</p><div id="teamPick" class="hidden"><label for="pairTeam">Phones paired on this screen join</label><select id="pairTeam"><option value="">Any open team</option><option value="0">Team 1 (blue)</option><option value="1">Team 2 (orange)</option></select></div><button class="small secondary" id="refreshPair">Refresh pairing link</button></div><div id="players"></div><div class="telemetry" id="telemetry"></div><button id="start" class="full">Start practice</button><div class="row"><button id="pause" class="secondary full">Pause</button><button id="resume" class="secondary full">Resume</button></div><p class="fine">Characters move for you. Use compact swings to control timing, angle, and power. Serves are assisted.</p><button id="new" class="small secondary">New court</button></div><div id="error" role="alert"></div></aside></div><div class="steps"><div class="step"><b>01</b><div><h3>Scan & connect</h3><p>One screen. A phone for each player.</p></div></div><div class="step"><b>02</b><div><h3>Find your angle</h3><p>Enable motion and set your neutral position.</p></div></div><div class="step"><b>03</b><div><h3>Make a little magic</h3><p>A gentle swing is all it takes to start.</p></div></div></div><footer><span>VISUAL / EXPERIMENTAL SPORTS CLUB</span><span>COMPACT SWINGS. BIG RALLIES.</span></footer></main>`;
  let scene: Scene;
  try {
    scene = new Scene($<HTMLCanvasElement>("court"));
  } catch (e) {
    error(e);
    return;
  }
  action("sound", () => {
    $("sound").textContent = scene.sound() ? "Sound on" : "Sound off";
  });
  let host = false,
    pair = "",
    publicOrigin: string | null = null,
    pairExpires = 0;
  function pairing() {
    $("roomcode").textContent = net.room;
    const qr = $<HTMLCanvasElement>("qr");
    qr.classList.add("hidden");
    // Every display (host or another household) shows its own pairing QR.
    $("pairing").classList.toggle("hidden", !pair);
    if (!pair) return;
    if (publicOrigin) {
      const url =
        publicOrigin + "/controller?room=" + net.room + "#pair=" + pair;
      try {
        drawQR(qr, url);
        qr.classList.remove("hidden");
        $("pairHint").textContent =
          "Scan to pair. Manual code: " +
          net.room +
          ". Pairing expires in 10 minutes.";
      } catch (e) {
        $("pairHint").textContent = String(e);
      }
    } else {
      $("pairHint").textContent =
        "Phone pairing needs HTTPS. Deploy this server and set PUBLIC_ORIGIN to its public HTTPS origin. Localhost is only a desktop preview.";
      $("pairHint").classList.add("notice");
    }
  }
  function entered() {
    $("setup").classList.add("hidden");
    $("lobby").classList.remove("hidden");
    $("start").classList.toggle("hidden", !host);
    $("resume").classList.toggle("hidden", !host);
    $("pause").classList.toggle("hidden", !host);
    pairing();
    net.clock().catch(error);
    net.stream();
  }
  net.onStatus = (s) => {
    $("connection").textContent = s + " · " + net.room;
  };
  net.onState = ({ state }: { state: Match }) => {
    current = state;
    scene.update(state);
    $("score").textContent = state.score.join(" : ");
    $("message").textContent =
      (state.paused ? "PAUSED · " : "") + state.message;
    $("courtLabel").textContent =
      state.mode === "practice"
        ? "MOTION LAB / LIVE PADDLE"
        : state.mode.toUpperCase() + " / " + state.phase.toUpperCase();
    const choice = state.mode === "singles" || state.mode === "doubles";
    $("teamPick").classList.toggle(
      "hidden",
      !choice || state.phase !== "lobby",
    );
    $("players").innerHTML = Array.from(
      { length: slots(state.mode) },
      (_, i) => {
        const p = state.players.filter((p) => !p.bot)[i];
        const swap =
          p && host && choice && state.phase === "lobby"
            ? `<button class="small secondary" data-team="${p.id}:${1 - p.team}">→ Team ${2 - p.team}</button>`
            : "";
        return `<div class="player team${p ? p.team : ""}"><span>${p ? escape(p.name) : "Waiting for player " + (i + 1)}<br><small>${p ? "Team " + (p.team + 1) + " · " + p.hand + " handed" : "Scan to claim this slot"}</small></span>${swap}<span class="status">${p ? (p.connected ? (p.ready ? "Ready ✓" : "Calibrate") : "Offline") : "○"}</span></div>`;
      },
    ).join("");
    const p = state.players.find((p) => !p.bot);
    $("telemetry").innerHTML = p
      ? `<span>Sensors<strong>${p.input.sensors ? "Live" : "Waiting"}</strong></span><span>Swing intent<strong>${Math.round(p.input.strength * 100)}%</strong></span><span>Pitch / roll<strong>${Math.round(p.input.pitch)}° / ${Math.round(p.input.roll)}°</strong></span><span>Direction<strong>${p.input.strength < 0.1 ? "Neutral" : p.input.direction > 0.25 ? "Upward" : p.input.direction < -0.25 ? "Downward" : "Across"}</strong></span>`
      : "";
    const humans = state.players.filter((p) => !p.bot);
    const perTeam = state.mode === "doubles" ? 2 : 1;
    const uneven =
      choice &&
      humans.length === slots(state.mode) &&
      humans.filter((p) => p.team === 0).length !== perTeam;
    $<HTMLButtonElement>("start").disabled =
      uneven ||
      humans.length !== slots(state.mode) ||
      humans.some((p) => !p.connected || !p.ready) ||
      state.phase !== "lobby";
    $("start").textContent =
      state.mode === "practice" ? "Start practice" : "Start match";
  };
  action("create", async () => {
    const mode = document.querySelector<HTMLInputElement>(
      "input[name=mode]:checked",
    )!.value;
    const r = await net.api("create", {
      mode,
      difficulty: $<HTMLSelectElement>("difficulty").value,
    });
    net.room = r.code;
    net.credential = r.credential;
    pair = r.pair;
    pairExpires = r.pairExpires;
    publicOrigin = r.publicOrigin;
    host = true;
    sessionStorage.setItem(
      "visual-host",
      JSON.stringify({
        room: net.room,
        credential: net.credential,
        pair,
        pairExpires,
        publicOrigin,
      }),
    );
    entered();
  });
  action("joinDisplay", async () => {
    net.room = $<HTMLInputElement>("displayCode").value.trim().toUpperCase();
    const r = await net.api("join", { role: "display" });
    net.credential = r.credential;
    pair = r.pair;
    pairExpires = r.pairExpires;
    publicOrigin = r.publicOrigin;
    host = false;
    entered();
  });
  $("players").addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-team]");
    if (!t) return;
    const [playerId, team] = t.dataset.team!.split(":");
    net.api("team", { playerId, team: Number(team) }).catch(error);
  });
  $("pairTeam").addEventListener("change", () => $("refreshPair").click());
  action("refreshPair", async () => {
    const team = $<HTMLSelectElement>("pairTeam").value;
    const r = await net.api("pair", {
      team: team === "" ? null : Number(team),
    });
    pair = r.pair;
    pairExpires = r.pairExpires;
    if (host)
      sessionStorage.setItem(
        "visual-host",
        JSON.stringify({
          room: net.room,
          credential: net.credential,
          pair,
          pairExpires,
          publicOrigin,
        }),
      );
    pairing();
  });
  action("start", () => net.api("start", {}));
  action("pause", () => net.api("pause", {}));
  action("resume", () => net.api("resume", {}));
  action("new", () => {
    sessionStorage.removeItem("visual-host");
    location.reload();
  });
  const saved = sessionStorage.getItem("visual-host");
  if (saved) {
    try {
      const s = JSON.parse(saved);
      net.room = s.room;
      net.credential = s.credential;
      pair = s.pair;
      pairExpires = s.pairExpires;
      publicOrigin = s.publicOrigin;
      host = true;
      entered();
    } catch {
      sessionStorage.removeItem("visual-host");
    }
  }
}
function phone() {
  app.innerHTML = `<div class="phone"><div class="row"><div class="logo">visual<i>°</i></div><span class="pill" id="connection">Not connected</span></div><h1>A paddle.<br>In your pocket.</h1><p>Hold your phone securely. Small, comfortable swings work best.</p><div id="join" class="card"><div class="number">01 / CLAIM YOUR SPOT</div><label for="code">Room code</label><input id="code" maxlength="6" autocomplete="off" placeholder="ABC123"><label for="nickname">Your nickname</label><input id="nickname" maxlength="20" placeholder="Player"><label for="hand">Paddle hand</label><select id="hand"><option value="right">Right hand</option><option value="left">Left hand</option></select><button class="full" id="connect">Connect to court</button></div><div id="controls" class="hidden"><div class="card"><div class="number" id="stage">02 / ENABLE MOTION</div><h2 id="instruction">Let’s find your feel.</h2><p id="guidance">Allow motion sensors, then hold your phone in a comfortable neutral paddle position.</p><button class="full" id="enable">Enable motion controls</button><button class="full secondary" id="calibrate" disabled>Set neutral position</button><div class="controller-graphic" id="paddle"></div><div class="meter"><div id="strength"></div></div><p class="fine" id="swingHint">Gentle motion. No full-force swings needed.</p><label for="sensitivity">Comfortable sensitivity</label><input id="sensitivity" type="range" min="0.5" max="2" step="0.1" value="1"><div class="telemetry"><span>Sensor availability<strong id="sensorStatus">Not enabled</strong></span><span>Connection RTT<strong id="latency">—</strong></span><span>Pitch / roll<strong id="angles">—</strong></span><span>Swing direction<strong id="direction">Neutral</strong></span></div><button class="full" id="ready" disabled>Ready to play</button><div class="row"><button class="full secondary" id="phonePause">Pause</button><button class="full secondary" id="reconnect">Reconnect</button></div><p class="fine" id="matchStatus">Your display will start the game.</p></div></div><div id="error" role="alert"></div><p class="screen-note">Keep this page visible during play.<br>Sensor motion estimates intent, not physical position.</p></div>`;
  $<HTMLInputElement>("code").value = params.get("room") || "";
  const filter = new MotionFilter();
  let orientationAt = 0,
    motionAt = 0,
    seq = 0,
    pendingSwing = false,
    enabled = false,
    playerId = "",
    ready = false,
    inflight = false,
    calibrationStep = 0,
    gentle = 0,
    peak = 0,
    lastOrientation = screen.orientation?.angle || 0;
  let swingDue = 0,
    swingPeak = 0,
    swingDirection = 0;
  let enabledAt = 0;
  let wake: any = null;
  const screenAngle = () =>
    screen.orientation?.angle ?? Number((window as any).orientation || 0);
  function orientation(e: DeviceOrientationEvent) {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    orientationAt = performance.now();
    const angle = screenAngle();
    if (angle !== lastOrientation) {
      lastOrientation = angle;
      filter.calibrated = false;
      calibrationStep = 0;
      ready = false;
      net.api("ready", { ready: false }).catch(() => {});
      $("guidance").textContent =
        "Screen rotated. Hold neutral and recalibrate.";
    }
    filter.orientation(e.alpha, e.beta, e.gamma, angle);
  }
  function motion(e: DeviceMotionEvent) {
    const a = e.acceleration,
      r = e.rotationRate;
    if (!r || r.alpha === null || r.beta === null || r.gamma === null) return;
    motionAt = performance.now();
    const swing = filter.motion(
      { x: a?.x || 0, y: a?.y || 0, z: a?.z || 0 },
      { alpha: r.alpha, beta: r.beta, gamma: r.gamma },
      screenAngle(),
      motionAt,
    );
    peak = Math.max(peak, filter.strength);
    if (swing) {
      pendingSwing = true;
      swingDue = motionAt + 65;
      swingPeak = filter.strength;
      swingDirection = filter.direction;
    }
    if (pendingSwing) {
      swingPeak = Math.max(swingPeak, filter.strength);
      if (Math.abs(filter.direction) > Math.abs(swingDirection))
        swingDirection = filter.direction;
    }
  }
  const sensorLive = () =>
    enabled &&
    performance.now() - orientationAt < 1200 &&
    performance.now() - motionAt < 1200;
  async function claim(reconnect = false) {
    net.room = $<HTMLInputElement>("code").value.trim().toUpperCase();
    if (!/^[A-F0-9]{6}$/.test(net.room))
      throw Error("Enter the six-character room code shown on your display.");
    const saved = localStorage.getItem("visual-controller-" + net.room);
    const r = await net.api("join", {
      name: $<HTMLInputElement>("nickname").value,
      hand: $<HTMLSelectElement>("hand").value,
      pair: hash.get("pair") || undefined,
      credential: saved || undefined,
    });
    net.credential = r.credential;
    playerId = r.player.id;
    seq = r.seq + 1;
    filter.hand = r.player.hand === "left" ? -1 : 1;
    localStorage.setItem("visual-controller-" + net.room, net.credential);
    $("join").classList.add("hidden");
    $("controls").classList.remove("hidden");
    await net.clock();
    net.stream();
    if (reconnect) {
      filter.calibrated = false;
      calibrationStep = 0;
      ready = false;
      $("guidance").textContent = "Reconnected. Recalibrate and tap Ready.";
    }
  }
  action("connect", () => claim());
  action("reconnect", () => claim(true));
  // Permission calls must occur directly in the click gesture, before network or other awaits.
  $("enable").onclick = async () => {
    try {
      if (!window.isSecureContext)
        throw Error(
          "Motion controls require HTTPS. Open the public pairing URL from your display.",
        );
      const D = DeviceMotionEvent as any,
        O = DeviceOrientationEvent as any;
      const requests = [];
      if (typeof D.requestPermission === "function")
        requests.push(D.requestPermission());
      if (typeof O.requestPermission === "function")
        requests.push(O.requestPermission());
      const results = await Promise.all(requests);
      if (results.some((v) => v !== "granted"))
        throw Error(
          "Motion permission denied. Allow Motion & Orientation in browser settings, then reload and reconnect.",
        );
      if (!enabled) {
        window.addEventListener("deviceorientation", orientation);
        window.addEventListener("devicemotion", motion);
      }
      enabled = true;
      enabledAt = performance.now();
      $("error").textContent = "";
      $("sensorStatus").textContent = "Waiting for samples";
      if ("wakeLock" in navigator)
        try {
          wake = await (navigator as any).wakeLock.request("screen");
        } catch {}
    } catch (e) {
      error(e);
    }
  };
  action("calibrate", () => {
    if (!sensorLive())
      throw Error("Waiting for live orientation and motion samples");
    filter.calibrate();
    calibrationStep = 1;
    gentle = 0;
    peak = 0;
    ready = false;
    pendingSwing = false;
    net.api("ready", { ready: false }).catch(() => {});
    $("instruction").textContent = "Try a gentle swing.";
    $("guidance").textContent =
      "Neutral set. Make one small, gentle swing, then a slightly quicker one.";
  });
  action("ready", async () => {
    await net.api("ready", { ready: !ready });
    ready = !ready;
  });
  action("phonePause", () => net.api("pause", {}));
  $<HTMLInputElement>("sensitivity").oninput = () => {
    filter.sensitivity = Number($<HTMLInputElement>("sensitivity").value);
  };
  net.onStatus = (s) => {
    $("connection").textContent = s;
  };
  net.onState = ({ state }: { state: Match }) => {
    current = state;
    const p = state.players.find((p) => p.id === playerId);
    ready = p?.ready || false;
    $("ready").textContent = ready
      ? "Ready ✓ · tap to unready"
      : "Ready to play";
    $("matchStatus").textContent =
      (state.paused ? "Paused · " : "") + state.message;
  };
  setInterval(() => {
    const live = sensorLive();
    $<HTMLButtonElement>("calibrate").disabled = !live;
    $<HTMLButtonElement>("ready").disabled = !live || calibrationStep !== 3;
    $("sensorStatus").textContent = live
      ? "Live"
      : enabled
        ? "No live samples"
        : "Not enabled";
    $("latency").textContent = net.credential ? net.latency + " ms" : "—";
    $("angles").textContent =
      Math.round(filter.angle.pitch) +
      "° / " +
      Math.round(filter.angle.roll) +
      "°";
    $("direction").textContent =
      filter.strength < 0.1
        ? "Neutral"
        : filter.direction > 0.25
          ? "Upward"
          : filter.direction < -0.25
            ? "Downward"
            : "Across";
    $("strength").style.width = Math.round(filter.strength * 100) + "%";
    $("paddle").style.transform =
      `perspective(400px) rotateX(${filter.angle.pitch}deg) rotateZ(${-filter.angle.roll}deg)`;
    if (enabled && !live && performance.now() - enabledAt > 5000)
      $("error").textContent =
        "No live sensor data. Check browser motion permissions. If your device has no supported sensors, use another phone.";
  }, 100);
  setInterval(async () => {
    if (!net.credential || inflight || document.hidden) return;
    inflight = true;
    const swing = pendingSwing && performance.now() >= swingDue;
    if (swing) {
      pendingSwing = false;
      if (calibrationStep === 1 && swingPeak > 0.82) {
        $("guidance").textContent =
          "Try a gentler compact swing first, or reduce sensitivity.";
      } else if (calibrationStep === 1) {
        gentle = swingPeak;
        calibrationStep = 2;
        $("guidance").textContent =
          "Good. Now try a slightly quicker compact swing.";
      } else if (calibrationStep === 2 && swingPeak > gentle + 0.06) {
        calibrationStep = 3;
        $("guidance").textContent =
          "You’re calibrated. Adjust sensitivity if needed, then tap Ready.";
        $("stage").textContent = "03 / READY TO RALLY";
      }
      $("swingHint").textContent =
        "Swing detected · " + Math.round(swingPeak * 100) + "% intent";
    }
    const live = sensorLive();
    const input: Input = {
      seq: seq++,
      t: Date.now() + net.offset,
      pitch: wrap(filter.angle.pitch),
      roll: wrap(filter.angle.roll * filter.hand),
      yaw: wrap(filter.angle.yaw * filter.hand),
      strength: swing ? swingPeak : filter.strength,
      direction: swing ? swingDirection : filter.direction,
      swing: swing && live,
      sensors: live,
      calibrated: filter.calibrated && live,
    };
    try {
      await net.api("input", input);
    } catch {
      $("connection").textContent = "Connection lost";
    } finally {
      inflight = false;
    }
  }, 33);
  setInterval(() => {
    if (net.credential) net.clock().catch(() => {});
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pendingSwing = false;
      filter.calibrated = false;
      calibrationStep = 0;
      ready = false;
      net.api("background", {}).catch(() => {});
      wake?.release();
    } else if (net.credential) {
      $("guidance").textContent =
        "Welcome back. Recalibrate and ready before the host resumes.";
      net.clock().catch(() => {});
    }
  });
}
