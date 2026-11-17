import type { Match, Player, Vec } from "../shared/types.ts";
import { COURT } from "../shared/types.ts";
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
  const f = 1 / Math.tan((fov * Math.PI) / 360),
    near = 0.1,
    far = 140;
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
  court: [0.27, 0.45, 0.86],
  kitchen: [0.36, 0.55, 0.93],
  line: [0.96, 0.97, 1],
  board: [0.06, 0.06, 0.11],
  ink: [0.86, 0.87, 0.93],
  blue: [0.33, 0.66, 0.98],
  red: [0.86, 0.17, 0.27],
  orange: [1, 0.55, 0.18],
  gold: [0.93, 0.74, 0.32],
  white: [0.97, 0.96, 0.93],
  dark: [0.05, 0.05, 0.08],
  ball: [0.92, 0.96, 0.22],
  fog: [0.035, 0.035, 0.07],
};
export const teamColor = (team: number) => (team ? palette.red : palette.blue);
/** 5×7 pixel letters for the arena boards (original lettering, drawn with boxes). */
const GLYPHS: Record<string, string[]> = {
  V: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
  I: ["111", "010", "010", "010", "010", "010", "111"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  ">": ["0000", "1100", "0110", "0011", "0110", "1100", "0000"],
};
type View = { eye: V; target: V; fov: number; shift: number };
export type ViewMode = "third" | "first" | "broadcast";
export const VIEW_LABELS: Record<ViewMode, string> = {
  third: "Third person",
  first: "First person",
  broadcast: "Broadcast",
};
const VERTEX = `attribute vec3 position; attribute vec3 color; uniform mat4 camera;
varying vec3 vColor; varying vec3 vWorld; varying float vDepth;
void main(){vColor=color;vWorld=position;gl_Position=camera*vec4(position,1.0);vDepth=gl_Position.w;}`;
const FRAGMENT = `precision mediump float;
varying vec3 vColor; varying vec3 vWorld; varying float vDepth;
uniform vec3 fogColor; uniform vec4 spots[3];
void main(){
  float light = 0.78;
  for (int i = 0; i < 3; i++) {
    vec2 d = vWorld.xz - spots[i].xy;
    light += spots[i].z * exp(-dot(d, d) / (spots[i].w * spots[i].w)) * (vWorld.y < 1.6 ? 1.0 : 0.45);
  }
  vec3 c = vColor * light;
  float fog = smoothstep(16.0, 46.0, vDepth);
  gl_FragColor = vec4(mix(c, fogColor, fog * 0.88), 1.0);
}`;
export class Scene {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  staticBuffer: WebGLBuffer;
  staticCount = 0;
  buffer: WebGLBuffer;
  vertices: number[] = [];
  state: Match | null = null;
  history: { state: Match; at: number }[] = [];
  raf = 0;
  lastEvent = -1;
  lastContacts = -1;
  bursts: { x: number; y: number; z: number; at: number; col: V }[] = [];
  trail: Vec[] = [];
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
  follow: string | null = null;
  followPos: Vec | null = null;
  followTeam = 0;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!gl)
      throw Error(
        "WebGL is unavailable. Enable hardware acceleration or try another browser.",
      );
    this.gl = gl;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw Error(gl.getShaderInfoLog(s) || "Shader error");
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw Error("Unable to initialize renderer");
    this.program = program;
    this.buffer = gl.createBuffer()!;
    this.staticBuffer = gl.createBuffer()!;
    this.arena();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(this.vertices),
      gl.STATIC_DRAW,
    );
    this.staticCount = this.vertices.length / 6;
    this.vertices = [];
    this.render();
  }
  sound() {
    this.muted = !this.muted;
    if (!this.audio) this.audio = new AudioContext();
    this.audio.resume();
    return !this.muted;
  }
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
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur + 0.01);
  }
  update(state: Match) {
    const prev = this.state;
    this.state = state;
    this.history.push({ state, at: performance.now() });
    if (this.history.length > 8) this.history.shift();
    if (prev && state.contacts > this.lastContacts && this.lastContacts >= 0) {
      const p = state.players.find((q) => q.id === state.lastPlayer);
      this.burst(
        state.ball,
        p ? teamColor(p.team) : palette.ball,
        state.quality,
      );
    }
    this.lastContacts = state.contacts;
    if (state.event !== this.lastEvent) {
      this.lastEvent = state.event;
      const msg = state.message;
      if (/drive|dink|roll|lob|smash/i.test(msg))
        this.tone(
          /smash/i.test(msg) ? 760 : /dink/i.test(msg) ? 420 : 560,
          170,
          0.1,
        );
      else if (/fault|Out|Net|wins|Double bounce|hit /i.test(msg))
        this.tone(330, 220, 0.25, 0.05, "triangle");
    }
  }
  burst(at: Vec, col: V, quality = 1) {
    this.bursts.push({ x: at.x, y: at.y, z: at.z, at: performance.now(), col });
    if (quality > 0.85)
      this.bursts.push({
        x: at.x,
        y: at.y,
        z: at.z,
        at: performance.now() + 60,
        col: palette.white,
      });
    if (this.bursts.length > 6) this.bursts.shift();
  }
  // ——— geometry primitives ———
  tri(a: V, b: V, c: V, color: V, light = 1) {
    for (const p of [a, b, c])
      this.vertices.push(...p, ...color.map((v) => v * light));
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
    for (const [f, l] of [
      [[0, 1, 2, 3], 0.74],
      [[4, 5, 6, 7], 0.92],
      [[0, 4, 7, 3], 0.8],
      [[1, 5, 6, 2], 0.86],
      [[3, 2, 6, 7], 1],
      [[0, 1, 5, 4], 0.6],
    ] as [number[], number][]) {
      this.tri(pts[f[0]], pts[f[1]], pts[f[2]], color, l);
      this.tri(pts[f[0]], pts[f[2]], pts[f[3]], color, l);
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
    const shade = (i: number) => 0.62 + 0.38 * (1 - i / rings);
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < segs; j++) {
        const l = shade(i);
        this.tri(p(i, j), p(i + 1, j), p(i + 1, j + 1), color, l);
        this.tri(p(i, j), p(i + 1, j + 1), p(i, j + 1), color, l);
        if (stretch && i === rings / 2 - 1) {
          // cylinder band between the hemispheres
          const a = p(i + 1, j),
            b = p(i + 1, j + 1);
          const c = [b[0], b[1] - stretch, b[2]],
            d = [a[0], a[1] - stretch, a[2]];
          this.tri(a, d, c, color, 0.8);
          this.tri(a, c, b, color, 0.8);
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
    const P = palette;
    this.box(0, -0.06, 0, 90, 0.1, 90, P.floor);
    this.box(0, -0.02, 0, 11, 0.04, 21, P.apron);
    this.box(0, -0.005, 0, 6.096, 0.03, 13.4112, P.court);
    this.box(0, 0.012, 0, 6.096, 0.012, 4.2672, P.kitchen);
    for (const z of [-6.6802, -2.1082, 2.1082, 6.6802])
      this.box(0, 0.022, z, 6.096, 0.012, 0.0508, P.line);
    for (const x of [-3.0226, 3.0226])
      this.box(x, 0.022, 0, 0.0508, 0.012, 13.4112, P.line);
    for (const z of [-4.4196, 4.4196])
      this.box(0, 0.022, z, 0.0508, 0.012, 4.572, P.line);
    // floor branding beside the court (subtle)
    this.text("VISUAL", -9.6, 0.004, 3.6, 0.32, 0, -1, [0.27, 0.08, 0.14]);
    // net
    for (const x of [-COURT.post, COURT.post]) {
      this.box(x, 0.5, 0, 0.09, 1.0, 0.09, P.dark);
      this.box(x, 1.0, 0, 0.13, 0.05, 0.13, P.orange);
    }
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
    for (let x = -3.3; x < 3.3; x += 0.33) {
      const h = COURT.netCenter + (Math.abs(x) / 3.048) * 0.0508;
      this.box(x, h, 0, 0.34, 0.05, 0.03, P.white);
    }
    // ad boards with original lettering on three sides
    const boardH = 0.95;
    const bx = 6.2,
      bz = 11.2;
    this.box(-bx, boardH / 2, -0.3, 0.12, boardH, 22.4, P.board);
    this.box(bx, boardH / 2, -0.3, 0.12, boardH, 22.4, P.board);
    this.box(0, boardH / 2, -bz, 12.5, boardH, 0.12, P.board);
    const slogan = "VISUAL >>|! ";
    const sw = this.text(slogan, 0, 0, 0, 0.09, 1, 0, P.ink, false) + 0.4;
    for (let z = 9.6; z - sw > -bz + 0.4; z -= sw) {
      this.text(slogan, -bx + 0.08, 0.14, z, 0.09, 0, -1, P.ink);
      this.text(slogan, bx - 0.08, 0.14, z - sw + 0.4, 0.09, 0, 1, P.ink);
    }
    const count = Math.floor((bx * 2 - 0.6) / sw);
    for (let i = 0, x0 = -(count * sw) / 2 + 0.2; i < count; i++)
      this.text(slogan, x0 + i * sw, 0.14, -bz + 0.08, 0.09, 1, 0, P.ink);
    // tiered crowd stands, deterministic pseudo-random fans
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
    // light gantries
    for (const x of [-5, 0, 5])
      this.box(x, 10, -2, 0.3, 0.3, 26, [0.1, 0.1, 0.14]);
  }
  // ——— characters ———
  mascot(
    p: Pick<Player, "team" | "hand" | "bot" | "id">,
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
    },
  ) {
    if (opts.firstPerson) return this.fpPaddle(p, pos, opts);
    const col = teamColor(p.team),
      facing = p.team ? -1 : 1,
      hand = (p.hand === "left" ? -1 : 1) * facing,
      bob =
        Math.sin(performance.now() / 85) * Math.min(0.05, opts.moving * 0.015);
    const y0 = bob;
    // player indicator ring and shadow
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
    this.ring(
      pos.x,
      pos.z,
      0.55,
      opts.owner ? palette.white : col,
      0.035,
      0.05,
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
    // face plate + shades
    const fz = pos.z - 0.21 * facing;
    this.blob(pos.x, y0 + 1.28, fz, 0.22, 0.25, 0.12, palette.white);
    this.box(
      pos.x,
      y0 + 1.33,
      fz - 0.1 * facing,
      0.34,
      0.075,
      0.05,
      palette.dark,
    );
    this.box(
      pos.x,
      y0 + 1.19,
      fz - 0.11 * facing,
      0.11,
      0.02,
      0.03,
      palette.dark,
    );
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
        palette.dark,
        0,
        4,
        8,
      );
    // paddle arm + paddle (orientation mirrors the phone)
    const swing = opts.swing;
    const px = pos.x + hand * (0.52 + swing * 0.1),
      py = y0 + 0.92 + swing * 0.22,
      pz = pos.z - (0.28 + swing * 0.25) * facing;
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
    this.box(px, py - 0.2, pz, 0.06, 0.24, 0.06, palette.dark);
    this.blob(
      px,
      py + 0.1,
      pz,
      0.2,
      0.24,
      0.035,
      col.map((v) => v * 0.7),
      0,
      6,
      10,
    );
    this.box(
      px,
      py + 0.1,
      pz,
      0.36,
      0.44,
      0.04,
      palette.dark,
      facing * ((opts.pitch * Math.PI) / 180 + swing * 0.9),
      (-opts.roll * facing * Math.PI) / 180,
      (opts.yaw * Math.PI) / 180,
    );
    this.box(
      px,
      py + 0.1,
      pz,
      0.32,
      0.4,
      0.05,
      col,
      facing * ((opts.pitch * Math.PI) / 180 + swing * 0.9),
      (-opts.roll * facing * Math.PI) / 180,
      (opts.yaw * Math.PI) / 180,
    );
    if (opts.server) {
      this.blob(pos.x, y0 + 2.25, pos.z, 0.1, 0.1, 0.1, palette.ball);
      this.box(pos.x, y0 + 2.05, pos.z, 0.02, 0.2, 0.02, palette.ball);
    }
  }
  // ——— camera ———
  /** The paddle as seen from your own eyes: lower right, mirroring the phone's angle. */
  fpPaddle(
    p: Pick<Player, "team" | "hand">,
    pos: Vec,
    o: { swing: number; pitch: number; roll: number; yaw: number },
  ) {
    const facing = p.team ? -1 : 1,
      hand = (p.hand === "left" ? -1 : 1) * facing,
      col = teamColor(p.team);
    const px = pos.x + hand * (0.44 - o.swing * 0.12),
      py = 0.98 + o.swing * 0.25,
      pz = pos.z - (0.85 + o.swing * 0.3) * facing;
    const rx = facing * ((o.pitch * Math.PI) / 180 + o.swing * 0.9),
      rz = (-o.roll * facing * Math.PI) / 180,
      ry = (o.yaw * Math.PI) / 180;
    this.box(px, py - 0.24, pz, 0.05, 0.22, 0.05, palette.dark, rx, rz, ry);
    this.box(px, py + 0.06, pz, 0.34, 0.42, 0.035, palette.dark, rx, rz, ry);
    this.box(px, py + 0.06, pz, 0.3, 0.38, 0.045, col, rx, rz, ry);
  }
  targetView(m: Match | null, ball: Vec | null): View {
    const t = performance.now() / 1000;
    const f = this.followPos;
    if (m && m.phase !== "lobby" && f && this.viewMode !== "broadcast") {
      const facing = this.followTeam ? -1 : 1,
        b = ball || { x: 0, y: 1, z: 0 };
      if (this.viewMode === "first") {
        // Eyes at head height looking down-court. Only a gentle pull toward the ball, so your
        // paddle stays put at the lower right instead of swinging around the screen.
        const ahead = (f.z - b.z) * facing > 0.5;
        return {
          eye: [f.x, 1.5, f.z],
          target: [
            f.x + (ahead ? (b.x - f.x) * 0.15 : 0),
            ahead ? lerp(1.0, b.y, 0.25) : 0.95,
            f.z - 6 * facing,
          ],
          fov: 74,
          shift: 0,
        };
      }
      // Third person: chase camera over the shoulder, nudged toward the ball.
      return {
        eye: [f.x * 0.7, 3.4, f.z + 5.4 * facing],
        target: [lerp(f.x, b.x, 0.35), 0.85, f.z - 5.5 * facing],
        fov: 56,
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
      { team: 0, hand: "right", bot: false, id: "d0" },
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
      { team: 1, hand: "right", bot: true, id: "d1" },
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
      this.burst({ x: x0, y: 0.95, z: z0 }, teamColor(from > 0 ? 0 : 1), 0.9);
    }
    return ball;
  }
  demoNear = 0;
  demoFar = 0;
  demoHit = -1;
  render = () => {
    this.raf = requestAnimationFrame(this.render);
    const gl = this.gl,
      canvas = this.canvas,
      dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(canvas.clientWidth * dpr),
      h = Math.round(canvas.clientHeight * dpr);
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
    }
    const now = performance.now();
    this.vertices = [];
    const target = now - 65;
    let a = this.history[0],
      b = a;
    for (const v of this.history) {
      if (v.at <= target) a = v;
      if (v.at >= target) {
        b = v;
        break;
      }
      b = v;
    }
    const t =
      a && b && b.at > a.at
        ? Math.max(0, Math.min(1, (target - a.at) / (b.at - a.at)))
        : 1;
    const m = b?.state || this.state;
    const mix = (v: Vec, u: Vec) => ({
      x: v.x + (u.x - v.x) * t,
      y: v.y + (u.y - v.y) * t,
      z: v.z + (u.z - v.z) * t,
    });
    let ball: Vec | null = null;
    this.followPos = null;
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
        const previous = a?.state.players.find((q) => q.id === p.id);
        const pos = previous ? mix(previous.pos, p.pos) : p.pos;
        if (p.id === this.follow) {
          this.followPos = pos;
          this.followTeam = p.team;
        }
        this.mascot(p, pos, {
          firstPerson:
            this.viewMode === "first" &&
            p.id === this.follow &&
            m.phase !== "lobby",
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
      ball =
        a && a.state.event === m.event ? mix(a.state.ball, m.ball) : m.ball;
      // Enlarged, readable orientation mirror in practice/lobby.
      if (m.mode === "practice" || m.phase === "lobby") {
        const p = m.players.find((p) => !p.bot);
        if (p) {
          const rx = (p.input.pitch * Math.PI) / 180,
            rz = (-p.input.roll * Math.PI) / 180;
          this.box(-4.1, 1.15, 6.4, 0.12, 0.85, 0.12, palette.dark);
          this.box(-4.1, 2.05, 6.4, 0.9, 1.15, 0.08, palette.dark, rx, rz);
          this.box(-4.1, 2.05, 6.4, 0.82, 1.06, 0.1, teamColor(p.team), rx, rz);
          this.ring(-4.1, 6.4, 0.7, palette.orange, 0.03, 0.05);
        }
      }
    } else {
      ball = this.demo(now);
    }
    if (ball) {
      // Short motion trail; cleared when the ball jumps (new serve/feed) so no stray dots remain.
      const lastT = this.trail[this.trail.length - 1];
      if (
        lastT &&
        Math.hypot(lastT.x - ball.x, lastT.y - ball.y, lastT.z - ball.z) > 0.7
      )
        this.trail = [];
      this.trail.push({ ...ball });
      if (this.trail.length > 6) this.trail.shift();
      this.trail.forEach((q, i) => {
        if (i < this.trail.length - 1)
          this.sphere(
            q.x,
            q.y,
            q.z,
            0.035 + i * 0.01,
            palette.ball.map((v) => v * (0.35 + i * 0.1)),
          );
      });
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
      this.sphere(ball.x, ball.y, ball.z, 0.11, palette.ball);
    }
    // contact bursts: expanding ring and shards
    this.bursts = this.bursts.filter((s) => now - s.at < 420);
    for (const s of this.bursts) {
      const k = (now - s.at) / 420;
      if (k < 0) continue;
      const r = 0.15 + k * 0.85,
        size = 0.07 * (1 - k);
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2 + s.at;
        this.box(
          s.x + Math.cos(ang) * r,
          s.y + Math.sin(ang) * r * 0.8,
          s.z,
          size,
          size,
          size,
          s.col,
        );
      }
      this.ring(
        s.x,
        s.z,
        0.2 + k * 1.1,
        s.col,
        0.04,
        0.05 * (1 - k) + 0.01,
        16,
      );
    }
    // camera easing toward the view for the current phase
    const goal = this.targetView(m, ball);
    // Player cameras track tightly (a lagging first-person view feels sickly).
    const playerView =
      m &&
      m.phase !== "lobby" &&
      this.followPos &&
      this.viewMode !== "broadcast";
    const e = playerView ? (this.viewMode === "first" ? 0.4 : 0.14) : 0.06;
    this.view = {
      eye: this.view.eye.map((v, i) => lerp(v, goal.eye[i], e)),
      target: this.view.target.map((v, i) => lerp(v, goal.target[i], e)),
      fov: lerp(this.view.fov, goal.fov, e),
      shift: lerp(this.view.shift, goal.shift, e),
    };
    gl.viewport(0, 0, w, h);
    gl.clearColor(palette.fog[0], palette.fog[1], palette.fog[2], 1);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.program, "camera"),
      false,
      new Float32Array(
        camera(
          w / Math.max(1, h),
          this.view.eye,
          this.view.target,
          this.view.fov,
          this.view.shift,
        ),
      ),
    );
    gl.uniform3fv(gl.getUniformLocation(this.program, "fogColor"), palette.fog);
    gl.uniform4fv(
      gl.getUniformLocation(this.program, "spots"),
      // x, z, strength, radius — pools of light like arena spots
      [0, 2.5, 0.55, 5.5, 0, -4, 0.45, 5, 7, 7, 0.35, 4],
    );
    const draw = (buffer: WebGLBuffer, count: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [name, offset] of [
        ["position", 0],
        ["color", 12],
      ] as [string, number][]) {
        const loc = gl.getAttribLocation(this.program, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 24, offset);
      }
      gl.drawArrays(gl.TRIANGLES, 0, count);
    };
    draw(this.staticBuffer, this.staticCount);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(this.vertices),
      gl.DYNAMIC_DRAW,
    );
    draw(this.buffer, this.vertices.length / 6);
  };
}
