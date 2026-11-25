/**
 * Sportle Kart: the TV page (/kart) and the phone wheel (/kart/phone). Same transport as the
 * other games (authenticated HTTP input + SSE snapshots, reconnect), same pairing QR and the
 * same phone setup style. Driving, items, laps and placings all run on the server; the phone
 * sends steering ~40 times a second and button presses with ids the server applies once.
 */
import { Connection } from "./net.ts";
import {
  BODIES,
  BOT_LEVELS,
  CUPS,
  cupOf,
  DEFAULT_STEER,
  DRIFT_LEVELS,
  GestureReader,
  ITEMS,
  LAPS,
  SENSITIVITY,
  SteerReader,
  TRACKS,
  WAIT_LIMIT,
  driftLevel,
  gripSide,
  learnSteer,
  ordinal,
  pointAt,
  track,
  upVector,
  wheelAngle,
} from "../shared/kart.ts";
import type { Kart, ItemKind, Racer, Sensitivity, SteerProfile, TrackId } from "../shared/kart.ts";
import { OUTFITS, PADDLES, cleanGear } from "../shared/types.ts";
import type { Input } from "../shared/types.ts";
import { wrap } from "../shared/motion.ts";
import { KartScene, KART_VIEW_LABELS, paint } from "./kartscene.ts";
import type { KartView } from "./kartscene.ts";
import { drawQR } from "./qr.ts";
import { mountSound } from "./soundpanel.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
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
const rgb = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
/** A colour dot (SVG, since the page's CSP allows no inline style attributes). */
const dot = (c: readonly number[]) => `<svg class="kdot" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${rgb(c)}"/></svg>`;
const time = (s: number) => (s >= 60 ? Math.floor(s / 60) + ":" + (s % 60).toFixed(2).padStart(5, "0") : s.toFixed(2));

/** Original item icons (simple shapes, Sportle colours). */
export function itemIcon(kind: ItemKind | "" | "roll", n = 0) {
  const ball = (x: number, y: number, r: number) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="#ebf538" stroke="#a9b31a" stroke-width="2"/><circle cx="${x - r * 0.35}" cy="${y - r * 0.2}" r="${r * 0.14}" fill="#a9b31a"/><circle cx="${x + r * 0.3}" cy="${y + r * 0.3}" r="${r * 0.14}" fill="#a9b31a"/>`;
  const pin = (x: number) => `<path d="M${x} 20 c6 0 6 9 3 13 c7 6 7 22 -3 24 c-10 -2 -10 -18 -3 -24 c-3 -4 -3 -13 3 -13z" fill="#fff" stroke="#c9c2d6" stroke-width="1.5"/><path d="M${x - 4} 31 h8" stroke="#dc2b45" stroke-width="2.5"/>`;
  const bowl = (r: number, c: string) => `<circle cx="40" cy="42" r="${r}" fill="${c}"/><circle cx="${40 - r * 0.3}" cy="${42 - r * 0.35}" r="${r * 0.12}" fill="#1b1030"/><circle cx="${40 + r * 0.05}" cy="${42 - r * 0.48}" r="${r * 0.12}" fill="#1b1030"/><circle cx="${40 - r * 0.05}" cy="${42 - r * 0.05}" r="${r * 0.13}" fill="#1b1030"/>`;
  const art: Record<string, string> = {
    "": `<circle cx="40" cy="40" r="22" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="3" stroke-dasharray="6 6"/>`,
    roll: `<rect x="18" y="18" width="44" height="44" rx="9" fill="#ff8a1f"/><text x="40" y="53" text-anchor="middle" font-size="36" font-weight="900" fill="#fff">?</text>`,
    dink: `<path d="M14 60 Q34 6 60 40" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="5 5"/>${ball(58, 44, 13)}`,
    pinbowl: bowl(24, "#d8344f"),
    strike: `${bowl(30, "#8a3cf0")}<path d="M62 12 l3 7 7 1 -5 5 1 7 -6-3 -6 3 1-7 -5-5 7-1z" fill="#ffd23c"/>`,
    guard: `<g transform="rotate(-25 40 40)"><rect x="24" y="10" width="32" height="40" rx="14" fill="#54a8fa" stroke="#fff" stroke-width="3"/><rect x="36" y="48" width="8" height="22" rx="3" fill="#222"/></g><circle cx="40" cy="40" r="34" fill="none" stroke="#54a8fa" stroke-width="2" stroke-dasharray="4 7"/>`,
    serve: `<path d="M10 60 Q40 50 66 18" fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 5"/>${ball(22, 56, 8)}${ball(42, 44, 8)}${ball(62, 24, 8)}`,
    fence: `${pin(22)}${pin(40)}${pin(58)}`,
    tape: `<circle cx="40" cy="42" r="24" fill="#c9c9d4"/><circle cx="40" cy="42" r="11" fill="#14141f"/><path d="M44 14 L30 44 H42 L36 70 L56 36 H44 Z" fill="#ff8a1f" stroke="#fff" stroke-width="2"/>`,
    sweet: `<circle cx="40" cy="40" r="28" fill="#ffd23c" opacity=".35"/><circle cx="40" cy="40" r="19" fill="none" stroke="#ffd23c" stroke-width="5"/><circle cx="40" cy="40" r="7" fill="#fff"/>`,
    net: `<path d="M14 22 Q40 10 66 22 L60 64 Q40 70 20 64 Z" fill="none" stroke="#e8e8f0" stroke-width="3"/><path d="M24 20 L28 66 M40 15 V68 M56 20 L52 66 M16 36 H64 M18 50 H62" stroke="#e8e8f0" stroke-width="2"/>`,
    cannon: `<rect x="14" y="34" width="44" height="18" rx="7" fill="#3a3a48" transform="rotate(-22 36 43)"/><circle cx="30" cy="56" r="10" fill="#6b4a2a" stroke="#fff" stroke-width="2"/><path d="M60 16 l4 8 8 2 -6 5 2 8 -8-4 -7 4 1-8 -6-6 8-1z" fill="#ff8a1f"/>`,
    wave: `${[18, 32, 46, 60].map((x, i) => `<circle cx="${x}" cy="${46 - (i === 1 || i === 2 ? 10 : 0)}" r="6" fill="#f2c2a0"/><path d="M${x - 7} ${70} V${54 - (i === 1 || i === 2 ? 10 : 0)} M${x + 7} 70 V${54 - (i === 1 || i === 2 ? 10 : 0)}" stroke="${["#54a8fa", "#ff8a1f", "#dc2b45", "#ffd23c"][i]}" stroke-width="5" stroke-linecap="round"/>`).join("")}`,
    machine: `<rect x="16" y="30" width="36" height="34" rx="5" fill="#2f9a5a"/><rect x="46" y="38" width="22" height="10" rx="3" fill="#222"/>${ball(34, 22, 9)}`,
  };
  return `<svg viewBox="0 0 80 80" class="kicon" aria-hidden="true">${art[kind] ?? art[""]}${n > 1 ? `<text x="72" y="76" text-anchor="end" font-size="20" font-weight="900" fill="#fff" stroke="#000" stroke-width="1">×${n}</text>` : ""}</svg>`;
}
const itemName = (r: Racer) => (r.rolling > 0 ? "…" : r.item ? ITEMS[r.item].name : "");
/** Minimap: the track's outline and every kart. */
function minimap(k: Kart, mine: string[]) {
  const t = track(k.track);
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  for (let i = 0; i < t.n; i++) {
    x0 = Math.min(x0, t.x[i]);
    x1 = Math.max(x1, t.x[i]);
    z0 = Math.min(z0, t.z[i]);
    z1 = Math.max(z1, t.z[i]);
  }
  const W = 200,
    H = 150,
    sc = Math.min((W - 20) / (x1 - x0), (H - 20) / (z1 - z0));
  const X = (x: number) => (10 + (x - x0) * sc).toFixed(1),
    Y = (z: number) => (10 + (z - z0) * sc).toFixed(1);
  let d = "";
  for (let i = 0; i < t.n; i += 3) d += (i ? "L" : "M") + X(t.x[i]) + " " + Y(t.z[i]);
  const dots = k.racers
    .slice()
    .sort((a, b) => b.place - a.place)
    .map((r) => `<circle cx="${X(r.x)}" cy="${Y(r.z)}" r="${mine.includes(r.id) ? 6 : 4.2}" fill="${rgb(paint(r))}" stroke="${mine.includes(r.id) ? "#fff" : "#000"}" stroke-width="${mine.includes(r.id) ? 2 : 1}"/>`)
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}Z" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="9" stroke-linejoin="round"/><path d="${d}Z" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="4" stroke-linejoin="round"/><circle cx="${X(pointAt(t, t.S0).x)}" cy="${Y(pointAt(t, t.S0).z)}" r="3" fill="#ff8a1f"/>${dots}</svg>`;
}

