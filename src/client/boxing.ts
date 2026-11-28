/**
 * Sportle Boxing: the TV page (/boxing) and the phone glove (/boxing/phone). Same transport as
 * the other games (authenticated HTTP input + SSE snapshots, reconnect), the same pairing QR and
 * the same phone setup style. The phone reads punches, guard and dodges from its own motion and
 * sends each punch as one input (type, hand, power, timestamp, id); the server decides every hit.
 */
import { Connection } from "./net.ts";
import {
  BOTS,
  BOT_LEVELS,
  COACH,
  PUNCH,
  PUNCH_TYPES,
  PoseReader,
  PunchReader,
  RINGS,
  ROUNDS,
  WAIT_LIMIT,
  axesOf,
  botDef,
  defaultProfile,
  learnPunches,
  other,
  score,
  toWorld,
} from "../shared/boxing.ts";
import type { Box, Fighter, Hand, HitEvent, PunchProfile, PunchType, ReadPunch } from "../shared/boxing.ts";
import { OUTFITS, PADDLES, cleanGear } from "../shared/types.ts";
import type { Input } from "../shared/types.ts";
import type { Vec3 } from "../shared/motion.ts";
import { BoxScene, BOX_VIEW_LABELS } from "./boxscene.ts";
import type { BoxView } from "./boxscene.ts";
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
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const net = new Connection();
const params = new URLSearchParams(location.search),
  hash = new URLSearchParams(location.hash.slice(1));
function error(e: unknown) {
  const el = document.getElementById("error");
  if (el) el.textContent = e instanceof Error ? e.message : String(e);
}
const rgb = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(Math.min(1, v) * 255)).join(",")})`;
const clockText = (s: number) => {
  const c = Math.max(0, Math.ceil(s));
  return Math.floor(c / 60) + ":" + String(c % 60).padStart(2, "0");
};
/** A health or stamina bar (SVG: the page's CSP allows no inline style attributes). */
const bar = (v: number, cls: string, flip = false) => {
  const w = Math.max(0, Math.min(100, v)).toFixed(1);
  return `<svg viewBox="0 0 100 10" preserveAspectRatio="none" class="${cls}" aria-hidden="true"><rect class="bg" width="100" height="10"/><rect class="fill${v < 25 ? " low" : ""}" x="${flip ? (100 - Number(w)).toFixed(1) : 0}" width="${w}" height="10"/></svg>`;
};
const pct = (v: number) => Math.round(v * 100);
const typeName = (t: PunchType) => PUNCH[t].name;
const callText = (c: string) => ({ jab: "JAB!", hook: "HOOK!", upper: "UPPERCUT!", guard: "GUARD UP!", duck: "DUCK!", left: "SLIP LEFT!", right: "SLIP RIGHT!" })[c] ?? "";


if (location.pathname === "/boxing/phone") phone();
else tv();

// ——————————————————————————— TV ———————————————————————————
function tv() {
  app.innerHTML = `<canvas id="court" aria-label="3D boxing ring"></canvas>
<header class="topbar"><span></span><nav><a class="link" href="/" id="allGames">All games</a><button class="link" id="music">Music: House</button><button class="link" id="view" title="Change camera (V)">View: Behind you</button><button class="link" id="settingsOpen">Music &amp; sound</button><button class="link" id="sound">Sound on</button><button class="link" id="howtoOpen">How to box</button><button class="link" id="fullscreen">Fullscreen</button></nav></header>
<aside class="panel" id="panel">
  <div class="wordmark" aria-label="Sportle"><span><b>SPORT</b>LE</span><i></i></div>
  <p class="tagline">Boxing. <b>Your phone is the glove.</b></p>
  <div id="setup">
    <div class="step" id="stepPlayers">
      <a class="link back" href="/">← All games</a>
      <h2 class="stephead">Who's boxing?</h2>
      <button class="choice" id="goSolo"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg><span><b>Solo vs bots</b><small>Climb a ladder of ${BOTS.length} opponents</small></span><i>→</i></button>
      <button class="choice" id="goVersus"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3.4"/><circle cx="16.5" cy="8.5" r="3"/><path d="M2 21c1-3.6 3.4-5.4 6-5.4s5 1.8 6 5.4M14 15.8c2.6-.4 5.6 1 7 5.2"/></svg><span><b>2 players</b><small>One TV, one QR · split screen</small></span><i>→</i></button>
      <button class="choice" id="goTraining"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="15" rx="3"/><path d="M12 3V1M7 21h10"/></svg><span><b>Training</b><small>Punching bag and mitt drill</small></span><i>→</i></button>
    </div>
    <div class="step hidden" id="stepOptions">
      <button class="link back" id="backPlayers">← Solo / 2 players / Training</button>
      <h2 class="stephead" id="optHead">Solo vs bots</h2>
      <div class="difficulty" role="radiogroup" aria-label="Ring"><span>Ring</span>${RINGS.map((r, i) => `<input type="radio" name="bring" id="br-${r.id}" value="${r.id}" ${i === 0 ? "checked" : ""}><label for="br-${r.id}">${r.name}</label>`).join("")}</div>
      <div id="soloOpts"><div class="difficulty" role="radiogroup" aria-label="Level"><span>Level</span>${BOT_LEVELS.map((b) => `<input type="radio" name="blevel" id="bl-${b.id}" value="${b.id}" ${b.id === "club" ? "checked" : ""}><label for="bl-${b.id}">${b.name}</label>`).join("")}</div>
      <h3 class="bhead">Opponent</h3><div class="oppgrid" role="radiogroup" aria-label="Opponent">${BOTS.map((b, i) => `<input type="radio" name="bopp" id="bo-${b.id}" value="${b.id}" ${i === 0 ? "checked" : ""}><label for="bo-${b.id}"><svg class="oppdot" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${rgb(b.body)}"/></svg><b>${i + 1}. ${esc(b.name)}</b><small>${esc(b.note)}</small></label>`).join("")}</div><p class="fine" id="tellHint"></p></div>
      <div class="difficulty hidden" role="radiogroup" aria-label="Drill" id="drillRow"><span>Drill</span><input type="radio" name="bdrill" id="bd-bag" value="bag" checked><label for="bd-bag">Punching bag</label><input type="radio" name="bdrill" id="bd-mitts" value="mitts"><label for="bd-mitts">Mitts with ${COACH.name}</label></div>
      <button class="cta" id="create">Into the ring <span>→</span></button>
      <p class="fine">No app to install. Scan, hold your phone like a glove, punch. A second phone can be your other glove.</p>
    </div>
  </div>
  <div id="lobby" class="hidden">
    <div class="eyebrow" id="connection">Connecting</div>
    <div id="pairing" class="pairing"><div class="qrtile"><canvas id="qr" class="qr"></canvas></div><div><small>Room code</small><div class="roomcode" id="roomcode"></div><p class="fine" id="pairHint">Scan with your phone camera.</p><button class="link" id="refreshPair">Refresh pairing link</button></div></div>
    <div class="opts" id="lobbyOpts"><div class="optrow"><span>Ring</span><div class="seg" id="ringSeg">${RINGS.map((r) => `<button data-v="${r.id}">${r.name.split(" ")[0]}</button>`).join("")}</div></div><div class="optrow" id="oppRow"><span>Opponent</span><div class="seg" id="oppSeg">${BOTS.map((b) => `<button data-v="${b.id}">${esc(b.name.split(" ").pop()!)}</button>`).join("")}</div></div><div class="optrow" id="levelRow"><span>Level</span><div class="seg" id="levelSeg">${BOT_LEVELS.map((b) => `<button data-v="${b.id}">${b.name}</button>`).join("")}</div></div><div class="optrow" id="drillSegRow"><span>Drill</span><div class="seg" id="drillSeg"><button data-v="bag">Bag</button><button data-v="mitts">Mitts</button></div></div></div>
    <h3 class="bhead">Fighters <small id="lobbyHint"></small></h3>
    <ol id="fighters" class="border"></ol>
    <div class="bcontrols"><button id="start" class="cta">Ring the bell <span>→</span></button><div class="row inplay"><button id="pause" class="ghost">Pause</button><button id="resume" class="ghost">Resume</button><button id="toLobby" class="ghost">Change ring</button></div></div>
    <p class="fine" id="lag"></p>
    <button id="leave" class="link">← Leave the ring</button>
  </div>
  <div id="error" role="alert"></div>
