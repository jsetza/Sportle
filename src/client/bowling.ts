/**
 * Sportle Bowling: the TV page (/bowling) and the phone controller (/bowling/phone).
 * Same transport as pickleball (authenticated HTTP input + SSE snapshots, reconnect),
 * same pairing QR, same phone setup style. All rules, physics and turns run on the server.
 */
import { Connection } from "./net.ts";
import { MotionFilter, paddlePose, sampleOf, wrap, aimFrom } from "../shared/motion.ts";
import {
  BOT_NAMES,
  BOWL_BACK,
  BOWL_TRIGGER,
  BowlReader,
  DEFAULT_BOWL_PROFILE,
  LANES,
  WAIT_LIMIT,
  curveFrom,
  curveLabel,
  framePos,
  learnBowls,
  readHeld,
  HELD_AFTER,
  scoreSheet,
  LANE,
} from "../shared/bowling.ts";
import type { HeldSample } from "../shared/bowling.ts";
import type { Bowl, BowlProfile, Bowler, LaneId, Release } from "../shared/bowling.ts";
import { OUTFITS, PADDLES, cleanGear } from "../shared/types.ts";
import type { Input } from "../shared/types.ts";
import { BowlScene, BOWL_VIEW_LABELS } from "./bowlscene.ts";
import type { BowlView } from "./bowlscene.ts";
import { drawQR } from "./qr.ts";
import { Music, MUSIC_STYLES } from "./music.ts";
import type { MusicStyle } from "./music.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const lastWrite = new Map<string, string>();
/** Only touch the DOM when a value changed (snapshots arrive ~30×/s). */
const put = (id: string, html: string) => {
  if (lastWrite.get(id) === html) return;
  lastWrite.set(id, html);
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
};
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const net = new Connection();
const params = new URLSearchParams(location.search),
  hash = new URLSearchParams(location.hash.slice(1));