if (location.pathname === "/kart/phone") phone();
else tv();

// ——————————————————————————— TV ———————————————————————————
function tv() {
  app.innerHTML = `<canvas id="court" aria-label="3D kart track"></canvas>
<header class="topbar"><span></span><nav><a class="link" href="/" id="allGames">All games</a><button class="link" id="music">Music: House</button><button class="link" id="view" title="Change camera (V)">View: Chase</button><button class="link" id="layout" title="Split screen or one shared view">Screen: Split</button><button class="link" id="settingsOpen">Music &amp; sound</button><button class="link" id="sound">Sound on</button><button class="link" id="howtoOpen">How to drive</button><button class="link" id="fullscreen">Fullscreen</button></nav></header>
<aside class="panel" id="panel">
  <div class="wordmark" aria-label="Sportle"><span><b>SPORT</b>LE</span><i></i></div>
  <p class="tagline">Kart. <b>Your phone is the wheel.</b></p>
  <div id="setup">
    <div class="step" id="stepPlayers">
      <a class="link back" href="/">← All games</a>
      <h2 class="stephead">Who's racing?</h2>
      <button class="choice" id="goSingle"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg><span><b>Single player</b><small>You vs 7 bots · or a time trial</small></span><i>→</i></button>
      <button class="choice" id="goMulti"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3.4"/><circle cx="16.5" cy="8.5" r="3"/><path d="M2 21c1-3.6 3.4-5.4 6-5.4s5 1.8 6 5.4M14 15.8c2.6-.4 5.6 1 7 5.2"/></svg><span><b>Multiplayer</b><small>Up to 8 phones · one QR · split screen up to 4</small></span><i>→</i></button>
    </div>
    <div class="step hidden" id="stepOptions">
      <button class="link back" id="backPlayers">← Single / Multiplayer</button>
      <h2 class="stephead" id="optHead">Single player</h2>
      <div class="difficulty" role="radiogroup" aria-label="Race"><span>Race</span><input type="radio" name="kmode" id="km-race" value="race" checked><label for="km-race">Single race</label><input type="radio" name="kmode" id="km-cup" value="cup"><label for="km-cup">Cup · 4 tracks</label><input type="radio" name="kmode" id="km-trial" value="trial"><label for="km-trial">Time trial</label></div>
      <div class="difficulty mappick" role="radiogroup" aria-label="Track"><span>Track</span>${TRACKS.map((t, i) => `<input type="radio" name="ktrack" id="kt-${t.id}" value="${t.id}" ${i === 0 ? "checked" : ""}><label for="kt-${t.id}">${t.name}</label>`).join("")}</div>
      <div class="difficulty hidden" role="radiogroup" aria-label="Cup" id="cupRow"><span>Cup</span>${CUPS.map((c, i) => `<input type="radio" name="kcup" id="kc-${c.id}" value="${i}" ${i === 0 ? "checked" : ""}><label for="kc-${c.id}">${c.name}</label>`).join("")}</div><p class="fine" id="trackHint"></p>
      <div class="difficulty" role="radiogroup" aria-label="Bots"><span>Bots</span>${BOT_LEVELS.map((b) => `<input type="radio" name="kbot" id="kb-${b.id}" value="${b.id}" ${b.id === "club" ? "checked" : ""}><label for="kb-${b.id}">${b.name}</label>`).join("")}</div>
      <div class="difficulty" role="radiogroup" aria-label="Items"><span>Items</span><input type="radio" name="kitems" id="ki-on" value="on" checked><label for="ki-on">On</label><input type="radio" name="kitems" id="ki-off" value="off"><label for="ki-off">Off</label></div>
      <div class="difficulty" role="radiogroup" aria-label="Screen" id="screenRow"><span>Screen</span><input type="radio" name="kscreen" id="ks-split" value="split" checked><label for="ks-split">Split screen</label><input type="radio" name="kscreen" id="ks-shared" value="shared"><label for="ks-shared">One shared view</label></div>
      <button class="cta" id="create">Create race <span>→</span></button>
      <p class="fine">No app to install. Scan, hold your phone sideways like a wheel, drive.</p>
    </div>
  </div>
  <div id="lobby" class="hidden">
    <div class="eyebrow" id="connection">Connecting</div>
    <div id="pairing" class="pairing"><div class="qrtile"><canvas id="qr" class="qr"></canvas></div><div><small>Room code</small><div class="roomcode" id="roomcode"></div><p class="fine" id="pairHint">Scan with your phone camera.</p><button class="link" id="refreshPair">Refresh pairing link</button></div></div>
    <div class="opts" id="trackOpts"><div class="optrow"><span>Track</span><div class="seg" id="trackSeg">${TRACKS.map((t) => `<button data-v="${t.id}">${t.name.split(" ")[0]}</button>`).join("")}</div></div></div>
    <h3 class="bhead">Drivers <small id="lobbyHint"></small></h3>
    <ol id="drivers" class="border"></ol>
    <div class="bcontrols"><button id="start" class="cta">Start race <span>→</span></button><button id="next" class="cta hidden">Next race <span>→</span></button><div class="row inplay"><button id="pause" class="ghost">Pause</button><button id="resume" class="ghost">Resume</button><button id="toLobby" class="ghost">Change track</button></div></div>
    <button id="leave" class="link">← Leave race</button>
  </div>
  <div id="error" role="alert"></div>
</aside>
<button class="paneltab" id="panelToggle" aria-controls="panel">Room</button>
<div class="khud" id="khud" aria-live="polite"></div>
<div class="kmap hidden" id="kmap"></div>
<div class="kboard hidden" id="kboard"></div>
<div class="kcount hidden" id="kcount" aria-live="assertive"></div>
<div class="message" id="message" aria-live="polite">Pick single player or multiplayer to start.</div>
<div class="gameover kresults hidden" id="results" role="dialog" aria-labelledby="resTitle"><small id="resSmall">RESULTS</small><h2 id="resTitle">Winner</h2><table id="resTable"></table><div class="row"><button class="cta" id="again">Next race <span>→</span></button><button class="ghost" id="resLobby">Change track</button></div></div>
<dialog id="howto"><h2>How to drive</h2><ol><li><b>Create a race</b> and scan the QR with each phone (everyone scans the same code, up to 8). Pick a name, an outfit and a kart.</li><li><b>Hold the phone sideways</b>, screen toward you, both hands, like a small steering wheel. Set the centre, then turn all the way left and right once. Saved on the phone for next time.</li><li><b>Steer</b> by turning the phone like a wheel. Gas is automatic (or tilt the top away to drive, toward you to brake, in the phone's settings).</li><li><b>Left thumb: DRIFT.</b> Tap to hop; hold while steering to drift. Sparks go blue, orange, pink: let go for a boost.</li><li><b>Right thumb: ITEM.</b> Tap to use it forward; hold, tilt the phone toward you and let go to throw it back.</li><li><b>Extras:</b> flick the phone up off a jump for a trick boost; shake it to break free of a net.</li></ol><p class="fine">Phone sensors read how far you turn the phone, not its exact position. Steering is smoothed a little on the phone and on the server.</p><button class="cta" id="howtoClose">Got it</button></dialog>`;
  let scene: KartScene;
  try {
    scene = new KartScene($<HTMLCanvasElement>("court"));
  } catch (e) {
    error(e);
    return;
  }
  if (location.hash === "#test") (window as any).__kartScene = scene;
  let cur: Kart | null = null;
  let host = false,
    pair = "",
    displayId = "host",
    publicOrigin: string | null = null;
  let players: "single" | "multi" = "single";
  const step = (id: string) => document.querySelectorAll(".step").forEach((el) => el.classList.toggle("hidden", el.id !== id));
  const options = (p: "single" | "multi") => {
    players = p;
    $("optHead").textContent = p === "single" ? "Single player" : "Multiplayer";
    $("screenRow").classList.toggle("hidden", p === "single");
    document.querySelector<HTMLElement>("label[for=km-trial]")!.classList.toggle("hidden", p !== "single");
    if (p !== "single" && $<HTMLInputElement>("km-trial").checked) $<HTMLInputElement>("km-race").checked = true;
    step("stepOptions");
  };
  $("goSingle").onclick = () => options("single");
  $("goMulti").onclick = () => options("multi");
  $("backPlayers").onclick = () => step("stepPlayers");
  const pick = (name: string, fallback: string) => document.querySelector<HTMLInputElement>(`input[name=${name}]:checked`)?.value || fallback;
  const syncTrack = () => {
    const t = TRACKS.find((x) => x.id === pick("ktrack", "court"))!;
    const cup = pick("kmode", "race") === "cup";
    const c = CUPS[Number(pick("kcup", "0"))];
    $("cupRow").classList.toggle("hidden", !cup);
    document.querySelector<HTMLElement>(".mappick")!.classList.toggle("hidden", cup);
    $("trackHint").textContent = cup ? c.name + ": " + c.tracks.map((id) => TRACKS.find((x) => x.id === id)!.name).join(" → ") : t.name + " · " + t.note;
    if (!cur) scene.setTrack(cup ? c.tracks[0] : t.id);
  };
  document.querySelectorAll("input[name=ktrack], input[name=kmode], input[name=kcup]").forEach((r) => r.addEventListener("change", syncTrack));
  syncTrack();
  $("howtoOpen").onclick = () => $<HTMLDialogElement>("howto").showModal();
  $("howtoClose").onclick = () => $<HTMLDialogElement>("howto").close();
  $("fullscreen").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  $("panelToggle").onclick = () => document.body.classList.toggle("panel-open");
  // ——— Camera and layout ———
  const VIEWS: KartView[] = ["chase", "bumper", "broadcast"];
  const setView = (v: KartView) => {
    scene.viewMode2 = v;
    $("view").textContent = "View: " + KART_VIEW_LABELS[v];
    try {
      localStorage.setItem("kart-view", v);
    } catch {}
  };
  setView(VIEWS.includes(localStorage.getItem("kart-view") as KartView) ? (localStorage.getItem("kart-view") as KartView) : "chase");
  $("view").onclick = () => setView(VIEWS[(VIEWS.indexOf(scene.viewMode2) + 1) % VIEWS.length]);
  addEventListener("keydown", (e) => {
    if (e.code === "KeyV" && !(e.target instanceof HTMLInputElement)) setView(VIEWS[(VIEWS.indexOf(scene.viewMode2) + 1) % VIEWS.length]);
  });
  $("layout").onclick = () => {
    if (!cur) return;
    net.api("kart/layout", { shared: !cur.shared }).catch(error);
  };
  // ——— Music & sound: same button, dialog and saved choices as Pickleball ———
  const music = mountSound({ scene, musicBtn: $("music"), soundBtn: $("sound"), openBtn: $("settingsOpen"), sfxNote: "engine, items, crowd" });
  fetch("/api/config")
    .then((r) => r.json())
    .then((c) => {
      publicOrigin = c.publicOrigin;
      if (net.room) pairing();
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
      const url = publicOrigin + "/kart/phone?room=" + net.room + "#pair=" + pair;
      try {
        drawQR(qr, url);
        qr.classList.remove("hidden");
        $("pairHint").textContent = "Everyone scans this one QR (up to 8 phones). Manual code: " + net.room + ".";
      } catch (e) {
        $("pairHint").textContent = String(e);
      }
    } else {
      $("pairHint").textContent = "Phone pairing needs HTTPS. Run npm run tunnel (or deploy and set PUBLIC_ORIGIN). Localhost is only a desktop preview.";
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
    const r = await net.api("create", {
      game: "kart",
      mode: pick("kmode", "race"),
      track: pick("kmode", "race") === "cup" ? CUPS[Number(pick("kcup", "0"))].tracks[0] : pick("ktrack", "court"),
      bot: pick("kbot", "club"),
      items: pick("kitems", "on") === "on",
      shared: players === "multi" && pick("kscreen", "split") === "shared",
      // Quick races: /kart?laps=1 (default 3).
      laps: Number(params.get("laps")) || 3,
    });
    net.room = r.code;
    net.credential = r.credential;
    host = true;
    pair = r.pair;
    publicOrigin = r.publicOrigin;
    sessionStorage.setItem("kart-host", JSON.stringify({ room: r.code, credential: r.credential, pair: r.pair }));
    render(r.state);
    entered();
  });
  try {
    const saved = JSON.parse(sessionStorage.getItem("kart-host") || "null");
    if (saved?.room && saved.credential) {
      net.room = saved.room;
      net.credential = saved.credential;
      pair = saved.pair;
      host = true;
      entered();
    }
  } catch {}
  net.onStatus = (s) => put("connection", esc(s) + " · " + net.room);
  net.onGone = () => {
    sessionStorage.removeItem("kart-host");
    location.reload();
  };
  net.onState = (s) => {
    if (s.game === "kart") render(s.state as Kart);
  };
  act("refreshPair", async () => {
    pair = (await net.api("pair", {})).pair;
    pairing();
  });
  act("start", () => net.api("start", {}));
  act("next", () => net.api("kart/next", {}));
  act("again", () => net.api(cur?.phase === "podium" ? "start" : "kart/next", {}));
  act("resLobby", () => net.api("kart/lobby", {}));
  act("toLobby", () => net.api("kart/lobby", {}));
  act("pause", () => net.api("pause", {}));
  act("resume", () => net.api("resume", {}));
  act("leave", () => {
    sessionStorage.removeItem("kart-host");
    net.stop();
    location.href = "/kart";
  });
  document.querySelectorAll<HTMLButtonElement>("#trackSeg button").forEach((b) => (b.onclick = () => net.api("kart/options", { track: b.dataset.v }).catch(error)));
  $("drivers").addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-bot]")?.dataset.bot;
    if (id) net.api("kart/bot", { id }).catch(error);
  });
  // ——— HUD per view ———
  let rects: { id: string; x: number; y: number; w: number; h: number }[] = [];
  const shownCall = new Map<string, number>();
  const callTimers = new Map<string, number>();
  scene.onViews = (r) => {
    const key = r.map((q) => `${q.id}:${q.x | 0},${q.y | 0},${q.w | 0},${q.h | 0}`).join("|");
    if (key !== rects.map((q) => `${q.id}:${q.x | 0},${q.y | 0},${q.w | 0},${q.h | 0}`).join("|")) {
      rects = r;
      layoutHud();
    }
  };
  function layoutHud() {
    const hud = $("khud");
    hud.innerHTML = rects
      .map(
        (q, i) =>
          `<div class="kview${rects.length > 1 ? " small" : ""}${q.y < 40 ? " top" : ""}${q.x < 40 && q.y + q.h > innerHeight - 40 ? " left" : ""}" id="kview${i}"><div class="kplace" id="kplace${i}"></div><div class="klap" id="klap${i}"></div><div class="kitem" id="kitem${i}"></div><div class="kcharge" id="kcharge${i}"></div><div class="kwrong hidden" id="kwrong${i}">WRONG WAY</div><div class="kwait hidden" id="kwait${i}"></div><div class="tcall kcall hidden" id="kcall${i}"></div></div>`,
      )
      .join("");
    rects.forEach((q, i) => {
      const s = document.getElementById("kview" + i)!.style;
      s.left = q.x + "px";
      s.top = q.y + "px";
      s.width = q.w + "px";
      s.height = q.h + "px";
    });
    lastWrite.clear();
    if (cur) hudState(cur);
  }
  function hudState(k: Kart) {
    const racing = k.phase === "race" || k.phase === "countdown";
    rects.forEach((q, i) => {
      const r = q.id === "shared" ? undefined : k.racers.find((x) => x.id === q.id);
      if (!r || !racing) {
        put("kplace" + i, "");
        put("klap" + i, "");
        put("kitem" + i, "");
        put("kcharge" + i, "");
        $("kwrong" + i)?.classList.add("hidden");
        $("kwait" + i)?.classList.add("hidden");
        return;
      }
      put("kplace" + i, `<b>${ordinal(r.place).replace(/\D+$/, "")}</b><i>${ordinal(r.place).replace(/^\d+/, "")}</i><small>/${k.racers.length}</small>`);
      put("klap" + i, r.finished ? `<b>FINISHED</b><small>${time(r.finished)}</small>` : `LAP <b>${Math.max(1, Math.min(k.laps, r.lap))}</b>/${k.laps}${r.best ? `<small>Best ${time(r.best)}</small>` : ""}`);
      put("kitem" + i, `${itemIcon(r.rolling > 0 ? "roll" : r.item, r.uses)}<small>${esc(itemName(r))}</small>`);
      const lvl = driftLevel(r.charge);
      put("kcharge" + i, r.drift ? `<svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect width="${Math.min(100, (r.charge / DRIFT_LEVELS[2]) * 100).toFixed(0)}" height="10" class="lvl${lvl}"/></svg>` : "");
      $("kwrong" + i)?.classList.toggle("hidden", !r.wrong);
      const waiting = !!r.away && !r.botFor;
      $("kwait" + i)?.classList.toggle("hidden", !waiting && !r.botFor);
      if (waiting) put("kwait" + i, `Waiting for ${esc(r.name)}'s phone… ${Math.max(0, Math.ceil(WAIT_LIMIT - (Date.now() - r.away) / 1000))} s`);
      else if (r.botFor) put("kwait" + i, `A bot is driving for ${esc(r.name)} · rejoin with the same phone to take over`);
    });
    // Callouts: the newest for each view's driver (or any human, in the shared view).
    for (const c of k.callouts) {
      if (shownCall.has(c.who) && shownCall.get(c.who)! >= c.at) continue;
      shownCall.set(c.who, c.at);
      let i = rects.findIndex((q) => q.id === c.who);
      if (i < 0 && rects.length === 1 && rects[0].id === "shared") i = 0;
      if (i < 0) continue;
      const el = $("kcall" + i);
      if (!el) continue;
      const who = rects[i].id === "shared" ? k.racers.find((r) => r.id === c.who)?.name ?? "" : "";
      el.className = "tcall kcall kind-" + (c.kind || "good");
      el.innerHTML = `<div class="callout-name">${esc(c.text)}</div>${who ? `<div class="callout-why"><i></i>${esc(who)}</div>` : ""}`;
      clearTimeout(callTimers.get(c.who));
      callTimers.set(c.who, window.setTimeout(() => el.classList.add("hidden"), 1700));
      if (c.kind === "finish") {
        scene.finishReplay(c.who);
        scene.roar(1);
      }
      if (c.kind === "lap") scene.tone(660, 990, 0.35, 0.08, "triangle");
    }
  }
  // ——— Rendering the state ———
  let lastCount = 99;
  /** Time trial ghost: recorded on this screen, best lap saved in this browser. */
  let rec: number[] = [],
    recLap = -1,
    recAt = 0,
    recLaps = 0;
  const ghostKey = (id: TrackId) => "kart-ghost-" + id;
  function ghost(k: Kart) {
    const me = k.racers.find((r) => !r.bot);
    if (k.mode !== "trial" || !me || k.phase !== "race") return;
    const now = performance.now();
    if (me.lap !== recLap) {
      // A lap just ended: keep it if it beat the saved best.
      if (recLap >= 1 && me.laps.length > recLaps) {
        const lt = me.laps[me.laps.length - 1];
        let best: { time: number } | null = null;
        try {
          best = JSON.parse(localStorage.getItem(ghostKey(k.track)) || "null");
        } catch {}
        if (!best || lt < best.time) {
          try {
            localStorage.setItem(ghostKey(k.track), JSON.stringify({ time: lt, samples: rec }));
          } catch {}
        }
      }
      recLaps = me.laps.length;
      recLap = me.lap;
      recAt = now;
      rec = [];
      try {
        const g = JSON.parse(localStorage.getItem(ghostKey(k.track)) || "null");
        scene.ghost = g?.samples ?? null;
      } catch {}
      scene.ghostStart = now;
    }
    const tt = (now - recAt) / 1000;
    if (!rec.length || tt - rec[rec.length - 5] > 0.1) rec.push(+tt.toFixed(2), me.x, me.y, me.z, me.h);
  }
  function render(k: Kart) {
    cur = k;
    scene.update(k);
    // This screen's drivers: phones paired with this screen's QR (or by room code to the host).
    const mine = k.racers.filter((r) => !r.bot && (r.display || "host") === displayId).map((r) => r.id);
    scene.local = mine;
    scene.shared = k.shared || mine.length > 4;
    $("layout").textContent = "Screen: " + (scene.shared ? "Shared" : "Split");
    const playing = k.phase !== "lobby";
    document.body.classList.toggle("playing", playing && k.phase !== "results" && k.phase !== "podium");
    $("start").classList.toggle("hidden", !host || (k.phase !== "lobby" && k.phase !== "podium"));
    $("next").classList.toggle("hidden", !host || k.phase !== "results");
    $("next").innerHTML = (k.mode === "cup" ? (k.cupRace >= CUPS[k.cup].tracks.length - 1 ? "Final standings" : "Next race") : "Race again") + " <span>→</span>";
    const racing = k.phase === "race" || k.phase === "countdown";
    music.intensity = racing ? 1 : 0;
    $("pause").classList.toggle("hidden", !host || !racing || k.paused);
    $("resume").classList.toggle("hidden", !host || !k.paused);
    $("toLobby").classList.toggle("hidden", !host || racing);
    $("trackOpts").classList.toggle("hidden", !host || k.mode === "cup" || (k.phase !== "lobby" && k.phase !== "results"));
    document.querySelectorAll<HTMLButtonElement>("#trackSeg button").forEach((x) => x.classList.toggle("on", x.dataset.v === k.track));
    put(
      "drivers",
      k.racers
        .filter((r) => !r.bot || k.phase !== "lobby")
        .map((r) => {
          const body = BODIES.find((b) => b.id === r.body)!.name;
          const status = r.bot ? "Bot · " + BOT_LEVELS.find((b) => b.id === r.bot)!.name : !r.connected ? "phone away" : r.ready ? "ready ✓" : "setting up the phone…";
          const botBtn = host && r.away && !r.botFor && racing ? ` <button class="link" data-bot="${r.id}">Let a bot drive</button>` : "";
          return `<li><span class="num">${dot(paint(r))}</span><b>${esc(r.name)}</b><small>${body} · ${status}${k.mode === "cup" ? ` · ${r.points} pts` : ""}</small>${botBtn}</li>`;
        })
        .join("") || `<li class="empty">Scan the QR with a phone to join · up to ${k.mode === "trial" ? 1 : 8}.</li>`,
    );
    $("lobbyHint").textContent = k.mode === "cup" ? `${CUPS[k.cup].name} · race ${k.cupRace + 1} of 4` : k.mode === "trial" ? "Time trial" : "";
    put("message", esc(k.message));
    // Countdown lights: 3, 2, 1, GO.
    const cd = k.phase === "countdown" ? Math.ceil(-k.clock) : k.phase === "race" && k.clock < 0.8 ? 0 : -1;
    $("kcount").classList.toggle("hidden", cd < 0 || cd > 3);
    if (cd >= 0 && cd <= 3) {
      put("kcount", cd ? `<b class="n${cd}">${cd}</b><small>Hold DRIFT${k.racers.some((r) => !r.bot) ? " (or tilt to gas)" : ""} on 1 for a start boost</small>` : `<b class="go">GO!</b>`);
      if (cd !== lastCount) scene.tone(cd ? 440 : 880, cd ? 440 : 880, cd ? 0.18 : 0.5, 0.08, "square");
    }
    lastCount = cd;
    // Minimap and the shared view's leaderboard.
    $("kmap").classList.toggle("hidden", !racing);
    if (racing) put("kmap", minimap(k, mine));
    const board = racing && (scene.shared || !mine.length);
    $("kboard").classList.toggle("hidden", !board);
    if (board)
      put(
        "kboard",
        [...k.racers]
          .sort((a, b) => a.place - b.place)
          .map((r) => `<div class="${r.bot ? "" : "human"}">${dot(paint(r))}<b>${r.place}</b>${esc(r.name)}<small>${r.finished ? time(r.finished) : "L" + Math.max(1, Math.min(k.laps, r.lap))}</small></div>`)
          .join(""),
      );
    hudState(k);
    ghost(k);
    // Results and the cup podium.
    const over = k.phase === "results" || k.phase === "podium";
    $("results").classList.toggle("hidden", !over);
    if (over) {
      const podium = k.phase === "podium";
      const rows = [...k.racers].sort((a, b) => (podium ? b.points - a.points : a.place - b.place));
      const win = rows[0];
      put("resSmall", podium ? "CUP FINAL STANDINGS" : k.mode === "cup" ? `${CUPS[k.cup].name.toUpperCase()} · RACE ${k.cupRace + 1} OF 4 · ${track(k.track).def.name.toUpperCase()}` : k.mode === "trial" ? "TIME TRIAL" : "RESULTS");
      put("resTitle", k.mode === "trial" ? `Best lap ${win.best ? time(win.best) : "—"}` : `${esc(win.name)} wins${podium ? " the cup" : ""}!`);
      put(
        "resTable",
        `<thead><tr><th></th><th>Driver</th><th>${podium ? "" : "Time"}</th><th>${k.mode === "trial" ? "Best lap" : podium ? "" : "Best lap"}</th>${k.mode === "trial" ? "" : `<th>${podium ? "" : "+Pts"}</th><th>${k.mode === "cup" ? "Total" : ""}</th>`}</tr></thead><tbody>${rows
          .map((r, i) => `<tr class="${r.bot ? "" : "human"}"><td>${podium ? i + 1 : r.place}</td><td>${dot(paint(r))}${esc(r.name)}${r.bot ? " <small>BOT</small>" : ""}</td><td>${podium ? "" : time(r.finished)}</td><td>${podium ? "" : r.best ? time(r.best) : "—"}</td>${k.mode === "trial" ? "" : `<td>${podium ? "" : "+" + r.gained}</td><td>${k.mode === "cup" ? r.points : ""}</td>`}</tr>`)
          .join("")}</tbody>`,
      );
      $("again").classList.toggle("hidden", !host);
      $("resLobby").classList.toggle("hidden", !host);
      $("again").innerHTML = (podium ? "New cup" : k.mode === "cup" ? (k.cupRace >= CUPS[k.cup].tracks.length - 1 ? "Final standings" : "Next race") : "Race again") + " <span>→</span>";
    }
  }
  setInterval(() => cur && hudState(cur), 500);
}