</aside>
<button class="paneltab" id="panelToggle" aria-controls="panel">Room</button>
<div class="bhud" id="bhud" aria-live="polite"></div>
<div class="bbanner hidden" id="bbanner" aria-live="assertive"></div>
<div class="message" id="message" aria-live="polite">Pick solo, 2 players or training to start.</div>
<div class="gameover bresults hidden" id="results" role="dialog" aria-labelledby="resTitle"><small id="resSmall">RESULT</small><h2 id="resTitle">Winner</h2><table id="resTable"></table><div class="row"><button class="cta" id="again">Rematch <span>→</span></button><button class="cta hidden" id="nextOpp">Next opponent <span>→</span></button><button class="ghost" id="resLobby">Change ring</button></div><p class="goerr" id="resErr"></p></div>
<dialog id="howto"><h2>How to box</h2><ol><li><b>Pick a mode</b> and scan the QR with your phone (2 players: each scans the same code).</li><li><b>Hold the phone in your punching hand</b> like a glove, screen facing sideways toward your thumb. Choose left- or right-handed, hold your guard up, then throw two jabs, two hooks and two uppercuts so the phone learns your style. Saved on the phone.</li><li><b>Jab</b>: a quick straight punch. <b>Hook</b>: swing round from the side. <b>Uppercut</b>: swing up from below. Harder punches hit harder; tired punches are weaker.</li><li><b>Other hand</b>: hold the big <b>SWITCH</b> button with your thumb while you punch. Or pair a second phone as your other glove (on your phone: Add a second phone).</li><li><b>Guard</b>: hold the phone upright in front of your face, still. Blocks jabs; hooks get round it; uppercuts break it.</li><li><b>Dodge</b>: tip the phone left or right to slip (beats jabs and uppercuts), or tip the top toward the TV and down to duck (beats jabs and hooks).</li><li><b>Knocked down?</b> Shake your phone to get up before 10.</li></ol><p class="fine">The phone reads how quickly and which way it moves, not your real punch force, speed or hand position. Power numbers are the game's own scale.</p><button class="cta" id="howtoClose">Got it</button></dialog>`;
  let scene: BoxScene;
  try {
    scene = new BoxScene($<HTMLCanvasElement>("court"));
  } catch (e) {
    error(e);
    return;
  }
  if (location.hash === "#test" || location.hash.includes("test")) (window as any).__boxScene = scene;
  let cur: Box | null = null;
  let host = false,
    pair = "",
    publicOrigin: string | null = null;
  let mode: "solo" | "versus" | "training" = "solo";
  const displayId = "host";
  const step = (id: string) => document.querySelectorAll(".step").forEach((el) => el.classList.toggle("hidden", el.id !== id));
  const pick = (name: string, fallback: string) => document.querySelector<HTMLInputElement>(`input[name=${name}]:checked`)?.value || fallback;
  const options = (m: typeof mode) => {
    mode = m;
    $("optHead").textContent = m === "solo" ? "Solo vs bots" : m === "versus" ? "2 players" : "Training";
    $("soloOpts").classList.toggle("hidden", m !== "solo");
    $("drillRow").classList.toggle("hidden", m !== "training");
    step("stepOptions");
  };
  $("goSolo").onclick = () => options("solo");
  $("goVersus").onclick = () => options("versus");
  $("goTraining").onclick = () => options("training");
  $("backPlayers").onclick = () => step("stepPlayers");
  const syncTell = () => {
    const b = botDef(pick("bopp", "zola") as never);
    $("tellHint").textContent = "Tell: " + b.tell;
  };
  document.querySelectorAll("input[name=bopp]").forEach((r) => r.addEventListener("change", syncTell));
  document.querySelectorAll("input[name=bring]").forEach((r) => r.addEventListener("change", () => !cur && scene.setRing(pick("bring", "neon") as never)));
  syncTell();
  $("howtoOpen").onclick = () => $<HTMLDialogElement>("howto").showModal();
  $("howtoClose").onclick = () => $<HTMLDialogElement>("howto").close();
  $("fullscreen").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  $("panelToggle").onclick = () => document.body.classList.toggle("panel-open");
  // ——— Camera ———
  const VIEWS: BoxView[] = ["behind", "broadcast"];
  const setView = (v: BoxView) => {
    scene.viewMode2 = v;
    $("view").textContent = "View: " + BOX_VIEW_LABELS[v];
    try {
      localStorage.setItem("box-view", v);
    } catch {}
  };
  let savedView: string | null = null;
  try {
    savedView = localStorage.getItem("box-view");
  } catch {}
  setView(VIEWS.includes(savedView as BoxView) ? (savedView as BoxView) : "behind");
  $("view").onclick = () => setView(VIEWS[(VIEWS.indexOf(scene.viewMode2) + 1) % VIEWS.length]);
  addEventListener("keydown", (e) => {
    if (e.code === "KeyV" && !(e.target instanceof HTMLInputElement)) setView(VIEWS[(VIEWS.indexOf(scene.viewMode2) + 1) % VIEWS.length]);
  });
  const music = mountSound({ scene, musicBtn: $("music"), soundBtn: $("sound"), openBtn: $("settingsOpen"), sfxNote: "punches, bell, crowd" });
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
      const url = publicOrigin + "/boxing/phone?room=" + net.room + "#pair=" + pair;
      try {
        drawQR(qr, url);
        qr.classList.remove("hidden");
        $("pairHint").textContent = (cur?.mode === "solo" ? "Scan with your phone." : "Both boxers scan this one QR.") + " Manual code: " + net.room + ".";
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
      game: "boxing",
      mode,
      ring: pick("bring", "neon"),
      level: pick("blevel", "club"),
      opponent: pick("bopp", "zola"),
      drill: pick("bdrill", "bag"),
      // Quick matches: /boxing?round=30&hp=50 (normal fights: 3 × 60 s, full health).
      ...(params.get("round") ? { roundTime: Number(params.get("round")) } : {}),
      ...(params.get("hp") ? { hp: Number(params.get("hp")) } : {}),
    });
    net.room = r.code;
    net.credential = r.credential;
    host = true;
    pair = r.pair;
    publicOrigin = r.publicOrigin;
    sessionStorage.setItem("box-host", JSON.stringify({ room: r.code, credential: r.credential, pair: r.pair }));
    render(r.state);
    entered();
  });
  try {
    const saved = JSON.parse(sessionStorage.getItem("box-host") || "null");
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
    sessionStorage.removeItem("box-host");
    location.reload();
  };
  net.onState = (s) => {
    if (s.game === "boxing") render(s.state as Box);
  };
  act("refreshPair", async () => {
    pair = (await net.api("pair", {})).pair;
    pairing();
  });
  act("start", () => net.api("start", {}));
  act("again", async () => {
    $("resErr").textContent = "";
    await net.api("start", {}).catch((e) => ($("resErr").textContent = e.message));
  });
  act("nextOpp", async () => {
    await net.api("box/next", {});
    await net.api("start", {}).catch((e) => ($("resErr").textContent = e.message));
  });
  act("resLobby", () => net.api("box/lobby", {}));
  act("toLobby", () => net.api("box/lobby", {}));
  act("pause", () => net.api("pause", {}));
  act("resume", () => net.api("resume", {}));
  act("leave", () => {
    sessionStorage.removeItem("box-host");
    net.stop();
    location.href = "/boxing";
  });
  const seg = (id: string, key: string) =>
    document.querySelectorAll<HTMLButtonElement>(`#${id} button`).forEach((b) => (b.onclick = () => net.api("box/options", { [key]: b.dataset.v }).catch(error)));
  seg("ringSeg", "ring");
  seg("oppSeg", "opponent");
  seg("levelSeg", "level");
  seg("drillSeg", "drill");
  $("fighters").addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-bot]")?.dataset.bot;
    if (id) net.api("box/bot", { id }).catch(error);
  });
  // ——— HUD per view ———
  let rects: { id: string; x: number; y: number; w: number; h: number }[] = [];
  const shownCall = new Map<string, number>();
  const callTimers = new Map<string, number>();
  scene.onViews = (r) => {
    const key = r.map((q) => `${q.id}:${q.x | 0},${q.w | 0},${q.h | 0}`).join("|");
    if (key !== rects.map((q) => `${q.id}:${q.x | 0},${q.w | 0},${q.h | 0}`).join("|")) {
      rects = r;
      layoutHud();
    }
  };
  function layoutHud() {
    $("bhud").innerHTML = rects
      .map(
        (_q, i) =>
          `<div class="bview${rects.length > 1 ? " small" : ""}" id="bview${i}"><div class="bbars"><div class="bbar me" id="bme${i}"></div><div class="bclock" id="bclock${i}"></div><div class="bbar them" id="bthem${i}"></div></div><div class="bmid" id="bmid${i}"></div><div class="tcall kcall hidden" id="bcall${i}"></div><div class="bcount hidden" id="bcount${i}"></div><div class="bwait hidden" id="bwait${i}"></div></div>`,
      )
      .join("");
    rects.forEach((q, i) => {
      const s = document.getElementById("bview" + i)!.style;
      s.left = q.x + "px";
      s.top = q.y + "px";
      s.width = q.w + "px";
      s.height = q.h + "px";
    });
    lastWrite.clear();
    if (cur) hudState(cur);
  }
  const barHtml = (f: Fighter | undefined, flip: boolean) =>
    f ? `<b>${esc(f.name)}${f.bot ? ` <small>${esc(BOT_LEVELS.find((l) => l.id === cur?.level)?.name ?? "")}</small>` : ""}</b>${bar(f.hp, "hp", flip)}${bar(f.stamina * 100, "st", flip)}<span class="bdowns">${"●".repeat(f.downs)}</span>` : "";
  function hudState(b: Box) {
    const live = b.phase !== "lobby";
    rects.forEach((q, i) => {
      if (!live) {
        put("bme" + i, "");
        put("bthem" + i, "");
        put("bclock" + i, "");
        put("bmid" + i, "");
        $("bcount" + i)?.classList.add("hidden");
        $("bwait" + i)?.classList.add("hidden");
        return;
      }
      const me = b.fighters.find((f) => f.id === q.id) ?? b.fighters[0];
      const them = b.mode === "training" ? undefined : b.fighters.find((f) => f !== me);
      put("bme" + i, b.mode === "training" && me ? `<b>${esc(me.name)}</b><small class="bstam">STAMINA</small>${bar(me.stamina * 100, "st")}` : barHtml(me, false));
      put("bthem" + i, barHtml(them, true));
      put("bclock" + i, b.mode === "training" ? "TRAINING" : b.phase === "over" ? "FINAL" : `<small>ROUND ${b.round}/${ROUNDS}</small><b>${b.phase === "break" ? "BREAK" : clockText(b.clock)}</b>`);
      // Middle: training feedback, or the get-up meter for a downed fighter.
      let mid = "";
      if (b.mode === "training" && me?.drill) {
        const d = me.drill;
        if (b.drill === "mitts") mid = `<div class="bdrill"><small>${esc(COACH.name)} says</small><b>${d.call ? callText(d.call) : "READY…"}</b><span>Score ${d.score} · streak ${d.streak}</span></div>`;
        else if (me.last) mid = `<div class="bdrill"><small>${typeName(me.last.type)}</small><b>${pct(me.last.power)}</b>${bar(me.last.power * 100, "pw")}<span>Jabs ${d.count.jab} · Hooks ${d.count.hook} · Uppercuts ${d.count.upper}</span></div>`;
        else mid = `<div class="bdrill"><small>Hit the bag</small><b>JAB · HOOK · UPPERCUT</b></div>`;
      }
      put("bmid" + i, mid);
      // The count, with the get-up meter under it for a human on the canvas.
      const counting = b.phase === "down" && b.count.n > 0;
      $("bcount" + i)?.classList.toggle("hidden", !counting);
      if (counting) {
        const downed = b.fighters.find((f) => f.id === b.count.who);
        const own = downed && (downed.id === q.id || rects.length === 1) && !downed.bot && !downed.botFor;
        put("bcount" + i, `<b>${b.count.n}</b><small>${esc(downed?.name ?? "")} is down</small>${own ? `<div class="bgetup"><b>SHAKE YOUR PHONE TO GET UP!</b>${bar(downed.rise * 100, "pw")}</div>` : ""}`);
      }
      const away = b.fighters.find((f) => !f.bot && f.away && !f.botFor);
      $("bwait" + i)?.classList.toggle("hidden", !away);
      if (away) put("bwait" + i, `Waiting for ${esc(away.name)}'s phone… ${Math.max(0, Math.ceil(WAIT_LIMIT - (Date.now() - away.away) / 1000))} s`);
    });
    // Callouts: the newest for each view's fighter (or anyone's, in the one broadcast view).
    for (const c of b.callouts) {
      if (shownCall.has(c.who) && shownCall.get(c.who)! >= c.at) continue;
      shownCall.set(c.who, c.at);
      let i = rects.findIndex((q) => q.id === c.who);
      if (i < 0 && rects.length === 1 && (rects[0].id === "broadcast" || !b.fighters.some((f) => f.id === rects[0].id))) {
        const f = b.fighters.find((q) => q.id === c.who);
        if (!f || f.bot) continue;
        i = 0;
      }
      if (i < 0) continue;
      const el = $("bcall" + i);
      if (!el) continue;
      el.className = "tcall kcall kind-" + (c.kind || "good");
      el.innerHTML = `<div class="callout-name">${esc(c.text)}</div>`;
      clearTimeout(callTimers.get(c.who));
      callTimers.set(c.who, window.setTimeout(() => el.classList.add("hidden"), 1300));
    }
  }
  // ——— Rendering the state ———
  let banner = "",
    bannerTimer = 0;
  const showBanner = (html: string, ms: number, cls = "") => {
    const el = $("bbanner");
    el.className = "bbanner " + cls;
    el.innerHTML = html;
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => el.classList.add("hidden"), ms);
  };
  function render(b: Box) {
    const first = !cur;
    cur = b;
    scene.update(b);
    const mine = b.fighters.filter((f) => !f.bot && (f.display || "host") === displayId).map((f) => f.id);
    scene.local = mine;
    const playing = b.phase !== "lobby";
    document.body.classList.toggle("playing", playing && b.phase !== "over");
    const inFight = b.phase === "intro" || b.phase === "fight" || b.phase === "down" || b.phase === "break" || b.phase === "training";
    music.intensity = b.phase === "fight" || b.phase === "down" ? 1 : 0;
    $("start").classList.toggle("hidden", !host || (b.phase !== "lobby" && b.phase !== "over"));
    $("start").innerHTML = (b.mode === "training" ? "Start training" : "Ring the bell") + " <span>→</span>";
    $("pause").classList.toggle("hidden", !host || !inFight || b.paused);
    $("resume").classList.toggle("hidden", !host || !b.paused);
    $("toLobby").classList.toggle("hidden", !host || b.phase === "lobby");
    $("lobbyOpts").classList.toggle("hidden", !host || (b.phase !== "lobby" && b.phase !== "over"));
    $("oppRow").classList.toggle("hidden", b.mode !== "solo");
    $("levelRow").classList.toggle("hidden", b.mode !== "solo");
    $("drillSegRow").classList.toggle("hidden", b.mode !== "training");
    for (const [id, v] of [["ringSeg", b.ring], ["oppSeg", b.opponent], ["levelSeg", b.level], ["drillSeg", b.drill]] as const)
      document.querySelectorAll<HTMLButtonElement>(`#${id} button`).forEach((x) => x.classList.toggle("on", x.dataset.v === v));
    const need = b.mode === "versus" ? 2 : 1;
    const hs = b.fighters.filter((f) => !f.bot);
    put(
      "fighters",
      [
        ...b.fighters
          .filter((f) => !f.bot)
          .map((f) => {
            const gl = f.gloves.map((g) => `${g.hand === "left" ? "L" : "R"}${g.connected ? (g.ready ? " ✓" : " …") : " away"}`).join(" · ");
            const status = !f.connected ? "phone away" : f.ready ? "ready ✓" : "setting up the phone…";
            const botBtn = host && f.away && !f.botFor && b.phase !== "lobby" ? ` <button class="link" data-bot="${f.id}">Let a bot box</button>` : "";
            return `<li><span class="num"><svg class="kdot" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${f.corner ? "#dc2b45" : "#54a8fa"}"/></svg></span><b>${esc(f.name)}</b><small>${status} · gloves: ${gl}${f.gloves.length < 2 ? " (+ add a 2nd phone from this phone)" : ""}</small>${botBtn}</li>`;
          }),
        ...(b.mode === "solo" ? [`<li><span class="num"><svg class="kdot" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${rgb(botDef(b.opponent).body)}"/></svg></span><b>${esc(botDef(b.opponent).name)}</b><small>Bot · ${esc(BOT_LEVELS.find((l) => l.id === b.level)!.name)} · ${esc(botDef(b.opponent).note)}</small></li>`] : []),
      ].join("") + (hs.length < need ? `<li class="empty">Scan the QR with ${need - hs.length > 1 ? "two phones" : "a phone"} to join.</li>` : ""),
    );
    $("lobbyHint").textContent = b.mode === "solo" ? "Solo · " + botDef(b.opponent).tell : b.mode === "versus" ? "2 players" : "Training";
    const lag = hs.filter((f) => f.lagMs).map((f) => `${esc(f.name)} ~${f.lagMs} ms`);
    put("lag", lag.length ? "Phone → server punch delay: " + lag.join(", ") + " (measured on this connection)" : "");
    put("message", esc(b.message));
    hudState(b);
    // Banners: ROUND n → FIGHT!, the break, KO/TKO.
    const bn = b.phase === "intro" ? "intro" + b.round : b.phase === "fight" && b.time - b.phaseAt < 1 ? "fight" + b.round : b.phase === "break" ? "break" + b.round : "";
    if (bn && bn !== banner && !first) {
      if (b.phase === "intro") showBanner(`<small>${b.round === ROUNDS ? "FINAL ROUND" : "ROUND"}</small><b>${b.round}</b>`, 2400);
      else if (b.phase === "fight") showBanner(`<b>FIGHT!</b>`, 900, "go");
      else showBanner(`<small>END OF ROUND ${b.round}</small><b>${b.fighters.map((f) => f.stats.landed).join(" – ")}</b><small>clean hits</small>`, 4000);
    }
    banner = bn || banner;
    // Results with the stats.
    const over = b.phase === "over";
    $("results").classList.toggle("hidden", !over);
    if (over) {
      const [p, q] = b.fighters;
      const win = b.fighters.find((f) => f.id === b.result.winner);
      put("resSmall", b.mode === "solo" ? `${b.result.how === "DECISION" ? "POINTS DECISION" : b.result.how} · ${esc(BOT_LEVELS.find((l) => l.id === b.level)!.name.toUpperCase())}` : b.result.how === "DECISION" ? "POINTS DECISION" : b.result.how);
      put("resTitle", win ? `${esc(win.name)} wins${b.result.how === "DECISION" ? " on points" : " by " + b.result.how}!` : "It's a draw!");
      const row = (label: string, fn: (f: Fighter) => string) => `<tr><th>${label}</th>${[p, q].filter(Boolean).map((f) => `<td>${fn(f)}</td>`).join("")}</tr>`;
      put(
        "resTable",
        `<thead><tr><th></th>${[p, q].filter(Boolean).map((f) => `<th>${esc(f.name)}${f.id === b.result.winner ? " 🏆" : ""}</th>`).join("")}</tr></thead><tbody>${[
          row("Punches thrown", (f) => String(f.stats.thrown)),
          row("Landed", (f) => `${f.stats.landed} <small>(${f.stats.thrown ? Math.round((100 * f.stats.landed) / f.stats.thrown) : 0}%)</small>`),
          row("Jab / hook / uppercut", (f) => `${f.stats.byType.jab} / ${f.stats.byType.hook} / ${f.stats.byType.upper}`),
          row("Average power", (f) => (f.stats.landed ? String(pct(f.stats.power / f.stats.landed)) : "—")),
          row("Best punch", (f) => (f.stats.best ? String(pct(f.stats.best)) : "—")),
          row("Counters", (f) => String(f.stats.counters)),
          row("Dodges", (f) => String(f.stats.dodged)),
          row("Blocks", (f) => String(f.stats.blocked)),
          row("Knockdowns", (f) => String(f.stats.knockdowns)),
          row("Points", (f) => String(score(f))),
        ].join("")}</tbody>`,
      );
      const humanWon = !!win && !win.bot;
      $("again").classList.toggle("hidden", !host);
      $("resLobby").classList.toggle("hidden", !host);
      $("nextOpp").classList.toggle("hidden", !host || b.mode !== "solo" || !humanWon || b.opponent === BOTS[BOTS.length - 1].id);
    }
  }
  scene.onHit = () => {};
  setInterval(() => cur && hudState(cur), 500);
}

