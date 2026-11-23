// Sportle start screen (owner request): a short "Welcome to Sportle" intro, then a big
// side-scrolling game picker (swipe, scroll, arrow keys or the ‹ › buttons; Enter plays).
// Purely front-end; the 3D arena keeps running behind it.

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
export function mountHub(root: HTMLElement, opts: { intro: boolean; startOpen: boolean; onPickleball: () => void }): Hub {
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
    <div class="hubhead"><h2>Pick a game</h2><p>Swipe or scroll · ← → to browse · Enter to play</p></div>
    <div class="hubstage">
      <div class="hubrail" id="hubRail" role="list" aria-label="Sportle games">
        ${CARDS.map(
          (c, i) =>
            `<${c.tag} class="hubcard ${c.cls}" id="${c.id}" role="listitem" style="--k:${i}"${c.href ? ` href="${c.href}"` : ""}${c.tag === "div" ? ' aria-disabled="true"' : ""}>
              <span class="hc-art">${c.art}</span>
              <span class="hc-text"><strong>${c.name}</strong><small>${c.line}</small><em>${c.who}</em></span>
              ${c.tag === "div" ? "" : '<span class="hc-go">Play ▶</span>'}
            </${c.tag}>`,
        ).join("")}
      </div>
    </div>
    <div class="hubnav"><button class="hubarrow prev" id="hubPrev" aria-label="Previous game">‹</button><div class="hubdots" id="hubDots">${CARDS.map((_, i) => `<i data-k="${i}"></i>`).join("")}</div><button class="hubarrow next" id="hubNext" aria-label="Next game">›</button></div>
  </div>`;
  root.appendChild(el);
  const rail = el.querySelector<HTMLElement>("#hubRail")!;
  const cards = Array.from(rail.querySelectorAll<HTMLElement>(".hubcard"));
  const dots = Array.from(el.querySelectorAll<HTMLElement>("#hubDots i"));
  let active = 0;
  let isOpen = false;
  let introTimer = 0;

  const setActive = (k: number) => {
    active = k;
    cards.forEach((c, i) => c.classList.toggle("active", i === k));
    dots.forEach((d, i) => d.classList.toggle("on", i === k));
  };
  const goTo = (k: number, smooth = true) => {
    k = Math.max(0, Math.min(cards.length - 1, k));
    const c = cards[k];
    rail.scrollTo({ left: c.offsetLeft + c.offsetWidth / 2 - rail.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
    setActive(k);
  };
  // The card nearest the middle of the rail is the chosen one.
  let raf = 0;
  rail.addEventListener("scroll", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const mid = rail.scrollLeft + rail.clientWidth / 2;
      let best = 0;
      cards.forEach((c, i) => {
        if (Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) < Math.abs(cards[best].offsetLeft + cards[best].offsetWidth / 2 - mid)) best = i;
      });
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
  dots.forEach((d, i) => (d.onclick = () => goTo(i)));

  const toPicker = () => {
    clearTimeout(introTimer);
    if (!el.classList.contains("intro")) return;
    el.classList.remove("intro");
    el.classList.add("pick");
    try {
      sessionStorage.setItem("sportle-intro", "1");
    } catch {}
    requestAnimationFrame(() => goTo(active, false));
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
      }
    },
    hide() {
      isOpen = false;
      clearTimeout(introTimer);
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
