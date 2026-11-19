import { Connection } from "./net.ts";
import { MotionFilter, learnAxes, wrap } from "../shared/motion.ts";
import type { TestSwings, Vec3 } from "../shared/motion.ts";
import {
  slots,
  MAPS,
  OUTFITS,
  PADDLES,
  SHOES,
  EYEWEAR,
  cleanGear,
} from "../shared/types.ts";
import type { Match, Input, MapId } from "../shared/types.ts";
import { Scene, VIEW_LABELS } from "./scene.ts";
import type { ViewMode } from "./scene.ts";
import { drawQR } from "./qr.ts";
import { Music } from "./music.ts";
const app = document.querySelector<HTMLDivElement>("#app")!;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
/**
 * Snapshots arrive ~30×/s. Rewriting unchanged DOM that often forces needless layout and
 * repaints (expensive over the frosted-glass panels), so only write when the value changed.
 */
const lastWrite = new Map<string, string>();
const ui = (id: string) => ({
  set html(v: string) {
    if (lastWrite.get("h:" + id) === v) return;
    lastWrite.set("h:" + id, v);
    $(id).innerHTML = v;
  },
  set text(v: string) {
    if (lastWrite.get("t:" + id) === v) return;
    lastWrite.set("t:" + id, v);
    $(id).textContent = v;
  },
});
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
  const item = (
    group: string,
    mode: string,
    name: string,
    hint: string,
    checked = false,
  ) =>
    `<input type="radio" name="mode" id="m-${group}-${mode}" value="${mode}" data-group="${group}" ${checked ? "checked" : ""}><label class="item" for="m-${group}-${mode}"><span class="ball"></span><b>${name}</b><small>${hint}</small></label>`;
  app.innerHTML = `<canvas id="court" aria-label="3D pickleball arena"></canvas><div class="beams" aria-hidden="true"></div>
<header class="topbar"><span id="joinAt">Phones join at this screen’s link</span><nav><button class="link" id="music">Music on</button><button class="link" id="view" title="Change camera (V)">View: Third person</button><button class="link" id="howtoOpen">How to play</button><button class="link" id="sound">Sound off</button><button class="link" id="fullscreen">Fullscreen</button></nav></header>
<aside class="panel" id="panel">
  <div class="wordmark" aria-label="POVpickle"><span><b>POV</b>PICKLE</span><i></i></div>
  <p class="tagline">Pickleball. <b>Your phone is the paddle.</b></p>
  <div id="setup">
    <div class="step" id="stepIntro">
      <button class="play" id="play"><span class="playicon" aria-hidden="true"></span>Play</button>
      <p class="fine">Pick a mode, scan the QR code with your phone, swing.</p>
    </div>
    <div class="step hidden" id="stepWhere">
      <button class="link back" data-back="stepIntro">← Back</button>
      <h2 class="stephead">How are you playing?</h2>
      <button class="choice" id="goOffline"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg><span><b>Offline</b><small>Everyone on this screen · phones as paddles</small></span><i>→</i></button>
      <button class="choice" id="goOnline"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg><span><b>Online</b><small>Play people in other homes · share a code</small></span><i>→</i></button>
    </div>
    <div class="step hidden" id="stepModes">
      <button class="link back" data-back="stepWhere">← Offline / Online</button>
      <h2 class="stephead" id="modesHead">Offline</h2>
      <div class="list" data-group="here">
      ${item("here", "practice", "Motion lab", "Calibrate · practice", true)}
      ${item("here", "solo", "Solo", "vs the computer")}
      ${item("here", "singles", "Two players", "1 v 1 · 2 phones")}
      ${item("here", "coop", "Team up", "2 phones vs 2 bots")}
      ${item("here", "doubles", "Doubles", "2 v 2 · 4 phones")}
      </div>
      <div class="list" data-group="online">
      ${item("online", "singles", "Play a friend", "1 v 1 · share the code")}
      ${item("online", "doubles", "Online 2 v 2", "2 phones each side")}
      ${item("online", "ranked1", "Ranked 1 v 1", "Find an opponent · RR")}
      ${item("online", "ranked2", "Ranked 2 v 2", "Solo or with a friend · RR")}
      <details id="joinBox"><summary class="item"><span class="ball"></span><b>Join a game</b><small>Enter a code</small></summary><div class="joinrow"><input id="displayCode" maxlength="6" placeholder="ROOM CODE" autocomplete="off" aria-label="Room code"><button id="joinDisplay">Join</button></div></details>
      </div>
      <div class="difficulty mappick" role="radiogroup" aria-label="Map"><span>Map</span>${MAPS.map((m) => `<input type="radio" name="map" id="map-${m.id}" value="${m.id}"><label for="map-${m.id}">${m.short}</label>`).join("")}</div>
      <p class="fine" id="mapHint"></p>
    <div class="difficulty" id="difficultyRow" role="radiogroup" aria-label="Difficulty"><span>Difficulty</span>${["easy", "medium", "hard"].map((d, i) => `<input type="radio" name="difficulty" id="d-${d}" value="${d}" ${i === 0 ? "checked" : ""}><label for="d-${d}">${d[0].toUpperCase() + d.slice(1)}</label>`).join("")}</div>
      <p class="fine" id="difficultyHint"></p>
      <button class="cta" id="create">Create game <span>→</span></button>
      <p class="fine" id="modeNote">No app to install. Scan, calibrate, swing.</p>
    </div>
  </div>
  <div id="lobby" class="hidden">
    <div class="eyebrow" id="connection">Connecting</div>
    <div id="pairing" class="pairing"><div class="qrtile"><canvas id="qr" class="qr"></canvas></div><div><small>Room code</small><div class="roomcode" id="roomcode"></div><p class="fine" id="pairHint">Scan with your phone camera.</p><div id="teamPick" class="hidden"><label for="pairTeam">Phones paired here join</label><select id="pairTeam"><option value="">Any open team</option><option value="0">Team blue</option><option value="1">Team red</option></select></div><button class="link" id="refreshPair">Refresh pairing link</button></div></div>
    <div class="difficulty viewpick" role="radiogroup" aria-label="Camera"><span>Camera · <kbd>V</kbd></span>${(["third", "first", "broadcast"] as const).map((v) => `<input type="radio" name="view" id="v-${v}" value="${v}"><label for="v-${v}">${{ third: "3rd person", first: "1st person", broadcast: "Broadcast" }[v]}</label>`).join("")}</div>
    <div id="players"></div>
    <div id="rankedBox" class="ranked hidden"><div class="rkstatus" id="rkStatus"></div><p class="fine" id="rkLast"></p><button class="cta" id="rkFind">Find match <span>→</span></button><button class="ghost hidden" id="rkCancel">Cancel search</button><h3>Leaderboard</h3><ol class="board" id="rkBoard"><li class="fine">No ranked games yet.</li></ol></div>
    <div class="telemetry" id="telemetry"></div>
    <button id="start" class="cta">Start practice <span>→</span></button>
    <div class="row"><button id="pause" class="ghost">Pause</button><button id="resume" class="ghost">Resume</button></div>
    <p class="fine">Move with <kbd>WASD</kbd> (player 1) and the <kbd>arrow keys</kbd> (player 2), or let characters position themselves. Compact phone swings control timing, angle and power. When it’s your serve, pick Drive, Roll or Slice on your phone and swing to serve.</p>
    <button id="new" class="link">← Leave court</button>
  </div>
  <div id="error" role="alert"></div>
</aside>
<button class="paneltab" id="panelToggle" aria-controls="panel">Room</button>
<div class="hud"><span class="courtlabel" id="courtLabel">POVPICKLE ARENA</span><div class="score" id="score">0 : 0</div></div>
<div class="message" id="message" aria-live="polite">Pick a mode to start.</div>
<div class="keys" id="keys" aria-live="polite"></div>
<div class="callout hidden" id="callout" aria-live="assertive"><b>POP-UP!</b><span>Swing down to smash</span></div>
<div class="gameover hidden" id="gameover" role="dialog" aria-labelledby="goTitle"><small id="goMode">MATCH</small><h2 id="goTitle">Blue wins</h2><div class="goscore" id="goScore">11 : 7</div><p id="goNames"></p><button class="cta" id="again">Play again <span>↻</span></button><button class="link" id="goMenu">Change mode</button><p class="fine" id="goWait"></p></div>
<dialog id="howto"><h2>How to play</h2><ol><li><b>Press Play</b>, pick <b>Offline</b> (everyone on this screen) or <b>Online</b> (other homes), then a mode, a map and a difficulty, and <b>Create game</b>. A QR code and room code appear.</li><li><b>Scan the QR</b> with your phone camera, choose your nickname, hand, outfit and gear (paddle, shoes, eyewear).</li><li><b>Enable motion</b> and take the <b>movement test</b>: swing right, left, up and down when asked. Your phone learns your swings and remembers them. Then tap Ready.</li><li><b>Move with the keyboard</b> on this screen: <kbd>W A S D</kbd> moves player 1, the <kbd>arrow keys</kbd> move player 2. Until you press a key, your character positions itself. Stay out of the kitchen when volleying!</li><li><b>Time compact swings</b> as the ball reaches you: tilt to aim, swing up for topspin, open the face and lift for a lob, swing down on a high ball to smash, swing softly to dink.</li><li><b>Serve:</b> when it’s your serve, pick <b>Drive</b>, <b>Roll</b> (topspin that dips and kicks) or <b>Slice</b> (curves back in) on your phone, then swing. A harder swing serves deeper and faster; swing left or right to steer.</li></ol><p class="fine">If a phone drops out (locked screen, app switch, weak signal), the game pauses and carries on by itself a few seconds after it's back. Your feet and the low underhand contact are placed for you when serving. Phone sensors estimate swing intent, not exact paddle position.</p><button class="cta" id="howtoClose">Got it</button></dialog>`;
  const modeNotes: Record<string, string> = {
    "here-practice": "Practice feeds and a live paddle mirror. Start here.",
    "here-solo": "One phone. Choose the bot level below.",
    "here-singles": "Two phones on this screen, one per side.",
    "here-coop": "Two phones together against two bots.",
    "here-doubles": "Four phones, two per team.",
    "online-singles":
      "Create, then your friend opens this site and joins with the code on their screen.",
    "online-doubles":
      "Each household opens its own screen with the code and pairs its own two phones.",
  };
  modeNotes["online-ranked1"] =
    "Pair your phone, then Find match: you're paired with someone near your rating, on their own screen.";
  modeNotes["online-ranked2"] =
    "Bring a friend on this screen, or queue alone and get a teammate. Each side plays on its own screen.";
  const syncMode = () => {
    const sel = document.querySelector<HTMLInputElement>(
      "input[name=mode]:checked",
    )!;
    const bots = sel.value === "solo" || sel.value === "coop";
    const ranked = sel.value.startsWith("ranked");
    // Ranked uses the standard (Hard) hitbox for everyone, so no difficulty choice.
    $("difficultyRow").classList.toggle("hidden", ranked);
    $("difficultyHint").classList.toggle("hidden", ranked);
    $("difficultyHint").textContent = bots
      ? "Easy: biggest hitbox (2.3×), gentle bots. Medium: 1.6× hitbox. Hard: normal hitbox, sharp bots."
      : "Easy: biggest hitbox (2.3×). Medium: 1.6×. Hard: normal hitbox.";
    $("modeNote").textContent =
      modeNotes[sel.dataset.group + "-" + sel.value] || "";
    ($("joinBox") as HTMLDetailsElement).open = false;
  };
  document
    .querySelectorAll<HTMLInputElement>("input[name=mode]")
    .forEach((r) => r.addEventListener("change", syncMode));
  syncMode();
  // Start screen steps (owner request): Play → Offline / Online → mode, map, difficulty.
  const step = (id: string) => {
    for (const el of Array.from(document.querySelectorAll(".step")))
      el.classList.toggle("hidden", el.id !== id);
    sessionStorage.setItem("pov-step", id);
    const first = $(id).querySelector<HTMLElement>(
      id === "stepModes" ? "input[name=mode]:checked" : "button:not(.back)",
    );
    first?.focus({ preventScroll: true });
  };
  const where = (group: "here" | "online") => {
    for (const l of Array.from(
      document.querySelectorAll<HTMLElement>(".list[data-group]"),
    ))
      l.classList.toggle("hidden", l.dataset.group !== group);
    $("modesHead").textContent = group === "here" ? "Offline" : "Online";
    const sel = document.querySelector<HTMLInputElement>(
      "input[name=mode]:checked",
    )!;
    if (sel.dataset.group !== group) {
      const first = document.querySelector<HTMLInputElement>(
        `input[name=mode][data-group=${group}]`,
      )!;
      first.checked = true;
      syncMode();
    }
    sessionStorage.setItem("pov-group", group);
    step("stepModes");
  };
  $("play").onclick = () => step("stepWhere");
  $("goOffline").onclick = () => where("here");
  $("goOnline").onclick = () => where("online");
  for (const b of Array.from(
    document.querySelectorAll<HTMLElement>("[data-back]"),
  ))
    b.onclick = () => step(b.dataset.back!);
  // Coming back from a game ("Change mode" / "Leave court") lands on the mode list.
  if (sessionStorage.getItem("pov-step") === "stepModes")
    where(sessionStorage.getItem("pov-group") === "online" ? "online" : "here");
  // Map picker: previews the court behind the menu right away.
  const syncMap = () => {
    const v = (document.querySelector<HTMLInputElement>(
      "input[name=map]:checked",
    )?.value || "arena") as MapId;
    const m = MAPS.find((x) => x.id === v)!;
    $("mapHint").textContent = m.name + " · " + m.note;
    localStorage.setItem("pov-map", v);
    if (!current) scene.setMap(v);
  };
  const savedMap = localStorage.getItem("pov-map");
  (
    document.querySelector<HTMLInputElement>(
      `input[name=map][value="${MAPS.some((m) => m.id === savedMap) ? savedMap : "arena"}"]`,
    ) as HTMLInputElement
  ).checked = true;
  document
    .querySelectorAll<HTMLInputElement>("input[name=map]")
    .forEach((r) => r.addEventListener("change", syncMap));
  document.addEventListener("keydown", (e) => {
    // TV-remote / keyboard friendly menu: arrows move, Enter creates.
    if (
      $("setup").classList.contains("hidden") ||
      ((e.target as HTMLElement).tagName === "INPUT" &&
        (e.target as HTMLInputElement).type !== "radio")
    )
      return;
    if ($("stepModes").classList.contains("hidden")) return;
    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>("input[name=mode]"),
    ).filter((r) => !r.closest(".hidden"));
    const i = radios.findIndex((r) => r.checked);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n =
        radios[
          (i + (e.key === "ArrowDown" ? 1 : radios.length - 1)) % radios.length
        ];
      n.checked = true;
      n.focus();
      syncMode();
    } else if (
      e.key === "Enter" &&
      (e.target as HTMLElement).tagName !== "BUTTON"
    )
      $("create").click();
  });
  fetch("/api/config")
    .then((r) => r.json())
    .then((c) => {
      $("joinAt").textContent = c.publicOrigin
        ? "Phones join at " + new URL(c.publicOrigin).host
        : "Desktop preview · phones need the public HTTPS link";
    })
    .catch(() => {});
  const howto = $<HTMLDialogElement>("howto");
  $("howtoOpen").onclick = () => howto.showModal();
  $("howtoClose").onclick = () => howto.close();
  $("fullscreen").onclick = () =>
    (document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen()
    ).catch(() => {});
  $("panelToggle").onclick = () => {
    document.body.classList.toggle("panel-open");
    scene.panelOpen =
      !document.body.classList.contains("playing") ||
      document.body.classList.contains("panel-open");
  };
  let scene: Scene;
  try {
    scene = new Scene($<HTMLCanvasElement>("court"));
  } catch (e) {
    error(e);
    return;
  }
  syncMap();
  // Sound effects (paddle hits, bounces, calls): on by default, remembered per browser.
  let soundOn = true;
  try {
    soundOn = localStorage.getItem("visual-sound") !== "off";
  } catch {
    /* default on */
  }
  scene.muted = !soundOn;
  $("sound").textContent = soundOn ? "Sound on" : "Sound off";
  action("sound", () => {
    soundOn = scene.sound();
    $("sound").textContent = soundOn ? "Sound on" : "Sound off";
    try {
      localStorage.setItem("visual-sound", soundOn ? "on" : "off");
    } catch {
      /* ignore */
    }
  });
  let host = false,
    displayId = "",
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
    document.body.classList.add("in-room");
    $("start").classList.toggle("hidden", !host);
    $("resume").classList.toggle("hidden", !host);
    $("pause").classList.toggle("hidden", !host);
    pairing();
    net.clock().catch(error);
    net.stream();
  }
  net.onStatus = (s) => {
    ui("connection").text = s + " · " + net.room;
  };
  net.onState = ({ state }: { state: Match }) => {
    // Matchmaking moves this screen into its ranked match (and back home afterwards).
    const mv = state.moves?.[displayId];
    if (mv && mv.code !== net.room) {
      net.room = mv.code;
      if (mv.displayId) displayId = mv.displayId;
      net.kick();
      return;
    }
    current = state;
    scene.update(state);
    rankedUI(state);
    keyHints(state);
    gameOver(state);
    const popup = state.phase === "rally" && state.popup && state.bounces === 0;
    $("callout").classList.toggle("hidden", !popup);
    $("callout").className =
      "callout team" + (1 - state.lastTeam) + (popup ? "" : " hidden");
    const playing = state.phase !== "lobby";
    if (playing !== document.body.classList.contains("playing")) {
      document.body.classList.toggle("playing", playing);
      document.body.classList.remove("panel-open");
    }
    scene.panelOpen =
      !playing || document.body.classList.contains("panel-open");
    ui("score").text = state.score.join(" : ");
    ui("message").text = (state.paused ? "PAUSED · " : "") + state.message;
    ui("courtLabel").text =
      (MAPS.find((x) => x.id === state.map)?.short.toUpperCase() ?? "") +
      " · " +
      (state.ranked ? "RANKED " : "") +
      (state.mode === "practice"
        ? "MOTION LAB · LIVE PADDLE"
        : (
            {
              solo: "SOLO",
              singles: "1 V 1",
              coop: "TEAM UP",
              doubles: "2 V 2",
            } as Record<string, string>
          )[state.mode] +
          " · " +
          (state.phase === "over"
            ? "FINAL"
            : state.paused
              ? "PAUSED"
              : state.phase.toUpperCase()));
    const choice =
      !state.ranked && (state.mode === "singles" || state.mode === "doubles");
    $("teamPick").classList.toggle(
      "hidden",
      !choice || state.phase !== "lobby",
    );
    const seats =
      state.ranked && state.ranked.stage !== "match"
        ? state.ranked.queue === "1v1"
          ? 1
          : 2
        : slots(state.mode);
    ui("players").html = Array.from({ length: seats }, (_, i) => {
      const p = state.players.filter((p) => !p.bot)[i];
      const swap =
        p && host && choice && state.phase === "lobby"
          ? `<button class="swap" data-team="${p.id}:${1 - p.team}">→ ${p.team ? "Blue" : "Red"}</button>`
          : "";
      return `<div class="player team${p ? p.team : ""}"><span>${p ? escape(p.name) : "Waiting for player " + (i + 1)}<br><small>${p ? (state.ranked ? p.rr + " RR" : (p.team ? "Red" : "Blue") + " · " + p.hand + " handed") : state.ranked && i > 0 ? "Optional: a friend on this screen" : "Scan to claim this slot"}</small></span>${swap}<span class="status">${p ? (p.connected ? (p.ready ? "Ready ✓" : "Calibrate") : "Offline") : "○"}</span></div>`;
    }).join("");
    const p = state.players.find((p) => !p.bot);
    ui("telemetry").html = p
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
    ui("start").html =
      (state.mode === "practice" ? "Start practice" : "Start match") +
      " <span>→</span>";
  };
  // ——— Keyboard movement: WASD moves this screen's player 1, arrow keys move player 2 ———
  const KEYMAP: Record<string, [number, number, number]> = {
    KeyW: [0, 0, -1],
    KeyS: [0, 0, 1],
    KeyA: [0, -1, 0],
    KeyD: [0, 1, 0],
    ArrowUp: [1, 0, -1],
    ArrowDown: [1, 0, 1],
    ArrowLeft: [1, -1, 0],
    ArrowRight: [1, 1, 0],
  };
  const held = new Set<string>();
  let moveSeq = 0,
    lastSent = "";
  const localPlayers = (state: Match) =>
    state.players.filter(
      (p) => !p.bot && (p.display === displayId || (host && p.display === "")),
    );
  const sendMove = (force = false) => {
    if (
      !net.credential ||
      !current ||
      current.phase === "lobby" ||
      current.phase === "over"
    )
      return;
    const keys = [0, 1].map((slot) => {
      let x = 0,
        z = 0;
      for (const code of held) {
        const k = KEYMAP[code];
        if (k[0] === slot) {
          x += k[1];
          z += k[2];
        }
      }
      // Keys are camera-relative: when the camera looks from the far side (following a
      // red-team player in a player view), "up" on screen is +z in the world.
      // Keys follow the camera the player is looking through. In split screen each player
      // has their own half; otherwise everyone shares the camera of this screen's player 1.
      const local = current ? localPlayers(current) : [];
      const split = scene.viewMode !== "broadcast" && local.length >= 2;
      const viewer = split ? local[slot] : local[0];
      const flip = scene.viewMode !== "broadcast" && viewer?.team === 1;
      return flip ? { slot, x: -x || 0, z: -z || 0 } : { slot, x, z };
    });
    const sig = JSON.stringify(keys);
    if (!force && sig === lastSent) return;
    lastSent = sig;
    net.api("move", { seq: moveSeq++, keys }).catch(() => {});
  };
  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    return (
      t.tagName === "SELECT" ||
      (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "radio")
    );
  };
  addEventListener("keydown", (e) => {
    if (
      !KEYMAP[e.code] ||
      typing(e) ||
      !document.body.classList.contains("playing")
    )
      return;
    e.preventDefault();
    held.add(e.code);
    sendMove();
  });
  addEventListener("keyup", (e) => {
    if (!KEYMAP[e.code]) return;
    held.delete(e.code);
    sendMove();
  });
  addEventListener("blur", () => {
    held.clear();
    sendMove();
  });
  // While keys are held, refresh so the server keeps honouring them (it expires intent after 350 ms).
  setInterval(() => {
    if (held.size) sendMove(true);
  }, 150);
  // ——— Camera choice: third person (default), first person, broadcast ———
  const VIEWS: ViewMode[] = ["third", "first", "broadcast"];
  let view: ViewMode = "third";
  try {
    const saved = localStorage.getItem("visual-view") as ViewMode | null;
    if (saved && VIEWS.includes(saved)) view = saved;
  } catch {
    /* storage unavailable: default view */
  }
  const setView = (v: ViewMode) => {
    view = v;
    scene.viewMode = v;
    $("view").textContent = "View: " + VIEW_LABELS[v];
    const r = document.getElementById("v-" + v) as HTMLInputElement | null;
    if (r) r.checked = true;
    try {
      localStorage.setItem("visual-view", v);
    } catch {
      /* ignore */
    }
    held.clear();
    sendMove(true);
  };
  $("view").onclick = () => setView(VIEWS[(VIEWS.indexOf(view) + 1) % 3]);
  document
    .querySelectorAll<HTMLInputElement>("input[name=view]")
    .forEach((r) =>
      r.addEventListener("change", () => setView(r.value as ViewMode)),
    );
  addEventListener("keydown", (e) => {
    if (e.code === "KeyV" && !typing(e) && !e.metaKey && !e.ctrlKey)
      setView(VIEWS[(VIEWS.indexOf(view) + 1) % 3]);
  });
  setView(view);
  // ——— Background music: on by default, starts on the first click/key (browser rule) ———
  const music = new Music();
  let musicOn = true;
  try {
    musicOn = localStorage.getItem("visual-music") !== "off";
  } catch {
    /* default on */
  }
  const syncMusic = () => {
    $("music").textContent = musicOn ? "Music on" : "Music off";
    if (musicOn && userActed) music.start();
    else music.stop();
  };
  let userActed = false;
  const firstGesture = () => {
    if (userActed) return;
    userActed = true;
    syncMusic();
    scene.wakeAudio();
  };
  addEventListener("pointerdown", firstGesture);
  addEventListener("keydown", firstGesture);
  $("music").onclick = () => {
    musicOn = !musicOn;
    try {
      localStorage.setItem("visual-music", musicOn ? "on" : "off");
    } catch {
      /* ignore */
    }
    userActed = true;
    syncMusic();
  };
  syncMusic();
  // ——— Game over: result card with Play again (host) ———
  const gameOver = (state: Match) => {
    const over = state.phase === "over" && state.winner !== null;
    $("gameover").classList.toggle("hidden", !over);
    music.intensity =
      state.phase === "rally" ||
      state.phase === "serve" ||
      state.phase === "point"
        ? 1
        : 0;
    if (!over) return;
    const w = state.winner!;
    $("goTitle").textContent = (w ? "Red" : "Blue") + " wins!";
    $("goTitle").className = "team" + w;
    $("goScore").textContent = state.score[w] + " : " + state.score[1 - w];
    $("goNames").textContent = state.players
      .filter((p) => p.team === w)
      .map((p) => p.name)
      .join(" & ");
    $("goMode").textContent =
      (
        {
          solo: "SOLO",
          singles: "1 V 1",
          coop: "TEAM UP",
          doubles: "2 V 2",
          practice: "PRACTICE",
        } as Record<string, string>
      )[state.mode] + " · FINAL";
    if (state.ranked) {
      $("goMode").textContent =
        "RANKED " + state.ranked.queue.toUpperCase() + " · FINAL";
      $("goNames").innerHTML = state.ranked.results
        .map((r) => {
          const d = r.after - r.before;
          return `<span class="team${r.team}">${escape(r.name)} ${r.after} RR <b>${d >= 0 ? "+" : ""}${d}</b></span>`;
        })
        .join("<br>");
      $("again").classList.add("hidden");
      $("goMenu").classList.add("hidden");
      $("goWait").textContent = "Heading back to your lobby…";
      return;
    }
    $("goMenu").classList.remove("hidden");
    $("again").classList.toggle("hidden", !host);
    $("goWait").textContent = host
      ? "Same players, same mode, fresh score."
      : "Waiting for the host to start a rematch…";
  };
  // ——— Ranked lobby: search, status, leaderboard ———
  let boardAt = 0;
  const rankedUI = (state: Match) => {
    const rk = state.ranked;
    const box = !!rk && rk.stage !== "match";
    $("rankedBox").classList.toggle("hidden", !box);
    $("start").classList.toggle("hidden", !!rk);
    $("pairing").classList.toggle("hidden", !!rk && rk.stage !== "lobby");
    if (!rk || !box) return;
    const h = state.players.filter((p) => !p.bot);
    const allSet = h.length > 0 && h.every((p) => p.connected && p.ready);
    const secs = Math.floor((Date.now() - rk.since) / 1000);
    ui("rkStatus").text =
      rk.stage === "searching"
        ? `Searching ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} · players within ±${rk.window} RR`
        : rk.stage === "matched"
          ? "Match found! Heading to the court…"
          : !h.length
            ? "Scan the QR with your phone to join."
            : allSet
              ? "Ready. Find a match when you are."
              : "Finish the movement test on your phone, then tap Ready.";
    const mine = rk.results.filter((r) => h.some((p) => p.name === r.name));
    ui("rkLast").text = mine.length
      ? "Last match: " +
        mine
          .map(
            (r) =>
              `${r.name} ${r.before} → ${r.after} (${r.after >= r.before ? "+" : ""}${r.after - r.before})`,
          )
          .join(" · ")
      : "";
    $("rkFind").classList.toggle("hidden", rk.stage !== "lobby");
    $<HTMLButtonElement>("rkFind").disabled = !allSet;
    $("rkCancel").classList.toggle("hidden", rk.stage !== "searching");
    if (Date.now() - boardAt > 15000) {
      boardAt = Date.now();
      fetch("/api/leaderboard")
        .then((r) => r.json())
        .then(({ top }) => {
          ui("rkBoard").html = top.length
            ? top
                .map(
                  (t: any) =>
                    `<li><span>${escape(t.name)}</span><b>${t.rr}</b><small>${t.wins}–${t.games - t.wins}</small></li>`,
                )
                .join("")
            : '<li class="fine">No ranked games yet.</li>';
        })
        .catch(() => {});
    }
  };
  action("rkFind", () => net.api("ranked/search", {}));
  action("rkCancel", () => net.api("ranked/cancel", {}));
  action("again", () => net.api("rematch", {}));
  $("goMenu").onclick = () => {
    sessionStorage.removeItem("visual-host");
    location.reload();
  };
  const keyHints = (state: Match) => {
    scene.follows = localPlayers(state)
      .slice(0, 2)
      .map((p) => p.id);
    const local = localPlayers(state);
    ui("keys").html = local
      .map((p, slot) => {
        const how =
          p.moveStyle === "phone"
            ? "<kbd>📱 pad</kbd>"
            : p.moveStyle === "auto" || slot > 1
              ? "<kbd>AUTO</kbd>"
              : `<kbd>${slot ? "← ↑ ↓ →" : "W A S D"}</kbd>`;
        const note =
          p.moveStyle === "auto" || slot > 1 || p.manual
            ? ""
            : p.moveStyle === "phone"
              ? " · auto until you use the pad"
              : " · auto until you move";
        return `<span class="team${p.team}">${how}${escape(p.name)}${note}</span>`;
      })
      .join("");
  };
  action("create", async () => {
    const mode = document.querySelector<HTMLInputElement>(
      "input[name=mode]:checked",
    )!.value;
    const ranked = mode.startsWith("ranked")
      ? mode === "ranked1"
        ? "1v1"
        : "2v2"
      : undefined;
    const r = await net.api("create", {
      mode: ranked ? (ranked === "1v1" ? "singles" : "doubles") : mode,
      ranked,
      map:
        document.querySelector<HTMLInputElement>("input[name=map]:checked")
          ?.value || "arena",
      difficulty: document.querySelector<HTMLInputElement>(
        "input[name=difficulty]:checked",
      )!.value,
    });
    net.room = r.code;
    net.credential = r.credential;
    pair = r.pair;
    pairExpires = r.pairExpires;
    publicOrigin = r.publicOrigin;
    host = true;
    displayId = "host";
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
    displayId = r.displayId;
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
      displayId = "host";
      entered();
    } catch {
      sessionStorage.removeItem("visual-host");
    }
  }
}
function phone() {
  app.innerHTML = `<div class="phone"><div class="row"><div class="logo"><b>POV</b>pickle</div><span class="pill" id="connection">Not connected</span></div><h1>A paddle.<br>In your pocket.</h1><p>Hold your phone like a paddle. A quick movement test learns your swings. Small, comfortable swings work best.</p><div id="join" class="card"><div class="number">01 / CLAIM YOUR SPOT</div><label for="code">Room code</label><input id="code" maxlength="6" autocomplete="off" placeholder="ABC123"><label for="nickname">Your nickname</label><input id="nickname" maxlength="20" placeholder="Player"><label for="hand">Paddle hand</label><select id="hand"><option value="right">Right hand</option><option value="left">Left hand</option></select><label for="outfit">Outfit</label><select id="outfit">${OUTFITS.map((o) => `<option value="${o.id}">${o.name}</option>`).join("")}</select><details class="gear" open><summary>Your gear</summary><label for="gearPaddle">Paddle</label><select id="gearPaddle">${PADDLES.map((g, i) => `<option value="${i}">${g.name}</option>`).join("")}</select><label for="gearShoes">Shoes</label><select id="gearShoes">${SHOES.map((g, i) => `<option value="${i}">${g.name}</option>`).join("")}</select><label for="gearEyes">Eyewear</label><select id="gearEyes">${EYEWEAR.map((g, i) => `<option value="${i}">${g}</option>`).join("")}</select></details><button class="full" id="connect">Connect to court</button></div><div id="controls" class="hidden"><div id="setup" class="card"><div class="number" id="stage">02 / MOVEMENT TEST</div><h2 id="instruction">Let’s test your swings.</h2><p id="guidance">Tap Enable, then hold the phone like a paddle. Screen forward or back, either is fine.</p><button class="full" id="enable">Enable motion controls</button><button class="full secondary hidden" id="useSaved">Use my saved swings</button><button class="full secondary" id="calibrate" disabled>Hold still · start the test</button><ol class="checks" id="checks"><li data-k="right"><i>→</i>Swing right<b></b></li><li data-k="left"><i>←</i>Swing left<b></b></li><li data-k="up"><i>↑</i>Swing up<b></b></li><li data-k="down"><i>↓</i>Swing down<b></b></li></ol><div class="controller-graphic" id="paddle"></div><div class="meter"><div id="strength"></div></div><p class="fine" id="swingHint">Small, comfortable swings work best.</p><label for="sensitivity">Comfortable sensitivity</label><input id="sensitivity" type="range" min="0.5" max="2" step="0.1" value="1"><div class="movepick" role="radiogroup" aria-label="How you move"><span>How you move</span><input type="radio" name="ctl" id="ctl-2" value="2" checked><label for="ctl-2">Phone<small>thumb pad</small></label><input type="radio" name="ctl" id="ctl-1" value="1"><label for="ctl-1">Keyboard<small>WASD / arrows</small></label><input type="radio" name="ctl" id="ctl-0" value="0"><label for="ctl-0">Auto<small>moves for you</small></label></div><div class="telemetry"><span>Sensors<strong id="sensorStatus">Not enabled</strong></span><span>Connection RTT<strong id="latency">—</strong></span><span>Pitch / roll<strong id="angles">—</strong></span><span>Live swing<strong id="direction">Neutral</strong></span></div><button class="full" id="ready" disabled>Ready to play</button><button class="link" id="reconnect">Reconnect</button></div><div id="ingame" class="card hidden"><div class="number">YOU’RE IN</div><h2 id="igTitle">Ready ✓</h2><p class="status" id="matchStatus">Your display will start the game.</p><div class="movepick servepick hidden" id="servePick" role="radiogroup" aria-label="Your serve"><span>Your serve</span><input type="radio" name="sv" id="sv-0" value="0" checked><label for="sv-0">Drive<small>straight</small></label><input type="radio" name="sv" id="sv-1" value="1"><label for="sv-1">Roll<small>topspin dip</small></label><input type="radio" name="sv" id="sv-2" value="2"><label for="sv-2">Slice<small>curves back in</small></label></div><div id="pad" class="pad hidden" aria-label="Movement thumb pad"><div class="padring"><div id="knob" class="knob"></div></div></div><button class="full secondary" id="phonePause">Pause</button><button class="link" id="redo">Redo movement test</button></div></div><div id="error" role="alert"></div></div>`;
  // Gripping the phone like a paddle presses on the screen: no text selection, look-up or
  // copy pop-ups anywhere on the controller.
  document.body.classList.add("controller");
  {
    const o = $<HTMLSelectElement>("outfit");
    const saved = localStorage.getItem("pov-outfit");
    if (OUTFITS.some((x) => x.id === saved)) o.value = saved!;
    o.onchange = () => localStorage.setItem("pov-outfit", o.value);
    // Custom gear (owner request): remembered on the phone, sent when joining.
    let g = cleanGear({});
    try {
      g = cleanGear(JSON.parse(localStorage.getItem("pov-gear") || "{}"));
    } catch {
      /* default gear */
    }
    const sel = {
      paddle: $<HTMLSelectElement>("gearPaddle"),
      shoes: $<HTMLSelectElement>("gearShoes"),
      eyes: $<HTMLSelectElement>("gearEyes"),
    };
    for (const k of ["paddle", "shoes", "eyes"] as const) {
      sel[k].value = String(g[k]);
      sel[k].onchange = () => {
        try {
          localStorage.setItem(
            "pov-gear",
            JSON.stringify({
              paddle: Number(sel.paddle.value),
              shoes: Number(sel.shoes.value),
              eyes: Number(sel.eyes.value),
            }),
          );
        } catch {
          /* ignore */
        }
      };
    }
  }
  const savedGear = () => {
    try {
      return cleanGear(JSON.parse(localStorage.getItem("pov-gear") || "{}"));
    } catch {
      return cleanGear({});
    }
  };
  $<HTMLInputElement>("code").value = params.get("room") || "";
  const filter = new MotionFilter();
  let orientationAt = 0,
    motionAt = 0,
    seq = 0,
    pendingSwing = false,
    enabled = false,
    playerId = "",
    ready = false,
    inflight = 0,
    swingId = 0,
    swingRepeats = 0,
    peak = 0,
    lastOrientation = screen.orientation?.angle || 0;
  let swingDue = 0,
    swingPeak = 0,
    swingDirection = 0,
    swingSide = 0;
  let enabledAt = 0;
  // ——— Movement test: four confirmed swings teach this phone's directions ———
  const TESTS = ["right", "left", "up", "down"] as const;
  const PROMPT: Record<(typeof TESTS)[number], string> = {
    right: "Swing to your RIGHT →",
    left: "← Swing to your LEFT",
    up: "Swing UP ↑",
    down: "Swing DOWN ↓",
  };
  let tests: Partial<TestSwings> = {},
    testing = false,
    testsDone = false;
  const nextTest = () => TESTS.find((k) => !tests[k]);
  const showChecks = () =>
    document.querySelectorAll<HTMLElement>("#checks li").forEach((li) => {
      const k = li.dataset.k as keyof TestSwings;
      li.className = tests[k]
        ? "done"
        : testing && nextTest() === k
          ? "now"
          : "";
      li.querySelector("b")!.textContent = tests[k] ? "✓" : "";
    });
  const promptNext = () => {
    const k = nextTest();
    showChecks();
    if (k) {
      $("instruction").textContent = PROMPT[k];
      $("stage").textContent =
        `02 / MOVEMENT TEST · ${TESTS.indexOf(k) + 1} OF 4`;
    }
  };
  const PROFILE = "pov-profile";
  const saveProfile = () => {
    try {
      localStorage.setItem(
        PROFILE,
        JSON.stringify({ axes: filter.axes, sensitivity: filter.sensitivity }),
      );
    } catch {
      /* ignore */
    }
  };
  const savedProfile = () => {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE) || "null");
      return p?.axes?.side?.length === 3 && p?.axes?.up?.length === 3
        ? p
        : null;
    } catch {
      return null;
    }
  };
  const finishTests = (saved = false) => {
    testing = false;
    testsDone = true;
    showChecks();
    document
      .querySelectorAll<HTMLElement>("#checks li b")
      .forEach((b) => (b.textContent = "✓"));
    document
      .querySelectorAll<HTMLElement>("#checks li")
      .forEach((li) => (li.className = "done"));
    $("instruction").textContent = "All four swings confirmed ✓";
    $("guidance").textContent = saved
      ? "Using your saved swings. Tap Ready when you're set."
      : "Your phone learned right, left, up and down. Tap Ready when you're set.";
    $("stage").textContent = "03 / READY TO RALLY";
    saveProfile();
  };
  // Setup vs in-game screens: once Ready, the tester disappears so nothing gets changed.
  const showGame = (on: boolean) => {
    $("setup").classList.toggle("hidden", on);
    $("ingame").classList.toggle("hidden", !on);
  };
  let wake: any = null;
  const screenAngle = () =>
    screen.orientation?.angle ?? Number((window as any).orientation || 0);
  function orientation(e: DeviceOrientationEvent) {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    orientationAt = performance.now();
    const angle = screenAngle();
    if (angle !== lastOrientation) {
      lastOrientation = angle;
      // Screen rotated: re-set the start position on the next sample, keep playing.
      if (filter.calibrated) setTimeout(() => filter.calibrate(), 300);
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
      swingSide = filter.side;
      filter.peakVec = [...filter.rate];
    }
    if (pendingSwing) {
      if (Math.hypot(...filter.rate) > Math.hypot(...filter.peakVec))
        filter.peakVec = [...filter.rate];
      swingPeak = Math.max(swingPeak, filter.strength);
      if (Math.abs(filter.direction) > Math.abs(swingDirection))
        swingDirection = filter.direction;
      if (Math.abs(filter.side) > Math.abs(swingSide)) swingSide = filter.side;
    }
  }
  const sensorLive = () =>
    enabled &&
    performance.now() - orientationAt < 1200 &&
    performance.now() - motionAt < 1200;
  // What the player typed, kept here so the text fields can be removed after joining.
  let joinInfo: {
    room: string;
    name: string;
    hand: string;
    outfit: string;
  } | null = null;
  async function claim(reconnect = false) {
    const info = joinInfo ?? {
      room: $<HTMLInputElement>("code").value.trim().toUpperCase(),
      name: $<HTMLInputElement>("nickname").value,
      hand: $<HTMLSelectElement>("hand").value,
      outfit: $<HTMLSelectElement>("outfit").value,
    };
    net.room = info.room;
    if (!/^[A-F0-9]{6}$/.test(net.room))
      throw Error("Enter the six-character room code shown on your display.");
    const saved = localStorage.getItem("visual-controller-" + net.room);
    let rankKey = localStorage.getItem("pov-rank-key");
    if (!rankKey) {
      const b = new Uint8Array(24);
      crypto.getRandomValues(b);
      rankKey = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("pov-rank-key", rankKey);
    }
    const r = await net.api("join", {
      rankKey,
      name: info.name,
      hand: info.hand,
      outfit: info.outfit,
      gear: savedGear(),
      pair: hash.get("pair") || undefined,
      credential: saved || undefined,
    });
    if (!joinInfo) {
      joinInfo = info;
      (document.activeElement as HTMLElement | null)?.blur();
      $("join").replaceChildren();
      // iOS offers "Undo Typing" when you shake the phone after typing in a text box — and
      // swinging is shaking. Its undo history belongs to the page, so after a typed join we
      // reopen the controller as a fresh page (this phone's seat is saved and taken back).
      if (!reconnect) {
        localStorage.setItem("visual-controller-" + net.room, r.credential);
        location.replace("/controller?room=" + net.room);
        return;
      }
    }
    net.credential = r.credential;
    playerId = r.player.id;
    // Joined: drop the welcome title and blurb so the controller is just the controls.
    document.body.classList.add("joined");
    seq = r.seq + 1;
    filter.hand = r.player.hand === "left" ? -1 : 1;
    localStorage.setItem("visual-controller-" + net.room, net.credential);
    $("join").classList.add("hidden");
    $("controls").classList.remove("hidden");
    await net.clock();
    net.stream();
    // Back into a game this phone was already ready for: skip the setup screens.
    rejoining = !!r.player.ready;
    if (rejoining) {
      $("guidance").textContent = enabled
        ? "Reconnected · jumping back in…"
        : "Reconnected · tap Enable motion controls to jump back in.";
      tryRejoin();
    } else if (reconnect)
      $("guidance").textContent =
        "Reconnected. Hold still, tap the button to set your start position, then Ready.";
  }
  let rejoining = false;
  /** One-tap rejoin: once sensors are live, use the saved swings and go straight back in. */
  const tryRejoin = () => {
    if (!rejoining || !sensorLive()) return;
    const p = savedProfile();
    if (!p) {
      rejoining = false;
      return;
    }
    rejoining = false;
    if (!filter.calibrated) filter.calibrate();
    filter.axes = p.axes;
    filter.sensitivity = p.sensitivity || 1;
    testsDone = true;
    finishTests(true);
    ready = true;
    showGame(true);
    net.api("ready", { ready: true }).catch(() => {});
  };
  action("connect", () => claim());
  action("reconnect", () => claim(true));
  // Reloaded page / reopened link: if this phone already has a seat in the room, take it back.
  {
    const room = (params.get("room") || "").toUpperCase();
    if (
      /^[A-F0-9]{6}$/.test(room) &&
      localStorage.getItem("visual-controller-" + room)
    ) {
      // Never show (or let anyone type in) the text fields on this page.
      $("join").replaceChildren();
      joinInfo = {
        room,
        name: "",
        hand: "right",
        outfit: localStorage.getItem("pov-outfit") || "classic",
      };
      claim(true).catch(() => {
        // Seat expired: forget it and start over with the join form.
        localStorage.removeItem("visual-controller-" + room);
        location.replace("/controller?room=" + room);
      });
    }
  }
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
      $("useSaved").classList.toggle("hidden", !savedProfile() || testsDone);
      $("enable").classList.add("hidden");
      $("error").textContent = "";
      ui("sensorStatus").text = "Waiting for samples";
      if ("wakeLock" in navigator)
        try {
          wake = await (navigator as any).wakeLock.request("screen");
        } catch {}
    } catch (e) {
      error(e);
    }
  };
  // Start position (neutral). Before the test it starts the four-swing test; afterwards it
  // only re-sets the start position and keeps the learned swings.
  action("calibrate", () => {
    if (!sensorLive())
      throw Error("Waiting for live orientation and motion samples");
    filter.calibrate();
    peak = 0;
    pendingSwing = false;
    ready = false;
    net.api("ready", { ready: false }).catch(() => {});
    if (testsDone) {
      $("guidance").textContent = "Start position set. Tap Ready.";
      return;
    }
    filter.axes = null;
    tests = {};
    testing = true;
    $("useSaved").classList.add("hidden");
    $("guidance").textContent =
      "Make one clear, comfortable swing in each direction when asked. Hold still between swings.";
    promptNext();
  });
  action("useSaved", () => {
    const p = savedProfile();
    if (!p) throw Error("No saved swings on this phone");
    if (!sensorLive())
      throw Error("Waiting for live orientation and motion samples");
    filter.calibrate();
    filter.axes = p.axes;
    filter.sensitivity = p.sensitivity || 1;
    $<HTMLInputElement>("sensitivity").value = String(filter.sensitivity);
    tests = {};
    $("useSaved").classList.add("hidden");
    finishTests(true);
  });
  action("ready", async () => {
    await net.api("ready", { ready: true });
    ready = true;
    saveProfile();
    showGame(true);
  });
  // Redo needs a second tap so a stray touch mid-game can't wipe the settings.
  let redoArmed = 0;
  action("redo", async () => {
    if (performance.now() - redoArmed > 3000) {
      redoArmed = performance.now();
      $("redo").textContent = "Tap again to redo the movement test";
      return;
    }
    $("redo").textContent = "Redo movement test";
    await net.api("ready", { ready: false }).catch(() => {});
    ready = false;
    testsDone = false;
    testing = false;
    tests = {};
    filter.axes = null;
    showChecks();
    showGame(false);
    $("instruction").textContent = "Let’s test your swings.";
    $("guidance").textContent =
      "Hold the phone like a paddle and tap the button to start the test.";
    $("stage").textContent = "02 / MOVEMENT TEST";
  });
  action("phonePause", () => net.api(current?.paused ? "resume" : "pause", {}));
  $<HTMLInputElement>("sensitivity").oninput = () => {
    filter.sensitivity = Number($<HTMLInputElement>("sensitivity").value);
    if (testsDone) saveProfile();
  };
  net.onStatus = (s) => {
    ui("connection").text = s;
  };
  // ——— Movement style + thumb pad (phone-only movement) ———
  const moveStyle = () =>
    Number(
      document.querySelector<HTMLInputElement>("input[name=ctl]:checked")
        ?.value ?? 2,
    );
  try {
    const saved = localStorage.getItem("visual-ctl");
    if (saved !== null)
      (
        document.getElementById("ctl-" + saved) as HTMLInputElement | null
      )?.click();
  } catch {
    /* default: phone thumb pad */
  }
  document.querySelectorAll<HTMLInputElement>("input[name=ctl]").forEach((r) =>
    r.addEventListener("change", () => {
      try {
        localStorage.setItem("visual-ctl", r.value);
      } catch {
        /* ignore */
      }
      if (current) net.onState({ state: current });
    }),
  );
  // ——— Serve picker (owner request): shown while it's your serve ———
  const serveStyle = () =>
    Number(
      document.querySelector<HTMLInputElement>("input[name=sv]:checked")
        ?.value ?? 0,
    );
  try {
    const sv = localStorage.getItem("pov-serve");
    if (sv !== null)
      (document.getElementById("sv-" + sv) as HTMLInputElement | null)?.click();
  } catch {
    /* default: drive */
  }
  document.querySelectorAll<HTMLInputElement>("input[name=sv]").forEach((r) =>
    r.addEventListener("change", () => {
      try {
        localStorage.setItem("pov-serve", r.value);
      } catch {
        /* ignore */
      }
    }),
  );
  let popupBuzz = -1;
  const padVec = { x: 0, z: 0 };
  const ring = document.querySelector<HTMLElement>(".padring")!;
  const knob = $("knob");
  let padTouch: number | null = null;
  const padMove = (cx: number, cy: number) => {
    const r = ring.getBoundingClientRect(),
      rad = r.width / 2;
    let dx = (cx - r.left - rad) / rad,
      dy = (cy - r.top - rad) / rad;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    // Small dead zone so a resting thumb does not creep.
    const dead = Math.hypot(dx, dy) < 0.15;
    padVec.x = dead ? 0 : Math.round(dx * 100) / 100;
    padVec.z = dead ? 0 : Math.round(-dy * 100) / 100;
    const travel = rad - knob.offsetWidth / 2;
    knob.style.transform = `translate(${dx * travel}px, ${dy * travel}px)`;
  };
  const padEnd = () => {
    padTouch = null;
    padVec.x = padVec.z = 0;
    knob.style.transform = "";
  };
  ring.addEventListener("pointerdown", (e) => {
    padTouch = e.pointerId;
    ring.setPointerCapture(e.pointerId);
    padMove(e.clientX, e.clientY);
    e.preventDefault();
  });
  ring.addEventListener("pointermove", (e) => {
    if (e.pointerId === padTouch) padMove(e.clientX, e.clientY);
  });
  ring.addEventListener("pointerup", padEnd);
  ring.addEventListener("pointercancel", padEnd);
  net.onState = ({ state }: { state: Match }) => {
    // Ranked matchmaking moves this phone into its match and back to the lobby afterwards.
    const mv = state.moves?.[playerId];
    if (mv && mv.code !== net.room) {
      localStorage.setItem("visual-controller-" + mv.code, net.credential);
      net.room = mv.code;
      history.replaceState(null, "", "/controller?room=" + mv.code);
      net.kick();
      return;
    }
    current = state;
    const p = state.players.find((p) => p.id === playerId);
    const wasReady = ready;
    ready = p?.ready || false;
    // The server can un-ready a phone (backgrounded, sensors lost): back to setup.
    if (wasReady && !ready) {
      showGame(false);
      $("guidance").textContent =
        "Paused for you. Hold still, tap the button to set your start position, then Ready.";
    }
    if (p)
      ui("igTitle").text =
        p.name + (state.ranked && p.rr ? " · " + p.rr + " RR" : " · Ready ✓");
    ui("phonePause").text = state.paused ? "Resume" : "Pause";
    const mineRes = state.ranked?.results.find((r) => r.name === p?.name);
    ui("matchStatus").text =
      state.phase === "over" && state.ranked
        ? mineRes
          ? `${state.message} ${mineRes.after >= mineRes.before ? "+" : ""}${mineRes.after - mineRes.before} RR`
          : state.message
        : state.phase === "lobby" && state.ranked
          ? state.message
          : state.phase === "over"
            ? "Game over · " + state.message + " The host can tap Play again."
            : state.phase === "lobby"
              ? ready
                ? "You're ready. Waiting for the big screen to start the game."
                : state.message
              : (state.paused ? "Paused · " : "") + state.message;
    // Pop-up coming to my team: tell me (and buzz on phones that support it).
    const mine = state.players.find((q) => q.id === playerId);
    const myPopup =
      !!mine &&
      state.phase === "rally" &&
      state.popup &&
      state.bounces === 0 &&
      state.lastTeam !== mine.team;
    if (myPopup) {
      ui("matchStatus").text = "⚡ POP-UP! Swing DOWN to smash it!";
      if (popupBuzz !== state.contacts) {
        popupBuzz = state.contacts;
        navigator.vibrate?.([60, 40, 60]);
      }
    }
    $("matchStatus").classList.toggle("alert", myPopup);
    const myServe =
      !!mine &&
      state.phase === "serve" &&
      state.mode !== "practice" &&
      state.serverId === mine.id &&
      !state.paused;
    $("servePick").classList.toggle("hidden", !myServe);
    if (myServe)
      ui("matchStatus").text =
        "🎾 Your serve · pick a serve below, then swing to serve";
    const inPlay =
      state.phase === "serve" ||
      state.phase === "rally" ||
      state.phase === "point";
    $("pad").classList.toggle("hidden", !(inPlay && moveStyle() === 2));
  };
  setInterval(() => {
    const live = sensorLive();
    if (rejoining && live) tryRejoin();
    $<HTMLButtonElement>("calibrate").disabled = !live;
    $<HTMLButtonElement>("ready").disabled =
      !live || !testsDone || !filter.calibrated;
    ui("sensorStatus").text = live
      ? "Live"
      : enabled
        ? "No live samples"
        : "Not enabled";
    ui("latency").text = net.credential ? net.latency + " ms" : "—";
    ui("angles").text =
      Math.round(filter.angle.pitch) +
      "° / " +
      Math.round(filter.angle.roll) +
      "°";
    ui("direction").text =
      filter.strength < 0.1
        ? "Neutral"
        : (filter.direction > 0.25
            ? "Up"
            : filter.direction < -0.25
              ? "Down"
              : "Level") +
          (filter.side > 0.2 ? " · →" : filter.side < -0.2 ? " · ←" : "");
    $("strength").style.width = Math.round(filter.strength * 100) + "%";
    $("paddle").style.transform =
      `perspective(400px) rotateX(${filter.angle.pitch}deg) rotateZ(${-filter.angle.roll}deg)`;
    if (enabled && !live && performance.now() - enabledAt > 5000)
      $("error").textContent =
        "No live sensor data. Check browser motion permissions. If your device has no supported sensors, use another phone.";
  }, 100);
  setInterval(async () => {
    // Up to two packets in flight hides tunnel/cellular round trips; the server drops any
    // that arrive out of order, and each swing rides in three packets so one late packet
    // cannot lose it (the server applies each swing id once).
    if (!net.credential || inflight >= 2 || document.hidden) return;
    inflight++;
    const fresh = pendingSwing && performance.now() >= swingDue;
    if (fresh) {
      swingId++;
      swingRepeats = 3;
    }
    const swing = swingRepeats > 0;
    if (swing) swingRepeats--;
    if (fresh) {
      pendingSwing = false;
      const k = testing ? nextTest() : undefined;
      if (k) {
        tests[k] = [...filter.peakVec] as Vec3;
        if (!nextTest()) {
          const result = learnAxes(tests as TestSwings);
          if (result.ok) {
            filter.axes = result.axes;
            finishTests();
          } else {
            for (const r of result.redo) delete tests[r];
            $("guidance").textContent = result.reason + " Let's redo those.";
            promptNext();
          }
        } else {
          $("guidance").textContent = "Got it. Hold still, then the next one.";
          promptNext();
        }
      }
      $("swingHint").textContent =
        "Swing detected · " +
        Math.round(swingPeak * 100) +
        "% · " +
        (swingSide > 0.2
          ? "toward your right →"
          : swingSide < -0.2
            ? "← toward your left"
            : "straight");
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
      side: swing ? swingSide : filter.side,
      swing: swing && live,
      swingId,
      sensors: live,
      calibrated: filter.calibrated && live,
      ctl: moveStyle(),
      sv: serveStyle(),
      mx: padVec.x,
      mz: padVec.z,
    };
    try {
      await net.api("input", input);
    } catch {
      ui("connection").text = "Connection lost";
    } finally {
      inflight--;
    }
  }, 33);
  setInterval(() => {
    if (net.credential) net.clock().catch(() => {});
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    // Leaving the page pauses the match; coming back resumes it automatically
    // (swings and start position are kept — no setup again).
    if (document.hidden) {
      pendingSwing = false;
      net.api("background", {}).catch(() => {});
      wake?.release();
      wake = null;
    } else if (net.credential) {
      net.clock().catch(() => {});
      net.kick();
      if ("wakeLock" in navigator && enabled)
        (navigator as any).wakeLock
          .request("screen")
          .then((w: any) => (wake = w))
          .catch(() => {});
    }
  });
}
