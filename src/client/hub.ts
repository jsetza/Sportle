// Sportle start screen (owner request): a short "Welcome to Sportle" intro, then a big
// game picker: a strip of games along the bottom (swipe, scroll, arrow keys or ‹ ›; Enter plays),
// with the chosen game's own 3D scene filling the screen above it.

import type { Scene } from "./scene.ts";
import { BowlScene } from "./bowlscene.ts";
import { KartScene } from "./kartscene.ts";
import { LANES } from "../shared/bowling.ts";
import { TRACKS } from "../shared/kart.ts";

const PICKLE_ART = `<svg viewBox="0 0 320 200" aria-hidden="true">
  <defs><linearGradient id="hpFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a0d18"/><stop offset="1" stop-color="#b3213b"/></linearGradient></defs>
  <rect width="320" height="200" fill="url(#hpFloor)"/>
  <path d="M96 38 L224 38 L292 196 L28 196 Z" fill="#3f8fe0"/>
  <path d="M96 38 L224 38 L292 196 L28 196 Z M160 38 V196 M73 92 H247 M50 146 H270" fill="none" stroke="#fff" stroke-width="2.5" opacity=".9"/>
  <rect x="64" y="104" width="192" height="16" fill="none" stroke="#fff" stroke-width="2" opacity=".75"/>
  <path d="M64 108 H256 M64 114 H256" stroke="#fff" stroke-width="1" opacity=".35"/>
  <ellipse cx="0" cy="0" rx="9" ry="3" fill="#000" opacity=".35"><animateMotion dur="2.4s" repeatCount="indefinite" path="M120 176 L196 70 L120 176" keyTimes="0;.5;1" calcMode="linear"/></ellipse>
  <circle r="8" fill="#ebf538" stroke="#b8c21c" stroke-width="1.5"><animateMotion dur="2.4s" repeatCount="indefinite" path="M120 168 Q150 20 196 62 Q166 30 120 168" keyTimes="0;.5;1" keyPoints="0;.5;1" calcMode="linear"/></circle>
  <g transform="translate(104 170)"><g><animateTransform attributeName="transform" type="rotate" values="-35;20;-35" keyTimes="0;.12;1" dur="2.4s" repeatCount="indefinite"/>
    <rect x="-4" y="-2" width="8" height="26" rx="3" fill="#222"/><rect x="-16" y="-34" width="32" height="36" rx="12" fill="#54a8fa" stroke="#fff" stroke-width="2"/></g></g>
</svg>`;

const BOWL_ART = `<svg viewBox="0 0 320 200" aria-hidden="true">
  <defs><linearGradient id="hbLane" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9a35f"/><stop offset="1" stop-color="#f2c98a"/></linearGradient></defs>
  <rect width="320" height="200" fill="#120c1f"/>
  <path d="M136 30 L184 30 L262 200 L58 200 Z" fill="url(#hbLane)"/>
  <path d="M128 30 L136 30 L58 200 L36 200 Z M184 30 L192 30 L284 200 L262 200 Z" fill="#2b2140"/>
  <path d="M148 30 L118 200 M160 30 V200 M172 30 L202 200" stroke="#a87436" stroke-width="1" opacity=".5"/>
  <g fill="#fff" stroke="#c9c2d6" stroke-width=".8">
    ${[
      [160, 46],
      [153, 40],
      [167, 40],
      [146, 34],
      [160, 34],
      [174, 34],
    ]
      .map(
        ([x, y], i) =>
          `<g transform="translate(${x} ${y})"><g><animateTransform attributeName="transform" type="rotate" values="0;0;${i % 2 ? 70 : -70};${i % 2 ? 70 : -70};0" keyTimes="0;.55;.62;.92;1" dur="2.6s" repeatCount="indefinite"/><path d="M0 -10 C3 -10 3 -6 2 -4 C5 0 4 4 0 4 C-4 4 -5 0 -2 -4 C-3 -6 -3 -10 0 -10 Z"/><path d="M-2 -6 H2" stroke="#dc2b45" stroke-width="1.2"/></g></g>`,
      )
      .join("")}
  </g>
  <g><animateTransform attributeName="transform" type="translate" values="160 186;160 186;158 54;158 54" keyTimes="0;.05;.58;1" dur="2.6s" repeatCount="indefinite"/>
    <g><animateTransform attributeName="transform" type="scale" values="1;1;.32;.32" keyTimes="0;.05;.58;1" dur="2.6s" repeatCount="indefinite"/>
      <circle r="17" fill="#7b4dff"/><circle r="17" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>
      <circle cx="-5" cy="-6" r="2.2" fill="#1b1030"/><circle cx="2" cy="-8" r="2.2" fill="#1b1030"/><circle cx="-1" cy="0" r="2.4" fill="#1b1030"/>
    </g></g>
</svg>`;