function error(e: unknown) {
  const el = document.getElementById("error");
  if (el) el.textContent = e instanceof Error ? e.message : String(e);
}
const ordinal = (n: number) => n + (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
/**
 * Phone lane preview: the predicted path (dotted, from the server) and, once bowled, where the
 * ball really went (solid). Flat x,d pairs in metres; the lane is drawn foul line at the bottom.
 */
export function laneSvg(aim: number[] = [], trail: number[] = [], board = 0) {
  const W = 60,
    H = 200,
    top = 16,
    bot = 192;
  const X = (x: number) => (W / 2 + (x / LANE.half) * 20).toFixed(1);
  const Y = (d: number) => (bot - (Math.min(d, LANE.length + 0.6) / (LANE.length + 0.6)) * (bot - top)).toFixed(1);
  const pts = (a: number[]) => {
    const out: string[] = [];
    for (let i = 0; i + 1 < a.length; i += 2) out.push(X(a[i]) + "," + Y(a[i + 1]));
    return out.join(" ");
  };
  let pins = "";
  for (let k = 0; k < 4; k++)
    for (let j = 0; j <= k; j++) pins += `<circle cx="${(W / 2 + (j - k / 2) * 5).toFixed(1)}" cy="${(top + 9 - k * 4).toFixed(1)}" r="1.6" class="ppin"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="lanesvg" aria-hidden="true"><rect x="6" y="4" width="${W - 12}" height="${H - 8}" rx="3" class="pgutter"/><rect x="10" y="4" width="${W - 20}" height="${H - 8}" class="plane2"/>${pins}${aim.length > 3 ? `<polyline points="${pts(aim)}" class="paim"/>` : ""}${trail.length > 3 ? `<polyline points="${pts(trail)}" class="ptrail"/>` : ""}<circle cx="${X((trail.length ? trail[0] : board * 0.4))}" cy="${Y(0)}" r="3.4" class="pball"/></svg>`;
}
/** Small arc that bends with the curve (-1..1): a lane line from the bottom to the pins. */
export function curveSvg(c: number) {
  const bend = c * 34;
  return `<svg viewBox="0 0 80 100" class="curvesvg" aria-hidden="true"><rect x="22" y="4" width="36" height="92" rx="4" class="clane"/><path d="M40 92 C 40 60, ${40 + bend * 0.15} 40, ${40 + bend} 12" class="cpath"/><circle cx="${40 + bend}" cy="12" r="5" class="cball"/></svg>`;
}
const curveHtml = (c: number) =>
  `${curveSvg(c)}<b>${curveLabel(c)}</b>${Math.abs(c) >= 0.12 ? `<small>${c < 0 ? "← LEFT" : "RIGHT →"}</small>` : ""}`;
/** Running score: finished frames plus handicap. */
const scoreOf = (p: Bowler) => scoreSheet(p.rolls).total + p.handicap;

if (location.pathname === "/bowling/phone") phone();
else tv();

// ——————————————————————————— TV ———————————————————————————
function tv() {
  app.innerHTML = `<canvas id="court" aria-label="3D bowling lane"></canvas>
<header class="topbar"><span id="joinAt">Phones join at this screen’s link</span><nav><a class="link" href="/" id="allGames">All games</a><button class="link" id="music">Music: House</button><button class="link" id="view" title="Change camera (V)">View: Ball cam</button><button class="link" id="sound">Sound on</button><button class="link" id="howtoOpen">How to bowl</button><button class="link" id="fullscreen">Fullscreen</button></nav></header>
<aside class="panel" id="panel">
  <div class="wordmark" aria-label="Sportle"><span><b>SPORT</b>LE</span><i></i></div>
  <p class="tagline">Bowling. <b>Your phone is the ball.</b></p>
  <div id="setup">
    <div class="step" id="stepPlayers">
      <a class="link back" href="/">← All games</a>
      <h2 class="stephead">Who's bowling?</h2>
      <button class="choice" id="goSingle"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg><span><b>Single player</b><small>You vs the pins · optional bot</small></span><i>→</i></button>
      <button class="choice" id="goMulti"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3.4"/><circle cx="16.5" cy="8.5" r="3"/><path d="M2 21c1-3.6 3.4-5.4 6-5.4s5 1.8 6 5.4M14 15.8c2.6-.4 5.6 1 7 5.2"/></svg><span><b>Multiplayer</b><small>Up to 6 phones · one QR · take turns</small></span><i>→</i></button>
    </div>
    <div class="step hidden" id="stepOptions">
      <button class="link back" id="backPlayers">← Single / Multiplayer</button>
      <h2 class="stephead" id="optHead">Single player</h2>
      <div class="difficulty" id="modeRow" role="radiogroup" aria-label="Game"><span>Game</span><input type="radio" name="bmode" id="bm-game" value="game" checked><label for="bm-game">10 frames</label><input type="radio" name="bmode" id="bm-practice" value="practice"><label for="bm-practice">Practice</label></div>
      <div class="difficulty" role="radiogroup" aria-label="Bot opponent"><span>Bot</span>${(["", "easy", "medium", "hard"] as const).map((b, i) => `<input type="radio" name="bbot" id="bb-${b || "none"}" value="${b}" ${i === 0 ? "checked" : ""}><label for="bb-${b || "none"}">${b ? BOT_NAMES[b] : "None"}</label>`).join("")}</div>
      <div class="difficulty mappick" role="radiogroup" aria-label="Lane"><span>Lane</span>${LANES.map((l, i) => `<input type="radio" name="blane" id="bl-${l.id}" value="${l.id}" ${i === 0 ? "checked" : ""}><label for="bl-${l.id}">${l.name}</label>`).join("")}</div>
      <p class="fine" id="laneHint"></p>
      <button class="cta" id="create">Create game <span>→</span></button>
      <p class="fine">No app to install. Scan, aim, bowl underhand.</p>
    </div>
  </div>
  <div id="lobby" class="hidden">
    <div class="eyebrow" id="connection">Connecting</div>
    <div id="pairing" class="pairing"><div class="qrtile"><canvas id="qr" class="qr"></canvas></div><div><small>Room code</small><div class="roomcode" id="roomcode"></div><p class="fine" id="pairHint">Scan with your phone camera.</p><button class="link" id="refreshPair">Refresh pairing link</button></div></div>
    <div class="opts" id="lobbyOpts"><div class="optrow"><span>Late joiners</span><div class="seg" id="hcap"><button data-v="false">Next frame</button><button data-v="true">Handicap</button></div></div><p class="fine" id="hcapHint">Someone who joins mid-game starts at the next frame. Their missed frames count as empty, or, with Handicap, earn the field's average per frame.</p></div>
    <h3 class="bhead">Bowling order <small id="orderHint">Drag to reorder</small></h3>
    <ol id="order" class="border"></ol>
    <div class="bcontrols"><button id="start" class="cta">Start bowling <span>→</span></button><div class="row inplay"><button id="pause" class="ghost">Pause</button><button id="resume" class="ghost">Resume</button></div><div class="row hidden" id="waitBtns"><button id="skip" class="ghost">Skip turn</button><button id="botFor" class="ghost">Let a bot bowl</button></div></div>
    <button id="leave" class="link">← Leave lane</button>
  </div>
  <div id="error" role="alert"></div>
</aside>
<button class="paneltab" id="panelToggle" aria-controls="panel">Room</button>
<div class="bsheet" id="sheet" aria-live="polite"></div>
<div class="bturn hidden" id="turn" aria-live="polite"></div>
<div class="bread hidden" id="readout"></div>
<div class="tcall bcall hidden" id="callout" aria-live="assertive"></div>
<div class="message" id="message" aria-live="polite">Pick single player or multiplayer to start.</div>
<div class="gameover hidden" id="gameover" role="dialog" aria-labelledby="goTitle"><small>FINAL</small><h2 id="goTitle">Winner</h2><div class="goscore" id="goScore"></div><p id="goNames"></p><button class="cta" id="again">Bowl again <span>↻</span></button><a class="link" href="/bowling">Change game</a></div>
<dialog id="howto"><h2>How to bowl</h2><ol><li><b>Create a game</b> and scan the QR with each phone. Everyone scans the same code (up to six). Pick a name, your bowling hand and an outfit.</li><li><b>Set up the phone</b>: hold it in your bowling hand, screen facing the TV, upright. Tap, then press and hold to aim. Then two practice bowls: one normal, one a little toward the left. Saved on the phone for next time.</li><li><b>Bowl</b> when your phone says YOUR TURN: press and hold the big button, swing back, and let go as you swing forward underhand. Harder = faster ball. The dotted line on the lane shows where the ball will go; after the bowl, a solid line shows where it went.</li><li><b>Hook</b>: keep the phone upright for a straight ball. Tilt (roll) your wrist one way and the ball hooks that way, late, on the dry back of the lane. The curve indicator on your phone and on the TV shows STRAIGHT / SLIGHT HOOK / BIG HOOK before you bowl.</li><li><b>Move</b>: drag the strip on your phone left or right to choose where you stand.</li></ol><p class="fine">Ball speed shown in km/h and mph is the game's speed, not a measurement of your arm. Phone sensors estimate swing intent; they don't track your hand's exact position.</p><button class="cta" id="howtoClose">Got it</button></dialog>`;
  let scene: BowlScene;
  try {
    scene = new BowlScene($<HTMLCanvasElement>("court"));
  } catch (e) {
    error(e);
    return;
  }
  if (location.hash === "#test") (window as any).__bowlScene = scene;
  let cur: Bowl | null = null;
  let host = false,
    pair = "",
    publicOrigin: string | null = null;
  // ——— Menu ———
  let players: "single" | "multi" = "single";
  const step = (id: string) =>
    document.querySelectorAll(".step").forEach((el) => el.classList.toggle("hidden", el.id !== id));
  const options = (p: "single" | "multi") => {
    players = p;
    $("optHead").textContent = p === "single" ? "Single player" : "Multiplayer";
    step("stepOptions");
  };
  $("goSingle").onclick = () => options("single");
  $("goMulti").onclick = () => options("multi");
  $("backPlayers").onclick = () => step("stepPlayers");
  const lane = () => (document.querySelector<HTMLInputElement>("input[name=blane]:checked")?.value || "neon") as LaneId;
  const syncLane = () => {
    const l = LANES.find((x) => x.id === lane())!;
    $("laneHint").textContent = l.name + " · " + l.note;
    if (!cur) scene.setLane(l.id);
  };
  document.querySelectorAll("input[name=blane]").forEach((r) => r.addEventListener("change", syncLane));
  syncLane();
  $("howtoOpen").onclick = () => $<HTMLDialogElement>("howto").showModal();
  $("howtoClose").onclick = () => $<HTMLDialogElement>("howto").close();
  $("fullscreen").onclick = () =>
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  $("panelToggle").onclick = () => {
    document.body.classList.toggle("panel-open");
    scene.panelOpen = !document.body.classList.contains("playing") || document.body.classList.contains("panel-open");
  };
  // ——— Camera ———
  const VIEWS: BowlView[] = ["follow", "first", "behind", "broadcast"];
  const setView = (v: BowlView) => {
    scene.viewMode2 = v;
    $("view").textContent = "View: " + BOWL_VIEW_LABELS[v];
    try {
      localStorage.setItem("bowl-view", v);
    } catch {
      /* ignore */
    }
  };
  setView(VIEWS.includes(localStorage.getItem("bowl-view") as BowlView) ? (localStorage.getItem("bowl-view") as BowlView) : "follow");
  $("view").onclick = () => setView(VIEWS[(VIEWS.indexOf(scene.viewMode2) + 1) % VIEWS.length]);
  addEventListener("keydown", (e) => {
    if (e.code === "KeyV" && !(e.target instanceof HTMLInputElement)) setView(VIEWS[(VIEWS.indexOf(scene.viewMode2) + 1) % VIEWS.length]);
  });
  // ——— Sound and music (same music styles and files as pickleball) ———
  let soundOn = localStorage.getItem("visual-sound") !== "off";
  scene.muted = !soundOn;
  $("sound").textContent = soundOn ? "Sound on" : "Sound off";
  $("sound").onclick = () => {
    soundOn = scene.sound();
    $("sound").textContent = soundOn ? "Sound on" : "Sound off";
    localStorage.setItem("visual-sound", soundOn ? "on" : "off");
  };
  const music = new Music();
  music.findFiles();
  type Pick = MusicStyle | "off";
  const order: Pick[] = [...MUSIC_STYLES.map((m) => m.id), "off"];
  let choice: Pick = (order as string[]).includes(localStorage.getItem("visual-music") || "")
    ? (localStorage.getItem("visual-music") as Pick)
    : "house";
  let acted = false;
  const syncMusic = () => {
    const name = MUSIC_STYLES.find((m) => m.id === choice)?.name;
    $("music").textContent = name ? "Music: " + name : "Music off";
    if (choice !== "off") music.setStyle(choice);
    if (choice !== "off" && acted) music.start();
    else music.stop();
  };
  syncMusic();
  const first = () => {
    if (acted) return;
    acted = true;
    syncMusic();
    scene.wakeAudio();
  };
  addEventListener("pointerdown", first);
  addEventListener("keydown", first);
  $("music").onclick = () => {
    choice = order[(order.indexOf(choice) + 1) % order.length];
    localStorage.setItem("visual-music", choice);
    acted = true;
    syncMusic();
  };
  fetch("/api/config")
    .then((r) => r.json())
    .then((c) => {
      publicOrigin = c.publicOrigin;
      $("joinAt").textContent = c.publicOrigin ? "Phones join at " + new URL(c.publicOrigin).host : "Desktop preview · phones need the public HTTPS link";
    })
    .catch(() => {});
  // ——— Room ———
  const act = (id: string, fn: () => unknown) =>
    ($(id).onclick = () => {
      error("");
      Promise.resolve().then(fn).catch(error);
    });
  function pairing() {
    $("roomcode").textContent = net.room;
    const qr = $<HTMLCanvasElement>("qr");
    qr.classList.add("hidden");
    if (!pair) return;
    if (publicOrigin) {
      const url = publicOrigin + "/bowling/phone?room=" + net.room + "#pair=" + pair;
      try {
        drawQR(qr, url);
        qr.classList.remove("hidden");
        $("pairHint").textContent = "Everyone scans this one QR (up to 6 phones). Manual code: " + net.room + ".";
      } catch (e) {
        $("pairHint").textContent = String(e);
      }
    } else {
      $("pairHint").textContent =
        "Phone pairing needs HTTPS. Run npm run tunnel (or deploy and set PUBLIC_ORIGIN). Localhost is only a desktop preview.";
      $("pairHint").classList.add("notice");
    }
  }
  function entered() {
    $("setup").classList.add("hidden");
    $("lobby").classList.remove("hidden");
    document.body.classList.add("in-room");
    pairing();
    net.clock().catch(error);
    net.stream();
  }
  act("create", async () => {
    const game = document.querySelector<HTMLInputElement>("input[name=bmode]:checked")!.value;
    const bot = document.querySelector<HTMLInputElement>("input[name=bbot]:checked")!.value;
    const r = await net.api("create", { game: "bowling", mode: game, bot, lane: lane(), players: players === "single" ? "single" : "multi" });
    net.room = r.code;
    net.credential = r.credential;
    host = true;
    pair = r.pair;
    publicOrigin = r.publicOrigin;
    sessionStorage.setItem("bowl-host", JSON.stringify({ room: r.code, credential: r.credential, pair: r.pair }));
    render(r.state);
    entered();
  });
  // A reload of the TV keeps its room.
  try {
    const saved = JSON.parse(sessionStorage.getItem("bowl-host") || "null");
    if (saved?.room && saved.credential) {
      net.room = saved.room;
      net.credential = saved.credential;
      pair = saved.pair;
      host = true;
      entered();
    }
  } catch {
    /* fresh start */
  }
  net.onStatus = (s) => put("connection", esc(s) + " · " + net.room);
  net.onGone = () => {
    sessionStorage.removeItem("bowl-host");
    location.reload();
  };
  net.onState = (s) => {
    if (s.game !== "bowling") return;
    render(s.state as Bowl);
  };
  act("refreshPair", async () => {
    const r = await net.api("pair", {});
    pair = r.pair;
    pairing();
  });
  act("start", () => net.api("start", {}));
  act("again", () => net.api("rematch", {}));
  act("pause", () => net.api("pause", {}));
  act("resume", () => net.api("resume", {}));
  act("skip", () => net.api("bowl/skip", {}));
  act("botFor", () => net.api("bowl/bot", {}));
  act("leave", () => {
    sessionStorage.removeItem("bowl-host");
    net.stop();
    location.href = "/bowling";
  });
  document.querySelectorAll<HTMLButtonElement>("#hcap button").forEach(
    (b) => (b.onclick = () => net.api("bowl/options", { handicap: b.dataset.v === "true" }).catch(error)),
  );
  // Bowling order: drag (mouse/touch) or the ▲ buttons (TV remotes, keyboards).
  let dragId = "";
  const sendOrder = (ids: string[]) => net.api("bowl/order", { ids }).catch(error);
  $("order").addEventListener("dragstart", (e) => {
    dragId = (e.target as HTMLElement).closest<HTMLElement>("li")?.dataset.id || "";
  });
  $("order").addEventListener("dragover", (e) => e.preventDefault());
  $("order").addEventListener("drop", (e) => {
    e.preventDefault();
    const target = (e.target as HTMLElement).closest<HTMLElement>("li")?.dataset.id;
    if (!cur || !dragId || !target || target === dragId) return;
    const ids = cur.players.map((p) => p.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(target), 0, dragId);
    sendOrder(ids);
  });
  $("order").addEventListener("click", (e) => {
    const up = (e.target as HTMLElement).closest<HTMLElement>("[data-up]")?.dataset.up;
    if (!cur || !up) return;
    const ids = cur.players.map((p) => p.id);
    const i = ids.indexOf(up);
    if (i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
    sendOrder(ids);
  });
  // ——— Rendering the state ———
  let calloutAt = -1,
    calloutTimer = 0;
  scene.onShot = (b) => {
    const s = b.shot!;
    if (s.callout) {
      const word = s.callout === "STRIKE" || s.callout === "SPARE" ? s.callout + "!" : s.callout;
      $("callout").className = "tcall bcall kind-" + s.callout.toLowerCase();
      $("callout").innerHTML = `<div class="callout-name">${word}</div>${s.extra ? `<div class="callout-why"><i></i>${esc(s.extra)}</div>` : ""}`;
      $("callout").classList.remove("hidden");
      clearTimeout(calloutTimer);
      calloutTimer = window.setTimeout(() => $("callout").classList.add("hidden"), 2100);
    }
    calloutAt = s.at;
  };
  void calloutAt;
  function sheetHtml(b: Bowl) {
    const up = b.players[b.turn];
    const rows = b.players
      .map((p) => {
        const sh = scoreSheet(p.rolls);
        const frames = sh.frames
          .map((f, i) => {
            const missed = i < p.startFrame;
            const marks = (i === 9 ? [0, 1, 2] : [0, 1]).map((k) => `<i>${missed ? "" : esc(f.marks[i === 9 ? k : f.marks.length === 1 && k === 0 ? 0 : k] ?? "")}</i>`).join("");
            return `<td class="${i === b.frame && p === up && b.mode === "game" ? "now" : ""}${missed ? " missed" : ""}"><span class="mk">${marks}</span><b>${f.total ?? ""}</b></td>`;
          })
          .join("");
        const live = p.bot ? "bot" : p.connected ? "" : "away";
        return `<tr class="${p === up && b.phase !== "lobby" && b.phase !== "over" ? "up" : ""} ${live}"><th>${esc(p.name)}${p.bot ? " <small>BOT</small>" : ""}${!p.bot && !p.connected ? " <small>AWAY</small>" : ""}</th>${frames}<td class="tot">${scoreOf(p)}${p.handicap ? `<small>HDCP ${p.handicap}</small>` : ""}</td></tr>`;
      })
      .join("");
    return `<table><thead><tr><th></th>${Array.from({ length: 10 }, (_, i) => `<th>${i + 1}</th>`).join("")}<th>TOTAL</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function render(b: Bowl) {
    cur = b;
    scene.update(b);
    const playing = b.phase !== "lobby";
    document.body.classList.toggle("playing", playing);
    scene.panelOpen = !playing || document.body.classList.contains("panel-open");
    $("start").classList.toggle("hidden", !host || (b.phase !== "lobby"));
    $("start").innerHTML = (b.mode === "practice" ? "Start practice" : "Start bowling") + " <span>→</span>";
    $("lobbyOpts").classList.toggle("hidden", b.mode !== "game" || b.cap === 1);
    $("pause").classList.toggle("hidden", !host || !playing || b.phase === "over" || b.paused);
    $("resume").classList.toggle("hidden", !host || !b.paused);
    document.querySelectorAll<HTMLButtonElement>("#hcap button").forEach((x) => x.classList.toggle("on", (x.dataset.v === "true") === b.handicap));
    // Lobby: the bowling order with each phone's setup state.
    const humans = b.players.filter((p) => !p.bot);
    put(
      "order",
      b.players
        .map(
          (p, i) =>
            `<li draggable="${host && b.phase === "lobby"}" data-id="${p.id}" class="${i === b.turn && playing ? "up" : ""}"><span class="num">${i + 1}</span><b>${esc(p.name)}</b><small>${p.bot ? "Bot · " + BOT_NAMES[p.bot as "easy"] : (p.hand === "left" ? "Left hand" : "Right hand") + " · " + (!p.connected ? "phone away" : p.ready ? "ready ✓" : "setting up the phone…")}</small>${host && b.phase === "lobby" && i > 0 ? `<button class="link" data-up="${p.id}" aria-label="Move ${esc(p.name)} up">▲</button>` : ""}</li>`,
        )
        .join("") +
        (b.phase === "lobby" && b.bot ? `<li class="botrow"><span class="num">${b.players.length + 1}</span><b>${BOT_NAMES[b.bot]}</b><small>Bot · bowls after you</small></li>` : "") ||
        `<li class="empty">Scan the QR with a phone to join${b.cap > 1 ? " · up to 6" : ""}.</li>`,
    );
    $("orderHint").textContent = host && b.phase === "lobby" && humans.length > 1 ? "Drag to reorder" : "";
    // Scoresheet (game) or practice tally.
    if (b.mode === "game" && playing) put("sheet", sheetHtml(b));
    else if (playing)
      put("sheet", `<div class="bpractice">PRACTICE · ${b.players.map((p) => `${esc(p.name)} <b>${p.bowls}</b> bowls · <b>${p.strikes}</b> strikes`).join(" · ")}</div>`);
    else put("sheet", "");
    // Turn banner with the live curve indicator.
    const up = b.players[b.turn];
    const showTurn = !!up && (b.phase === "aim" || b.phase === "rolling");
    $("turn").classList.toggle("hidden", !showTurn);
    if (up && showTurn) {
      const where = b.mode === "game" ? `Frame ${b.frame + 1} · Ball ${b.ballNo + 1}` : `Practice · Ball ${b.ballNo + 1}`;
      const next = nextUp(b);
      put(
        "turn",
        `<div class="bwho"><small>${where}</small><b>${esc(up.name)}</b>${up.bot ? "<small>BOT BOWLING</small>" : up.botFor ? "<small>A BOT BOWLS FOR THEM</small>" : `<small>${b.phase === "aim" ? "SWING TO BOWL" : "ROLLING"}</small>`}${next ? `<small class="nxt">Up next: ${esc(next.name)}</small>` : ""}</div><div class="bcurve">${curveHtml(up.bot ? 0 : up.curve)}</div>`,
      );
    }
    // After each ball: game speed and hook.
    const s = b.shot;
    const showRead = !!s && (b.phase === "result" || b.phase === "sweep" || b.phase === "rolling");
    $("readout").classList.toggle("hidden", !showRead);
    if (s && showRead)
      put(
        "readout",
        `<span><b>${s.kmh}</b> km/h</span><span><b>${s.mph}</b> mph</span><span>Hook <b>${Math.abs(s.boards)}</b> board${Math.abs(s.boards) === 1 ? "" : "s"}${s.boards ? (s.boards < 0 ? " ←" : " →") : ""}</span>${b.phase !== "rolling" ? `<span><b>${s.pins}</b> pin${s.pins === 1 ? "" : "s"}</span>` : ""}${s.foul ? `<span class="foul">FOUL LINE · warning</span>` : ""}`,
      );
    // Waiting for a missing bowler: the host may skip or let a bot bowl after 30 s.
    const waited = b.waitSince ? (Date.now() - b.waitSince) / 1000 : 0;
    $("waitBtns").classList.toggle("hidden", !host || !b.waitSince || waited < WAIT_LIMIT);
    put("message", esc(b.message));
    // Game over.
    $("gameover").classList.toggle("hidden", b.phase !== "over");
    if (b.phase === "over") {
      const win = b.players.filter((p) => b.winners.includes(p.id));
      put("goTitle", esc(win.map((p) => p.name).join(" & ")) + (win.length > 1 ? " tie!" : " wins!"));
      put("goScore", String(win[0] ? scoreOf(win[0]) : 0));
      put("goNames", b.players.map((p) => `${esc(p.name)} ${scoreOf(p)}`).join(" · "));
      $("again").classList.toggle("hidden", !host);
    }
  }
}
/** The next bowler after the one who is up (for "Up next"). */
function nextUp(b: Bowl): Bowler | null {
  if (b.players.length < 2) return null;
  if (b.mode === "practice") return b.players[(b.turn + 1) % b.players.length];
  // Order: rest of this frame, then the next frame from the top.
  const f = b.frame;
  for (let k = 1; k < b.players.length + 1; k++) {
    const p = b.players[(b.turn + k) % b.players.length];
    const fp = framePos(p.rolls);
    if (!fp.done && (fp.frame === f || (b.turn + k >= b.players.length && fp.frame === f + 1))) return p;
  }
  return null;
}
/** Place in line (0 = up now) for a bowler, following the same order as the server. */
function lineSpot(b: Bowl, id: string) {
  if (b.players[b.turn]?.id === id) return 0;
  const n = b.players.length;
  for (let k = 1; k < n; k++) if (b.players[(b.turn + k) % n].id === id) return k;
  return -1;
}

// ——————————————————————————— PHONE ———————————————————————————
function phone() {
  app.innerHTML = `<div class="phone bphone"><header class="phead"><div class="logo"><b>Sport</b>le</div><span class="pstat"><span>BALL</span>·<i class="dot" id="pDot"></i><span id="connection">NOT CONNECTED</span></span></header><div class="ruler" aria-hidden="true"></div><h1>A bowling ball.<br>In your hand.</h1><p>Hold your phone in your bowling hand, screen facing the TV. Bowl underhand.</p>
<div id="join" class="card"><div class="number">01 / CLAIM YOUR LANE</div><label for="code">Room code</label><input id="code" maxlength="6" autocomplete="off" placeholder="ABC123"><label for="nickname">Your name</label><input id="nickname" maxlength="20" placeholder="Bowler"><label for="hand">Bowling hand</label><select id="hand"><option value="right">Right hand</option><option value="left">Left hand</option></select><label for="outfit">Outfit</label><select id="outfit">${OUTFITS.map((o) => `<option value="${o.id}">${o.name}</option>`).join("")}</select><label for="ballColor">Ball colour</label><select id="ballColor">${PADDLES.map((g, i) => `<option value="${i}">${i ? g.name : "Classic red"}</option>`).join("")}</select><button class="full" id="connect">Join the lane</button></div>
<div id="controls" class="hidden"><section id="setup" class="setup"><div class="stephead"><span class="stepno"><b id="stepNo">01</b> / 02</span><span class="dashes" aria-hidden="true"><i></i><i></i></span><span class="steptag" id="stepTag">AIM</span></div><div class="eyebrow hidden" id="welcomeBack">WELCOME BACK · YOUR BOWL IS SAVED</div><h2 class="big" id="stepTitle">Aim at the screen.</h2><p class="lead" id="stepText"></p>
<div class="gauge hidden" id="gauge"><div class="gtop"><span>SWING SPEED</span><b id="gValue">0.0</b><small>rad/s</small></div><div class="gstatus"><span class="gdashes" id="gDashes"><i></i><i></i></span><span id="gText">WAITING FOR A BOWL</span></div><div class="gsegs" id="gSegs"></div><p class="ghint">A backswing, then swing forward underhand. Gentle waves don't count.</p></div>
<button class="hold" id="hold" aria-label="Hold to set the screen direction"><span class="htop"><b id="holdLabel">TAP, THEN HOLD</b><small id="holdHint">TURNS ON MOTION</small></span><span class="segs" id="holdSegs"></span></button>
<button class="linkbig hidden" id="skipBowls">Skip: use a standard bowl</button><div class="savedcard hidden" id="savedCard"><span class="savedtick">✓</span><b>Saved on this phone</b><small>Next time: tap, hold to aim, and you're in.</small></div></section>
<div id="ingame" class="card hidden"><div class="number" id="igNum">YOU’RE IN</div><h2 id="igTitle">Ready ✓</h2><p class="status" id="igStatus">The TV starts the game.</p><div class="bpreview"><div class="bcurve phonecurve" id="pCurve"></div><div class="plane" id="pLane" aria-label="Where the ball will go"></div></div><button class="bowlbtn hidden" id="bowlBtn"><b id="bowlBtnLabel">HOLD TO BOWL</b><small id="bowlBtnHint">Hold · swing back · let go on the way forward</small></button><div class="bstrip" id="strip" aria-label="Drag to choose where you stand"><span>◀ LEFT</span><i id="stripKnob"></i><span>RIGHT ▶</span></div><p class="fine" id="stripHint">Drag to choose where you stand. Double-tap for the centre.</p><p class="savednote">✓ Your bowl is saved on this phone</p><button class="full secondary" id="phonePause">Pause</button><details class="more"><summary>Settings</summary><button class="link" id="reaim">Aim at the screen again</button><button class="link" id="redo">Set up my practice bowls again</button><button class="link" id="modeToggle">Bowl without the button</button></details></div></div><div id="error" role="alert"></div></div>`;
  document.body.classList.add("controller");
  const PROFILE = "sportle-bowl";
  const savedProfile = (): BowlProfile | null => {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE) || "null");
      return p && (p.upSign === 1 || p.upSign === -1) ? p : null;
    } catch {
      return null;
    }
  };
  {
    const o = $<HTMLSelectElement>("outfit"),
      c = $<HTMLSelectElement>("ballColor");
    const so = localStorage.getItem("pov-outfit");
    if (OUTFITS.some((x) => x.id === so)) o.value = so!;
    c.value = String(cleanGear(JSON.parse(localStorage.getItem("bowl-gear") || "{}")).paddle);
    o.onchange = () => localStorage.setItem("pov-outfit", o.value);
    c.onchange = () => localStorage.setItem("bowl-gear", JSON.stringify({ paddle: Number(c.value) }));
    $<HTMLInputElement>("code").value = params.get("room") || "";
    const name = localStorage.getItem("bowl-name");
    if (name) $<HTMLInputElement>("nickname").value = name;
  }
  const filter = new MotionFilter();
  const reader = new BowlReader();
  let enabled = false,
    enabledAt = 0,
    orientationAt = 0,
    motionAt = 0,
    seq = 0,
    playerId = "",
    inflight = 0,
    swingId = 0,
    repeats = 0,
    gaugeRad = 0,
    board = 0,
    ready = false,
    redo = false,
    wake: any = null;
  let rel: Release | null = null;
  let state: Bowl | null = null;
  // Hold-to-bowl (default): the ball leaves when the button is let go. "swing" = the older
  // motion-only release, read from the swing itself.
  let bowlMode: "button" | "swing" = localStorage.getItem("bowl-mode") === "swing" ? "swing" : "button";
  /** Last ~1.5 s of motion, for reading a hold-to-bowl release. */
  let recent: HeldSample[] = [];
  /** Button held since (performance.now ms), and the tilt locked when it was pressed. */
  let heldAt = 0,
    heldTilt = 0;
  type Step = "aim" | "bowls" | "done";
  let stepNow: Step = "aim";
  const practice: { up: number; side: number; rad: number }[][] = [];
  const sensorLive = () => enabled && performance.now() - orientationAt < 1200 && performance.now() - motionAt < 1200;
  const showStep = (s: Step) => {
    stepNow = s;
    $("stepNo").textContent = s === "aim" ? "01" : "02";
    $("stepTag").textContent = s === "aim" ? "AIM" : s === "bowls" ? "PRACTICE BOWLS" : "SAVED";
    document.querySelectorAll(".stephead .dashes i").forEach((d, i) => (d.className = i <= (s === "aim" ? 0 : 1) ? "on" : ""));
    $("welcomeBack").classList.toggle("hidden", !(s === "aim" && savedProfile() && !redo));
    $("stepTitle").textContent = s === "aim" ? "Aim at the screen." : s === "bowls" ? "Two practice bowls." : "You're set.";
    $("stepText").textContent =
      s === "aim"
        ? "Hold the phone in your bowling hand, upright, screen facing the TV. Tap the button, then press and hold until the bar fills."
        : s === "bowls"
          ? practice.length === 0
            ? "Bowl 1: a normal, straight bowl. Backswing, then swing forward underhand."
            : "Bowl 2: the same, but swing a little toward the LEFT side of the lane."
          : "";
    $("hold").classList.toggle("hidden", s !== "aim");
    $("gauge").classList.toggle("hidden", s !== "bowls");
    $("skipBowls").classList.toggle("hidden", s !== "bowls");
    $("savedCard").classList.toggle("hidden", s !== "done");
    document.querySelectorAll("#gDashes i").forEach((d, i) => (d.className = i < practice.length ? "done" : ""));
  };
  const segs = (el: HTMLElement, n: number) => {
    if (el.children.length !== n) el.innerHTML = "<i></i>".repeat(n);
  };
  segs($("holdSegs"), 20);
  segs($("gSegs"), 20);
  const goReady = async () => {
    showStep("done");
    ready = true;
    redo = false;
    for (let i = 0; i < 20; i++) {
      try {
        await net.api("ready", { ready: true });
        break;
      } catch {
        await new Promise((ok) => setTimeout(ok, 500));
      }
    }
    await new Promise((ok) => setTimeout(ok, 1200));
    $("setup").classList.add("hidden");
    $("ingame").classList.remove("hidden");
  };
  // ——— Sensors ———
  const screenAngle = () => screen.orientation?.angle ?? Number((window as any).orientation || 0);
  function orientation(e: DeviceOrientationEvent) {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    orientationAt = performance.now();
    filter.orientation(e.alpha, e.beta, e.gamma, screenAngle(), orientationAt);
  }
  let buf: { t: number; up: number; side: number; rad: number }[] = [];
  let sawBowl = 0,
    quietSince = 0;
  function motion(e: DeviceMotionEvent) {
    const r = e.rotationRate,
      a = e.acceleration;
    if (!r || r.alpha === null || r.beta === null || r.gamma === null) return;
    motionAt = performance.now();
    filter.motion({ x: a?.x || 0, y: a?.y || 0, z: a?.z || 0 }, { alpha: r.alpha, beta: r.beta, gamma: r.gamma }, screenAngle(), motionAt);
    const rad = filter.rad;
    gaugeRad = Math.max(rad, gaugeRad * 0.92);
    if (!filter.fwd) return;
    if (stepNow === "bowls") {
      // Practice bowl: keep the last ~2 s of motion; once a fast swing has calmed down,
      // that stretch (backswing included) is one bowl.
      buf.push({ t: motionAt, up: filter.path.up, side: filter.path.side, rad });
      buf = buf.filter((q) => motionAt - q.t < 2200);
      if (rad >= BOWL_TRIGGER) sawBowl = motionAt;
      if (rad < 1.2) quietSince ||= motionAt;
      else quietSince = 0;
      if (sawBowl && quietSince && motionAt - quietSince > 250) {
        const one = buf.filter((q) => q.t >= sawBowl - 1600 && q.t <= sawBowl + 400);
        buf = [];
        sawBowl = 0;
        practiceBowl(one);
      } else if (!sawBowl && quietSince && motionAt - quietSince > 1500) buf = [];
      return;
    }
    if (stepNow !== "done" || !ready) return;
    recent.push({ t: motionAt, rad, up: filter.path.up, side: filter.path.side });
    if (recent.length > 8 && motionAt - recent[0].t > 1500) recent = recent.filter((q) => motionAt - q.t < 1500);
    if (bowlMode === "button") return;
    const out = reader.feed({ ...sampleOf(filter, motionAt), twist: r.gamma });
    if (out) bowlNow(out);
  }
  const myTurn = () => {
    const up = state?.players[state.turn];
    return !!state && up?.id === playerId && state.phase === "aim" && !up.botFor && !state.paused;
  };
  function bowlNow(out: Release) {
    if (myTurn()) {
      rel = out;
      swingId++;
      repeats = 3;
      navigator.vibrate?.(50);
    } else {
      // Not your turn: nothing is sent as a bowl (and the server would ignore it anyway).
      flash("Not your turn yet");
    }
  }
  const liveTilt = () => (filter.fwd ? wrap(filter.angle.roll - reader.zero) : 0);
  // ——— Hold to bowl ———
  const btn = $("bowlBtn");
  const btnText = (label: string, hint: string) => {
    $("bowlBtnLabel").textContent = label;
    $("bowlBtnHint").textContent = hint;
  };
  const letGo = (cancelled: boolean) => {
    if (!heldAt) return;
    const t = performance.now();
    heldAt = 0;
    btn.classList.remove("held");
    btnText("HOLD TO BOWL", "Hold · swing back · let go on the way forward");
    const tilt = heldTilt;
    // Read a moment later: the arm is still swinging just after the thumb lets go.
    setTimeout(() => {
      const out = readHeld(recent, t, reader.profile, tilt);
      // A cancelled touch (the browser took it over) only bowls if there was a real swing.
      if (!out || (cancelled && out.rad < BOWL_TRIGGER)) {
        if (!cancelled) flash("Swing your arm forward, then let go");
        return;
      }
      bowlNow(out);
    }, HELD_AFTER);
  };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!myTurn()) return flash("Not your turn yet");
    if (!sensorLive()) return flash("Waiting for motion sensors…");
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {}
    heldAt = performance.now();
    heldTilt = liveTilt();
    btn.classList.add("held");
    navigator.vibrate?.(20);
    btnText("SWING… LET GO!", "Curve locked: " + curveLabel(curveFrom(heldTilt)).toLowerCase());
  });
  btn.addEventListener("pointerup", () => letGo(false));
  btn.addEventListener("pointercancel", () => letGo(true));
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  const showMode = () => {
    $("modeToggle").textContent = bowlMode === "button" ? "Bowl without the button (swing only)" : "Use the hold-to-bowl button";
  };
  showMode();
  $("modeToggle").onclick = () => {
    bowlMode = bowlMode === "button" ? "swing" : "button";
    localStorage.setItem("bowl-mode", bowlMode);
    reader.cancel();
    showMode();
    if (state) phoneState(state);
  };
  const practiceBowl = (one: { up: number; side: number; rad: number }[]) => {
    const peak = Math.max(...one.map((q) => q.rad));
    if (peak < BOWL_TRIGGER || !one.some((q) => q.rad > BOWL_BACK)) return;
    practice.push(one);
    navigator.vibrate?.(30);
    const lit = Math.round((Math.min(20, peak) / 20) * 20);
    $("gSegs").querySelectorAll("i").forEach((x, i) => x.classList.toggle("on", i < lit));
    $("gText").textContent = `BOWL ${practice.length} OF 2 ✓ · ${peak.toFixed(1)} RAD/S`;
    if (practice.length < 2) return showStep("bowls");
    const res = learnBowls(practice);
    if (!res.ok) {
      practice.length = 0;
      showStep("bowls");
      $("gText").textContent = res.reason.toUpperCase();
      return;
    }
    reader.profile = res.profile;
    localStorage.setItem(PROFILE, JSON.stringify(res.profile));
    setTimeout(goReady, 700);
  };
  let flashUntil = 0;
  const flash = (msg: string) => {
    put("igStatus", esc(msg));
    flashUntil = performance.now() + 1500;
  };
  // 01 · Tap turns motion on (permission must come from the tap), then press and hold to aim.
  const enable = async () => {
    try {
      if (!window.isSecureContext) throw Error("Motion controls need HTTPS. Open the link from the TV's QR code.");
      const D = DeviceMotionEvent as any,
        O = DeviceOrientationEvent as any;
      const asks = [];
      if (typeof D.requestPermission === "function") asks.push(D.requestPermission());
      if (typeof O.requestPermission === "function") asks.push(O.requestPermission());
      const res = await Promise.all(asks);
      if (res.some((v) => v !== "granted")) throw Error("Motion permission denied. Allow Motion & Orientation in browser settings, then reload.");
      if (!enabled) {
        addEventListener("deviceorientation", orientation);
        addEventListener("devicemotion", motion);
      }
      enabled = true;
      enabledAt = performance.now();
      $("holdLabel").textContent = "HOLD TO SET";
      $("holdHint").textContent = "PRESS AND HOLD";
      if ("wakeLock" in navigator) wake = await (navigator as any).wakeLock.request("screen").catch(() => null);
    } catch (e) {
      error(e);
    }
  };
  $("hold").addEventListener("click", () => {
    if (!enabled) enable();
  });
  let holdStart = 0,
    holdTimer: number | undefined;
  const holdReset = (hint = "PRESS AND HOLD") => {
    clearInterval(holdTimer);
    holdStart = 0;
    $("holdSegs").querySelectorAll("i").forEach((x) => x.classList.remove("on"));
    $("holdHint").textContent = hint;
  };
  $("hold").addEventListener("pointerdown", (e) => {
    if (!enabled) return;
    e.preventDefault();
    if (!sensorLive()) return holdReset("WAITING FOR SENSORS");
    holdStart = performance.now();
    clearInterval(holdTimer);
    holdTimer = window.setInterval(() => {
      const { alpha, beta, gamma } = filter.abs;
      const ok = !!aimFrom(alpha, beta, gamma),
        still = Math.hypot(...filter.rate) < 150;
      if (!ok || !still) holdStart = Math.min(performance.now(), holdStart + 80);
      $("holdHint").textContent = !ok ? "POINT IT AT THE SCREEN" : "HOLD STILL…";
      const k = Math.min(1, (performance.now() - holdStart) / 800);
      $("holdSegs").querySelectorAll("i").forEach((x, i) => x.classList.toggle("on", i < Math.round(k * 20)));
      if (k < 1) return;
      holdReset("SET ✓");
      if (!filter.aim()) return holdReset("HOLD IT UPRIGHT, SCREEN TO THE TV");
      // "Straight" is however the phone was tilted while aiming.
      reader.zero = paddlePose(alpha, beta, gamma, filter.fwd!, 1).roll;
      navigator.vibrate?.(40);
      const prof = savedProfile();
      if (prof && !redo) {
        reader.profile = prof;
        goReady();
      } else {
        practice.length = 0;
        showStep("bowls");
      }
    }, 40);
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"])
    $("hold").addEventListener(ev, () => {
      if (holdStart) holdReset();
    });
  $("skipBowls").onclick = () => {
    reader.profile = { ...DEFAULT_BOWL_PROFILE };
    localStorage.setItem(PROFILE, JSON.stringify(reader.profile));
    goReady();
  };
  $("reaim").onclick = () => {
    ready = false;
    $("ingame").classList.add("hidden");
    $("setup").classList.remove("hidden");
    showStep("aim");
  };
  $("redo").onclick = () => {
    redo = true;
    $("reaim").click();
  };
  $("phonePause").onclick = () => net.api(state?.paused ? "resume" : "pause", {}).catch(error);
  // Thumb strip: where you stand on the approach.
  const strip = $("strip");
  const setBoard = (clientX: number) => {
    const r = strip.getBoundingClientRect();
    board = Math.max(-1, Math.min(1, ((clientX - r.left) / r.width) * 2 - 1));
    if (Math.abs(board) < 0.08) board = 0;
    $("stripKnob").style.left = ((board + 1) / 2) * 100 + "%";
  };
  strip.addEventListener("pointerdown", (e) => {
    strip.setPointerCapture(e.pointerId);
    setBoard(e.clientX);
  });
  strip.addEventListener("pointermove", (e) => {
    if (strip.hasPointerCapture(e.pointerId)) setBoard(e.clientX);
  });
  strip.addEventListener("dblclick", () => {
    board = 0;
    $("stripKnob").style.left = "50%";
  });
  // ——— Joining ———
  async function claim(credential?: string) {
    const room = (params.get("room") || $<HTMLInputElement>("code").value).trim().toUpperCase();
    if (!/^[A-F0-9]{6}$/.test(room)) throw Error("Enter the six-character room code from the TV.");
    net.room = room;
    const name = ($<HTMLInputElement>("nickname")?.value || localStorage.getItem("bowl-name") || "Bowler").trim();
    const r = await net.api("join", {
      name,
      hand: $<HTMLSelectElement>("hand")?.value || localStorage.getItem("bowl-hand") || "right",
      outfit: localStorage.getItem("pov-outfit") || "classic",
      gear: cleanGear(JSON.parse(localStorage.getItem("bowl-gear") || "{}")),
      pair: hash.get("pair") || undefined,
      credential,
    });
    localStorage.setItem("bowl-controller-" + room, r.credential);
    if (!credential) {
      localStorage.setItem("bowl-name", name);
      localStorage.setItem("bowl-hand", r.player.hand);
      // A fresh page after typing (no iOS "Undo Typing" when the phone is swung).
      location.replace("/bowling/phone?room=" + room);
      return;
    }
    net.credential = r.credential;
    playerId = r.player.id;
    seq = r.seq + 1;
    filter.hand = r.player.hand === "left" ? -1 : 1;
    document.body.classList.add("joined");
    $("join").replaceChildren();
    $("join").classList.add("hidden");
    $("controls").classList.remove("hidden");
    await net.clock();
    net.stream();
    showStep("aim");
  }
  $("connect").onclick = () => claim().catch(error);
  {
    const room = (params.get("room") || "").toUpperCase();
    const saved = localStorage.getItem("bowl-controller-" + room);
    if (/^[A-F0-9]{6}$/.test(room) && saved) {
      $("join").replaceChildren();
      claim(saved).catch(() => {
        localStorage.removeItem("bowl-controller-" + room);
        location.replace("/bowling/phone?room=" + room);
      });
    }
  }
  net.onStatus = (s) => {
    put("connection", esc(s.toUpperCase()));
    $("pDot").className = "dot" + (s === "Connected" ? " on" : " wait");
  };
  net.onGone = (reason) => {
    error(reason + ". Scan the QR on the TV again.");
  };
  let wasUp = false;
  function phoneState(b: Bowl) {
    state = b;
    const me = b.players.find((p) => p.id === playerId);
    if (!me) return;
    const up = b.players[b.turn];
    const playing = b.phase !== "lobby" && b.phase !== "over";
    const mine = playing && up?.id === playerId && b.phase === "aim" && !me.botFor;
    if (mine && !wasUp) navigator.vibrate?.([60, 40, 60]);
    wasUp = mine;
    document.body.classList.toggle("myturn", mine);
    $("bowlBtn").classList.toggle("hidden", !(mine && bowlMode === "button"));
    if (!mine && heldAt) {
      heldAt = 0;
      btn.classList.remove("held");
    }
    put("pLane", mine || up?.id === playerId ? laneSvg(b.aim, b.trail, me.board) : "");
    const score = `${b.mode === "game" ? "Score " + scoreOf(me) : `${me.bowls} bowls · ${me.strikes} strikes`}`;
    let num = "YOU’RE IN",
      title = "Ready ✓",
      status = "The TV starts the game.";
    if (b.phase === "lobby") {
      const n = b.players.findIndex((p) => p.id === playerId) + 1;
      status = `You're ${ordinal(n)} in the bowling order. The TV starts the game.`;
    } else if (b.phase === "over") {
      num = "FINAL";
      title = b.winners.includes(playerId) ? "You win! 🏆" : "Game over";
      status = `Your score: ${scoreOf(me)}`;
    } else if (mine) {
      num = "YOUR TURN";
      title = b.mode === "game" ? `Frame ${b.frame + 1} · Ball ${b.ballNo + 1}` : `Ball ${b.ballNo + 1}`;
      status = bowlMode === "button"
        ? `Hold the button, swing back, let go as you swing forward. ${score}`
        : `Backswing, then bowl underhand. ${score}`;
    } else if (up?.id === playerId) {
      num = "YOUR BALL";
      title = b.phase === "rolling" ? "Rolling…" : b.shot ? `${b.shot.pins} pin${b.shot.pins === 1 ? "" : "s"}` : "…";
      status = score;
    } else {
      const k = lineSpot(b, playerId);
      num = "WAIT";
      title = k === 1 ? "You're up next" : k > 1 ? `${ordinal(k)} in line` : "Waiting";
      status = `Up now: ${up?.name ?? "—"}. ${score}`;
    }
    if (b.paused) status = "Paused. " + status;
    put("igNum", esc(num));
    put("igTitle", esc(title));
    if (performance.now() > flashUntil) put("igStatus", esc(status));
    $("phonePause").textContent = b.paused ? "Resume" : "Pause";
    $("phonePause").classList.toggle("hidden", !playing);
  }
  net.onState = (s) => {
    if (s.game === "bowling") phoneState(s.state as Bowl);
  };
  // Live curve indicator (tilt) on the phone.
  setInterval(() => {
    // While the button is held, the curve stays what it was when pressed.
    put("pCurve", curveHtml(curveFrom(heldAt ? heldTilt : liveTilt())));
    if (stepNow === "bowls") put("gValue", gaugeRad.toFixed(1));
    if (enabled && !sensorLive() && performance.now() - enabledAt > 5000)
      error("No live sensor data. Check the browser's motion permission, or use another phone.");
  }, 100);
  // ~30 Hz input: live tilt and board; a release rides in three packets (applied once).
  setInterval(async () => {
    if (!net.credential || net.gone || inflight >= 2 || document.hidden) return;
    inflight++;
    const live = sensorLive();
    const swing = repeats > 0 && !!rel;
    if (swing) repeats--;
    const tilt = heldAt ? heldTilt : liveTilt();
    const input: Input = {
      seq: seq++,
      t: Date.now() + net.offset,
      pitch: wrap(filter.angle.pitch),
      roll: swing && rel ? wrap(rel.tilt) : tilt,
      yaw: wrap(filter.angle.yaw),
      strength: swing && rel ? rel.speed : 0,
      direction: 0,
      side: swing && rel ? rel.line : 0,
      hook: swing && rel ? rel.hook : curveFrom(tilt),
      swing: swing && live,
      swingId,
      sensors: live,
      calibrated: filter.calibrated && live,
      mx: board,
    };
    try {
      await net.api("input", input);
    } catch {
      put("connection", "RECONNECTING");
    } finally {
      inflight--;
    }
  }, 33);
  setInterval(() => {
    if (net.credential) net.clock().catch(() => {});
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      reader.cancel();
      heldAt = 0;
      btn.classList.remove("held");
      net.api("background", {}).catch(() => {});
      wake?.release?.();
      wake = null;
    } else if (net.credential) {
      net.kick();
      if ("wakeLock" in navigator && enabled)
        (navigator as any).wakeLock.request("screen").then((w: any) => (wake = w)).catch(() => {});
    }
  });
  if (location.hash.includes("test")) (window as any).__bowlPhone = { filter, reader, get state() { return state; } };
}
