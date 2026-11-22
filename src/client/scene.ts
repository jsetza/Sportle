import type { Match, Player, Vec } from "../shared/types.ts";
import { COURT, OUTFITS, PADDLES, SHOES, clamp } from "../shared/types.ts";
import type { MapId, Outfit } from "../shared/types.ts";
import { LOOKS, buildMap, lightingFor } from "./maps.ts";
import { Renderer, STRIDE } from "./renderer.ts";
import type { Decal, Post, ViewDraw } from "./renderer.ts";
import { Effects, calloutHtml, placeMeter } from "./effects.ts";
import type { Timing } from "../shared/types.ts";
type V = number[];
const sub = (a: V, b: V) => a.map((v, i) => v - b[i]);
const cross = (a: V, b: V) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V) => {
  const l = Math.hypot(...a);
  return a.map((v) => v / l);
};
const dot = (a: V, b: V) => a.reduce((s, v, i) => s + v * b[i], 0);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth01 = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
function multiply(a: V, b: V) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let i = 0; i < 4; i++) o[c * 4 + r] += a[i * 4 + r] * b[c * 4 + i];
  return o;
}
/** View-projection with a horizontal lens shift, so the court can sit beside the menu panel. */
function camera(aspect: number, eye: V, target: V, fov: number, shift: number) {
  const z = norm(sub(eye, target)),
    x = norm(cross([0, 1, 0], z)),
    y = cross(z, x);
  const v = [
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ];
  // Near plane at 0.3 m (was 0.1): ~3× better depth precision, so distant scenery doesn't
  // flicker. The closest thing drawn (first-person paddle) is ~0.7 m away.
  const f = 1 / Math.tan((fov * Math.PI) / 360),
    near = 0.3,
    far = 220;
  return multiply(
    [
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      -shift,
      0,
      (far + near) / (near - far),
      -1,
      0,
      0,
      (2 * far * near) / (near - far),
      0,
    ],
    v,
  );
}
export const palette = {
  floor: [0.2, 0.055, 0.1],
  apron: [0.09, 0.14, 0.26],
  court: [0.21, 0.39, 0.83],
  kitchen: [0.3, 0.5, 0.9],
  line: [0.96, 0.97, 1],
  board: [0.06, 0.06, 0.11],
  ink: [0.86, 0.87, 0.93],
  blue: [0.33, 0.66, 0.98],
  red: [0.86, 0.17, 0.27],
  orange: [1, 0.55, 0.18],
  gold: [0.93, 0.74, 0.32],
  white: [0.97, 0.96, 0.93],
  dark: [0.05, 0.05, 0.08],
  /** Optic yellow of a typical outdoor pickleball. */
  ball: [0.86, 0.95, 0.16],
  ballHole: [0.2, 0.24, 0.05],
  fog: [0.035, 0.035, 0.07],
};
/** 40 evenly spread hole directions (Fibonacci sphere), like an outdoor pickleball. */
const BALL_HOLES: number[][] = Array.from({ length: 40 }, (_, i) => {
  const y = 1 - ((i + 0.5) / 40) * 2,
    rr = Math.sqrt(1 - y * y),
    a = i * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(a) * rr, y, Math.sin(a) * rr];
});
export const teamColor = (team: number) => (team ? palette.red : palette.blue);
/** 5×7 pixel letters for the arena boards (original lettering, drawn with boxes). */
const GLYPHS: Record<string, string[]> = {
  V: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  ">": ["0000", "1100", "0110", "0011", "0110", "1100", "0000"],
};
type View = { eye: V; target: V; fov: number; shift: number };
export type ViewMode = "third" | "first" | "broadcast";
export const VIEW_LABELS: Record<ViewMode, string> = {
  third: "Third person",
  first: "First person",
  broadcast: "Broadcast",
};
export class Scene {
  canvas: HTMLCanvasElement;
  gl: Renderer;
  /** Geometry being built: 13 floats per vertex (see renderer STRIDE). */
  vertices: number[] = [];
  /** Additive glow geometry being built this frame (trails, rings, flashes). */
  fxv: number[] = [];
  /** Current material for new triangles: specular, emissive, reflective, pattern. */
  mat: [number, number, number, number] = [0.15, 0, 0, 0];
  material(spec: number, emit = 0, refl = 0, pattern = 0) {
    this.mat = [spec, emit, refl, pattern];
  }
  /** Run `fn` with a material, then restore the previous one. */
  with(m: [number, number?, number?, number?], fn: () => void) {
    const prev = this.mat;
    this.mat = [m[0], m[1] ?? 0, m[2] ?? 0, m[3] ?? 0];
    fn();
    this.mat = prev;
  }
  /** Maps mark lit windows, neon and lamps as glowing (bloom). */
  glow(k: number) {
    this.mat = [this.mat[0], k, this.mat[2], this.mat[3]];
  }
  state: Match | null = null;
  history: { state: Match; at: number }[] = [];
  raf = 0;
  lastEvent = -1;
  lastBounceAt = 0;
  /** Ball orientation (3×3 row-major) so the holes roll with the flight. */
  ballRot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  lastBallPos: Vec | null = null;
  /** Spin the ball's holes by the distance it travelled (scaled down so it stays readable). */
  rollBall(ball: Vec) {
    const last = this.lastBallPos;
    this.lastBallPos = { ...ball };
    if (!last) return;
    const dx = ball.x - last.x,
      dz = ball.z - last.z,
      d = Math.hypot(dx, dz);
    if (d < 1e-4 || d > 1.5) return; // still, or a jump to a new serve
    const ax = dz / d,
      az = -dx / d, // axis = up × direction of travel
      a = Math.min(0.9, (d / 0.11) * 0.12),
      c = Math.cos(a),
      sn = Math.sin(a),
      t = 1 - c;
    // Rodrigues rotation about (ax, 0, az), then apply to the current orientation.
    const R = [
      t * ax * ax + c,
      -sn * az,
      t * ax * az,
      sn * az,
      c,
      -sn * ax,
      t * ax * az,
      sn * ax,
      t * az * az + c,
    ];
    const M = this.ballRot,
      out = new Array(9).fill(0);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++)
          out[i * 3 + j] += R[i * 3 + k] * M[k * 3 + j];
    this.ballRot = out;
  }
  /** A pickleball: optic-yellow shell with 40 round holes (generic; no brand markings). */
  pickleball(x: number, y: number, z: number, r: number) {
    const prev = this.mat;
    this.material(0.6, 0.22);
    this.blob(x, y, z, r, r, r, palette.ball, 0, 10, 16);
    this.material(0.2, 0);
    const M = this.ballRot;
    for (const [hx, hy, hz] of BALL_HOLES) {
      const wx = M[0] * hx + M[1] * hy + M[2] * hz,
        wy = M[3] * hx + M[4] * hy + M[5] * hz,
        wz = M[6] * hx + M[7] * hy + M[8] * hz;
      this.blob(
        x + wx * r * 0.86,
        y + wy * r * 0.86,
        z + wz * r * 0.86,
        r * 0.155,
        r * 0.155,
        r * 0.155,
        palette.ballHole,
        0,
        3,
        6,
      );
    }
    this.mat = prev;
  }
  lastFrame = 0;
  lastSnapAt = 0;
  offsets = new Map<string, Vec>();
  /** Where and when each player last struck the ball, so every view shows paddle meeting ball. */
  contactAt = new Map<string, Vec & { at: number }>();
  /** Pull a paddle toward its contact point around the moment of a hit (all camera views). */
  reach(
    id: string,
    px: number,
    py: number,
    pz: number,
  ): [number, number, number] {
    const c = this.contactAt.get(id);
    if (!c) return [px, py, pz];
    const age = (performance.now() - c.at) / 1000;
    if (age > 0.25) return [px, py, pz];
    const w = (1 - age / 0.25) ** 2;
    return [px + (c.x - px) * w, py + (c.y - py) * w, pz + (c.z - pz) * w];
  }
  shown = new Map<string, Vec>();
  lastContacts = -1;
  fx = new Effects();
  /** Latest human timing verdict to show (callout + meter), and when it arrived. */
  callout: { t: Timing; at: number; by: string } | null = null;
  /** Contact count when the current rally began (for the RALLY counter). */
  rallyBase = 0;
  rallyCount = 0;
  audio: AudioContext | null = null;
  muted = true;
  view: View = {
    eye: [-2.6, 1.8, 10.5],
    target: [0.6, 0.9, 0],
    fov: 42,
    shift: 0.34,
  };
  /** Set by the UI: is the left panel covering part of the screen? */
  panelOpen = true;
  /** Camera choice during play. Player views follow `follow` (this screen's player 1). */
  viewMode: ViewMode = "third";
  /** This screen's players (up to two). Two players + a player view = split screen. */
  follows: string[] = [];
  follow: string | null = null;
  views: View[] = [];
  /** Aspect ratio of the view being drawn (a split-screen half is narrow). */
  aspect = 16 / 9;
  followPos: Vec | null = null;
  followTeam = 0;
  /** HTML name tags floating over players' heads (crisp text, projected from 3D each frame). */
  tagLayer: HTMLDivElement;
  tagEls = new Map<string, HTMLDivElement>();
  tags: {
    id: string;
    name: string;
    team: number;
    x: number;
    y: number;
    z: number;
  }[] = [];
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.tagLayer = document.createElement("div");
    this.tagLayer.className = "nametags";
    this.tagLayer.setAttribute("aria-hidden", "true");
    canvas.after(this.tagLayer);
    this.gl = new Renderer(canvas);
    this.build();
    this.render();
  }
  map: MapId = "arena";
  /** Switch the court's surroundings (owner request: choosable maps). */
  setMap(id: MapId) {
    if (id === this.map || !LOOKS[id]) return;
    this.map = id;
    this.build();
  }
  build() {
    this.vertices = [];
    this.fxv = [];
    this.mat = [0.15, 0, 0, 0];
    this.arena();
    this.gl.setStatic(new Float32Array(this.vertices));
    // Static glow: light shafts under each spotlight.
    this.vertices = [];
    for (const sp of lightingFor(this.map).spots)
      this.shaft(sp.pos, sp.dir, sp.outer, sp.color);
    this.gl.setStaticFx(new Float32Array(this.vertices));
    this.vertices = [];
    this.mat = [0.15, 0, 0, 0];
  }
  /** Soft cone of light from a spotlight down to the floor (additive, faint). */
  shaft(pos: number[], dir: number[], outer: number, color: number[]) {
    const d = norm(dir),
      len = (pos[1] - 0.05) / Math.max(0.2, -d[1]),
      r = Math.tan((outer * 0.8 * Math.PI) / 180) * len,
      u = norm(cross(d, Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])),
      v = cross(d, u),
      n = 28;
    const k = Math.max(...color) || 1,
      c = color.map((x) => (x / k) * 0.55);
    const end = pos.map((p, i) => p + d[i] * len);
    for (const [rad, str] of [
      [r, 0.032],
      [r * 0.55, 0.04],
    ])
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2,
          a1 = ((i + 1) / n) * Math.PI * 2;
        const ring = (a: number) =>
          end.map(
            (e, j) => e + (u[j] * Math.cos(a) + v[j] * Math.sin(a)) * rad,
          );
        const p0 = ring(a0),
          p1 = ring(a1);
        const nrm = (a: number) =>
          norm(u.map((x, j) => x * Math.cos(a) + v[j] * Math.sin(a)));
        // Bright at the lamp, fading to nothing at the floor; edges fade by view angle.
        this.mat = [0, str, 1, 0];
        this.vertex(pos, nrm((a0 + a1) / 2), c);
        this.vertex(
          p0,
          nrm(a0),
          c.map((x) => x * 0.25),
        );
        this.vertex(
          p1,
          nrm(a1),
          c.map((x) => x * 0.25),
        );
      }
  }
  /** Append one vertex (position, normal, colour, current material). */
  vertex(p: V, n: V, c: V, light = 1) {
    const out = this.vertices,
      m = this.mat;
    out.push(
      p[0],
      p[1],
      p[2],
      n[0],
      n[1],
      n[2],
      c[0] * light,
      c[1] * light,
      c[2] * light,
      m[0],
      m[1],
      m[2],
      m[3],
    );
  }
  /** Flip sound effects on/off; returns true when sound is now on. */
  sound() {
    this.setSound(this.muted);
    return !this.muted;
  }
  setSound(on: boolean) {
    this.muted = !on;
    if (on) this.wakeAudio();
  }
  /** Browsers only allow audio after a click/key, so call this from a user gesture. */
  wakeAudio() {
    if (this.muted) return;
    if (!this.audio) {
      this.audio = new AudioContext();
      const len = Math.floor(this.audio.sampleRate * 0.12);
      this.noise = this.audio.createBuffer(1, len, this.audio.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    this.audio.resume();
  }
  noise: AudioBuffer | null = null;
  tone(
    freq: number,
    to: number,
    dur: number,
    gain = 0.09,
    type: OscillatorType = "sine",
  ) {
    if (this.muted || !this.audio) return;
    const a = this.audio,
      o = a.createOscillator(),
      g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur * 0.8);
    g.gain.setValueAtTime(gain, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g).connect(this.sfxOut());
    o.start();
    o.stop(a.currentTime + dur + 0.01);
  }
  /** Short filtered noise click, the "crack" part of a hit or bounce. */
  click(
    freq: number,
    q: number,
    dur: number,
    gain: number,
    type: BiquadFilterType,
  ) {
    if (this.muted || !this.audio || !this.noise) return;
    const a = this.audio,
      src = a.createBufferSource(),
      f = a.createBiquadFilter(),
      g = a.createGain(),
      t = a.currentTime;
    src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(this.sfxOut());
    src.start(t);
    src.stop(t + dur + 0.01);
  }
  /** Paddle hitting the ball: a bright hollow "pock". power 0..1 = gentle..hard. */
  hitSound(power: number) {
    const p = clamp(power, 0, 1),
      v = 0.55 + 0.45 * p,
      jitter = 1 + (Math.random() - 0.5) * 0.06;
    this.click(1500 + 1300 * p, 2.2, 0.045 + 0.02 * p, 0.32 * v, "bandpass");
    this.tone(1050 * jitter, 640 * jitter, 0.07, 0.16 * v);
    this.tone(430 * jitter, 300 * jitter, 0.09, 0.09 * v, "triangle");
  }
  /** Ball hitting the court: a duller, lower "tock". power 0..1 = soft..fast landing. */
  bounceSound(power: number) {
    const p = clamp(power, 0, 1),
      v = 0.3 + 0.7 * p,
      jitter = 1 + (Math.random() - 0.5) * 0.08;
    this.click(700 + 500 * p, 0.8, 0.035, 0.22 * v, "lowpass");
    this.tone(360 * jitter, 210 * jitter, 0.06, 0.13 * v);
  }
  update(state: Match) {
    if (state.map) this.setMap(state.map);
    const prev = this.state;
    this.state = state;
    this.history.push({ state, at: performance.now() });
    if (this.history.length > 8) this.history.shift();
    const hit =
      prev && state.contacts > this.lastContacts && this.lastContacts >= 0;
    if (hit) {
      const v = state.velocity,
        speed = Math.hypot(v.x, v.y, v.z);
      this.hitSound(0.6 * clamp((speed - 4) / 18, 0, 1) + 0.4 * state.quality);
    } else if (prev && (prev.phase === "rally" || prev.phase === "point")) {
      // Ground contact: the server counted a bounce, or the ball was falling low and stopped
      // falling (also catches a landing that ends the rally as a fault before it is counted).
      const counted = state.bounces > prev.bounces,
        landed =
          prev.velocity.y < -0.5 && state.velocity.y >= 0 && state.ball.y < 0.4;
      const now = performance.now();
      if ((counted || landed) && now - this.lastBounceAt > 90) {
        this.lastBounceAt = now;
        this.bounceSound((-prev.velocity.y - 0.5) / 8);
        const out =
          Math.abs(state.ball.x) > COURT.halfWidth + 0.05 ||
          Math.abs(state.ball.z) > COURT.halfLength + 0.05;
        this.fx.bounce(state.ball, now, out);
      }
    }
    if (hit) {
      const p = state.players.find((q) => q.id === state.lastPlayer);
      const now = performance.now();
      if (p) this.contactAt.set(p.id, { ...state.ball, at: now });
      const t = state.timing?.at === state.contacts ? state.timing : null;
      const v = state.velocity,
        kmh = Math.round(Math.hypot(v.x, v.y, v.z) * 3.6);
      const stroke = t?.stroke ?? (state.shot.split(" ").pop() || "drive");
      const local = !!p && this.follows.includes(p.id);
      this.fx.contact(state.ball, now, {
        team: p ? teamColor(p.team) : palette.ball,
        stroke,
        kmh,
        timing: t,
        local,
      });
      // Timing callout for human hits: players on this screen, or everyone if none are.
      if (t && (local || !this.follows.length))
        this.callout = { t, at: now, by: t.by };
    }
    // RALLY counter: paddle contacts since the rally started (serve included).
    if (state.phase === "serve" || state.phase === "lobby" || !prev)
      this.rallyBase = state.contacts;
    this.rallyCount =
      state.phase === "rally" || state.phase === "point"
        ? state.contacts - this.rallyBase
        : 0;
    this.lastContacts = state.contacts;
    if (state.event !== this.lastEvent) {
      this.lastEvent = state.event;
      const msg = state.message;
      if (/fault|Out|Net|wins|Double bounce|hit /i.test(msg))
        this.tone(330, 220, 0.25, 0.05, "triangle");
    }
  }
  // ——— geometry primitives ———
  /** Flat triangle; its normal points away from `inside` (a point inside the solid). */
  tri(a: V, b: V, c: V, color: V, light = 1, inside?: V) {
    let n = cross(sub(b, a), sub(c, a));
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / l, n[1] / l, n[2] / l];
    if (inside) {
      const ctr = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ];
      if (dot(n, sub(ctr, inside)) < 0) n = [-n[0], -n[1], -n[2]];
    } else if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    this.vertex(a, n, color, light);
    this.vertex(b, n, color, light);
    this.vertex(c, n, color, light);
  }
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: V,
    rx = 0,
    rz = 0,
    ry = 0,
  ) {
    const pts = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ].map((p) => {
      let a = (p[0] * w) / 2,
        b = (p[1] * h) / 2,
        c = (p[2] * d) / 2;
      const by = b * Math.cos(rx) - c * Math.sin(rx);
      c = b * Math.sin(rx) + c * Math.cos(rx);
      b = by;
      const ax = a * Math.cos(ry) + c * Math.sin(ry);
      c = -a * Math.sin(ry) + c * Math.cos(ry);
      a = ax;
      return [
        x + a * Math.cos(rz) - b * Math.sin(rz),
        y + a * Math.sin(rz) + b * Math.cos(rz),
        z + c,
      ];
    });
    // Real lighting now shades the faces; normals point out of the box.
    const ctr = [x, y, z];
    for (const f of [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 4, 7, 3],
      [1, 5, 6, 2],
      [3, 2, 6, 7],
      [0, 1, 5, 4],
    ]) {
      this.tri(pts[f[0]], pts[f[1]], pts[f[2]], color, 1, ctr);
      this.tri(pts[f[0]], pts[f[2]], pts[f[3]], color, 1, ctr);
    }
  }
  /** Ellipsoid; with `stretch` > 0 the two hemispheres are pulled apart into a capsule. */
  blob(
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    color: V,
    stretch = 0,
    rings = 8,
    segs = 12,
  ) {
    const p = (i: number, j: number) => {
      const a = (i * Math.PI) / rings,
        b = (j * 2 * Math.PI) / segs;
      const off = i <= rings / 2 ? stretch / 2 : -stretch / 2;
      return [
        x + Math.sin(a) * Math.cos(b) * rx,
        y + Math.cos(a) * ry + off,
        z + Math.sin(a) * Math.sin(b) * rz,
      ];
    };
    // Smooth ellipsoid normals (gradient of the surface), so blobs light like curved plastic.
    const nrm = (i: number, j: number) => {
      const a = (i * Math.PI) / rings,
        b = (j * 2 * Math.PI) / segs;
      return norm([
        (Math.sin(a) * Math.cos(b)) / rx,
        Math.cos(a) / ry,
        (Math.sin(a) * Math.sin(b)) / rz,
      ]);
    };
    const flat = ry < 0.01; // floor decals: face straight up
    const vtx = (i: number, j: number) =>
      this.vertex(p(i, j), flat ? [0, 1, 0] : nrm(i, j), color);
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < segs; j++) {
        vtx(i, j);
        vtx(i + 1, j);
        vtx(i + 1, j + 1);
        vtx(i, j);
        vtx(i + 1, j + 1);
        vtx(i, j + 1);
        if (stretch && i === rings / 2 - 1) {
          // cylinder band between the hemispheres
          const a = p(i + 1, j),
            b = p(i + 1, j + 1);
          const c = [b[0], b[1] - stretch, b[2]],
            d = [a[0], a[1] - stretch, a[2]];
          const na = nrm(i + 1, j),
            nb = nrm(i + 1, j + 1);
          this.vertex(a, na, color);
          this.vertex(d, na, color);
          this.vertex(c, nb, color);
          this.vertex(a, na, color);
          this.vertex(c, nb, color);
          this.vertex(b, nb, color);
        }
      }
  }
  sphere(x: number, y: number, z: number, r: number, color: V) {
    this.blob(x, y, z, r, r, r, color);
  }
  /** Flat ring of segments on the floor. */
  ring(
    x: number,
    z: number,
    r: number,
    color: V,
    y = 0.03,
    width = 0.06,
    n = 20,
  ) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.box(
        x + Math.cos(a) * r,
        y,
        z + Math.sin(a) * r,
        (2 * Math.PI * r) / n + 0.01,
        0.012,
        width,
        color,
        0,
        0,
        -a + Math.PI / 2,
      );
    }
  }
  /** Pixel lettering on a board. `u` is the reading direction along X (ux=1) or Z (ux=0). */
  text(
    s: string,
    x: number,
    y: number,
    z: number,
    size: number,
    ux: number,
    uz: number,
    color: V,
    draw = true,
  ) {
    let cursor = 0;
    for (const ch of s) {
      if (ch === " ") {
        cursor += 3;
        continue;
      }
      if (ch === "|" || ch === "!") {
        // colour stripes
        const col = ch === "|" ? palette.blue : palette.red;
        if (draw)
          this.box(
            x + (cursor + 0.5) * size * ux,
            y + 3 * size,
            z + (cursor + 0.5) * size * uz,
            size * (ux ? 0.9 : 0.25),
            size * 6,
            size * (uz ? 0.9 : 0.25),
            col,
          );
        cursor += 1.6;
        continue;
      }
      const g = GLYPHS[ch];
      if (!g) continue;
      const col = ch === ">" ? palette.orange : color;
      g.forEach((row, r) =>
        [...row].forEach((bit, c) => {
          if (bit !== "1" || !draw) return;
          // slanted lettering: shift rows to the right as they go up
          const slant = (6 - r) * 0.22;
          const px = cursor + c + slant;
          this.box(
            x + px * size * ux,
            y + (6 - r) * size,
            z + px * size * uz,
            size * (ux ? 0.92 : 0.2),
            size * 0.92,
            size * (uz ? 0.92 : 0.2),
            col,
          );
        }),
      );
      cursor += g[0].length + 1;
    }
    return cursor * size;
  }
  // ——— static arena ———
  arena() {
    const P = palette,
      look = LOOKS[this.map];
    const arena = this.map === "arena";
    // Arena floor: deep red carpet with a fine speckle (like a TV event floor).
    this.material(0.1, 0, arena ? 0.05 : 0, arena ? 1 : 0);
    // Ground under the court area. Its top sits at -3.5 cm: below the maps' paths (-1 cm) and
    // above their lawns (-5 cm), so no two layers share a height and flicker against each other.
    if (look.ground) this.box(0, -0.085, 0, 90, 0.1, 90, look.ground);
    this.material(0.12, 0, arena ? 0.05 : 0.12, arena ? 1 : 0);
    this.box(0, -0.02, 0, 11, 0.04, 21, look.apron);
    // Glossy court: sharp highlights and a soft reflection of the players.
    // Satin court: highlights without a white glare when the sun is low.
    // Indoors/at night the court mirrors the lit players nicely; in daylight a mirror-like
    // floor just smears the bright surroundings across it, so it's mostly matte there.
    const night = arena || this.map === "tokyo" || this.map === "nyc";
    this.material(night ? 0.3 : 0.1, 0, night ? 0.25 : 0.08, 2);
    this.box(0, -0.005, 0, 6.096, 0.03, 13.4112, P.court);
    this.box(0, 0.012, 0, 6.096, 0.012, 4.2672, P.kitchen);
    this.material(0.45, 0.04, 0.2);
    for (const z of [-6.6802, -2.1082, 2.1082, 6.6802])
      this.box(0, 0.022, z, 6.096, 0.012, 0.0508, P.line);
    for (const x of [-3.0226, 3.0226])
      this.box(x, 0.022, 0, 0.0508, 0.012, 13.4112, P.line);
    for (const z of [-4.4196, 4.4196])
      this.box(0, 0.022, z, 0.0508, 0.012, 4.572, P.line);
    this.material(0.1, 0, 0, 0);
    if (arena)
      // floor branding beside the court (subtle)
      this.text("SPORTLE", -9.6, 0.004, 5.4, 0.32, 0, -1, [0.32, 0.09, 0.15]);
    // net
    this.material(0.7);
    for (const x of [-COURT.post, COURT.post]) {
      this.box(x, 0.5, 0, 0.09, 1.0, 0.09, P.dark);
      this.with([0.6, 0.6], () =>
        this.box(x, 1.0, 0, 0.13, 0.05, 0.13, P.orange),
      );
    }
    this.material(0.15);
    for (let x = -3.3; x < 3.3; x += 0.11)
      this.box(
        x,
        COURT.netCenter / 2 + 0.03,
        0,
        0.008,
        COURT.netCenter - 0.06,
        0.012,
        [0.12, 0.12, 0.17],
      );
    for (let y = 0.08; y < 0.84; y += 0.09)
      this.box(0, y, 0, 6.6, 0.008, 0.012, [0.12, 0.12, 0.17]);
    this.material(0.35, 0.08);
    for (let x = -3.3; x < 3.3; x += 0.33) {
      const h = COURT.netCenter + (Math.abs(x) / 3.048) * 0.0508;
      this.box(x, h, 0, 0.34, 0.05, 0.03, P.white);
    }
    this.material(0.15);
    if (this.map !== "arena") {
      buildMap(this, this.map);
      this.material(0.15);
      return;
    }
    // ad boards with original lettering on three sides
    const boardH = 0.95;
    const bx = 6.2,
      bz = 11.2;
    this.material(0.8);
    this.box(-bx, boardH / 2, -0.3, 0.12, boardH, 22.4, P.board);
    this.box(bx, boardH / 2, -0.3, 0.12, boardH, 22.4, P.board);
    this.box(0, boardH / 2, -bz, 12.5, boardH, 0.12, P.board);
    // LED strip along the top edge of the boards
    this.material(0.2, 0.9);
    this.box(
      -bx + 0.07,
      boardH + 0.01,
      -0.3,
      0.02,
      0.025,
      22.4,
      [0.75, 0.55, 1],
    );
    this.box(
      bx - 0.07,
      boardH + 0.01,
      -0.3,
      0.02,
      0.025,
      22.4,
      [0.75, 0.55, 1],
    );
    this.box(0, boardH + 0.01, -bz + 0.07, 12.5, 0.025, 0.02, [0.75, 0.55, 1]);
    // LED lettering (emissive, blooms)
    this.material(0.2, 0.75);
    const slogan = "SPORTLE >>|! ";
    const sw = this.text(slogan, 0, 0, 0, 0.09, 1, 0, P.ink, false) + 0.4;
    for (let z = 9.6; z - sw > -bz + 0.4; z -= sw) {
      this.text(slogan, -bx + 0.08, 0.14, z, 0.09, 0, -1, P.ink);
      this.text(slogan, bx - 0.08, 0.14, z - sw + 0.4, 0.09, 0, 1, P.ink);
    }
    const count = Math.floor((bx * 2 - 0.6) / sw);
    for (let i = 0, x0 = -(count * sw) / 2 + 0.2; i < count; i++)
      this.text(slogan, x0 + i * sw, 0.14, -bz + 0.08, 0.09, 1, 0, P.ink);
    // tiered crowd stands, deterministic pseudo-random fans (dim, matte)
    this.material(0.06);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const fans = [
      [0.55, 0.16, 0.22],
      [0.2, 0.3, 0.55],
      [0.6, 0.45, 0.2],
      [0.3, 0.3, 0.36],
      [0.45, 0.2, 0.5],
      [0.18, 0.45, 0.42],
      [0.7, 0.68, 0.62],
      [0.12, 0.12, 0.18],
    ];
    const fan = (x: number, y: number, z: number, face: number) => {
      const c = fans[Math.floor(rnd() * fans.length)].map(
        (v) => v * (0.26 + rnd() * 0.16),
      );
      if (rnd() < 0.12) return; // empty seat
      const h = 0.95 + rnd() * 0.25;
      this.blob(x, y + h * 0.42, z, 0.24, 0.24, 0.22, c, h * 0.4, 4, 6);
      this.blob(
        x,
        y + h * 0.95,
        z,
        0.17,
        0.19,
        0.17,
        c.map((v) => v * 1.1),
        0,
        4,
        6,
      );
      if (rnd() < 0.08)
        this.box(x, y + h * 1.3, z, 0.05, 0.4, 0.05, c, 0, face * 0.3); // raised arm
    };
    for (let tier = 0; tier < 6; tier++) {
      const lift = 0.35 + tier * 0.55,
        back = 1.3 + tier * 0.85;
      this.box(
        -bx - back,
        lift / 2,
        -0.3,
        0.85,
        lift,
        24 + tier * 1.6,
        [0.05, 0.045, 0.08],
      );
      this.box(
        bx + back,
        lift / 2,
        -0.3,
        0.85,
        lift,
        24 + tier * 1.6,
        [0.05, 0.045, 0.08],
      );
      this.box(
        0,
        lift / 2,
        -bz - back,
        12.4 + back * 2,
        lift,
        0.85,
        [0.05, 0.045, 0.08],
      );
      for (let z = -11 - tier * 0.8; z < 10.5; z += 0.62) {
        fan(-bx - back, lift, z, 1);
        fan(bx + back, lift, z, -1);
      }
      for (let x = -6 - back; x < 6 + back; x += 0.62)
        fan(x, lift, -bz - back, 0);
    }
    // light gantries with the spotlight heads
    this.material(0.5);
    for (const x of [-5, 0, 5])
      this.box(x, 10.8, -2, 0.3, 0.3, 26, [0.1, 0.1, 0.14]);
    for (const sp of lightingFor("arena").spots) {
      this.box(
        sp.pos[0],
        sp.pos[1] + 0.15,
        sp.pos[2],
        0.6,
        0.45,
        0.6,
        [0.08, 0.08, 0.1],
      );
      this.with([0.2, 3], () =>
        this.blob(
          sp.pos[0],
          sp.pos[1] - 0.08,
          sp.pos[2],
          0.24,
          0.05,
          0.24,
          [1, 0.95, 0.86],
          0,
          2,
          10,
        ),
      );
    }
    this.material(0.15);
  }
  // ——— characters ———
  mascot(
    p: Pick<Player, "team" | "hand" | "bot" | "id"> & {
      outfit?: Outfit;
      gear?: Player["gear"];
    },
    pos: Vec,
    opts: {
      swing: number;
      pitch: number;
      roll: number;
      yaw: number;
      moving: number;
      server: boolean;
      owner: boolean;
      label?: number;
      /** First-person view of this player: draw only the paddle, out in front of the eyes. */
      firstPerson?: boolean;
      /** 0..1: arms up, celebrating a won point. */
      cheer?: number;
    },
  ) {
    const prevMat = this.mat;
    this.material(0.55);
    if (opts.firstPerson) this.fpPaddle(p, pos, opts);
    else this.mascotBody(p, pos, opts);
    this.mat = prevMat;
  }
  mascotBody(
    p: Pick<Player, "team" | "hand" | "bot" | "id"> & {
      outfit?: Outfit;
      gear?: Player["gear"];
    },
    pos: Vec,
    opts: {
      swing: number;
      pitch: number;
      roll: number;
      yaw: number;
      moving: number;
      server: boolean;
      owner: boolean;
      cheer?: number;
    },
  ) {
    const col = teamColor(p.team),
      facing = p.team ? -1 : 1,
      hand = (p.hand === "left" ? -1 : 1) * facing,
      bob =
        Math.sin(performance.now() / 85) * Math.min(0.05, opts.moving * 0.015);
    const cheer = opts.cheer ?? 0;
    // Celebration hop.
    const y0 = bob + cheer * Math.abs(Math.sin(performance.now() / 160)) * 0.16;
    // player indicator ring (and a fake shadow when real shadows are off)
    if (!this.gl.shadows)
      this.blob(
        pos.x,
        0.02,
        pos.z,
        0.42,
        0.005,
        0.42,
        [0.04, 0.04, 0.07],
        0,
        2,
        14,
      );
    this.with([0.3, opts.owner ? 0.5 : 0.35], () =>
      this.ring(
        pos.x,
        pos.z,
        0.55,
        opts.owner ? palette.white : col,
        0.035,
        0.05,
      ),
    );
    // body capsule
    this.blob(pos.x, y0 + 0.86, pos.z, 0.34, 0.34, 0.3, col, 0.95);
    // belt band
    this.blob(
      pos.x,
      y0 + 0.62,
      pos.z,
      0.355,
      0.05,
      0.315,
      palette.gold,
      0,
      2,
      14,
    );
    // jersey: two white chest/back stripes and a team number plate on the back
    for (const yy of [1.02, 1.1])
      this.blob(
        pos.x,
        y0 + yy,
        pos.z,
        0.345,
        0.018,
        0.305,
        palette.white,
        0,
        2,
        14,
      );
    this.box(
      pos.x,
      y0 + 0.82,
      pos.z + 0.3 * facing,
      0.22,
      0.2,
      0.02,
      palette.white,
    );
    this.box(
      pos.x,
      y0 + 0.82,
      pos.z + 0.312 * facing,
      0.16,
      0.14,
      0.02,
      col.map((v) => v * 0.55),
    );
    // face plate + shades (or the face photo, which replaces the shades)
    const fz = pos.z - 0.21 * facing;
    this.blob(pos.x, y0 + 1.28, fz, 0.22, 0.25, 0.12, palette.white);
    const photo = this.faces.has(p.id);
    if (photo) {
      // The plate faces -facing in z; the photo sits just in front of it.
      const z = fz - 0.125 * facing,
        hw = 0.21,
        hh = 0.25,
        r = -facing; // screen-left/right flips with facing so the photo isn't mirrored
      this.decals.push({
        key: "face:" + p.id,
        corners: [
          [pos.x - hw * r, y0 + 1.28 - hh, z],
          [pos.x + hw * r, y0 + 1.28 - hh, z],
          [pos.x + hw * r, y0 + 1.28 + hh, z],
          [pos.x - hw * r, y0 + 1.28 + hh, z],
        ],
      });
    }
    const eyes = photo ? -1 : (p.gear?.eyes ?? 0);
    this.material(0.95);
    if (eyes >= 0)
      this.box(
        pos.x,
        y0 + 1.33,
        fz - 0.1 * facing,
        0.34,
        eyes === 2 ? 0.1 : 0.075,
        0.05,
        eyes === 1 ? palette.gold : eyes === 2 ? palette.orange : palette.dark,
      );
    if (eyes === 1)
      this.box(
        pos.x,
        y0 + 1.36,
        fz - 0.11 * facing,
        0.36,
        0.02,
        0.05,
        palette.dark,
      );
    if (eyes === 2)
      this.blob(
        pos.x,
        y0 + 1.33,
        pos.z,
        0.335,
        0.035,
        0.3,
        palette.dark,
        0,
        2,
        14,
      );
    if (eyes >= 0)
      this.box(
        pos.x,
        y0 + 1.19,
        fz - 0.11 * facing,
        0.11,
        0.02,
        0.03,
        palette.dark,
      );
    this.material(0.45);
    this.outfit(p.outfit ?? "classic", pos.x, y0, pos.z, facing, col);
    this.material(0.55);
    if (p.bot) {
      this.box(pos.x, y0 + 1.95, pos.z, 0.03, 0.28, 0.03, palette.dark);
      this.sphere(pos.x, y0 + 2.12, pos.z, 0.06, palette.orange);
    }
    // feet
    for (const s of [-1, 1])
      this.blob(
        pos.x + s * 0.15,
        0.08,
        pos.z - 0.04 * facing + s * bob,
        0.11,
        0.08,
        0.15,
        (SHOES[p.gear?.shoes ?? 0] ?? SHOES[0]).color as unknown as V,
        0,
        4,
        8,
      );
    const paddleColor = (PADDLES[p.gear?.paddle ?? 0] ?? PADDLES[0])
      .color as unknown as V;
    // paddle arm + paddle (orientation mirrors the phone); arms up when cheering
    const swing = opts.swing;
    let [px, py, pz] = this.reach(
      p.id,
      pos.x + hand * (0.52 + swing * 0.1),
      y0 + 0.92 + swing * 0.22,
      pos.z - (0.28 + swing * 0.25) * facing,
    );
    if (cheer > 0) {
      const wave = Math.sin(performance.now() / 120) * 0.08;
      px = lerp(px, pos.x + hand * 0.42 + wave, cheer);
      py = lerp(py, y0 + 2.05, cheer);
      pz = lerp(pz, pos.z, cheer);
      // the free arm goes up too
      const ox = pos.x - hand * 0.42 - wave;
      this.box(
        ox,
        y0 + 1.62,
        pos.z,
        0.09,
        0.62,
        0.09,
        col,
        0,
        -hand * 0.25 * cheer,
      );
      this.sphere(ox - hand * 0.06, y0 + 1.98, pos.z, 0.08, palette.white);
    }
    this.box(
      (pos.x + hand * 0.3 + px) / 2,
      py - 0.05,
      (pos.z + pz) / 2,
      0.3,
      0.09,
      0.09,
      col,
      0,
      0,
      hand * facing * 0.5,
    );
    // Big, clearly two-sided paddle that follows the phone's orientation in real time.
    this.paddle(
      px,
      py + 0.1,
      pz,
      facing * ((opts.pitch * Math.PI) / 180 + swing * 0.9),
      (-opts.roll * facing * Math.PI) / 180,
      (opts.yaw * Math.PI) / 180,
      1.6,
      paddleColor,
      facing,
      col,
    );
    if (opts.server) {
      this.blob(pos.x, y0 + 2.25, pos.z, 0.1, 0.1, 0.1, palette.ball);
      this.box(pos.x, y0 + 2.05, pos.z, 0.02, 0.2, 0.02, palette.ball);
    }
  }
  /** Outfit accessories on top of the team-coloured body (owner request). */
  outfit(o: Outfit, x: number, y0: number, z: number, facing: number, col: V) {
    const front = z - 0.3 * facing,
      back = z + 0.3 * facing;
    const white = palette.white,
      dark = palette.dark;
    if (o === "cap") {
      this.blob(
        x,
        y0 + 1.6,
        z,
        0.31,
        0.15,
        0.28,
        col.map((v) => v * 0.6),
        0,
        4,
        12,
      );
      this.box(
        x,
        y0 + 1.6,
        front - 0.06 * facing,
        0.34,
        0.03,
        0.24,
        col.map((v) => v * 0.6),
      );
      this.sphere(x, y0 + 1.75, z, 0.04, white);
    } else if (o === "headband") {
      this.blob(x, y0 + 1.5, z, 0.35, 0.05, 0.315, white, 0, 2, 14);
      this.blob(x, y0 + 1.5, z, 0.352, 0.018, 0.317, col, 0, 2, 14);
      for (const s of [-1, 1])
        this.box(
          x + s * 0.06,
          y0 + 1.42,
          back + 0.04 * facing,
          0.06,
          0.18,
          0.03,
          white,
          0.4 * facing,
          s * 0.3,
        );
      // wristband on the paddle side
      this.blob(x, y0 + 0.62, z, 0.36, 0.035, 0.32, white, 0, 2, 14);
    } else if (o === "chef") {
      this.blob(x, y0 + 1.66, z, 0.27, 0.06, 0.25, white, 0, 2, 14);
      this.blob(x, y0 + 1.9, z, 0.24, 0.12, 0.22, white, 0.22, 5, 12);
      for (const [dx, dz] of [
        [0.12, 0],
        [-0.12, 0],
        [0, 0.11],
        [0, -0.11],
      ])
        this.sphere(x + dx, y0 + 2.12, z + dz, 0.13, white);
      // apron over the front
      this.box(x, y0 + 0.82, front - 0.02 * facing, 0.42, 0.56, 0.03, white);
      this.box(x, y0 + 0.96, front - 0.035 * facing, 0.12, 0.08, 0.02, col);
    } else if (o === "astro") {
      this.blob(x, y0 + 1.58, z, 0.37, 0.22, 0.34, white, 0, 5, 14);
      this.blob(x, y0 + 1.4, z, 0.37, 0.04, 0.33, [0.75, 0.77, 0.8], 0, 2, 14);
      // gold visor across the eyes
      this.box(x, y0 + 1.33, z - 0.3 * facing, 0.38, 0.12, 0.05, palette.gold);
      // life-support pack and a little antenna
      this.box(x, y0 + 0.98, back + 0.08 * facing, 0.44, 0.56, 0.18, white);
      this.box(x, y0 + 1.12, back + 0.175 * facing, 0.28, 0.12, 0.02, col);
      this.box(x + 0.16, y0 + 1.4, back + 0.08 * facing, 0.02, 0.3, 0.02, dark);
      this.sphere(
        x + 0.16,
        y0 + 1.56,
        back + 0.08 * facing,
        0.035,
        palette.red,
      );
    } else if (o === "cowboy") {
      const brown = [0.48, 0.3, 0.16];
      this.blob(x, y0 + 1.6, z, 0.55, 0.03, 0.52, brown, 0, 2, 16);
      this.blob(x, y0 + 1.74, z, 0.26, 0.16, 0.24, brown, 0.04, 4, 12);
      this.blob(x, y0 + 1.66, z, 0.265, 0.03, 0.245, dark, 0, 2, 12);
      // bandana at the neck
      this.box(
        x,
        y0 + 1.1,
        front - 0.03 * facing,
        0.24,
        0.14,
        0.04,
        palette.red,
        0,
        Math.PI / 4,
      );
    }
  }
  // ——— camera ———
  /** The paddle as seen from your own eyes: lower right, mirroring the phone's angle. */
  fpPaddle(
    p: Pick<Player, "team" | "hand" | "id"> & Partial<Pick<Player, "gear">>,
    pos: Vec,
    o: { swing: number; pitch: number; roll: number; yaw: number },
  ) {
    const facing = p.team ? -1 : 1,
      hand = (p.hand === "left" ? -1 : 1) * facing,
      col = teamColor(p.team);
    const [px, py, pz] = this.reach(
      p.id,
      pos.x + hand * (0.42 - o.swing * 0.12),
      1.08 + o.swing * 0.25,
      pos.z - (0.8 + o.swing * 0.3) * facing,
    );
    const rx = facing * ((o.pitch * Math.PI) / 180 + o.swing * 0.9),
      rz = (-o.roll * facing * Math.PI) / 180,
      ry = (o.yaw * Math.PI) / 180;
    const face = (PADDLES[p.gear?.paddle ?? 0] ?? PADDLES[0])
      .color as unknown as V;
    this.paddle(px, py + 0.06, pz, rx, rz, ry, 1.0, face, facing, col);
  }
  /**
   * A pickleball paddle: rounded face, bright front (the hitting side, toward the net) with a
   * light stripe, darker back, edge guard and grip, rotated like the phone (same rotation
   * order as box()). `facing` = which way the player faces along z.
   */
  paddle(
    cx: number,
    cy: number,
    cz: number,
    rx: number,
    rz: number,
    ry: number,
    k: number,
    faceCol: V,
    facing: number,
    edgeCol: V = palette.dark,
  ) {
    const cX = Math.cos(rx),
      sX = Math.sin(rx),
      cY = Math.cos(ry),
      sY = Math.sin(ry),
      cZ = Math.cos(rz),
      sZ = Math.sin(rz);
    const rot = (a: number, b: number, c: number, translate = true): V => {
      const by = b * cX - c * sX;
      c = b * sX + c * cX;
      b = by;
      const ax = a * cY + c * sY;
      c = -a * sY + c * cY;
      a = ax;
      const x = a * cZ - b * sZ,
        y = a * sZ + b * cZ;
      return translate ? [cx + x, cy + y, cz + c] : [x, y, c];
    };
    const w = 0.19 * k,
      h = 0.22 * k,
      r = 0.07 * k,
      t = 0.014 * k,
      front = -facing; // the hitting face points toward the net
    // Rounded-rectangle outline (counter-clockwise).
    const ring: [number, number][] = [];
    for (const [ox, oy, a0] of [
      [w - r, h - r, 0],
      [-(w - r), h - r, 90],
      [-(w - r), -(h - r), 180],
      [w - r, -(h - r), 270],
    ])
      for (let i = 0; i <= 5; i++) {
        const a = ((a0 + i * 18) * Math.PI) / 180;
        ring.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r]);
      }
    const prev = this.mat;
    const back = faceCol.map((v) => v * 0.8 + 0.04);
    for (const [side, col] of [
      [front, faceCol],
      [-front, back],
    ] as [number, V][]) {
      this.mat = [side === front ? 0.6 : 0.35, 0, 0, 0];
      const n = rot(0, 0, side, false);
      const c0 = rot(0, 0, side * t);
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i],
          [bx, by] = ring[(i + 1) % ring.length];
        this.vertex(c0, n, col);
        this.vertex(rot(ax, ay, side * t), n, col);
        this.vertex(rot(bx, by, side * t), n, col);
      }
    }
    // Edge guard in the team colour, faintly glowing so the outline always reads.
    this.mat = [0.4, 0.35, 0, 0];
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i],
        [bx, by] = ring[(i + 1) % ring.length];
      const n = rot(ax + bx, ay + by, 0, false);
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      const nn = [n[0] / l, n[1] / l, n[2] / l];
      const e = 1.35;
      const p0 = rot(ax, ay, t * e),
        p1 = rot(bx, by, t * e),
        p2 = rot(bx, by, -t * e),
        p3 = rot(ax, ay, -t * e);
      for (const p of [p0, p1, p2, p0, p2, p3]) this.vertex(p, nn, edgeCol);
    }
    // A light stripe across the hitting face, so its angle reads at a glance.
    this.mat = [0.5, 0.15, 0, 0];
    const sn = rot(0, 0, front, false),
      z = front * (t + 0.002);
    const sw = w * 0.7,
      sy = h * 0.45,
      sh = 0.018 * k;
    const q = [
      rot(-sw, sy - sh, z),
      rot(sw, sy - sh, z),
      rot(sw, sy + sh, z),
      rot(-sw, sy + sh, z),
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) this.vertex(q[i], sn, palette.white);
    // The back shows a white sweet-spot ring, so you can tell which face you're looking at.
    const bn = rot(0, 0, -front, false),
      bz = -front * (t + 0.002);
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2,
        a1 = ((i + 1) / 16) * Math.PI * 2,
        r0 = 0.055 * k,
        r1 = 0.075 * k;
      const p = (a: number, rr: number) =>
        rot(Math.cos(a) * rr, Math.sin(a) * rr + h * 0.1, bz);
      for (const v of [
        p(a0, r0),
        p(a1, r0),
        p(a1, r1),
        p(a0, r0),
        p(a1, r1),
        p(a0, r1),
      ])
        this.vertex(v, bn, palette.white);
    }
    // Grip.
    this.mat = [0.3, 0, 0, 0];
    const gw = 0.03 * k,
      g0 = -h + 0.02 * k,
      g1 = -h - 0.13 * k;
    const corners = [
      [-gw, g0, -gw],
      [gw, g0, -gw],
      [gw, g1, -gw],
      [-gw, g1, -gw],
      [-gw, g0, gw],
      [gw, g0, gw],
      [gw, g1, gw],
      [-gw, g1, gw],
    ].map(([a, b, c]) => rot(a, b, c));
    const center = rot(0, (g0 + g1) / 2, 0);
    for (const f of [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 4, 7, 3],
      [1, 5, 6, 2],
      [3, 2, 6, 7],
      [0, 1, 5, 4],
    ]) {
      this.tri(
        corners[f[0]],
        corners[f[1]],
        corners[f[2]],
        [0.12, 0.12, 0.15],
        1,
        center,
      );
      this.tri(
        corners[f[0]],
        corners[f[2]],
        corners[f[3]],
        [0.12, 0.12, 0.15],
        1,
        center,
      );
    }
    this.mat = prev;
  }
  targetView(m: Match | null, ball: Vec | null): View {
    const t = performance.now() / 1000;
    const f = this.followPos;
    if (m && m.phase !== "lobby" && f && this.viewMode !== "broadcast") {
      const facing = this.followTeam ? -1 : 1;
      // Ball lock (owner request): the camera keeps the ball in the middle of the screen,
      // the same way every time. It only lets go when the ball is behind you or right at
      // your eyes, where looking at it would spin the view around; then it looks down-court.
      const live =
        !!ball &&
        (m.phase === "serve" || m.phase === "rally" || m.phase === "point");
      const third = this.viewMode === "third";
      const eye: V =
        this.viewMode === "first"
          ? [f.x, 1.5, f.z]
          : this.aspect < 1.2
            ? [f.x, 3.8, f.z + 6.3 * facing]
            : [f.x * 0.7, 3.4, f.z + 5.4 * facing];
      const ahead: V = [
        third ? f.x * 0.85 : f.x,
        third ? 0.85 : 1.0,
        f.z - 6 * facing,
      ];
      let w = 0;
      if (live) {
        const b = ball!;
        // How far in front of the camera the ball is, along the court.
        const front = (eye[2] - b.z) * facing;
        const dist = Math.hypot(b.x - eye[0], b.y - eye[1], b.z - eye[2]);
        w = clamp((front - 0.4) / 1.2, 0, 1) * clamp((dist - 0.6) / 1.0, 0, 1);
      }
      const b = ball || { x: 0, y: 1, z: 0 };
      // Keep the view from tipping too far up on lobs or down at the feet.
      const by = clamp(
        b.y,
        0.15,
        eye[1] + Math.max(2, Math.abs(eye[2] - b.z) * 0.9),
      );
      return {
        eye,
        target: [
          lerp(ahead[0], b.x, w),
          lerp(ahead[1], by, w),
          lerp(ahead[2], b.z, w),
        ],
        fov: third ? 56 : 74,
        shift: 0,
      };
    }
    if (!m)
      return {
        eye: [
          -2.4 + Math.sin(t * 0.15) * 0.8,
          1.75 + Math.sin(t * 0.21) * 0.15,
          10.4,
        ],
        target: [0.9, 0.95, -1],
        fov: 44,
        shift: this.panelOpen ? 0.36 : 0,
      };
    if (m.phase === "lobby")
      return {
        eye: [-1.8, 3.1, 12.2],
        target: [0.6, 0.8, 1.2],
        fov: 46,
        shift: this.panelOpen ? 0.34 : 0,
      };
    const bx = ball ? ball.x * 0.25 : 0,
      bz = ball ? ball.z * 0.08 : 0;
    return {
      eye: [bx * 0.6, 8.6, 16.2],
      target: [bx, 0.2, -0.8 + bz],
      fov: 40,
      shift: this.panelOpen ? 0.3 : 0,
    };
  }
  /**
   * Presentation camera moves on top of the normal view: the match intro (close-up on the
   * opponent, then a swoop down to the play camera) and a short move after a won point.
   */
  stage(
    goal: View,
    m: Match | null,
    positions: Map<string, Vec>,
    now: number,
  ): View & { snap?: boolean } {
    if (!m) return goal;
    if (
      m.introUntil > m.time &&
      m.phase === "serve" &&
      this.introSeen !== m.introUntil
    ) {
      this.introSeen = m.introUntil;
      this.introT0 = now;
      this.introDur = (m.introUntil - m.time) * 1000;
    }
    const ip = (now - this.introT0) / Math.max(1, this.introDur);
    if (ip >= 0 && ip < 1 && m.phase === "serve") {
      // Close-up of the other side's first player (or the far team's player).
      const me = m.players.find((p) => p.id === this.follow);
      const opp =
        m.players.find(
          (p) => p.team !== (me?.team ?? 0) && p.id !== "practice-feed",
        ) ?? m.players[0];
      const op = positions.get(opp.id) ?? opp.pos;
      const f = opp.team ? 1 : -1; // direction the opponent faces (toward the net)
      const close: View = {
        eye: [op.x + 0.35, 1.45, op.z + f * 2.1],
        target: [op.x, 1.25, op.z],
        fov: 34,
        shift: 0,
      };
      const k = ip < 0.45 ? 0 : smooth01((ip - 0.45) / 0.55);
      // Swoop: rise up and over on the way back.
      const arc = Math.sin(k * Math.PI) * 2.2;
      return {
        eye: close.eye.map(
          (v, i) => lerp(v, goal.eye[i], k) + (i === 1 ? arc : 0),
        ),
        target: close.target.map((v, i) => lerp(v, goal.target[i], k)),
        fov: lerp(close.fov, goal.fov, k),
        shift: lerp(0, goal.shift, k),
        snap: true,
      };
    }
    const age = (now - this.cheerAt) / 1000;
    if (age >= 0 && age < 1.8 && this.cheerTeam >= 0 && m.phase !== "rally") {
      // Point won: drift toward the winners and rise a little, then settle back.
      const k =
        Math.sin((age / 1.8) * Math.PI) *
        (this.cheerSize === "point" ? 0.6 : 1);
      const z = this.cheerTeam ? -4 : 4;
      return {
        ...goal,
        eye: [
          goal.eye[0],
          goal.eye[1] + k * 0.6,
          goal.eye[2] + (z - goal.eye[2]) * 0.08 * k,
        ],
        target: goal.target.map((v, i) =>
          lerp(v, i === 2 ? z : i === 1 ? 1 : 0, 0.25 * k),
        ),
        fov: goal.fov - 3 * k,
      };
    }
    return goal;
  }
  // ——— attract-mode demo rally (cosmetic only, never presented as a match) ———
  demo(now: number) {
    const period = 1.25,
      t = now / 1000 / period,
      n = Math.floor(t),
      f = t - n;
    const xs = [0.4, -1.4, 1.2, -0.6, 1.8, -1.6, 0.2, 1.0];
    const from = n % 2 ? -1 : 1,
      x0 = xs[n % xs.length],
      x1 = xs[(n + 1) % xs.length];
    const z0 = from * 5.3,
      z1 = -from * 5.3;
    const ball = {
      x: lerp(x0, x1, f),
      y: 0.95 + Math.sin(f * Math.PI) * 1.7 - f * 0.1,
      z: lerp(z0, z1, f),
    };
    const near = { x: n % 2 ? x1 : x0, z: 5.6 };
    const far = { x: n % 2 ? x0 : x1, z: -5.6 };
    const nearSwing = Math.max(0, 1 - Math.abs(n % 2 ? f - 1 : f) / 0.18);
    const farSwing = Math.max(0, 1 - Math.abs(n % 2 ? f : f - 1) / 0.18);
    const nearX = lerp(this.demoNear, near.x - 0.5, 0.06);
    const farX = lerp(this.demoFar, far.x + 0.5, 0.06);
    this.demoNear = nearX;
    this.demoFar = farX;
    this.mascot(
      {
        team: 0,
        hand: "right",
        bot: false,
        id: "d0",
        // show off the outfits on the menu court
        outfit: OUTFITS[Math.floor(n / 3) % OUTFITS.length].id,
      },
      { x: nearX, y: 0, z: near.z },
      {
        swing: nearSwing,
        pitch: -8,
        roll: 0,
        yaw: 0,
        moving: 1,
        server: false,
        owner: false,
      },
    );
    this.mascot(
      { team: 1, hand: "right", bot: true, id: "d1", outfit: "astro" },
      { x: farX, y: 0, z: far.z },
      {
        swing: farSwing,
        pitch: -8,
        roll: 0,
        yaw: 0,
        moving: 1,
        server: false,
        owner: false,
      },
    );
    if (n !== this.demoHit) {
      this.demoHit = n;
      // Show off the shot effects on the menu court (cosmetic demo only).
      const show = ["drive", "smash", "slice", "drive", "dink", "drive"][n % 6];
      this.fx.contact({ x: x0, y: 0.95, z: z0 }, now, {
        team: teamColor(from > 0 ? 0 : 1),
        stroke: show,
        kmh: show === "drive" ? 62 : show === "dink" ? 24 : 45,
        timing: null,
        local: false,
      });
    }
    return ball;
  }
  /** Additive glow effects for one view (built after its camera is known). */
  effects(now: number, ball: Vec | null, _pass: number, _split: boolean) {
    const eye = this.view.eye,
      f = norm(sub(this.view.target, eye)),
      right = norm(cross(f, [0, 1, 0])),
      up = cross(right, f);
    const keep = this.vertices;
    this.vertices = this.fxv;
    this.fx.build(
      (p, n, c, strength, soft) => {
        this.mat = [0, strength, soft, 0];
        this.vertex(p, n, c);
      },
      ball,
      eye,
      right,
      up,
      now,
    );
    this.vertices = keep;
    this.material(0.15);
  }
  /** Full-screen effects for this frame. */
  postFx(now: number): Post {
    const p = this.fx.post(now);
    return {
      ...p,
      vignette:
        (this.map === "arena" || this.map === "nyc" || this.map === "tokyo"
          ? 0.55
          : 0.3) +
        p.speedLines * 0.25,
      focus: [0.5, 0.45],
    };
  }
  calloutEls: HTMLDivElement[] = [];
  calloutKey: string[] = [];
  /** Timing callout + EARLY ↔ LATE meter at the bottom of this view (the hitter's half). */
  placeCallout(
    pass: number,
    split: boolean,
    ox: number,
    cw: number,
    now: number,
  ) {
    let el = this.calloutEls[pass];
    if (!el) {
      el = document.createElement("div");
      el.className = "tcall";
      this.tagLayer.appendChild(el);
      this.calloutEls[pass] = el;
    }
    const c = this.callout;
    const age = c ? now - c.at : 1e9;
    const show = !!c && age < 1700 && (!split || this.follows[pass] === c.by);
    if (!show) {
      if (el.style.display !== "none") el.style.display = "none";
      return;
    }
    const key = c!.t.at + ":" + c!.by;
    if (this.calloutKey[pass] !== key) {
      this.calloutKey[pass] = key;
      el.className = "tcall kind-" + c!.t.kind;
      el.innerHTML = calloutHtml(c!.t);
      placeMeter(el, c!.t);
      // restart the entrance animation
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
    }
    el.style.display = "";
    el.style.left = (ox + cw / 2).toFixed(0) + "px";
    el.classList.toggle("leaving", age > 1350);
  }
  rallyEl: HTMLDivElement | null = null;
  rallyShown = -1;
  /** "RALLY 7" in the top-right corner while a rally is going. */
  placeRally() {
    if (!this.rallyEl) {
      this.rallyEl = document.createElement("div");
      this.rallyEl.className = "rallycount";
      this.tagLayer.appendChild(this.rallyEl);
    }
    const n = this.state && this.state.phase !== "lobby" ? this.rallyCount : 0;
    if (n === this.rallyShown) return;
    this.rallyShown = n;
    this.rallyEl.style.display = n >= 2 ? "" : "none";
    this.rallyEl.innerHTML = `<small>RALLY</small><b>${n}</b>`;
    this.rallyEl.classList.toggle("hot", n >= 8);
    this.rallyEl.animate?.(
      [{ transform: "scale(1.25)" }, { transform: "scale(1)" }],
      { duration: 220, easing: "cubic-bezier(.2,1.6,.4,1)" },
    );
  }
  cpuMs = 0;
  /** Face-photo decals for the view being built. */
  decals: Decal[] = [];
  /** Players on this screen who use a face photo (kept in this browser only). */
  faces = new Set<string>();
  setFace(playerId: string, img: TexImageSource | null) {
    this.gl.setTexture("face:" + playerId, img);
    if (img) this.faces.add(playerId);
    else this.faces.delete(playerId);
  }
  /** Point celebration: winning team cheers, the camera moves a little (ms timestamps). */
  cheerTeam = -1;
  cheerAt = -1e9;
  cheerSize: "point" | "game" | "match" = "point";
  /** Match intro (local clock): close-up on the opponent, then swoop to the play camera. */
  introT0 = -1e9;
  introDur = 0;
  introSeen = -1;
  /** A point was won (or a side out): confetti, cheering, crowd roar, short camera move. */
  celebrate(team: number, size: "point" | "game" | "match", sideOut: boolean) {
    const now = performance.now();
    if (sideOut) {
      this.roar(0.25);
      return;
    }
    this.cheerTeam = team;
    this.cheerAt = now;
    this.cheerSize = size;
    const big = size === "match" ? 2 : size === "game" ? 1.5 : 1;
    // Burst over each winning player.
    const winners =
      this.state?.players.filter(
        (p) => p.team === team && p.id !== "practice-feed",
      ) ?? [];
    for (const p of winners.length
      ? winners
      : [{ pos: { x: 0, y: 0, z: team ? -4 : 4 } }]) {
      const at = this.shown.get("p:" + (p as Player).id) ?? p.pos;
      this.fx.confetti(at, teamColor(team), now, big);
      if (size !== "point")
        this.fx.confetti(at, teamColor(team), now + 400, big * 0.8);
    }
    this.roar(size === "match" ? 1 : size === "game" ? 0.8 : 0.55);
  }
  roarNoise: AudioBuffer | null = null;
  /** Sound-effects volume 0..1 (Settings). */
  sfxVolume = 0.8;
  sfxGain: GainNode | null = null;
  sfxOut() {
    const a = this.audio!;
    if (!this.sfxGain) {
      this.sfxGain = a.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(a.destination);
    }
    return this.sfxGain;
  }
  setSfxVolume(v: number) {
    this.sfxVolume = Math.min(1, Math.max(0, v));
    if (this.sfxGain && this.audio)
      this.sfxGain.gain.setTargetAtTime(
        this.sfxVolume,
        this.audio.currentTime,
        0.05,
      );
  }
  /** Crowd roar: a swell of band-passed noise with a little shimmer. */
  roar(level: number) {
    if (this.muted || !this.audio) return;
    const a = this.audio;
    if (!this.roarNoise) {
      const len = Math.floor(a.sampleRate * 2.5);
      this.roarNoise = a.createBuffer(2, len, a.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = this.roarNoise.getChannelData(ch);
        let b = 0;
        for (let i = 0; i < len; i++) {
          // Pinkish noise with slow "voices" rising and falling.
          b = b * 0.97 + (Math.random() * 2 - 1) * 0.3;
          d[i] =
            b * (0.7 + 0.3 * Math.sin(i / (a.sampleRate * (0.11 + ch * 0.03))));
        }
      }
    }
    const t = a.currentTime,
      src = a.createBufferSource(),
      f = a.createBiquadFilter(),
      g = a.createGain();
    src.buffer = this.roarNoise;
    f.type = "bandpass";
    f.frequency.value = 900;
    f.Q.value = 0.6;
    const peak = 0.22 * level,
      dur = 1.2 + level * 1.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxOut());
    src.start(t);
    src.stop(t + dur + 0.05);
  }
  frozen: { positions: Map<string, Vec>; ball: Vec | null } | null = null;
  demoNear = 0;
  demoFar = 0;
  demoHit = -1;
  /** Project each tag's 3D head point to the screen and move its label there. */
  placeTags(vp: V, ox: number, cw: number, pass: number, seen: Set<string>) {
    const ch = this.canvas.clientHeight;
    for (const t of this.tags) {
      // Column-major view-projection × (x, y, z, 1).
      const cx = vp[0] * t.x + vp[4] * t.y + vp[8] * t.z + vp[12],
        cy = vp[1] * t.x + vp[5] * t.y + vp[9] * t.z + vp[13],
        cw4 = vp[3] * t.x + vp[7] * t.y + vp[11] * t.z + vp[15];
      if (cw4 <= 0.1) continue; // behind the camera
      const sx = ox + ((cx / cw4 + 1) / 2) * cw,
        sy = ((1 - cy / cw4) / 2) * ch;
      if (sx < ox - 60 || sx > ox + cw + 60 || sy < -50 || sy > ch + 50)
        continue;
      const key = t.id + "@" + pass;
      let el = this.tagEls.get(key);
      if (!el) {
        el = document.createElement("div");
        this.tagLayer.appendChild(el);
        this.tagEls.set(key, el);
      }
      if (el.textContent !== t.name) el.textContent = t.name;
      const cls = "nametag team" + t.team;
      if (el.className !== cls) el.className = cls;
      // Shrink with distance a little so far players' tags don't crowd the court.
      const scale = Math.max(0.65, Math.min(1.15, 9 / cw4));
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(2)})`;
      el.style.display = "";
      seen.add(key);
    }
  }
  render = () => {
    this.raf = requestAnimationFrame(this.render);
    const canvas = this.canvas,
      dpr = this.gl.scale;
    const w = Math.round(canvas.clientWidth * dpr),
      h = Math.round(canvas.clientHeight * dpr);
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
    }
    const now = performance.now();
    // Draw the present, not the past: extrapolate from the latest snapshot using the
    // velocities it carries (capped), then ease out any correction when the next snapshot
    // lands. Rendering ~65–220 ms in the past made first person feel laggy.
    const hist = this.history;
    const latest = hist[hist.length - 1];
    const m = latest?.state || this.state;
    const frameDt = Math.min(0.1, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;
    const ahead = latest ? Math.min(0.15, (now - latest.at) / 1000) : 0;
    const fresh = latest && latest.at !== this.lastSnapAt;
    if (fresh) this.lastSnapAt = latest.at;
    const decay = Math.exp(-frameDt * 14);
    const smooth = (key: string, predicted: Vec): Vec => {
      let o = this.offsets.get(key);
      const shown = this.shown.get(key);
      if (fresh && shown) {
        // Correction = where we were drawing it minus where the new data says it is.
        o = {
          x: shown.x - predicted.x,
          y: shown.y - predicted.y,
          z: shown.z - predicted.z,
        };
        if (Math.hypot(o.x, o.y, o.z) > 1) o = { x: 0, y: 0, z: 0 }; // teleport (serve, feed)
      }
      o = o
        ? { x: o.x * decay, y: o.y * decay, z: o.z * decay }
        : { x: 0, y: 0, z: 0 };
      this.offsets.set(key, o);
      const out = {
        x: predicted.x + o.x,
        y: predicted.y + o.y,
        z: predicted.z + o.z,
      };
      this.shown.set(key, out);
      return out;
    };
    // ——— once per frame: positions, ball, trail, effects bookkeeping ———
    let positions = new Map<string, Vec>();
    let ball: Vec | null = null;
    // Hit-stop on a PERFECT hit: hold everything still for a few frames.
    const frozen = now < this.fx.freezeUntil && this.frozen;
    if (frozen) {
      positions = this.frozen!.positions;
      ball = this.frozen!.ball;
    } else if (m) {
      for (const p of m.players)
        positions.set(
          p.id,
          smooth("p:" + p.id, {
            x: p.pos.x + p.velocity.x * Math.min(ahead, 0.1),
            y: 0,
            z: p.pos.z + p.velocity.z * Math.min(ahead, 0.1),
          }),
        );
      // Ball: ballistic extrapolation during a rally (post-bounce at the slow-bounce speed).
      const bt =
        m.phase === "rally"
          ? Math.min(ahead, 0.08) * (m.bounces > 0 ? 0.8 : 1)
          : m.phase === "point"
            ? Math.min(ahead, 0.08)
            : 0;
      ball = smooth("ball", {
        x: m.ball.x + m.velocity.x * bt,
        y: Math.max(
          COURT.radius,
          m.ball.y + m.velocity.y * bt - 0.5 * (9.81 + m.spin) * bt * bt,
        ),
        z: m.ball.z + m.velocity.z * bt,
      });
    }
    if (!frozen) this.frozen = m ? { positions, ball } : null;

    // Split screen: two players on this screen, a player camera, and a match in progress.
    const split =
      !!m &&
      m.phase !== "lobby" &&
      this.viewMode !== "broadcast" &&
      this.follows.length >= 2;
    document.body.classList.toggle("split", split);
    const light = lightingFor(this.map);
    const drawViews: ViewDraw[] = [];
    const seenTags = new Set<string>();
    const passes = split ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      // Each pass: geometry for this viewer (their own body hidden in first person) and
      // this viewer's camera, drawn into their half of the screen.
      this.follow = this.follows[pass] ?? null;
      this.vertices = [];
      this.fxv = [];
      this.decals = [];
      this.followPos = null;
      this.tags = [];
      if (m) {
        const owner = m.players
          .filter((p) => p.team !== m.lastTeam)
          .sort(
            (p, q) =>
              Math.hypot(p.pos.x - m.ball.x, p.pos.z - m.ball.z) -
              Math.hypot(q.pos.x - m.ball.x, q.pos.z - m.ball.z),
          )[0];
        const doublesTeam = (team: number) =>
          m.players.filter((p) => p.team === team).length > 1;
        for (const p of m.players) {
          if (p.id === "practice-feed") continue;
          const pos = positions.get(p.id)!;
          if (p.id === this.follow) {
            this.followPos = pos;
            this.followTeam = p.team;
          }
          // Name tag for human players (not your own in first person: it'd sit in your eyes).
          const ownFirst =
            this.viewMode === "first" &&
            p.id === this.follow &&
            m.phase !== "lobby";
          if (!p.bot && !ownFirst)
            this.tags.push({
              id: p.id,
              name: p.name,
              team: p.team,
              x: pos.x,
              y: 1.85 + (m.serverId === p.id && m.phase === "serve" ? 0.55 : 0),
              z: pos.z,
            });
          const cheerAge = (now - this.cheerAt) / 1000;
          const cheer =
            p.team === this.cheerTeam &&
            cheerAge < (this.cheerSize === "point" ? 1.9 : 3.2)
              ? Math.min(1, cheerAge / 0.15) *
                Math.min(
                  1,
                  ((this.cheerSize === "point" ? 1.9 : 3.2) - cheerAge) / 0.3,
                )
              : 0;
          this.mascot(p, pos, {
            cheer,
            firstPerson: ownFirst,
            swing: Math.max(0, 1 - (m.time - p.lastHit) / 0.28),
            pitch: p.input.pitch,
            roll: p.input.roll,
            yaw: p.input.yaw,
            moving: Math.hypot(p.velocity.x, p.velocity.z),
            server: m.serverId === p.id && m.phase === "serve",
            owner:
              m.phase === "rally" && doublesTeam(p.team) && owner?.id === p.id,
          });
        }
        // Enlarged orientation mirror: the lobby, or practice in the broadcast view.
        if (
          m.phase === "lobby" ||
          (m.mode === "practice" && this.viewMode === "broadcast")
        ) {
          const p = m.players.find((p) => !p.bot);
          if (p) {
            const rx = (p.input.pitch * Math.PI) / 180,
              rz = (-p.input.roll * Math.PI) / 180;
            this.box(-4.1, 1.15, 6.4, 0.12, 0.85, 0.12, palette.dark);
            this.box(-4.1, 2.05, 6.4, 0.9, 1.15, 0.08, palette.dark, rx, rz);
            this.box(
              -4.1,
              2.05,
              6.4,
              0.82,
              1.06,
              0.1,
              teamColor(p.team),
              rx,
              rz,
            );
            this.ring(-4.1, 6.4, 0.7, palette.orange, 0.03, 0.05);
          }
        }
      } else {
        ball = this.demo(now);
      }
      if (ball) {
        if (pass === 0) {
          this.rollBall(ball);
          this.fx.track(ball, now);
        }
        if (!this.gl.shadows)
          this.blob(
            ball.x,
            0.03,
            ball.z,
            0.12,
            0.004,
            0.12,
            [0.03, 0.03, 0.05],
            0,
            2,
            10,
          );
        this.pickleball(ball.x, ball.y, ball.z, 0.11);
      }
      // Pop-up target: pulsing rings where the ball drops through smash height.
      if (m && m.popup && m.bounces === 0 && m.popupAt && m.phase === "rally") {
        const k = (Math.sin(now / 90) + 1) / 2,
          col = teamColor(1 - m.lastTeam);
        this.ring(m.popupAt.x, m.popupAt.z, 0.45 + k * 0.15, col, 0.04, 0.07);
        this.ring(
          m.popupAt.x,
          m.popupAt.z,
          0.2,
          palette.white,
          0.045,
          0.05,
          12,
        );
      }
      // Ball mark (owner request): a dark smudge where an out ball touched down, with a red
      // ring, so everyone can judge the call. Shown until the next serve.
      if (m && m.mark && (m.phase === "point" || m.phase === "serve")) {
        const k = (Math.sin(now / 160) + 1) / 2;
        this.blob(
          m.mark.x,
          0.028,
          m.mark.z,
          0.075,
          0.003,
          0.11,
          [0.06, 0.05, 0.05],
          0,
          2,
          12,
        );
        this.blob(
          m.mark.x,
          0.026,
          m.mark.z,
          0.13,
          0.002,
          0.17,
          [0.2, 0.17, 0.15],
          0,
          2,
          12,
        );
        this.ring(
          m.mark.x,
          m.mark.z,
          0.32 + k * 0.08,
          m.mark.out ? palette.red : palette.white,
          0.035,
          0.04,
          16,
        );
      }
      // Tokyo: cherry petals drifting down over the court.
      if (this.map === "tokyo")
        for (let i = 0; i < 70; i++) {
          const fall = 9,
            speed = 0.55 + (i % 7) * 0.06,
            t = (now / 1000) * speed + i * 1.37;
          const y = fall - (t % fall),
            base = (i * 7.31) % 1;
          const x = -11 + ((i * 3.97) % 22) + Math.sin(t * 1.3 + i) * 0.6,
            z =
              -16 +
              ((i * 5.17) % 32) +
              Math.cos(t * 0.9 + i) * 0.6 +
              (fall - y) * 0.35;
          this.box(
            x,
            y,
            z,
            0.09,
            0.012,
            0.06,
            base < 0.5 ? [1, 0.78, 0.86] : [0.98, 0.66, 0.8],
            t * 2.1,
            t * 1.7,
            t,
          );
        }
      // Iceland: water streaks pouring down the falls and spray rising from the pool.
      if (this.map === "iceland") {
        const s = now / 1000;
        for (let i = 0; i < 80; i++) {
          const fall = 44,
            t = s * (0.55 + (i % 5) * 0.04) + i * 0.613;
          const k = t % 1,
            y = fall * (1 - k * k);
          const x = -5.6 + ((i * 4.37) % 11.2);
          this.box(
            x,
            y,
            -73.3 + (i % 3) * 0.25,
            0.35,
            3.5,
            0.08,
            i % 4 ? [0.92, 0.96, 1] : [0.78, 0.88, 0.95],
          );
        }
        for (let i = 0; i < 30; i++) {
          const t = s * 0.35 + i * 0.41,
            k = t % 1;
          this.box(
            -7 + ((i * 3.13) % 14),
            0.3 + k * 5,
            -71 + ((i * 1.7) % 5),
            0.35 + k * 0.8,
            0.35 + k * 0.8,
            0.35 + k * 0.8,
            [0.86, 0.9, 0.94],
            t,
            t * 0.7,
          );
        }
      }
      // Camera for this viewer, eased toward the view for the current phase.
      // Each half keeps its own camera; a new one starts from the current view.
      this.view = this.views[pass] || { ...this.view };
      this.aspect = (split ? Math.floor(w / 2) - 1 : w) / Math.max(1, h);
      const goal = this.stage(this.targetView(m, ball), m, positions, now);
      // Player cameras track tightly (a lagging first-person view feels sickly).
      const playerView =
        m &&
        m.phase !== "lobby" &&
        this.followPos &&
        this.viewMode !== "broadcast";
      const e = (goal as { snap?: boolean }).snap
        ? 1
        : playerView
          ? this.viewMode === "first"
            ? 1
            : 0.3
          : 0.06;
      this.view = {
        eye: this.view.eye.map((v, i) => lerp(v, goal.eye[i], e)),
        // Look direction eases a little even in first person, so it never jerks.
        // The look point follows the ball closely (so it stays centred) but is still
        // smoothed, so server corrections and bounces never jerk the view.
        target: this.view.target.map((v, i) =>
          lerp(v, goal.target[i], playerView ? 0.4 : e),
        ),
        fov: lerp(this.view.fov, goal.fov, e),
        shift: lerp(this.view.shift, goal.shift, e),
      };
      this.views[pass] = this.view;
      // This viewer's rectangle (a 2-px gap between the halves).
      const vx = split ? pass * Math.ceil(w / 2) + (pass ? 1 : 0) : 0,
        vw = split ? Math.floor(w / 2) - 1 : w;
      // Camera punch on your own hits (stronger on PERFECT).
      const sh = this.fx.shake(now);
      const vp = camera(
        vw / Math.max(1, h),
        [this.view.eye[0] + sh.x, this.view.eye[1] + sh.y, this.view.eye[2]],
        [
          this.view.target[0] + sh.x * 0.5,
          this.view.target[1] + sh.y * 0.5,
          this.view.target[2],
        ],
        this.view.fov + sh.fov,
        this.view.shift,
      );
      this.placeTags(
        vp,
        (vx / w) * canvas.clientWidth,
        (vw / w) * canvas.clientWidth,
        pass,
        seenTags,
      );
      this.effects(now, ball, pass, split);
      this.placeCallout(
        pass,
        split,
        (vx / w) * canvas.clientWidth,
        (vw / w) * canvas.clientWidth,
        now,
      );
      drawViews.push({
        rect: [vx, 0, vw, h],
        vp,
        eye: this.view.eye,
        dynamic: new Float32Array(this.vertices),
        fx: new Float32Array(this.fxv),
        decals: this.decals,
      });
    }
    this.gl.frame(w, h, light, drawViews, this.postFx(now), now / 1000);
    // CPU time spent building and submitting this frame (smoothed), for diagnostics.
    this.cpuMs = this.cpuMs * 0.95 + (performance.now() - now) * 0.05;
    for (const [key, el] of this.tagEls)
      if (!seenTags.has(key)) el.style.display = "none";
    this.placeRally();
  };
}
