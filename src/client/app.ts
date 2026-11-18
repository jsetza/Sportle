import { Connection } from "./net.ts";
import { MotionFilter, wrap } from "../shared/motion.ts";
import { slots } from "../shared/types.ts";
import type { Match, Input } from "../shared/types.ts";
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
    <div class="group"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg><div><b>On this screen</b><small>Everyone plays here, phones as paddles</small></div></div>
    <div class="list">
      ${item("here", "practice", "Motion lab", "Calibrate · practice", true)}
      ${item("here", "solo", "Solo", "vs the computer")}
      ${item("here", "singles", "Two players", "1 v 1 · 2 phones")}
      ${item("here", "coop", "Team up", "2 phones vs 2 bots")}
      ${item("here", "doubles", "Doubles", "2 v 2 · 4 phones")}
    </div>
    <div class="group"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg><div><b>Online</b><small>Each household opens its own screen</small></div></div>
    <div class="list">
      ${item("online", "singles", "Play a friend", "1 v 1 · share the code")}
      ${item("online", "doubles", "Online 2 v 2", "2 phones each side")}
      <details id="joinBox"><summary class="item"><span class="ball"></span><b>Join a game</b><small>Enter a code</small></summary><div class="joinrow"><input id="displayCode" maxlength="6" placeholder="ROOM CODE" autocomplete="off" aria-label="Room code"><button id="joinDisplay">Join</button></div></details>
    </div>
    <div class="difficulty" id="difficultyRow" role="radiogroup" aria-label="Bot level"><span>Bot level</span>${["easy", "medium", "hard"].map((d, i) => `<input type="radio" name="difficulty" id="d-${d}" value="${d}" ${i === 0 ? "checked" : ""}><label for="d-${d}">${d[0].toUpperCase() + d.slice(1)}</label>`).join("")}</div>
    <button class="cta" id="create">Create game <span>→</span></button>
    <p class="fine" id="modeNote">No app to install. Scan, calibrate, swing.</p>
  </div>
  <div id="lobby" class="hidden">
    <div class="eyebrow" id="connection">Connecting</div>
    <div id="pairing" class="pairing"><div class="qrtile"><canvas id="qr" class="qr"></canvas></div><div><small>Room code</small><div class="roomcode" id="roomcode"></div><p class="fine" id="pairHint">Scan with your phone camera.</p><div id="teamPick" class="hidden"><label for="pairTeam">Phones paired here join</label><select id="pairTeam"><option value="">Any open team</option><option value="0">Team blue</option><option value="1">Team red</option></select></div><button class="link" id="refreshPair">Refresh pairing link</button></div></div>
    <div class="difficulty viewpick" role="radiogroup" aria-label="Camera"><span>Camera · <kbd>V</kbd></span>${(["third", "first", "broadcast"] as const).map((v) => `<input type="radio" name="view" id="v-${v}" value="${v}"><label for="v-${v}">${{ third: "3rd person", first: "1st person", broadcast: "Broadcast" }[v]}</label>`).join("")}</div>
    <div id="players"></div>
    <div class="telemetry" id="telemetry"></div>
    <button id="start" class="cta">Start practice <span>→</span></button>
    <div class="row"><button id="pause" class="ghost">Pause</button><button id="resume" class="ghost">Resume</button></div>
    <p class="fine">Move with <kbd>WASD</kbd> (player 1) and the <kbd>arrow keys</kbd> (player 2), or let characters position themselves. Compact phone swings control timing, angle and power. Serves are assisted.</p>
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
<dialog id="howto"><h2>How to play</h2><ol><li><b>Create a game</b> on this screen. A QR code and room code appear.</li><li><b>Scan the QR</b> with your phone camera, choose your hand and nickname.</li><li><b>Enable motion</b>, hold the phone like a paddle and set your neutral position.</li><li>Make one <b>gentle</b> swing and one <b>slightly quicker</b> swing to calibrate. Then tap Ready.</li><li><b>Move with the keyboard</b> on this screen: <kbd>W A S D</kbd> moves player 1, the <kbd>arrow keys</kbd> move player 2. Until you press a key, your character positions itself. Stay out of the kitchen when volleying!</li><li><b>Time compact swings</b> as the ball reaches you: tilt to aim, swing up for topspin, open the face and lift for a lob, swing down on a high ball to smash, swing softly to dink.</li></ol><p class="fine">Serves are assisted. Phone sensors estimate swing intent, not exact paddle position.</p><button class="cta" id="howtoClose">Got it</button></dialog>`;
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
  const syncMode = () => {
    const sel = document.querySelector<HTMLInputElement>(
      "input[name=mode]:checked",
    )!;
    const bots = sel.value === "solo" || sel.value === "coop";
    $("difficultyRow").classList.toggle("hidden", !bots);
    $("modeNote").textContent =
      modeNotes[sel.dataset.group + "-" + sel.value] || "";
    ($("joinBox") as HTMLDetailsElement).open = false;
  };
  document
    .querySelectorAll<HTMLInputElement>("input[name=mode]")
    .forEach((r) => r.addEventListener("change", syncMode));
  syncMode();
  document.addEventListener("keydown", (e) => {
    // TV-remote / keyboard friendly menu: arrows move, Enter creates.
    if (
      $("setup").classList.contains("hidden") ||
      ((e.target as HTMLElement).tagName === "INPUT" &&
        (e.target as HTMLInputElement).type !== "radio")
    )
      return;
    const radios = Array.from(
      document.querySelectorAll<HTMLInputElement>("input[name=mode]"),
    );
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
  action("sound", () => {
    $("sound").textContent = scene.sound() ? "Sound on" : "Sound off";
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
    current = state;
    scene.update(state);
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
      state.mode === "practice"
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
              : state.phase.toUpperCase());
    const choice = state.mode === "singles" || state.mode === "doubles";
    $("teamPick").classList.toggle(
      "hidden",
      !choice || state.phase !== "lobby",
    );
    ui("players").html = Array.from({ length: slots(state.mode) }, (_, i) => {
      const p = state.players.filter((p) => !p.bot)[i];
      const swap =
        p && host && choice && state.phase === "lobby"
          ? `<button class="swap" data-team="${p.id}:${1 - p.team}">→ ${p.team ? "Blue" : "Red"}</button>`
          : "";
      return `<div class="player team${p ? p.team : ""}"><span>${p ? escape(p.name) : "Waiting for player " + (i + 1)}<br><small>${p ? (p.team ? "Red" : "Blue") + " · " + p.hand + " handed" : "Scan to claim this slot"}</small></span>${swap}<span class="status">${p ? (p.connected ? (p.ready ? "Ready ✓" : "Calibrate") : "Offline") : "○"}</span></div>`;
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
      const flip =
        scene.viewMode !== "broadcast" &&
        current &&
        localPlayers(current)[0]?.team === 1;
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
      state.phase === "rally" || state.phase === "serve" ? 1 : 0;
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
    $("again").classList.toggle("hidden", !host);
    $("goWait").textContent = host
      ? "Same players, same mode, fresh score."
      : "Waiting for the host to start a rematch…";
  };
  action("again", () => net.api("rematch", {}));
  $("goMenu").onclick = () => {
    sessionStorage.removeItem("visual-host");
    location.reload();
  };
  const keyHints = (state: Match) => {
    const follow = localPlayers(state)[0];
    scene.follow = follow ? follow.id : null;
    const local = localPlayers(state);
    const keyed = local.filter((p) => p.moveStyle === "keys").slice(0, 2);
    ui("keys").html = local
      .map((p) => {
        const slot = keyed.indexOf(p);
        const how =
          p.moveStyle === "phone"
            ? "<kbd>📱 pad</kbd>"
            : p.moveStyle === "auto" || slot < 0
              ? "<kbd>AUTO</kbd>"
              : `<kbd>${slot ? "← ↑ ↓ →" : "W A S D"}</kbd>`;
        const note =
          p.moveStyle !== "auto" && slot !== -1 && !p.manual
            ? " · auto until you move"
            : p.moveStyle === "phone" && !p.manual
              ? " · auto until you use the pad"
              : "";
        return `<span class="team${p.team}">${how}${escape(p.name)}${note}</span>`;
      })
      .join("");
  };
  action("create", async () => {
    const mode = document.querySelector<HTMLInputElement>(
      "input[name=mode]:checked",
    )!.value;
    const r = await net.api("create", {
      mode,
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
  app.innerHTML = `<div class="phone"><div class="row"><div class="logo"><b>POV</b>pickle</div><span class="pill" id="connection">Not connected</span></div><h1>A paddle.<br>In your pocket.</h1><p>The screen is the paddle face, the back of the phone is the back of the paddle. Small, comfortable swings work best.</p><div id="join" class="card"><div class="number">01 / CLAIM YOUR SPOT</div><label for="code">Room code</label><input id="code" maxlength="6" autocomplete="off" placeholder="ABC123"><label for="nickname">Your nickname</label><input id="nickname" maxlength="20" placeholder="Player"><label for="hand">Paddle hand</label><select id="hand"><option value="right">Right hand</option><option value="left">Left hand</option></select><button class="full" id="connect">Connect to court</button></div><div id="controls" class="hidden"><div class="card"><div class="number" id="stage">02 / ENABLE MOTION</div><h2 id="instruction">Let’s find your feel.</h2><p id="guidance">Allow motion sensors. Hold the phone like a paddle: <b>screen facing forward</b> (that's the paddle face), the back of the phone toward you.</p><button class="full" id="enable">Enable motion controls</button><button class="full secondary" id="calibrate" disabled>Set neutral position</button><div class="controller-graphic" id="paddle"></div><div class="meter"><div id="strength"></div></div><p class="fine" id="swingHint">Gentle motion. No full-force swings needed.</p><label class="swap"><input type="checkbox" id="swapSides"> Swap left / right <small>Set automatically when you calibrate. Flip it if a swing to your right still shows ←</small></label><label for="sensitivity">Comfortable sensitivity</label><input id="sensitivity" type="range" min="0.5" max="2" step="0.1" value="1"><div class="movepick" role="radiogroup" aria-label="How you move"><span>How you move</span><input type="radio" name="ctl" id="ctl-2" value="2" checked><label for="ctl-2">Phone<small>thumb pad</small></label><input type="radio" name="ctl" id="ctl-1" value="1"><label for="ctl-1">Keyboard<small>WASD / arrows</small></label><input type="radio" name="ctl" id="ctl-0" value="0"><label for="ctl-0">Auto<small>moves for you</small></label></div><div id="pad" class="pad hidden" aria-label="Movement thumb pad"><div class="padring"><div id="knob" class="knob"></div></div><p class="fine">Thumb up = run to the net · down = back · sideways = slide</p></div><div class="telemetry"><span>Sensor availability<strong id="sensorStatus">Not enabled</strong></span><span>Connection RTT<strong id="latency">—</strong></span><span>Pitch / roll<strong id="angles">—</strong></span><span>Swing direction<strong id="direction">Neutral</strong></span></div><button class="full" id="ready" disabled>Ready to play</button><div class="row"><button class="full secondary" id="phonePause">Pause</button><button class="full secondary" id="reconnect">Reconnect</button></div><p class="fine" id="matchStatus">Your display will start the game.</p></div></div><div id="error" role="alert"></div><p class="screen-note">Keep this page visible during play.<br>Sensor motion estimates intent, not physical position.</p></div>`;
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
    calibrationStep = 0,
    gentle = 0,
    peak = 0,
    lastOrientation = screen.orientation?.angle || 0;
  let swingDue = 0,
    swingPeak = 0,
    swingDirection = 0,
    swingSide = 0;
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
      swingSide = filter.side;
    }
    if (pendingSwing) {
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
      ui("sensorStatus").text = "Waiting for samples";
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
    $("stage").textContent = "02 / CALIBRATE";
  });
  action("ready", async () => {
    await net.api("ready", { ready: !ready });
    ready = !ready;
  });
  action("phonePause", () => net.api("pause", {}));
  // Left/right orientation: learned in calibration ("swing to your right"), kept per phone,
  // and still adjustable by hand with the Swap switch.
  const setFlip = (f: number) => {
    filter.flip = f;
    $<HTMLInputElement>("swapSides").checked = f === -1;
    try {
      localStorage.setItem("pov-side", String(f));
    } catch {
      /* ignore */
    }
  };
  try {
    if (localStorage.getItem("pov-side") === "-1") setFlip(-1);
  } catch {
    /* default orientation */
  }
  $<HTMLInputElement>("swapSides").onchange = () =>
    setFlip($<HTMLInputElement>("swapSides").checked ? -1 : 1);
  $<HTMLInputElement>("sensitivity").oninput = () => {
    filter.sensitivity = Number($<HTMLInputElement>("sensitivity").value);
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
    knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
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
    current = state;
    const p = state.players.find((p) => p.id === playerId);
    ready = p?.ready || false;
    $("ready").textContent = ready
      ? "Ready ✓ · tap to unready"
      : "Ready to play";
    ui("matchStatus").text =
      state.phase === "over"
        ? "Game over · " + state.message + " The host can tap Play again."
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
    const inPlay = state.phase === "serve" || state.phase === "rally";
    $("pad").classList.toggle("hidden", !(inPlay && moveStyle() === 2));
  };
  setInterval(() => {
    const live = sensorLive();
    $<HTMLButtonElement>("calibrate").disabled = !live;
    $<HTMLButtonElement>("ready").disabled = !live || calibrationStep !== 4;
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
        $("instruction").textContent = "Now swing to your RIGHT →";
        $("guidance").textContent =
          "One easy sideways swing toward your right side. This teaches the game which way is right on your phone.";
      } else if (calibrationStep === 3) {
        // Learn left/right for this phone and grip from a swing the player calls "right".
        if (Math.abs(swingSide) < 0.12) {
          $("guidance").textContent =
            "Couldn't tell the direction. Swing a bit more sideways, toward your right.";
        } else {
          if (swingSide < 0) setFlip(filter.flip * -1);
          swingSide = Math.abs(swingSide);
          calibrationStep = 4;
          $("instruction").textContent = "You're set!";
          $("guidance").textContent =
            "Left and right learned. Adjust sensitivity if needed, then tap Ready.";
          $("stage").textContent = "03 / READY TO RALLY";
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