// ——————————————————————————— PHONE ———————————————————————————
/** What this phone keeps between visits: the hand, the punch style and the guard pose. */
type Saved = { hand: Hand; profile: PunchProfile; guardTilt: number };
const SAVE = "sportle-box";
function phone() {
  const gloveJoin = hash.get("glove") || "";
  app.innerHTML = `<div class="phone bphone"><header class="phead"><div class="logo"><b>Sport</b>le</div><span class="pstat"><span id="gloveTag">GLOVE</span>·<i class="dot" id="pDot"></i><span id="connection">NOT CONNECTED</span></span></header>
<div id="join" class="card"><div class="ruler" aria-hidden="true"></div><h1>${gloveJoin ? "Your other glove." : "A boxing glove.<br>In your hand."}</h1><p>${gloveJoin ? "This phone joins your fighter as the other hand." : "Hold your phone like a glove and throw real punches."}</p><div class="number">01 / ${gloveJoin ? "SECOND GLOVE" : "STEP INTO THE RING"}</div><label for="code">Room code</label><input id="code" maxlength="6" autocomplete="off" placeholder="ABC123">${gloveJoin ? "" : `<label for="nickname">Your name</label><input id="nickname" maxlength="20" placeholder="Boxer"><label for="outfit">Outfit</label><select id="outfit">${OUTFITS.map((o) => `<option value="${o.id}">${o.name}</option>`).join("")}</select><label for="gloves">Gloves</label><select id="gloves">${PADDLES.map((g, i) => `<option value="${i}">${i ? g.name : "Corner colour"}</option>`).join("")}</select><label for="gcode">Second phone? Glove code (optional)</label><input id="gcode" maxlength="12" autocomplete="off" placeholder="from your first phone">`}<button class="full" id="connect">${gloveJoin ? "Join as my other glove" : "Join the fight"}</button></div>
<div id="controls" class="hidden">
<section id="setup" class="setup bsetup"><div class="stephead"><span class="stepno"><b id="stepNo">01</b> / 04</span><span class="dashes" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="steptag" id="stepTag">MOTION</span></div><div class="eyebrow hidden" id="welcomeBack">WELCOME BACK · YOUR PUNCHES ARE SAVED</div><h2 class="big" id="stepTitle">Turn on motion.</h2><p class="lead" id="stepText"></p>
<div class="bhands hidden" id="handPick"><button class="choice" data-hand="left"><b>LEFT</b><small>phone in my left hand</small></button><button class="choice" data-hand="right"><b>RIGHT</b><small>phone in my right hand</small></button></div>
<div class="bgauge hidden" id="sGauge"></div>
<div class="bpunchlist hidden" id="punchList"></div>
<button class="hold" id="hold"><span class="htop"><b id="holdLabel">TAP TO START</b><small id="holdHint">TURNS ON MOTION</small></span><span class="segs" id="holdSegs"></span></button>
<button class="linkbig hidden" id="redoPunches">Teach my punches again</button><div class="savedcard hidden" id="savedCard"><span class="savedtick">✓</span><b>Saved on this phone</b><small>Next time: guard up and you're in.</small></div></section>
<div id="fight" class="bfight hidden">
  <div class="bptop"><div class="bpbar" id="pMe"></div><div class="bpclock" id="pClock"></div><div class="bpbar them" id="pThem"></div></div>
  <div class="bpmid"><div class="bpread" id="pRead">Throw a punch</div><div class="bpchips"><span class="chip" id="pGuard">GUARD</span><span class="chip" id="pDodge">DODGE</span></div><div class="bpstatus" id="pStatus"></div></div>
  <button class="bswitch" id="switchBtn"><b>SWITCH</b><small id="switchHint">hold = other hand</small></button>
  <div class="bpfoot"><button class="link" id="addGlove">Add a second phone</button><button class="link" id="menuBtn">Menu</button></div>
  <div class="kcallp hidden" id="pCall"></div>
</div>
<dialog id="menu" class="kmenu"><h2>Menu</h2><button class="cta" id="pauseFight">Pause</button><p class="fine" id="pauseNote"></p><button class="link" id="reguard">Set my guard again</button><button class="link" id="redo">Set up punches again</button><button class="ghost" id="menuClose">Back to the fight</button></dialog>
<dialog id="gloveDlg" class="kmenu"><h2>Your other glove</h2><p class="fine">Scan this with a second phone. It joins your fighter as your other hand (no SWITCH needed).</p><div class="qrtile"><canvas id="gloveQr" class="qr"></canvas></div><p class="fine">Or type the room code and this glove code on the other phone: <b id="gloveCode"></b></p><button class="ghost" id="gloveClose">Done</button></dialog>
</div><div id="error" role="alert"></div></div>`;
  document.body.classList.add("controller", "boxphone");
  const load = (): Saved | null => {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE) || "null");
      return s && (s.hand === "left" || s.hand === "right") && s.profile && (s.profile.face === 1 || s.profile.face === -1) ? s : null;
    } catch {
      return null;
    }
  };
  const store = (s: Saved) => {
    try {
      localStorage.setItem(SAVE, JSON.stringify(s));
    } catch {}
  };
  if (!gloveJoin) {
    const o = $<HTMLSelectElement>("outfit"),
      g = $<HTMLSelectElement>("gloves");
    const so = localStorage.getItem("pov-outfit");
    if (OUTFITS.some((x) => x.id === so)) o.value = so!;
    g.value = localStorage.getItem("box-gloves") || "0";
    o.onchange = () => localStorage.setItem("pov-outfit", o.value);
    g.onchange = () => localStorage.setItem("box-gloves", g.value);
    const name = localStorage.getItem("box-name");
    if (name) $<HTMLInputElement>("nickname").value = name;
  }
  $<HTMLInputElement>("code").value = params.get("room") || "";
  let saved = load();
  let hand: Hand = saved?.hand ?? "right";
  let reader = new PunchReader(hand, saved?.profile ?? defaultProfile(hand));
  const pose = new PoseReader();
  if (saved) pose.guardTilt = saved.guardTilt;
  let axes = axesOf(0, 90, 0);
  let enabled = false,
    enabledAt = 0,
    orientAt = 0,
    motionAt = 0,
    seq = 0,
    gloveId = "",
    fighterId = "",
    gloveCode = "",
    inflight = 0,
    ready = false,
    redo = false,
    wake: any = null,
    switchHeld = false,
    punchId = 0,
    dodgeId = 0,
    dodgeDir = 0;
  let lastPunch: { id: number; ptype: number; phand: number; power: number; pt: number; until: number } | null = null;
  let state: Box | null = null;
  type Step = "motion" | "hand" | "guard" | "punch" | "done";
  let stepNow: Step = "motion";
  const sensorLive = () => enabled && performance.now() - orientAt < 1200;
  const me = () => state?.fighters.find((f) => f.id === fighterId);
  const twoGloves = () => (me()?.gloves.length ?? 1) >= 2;
  // ——— Setup steps ———
  const ORDER: PunchType[] = ["jab", "jab", "hook", "hook", "upper", "upper"];
  let samples: { type: PunchType; read: ReadPunch }[] = [];
  /** Setup readers for both ways the screen can face; the jabs settle which one is right. */
  let setupReaders: PunchReader[] = [];
  const showStep = (s: Step) => {
    stepNow = s;
    const n = { motion: 1, hand: 2, guard: 3, punch: 4, done: 4 }[s];
    $("stepNo").textContent = "0" + n;
    $("stepTag").textContent = { motion: "MOTION", hand: "HAND", guard: "GUARD", punch: "PUNCHES", done: "SAVED" }[s];
    document.querySelectorAll(".stephead .dashes i").forEach((d, i) => (d.className = i < n ? "on" : ""));
    $("welcomeBack").classList.toggle("hidden", !(s === "hand" && saved && !redo));
    $("stepTitle").textContent = { motion: "Turn on motion.", hand: "Which hand holds the phone?", guard: "Guard up.", punch: "Teach it your punches.", done: "You're set." }[s];
    $("stepText").textContent = {
      motion: "Hold the phone like a glove: in your fist, screen facing sideways toward your thumb. Tap to allow motion.",
      hand: twoGloves() ? "This phone is one glove; your other phone is the other hand." : "That hand punches. For the other hand, hold SWITCH with your thumb while you punch.",
      guard: "Hold the phone upright in front of your face, screen to the side, and keep still for a second.",
      punch: "",
      done: "",
    }[s];
    $("handPick").classList.toggle("hidden", s !== "hand");
    document.querySelectorAll<HTMLButtonElement>("#handPick button").forEach((b) => b.classList.toggle("on", b.dataset.hand === hand));
    $("hold").classList.toggle("hidden", s !== "motion");
    $("sGauge").classList.toggle("hidden", s !== "guard");
    $("punchList").classList.toggle("hidden", s !== "punch");
    $("redoPunches").classList.toggle("hidden", !(s === "guard" && saved && !redo));
    $("savedCard").classList.toggle("hidden", s !== "done");
    if (s === "punch") punchList();
  };
  const punchList = (msg = "") => {
    const i = samples.length;
    put(
      "punchList",
      `<ol>${ORDER.map((t, k) => `<li class="${k < i ? "done" : k === i ? "now" : ""}"><b>${typeName(t)}</b><small>${k < i ? "✓ " + pct(samples[k].read.power) : k === i ? "throw it now" : ""}</small></li>`).join("")}</ol><p class="bhow">${esc(i < ORDER.length ? { jab: "Jab: a quick straight punch toward the TV.", hook: "Hook: swing round from the side, like hitting around a door frame.", upper: "Uppercut: swing up from below, toward the chin." }[ORDER[i]] : "")}</p><p class="bwarn">${esc(msg)}</p>`,
    );
  };
  segsInit();
  function segsInit() {
    $("holdSegs").innerHTML = "<i></i>".repeat(20);
  }
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
    await new Promise((ok) => setTimeout(ok, 900));
    $("setup").classList.add("hidden");
    $("fight").classList.remove("hidden");
  };
  document.querySelectorAll<HTMLButtonElement>("#handPick button").forEach(
    (b) =>
      (b.onclick = async () => {
        hand = b.dataset.hand === "left" ? "left" : "right";
        try {
          await net.api("box/hand", { hand });
        } catch (e) {
          error(e);
        }
        // A saved style belongs to the hand it was taught with.
        if (saved && saved.hand !== hand) saved = null;
        reader = new PunchReader(hand, saved?.profile ?? defaultProfile(hand));
        showStep("guard");
      }),
  );
  $("redoPunches").onclick = () => {
    redo = true;
    showStep("guard");
  };
  // Guard step: upright, screen sideways, still for a second → saved guard pose and forward.
  let guardSince = -1;
  function guardStep(move: number, turn: number) {
    if (stepNow !== "guard") return;
    const up = axes.Y[2],
      tilt = (Math.acos(Math.max(-1, Math.min(1, up))) * 180) / Math.PI;
    const sideways = Math.abs(axes.Z[2]) < 0.55;
    const ok = tilt < 35 && sideways && move < 1.8 && turn < 45;
    const now = performance.now();
    if (!ok) guardSince = -1;
    else if (guardSince < 0) guardSince = now;
    const k = guardSince < 0 ? 0 : Math.min(1, (now - guardSince) / 1000);
    put("sGauge", `<div class="bguard${ok ? " ok" : ""}"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="10"/><circle cx="60" cy="60" r="50" fill="none" stroke="#ebf538" stroke-width="10" stroke-dasharray="${(k * 314).toFixed(0)} 400" transform="rotate(-90 60 60)"/><rect x="48" y="${(30 + Math.min(40, tilt)).toFixed(0)}" width="24" height="40" rx="5" fill="#fff" transform="rotate(${(-tilt * Math.sign(axes.Y[0] || 1)).toFixed(0)} 60 60)"/></svg><small>${!sideways ? "TURN THE SCREEN TO THE SIDE" : tilt >= 35 ? "HOLD IT UPRIGHT" : move >= 1.8 || turn >= 45 ? "KEEP STILL…" : "HOLD…"}</small></div>`);
    if (k < 1) return;
    guardSince = -1;
    navigator.vibrate?.(40);
    pose.guardTilt = tilt;
    reader.setForward(axes);
    if (saved && !redo) {
      reader.profile = saved.profile;
      store({ ...saved, hand, guardTilt: tilt });
      goReady();
      return;
    }
    samples = [];
    setupReaders = [1, -1].map((face) => {
      const r = new PunchReader(hand, { face: face as 1 | -1, centroids: {}, gain: 1 });
      r.setForward(axes);
      return r;
    });
    showStep("punch");
  }
  /** Setup punches: two of each, read with the default rules (any clear punch counts as the asked one). */
  function setupPunch(reads: (ReadPunch | null)[]) {
    const want = ORDER[samples.length];
    let pick: { r: ReadPunch; k: number } | null = null;
    reads.forEach((r, k) => {
      if (!r) return;
      // The first jabs settle which way the screen faces: forward must be forward.
      if (samples.length === 0 && r.features[0] < 0.45) return;
      if (samples.length > 0 && setupReaders[k].profile.face !== reader.profile.face) return;
      if (!pick || r.speed > pick.r.speed) pick = { r, k };
    });
    if (!pick) return;
    const p = pick as { r: ReadPunch; k: number };
    if (samples.length === 0) reader.profile = { ...reader.profile, face: setupReaders[p.k].profile.face };
    samples.push({ type: want, read: p.r });
    navigator.vibrate?.(30);
    if (samples.length < ORDER.length) {
      punchList(p.r.type !== want ? `That read like a ${typeName(p.r.type).toLowerCase()}. Counted as a ${typeName(want).toLowerCase()} for your style.` : "");
      return;
    }
    const res = learnPunches(samples, reader.profile);
    if (!res.ok) {
      samples = [];
      punchList(res.reason);
      return;
    }
    reader = new PunchReader(hand, res.profile);
    reader.setForward(axes);
    saved = { hand, profile: res.profile, guardTilt: pose.guardTilt };
    store(saved);
    goReady();
  }
  // ——— Sensors ———
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  /** Haptics where the phone supports it (Android); a visual flash on iPhone. */
  const buzz = (ms: number) => {
    if (!isIOS && navigator.vibrate) navigator.vibrate(ms);
    const el = $("fight");
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  };
  function orientation(e: DeviceOrientationEvent) {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    orientAt = performance.now();
    axes = axesOf(e.alpha, e.beta, e.gamma);
  }
  let gravity: Vec3 = [0, 0, 0];
  function motion(e: DeviceMotionEvent) {
    const now = performance.now();
    let acc: Vec3 | null = null;
    const a = e.acceleration;
    if (a && a.x !== null && a.y !== null && a.z !== null) acc = [a.x, a.y, a.z];
    else {
      // Some phones only give acceleration with gravity: take a slow average out.
      const g = e.accelerationIncludingGravity;
      if (!g || g.x === null || g.y === null || g.z === null) return;
      const dt = motionAt ? Math.min(0.1, (now - motionAt) / 1000) : 1 / 60;
      const k = 1 - Math.exp(-dt / 0.4);
      gravity = [gravity[0] + k * (g.x - gravity[0]), gravity[1] + k * (g.y! - gravity[1]), gravity[2] + k * (g.z! - gravity[2])];
      acc = [g.x - gravity[0], g.y! - gravity[1], g.z! - gravity[2]];
    }
    motionAt = now;
    const rr = e.rotationRate ?? { alpha: 0, beta: 0, gamma: 0 };
    const rot = { alpha: rr.alpha ?? 0, beta: rr.beta ?? 0, gamma: rr.gamma ?? 0 };
    const move = Math.hypot(acc[0], acc[1], acc[2]);
    const turn = Math.hypot(rot.alpha, rot.beta, rot.gamma);
    if (stepNow === "guard") return guardStep(move, turn);
    if (stepNow === "punch") return setupPunch(setupReaders.map((r) => r.feed(acc!, rot, axes, now)));
    if (!ready) return;
    const p = reader.feed(acc, rot, axes, now);
    // Guard and dodges from the pose (top edge in the player's frame).
    const y = reader.frame(toWorld(axes, [0, 1, 0]));
    const dodge = pose.feed(y, move, turn, now);
    if (pose.guard && now - lastForward > 400) {
      // The guard is the reference pose: keep "toward the TV" fresh while it's up.
      reader.setForward(axes);
      lastForward = now;
    }
    if (dodge) {
      dodgeId++;
      dodgeDir = dodge === "left" ? 0 : dodge === "right" ? 1 : 2;
      $("pDodge").textContent = dodge === "duck" ? "DUCK" : "SLIP " + dodge.toUpperCase();
      $("pDodge").classList.add("on");
      setTimeout(() => $("pDodge").classList.remove("on"), 450);
      send();
    }
    if (p) {
      const h = twoGloves() ? hand : switchHeld ? other(hand) : hand;
      punchId++;
      lastPunch = { id: punchId, ptype: PUNCH_TYPES.indexOf(p.type), phand: h === "left" ? 0 : 1, power: Math.round(p.power * 1000) / 1000, pt: Date.now() + net.offset, until: now + 350 };
      put("pRead", `<small>${h === "left" ? "LEFT" : "RIGHT"}</small><b>${typeName(p.type)}</b><span>${pct(p.power)}</span>`);
      // Each punch goes straight out as its own input (and repeats in the next packets).
      send();
    }
  }
  let lastForward = 0;
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
      if ("wakeLock" in navigator) wake = await (navigator as any).wakeLock.request("screen").catch(() => null);
      showStep("hand");
    } catch (e) {
      error(e);
    }
  };
  $("hold").addEventListener("click", () => {
    if (!enabled) enable();
  });
  // ——— SWITCH (thumb): punches go to the other hand while it's held ———
  const sw = $("switchBtn");
  sw.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try {
      sw.setPointerCapture(e.pointerId);
    } catch {}
    switchHeld = true;
    sw.classList.add("held");
  });
  const swUp = () => {
    switchHeld = false;
    sw.classList.remove("held");
  };
  sw.addEventListener("pointerup", swUp);
  sw.addEventListener("pointercancel", swUp);
  sw.addEventListener("contextmenu", (e) => e.preventDefault());
  // ——— Menu and the second glove ———
  const menu = $<HTMLDialogElement>("menu");
  const syncMenu = () => {
    const solo = !!state && state.fighters.filter((f) => !f.bot).length === 1;
    ($("pauseFight") as HTMLButtonElement).disabled = !solo;
    $("pauseFight").textContent = state?.paused ? "Resume" : "Pause";
    $("pauseNote").textContent = solo ? "" : "Only the TV can pause a two-fighter bout.";
  };
  $("menuBtn").onclick = () => {
    syncMenu();
    menu.showModal();
  };
  $("menuClose").onclick = () => menu.close();
  $("pauseFight").onclick = () => net.api(state?.paused ? "resume" : "pause", {}).then(syncMenu).catch(error);
  const back = (to: Step) => {
    menu.close();
    ready = false;
    net.api("ready", { ready: false }).catch(() => {});
    $("fight").classList.add("hidden");
    $("setup").classList.remove("hidden");
    showStep(to);
  };
  $("reguard").onclick = () => back("guard");
  $("redo").onclick = () => {
    redo = true;
    back("guard");
  };
  $("addGlove").onclick = () => {
    const url = location.origin + "/boxing/phone?room=" + net.room + "#pair=" + (hash.get("pair") || "") + "&glove=" + gloveCode;
    try {
      drawQR($<HTMLCanvasElement>("gloveQr"), url);
    } catch (e) {
      error(e);
    }
    $("gloveCode").textContent = gloveCode;
    $<HTMLDialogElement>("gloveDlg").showModal();
  };
  $("gloveClose").onclick = () => $<HTMLDialogElement>("gloveDlg").close();
  // ——— Joining ———
  async function claim(credential?: string) {
    const room = (params.get("room") || $<HTMLInputElement>("code").value).trim().toUpperCase();
    if (!/^[A-F0-9]{6}$/.test(room)) throw Error("Enter the six-character room code from the TV.");
    net.room = room;
    const name = ($<HTMLInputElement>("nickname")?.value || localStorage.getItem("box-name") || "Boxer").trim();
    const typed = ($<HTMLInputElement>("gcode")?.value || "").trim();
    const r = await net.api("join", {
      name,
      hand,
      outfit: localStorage.getItem("pov-outfit") || "classic",
      gear: cleanGear({ paddle: Number(localStorage.getItem("box-gloves") || 0) }),
      pair: hash.get("pair") || undefined,
      glove: gloveJoin || typed || undefined,
      credential,
    });
    localStorage.setItem("box-controller-" + room, r.credential);
    if (!credential) {
      if (!gloveJoin) localStorage.setItem("box-name", name);
      // A fresh page; the glove is kept with the saved credential.
      const to = "/boxing/phone?room=" + room + (hash.get("pair") ? "#pair=" + hash.get("pair") : "") + (location.hash.includes("test") ? (hash.get("pair") ? "&test" : "#test") : "");
      // Same page with another #fragment would not reload, so swap the URL and reload.
      if (to.split("#")[0] === location.pathname + location.search) {
        history.replaceState(null, "", to);
        location.reload();
      } else location.replace(to);
      return;
    }
    net.credential = r.credential;
    gloveId = r.player.id;
    fighterId = r.player.fighter;
    gloveCode = r.gloveCode;
    if (r.player.hand !== hand) {
      hand = r.player.hand;
      if (saved && saved.hand !== hand) saved = null;
      reader = new PunchReader(hand, saved?.profile ?? defaultProfile(hand));
    }
    seq = r.seq + 1;
    document.body.classList.add("joined");
    $("join").replaceChildren();
    $("join").classList.add("hidden");
    $("controls").classList.remove("hidden");
    await net.clock();
    net.stream();
    showStep("motion");
  }
  $("connect").onclick = () => claim().catch(error);
  {
    const room = (params.get("room") || "").toUpperCase();
    const cred = localStorage.getItem("box-controller-" + room);
    if (/^[A-F0-9]{6}$/.test(room) && cred && !gloveJoin) {
      $("join").replaceChildren();
      claim(cred).catch(() => {
        localStorage.removeItem("box-controller-" + room);
        location.replace("/boxing/phone?room=" + room + (hash.get("pair") ? "#pair=" + hash.get("pair") : ""));
      });
    }
  }
  net.onStatus = (s) => {
    put("connection", esc(s.toUpperCase()));
    $("pDot").className = "dot" + (s === "Connected" ? " live" : " wait");
  };
  net.onGone = (reason) => error(reason + ". Scan the QR on the TV again.");
  let callSeen = 0,
    callTimer = 0,
    hitSeen = 0;
  function phoneState(b: Box) {
    const first = !state;
    state = b;
    const f = me();
    if (!f) return;
    const g = f.gloves.find((q) => q.id === gloveId);
    if (g && g.hand !== hand && (f.gloves.length === 2 || stepNow === "hand")) {
      hand = g.hand;
      reader = new PunchReader(hand, saved?.hand === hand ? saved.profile : reader.profile);
    }
    put("gloveTag", f.gloves.length === 2 ? hand.toUpperCase() + " GLOVE" : "GLOVE");
    document.body.classList.toggle("twogloves", f.gloves.length === 2);
    $("addGlove").classList.toggle("hidden", f.gloves.length >= 2 || b.phase !== "lobby" && b.phase !== "over");
    const o = b.mode === "training" ? undefined : b.fighters.find((q) => q !== f);
    const fighting = b.phase !== "lobby";
    document.body.classList.toggle("boxing", fighting && b.phase !== "over");
    put("pMe", fighting ? `<b>YOU</b>${bar(f.hp, "hp")}${bar(f.stamina * 100, "st")}` : "");
    put("pThem", fighting && o ? `<b>${esc(o.name)}</b>${bar(o.hp, "hp", true)}` : "");
    put("pClock", b.mode === "training" ? "TRAINING" : fighting ? `R${b.round} · ${b.phase === "break" ? "BREAK" : clockText(b.clock)}` : "");
    $("pGuard").classList.toggle("on", f.guard);
    let status = "";
    if (b.phase === "lobby") status = ready ? "You're in. The TV rings the bell." : "Finish setup to be ready.";
    else if (b.phase === "intro") status = "Round " + b.round + " · get ready";
    else if (b.phase === "down") status = b.count.who === f.id ? `DOWN! SHAKE YOUR PHONE TO GET UP · ${b.count.n}` : "Opponent down · " + b.count.n;
    else if (b.phase === "break") status = "Break · catch your breath";
    else if (b.phase === "over") status = b.result.winner === f.id ? "YOU WIN!" : b.result.winner ? "You lost this one" : "A draw";
    else if (b.paused) status = "Paused";
    else if (b.mode === "training" && f.drill) status = b.drill === "mitts" ? (f.drill.call ? callText(f.drill.call) : "Ready…") + ` · score ${f.drill.score}` : "Hit the bag";
    else if (f.stamina < 0.2) status = "TIRED · ease off to recover";
    put("pStatus", esc(status));
    $("fight").classList.toggle("down", b.phase === "down" && b.count.who === f.id);
    // My callouts pop on the phone; hits on or by me buzz (Android) or flash (iPhone).
    for (const c of b.callouts)
      if (c.who === f.id && c.at > callSeen) {
        callSeen = c.at;
        if (first) continue;
        $("pCall").textContent = c.text;
        $("pCall").className = "kcallp kind-" + (c.kind || "good");
        clearTimeout(callTimer);
        callTimer = window.setTimeout(() => $("pCall").classList.add("hidden"), 1100);
      }
    for (const h of b.hits as HitEvent[])
      if (h.at > hitSeen) {
        hitSeen = h.at;
        if (first) continue;
        if (h.by === f.id && h.result !== "dodge") buzz(h.result === "block" ? 15 : 35);
        if (h.to === f.id && h.result !== "dodge") buzz(h.result === "block" ? 20 : 60);
      }
  }
  net.onState = (s) => {
    if (s.game === "boxing") phoneState(s.state as Box);
  };
  setInterval(() => {
    if (enabled && !sensorLive() && performance.now() - enabledAt > 5000) error("No live sensor data. Check the browser's motion permission, or use another phone.");
  }, 500);
  /** One input packet: pose flags every time, plus the latest punch and dodge (applied once by id). */
  async function send() {
    if (!net.credential || net.gone) return;
    const now = performance.now();
    const live = sensorLive();
    const f = me();
    const down = !!state && state.phase === "down" && state.count.who === f?.id;
    const input: Input & Record<string, unknown> = {
      seq: seq++,
      t: Date.now() + net.offset,
      pitch: 0,
      roll: 0,
      yaw: 0,
      strength: 0,
      direction: 0,
      swing: false,
      sensors: live,
      calibrated: ready && live,
      guard: ready && pose.guard,
      rise: down ? Math.round(reader.energy * 1000) / 1000 : 0,
    };
    if (lastPunch && now < lastPunch.until) Object.assign(input, { punchId: lastPunch.id, ptype: lastPunch.ptype, phand: lastPunch.phand, power: lastPunch.power, pt: lastPunch.pt });
    if (dodgeId) Object.assign(input, { dodgeId, ddir: dodgeDir });
    inflight++;
    try {
      await net.api("input", input);
    } catch {
      put("connection", "RECONNECTING");
    } finally {
      inflight--;
    }
  }
  // ~25 Hz: guard, get-up effort, and repeats of the latest punch/dodge.
  setInterval(() => {
    if (!net.credential || net.gone || inflight >= 2 || document.hidden) return;
    send();
  }, 40);
  setInterval(() => {
    if (net.credential) net.clock().catch(() => {});
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      swUp();
      net.api("background", {}).catch(() => {});
      wake?.release?.();
      wake = null;
    } else if (net.credential) {
      net.kick();
      if ("wakeLock" in navigator && enabled) (navigator as any).wakeLock.request("screen").then((w: any) => (wake = w)).catch(() => {});
    }
  });
  if (location.hash.includes("test"))
    (window as any).__boxPhone = {
      get reader() {
        return reader;
      },
      pose,
      get state() {
        return state;
      },
      get ready() {
        return ready;
      },
      get step() {
        return stepNow;
      },
      get fighterId() {
        return fighterId;
      },
      get gloveCode() {
        return gloveCode;
      },
    };
  void gloveId;
}