const KART_ART = `<svg viewBox="0 0 320 200" aria-hidden="true">
  <defs><linearGradient id="hkSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2a5c"/><stop offset="1" stop-color="#3f8fe0"/></linearGradient></defs>
  <rect width="320" height="200" fill="url(#hkSky)"/>
  <path d="M0 120 Q80 96 160 112 T320 104 V200 H0 Z" fill="#2f7d3c"/>
  <path id="hkRoad" d="M-20 196 C60 150 120 168 170 140 S270 100 340 118" fill="none" stroke="#2c2c36" stroke-width="38"/>
  <path d="M-20 196 C60 150 120 168 170 140 S270 100 340 118" fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="12 12" opacity=".8"><animate attributeName="stroke-dashoffset" values="0;-48" dur=".8s" repeatCount="indefinite"/></path>
  <g><animateMotion dur="3.2s" repeatCount="indefinite" rotate="auto" path="M-20 196 C60 150 120 168 170 140 S270 100 340 118"/>
    <g transform="translate(0 -8)"><rect x="-16" y="-7" width="32" height="14" rx="5" fill="#f2457f"/><circle cx="-10" cy="8" r="5" fill="#111"/><circle cx="11" cy="8" r="5" fill="#111"/><circle cx="-2" cy="-12" r="7" fill="#54a8fa"/><circle cx="-2" cy="-14" r="3.2" fill="#fff"/><path d="M-22 -2 h-10 M-22 3 h-14" stroke="#ff8a1f" stroke-width="3" stroke-linecap="round"><animate attributeName="opacity" values="1;.3;1" dur=".3s" repeatCount="indefinite"/></path></g></g>
  <g transform="translate(250 52)"><g><animateTransform attributeName="transform" type="rotate" values="-22;22;-22" dur="2.4s" repeatCount="indefinite"/>
    <rect x="-34" y="-18" width="68" height="36" rx="8" fill="#151524" stroke="#ebf538" stroke-width="3"/><circle cx="-24" cy="0" r="5" fill="#ff8a1f"/><circle cx="24" cy="0" r="5" fill="#54a8fa"/></g></g>
  <rect x="150" y="24" width="10" height="10" rx="2" fill="#ff8a1f" transform="rotate(20 155 29)"><animateTransform attributeName="transform" type="rotate" values="0 155 29;360 155 29" dur="2s" repeatCount="indefinite"/></rect>
</svg>`;

const SOON_ART = `<svg viewBox="0 0 320 200" aria-hidden="true">
  <rect width="320" height="200" fill="#14141f"/>
  <g fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="3" stroke-dasharray="8 8">
    <rect x="60" y="50" width="80" height="100" rx="18"/><rect x="180" y="50" width="80" height="100" rx="18"/>
  </g>
  <text x="100" y="114" text-anchor="middle" font-size="40" font-weight="900" fill="#fff" fill-opacity=".45">?</text>
  <text x="220" y="114" text-anchor="middle" font-size="40" font-weight="900" fill="#fff" fill-opacity=".45">?</text>
</svg>`;

