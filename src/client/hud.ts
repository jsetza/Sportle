// Match presentation on the big screen (owner request): scoreboard with team
// edges and a serving dot, context pills, POINT/GAME/MATCH banners, the "YOU vs …" intro and
// the warm-up toast. Reads the server's snapshot only; nothing here changes the game.
import type { Match, Player } from "../shared/types.ts";
import { gamePoint } from "../shared/rules.ts";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type PointEvent = {
  team: number;
  /** point < game < match */
  size: "point" | "game" | "match";
  /** the receiving side won the rally: serve changes hands, no point */
  sideOut: boolean;
};

export class Hud {
  root: HTMLElement;
  board: HTMLElement;
  pills: HTMLElement;
  banner: HTMLElement;
  intro: HTMLElement;
  toast: HTMLElement;
  prev: Match | null = null;
  sideOutUntil = 0;
  introShown = -1;
  toastUntil = 0;
  digits = ["", ""];
  onPoint: (e: PointEvent) => void = () => {};
  constructor(root: HTMLElement) {
    this.root = root;
    this.board = root.querySelector("#score")!;
    this.pills = root.querySelector("#pills")!;
    this.banner = document.getElementById("banner")!;
    this.intro = document.getElementById("intro")!;
    this.toast = document.getElementById("toast")!;
  }
  /** Team label: "YOU" for this screen's player, otherwise names (or the bot's name). */
  label(m: Match, team: number, local: string[]) {
    const ps = m.players.filter((p) => p.team === team && p.id !== "practice-feed");
    const mine = ps.filter((p) => local.includes(p.id));
    const otherTeamLocal = m.players.some(
      (p) => p.team !== team && local.includes(p.id),
    );
    if (mine.length && !otherTeamLocal) return mine.length > 1 ? "YOU TWO" : "YOU";
    if (m.warmupLeft !== 0 && ps.every((p) => p.bot)) return "WARM-UP";
    return ps.map((p: Player) => p.name.toUpperCase()).join(" & ") || (team ? "RED" : "BLUE");
  }
  update(m: Match, local: string[]) {
    const prev = this.prev;
    this.prev = m;
    const now = performance.now();
    // ——— point / side-out detection ———
    if (
      prev &&
      (prev.phase === "rally" || prev.phase === "serve") &&
      (m.phase === "point" || m.phase === "over") &&
      m.mode !== "practice" &&
      m.warmupLeft === 0
    ) {
      const gained = [0, 1].find(
        (t) => m.score[t] > prev.score[t] || m.games[t] > prev.games[t],
      );
      if (gained !== undefined) {
        const size =
          m.phase === "over" ? "match" : m.gameWinner !== null ? "game" : "point";
        this.onPoint({ team: gained, size, sideOut: false });
        this.showBanner(m, gained, size);
      } else if (m.serving !== prev.serving) {
        this.sideOutUntil = now + 1800;
        this.onPoint({ team: m.serving, size: "point", sideOut: true });
      }
    }
    // ——— scoreboard ———
    const playing = m.phase !== "lobby" && m.mode !== "practice";
    this.board.classList.toggle("practice", !playing);
    if (!playing) {
      if (this.board.dataset.mode !== "practice") {
        this.board.dataset.mode = "practice";
        this.board.innerHTML = `<span class="sname">MOTION LAB</span>`;
      }
    } else {
      this.board.dataset.mode = "match";
      const s = m.score.map(String);
      const names = [0, 1].map((t) => this.label(m, t, local));
      const games =
        m.rules.bestOf > 1
          ? [0, 1].map(
              (t) =>
                `<span class="gpips">${Array.from({ length: 2 }, (_, i) => `<i class="${i < m.games[t] ? "won" : ""}"></i>`).join("")}</span>`,
            )
          : ["", ""];
      const serving = (t: number) =>
        m.phase !== "over" && m.serving === t
          ? `<span class="sdot" title="Serving"></span>${
              m.mode === "coop" || m.mode === "doubles"
                ? `<small class="snum">${m.serverNumber}</small>`
                : ""
            }`
          : "";
      const html = `<span class="sname left">${games[0]}${esc(names[0])}${serving(0)}</span><span class="sdigits"><b class="sd team0" data-v="${s[0]}">${s[0]}</b><b class="sd team1" data-v="${s[1]}">${s[1]}</b></span><span class="sname right">${serving(1)}${esc(names[1])}${games[1]}</span>`;
      if (this.board.dataset.html !== html) {
        this.board.dataset.html = html;
        this.board.innerHTML = html;
        // Flip the digit that changed.
        this.board.querySelectorAll<HTMLElement>(".sd").forEach((d, t) => {
          if (this.digits[t] && this.digits[t] !== s[t]) d.classList.add("flip");
        });
      }
      this.digits = s;
    }
    // ——— context pills ———
    const pills: string[] = [];
    if (m.phase !== "lobby" && m.mode !== "practice") {
      if (m.warmupLeft > 0)
        pills.push(`<span class="pill2 warm">WARM-UP · ${m.warmupLeft} TO GO</span>`);
      else if (m.warmupLeft < 0)
        pills.push(`<span class="pill2 warm">WARM-UP DONE · GAME ON</span>`);
      else if (m.phase === "over") pills.push(`<span class="pill2 big">FINAL</span>`);
      else if (m.gameWinner !== null)
        pills.push(`<span class="pill2 big">GAME ${m.games[0] + m.games[1]} TO ${m.gameWinner ? "RED" : "BLUE"}</span>`);
      else {
        if (now < this.sideOutUntil) pills.push(`<span class="pill2">SIDE OUT</span>`);
        const gp = gamePoint(m, m.serving);
        if (gp) {
          const matchPt = m.games[m.serving] + 1 >= Math.ceil(m.rules.bestOf / 2);
          pills.push(
            `<span class="pill2 hot team${m.serving}">${matchPt ? "MATCH POINT" : "GAME POINT"}</span>`,
          );
        }
        if (m.rules.bestOf > 1)
          pills.push(`<span class="pill2 dim">GAME ${m.games[0] + m.games[1] + 1} · TO ${m.rules.to}</span>`);
      }
      if (m.paused) pills.push(`<span class="pill2">PAUSED</span>`);
    }
    const ph = pills.join("");
    if (this.pills.dataset.html !== ph) {
      this.pills.dataset.html = ph;
      this.pills.innerHTML = ph;
    }
    // ——— match intro: slanted "YOU vs …" banners ———
    const introLeft = m.introUntil - m.time;
    if (m.phase === "serve" && introLeft > 0.15 && this.introShown !== m.introUntil) {
      this.introShown = m.introUntil;
      const sub =
        m.warmupLeft > 0
          ? "WARM-UP · FIND YOUR TIMING"
          : `${({ solo: "SOLO", singles: "1 V 1", coop: "TEAM UP", doubles: "2 V 2" } as Record<string, string>)[m.mode] ?? ""} · GAME TO ${m.rules.to}${m.rules.bestOf > 1 ? " · BEST OF 3" : ""}${m.ranked ? " · RANKED" : ""}`;
      this.intro.innerHTML = `<div class="vsrow"><span class="vs-l team0">${esc(this.label(m, 0, local))}</span><i>vs</i><span class="vs-r team1">${esc(this.label(m, 1, local))}</span></div><div class="vssub">${esc(sub)}</div>`;
      this.intro.classList.remove("hidden", "out");
      void this.intro.offsetWidth;
      this.intro.classList.add("in");
      clearTimeout(this.introTimer);
      this.introTimer = setTimeout(() => {
        this.intro.classList.add("out");
        setTimeout(() => this.intro.classList.add("hidden"), 420);
      }, Math.max(600, introLeft * 1000 - 300));
      if (m.warmupLeft > 0) this.toastUntil = now + 7000;
    }
    // ——— warm-up toast ———
    const toast = m.warmupLeft > 0 && now < this.toastUntil && m.phase !== "lobby";
    if (toast && this.toast.classList.contains("hidden")) {
      this.toast.innerHTML = `<b>WARM-UP</b><span>Forehands, then backhands: find your timing. No points yet</span>`;
      this.toast.classList.remove("hidden");
    } else if (!toast) this.toast.classList.add("hidden");
  }
  introTimer: ReturnType<typeof setTimeout> | undefined;
  bannerTimer: ReturnType<typeof setTimeout> | undefined;
  showBanner(m: Match, team: number, size: PointEvent["size"]) {
    const word = size === "match" ? "MATCH!" : size === "game" ? "GAME!" : "POINT!";
    const sub =
      size === "match"
        ? `${team ? "RED" : "BLUE"} WINS`
        : size === "game"
          ? `${team ? "RED" : "BLUE"} TAKES GAME ${m.games[0] + m.games[1]}`
          : `${m.score[0]} – ${m.score[1]}`;
    this.banner.className = `banner team${team} size-${size}`;
    this.banner.innerHTML = `<b>${word}</b><small>${sub}</small>`;
    void this.banner.offsetWidth;
    this.banner.classList.add("show");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(
      () => this.banner.classList.remove("show"),
      size === "point" ? 1400 : 2600,
    );
  }
}
