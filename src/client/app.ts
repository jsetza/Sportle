import { Connection } from "./net.ts";
import { MotionFilter, aimFrom, learnSwings, wrap } from "../shared/motion.ts";
import type { SetupSwing, SwingProfile } from "../shared/motion.ts";
import {
  slots,
  MAPS,
  OUTFITS,
  PADDLES,
  SHOES,
  EYEWEAR,
  cleanGear,
} from "../shared/types.ts";
import type { Match, Input, MapId, Player } from "../shared/types.ts";
import { Scene, VIEW_LABELS } from "./scene.ts";
import { QUALITY_LABELS } from "./renderer.ts";
import { Hud } from "./hud.ts";
import { KeyboardPaddle } from "./keyboard.ts";
import type { QualityPref } from "./renderer.ts";
import type { ViewMode } from "./scene.ts";
import { drawQR } from "./qr.ts";
import { Music, MUSIC_STYLES } from "./music.ts";
import type { MusicStyle } from "./music.ts";
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
<header class="topbar"><span id="joinAt">Phones join at this screen’s link</span><nav><button class="link" id="music" title="Change music style">Music: House</button><button class="link" id="view" title="Change camera (V)">View: Third person</button><button class="link" id="quality" title="Graphics quality (Auto lowers it if frames run slow)">Graphics: Auto</button><button class="link" id="howtoOpen">How to play</button><button class="link" id="sound">Sound off</button><button class="link" id="fullscreen">Fullscreen</button></nav></header>
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
    <div id="pairing" class="pairing"><div class="qrtile"><canvas id="qr" class="qr"></canvas><div class="pairedtile" aria-hidden="true"><span>✓</span><b>PAIRED</b></div></div><div><small>Room code</small><div class="roomcode" id="roomcode"></div><ul class="checklist" id="checklist"></ul><button class="link hidden" id="useKeys">Use the keyboard instead</button><p class="fine" id="pairHint">Scan with your phone camera.</p><div id="teamPick" class="hidden"><label for="pairTeam">Phones paired here join</label><select id="pairTeam"><option value="">Any open team</option><option value="0">Team blue</option><option value="1">Team red</option></select></div><button class="link" id="refreshPair">Refresh pairing link</button></div></div>
    <div id="matchOpts" class="opts hidden">
      <div class="optrow" id="optOppRow"><span id="optOppLabel">Opponent</span><div class="seg" data-opt="difficulty"><button data-v="easy">Rookie</button><button data-v="medium">Club</button><button data-v="hard">Pro</button></div></div>
      <div class="optrow" id="optStyleRow"><span>Style</span><div class="seg" data-opt="style"><button data-v="allround">All-round</button><button data-v="attacker">Attacker</button><button data-v="defender">Defender</button></div></div>
      <div class="optgrid"><div class="optrow"><span>Game to</span><div class="seg" data-opt="to"><button data-v="5">5</button><button data-v="7">7</button><button data-v="11">11</button></div></div><div class="optrow"><span>Match</span><div class="seg" data-opt="bestOf"><button data-v="1">1 game</button><button data-v="3">Best of 3</button></div></div><div class="optrow"><span>Warm-up</span><div class="seg" data-opt="warmup"><button data-v="true">On</button><button data-v="false">Off</button></div></div></div>
    </div>
    <div class="difficulty viewpick" role="radiogroup" aria-label="Camera"><span>Camera · <kbd>V</kbd></span>${(["third", "first", "broadcast"] as const).map((v) => `<input type="radio" name="view" id="v-${v}" value="${v}"><label for="v-${v}">${{ third: "3rd person", first: "1st person", broadcast: "Broadcast" }[v]}</label>`).join("")}</div>
    <div id="players"></div>
    <button class="link" id="photoOpen">Your face on the player (optional photo)</button>
    <div id="rankedBox" class="ranked hidden"><div class="rkstatus" id="rkStatus"></div><p class="fine" id="rkLast"></p><button class="cta" id="rkFind">Find match <span>→</span></button><button class="ghost hidden" id="rkCancel">Cancel search</button><h3>Leaderboard</h3><ol class="board" id="rkBoard"><li class="fine">No ranked games yet.</li></ol></div>
    <div class="telemetry" id="telemetry"></div>
    <button id="start" class="cta">Start practice <span>→</span></button>
    <div class="row inplay"><button id="pause" class="ghost">Pause</button><button id="resume" class="ghost">Resume</button></div>
    <p class="fine inplay">Move with <kbd>WASD</kbd> (player 1) and the <kbd>arrow keys</kbd> (player 2), or let characters position themselves. Compact phone swings control timing, angle and power. When it’s your serve, pick Drive, Roll or Slice on your phone and swing to serve.</p>
    <button id="new" class="link">← Leave court</button>
  </div>
  <div id="error" role="alert"></div>