const PHONE_TV = `<svg viewBox="0 0 260 120" aria-hidden="true">
  <g class="hi-tv"><rect x="120" y="14" width="130" height="80" rx="8" fill="#151524" stroke="#fff" stroke-width="3"/>
    <path d="M150 104 H220" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
    <path d="M150 76 L170 34 H200 L220 76 Z" fill="#3f8fe0"/><circle class="hi-tvball" cx="185" cy="46" r="5" fill="#ebf538"/></g>
  <g class="hi-phone"><rect x="28" y="22" width="40" height="76" rx="8" fill="#151524" stroke="#ebf538" stroke-width="3"/><circle cx="48" cy="88" r="3" fill="#ebf538"/></g>
  <path class="hi-waves" d="M84 50 q8 10 0 20 M94 44 q12 16 0 32 M104 38 q16 22 0 44" fill="none" stroke="#ebf538" stroke-width="3" stroke-linecap="round"/>
</svg>`;

interface Card {
  id: string;
  tag: "button" | "a" | "div";
  href?: string;
  name: string;
  line: string;
  who: string;
  art: string;
  cls: string;
}
const CARDS: Card[] = [
  { id: "play", tag: "button", name: "Pickleball", line: "Your phone is the paddle", who: "1–4 players · offline or online", art: PICKLE_ART, cls: "pickle" },
  { id: "playBowling", tag: "a", href: "/bowling", name: "Bowling", line: "Your phone is the ball", who: "1–6 players · take turns", art: BOWL_ART, cls: "bowl" },
  { id: "playKart", tag: "a", href: "/kart", name: "Kart", line: "Your phone is the wheel", who: "1–8 players · split screen", art: KART_ART, cls: "kart" },
  { id: "playSoon", tag: "div", name: "More soon", line: "New games are on the way", who: "Coming later", art: SOON_ART, cls: "soon" },
];

export interface Hub {
  show(): void;
  hide(): void;
  readonly open: boolean;
}

/**
 * Builds the start screen into `root`. `intro` plays the welcome animation first (skipped
 * after the first time in a browser tab). `onPickleball` runs when Pickleball is chosen.
 */
