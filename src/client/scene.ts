import type { Match, Vec } from "../shared/types.ts";
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
function multiply(a: V, b: V) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let i = 0; i < 4; i++) o[c * 4 + r] += a[i * 4 + r] * b[c * 4 + i];
  return o;
}
function camera(aspect: number) {
  const eye = [8.5, 11.5, 15.5],
    z = norm(sub(eye, [0, 0, 0])),
    x = norm(cross([0, 1, 0], z)),
    y = cross(z, x),
    v = [
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
  const f = 1 / Math.tan(Math.PI / 8),
    near = 0.1,
    far = 100;
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
      0,
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
const colors = {
  court: [0.16, 0.47, 0.43],
  kitchen: [0.23, 0.57, 0.51],
  line: [0.84, 0.96, 0.83],
  blue: [0.26, 0.71, 0.94],
  orange: [1, 0.56, 0.32],
  white: [0.91, 0.95, 0.86],
  dark: [0.1, 0.22, 0.26],
};
export class Scene {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  vertices: number[] = [];
  state: Match | null = null;
  history: { state: Match; at: number }[] = [];
  raf = 0;
  lastEvent = -1;
  audio: AudioContext | null = null;
  muted = true;
  displayTime = 0;
  error = "";
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
    gl.attachShader(
      program,
      shader(
        gl.VERTEX_SHADER,
        "attribute vec3 position; attribute vec3 color; uniform mat4 camera; varying vec3 vColor; void main(){vColor=color;gl_Position=camera*vec4(position,1.0);}",
      ),
    );
    gl.attachShader(
      program,
      shader(
        gl.FRAGMENT_SHADER,
        "precision mediump float; varying vec3 vColor; void main(){gl_FragColor=vec4(vColor,1.0);}",
      ),
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw Error("Unable to initialize renderer");
    this.program = program;
    this.buffer = gl.createBuffer()!;
    this.render();
  }
  sound() {
    this.muted = !this.muted;
    if (!this.audio) this.audio = new AudioContext();
    this.audio.resume();
    return !this.muted;
  }
  update(state: Match) {
    this.state = state;
    this.history.push({ state, at: performance.now() });
    if (this.history.length > 8) this.history.shift();
    if (state.event !== this.lastEvent) {
      this.lastEvent = state.event;
      if (
        !this.muted &&
        this.audio &&
        /Drive|Dink|Roll|Lob|Smash|Net/.test(state.message)
      ) {
        const o = this.audio.createOscillator(),
          g = this.audio.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(520, this.audio.currentTime);
        o.frequency.exponentialRampToValueAtTime(
          170,
          this.audio.currentTime + 0.08,
        );
        g.gain.setValueAtTime(0.09, this.audio.currentTime);
        g.gain.exponentialRampToValueAtTime(
          0.001,
          this.audio.currentTime + 0.1,
        );
        o.connect(g).connect(this.audio.destination);
        o.start();
        o.stop(this.audio.currentTime + 0.11);
      }
    }
  }
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
      [[0, 1, 2, 3], 0.72],
      [[4, 5, 6, 7], 0.9],
      [[0, 4, 7, 3], 0.78],
      [[1, 5, 6, 2], 0.87],
      [[3, 2, 6, 7], 1],
      [[0, 1, 5, 4], 0.6],
    ] as [number[], number][]) {
      this.tri(pts[f[0]], pts[f[1]], pts[f[2]], color, l);
      this.tri(pts[f[0]], pts[f[2]], pts[f[3]], color, l);
    }
  }
  sphere(x: number, y: number, z: number, r: number, color: V) {
    const p = (a: number, b: number) => [
      x + Math.sin(a) * Math.cos(b) * r,
      y + Math.cos(a) * r,
      z + Math.sin(a) * Math.sin(b) * r,
    ];
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 12; j++) {
        const a = (i * Math.PI) / 8,
          b = (j * Math.PI) / 6,
          c = ((i + 1) * Math.PI) / 8,
          d = ((j + 1) * Math.PI) / 6;
        this.tri(p(a, b), p(c, b), p(c, d), color, 0.7 + 0.3 * (1 - i / 8));
        this.tri(p(a, b), p(c, d), p(a, d), color, 0.7 + 0.3 * (1 - i / 8));
      }
  }
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
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.86, 0.91, 0.86, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.vertices = [];
    this.box(0, -0.18, 0, 16, 0.3, 22, [0.73, 0.81, 0.72]);
    this.box(0, -0.015, 0, 6.096, 0.04, 13.4112, colors.court);
    this.box(0, 0.011, 0, 6.096, 0.015, 4.2672, colors.kitchen);
    for (const z of [-6.6802, -2.1082, 2.1082, 6.6802])
      this.box(0, 0.026, z, 6.096, 0.018, 0.0508, colors.line);
    for (const x of [-3.0226, 3.0226])
      this.box(x, 0.026, 0, 0.0508, 0.018, 13.4112, colors.line);
    for (const z of [-4.4196, 4.4196])
      this.box(0, 0.026, z, 0.0508, 0.018, 4.572, colors.line);
    for (const x of [-3.35, 3.35]) {
      this.box(x, 0.52, 0, 0.09, 1.04, 0.09, colors.dark);
      this.sphere(x, 1.08, 0, 0.075, colors.blue);
    }
    for (let x = -3.3; x < 3.3; x += 0.2) {
      const height = COURT.netCenter + (Math.abs(x) / 3.048) * 0.0508;
      this.box(x, height / 2, 0, 0.012, height, 0.018, colors.dark);
      this.box(x, height, 0, 0.21, 0.035, 0.04, colors.white);
    }
    for (let y = 0.1; y < 0.85; y += 0.15)
      this.box(0, y, 0, 6.6, 0.012, 0.018, colors.dark);
    for (const x of [-5, 5])
      for (const z of [-8, -4, 0, 4, 8])
        this.box(x, 0.025, z, 0.06, 0.035, 1, colors.blue);
    const target = performance.now() - 65;
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
    if (m) {
      for (const p of m.players) {
        if (p.id === "practice-feed") continue;
        const previous = a?.state.players.find((q) => q.id === p.id);
        const pos = previous ? mix(previous.pos, p.pos) : p.pos;
        const col = p.team ? colors.orange : colors.blue;
        this.box(pos.x, 0.035, pos.z, 0.7, 0.025, 0.7, col);
        this.box(pos.x, 0.72, pos.z, 0.5, 0.68, 0.35, col);
        this.sphere(pos.x, 1.3, pos.z, 0.23, colors.white);
        this.box(
          pos.x,
          1.32,
          pos.z + (p.team ? 0.19 : -0.19),
          0.3,
          0.085,
          0.055,
          colors.dark,
        );
        const walk =
          Math.sin(performance.now() / 90) *
          Math.min(0.16, Math.hypot(p.velocity.x, p.velocity.z) * 0.04);
        for (const side of [-1, 1])
          this.box(
            pos.x + side * 0.15,
            0.22,
            pos.z + side * walk,
            0.17,
            0.4,
            0.21,
            colors.dark,
          );
        // Far-team characters face +z, so their forehand side and "in front" are mirrored.
        const facing = p.team ? -1 : 1,
          hand = (p.hand === "left" ? -1 : 1) * facing,
          swing = Math.max(0, 1 - (m.time - p.lastHit) / 0.28);
        const px = pos.x + hand * 0.47,
          py = 0.87 + swing * 0.24,
          pz = pos.z - 0.25 * facing;
        this.box(px, py - 0.18, pz, 0.09, 0.34, 0.08, colors.dark);
        this.box(
          px,
          py + 0.08,
          pz,
          0.32,
          0.43,
          0.07,
          col,
          facing * ((p.input.pitch * Math.PI) / 180 + swing * 0.9),
          (-p.input.roll * facing * Math.PI) / 180,
          (p.input.yaw * Math.PI) / 180,
        );
        if (m.serverId === p.id && m.phase === "serve")
          this.sphere(pos.x, 1.9, pos.z, 0.09, [0.95, 0.95, 0.3]);
      }
      const ball =
        a && a.state.event === m.event ? mix(a.state.ball, m.ball) : m.ball;
      this.box(ball.x, 0.04, ball.z, 0.19, 0.012, 0.19, [0.18, 0.35, 0.3]);
      this.sphere(ball.x, ball.y, ball.z, 0.105, [0.91, 0.98, 0.24]);
      // Enlarged, readable orientation mirror in practice/lobby.
      if (m.mode === "practice" || m.phase === "lobby") {
        const p = m.players.find((p) => !p.bot);
        if (p) {
          this.box(
            -4.5,
            1.8,
            3,
            0.75,
            1.05,
            0.1,
            colors.blue,
            (p.input.pitch * Math.PI) / 180,
            (-p.input.roll * Math.PI) / 180,
          );
          this.box(-4.5, 1.1, 3, 0.16, 0.65, 0.13, colors.dark);
        }
      }
    } else {
      for (const [x, z, col] of [
        [1.5, 4.5, colors.blue],
        [-1.5, -4.5, colors.orange],
      ] as [number, number, V][]) {
        this.box(x, 0.72, z, 0.5, 0.7, 0.35, col);
        this.sphere(x, 1.3, z, 0.23, colors.white);
        this.box(x + 0.5, 0.9, z, 0.33, 0.45, 0.08, col);
      }
    }
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(this.vertices),
      gl.DYNAMIC_DRAW,
    );
    for (const [name, offset] of [
      ["position", 0],
      ["color", 12],
    ] as [string, number][]) {
      const loc = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 24, offset);
    }
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.program, "camera"),
      false,
      new Float32Array(camera(w / Math.max(1, h))),
    );
    gl.drawArrays(gl.TRIANGLES, 0, this.vertices.length / 6);
  };
}