// ——————————————————————————— PHONE ———————————————————————————
function phone() {
  app.innerHTML = `<div class="phone kphone"><header class="phead"><div class="logo"><b>Sport</b>le</div><span class="pstat"><span>WHEEL</span>·<i class="dot" id="pDot"></i><span id="connection">NOT CONNECTED</span></span></header>
<div id="join" class="card"><div class="ruler" aria-hidden="true"></div><h1>A steering wheel.<br>In your hands.</h1><p>Hold your phone sideways like a wheel. Tilt to steer.</p><div class="number">01 / GRAB A KART</div><label for="code">Room code</label><input id="code" maxlength="6" autocomplete="off" placeholder="ABC123"><label for="nickname">Your name</label><input id="nickname" maxlength="20" placeholder="Driver"><label for="outfit">Outfit</label><select id="outfit">${OUTFITS.map((o) => `<option value="${o.id}">${o.name}</option>`).join("")}</select><label for="body">Kart</label><select id="body">${BODIES.map((b) => `<option value="${b.id}">${b.name} · ${b.note}</option>`).join("")}</select><label for="paint">Paint</label><select id="paint">${PADDLES.map((g, i) => `<option value="${i}">${g.name}</option>`).join("")}</select><button class="full" id="connect">Join the race</button></div>
<div id="turn" class="kturn hidden"><svg viewBox="0 0 120 80" aria-hidden="true"><rect x="40" y="8" width="40" height="64" rx="8" fill="none" stroke="#ebf538" stroke-width="4"/><path d="M92 40 a34 34 0 0 1 -34 34" fill="none" stroke="#fff" stroke-width="3"/><path d="M52 70 l6 4 -2 6" fill="none" stroke="#fff" stroke-width="3"/></svg><b>Turn your phone sideways</b><small>Hold it like a steering wheel, screen toward you.</small></div>
<div id="controls" class="hidden">
<section id="setup" class="setup ksetup"><div class="stephead"><span class="stepno"><b id="stepNo">01</b> / 03</span><span class="dashes" aria-hidden="true"><i></i><i></i><i></i></span><span class="steptag" id="stepTag">MOTION</span></div><div class="eyebrow hidden" id="welcomeBack">WELCOME BACK · YOUR STEERING IS SAVED</div><div class="kcols"><div><h2 class="big" id="stepTitle">Turn on motion.</h2><p class="lead" id="stepText"></p></div><div class="kgauge" id="sGauge"></div></div>
<button class="hold" id="hold"><span class="htop"><b id="holdLabel">TAP TO START</b><small id="holdHint">TURNS ON MOTION</small></span><span class="segs" id="holdSegs"></span></button>
<button class="linkbig hidden" id="skipRange">Skip: use my saved steering</button><div class="savedcard hidden" id="savedCard"><span class="savedtick">✓</span><b>Saved on this phone</b><small>Next time: set the centre and you're in.</small></div></section>
<div id="race" class="krace hidden">
  <button class="kbtn drift" id="driftBtn"><b>DRIFT</b><small>tap = hop</small></button>
  <div class="kmid">
    <div class="ktop"><div class="kplacep" id="pPlace">—</div><button class="kpause" id="menuBtn" aria-label="Menu">❚❚</button><div class="klapp" id="pLap"></div></div>
    <div class="kwheel" id="pWheel"></div>
    <div class="kmeter"><i id="pCharge"></i></div>
    <div class="kstatus" id="pStatus">Waiting for the race to start</div>
  </div>
  <button class="kbtn item" id="itemBtn"><span id="pItem"></span><b>ITEM</b><small id="pItemName">tap = forward</small></button>
  <div class="kcallp hidden" id="pCall"></div>
</div>
<dialog id="menu" class="kmenu"><h2>Menu</h2><button class="cta" id="pauseRace">Pause race</button><p class="fine" id="pauseNote"></p><div class="optrow"><span>Steering</span><div class="seg" id="sensSeg"><button data-v="gentle">Gentle</button><button data-v="normal">Normal</button><button data-v="sharp">Sharp</button></div></div><div class="optrow"><span>Steering assist</span><div class="seg" id="assistSeg"><button data-v="on">On</button><button data-v="off">Off</button></div></div><p class="fine">Assist: a light pull back toward the middle of the road near its edges.</p><div class="optrow"><span>Gas</span><div class="seg" id="gasSeg"><button data-v="auto">Automatic</button><button data-v="tilt">Tilt to drive</button></div></div><p class="fine">Tilt to drive: top edge away from you = gas, toward you = brake/reverse.</p><button class="link" id="recenter">Set the centre again</button><button class="link" id="redo">Set up steering again</button><button class="ghost" id="menuClose">Back to the race</button></dialog>
</div><div id="error" role="alert"></div></div>`;
  document.body.classList.add("controller", "kartphone");
  const PROFILE = "sportle-kart";
  const savedProfile = (): SteerProfile | null => {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE) || "null");
      return p && (p.sign === 1 || p.sign === -1) && p.left > 0 && p.right > 0 ? p : null;
    } catch {
      return null;
    }
  };
  {
    const o = $<HTMLSelectElement>("outfit"),
      b = $<HTMLSelectElement>("body"),
      c = $<HTMLSelectElement>("paint");
    const so = localStorage.getItem("pov-outfit");
    if (OUTFITS.some((x) => x.id === so)) o.value = so!;
    const sb = localStorage.getItem("kart-body");
    if (BODIES.some((x) => x.id === sb)) b.value = sb!;
    c.value = localStorage.getItem("kart-paint") || "2";
    o.onchange = () => localStorage.setItem("pov-outfit", o.value);
    b.onchange = () => localStorage.setItem("kart-body", b.value);
    c.onchange = () => localStorage.setItem("kart-paint", c.value);
    $<HTMLInputElement>("code").value = params.get("room") || "";
    const name = localStorage.getItem("kart-name");
    if (name) $<HTMLInputElement>("nickname").value = name;
  }
  const reader = new SteerReader();
  const gestures = new GestureReader();
  reader.sensitivity = (["gentle", "normal", "sharp"].includes(localStorage.getItem("kart-sens") || "") ? localStorage.getItem("kart-sens") : "normal") as Sensitivity;
  let gas: "auto" | "tilt" = localStorage.getItem("kart-gas") === "tilt" ? "tilt" : "auto";
  let assist = localStorage.getItem("kart-assist") !== "off";
  let up: [number, number, number] = [0, 1, 0];
  let enabled = false,
    enabledAt = 0,
    orientAt = 0,
    seq = 0,
    playerId = "",
    inflight = 0,
    ready = false,
    redo = false,
    wake: any = null,
    driftHeld = false,
    hopId = 0,
    itemId = 0,
    flickId = 0,
    shakeId = 0,
    itemDown = 0,
    backNext = false;
  let state: Kart | null = null;
  type Step = "motion" | "center" | "left" | "right" | "done";
  let stepNow: Step = "motion";
  let leftAngle = 0;
  const sensorLive = () => enabled && performance.now() - orientAt < 1200;
  // ——— Landscape: try to lock it; otherwise ask to turn the phone ———
  const portrait = () => matchMedia("(orientation: portrait)").matches;
  const syncTurn = () => $("turn").classList.toggle("hidden", !(playerId && portrait()));
  addEventListener("resize", syncTurn);
  screen.orientation?.addEventListener?.("change", syncTurn);
  const lockLandscape = async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: "hide" } as any);
      await (screen.orientation as any)?.lock?.("landscape");
    } catch {
      /* iPhone Safari and others: the turn card covers it */
    }
  };
  // ——— Setup steps ———
  const STEPS: Step[] = ["motion", "center", "left", "right", "done"];
  const showStep = (s: Step) => {
    stepNow = s;
    const n = s === "motion" ? 1 : s === "center" ? 2 : 3;
    $("stepNo").textContent = "0" + n;
    $("stepTag").textContent = { motion: "MOTION", center: "CENTRE", left: "RANGE", right: "RANGE", done: "SAVED" }[s];
    document.querySelectorAll(".stephead .dashes i").forEach((d, i) => (d.className = i < n ? "on" : ""));
    $("welcomeBack").classList.toggle("hidden", !(s === "center" && savedProfile() && !redo));
    $("stepTitle").textContent = { motion: "Turn on motion.", center: "Hold it level, like a wheel.", left: "Turn all the way left.", right: "Now all the way right.", done: "You're set." }[s];
    $("stepText").textContent = {
      motion: "Phone sideways, screen toward you, both hands. Tap the button to allow motion.",
      center: "Hold the phone level and still, the way you'd hold a wheel driving straight. Press and hold until the bar fills.",
      left: "Turn the phone like a steering wheel, as far left as feels comfortable, and hold it there.",
      right: "Same to the right, as far as feels comfortable, and hold it there.",
      done: "",
    }[s];
    $("hold").classList.toggle("hidden", s !== "motion" && s !== "center");
    $("holdLabel").textContent = s === "motion" ? "TAP TO START" : "HOLD TO SET";
    $("holdHint").textContent = s === "motion" ? "TURNS ON MOTION" : "PRESS AND HOLD";
    $("skipRange").classList.toggle("hidden", !(s === "left" || s === "right"));
    $("skipRange").textContent = savedProfile() ? "Skip: use my saved steering" : "Skip: use standard steering";
    $("savedCard").classList.toggle("hidden", s !== "done");
    $("sGauge").classList.toggle("hidden", s === "motion");
  };
  const segs = (el: HTMLElement, n: number) => {
    if (el.children.length !== n) el.innerHTML = "<i></i>".repeat(n);
  };
  segs($("holdSegs"), 20);
  /** Steering arc: where the wheel is now (-1..1). */
  const arc = (v: number, mark?: number) => {
    const a = v * 70;
    const rad = (d: number) => ((d - 90) * Math.PI) / 180;
    const x = 60 + Math.cos(rad(a)) * 46,
      y = 60 + Math.sin(rad(a)) * 46;
    return `<svg viewBox="0 0 120 70" class="karc" aria-hidden="true"><path d="M16.8 43.4 A46 46 0 0 1 103.2 43.4" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="9" stroke-linecap="round"/><path d="M60 14 A46 46 0 0 ${a >= 0 ? 1 : 0} ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="#ebf538" stroke-width="9" stroke-linecap="round"/>${mark !== undefined ? `<circle cx="${(60 + Math.cos(rad(mark * 70)) * 46).toFixed(1)}" cy="${(60 + Math.sin(rad(mark * 70)) * 46).toFixed(1)}" r="4" fill="#ff8a1f"/>` : ""}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="#fff"/></svg>`;
  };
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
    await new Promise((ok) => setTimeout(ok, 1000));
    $("setup").classList.add("hidden");
    $("race").classList.remove("hidden");
  };
  // ——— Sensors ———
  function orientation(e: DeviceOrientationEvent) {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    orientAt = performance.now();
    up = upVector(e.alpha, e.beta, e.gamma);
    reader.feed(up, orientAt);
    rangeStep();
  }
  function motion(e: DeviceMotionEvent) {
    const a = e.acceleration;
    if (!a || a.x === null || a.y === null || a.z === null || !ready) return;
    const g = gestures.feed([a.x, a.y, a.z], up, performance.now());
    if (g === "flick") {
      flickId++;
      tap("flick");
    } else if (g === "shake") {
      shakeId++;
      tap("shake");
    }
  }
  // Range steps: turned well past the centre and held still there for 0.6 s.
  let holdAt = 0,
    holdVal = 0;
  function rangeStep() {
    if (stepNow !== "left" && stepNow !== "right") return;
    const delta = wrap(reader.angle - reader.center);
    put("sGauge", arc(Math.max(-1, Math.min(1, -delta / 45))));
    const far = Math.abs(delta) >= 15;
    const now = performance.now();
    if (!far || Math.abs(delta - holdVal) > 4) {
      holdVal = delta;
      holdAt = now;
      return;
    }
    if (now - holdAt < 600) return;
    holdAt = now + 1e9;
    navigator.vibrate?.(40);
    if (stepNow === "left") {
      leftAngle = reader.angle;
      showStep("right");
      holdVal = 0;
      holdAt = now;
      return;
    }
    const res = learnSteer(reader.center, leftAngle, reader.angle);
    if (!res.ok) {
      error(res.reason);
      showStep("left");
      holdAt = now;
      return;
    }
    error("");
    reader.profile = res.profile;
    localStorage.setItem(PROFILE, JSON.stringify(res.profile));
    goReady();
  }
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
      lockLandscape();
      if ("wakeLock" in navigator) wake = await (navigator as any).wakeLock.request("screen").catch(() => null);
      showStep("center");
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
  let lastAngle = 0;
  $("hold").addEventListener("pointerdown", (e) => {
    if (!enabled || stepNow !== "center") return;
    e.preventDefault();
    if (!sensorLive()) return holdReset("WAITING FOR SENSORS");
    holdStart = performance.now();
    lastAngle = wheelAngle(up);
    clearInterval(holdTimer);
    holdTimer = window.setInterval(() => {
      const a = wheelAngle(up);
      const still = Math.abs(wrap(a - lastAngle)) < 2.5;
      lastAngle = a;
      // Screen roughly toward you (not lying flat).
      const upright = Math.abs(up[2]) < 0.8;
      if (!still || !upright) holdStart = Math.min(performance.now(), holdStart + 80);
      $("holdHint").textContent = !upright ? "HOLD IT UP, SCREEN TOWARD YOU" : "HOLD STILL…";
      const k = Math.min(1, (performance.now() - holdStart) / 800);
      $("holdSegs").querySelectorAll("i").forEach((x, i) => x.classList.toggle("on", i < Math.round(k * 20)));
      if (k < 1) return;
      holdReset("SET ✓");
      reader.setCenter(up);
      navigator.vibrate?.(40);
      const prof = savedProfile();
      if (prof && !redo) {
        reader.profile = prof;
        goReady();
      } else {
        holdAt = performance.now();
        holdVal = 0;
        showStep("left");
      }
    }, 40);
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"])
    $("hold").addEventListener(ev, () => {
      if (holdStart) holdReset();
    });
  $("skipRange").onclick = () => {
    reader.profile = savedProfile() ?? { ...DEFAULT_STEER };
    localStorage.setItem(PROFILE, JSON.stringify(reader.profile));
    goReady();
  };
  // ——— Buttons: DRIFT (left thumb) and ITEM (right thumb) ———
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  /** Haptics where the phone supports it (Android); a visual flash on iPhone. */
  const tap = (what: string, ms = 18) => {
    if (!isIOS && navigator.vibrate) navigator.vibrate(ms);
    const el = what === "item" ? $("itemBtn") : what === "drift" ? $("driftBtn") : $("pWheel");
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  };
  const drift = $("driftBtn"),
    item = $("itemBtn");
  drift.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try {
      drift.setPointerCapture(e.pointerId);
    } catch {}
    driftHeld = true;
    hopId++;
    drift.classList.add("held");
    tap("drift");
  });
  const driftUp = () => {
    driftHeld = false;
    drift.classList.remove("held");
  };
  drift.addEventListener("pointerup", driftUp);
  drift.addEventListener("pointercancel", driftUp);
  item.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try {
      item.setPointerCapture(e.pointerId);
    } catch {}
    itemDown = performance.now();
    item.classList.add("held");
  });
  const itemUp = (cancel: boolean) => {
    if (!itemDown) return;
    itemDown = 0;
    item.classList.remove("held");
    if (cancel) return;
    // Held and tilted toward you at the moment of release: throw it behind.
    backNext = reader.pulledBack();
    itemId++;
    tap("item", 25);
  };
  item.addEventListener("pointerup", () => itemUp(false));
  item.addEventListener("pointercancel", () => itemUp(true));
  for (const b of [drift, item]) b.addEventListener("contextmenu", (e) => e.preventDefault());
  // ——— Menu ———
  const menu = $<HTMLDialogElement>("menu");
  const syncMenu = () => {
    document.querySelectorAll<HTMLButtonElement>("#sensSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === reader.sensitivity));
    document.querySelectorAll<HTMLButtonElement>("#gasSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === gas));
    document.querySelectorAll<HTMLButtonElement>("#assistSeg button").forEach((b) => b.classList.toggle("on", (b.dataset.v === "on") === assist));
    const solo = !!state && state.racers.filter((r) => !r.bot).length === 1;
    ($("pauseRace") as HTMLButtonElement).disabled = !solo;
    $("pauseRace").textContent = state?.paused ? "Resume race" : "Pause race";
    $("pauseNote").textContent = solo ? "" : "Only the host's screen can pause a race with several drivers.";
  };
  $("menuBtn").onclick = () => {
    syncMenu();
    menu.showModal();
  };
  $("menuClose").onclick = () => menu.close();
  $("pauseRace").onclick = () => net.api(state?.paused ? "resume" : "pause", {}).then(syncMenu).catch(error);
  document.querySelectorAll<HTMLButtonElement>("#sensSeg button").forEach(
    (b) =>
      (b.onclick = () => {
        reader.sensitivity = b.dataset.v as Sensitivity;
        localStorage.setItem("kart-sens", reader.sensitivity);
        syncMenu();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("#gasSeg button").forEach(
    (b) =>
      (b.onclick = () => {
        gas = b.dataset.v === "tilt" ? "tilt" : "auto";
        localStorage.setItem("kart-gas", gas);
        syncMenu();
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("#assistSeg button").forEach(
    (b) =>
      (b.onclick = () => {
        assist = b.dataset.v === "on";
        localStorage.setItem("kart-assist", assist ? "on" : "off");
        syncMenu();
      }),
  );
  $("recenter").onclick = () => {
    menu.close();
    ready = false;
    $("race").classList.add("hidden");
    $("setup").classList.remove("hidden");
    showStep("center");
  };
  $("redo").onclick = () => {
    redo = true;
    $("recenter").click();
  };
  // ——— Joining ———
  async function claim(credential?: string) {
    const room = (params.get("room") || $<HTMLInputElement>("code").value).trim().toUpperCase();
    if (!/^[A-F0-9]{6}$/.test(room)) throw Error("Enter the six-character room code from the TV.");
    net.room = room;
    const name = ($<HTMLInputElement>("nickname")?.value || localStorage.getItem("kart-name") || "Driver").trim();
    const r = await net.api("join", {
      name,
      outfit: localStorage.getItem("pov-outfit") || "classic",
      gear: cleanGear({}),
      body: $<HTMLSelectElement>("body")?.value || localStorage.getItem("kart-body") || "classic",
      color: Number($<HTMLSelectElement>("paint")?.value || localStorage.getItem("kart-paint") || 2),
      pair: hash.get("pair") || undefined,
      credential,
    });
    localStorage.setItem("kart-controller-" + room, r.credential);
    if (!credential) {
      localStorage.setItem("kart-name", name);
      // A fresh page after typing; the kart is kept with the saved credential.
      const to = "/kart/phone?room=" + room + (location.hash.includes("test") ? "#test" : "");
      if (to === location.pathname + location.search + location.hash) location.reload();
      else location.replace(to);
      return;
    }
    net.credential = r.credential;
    playerId = r.player.id;
    seq = r.seq + 1;
    document.body.classList.add("joined");
    $("join").replaceChildren();
    $("join").classList.add("hidden");
    $("controls").classList.remove("hidden");
    syncTurn();
    await net.clock();
    net.stream();
    showStep("motion");
  }
  $("connect").onclick = () => claim().catch(error);
  {
    const room = (params.get("room") || "").toUpperCase();
    const saved = localStorage.getItem("kart-controller-" + room);
    if (/^[A-F0-9]{6}$/.test(room) && saved) {
      $("join").replaceChildren();
      claim(saved).catch(() => {
        localStorage.removeItem("kart-controller-" + room);
        location.replace("/kart/phone?room=" + room);
      });
    }
  }
  net.onStatus = (s) => {
    put("connection", esc(s.toUpperCase()));
    $("pDot").className = "dot" + (s === "Connected" ? " on" : " wait");
  };
  net.onGone = (reason) => error(reason + ". Scan the QR on the TV again.");
  let callSeen = 0,
    callTimer = 0;
  function phoneState(k: Kart) {
    state = k;
    const me = k.racers.find((r) => r.id === playerId);
    if (!me) return;
    const racing = k.phase === "race" || k.phase === "countdown";
    document.body.classList.toggle("racing", racing);
    put("pPlace", racing || k.phase === "results" ? `<b>${me.place}</b><small>${ordinal(me.place).replace(/^\d+/, "")}/${k.racers.length}</small>` : "—");
    put("pLap", racing ? (me.finished ? "FINISHED" : `LAP <b>${Math.max(1, Math.min(k.laps, me.lap))}</b>/${k.laps}`) : k.mode === "cup" ? `CUP ${k.cupRace + 1}/4` : "");
    put("pItem", itemIcon(me.rolling > 0 ? "roll" : me.item, me.uses));
    put("pItemName", me.rolling > 0 ? "rolling…" : me.item ? esc(ITEMS[me.item].name) + (me.uses > 1 ? ` ×${me.uses}` : "") : "no item");
    $("itemBtn").classList.toggle("has", !!me.item && me.rolling <= 0);
    const lvl = driftLevel(me.charge);
    const ch = $("pCharge");
    ch.style.width = (me.drift ? Math.min(100, (me.charge / DRIFT_LEVELS[2]) * 100) : 0).toFixed(0) + "%";
    ch.className = "lvl" + lvl;
    let status = "";
    if (k.phase === "lobby") status = ready ? "You're in. The TV starts the race." : "Finish setup to be ready.";
    else if (k.phase === "countdown") status = gas === "auto" ? "Hold DRIFT on 1 for a start boost" : "Tilt to gas on 1 for a start boost";
    else if (k.phase === "race") status = me.net > 0 ? "NETTED · shake your phone!" : me.wrong ? "WRONG WAY" : me.finished ? "Finished! " + ordinal(me.place) : k.paused ? "Paused" : "";
    else if (k.phase === "results") status = `${ordinal(me.place)} · +${me.gained} pts`;
    else if (k.phase === "podium") status = `Cup total: ${me.points} pts`;
    put("pStatus", esc(status));
    // Your callouts (DRIFT BOOST!, NICE TRICK!, FINAL LAP! …) also pop on the phone.
    for (const c of k.callouts)
      if (c.who === playerId && c.at > callSeen) {
        callSeen = c.at;
        $("pCall").textContent = c.text;
        $("pCall").className = "kcallp kind-" + (c.kind || "good");
        clearTimeout(callTimer);
        callTimer = window.setTimeout(() => $("pCall").classList.add("hidden"), 1300);
        if (c.kind === "bad") tap("wheel", 60);
      }
  }
  net.onState = (s) => {
    if (s.game === "kart") phoneState(s.state as Kart);
  };
  setInterval(() => {
    if (stepNow === "center") put("sGauge", arc(0));
    if (ready) put("pWheel", arc(reader.value, reader.target));
    if (enabled && !sensorLive() && performance.now() - enabledAt > 5000) error("No live sensor data. Check the browser's motion permission, or use another phone.");
  }, 60);
  // ~40 Hz input: steering, throttle, drift held, and presses with ids (applied once).
  setInterval(async () => {
    if (!net.credential || net.gone || inflight >= 2 || document.hidden) return;
    inflight++;
    const live = sensorLive();
    const k = state;
    const countdown = k?.phase === "countdown";
    const throttle = gas === "tilt" ? reader.throttle() : countdown ? (driftHeld ? 1 : 0) : 1;
    const input: Input & Record<string, unknown> = {
      seq: seq++,
      t: Date.now() + net.offset,
      pitch: 0,
      roll: wrap(reader.angle - reader.center),
      yaw: 0,
      strength: 0,
      direction: 0,
      swing: false,
      sensors: live,
      calibrated: ready && live,
      mx: ready ? reader.value : 0,
      mz: ready ? throttle : 0,
      drift: driftHeld && !countdown,
      assist,
      hopId,
      itemId,
      back: backNext,
      flickId,
      shakeId,
    };
    try {
      await net.api("input", input);
    } catch {
      put("connection", "RECONNECTING");
    } finally {
      inflight--;
    }
  }, 25);
  setInterval(() => {
    if (net.credential) net.clock().catch(() => {});
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      driftUp();
      net.api("background", {}).catch(() => {});
      wake?.release?.();
      wake = null;
    } else if (net.credential) {
      net.kick();
      if ("wakeLock" in navigator && enabled) (navigator as any).wakeLock.request("screen").then((w: any) => (wake = w)).catch(() => {});
    }
  });
  void STEPS;
  void SENSITIVITY;
  void LAPS;
  void gripSide;
  if (location.hash.includes("test")) (window as any).__kartPhone = { reader, gestures, get state() { return state; }, get ready() { return ready; } };
}