export function mountHub(root: HTMLElement, opts: {
    intro: boolean;
    startOpen: boolean;
    onPickleball: () => void;
    /** true: the arena behind the start screen is on show (keep it rendering); false: another game's scene covers it (pause it). */
    backdrop?: (main: boolean) => void;
  }): Hub {
  const word = ["S", "P", "O", "R", "T"].map((c, i) => `<b style="--i:${i}">${c}</b>`).join("") +
    ["L", "E"].map((c, i) => `<span style="--i:${i + 5}">${c}</span>`).join("");
  const el = document.createElement("div");
  el.id = "hub";
  el.className = "hub";
  el.innerHTML = `<div class="hubintro" id="hubIntro">
    <p class="hi-welcome">Welcome to</p>
    <h1 class="hi-word" aria-label="Sportle">${word}</h1>
    <p class="hi-sub">Motion games with just <b>your phone</b> and <b>a screen</b>.</p>
    <div class="hi-devices">${PHONE_TV}</div>
    <p class="hi-press">Press any key or tap to start</p>
  </div>
  <div class="hubpick" id="hubPick">
    <div class="hubstage" id="hubStage" aria-hidden="true"></div>
    <div class="hubfeature" id="hubFeature" aria-live="polite">
      <p class="hf-kicker">Sportle</p>
      <h2 class="hf-name" id="hubName"></h2>
      <p class="hf-line" id="hubLine"></p>
      <p class="hf-who" id="hubWho"></p>
      <button class="hf-go" id="hubGo">Play <span>▶</span></button>
      <p class="hf-hint">← → to browse · Enter to play</p>
    </div>
    <div class="hubstrip">
      <button class="hubarrow prev" id="hubPrev" aria-label="Previous game">‹</button>
      <div class="hubrail" id="hubRail" role="list" aria-label="Sportle games">
        ${CARDS.map(
          (c, i) =>
            `<${c.tag} class="hubcard ${c.cls}" id="${c.id}" role="listitem" style="--k:${i}" aria-label="${c.name}"${c.href ? ` href="${c.href}"` : ""}${c.tag === "div" ? ' aria-disabled="true"' : ""}>
              <span class="hc-art">${c.art}</span>
              <strong class="hc-name">${c.name}</strong>
            </${c.tag}>`,
        ).join("")}
      </div>
      <button class="hubarrow next" id="hubNext" aria-label="Next game">›</button>
    </div>
  </div>`;
  root.appendChild(el);
  const rail = el.querySelector<HTMLElement>("#hubRail")!;
  const cards = Array.from(rail.querySelectorAll<HTMLElement>(".hubcard"));
  const stage = el.querySelector<HTMLElement>("#hubStage")!;
  let active = 0;
  let isOpen = false;
  let introTimer = 0;

  // ——— Backdrop: the chosen game's own 3D scene fills the screen behind the picker ———
  // Pickleball (and "More soon") show the arena that already runs behind the start screen.
  // Bowling and Kart scenes are built the first time they are picked, on their own canvas;
  // only the one on screen keeps rendering. Each pick of Kart shows the next track.
  type Preview = { wrap: HTMLElement; scene: Scene; next?: () => void };
  const previews: Partial<Record<"bowl" | "kart", Preview | null>> = {};
  let shown: "bowl" | "kart" | null = null;
  let kartTrack = -1;
  let laneNo = -1;
  const pause = (p: Preview) => cancelAnimationFrame(p.scene.raf);
  const preview = (game: "bowl" | "kart"): Preview | null => {
    if (previews[game] !== undefined) return previews[game]!;
    const wrap = document.createElement("div");
    wrap.className = "hubscene";
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    stage.appendChild(wrap);
    try {
      if (game === "bowl") {
        const scene = new BowlScene(canvas);
        previews.bowl = { wrap, scene, next: () => scene.setLane(LANES[(laneNo = (laneNo + 1) % LANES.length)].id) };
      } else {
        const scene = new KartScene(canvas);
        previews.kart = { wrap, scene, next: () => scene.setTrack(TRACKS[(kartTrack = (kartTrack + 1) % TRACKS.length)].id) };
      }
    } catch {
      // No WebGL for a second scene (old TV browser): keep the card art instead.
      wrap.remove();
      previews[game] = null;
    }
    return previews[game]!;
  };
  const backdrop = (k: number) => {
    const cls = CARDS[k].cls;
    const want = isOpen && (cls === "bowl" || cls === "kart") ? cls : null;
    if (want === shown && want) return;
    for (const g of ["bowl", "kart"] as const) {
      const p = previews[g];
      if (p && g !== want) {
        pause(p);
        p.wrap.classList.remove("on");
      }
    }
    shown = want;
    el.dataset.game = cls;
    opts.backdrop?.(!want);
    if (!want) return;
    const p = preview(want);
    if (!p) {
      el.dataset.game = cls + " noscene";
      return;
    }
    p.next?.();
    pause(p);
    p.scene.render();
    p.wrap.classList.add("on");
  };

  const setActive = (k: number) => {
    const changed = k !== active || !el.dataset.game;
    active = k;
    cards.forEach((c, i) => c.classList.toggle("active", i === k));
    const c = CARDS[k];
    el.querySelector("#hubName")!.textContent = c.name;
    el.querySelector("#hubLine")!.textContent = c.line;
    el.querySelector("#hubWho")!.textContent = c.who;
    el.querySelector<HTMLButtonElement>("#hubGo")!.hidden = c.tag === "div";
    if (changed) {
      const f = el.querySelector<HTMLElement>("#hubFeature")!;
      f.classList.remove("hf-in");
      void f.offsetWidth;
      f.classList.add("hf-in");
    }
    if (changed && el.classList.contains("pick")) backdrop(k);
  };
  const goTo = (k: number, smooth = true) => {
    k = Math.max(0, Math.min(cards.length - 1, k));
    const c = cards[k];
    // While the strip glides to the chosen card, the scroll position must not re-pick the cards
    // it passes on the way (that would flash the previous game's scene): the pick holds until
    // the strip arrives, or the player grabs the strip.
    target = k;
    targetUntil = performance.now() + 3000;
    rail.scrollTo({ left: c.offsetLeft + c.offsetWidth / 2 - rail.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
    setActive(k);
  };
  // After a swipe or scroll by hand, the card nearest the middle of the strip is the chosen one.
  let raf = 0;
  let target: number | null = null;
  let targetUntil = 0;
  const byHand = () => (target = null);
  rail.addEventListener("pointerdown", byHand);
  rail.addEventListener("touchstart", byHand, { passive: true });
  rail.addEventListener("scroll", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const mid = rail.scrollLeft + rail.clientWidth / 2;
      let best = 0;
      cards.forEach((c, i) => {
        if (Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) < Math.abs(cards[best].offsetLeft + cards[best].offsetWidth / 2 - mid)) best = i;
      });
      if (target !== null) {
        if (best === target || performance.now() > targetUntil) target = null;
        return;
      }
      if (best !== active) setActive(best);
    });
  });
  // A mouse wheel moves one game per notch.
  let wheelAt = 0;
  rail.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelAt < 320) return;
      wheelAt = now;
      goTo(active + Math.sign(e.deltaY));
    },
    { passive: false },
  );
  const launch = (k: number) => {
    const c = cards[k];
    if (c.id === "play") opts.onPickleball();
    else if (c.id === "playBowling") location.href = "/bowling";
    else if (c.id === "playKart") location.href = "/kart";
  };
  cards.forEach((c, i) =>
    c.addEventListener("click", (e) => {
      // A side card comes to the middle first; the middle card plays.
      if (i !== active) {
        e.preventDefault();
        goTo(i);
        return;
      }
      if (c.tagName !== "A") launch(i);
    }),
  );
  el.querySelector<HTMLElement>("#hubPrev")!.onclick = () => goTo(active - 1);
  el.querySelector<HTMLElement>("#hubNext")!.onclick = () => goTo(active + 1);
  el.querySelector<HTMLElement>("#hubGo")!.onclick = () => launch(active);

  const toPicker = () => {
    clearTimeout(introTimer);
    if (!el.classList.contains("intro")) return;
    el.classList.remove("intro");
    el.classList.add("pick");
    try {
      sessionStorage.setItem("sportle-intro", "1");
    } catch {}
    requestAnimationFrame(() => goTo(active, false));
    backdrop(active);
    (cards[active] as HTMLElement).focus({ preventScroll: true });
  };
  el.querySelector<HTMLElement>("#hubIntro")!.addEventListener("pointerdown", toPicker);
  addEventListener("keydown", (e) => {
    if (!isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.closest("dialog")) return;
    if (el.classList.contains("intro")) {
      if (e.key.length === 1 || ["Enter", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        toPicker();
      }
      return;
    }
    if (e.key === "ArrowLeft") goTo(active - 1);
    else if (e.key === "ArrowRight") goTo(active + 1);
    else if (e.key === "Enter" || e.key === " ") {
      if (t.closest(".topbar")) return;
      launch(active);
    } else return;
    e.preventDefault();
  });
  addEventListener("resize", () => isOpen && el.classList.contains("pick") && goTo(active, false));

  const hub: Hub = {
    show() {
      isOpen = true;
      document.body.classList.add("hub-open");
      el.classList.remove("hidden");
      if (!el.classList.contains("intro")) {
        el.classList.add("pick");
        requestAnimationFrame(() => goTo(active, false));
        backdrop(active);
      }
    },
    hide() {
      isOpen = false;
      clearTimeout(introTimer);
      backdrop(active);
      document.body.classList.remove("hub-open");
      el.classList.add("hidden");
      el.classList.remove("intro");
    },
    get open() {
      return isOpen;
    },
  };
  setActive(0);
  if (opts.startOpen && opts.intro) {
    el.classList.add("intro");
    // The welcome plays for a few seconds, then the picker slides in (any key/tap skips).
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    introTimer = window.setTimeout(toPicker, reduce ? 1800 : 4200);
  }
  if (opts.startOpen) hub.show();
  else hub.hide();
  return hub;
}