</aside>
<button class="paneltab" id="panelToggle" aria-controls="panel">Room</button>
<div class="hud"><span class="courtlabel" id="courtLabel">POVPICKLE ARENA</span><div class="sboard" id="score"></div><div class="pills" id="pills"></div></div>
<div class="banner" id="banner" aria-live="polite"></div>
<div class="spotify hidden" id="spotify"><div class="sphead"><b>Spotify</b><button class="link" id="spChange">Change playlist</button><button class="link" id="spHide">Hide</button></div><iframe id="spFrame" title="Spotify playlist player" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe></div>
<button class="spotifytab hidden" id="spShow">♫ Spotify</button>
<div class="intro hidden" id="intro" aria-live="polite"></div>
<div class="toast hidden" id="toast" aria-live="polite"></div>
<div class="message" id="message" aria-live="polite">Pick a mode to start.</div>
<div class="keys" id="keys" aria-live="polite"></div>
<div class="callout hidden" id="callout" aria-live="assertive"><b>POP-UP!</b><span>Swing down to smash</span></div>
<div class="gameover hidden" id="gameover" role="dialog" aria-labelledby="goTitle"><small id="goMode">MATCH</small><h2 id="goTitle">Blue wins</h2><div class="goscore" id="goScore">11 : 7</div><p id="goNames"></p><button class="cta" id="again">Play again <span>↻</span></button><button class="link" id="goMenu">Change mode</button><p class="fine" id="goWait"></p></div>
<dialog id="photoDlg" class="photodlg"><h2>Your photo</h2><p class="fine">Line your face up in the oval.</p><div class="photorow"><div class="cam"><video id="camVideo" playsinline muted autoplay></video><canvas id="camShot" class="hidden" width="200" height="250"></canvas><div class="oval" aria-hidden="true"></div><p class="camerr" id="camErr"></p></div><div class="faceprev"><canvas id="facePrev" width="120" height="300"></canvas><small>On the court</small></div></div><p class="fine">The photo stays in this browser only and is never uploaded. Other screens see the drawn face.</p><div class="photobtns"><button class="link" id="drawnFace">Use a drawn face</button><span></span><button class="ghost" id="photoRetry">Try again</button><button class="cta" id="photoUse">Use photo <span>→</span></button></div></dialog>
<dialog id="howto"><h2>How to play</h2><ol><li><b>Press Play</b>, pick <b>Offline</b> (everyone on this screen) or <b>Online</b> (other homes), then a mode, a map and a difficulty, and <b>Create game</b>. A QR code and room code appear.</li><li><b>Scan the QR</b> with your phone camera, choose your nickname, hand, outfit and gear (paddle, shoes, eyewear).</li><li><b>Set up the paddle</b> in four steps on the phone: <b>Allow motion</b>; <b>aim at the screen</b> (hold the phone flat like a TV remote, top edge to the screen, and press and hold until the bar fills); <b>three forehands</b> (screen facing the TV, swing across your body); <b>three backhands</b> (turn the phone over). The phone learns your swings and remembers them: next time it's Allow motion, aim, and you're in.</li><li><b>Move with the keyboard</b> on this screen: <kbd>W A S D</kbd> moves player 1, the <kbd>arrow keys</kbd> move player 2. Until you press a key, your character positions itself. Stay out of the kitchen when volleying!</li><li><b>Time compact swings</b> as the ball reaches you. The paddle face and the swing path pick the shot: low-to-high with a closed face = topspin drive / roll; high-to-low with an open face = slice (harder = chop, backspin that skids low); gentle with an open face = dink near the kitchen or drop from the back; fast and flat = drive; big upward swing with an open face = lob; a high ball and a downward swing = smash; a firm face with almost no swing against a hard ball = block / reset. Swing left or right to aim.</li><li><b>No phone?</b> In the lobby choose <b>Use the keyboard instead</b>: hold and release <kbd>Space</kbd> to swing (longer = harder); hold <kbd>Shift</kbd> for a dink, <kbd>E</kbd> topspin, <kbd>Q</kbd> slice, <kbd>R</kbd> lob, <kbd>F</kbd> smash; <kbd>A</kbd>/<kbd>D</kbd> also aim; <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> pick a drive/roll/slice serve.</li><li><b>Serve:</b> when it’s your serve, pick <b>Drive</b>, <b>Roll</b> (topspin that dips and kicks) or <b>Slice</b> (curves back in) on your phone, then swing. A harder swing serves deeper and faster; swing left or right to steer.</li></ol><p class="fine">If a phone drops out (locked screen, app switch, weak signal), the game pauses and carries on by itself a few seconds after it's back. Your feet and the low underhand contact are placed for you when serving. Phone sensors estimate swing intent, not exact paddle position.</p><button class="cta" id="howtoClose">Got it</button></dialog>`;
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
  // Scoreboard, pills, banners, intro and warm-up toast; won points trigger the celebration.
  const hud = new Hud(document.querySelector<HTMLElement>(".hud")!);
  hud.onPoint = (e) => scene.celebrate(e.team, e.size, e.sideOut);
  // "Use the keyboard instead": this screen drives one player's paddle from the keyboard.
  const kb = new KeyboardPaddle();
  kb.onError = error;
  // Test hook (automated browser checks only): open the page with #test.
  if (location.hash === "#test") {
    (window as any).__povScene = scene;
    (window as any).__povMusic = Music;
  }
  // Graphics quality (Auto / High / Medium / Low), remembered per browser.
  const qualityLabel = () => {
    const r = scene.gl;
    $("quality").textContent =
      "Graphics: " +
      QUALITY_LABELS[r.pref] +
      (r.pref === "auto" ? " (" + QUALITY_LABELS[r.quality] + ")" : "");
    $("quality").title = r.note || "Graphics quality";
  };
  qualityLabel();
  setInterval(qualityLabel, 2000);
  $("quality").onclick = () => {
    const order: QualityPref[] = ["auto", "high", "medium", "low"];
    scene.gl.setQuality(order[(order.indexOf(scene.gl.pref) + 1) % order.length]);
    qualityLabel();
  };
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
    // A keyboard seat survives a reload of this screen.
    kb.resume(net.room).catch(() => kb.stop());
  }
  net.onStatus = (s) => {
    ui("connection").text = s + " · " + net.room;
  };
  // The room is gone (server restarted/redeployed, or expired): back to the menu, say why.
  net.onGone = () => {
    kb.stop();
    sessionStorage.removeItem("visual-host");
    sessionStorage.setItem(
      "pov-gone",
      "Room " + net.room + " has ended (the server restarted or the room expired). Create a new game.",
    );
    location.reload();
  };
  {
    const gone = sessionStorage.getItem("pov-gone");
    if (gone) {
      sessionStorage.removeItem("pov-gone");
      $("error").textContent = gone;
    }
  }
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
    hud.update(
      state,
      localPlayers(state).map((p) => p.id),
    );
    lobbyUI(state);
    applyFace(state);
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
    ui("players").html =
      Array.from({ length: seats }, (_, i) => {
        const p = state.players.filter((p) => !p.bot)[i];
        const swap =
          p && host && choice && state.phase === "lobby"
            ? `<button class="swap" data-team="${p.id}:${1 - p.team}">→ ${p.team ? "Blue" : "Red"}</button>`
            : "";
        return `<div class="player team${p ? p.team : ""}"><span>${p ? escape(p.name) : "Waiting for player " + (i + 1)}<br><small>${p ? (state.ranked ? p.rr + " RR" : (p.team ? "Red" : "Blue") + " · " + p.hand + " handed") : state.ranked && i > 0 ? "Optional: a friend on this screen" : "Scan to claim this slot"}</small></span>${swap}<span class="status">${p ? (p.connected ? (p.ready ? "Ready ✓" : "Calibrate") : "Offline") : "○"}</span></div>`;
      }).join("") +
      (localPlayers(state).length === 2 && state.phase === "lobby"
        ? `<button class="ghost swapbtn" data-swap>⇄ Swap sides · ${escape(localPlayers(state)[0].name)} on the left</button>`
        : "");
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
  // ——— Lobby setup: match options, PAIRED card with checklist, keyboard seat ———
  const optButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("#matchOpts .seg button"),
  );
  const lobbyUI = (state: Match) => {
    const lobby = state.phase === "lobby";
    const opts = lobby && !state.ranked && state.mode !== "practice";
    $("matchOpts").classList.toggle("hidden", !opts);
    if (opts) {
      const bots = state.mode === "solo" || state.mode === "coop";
      $("optStyleRow").classList.toggle("hidden", !bots);
      ui("optOppLabel").text = bots ? "Opponent" : "Hitbox";
      const vals: Record<string, string> = {
        difficulty: state.difficulty,
        style: state.rules.style,
        to: String(state.rules.to),
        bestOf: String(state.rules.bestOf),
        warmup: String(state.rules.warmup),
      };
      for (const b of optButtons) {
        const opt = b.parentElement!.dataset.opt!;
        b.classList.toggle("on", vals[opt] === b.dataset.v);
        b.disabled = !host;
        if (opt === "difficulty")
          b.textContent = bots
            ? { easy: "Rookie", medium: "Club", hard: "Pro" }[b.dataset.v!]!
            : { easy: "Big", medium: "Medium", hard: "Normal" }[b.dataset.v!]!;
      }
    }
    // Pairing card: big ✓ PAIRED once this screen's phones are all set, plus a checklist.
    const mine = localPlayers(state);
    const seats = state.ranked
      ? state.ranked.queue === "1v1"
        ? 1
        : 2
      : slots(state.mode);
    const humans = state.players.filter((p) => !p.bot);
    const ok = (p: Player | undefined) => !!p && p.connected && p.ready;
    const allSet =
      mine.length > 0 &&
      mine.every(ok) &&
      (humans.length >= seats || !!state.ranked);
    $("pairing").classList.toggle("paired", lobby && allSet);
    const p = mine.find((q) => !ok(q)) ?? mine[mine.length - 1];
    const item = (done: boolean, busy: boolean, text: string) =>
      `<li class="${done ? "done" : busy ? "busy" : ""}">${text}</li>`;
    ui("checklist").html = lobby
      ? item(!!p?.connected, false, "Phone connected") +
        item(!!p?.input.sensors, !!p?.connected, p?.keyboard ? "Keyboard paddle on" : "Motion sensors on") +
        item(!!p?.ready, !!p?.input.sensors, p && !p.ready && p.input.sensors ? "Setting up on the phone" : "Set up")
      : "";
    $("useKeys").classList.toggle(
      "hidden",
      !lobby || !!state.ranked || kb.active || humans.length >= seats || !pair,
    );
  };
  // Clicks build on the latest choice even before the server's snapshot catches up.
  let draft: { rules: Record<string, unknown>; difficulty: string; at: number } | null =
    null;
  for (const b of optButtons)
    b.onclick = () => {
      if (!current || !host) return;
      const opt = b.parentElement!.dataset.opt!;
      const fresh = draft && Date.now() - draft.at < 1500;
      const rules: Record<string, unknown> = fresh
        ? { ...draft!.rules }
        : { ...current.rules };
      let difficulty = fresh ? draft!.difficulty : (current.difficulty as string);
      if (opt === "difficulty") difficulty = b.dataset.v!;
      else if (opt === "to" || opt === "bestOf") rules[opt] = Number(b.dataset.v);
      else if (opt === "warmup") rules.warmup = b.dataset.v === "true";
      else rules[opt] = b.dataset.v;
      draft = { rules, difficulty, at: Date.now() };
      // Show the choice right away.
      for (const o of Array.from(b.parentElement!.querySelectorAll("button")))
        o.classList.toggle("on", o === b);
      net.api("rules", { rules, difficulty }).catch(error);
    };
  action("useKeys", () => kb.start(net.room, pair));
  // ——— Optional face photo (owner request): camera on this screen, oval guide.
  // Kept in this browser's storage only, shown on this screen's player 1; never uploaded. ———
  const faceImg = new Image();
  let faceFor = "";
  const loadFace = () => {
    let url = "";
    try {
      url = localStorage.getItem("pov-face") || "";
    } catch {}
    faceFor = "";
    if (url) faceImg.src = url;
    return !!url;
  };
  let hasFace = loadFace();
  const applyFace = (state: Match) => {
    const me = localPlayers(state)[0];
    if (!me || me.id === faceFor) return;
    if (faceFor) scene.setFace(faceFor, null);
    faceFor = me.id;
    if (hasFace && faceImg.complete && faceImg.naturalWidth) scene.setFace(me.id, faceImg);
    else if (hasFace) faceImg.onload = () => scene.setFace(me.id, faceImg);
  };
  const dlg = $<HTMLDialogElement>("photoDlg"),
    video = $<HTMLVideoElement>("camVideo"),
    shot = $<HTMLCanvasElement>("camShot");
  let stream: MediaStream | null = null;
  const stopCam = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  const drawPreview = (face: CanvasImageSource | null) => {
    const c = $<HTMLCanvasElement>("facePrev"),
      g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = "#54a8fa";
    g.beginPath();
    g.roundRect(14, 10, 92, 280, 46);
    g.fill();
    g.save();
    g.beginPath();
    g.ellipse(60, 78, 34, 42, 0, 0, Math.PI * 2);
    g.fillStyle = "#f4efe6";
    g.fill();
    g.clip();
    if (face) g.drawImage(face, 26, 36, 68, 84);
    else {
      g.fillStyle = "#1b1b24";
      g.beginPath();
      g.ellipse(48, 74, 4, 6, 0, 0, Math.PI * 2);
      g.ellipse(72, 74, 4, 6, 0, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 3;
      g.beginPath();
      g.arc(60, 88, 9, 0.2, Math.PI - 0.2);
      g.stroke();
    }
    g.restore();
  };
  const startCam = async () => {
    shot.classList.add("hidden");
    video.classList.remove("hidden");
    $("photoUse").textContent = "Take photo";
    ui("camErr").text = "";
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
      });
      video.srcObject = stream;
      await video.play();
    } catch {
      ui("camErr").text =
        "The camera is blocked or missing. Allow it from the address bar, then try again.";
    }
  };
  $("photoOpen").onclick = () => {
    drawPreview(hasFace ? faceImg : null);
    dlg.showModal();
    startCam();
  };
  dlg.addEventListener("close", stopCam);
  $("photoRetry").onclick = () => startCam();
  $("drawnFace").onclick = () => {
    try {
      localStorage.removeItem("pov-face");
    } catch {}
    hasFace = false;
    if (faceFor) scene.setFace(faceFor, null);
    faceFor = "";
    stopCam();
    dlg.close();
  };
  $("photoUse").onclick = () => {
    if (stream && video.videoWidth) {
      // Crop the oval area (centre of the frame), mirrored like a selfie, with an oval mask.
      const g = shot.getContext("2d")!,
        vw = video.videoWidth,
        vh = video.videoHeight,
        h = vh * 0.82,
        w = h * 0.8;
      g.clearRect(0, 0, shot.width, shot.height);
      g.save();
      g.beginPath();
      g.ellipse(100, 125, 98, 123, 0, 0, Math.PI * 2);
      g.clip();
      g.translate(shot.width, 0);
      g.scale(-1, 1);
      g.drawImage(video, (vw - w) / 2, (vh - h) / 2, w, h, 0, 0, shot.width, shot.height);
      g.restore();
      stopCam();
      video.classList.add("hidden");
      shot.classList.remove("hidden");
      drawPreview(shot);
      $("photoUse").innerHTML = "Use photo <span>→</span>";
      return;
    }
    if (!shot.classList.contains("hidden")) {
      try {
        localStorage.setItem("pov-face", shot.toDataURL("image/png"));
      } catch {}
      hasFace = loadFace();
      if (current) applyFace(current);
      dlg.close();
    }
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
  // This screen's players in left-half/right-half order (left half also has WASD).
  const localPlayers = (state: Match) => {
    const list = state.players.filter(
      (p) => !p.bot && (p.display === displayId || (host && p.display === "")),
    );
    return state.swapped?.includes(displayId || "host") ? list.reverse() : list;
  };
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
  // ——— Background music: House by default; the button cycles styles and Off. Starts on the
  // first click/key (browser rule). ———
  const music = new Music();
  type Pick = MusicStyle | "spotify" | "off";
  const order: Pick[] = [...MUSIC_STYLES.map((m) => m.id), "spotify", "off"];
  // ——— Spotify (owner request): the official Spotify embed player, playing a playlist on
  // this screen. Spotify streams it; nothing is downloaded or re-hosted. Full songs need a
  // Spotify login in this browser; otherwise Spotify plays 30-second previews. ———
  const DEFAULT_PLAYLIST = "playlist/PASTE_A_PLAYLIST_ID";
  const spotifyPath = () => {
    try {
      return localStorage.getItem("pov-spotify") || DEFAULT_PLAYLIST;
    } catch {
      return DEFAULT_PLAYLIST;
    }
  };
  const syncSpotify = () => {
    const on = choice === "spotify";
    $("spotify").classList.toggle("hidden", !on);
    $("spShow").classList.add("hidden");
    $("spotify").classList.remove("mini");
    const frame = $<HTMLIFrameElement>("spFrame");
    const src = "https://open.spotify.com/embed/" + spotifyPath() + "?utm_source=generator&theme=0";
    if (on && frame.src !== src) frame.src = src;
    // Leaving Spotify stops it (unloading the player is the only way to stop an embed).
    if (!on && frame.src) frame.removeAttribute("src");
  };
  $("spChange").onclick = () => {
    const url = prompt(
      "Paste a Spotify playlist or album link (Share → Copy link):",
      "https://open.spotify.com/" + spotifyPath(),
    );
    if (!url) return;
    const m = url.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album)\/([A-Za-z0-9]{10,40})/);
    if (!m) return error(Error("That doesn't look like a Spotify playlist or album link."));
    try {
      localStorage.setItem("pov-spotify", m[1] + "/" + m[2]);
    } catch {}
    syncSpotify();
  };
  // Hide keeps it playing (moved off screen), with a small tab to bring it back.
  $("spHide").onclick = () => {
    $("spotify").classList.add("mini");
    $("spShow").classList.remove("hidden");
  };
  $("spShow").onclick = () => {
    $("spotify").classList.remove("mini");
    $("spShow").classList.add("hidden");
  };
  let choice: Pick = "house";
  try {
    const saved = localStorage.getItem("visual-music");
    // Older saves were "on"/"off"; "on" becomes House.
    if (saved && (order as string[]).includes(saved)) choice = saved as Pick;
    else if (saved === "off") choice = "off";
  } catch {
    /* default House */
  }
  const syncMusic = () => {
    const name =
      choice === "spotify" ? "Spotify" : MUSIC_STYLES.find((m) => m.id === choice)?.name;
    $("music").textContent = name ? "Music: " + name : "Music off";
    const synth = choice !== "off" && choice !== "spotify";
    if (synth) music.setStyle(choice as MusicStyle);
    if (synth && userActed) music.start();
    else music.stop();
    syncSpotify();
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
    choice = order[(order.indexOf(choice) + 1) % order.length];
    try {
      localStorage.setItem("visual-music", choice);
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
              : "Finish the paddle setup on your phone.";
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
    ui("keys").html =
      local
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
          const half =
            local.length === 2 && scene.viewMode !== "broadcast"
              ? `<small>${slot ? "right" : "left"} screen</small> `
              : "";
          return `<span class="team${p.team}">${how}${half}${escape(p.name)}${note}</span>`;
        })
        .join("") +
      (local.length === 2
        ? '<button class="ghost swapbtn" data-swap>⇄ Swap sides</button>'
        : "");
  };
  // Swap which player gets the left/right half of the split screen (and WASD/arrows).
  document.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("[data-swap]"))
      net.api("swap", {}).catch(error);
  });
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
    kb.stop();
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
  app.innerHTML = `<div class="phone"><header class="phead"><div class="logo"><b>POV</b>pickle</div><span class="pstat"><span>PADDLE</span>·<span id="pSlot">P1</span>·<i class="dot" id="pDot"></i><span id="connection">NOT CONNECTED</span><span id="pLat"></span></span></header><div class="ruler" aria-hidden="true"></div><h1>A paddle.<br>In your pocket.</h1><p>Hold your phone like a paddle. A short setup learns your swings. Swing at your normal pace.</p><div id="join" class="card"><div class="number">01 / CLAIM YOUR SPOT</div><label for="code">Room code</label><input id="code" maxlength="6" autocomplete="off" placeholder="ABC123"><label for="nickname">Your nickname</label><input id="nickname" maxlength="20" placeholder="Player"><label for="hand">Paddle hand</label><select id="hand"><option value="right">Right hand</option><option value="left">Left hand</option></select><label for="outfit">Outfit</label><select id="outfit">${OUTFITS.map((o) => `<option value="${o.id}">${o.name}</option>`).join("")}</select><details class="gear" open><summary>Your gear</summary><label for="gearPaddle">Paddle</label><select id="gearPaddle">${PADDLES.map((g, i) => `<option value="${i}">${g.name}</option>`).join("")}</select><label for="gearShoes">Shoes</label><select id="gearShoes">${SHOES.map((g, i) => `<option value="${i}">${g.name}</option>`).join("")}</select><label for="gearEyes">Eyewear</label><select id="gearEyes">${EYEWEAR.map((g, i) => `<option value="${i}">${g}</option>`).join("")}</select></details><button class="full" id="connect">Connect to court</button></div><div id="controls" class="hidden"><section id="setup" class="setup"><div class="stephead" id="stepHead"><span class="stepno"><b id="stepNo">01</b> / 04</span><span class="dashes" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="steptag" id="stepTag">MOTION</span></div><div class="eyebrow hidden" id="welcomeBack">WELCOME BACK</div><h2 class="big" id="stepTitle">Aim at the screen.</h2><p class="lead" id="stepText">First, let the paddle use this phone’s motion sensors. Tap Allow motion, then Allow.</p><figure class="diagram" id="diagram"></figure><p class="caption" id="diagramCap"></p><div class="gauge hidden" id="gauge"><div class="gtop"><span>SWING SPEED</span><b id="gValue">0.0</b><small>rad/s</small></div><svg id="gRuler" viewBox="0 0 300 52" aria-hidden="true"></svg><div class="gstatus"><span class="gdashes" id="gDashes"><i></i><i></i><i></i></span><span id="gText">WAITING FOR A SWING</span></div><div class="gsegs" id="gSegs"></div><p class="ghint" id="gHint">Swing at your normal rally pace.</p></div><button class="slant orange" id="enable"><span>ALLOW MOTION</span></button><button class="linkbig hidden" id="redoSetup">Set up my swings again</button><button class="hold hidden" id="hold" aria-label="Hold to set the screen direction"><span class="htop"><b>HOLD TO SET</b><small id="holdHint">PRESS AND HOLD</small></span><span class="segs" id="holdSegs"></span></button><div class="pairbtns hidden" id="swingBtns"><button class="slant dark" id="redoLast"><span>REDO LAST</span></button><button class="slant dark" id="next" disabled><span id="nextLabel">NEXT</span></button></div></section><div id="ingame" class="card hidden"><div class="number">YOU’RE IN</div><h2 id="igTitle">Ready ✓</h2><p class="status" id="matchStatus">Your display will start the game.</p><div class="movepick servepick hidden" id="servePick" role="radiogroup" aria-label="Your serve"><span>Your serve</span><input type="radio" name="sv" id="sv-0" value="0" checked><label for="sv-0">Drive<small>straight</small></label><input type="radio" name="sv" id="sv-1" value="1"><label for="sv-1">Roll<small>topspin dip</small></label><input type="radio" name="sv" id="sv-2" value="2"><label for="sv-2">Slice<small>curves back in</small></label></div><div id="pad" class="pad hidden" aria-label="Movement thumb pad"><div class="padring"><div id="knob" class="knob"></div></div></div><div class="sidepick hidden" id="sidePick" role="radiogroup" aria-label="Your half of the screen"><span>Your side of the screen</span><button data-side="left">Left</button><button data-side="right">Right</button></div><button class="full secondary" id="phonePause">Pause</button><details class="more"><summary>Paddle settings</summary><div class="movepick" role="radiogroup" aria-label="How you move"><span>How you move</span><input type="radio" name="ctl" id="ctl-2" value="2" checked><label for="ctl-2">Phone<small>thumb pad</small></label><input type="radio" name="ctl" id="ctl-1" value="1"><label for="ctl-1">Keyboard<small>WASD / arrows</small></label><input type="radio" name="ctl" id="ctl-0" value="0"><label for="ctl-0">Auto<small>moves for you</small></label></div><label for="sensitivity">Swing feel (learned from your setup swings)</label><input id="sensitivity" type="range" min="0.5" max="2.5" step="0.05" value="1"><button class="link" id="reaim">Aim at the screen again</button><button class="link" id="redo">Set up my swings again</button></details></div></div><div id="error" role="alert"></div></div>`;
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
  // ——— Phone setup (owner request: four steps) ———
  // 01 allow motion · 02 aim at the screen (hold to set) · 03 three forehands · 04 three
  // backhands. The swings teach this phone its left/right sign, which side is the forehand
  // face and the player's normal swing speed (= a medium shot). Saved on the phone.
  type Step = "motion" | "aim" | "fore" | "back" | "done";
  let step: Step = "motion",
    welcome = false,
    redoRequested = false;
  const swingsFore: SetupSwing[] = [],
    swingsBack: SetupSwing[] = [];
  const PROFILE = "pov-paddle";
  type Saved = SwingProfile & { hand: string };
  const savedProfile = (): Saved | null => {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE) || "null");
      return p && (p.sideSign === 1 || p.sideSign === -1) ? p : null;
    } catch {
      return null;
    }
  };
  const saveProfile = (p: SwingProfile) => {
    try {
      localStorage.setItem(
        PROFILE,
        JSON.stringify({ ...p, sensitivity: filter.sensitivity, hand: filter.hand < 0 ? "left" : "right" }),
      );
    } catch {
      /* ignore */
    }
  };
  const applyProfile = (p: SwingProfile) => {
    filter.sideSign = p.sideSign;
    filter.faceSign = p.faceSign;
    filter.sensitivity = p.sensitivity;
    $<HTMLInputElement>("sensitivity").value = String(p.sensitivity);
  };
  const lefty = () => filter.hand < 0;
  // ——— diagrams (inline SVG; scale to their box so they never spill out) ———
  const SVG = (inner: string, mirror = false) =>
    `<svg viewBox="0 30 400 175" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g${mirror ? ' transform="translate(400 0) scale(-1 1)"' : ""}>${inner}</g></svg>`;
  const T = (x: number, y: number, s: string, anchor = "middle") =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}">${s}</text>`;
  const aimDiagram = () =>
    `<svg viewBox="0 0 400 210" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
    T(52, 30, "PLAN", "start") +
    `<rect x="50" y="42" width="110" height="7" rx="3" class="screenbar"/>` +
    T(105, 68, "SCREEN") +
    `<path d="M105 160 V80" class="dash"/><path d="M100 86 L105 76 L110 86" class="arrow"/>` +
    `<rect x="86" y="120" width="38" height="70" rx="9" class="phoneoutline"/><rect x="99" y="127" width="12" height="4" rx="2" class="phoneoutline"/>` +
    `<path d="M126 121 L146 104 H156" class="leader"/>` +
    T(160, 108, "TOP EDGE", "start") +
    `<path d="M215 25 V195" class="divider"/>` +
    T(232, 30, "SIDE", "start") +
    T(350, 52, "SCREEN") +
    `<rect x="345" y="62" width="7" height="72" rx="3" class="screenbar"/><path d="M348 134 V188" class="thin"/>` +
    `<path d="M235 188 H385" class="thin"/>` +
    `<g transform="rotate(-10 290 158)"><rect x="248" y="154" width="84" height="9" rx="4.5" class="phoneoutline"/><rect x="250" y="153" width="80" height="3" class="facemark"/></g>` +
    `<path d="M281 150 L277 118" class="thin"/><path d="M272 124 L277 114 L282 124" class="arrow"/>` +
    T(286, 116, "SCREEN UP", "start") +
    `<path d="M334 151 L346 147" class="dash"/>` +
    `</svg>`;
  const swingDiagram = (fore: boolean) => {
    // Top-down view, right hand by default (mirrored for left-handers).
    const arc = fore
      ? `<path d="M300 150 C 300 70, 120 70, 110 140" class="swingarc"/><path d="M100 128 L110 145 L122 130" class="arrow"/>`
      : `<path d="M110 150 C 110 70, 290 70, 300 140" class="swingarc"/><path d="M288 128 L300 145 L310 130" class="arrow"/>`;
    const phone = fore
      ? `<rect x="282" y="132" width="40" height="14" rx="4" class="phoneoutline"/><rect x="283" y="131" width="38" height="3" class="facemark"/>`
      : `<rect x="88" y="132" width="40" height="14" rx="4" class="phoneoutline"/><rect x="89" y="144" width="38" height="3" class="facemark"/>`;
    return SVG(
      `<rect x="120" y="36" width="160" height="7" rx="3" class="screenbar"/><circle cx="205" cy="182" r="20" class="body"/><path d="M215 172 L${fore ? 296 : 112} 146" class="thin"/>${arc}${phone}`,
      lefty(),
    );
  };
  const segs = (el: HTMLElement, n: number) => {
    if (el.childElementCount !== n) el.innerHTML = "<i></i>".repeat(n);
  };
  // ——— swing speed gauge (rad/s, 0–30) ———
  const ruler = () => {
    const thr = (0.24 * 210) / filter.sensitivity / (180 / Math.PI);
    let s = "";
    for (let v = 0; v <= 30; v++) {
      const x = 10 + (v / 30) * 280,
        major = v % 5 === 0;
      s += `<path d="M${x} ${major ? 18 : 24} V30" class="tick"/>`;
      if (major) s += `<text x="${x}" y="46" text-anchor="middle">${v}</text>`;
    }
    const tx = 10 + (Math.min(30, thr) / 30) * 280;
    s += `<path d="M10 30 H290" class="tick"/><path d="M${tx} 6 V30" class="thr"/><path id="gNeedle" d="M0 2 V30 M-5 2 H5" class="needle" transform="translate(10 0)"/>`;
    $("gRuler").innerHTML = s;
  };
  let gaugeRad = 0;
  const showStep = (s: Step) => {
    step = s;
    const prof = savedProfile();
    $("welcomeBack").classList.toggle("hidden", !(welcome && (s === "motion" || s === "aim")));
    $("stepHead").classList.toggle("hidden", welcome && s === "motion");
    const n = { motion: 1, aim: 2, fore: 3, back: 4, done: 4 }[s];
    $("stepNo").textContent = "0" + n;
    $("stepTag").textContent = { motion: "MOTION", aim: "AIM", fore: "FOREHANDS", back: "BACKHANDS", done: "DONE" }[s];
    document.querySelectorAll<HTMLElement>("#stepHead .dashes i").forEach((d, i) => {
      d.className = i + 1 < n ? "done" : i + 1 === n ? "now" : "";
    });
    const hand = lefty() ? "left" : "right";
    const title = {
      motion: "Aim at the screen.",
      aim: "Aim at the screen.",
      fore: "Swing three forehands.",
      back: "Now three backhands.",
      done: "All set.",
    }[s];
    const text = {
      motion: "First, let the paddle use this phone’s motion sensors. Tap Allow motion, then Allow.",
      aim: "Hold the phone flat like a TV remote, top edge pointing at the screen. Then press and hold the button until the bar fills. This tells the game where the screen is.",
      fore: `Hold the bottom of the phone like a paddle handle in your ${hand} hand, screen facing the TV. Swing across your body, ${lefty() ? "left to right" : "right to left"}, like a normal forehand.`,
      back: `Turn the phone over so its back faces the TV, and swing across from the other side, ${lefty() ? "right to left" : "left to right"}.`,
      done: "Your swings are saved on this phone.",
    }[s];
    $("stepTitle").textContent = title;
    $("stepText").textContent = text;
    $("diagram").innerHTML = s === "fore" ? swingDiagram(true) : s === "back" ? swingDiagram(false) : aimDiagram();
    $("diagram").classList.toggle("hidden", s === "done");
    $("diagramCap").textContent =
      s === "fore"
        ? `FOREHAND SEEN FROM ABOVE, ${hand.toUpperCase()} HAND`
        : s === "back"
          ? `BACKHAND SEEN FROM ABOVE, ${hand.toUpperCase()} HAND`
          : s === "done"
            ? ""
            : "TOP EDGE TO THE SCREEN, SCREEN FACING UP";
    $("enable").classList.toggle("hidden", s !== "motion");
    $("redoSetup").classList.toggle("hidden", !(s === "motion" && welcome && !!prof));
    $("hold").classList.toggle("hidden", s !== "aim");
    $("gauge").classList.toggle("hidden", s !== "fore" && s !== "back");
    $("swingBtns").classList.toggle("hidden", s !== "fore" && s !== "back");
    $("nextLabel").textContent = s === "back" ? "FINISH" : "NEXT";
    $("diagram").classList.toggle("short", s === "fore" || s === "back");
    if (s === "fore" || s === "back") ruler();
    swingStatus();
  };
  const swingStatus = (note = "") => {
    const list = step === "back" ? swingsBack : swingsFore;
    document.querySelectorAll<HTMLElement>("#gDashes i").forEach((d, i) => {
      d.className = i < list.length ? "done" : "";
    });
    $("gText").textContent =
      note ||
      (list.length >= 3
        ? `THREE ${step === "back" ? "BACKHANDS" : "FOREHANDS"} ✓ · TAP ${step === "back" ? "FINISH" : "NEXT"}`
        : list.length
          ? `SWING ${list.length} OF 3 ✓ · ${list[list.length - 1].rad.toFixed(1)} RAD/S`
          : "WAITING FOR A SWING");
    $<HTMLButtonElement>("next").disabled = list.length < 3;
    $<HTMLButtonElement>("redoLast").disabled = !list.length;
    const last = list[list.length - 1];
    const lit = last ? Math.round((Math.min(30, last.rad) / 30) * 20) : 0;
    segs($("gSegs"), 20);
    $("gSegs")
      .querySelectorAll("i")
      .forEach((x, i) => x.classList.toggle("on", i < lit));
  };
  /** A setup swing finished (called from the send loop with the swing's peak). */
  const setupSwing = (sw: SetupSwing) => {
    if (step !== "fore" && step !== "back") return;
    const list = step === "fore" ? swingsFore : swingsBack;
    if (list.length >= 3) return;
    list.push(sw);
    const want = step === "fore" ? 1 : -1;
    swingStatus(
      sw.face === -want
        ? step === "fore"
          ? "COUNTED · BUT THE BACK FACED THE TV"
          : "COUNTED · BUT THE SCREEN FACED THE TV"
        : "",
    );
    navigator.vibrate?.(30);
  };
  // Setup vs in-game screens: once Ready, the setup disappears so nothing gets changed.
  const showGame = (on: boolean) => {
    $("setup").classList.toggle("hidden", on);
    $("ingame").classList.toggle("hidden", !on);
  };
  const goReady = async () => {
    showStep("done");
    ready = true;
    readyAt = performance.now();
    showGame(true);
    await net.api("ready", { ready: true }).catch(error);
  };
  let serverReady = false,
    readyAt = -1e9;
  let wake: any = null;
  const screenAngle = () =>
    screen.orientation?.angle ?? Number((window as any).orientation || 0);
  function orientation(e: DeviceOrientationEvent) {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    orientationAt = performance.now();
    const angle = screenAngle();
    if (angle !== lastOrientation) lastOrientation = angle;
    filter.orientation(e.alpha, e.beta, e.gamma, angle);
  }
  let setupQuietUntil = 0;
  let swingRad = 0,
    swingPathPeak = { side: 0, up: 0 },
    swingFace = 1;
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
    const rad = (Math.hypot(r.alpha, r.beta, r.gamma) * Math.PI) / 180;
    gaugeRad = Math.max(rad, gaugeRad * 0.92);
    if (swing && pendingSwing && (step === "fore" || step === "back")) {
      // Still inside one setup swing (backswing → forward swing): keep collecting its peak.
    } else if (swing && performance.now() < setupQuietUntil) {
      // Follow-through of a swing that was just counted.
    } else if (swing) {
      pendingSwing = true;
      swingDue = motionAt + (step === "fore" || step === "back" ? 350 : 65);
      swingPeak = filter.strength;
      swingDirection = filter.direction;
      swingSide = filter.side;
      swingRad = rad;
      swingPathPeak = { side: filter.path.side, up: filter.path.up };
      swingFace = filter.face;
      filter.peakVec = [...filter.rate];
    }
    if (pendingSwing) {
      if (rad > swingRad) {
        swingRad = rad;
        swingPathPeak = { side: filter.path.side, up: filter.path.up };
        swingFace = filter.face;
      }
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
    document.body.classList.toggle("lefty", filter.hand < 0);
    localStorage.setItem("visual-controller-" + net.room, net.credential);
    $("join").classList.add("hidden");
    $("controls").classList.remove("hidden");
    await net.clock();
    net.stream();
    // A saved setup: "WELCOME BACK" — Allow motion, aim, and you're in.
    welcome = !!savedProfile();
    rejoining = !!r.player.ready;
    if (!enabled) showStep("motion");
    else if (!filter.fwd) showStep("aim");
    else if (rejoining) goReady();
  }
  let rejoining = false;
  action("connect", () => claim());
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
  // 01 · Allow motion. Permission calls must occur directly in the click gesture.
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
      if ("wakeLock" in navigator)
        try {
          wake = await (navigator as any).wakeLock.request("screen");
        } catch {}
      showStep("aim");
    } catch (e) {
      error(e);
    }
  };
  action("redoSetup", () => {
    redoRequested = true;
    welcome = false;
    $("enable").click();
  });
  // 02 · Aim: press and hold while the phone lies flat and still; the bar fills over ~1.2 s.
  const HOLD_MS = 800;
  let holdStart = 0,
    holdTimer: ReturnType<typeof setInterval> | undefined;
  const holdSegs = $("holdSegs");
  segs(holdSegs, 20);
  const holdReset = (hint = "PRESS AND HOLD") => {
    clearInterval(holdTimer);
    holdTimer = undefined;
    holdStart = 0;
    holdSegs.querySelectorAll("i").forEach((x) => x.classList.remove("on"));
    $("holdHint").textContent = hint;
    $("hold").classList.remove("holding");
  };
  $("hold").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!sensorLive()) {
      holdReset("WAITING FOR SENSORS");
      return;
    }
    holdStart = performance.now();
    $("hold").classList.add("holding");
    $("holdHint").textContent = "HOLD STILL…";
    clearInterval(holdTimer);
    holdTimer = setInterval(() => {
      const { alpha, beta, gamma } = filter.abs;
      const flat = aimFrom(alpha, beta, gamma) && Math.abs(beta) < 60 && Math.abs(gamma) < 60;
      const still = Math.hypot(...filter.rate) < 150;
      if (!flat || !still) {
        // A wobble slows the bar down a little instead of starting over.
        holdStart = Math.min(performance.now(), holdStart + 80);
        $("holdHint").textContent = !flat ? "HOLD IT FLAT, SCREEN UP" : "HOLD STILL…";
      } else $("holdHint").textContent = "HOLD STILL…";
      const k = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
      const lit = Math.round(k * 20);
      holdSegs.querySelectorAll("i").forEach((x, i) => x.classList.toggle("on", i < lit));
      if (k >= 1) {
        holdReset("SET ✓");
        if (!filter.aim()) {
          holdReset("HOLD IT FLAT, SCREEN UP");
          return;
        }
        navigator.vibrate?.(40);
        const prof = savedProfile();
        if (prof && !redoRequested) {
          applyProfile(prof);
          goReady();
        } else {
          swingsFore.length = 0;
          swingsBack.length = 0;
          showStep("fore");
        }
      }
    }, 40);
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"])
    $("hold").addEventListener(ev, () => {
      if (holdStart) holdReset();
    });
  // 03 / 04 · swings
  action("redoLast", () => {
    (step === "back" ? swingsBack : swingsFore).pop();
    swingStatus();
  });
  action("next", async () => {
    if (step === "fore") return showStep("back");
    const r = learnSwings(swingsFore, swingsBack, lefty() ? "left" : "right");
    if (!r.ok) {
      if (r.redo !== "back") swingsFore.length = 0;
      if (r.redo !== "fore") swingsBack.length = 0;
      showStep(r.redo === "back" ? "back" : "fore");
      swingStatus(r.reason.toUpperCase());
      return;
    }
    applyProfile(r.profile);
    saveProfile(r.profile);
    redoRequested = false;
    welcome = true;
    await goReady();
  });
  // In-game: re-aim (the TV direction) or redo the whole setup. Two taps, so a stray touch
  // mid-game can't wipe the settings.
  let redoArmed = 0,
    reaimArmed = 0;
  action("redo", async () => {
    if (performance.now() - redoArmed > 3000) {
      redoArmed = performance.now();
      $("redo").textContent = "Tap again to set up your swings again";
      return;
    }
    $("redo").textContent = "Set up my swings again";
    await net.api("ready", { ready: false }).catch(() => {});
    ready = false;
    redoRequested = true;
    welcome = false;
    showGame(false);
    showStep("aim");
  });
  action("reaim", async () => {
    if (performance.now() - reaimArmed > 3000) {
      reaimArmed = performance.now();
      $("reaim").textContent = "Tap again to aim at the screen again";
      return;
    }
    $("reaim").textContent = "Aim at the screen again";
    await net.api("ready", { ready: false }).catch(() => {});
    ready = false;
    redoRequested = false;
    welcome = true;
    showGame(false);
    showStep("aim");
  });
  $("sidePick").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-side]");
    if (b) net.api("side", { side: b.dataset.side }).catch(() => {});
  });
  action("phonePause", () => net.api(current?.paused ? "resume" : "pause", {}));
  $<HTMLInputElement>("sensitivity").oninput = () => {
    filter.sensitivity = Number($<HTMLInputElement>("sensitivity").value);
    const p = savedProfile();
    if (p) saveProfile({ ...p, sensitivity: filter.sensitivity });
  };
  // The room is gone (server restarted/redeployed, or expired): stop, and say what to do.
  net.onGone = () => {
    localStorage.removeItem("visual-controller-" + net.room);
    connState = "ROOM ENDED";
    ui("connection").text = connState;
    $("pDot").className = "dot";
    $("error").textContent =
      "This room has ended (the server restarted or the room expired). Scan the new code on the big screen.";
  };
  // Header: PADDLE · P1 · ● LIVE · 15 MS. Connection trouble only changes this small status;
  // it never covers the setup.
  let connState = "";
  net.onStatus = (s) => {
    connState = /Connected/.test(s) ? "LIVE" : /Reconnect/.test(s) ? "RECONNECTING" : "CONNECTING";
    ui("connection").text = connState;
    $("pDot").className = "dot " + (connState === "LIVE" ? "live" : "wait");
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
  let timingSeen = -1,
    timingUntil = 0,
    timingKind: "perfect" | "good" | "early" | "late" = "good",
    timingText = "";
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
    const wasReady = serverReady;
    serverReady = p?.ready || false;
    if (serverReady) ready = true;
    // Only a ready → not-ready change the server itself reports (and not in the moment
    // right after we said Ready, before the server has caught up) sends you back to aiming.
    if (wasReady && !serverReady && step === "done" && performance.now() - readyAt > 3000) {
      ready = false;
      // Back to aiming: one press-and-hold and you're in again (swings are kept).
      showGame(false);
      welcome = true;
      showStep(filter.fwd ? "aim" : "motion");
    }
    if (p)
      ui("igTitle").text =
        p.name + (state.ranked && p.rr ? " · " + p.rr + " RR" : " · Ready ✓");
    ui("phonePause").text = state.paused ? "Resume" : "Pause";
    // Two players on one screen (split screen): pick the left or right half.
    if (p) {
      const screen = p.display || "host";
      let mates = state.players.filter(
        (q) => !q.bot && (q.display || "host") === screen,
      );
      if (state.swapped?.includes(screen)) mates = mates.reverse();
      const pick = $("sidePick");
      pick.classList.toggle("hidden", mates.length !== 2);
      const mySide = mates[0]?.id === p.id ? "left" : "right";
      for (const b of Array.from(
        pick.querySelectorAll<HTMLElement>("[data-side]"),
      ))
        b.classList.toggle("on", b.dataset.side === mySide);
    }
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
    // Timing of my own last swing: green good/great, red early/late (with a short buzz).
    const tm = state.timing;
    if (tm && tm.by === playerId && tm.at !== timingSeen) {
      timingSeen = tm.at;
      timingUntil = Date.now() + 1300;
      timingKind = tm.kind;
      timingText =
        (tm.kind === "perfect"
          ? "✓ Perfect "
          : tm.kind === "good"
            ? "✓ Good "
            : tm.kind === "early"
              ? "✗ Early "
              : "✗ Late ") +
        tm.stroke +
        " · " +
        tm.kmh +
        " km/h";
      if (tm.kind === "early" || tm.kind === "late") navigator.vibrate?.(140);
    }
    const showTiming = Date.now() < timingUntil;
    if (showTiming)
      ui("matchStatus").text = timingText;
    $("matchStatus").classList.toggle(
      "good",
      showTiming && (timingKind === "perfect" || timingKind === "good"),
    );
    $("matchStatus").classList.toggle(
      "bad",
      showTiming && (timingKind === "early" || timingKind === "late"),
    );
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
    ui("pLat").text = net.credential && connState === "LIVE" ? " · " + net.latency + " MS" : "";
    if (current && playerId) {
      const n = current.players.filter((p) => !p.bot).findIndex((p) => p.id === playerId);
      if (n >= 0) ui("pSlot").text = "P" + (n + 1);
    }
    // Live swing speed gauge (setup steps 03–04).
    if (step === "fore" || step === "back") {
      ui("gValue").text = gaugeRad.toFixed(1);
      const nd = document.getElementById("gNeedle");
      if (nd) nd.setAttribute("transform", `translate(${(10 + (Math.min(30, gaugeRad) / 30) * 280).toFixed(1)} 0)`);
    }
    if (enabled && !live && performance.now() - enabledAt > 5000)
      $("error").textContent =
        "No live sensor data. Check browser motion permissions. If your device has no supported sensors, use another phone.";
    else if (live && /sensor data/.test($("error").textContent || ""))
      $("error").textContent = "";
  }, 100);
  setInterval(async () => {
    // Up to two packets in flight hides tunnel/cellular round trips; the server drops any
    // that arrive out of order, and each swing rides in three packets so one late packet
    // cannot lose it (the server applies each swing id once).
    if (!net.credential || net.gone || inflight >= 2 || document.hidden) return;
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
      if (step === "fore" || step === "back") setupQuietUntil = performance.now() + 350;
      setupSwing({ side: swingPathPeak.side, up: swingPathPeak.up, rad: swingRad, face: swingFace });
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
      face: filter.fwd ? filter.face : undefined,
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
      // Small status only: setup and controls stay usable while it reconnects.
      connState = "RECONNECTING";
      ui("connection").text = connState;
      $("pDot").className = "dot wait";
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
