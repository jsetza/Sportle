/**
 * Sportle Bowling's 3D view. Reuses the pickleball Scene (WebGL2 renderer, lighting,
 * shadows, bloom, box/blob/text builders, characters, sounds, name tags) and draws a lane,
 * pins and the bowlers instead of a court. Positions come from the server's snapshots;
 * the client only interpolates and animates (sweep, pin drop-in, replay).
 */
import { Scene, camera, palette } from "./scene.ts";
import { buildMap, lightingFor } from "./maps.ts";
import type { Lighting, Spot } from "./renderer.ts";
import { LANE, RESULT_TIME, SWEEP_TIME } from "../shared/bowling.ts";
import type { Bowl, Bowler, LaneId, Pin } from "../shared/bowling.ts";
import { PADDLES, clamp } from "../shared/types.ts";
import type { Vec } from "../shared/types.ts";

type V = number[];
/** World z of the foul line; the lane runs toward -z. */
const FOUL = 9;
const Z = (d: number) => FOUL - d;
const HEAD = Z(LANE.length);
export type BowlView = "behind" | "follow" | "broadcast";
export const BOWL_VIEW_LABELS: Record<BowlView, string> = {
  behind: "Behind the bowler",
  follow: "Ball cam",
  broadcast: "Broadcast",
};
/** Pin outline: (height, radius) in metres, base to crown. */
const PIN_PROFILE: [number, number][] = [
  [0, 0.026],
  [0.02, 0.042],
  [0.06, 0.056],
  [0.114, 0.0605],
  [0.17, 0.053],
  [0.215, 0.036],
  [0.25, 0.0226],
  [0.285, 0.027],
  [0.33, 0.0318],
  [0.36, 0.026],
  [0.376, 0.013],
  [0.381, 0],
];
const lin = (c: V): [number, number, number] => [c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2];
const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};
const spot = (
  pos: [number, number, number],
  at: [number, number, number],
  color: [number, number, number],
  outer = 28,
  range = 22,
): Spot => ({
  pos,
  dir: unit(at[0] - pos[0], at[1] - pos[1], at[2] - pos[2]),
  color,
  inner: outer * 0.5,
  outer,
  range,
});
/** Lighting per lane. Outdoor lanes borrow the matching pickleball map's sky and sun. */
export function laneLight(id: LaneId): Lighting {
  if (id === "rooftop" || id === "beach") {
    const l = lightingFor(id === "rooftop" ? "nyc" : "hawaii");
    return {
      ...l,
      spots: [
        spot([0, 6, Z(16)], [0, 0, HEAD], [1.6, 1.5, 1.4], 26),
        ...(id === "rooftop" ? [spot([0, 6, Z(4)], [0, 0, Z(8)], [1.2, 1.15, 1.1], 34)] : []),
      ],
    };
  }
  if (id === "neon")
    return {
      sky: lin([0.03, 0.02, 0.06]),
      fogNear: 26,
      fogFar: 70,
      sunDir: unit(0.2, -1, -0.3),
      sunColor: [0.18, 0.14, 0.26],
      skyAmb: [0.08, 0.05, 0.14],
      groundAmb: [0.05, 0.02, 0.06],
      spots: [
        spot([0, 4.2, Z(-1)], [0, 0, Z(5)], [1.4, 1.2, 1.5], 36),
        spot([0, 4, Z(12)], [0, 0, Z(16)], [1.2, 1.0, 1.4], 32),
        spot([0, 3, Z(16.6)], [0, 0, HEAD - 0.3], [1.5, 1.4, 1.35], 24, 12),
      ],
      exposure: 1.35,
      bloom: 0.12,
    };
  // Championship: TV arena, warm floods on the lane.
  return {
    sky: lin([0.04, 0.04, 0.07]),
    fogNear: 30,
    fogFar: 90,
    sunDir: unit(0.32, -1, 0.42),
    sunColor: [0.32, 0.3, 0.3],
    skyAmb: [0.1, 0.1, 0.16],
    groundAmb: [0.06, 0.03, 0.04],
    spots: [
      spot([-3, 9, Z(-2)], [0, 0, Z(3)], [1.8, 1.7, 1.55], 30),
      spot([3, 9, Z(8)], [0, 0, Z(9)], [1.8, 1.7, 1.55], 30),
      spot([-3, 9, Z(14)], [0, 0, Z(15)], [1.8, 1.7, 1.55], 30),
      spot([0, 5, Z(16.5)], [0, 0, HEAD - 0.4], [1.5, 1.45, 1.4], 24, 12),
    ],
    exposure: 1.2,
    bloom: 0.07,
  };
}
const WOOD: V = [0.82, 0.62, 0.38];
const WOOD2: V = [0.76, 0.55, 0.32];
const LANE_COLORS: Record<LaneId, { wall: V; neon: V; neon2: V; floor: V }> = {
  neon: { wall: [0.08, 0.05, 0.14], neon: [1, 0.25, 0.75], neon2: [0.2, 0.85, 1], floor: [0.16, 0.08, 0.22] },
  championship: { wall: [0.06, 0.06, 0.1], neon: [1, 0.55, 0.18], neon2: [0.33, 0.66, 0.98], floor: [0.2, 0.055, 0.1] },
  rooftop: { wall: [0.2, 0.2, 0.24], neon: [1, 0.55, 0.18], neon2: [0.33, 0.66, 0.98], floor: [0.25, 0.24, 0.26] },
  beach: { wall: [0.85, 0.78, 0.62], neon: [1, 0.55, 0.18], neon2: [0.2, 0.75, 0.72], floor: [0.9, 0.82, 0.62] },
};
export class BowlScene extends Scene {
  lane: LaneId = "neon";
  bowl: Bowl | null = null;
  snaps: { b: Bowl; at: number }[] = [];
  viewMode2: BowlView = "follow";
  /** This screen's local clock of the current phase (for the sweep and pin drop-in). */
  phaseSeen = { phase: "", at: 0, event: -1 };
  /** Recent ball/pin states while rolling, for the strike replay. */
  tape: { at: number; ball: Bowl["ball"]; pins: Pin[] }[] = [];
  replay: { tape: BowlScene["tape"]; start: number } | null = null;
  lastShotAt = -1;
  lastBowls = -1;
  crashAt = 0;
  /** Big LED word on the masking unit (STRIKE / SPARE …) and when it started. */
  led: { word: string; at: number } | null = null;
  onShot: (b: Bowl) => void = () => {};
  setLane(id: LaneId) {
    if (id === this.lane) return;
    this.lane = id;
    this.build();
  }
  update(b: Bowl | any) {
    const bowl = b as Bowl;
    const now = performance.now();
    this.snaps.push({ b: bowl, at: now });
    if (this.snaps.length > 4) this.snaps.shift();
    if (bowl.phase !== this.phaseSeen.phase) this.phaseSeen = { phase: bowl.phase, at: now, event: bowl.event };
    if (bowl.lane !== this.lane) this.setLane(bowl.lane);
    // Sounds and effects for a new ball, contacts and results.
    if (bowl.bowls !== this.lastBowls) {
      if (this.lastBowls >= 0 && bowl.phase === "rolling") {
        this.tape = [];
        this.tone(140, 90, 0.25, 0.08, "triangle");
      }
      this.lastBowls = bowl.bowls;
    }
    if (bowl.phase === "rolling" && bowl.ball) {
      this.tape.push({ at: now, ball: { ...bowl.ball }, pins: bowl.pins.map((p) => ({ ...p })) });
      if (this.tape.length > 200) this.tape.shift();
      const prev = this.bowl;
      const newlyDown =
        prev && prev.phase === "rolling"
          ? bowl.pins.filter((p, i) => p.down && !prev.pins[i]?.down).length
          : 0;
      if (newlyDown && now - this.crashAt > 60) {
        this.crashAt = now;
        this.pinCrash(newlyDown);
      }
    }
    if (bowl.shot && bowl.phase === "result" && bowl.shot.at !== this.lastShotAt) {
      this.lastShotAt = bowl.shot.at;
      const c = bowl.shot.callout;
      if (c) this.led = { word: c, at: now };
      if (c === "STRIKE" || c === "SPARE") this.roar(c === "STRIKE" ? 1 : 0.6);
      if (c === "STRIKE" && this.tape.length > 10)
        this.replay = { tape: this.tape.slice(), start: now + 500 };
      this.onShot(bowl);
    }
    this.bowl = bowl;
    this.state = null;
  }
  /** Pins clattering: a burst of bright clicks and a low knock. */
  pinCrash(n: number) {
    const k = Math.min(1, n / 6);
    for (let i = 0; i < Math.min(5, 1 + n); i++)
      setTimeout(() => this.click(1800 + Math.random() * 1600, 1.5, 0.08, 0.25 * (0.5 + k), "bandpass"), i * 35);
    this.tone(220, 120, 0.12, 0.14 * (0.5 + k), "triangle");
  }
  build() {
    this.vertices = [];
    this.fxv = [];
    this.mat = [0.15, 0, 0, 0];
    this.alley();
    this.gl.setStatic(new Float32Array(this.vertices));
    this.vertices = [];
    for (const sp of laneLight(this.lane ?? "neon").spots)
      if (sp.pos[1] > 3.5) this.shaft(sp.pos, sp.dir, sp.outer, sp.color);
    this.gl.setStaticFx(new Float32Array(this.vertices));
    this.vertices = [];
    this.mat = [0.15, 0, 0, 0];
  }
  /** One lane: approach, foul line, arrows, gutters, pin deck, masking unit, ball return. */
  laneAt(cx: number, main: boolean, look: (typeof LANE_COLORS)[LaneId]) {
    const len = LANE.length + LANE.deck;
    // Boards run to the pin deck; the capping stops just short of the kickbacks (no two
    // surfaces share a plane, so nothing flickers: scripts/dev/find-zfighting.ts).
    const boardsLen = LANE.length - 0.6,
      capLen = LANE.length - 0.25;
    // Lane boards (alternating tones), glossy with a soft reflection.
    this.material(0.55, 0, main ? 0.32 : 0.2, 2);
    const boards = 13;
    const bw = (LANE.half * 2) / boards;
    for (let i = 0; i < boards; i++)
      this.box(
        cx - LANE.half + bw * (i + 0.5),
        -0.01,
        Z(boardsLen / 2),
        bw,
        0.02,
        boardsLen,
        i % 2 ? WOOD : WOOD2,
      );
    // Approach.
    this.material(0.35, 0, 0.15, 2);
    this.box(cx, -0.012, (Z(-LANE.approach) + Z(0)) / 2, LANE.half * 2 + LANE.gutter * 2 + 0.1, 0.02, LANE.approach, [0.86, 0.7, 0.48]);
    // Foul line and approach dots.
    this.material(0.2, 0.1);
    this.box(cx, 0.002, Z(0), LANE.half * 2 + LANE.gutter * 2, 0.004, 0.02, [0.06, 0.06, 0.08]);
    for (const dz of [-1.8, -3.6])
      for (const k of [-2, -1, 0, 1, 2]) this.box(cx + k * 0.13, 0.002, Z(dz), 0.03, 0.004, 0.03, [0.2, 0.12, 0.06]);
    // Target arrows ~15 ft down the lane and the dots at 7 ft.
    for (const k of [-3, -2, -1, 0, 1, 2, 3]) {
      const ax = cx + k * LANE.board * 5,
        az = Z(4.6 + Math.abs(k) * 0.3);
      this.box(ax, 0.002, az, 0.03, 0.004, 0.16, [0.15, 0.09, 0.05], 0, 0, 0);
      this.box(ax, 0.002, Z(2.13), 0.025, 0.004, 0.025, [0.2, 0.12, 0.06]);
    }
    // Gutters (dark channels) and the capping between lanes.
    this.material(0.6, 0, 0.1);
    for (const s of [-1, 1]) {
      this.box(cx + s * (LANE.half + LANE.gutter / 2), -0.07, (Z(0) + Z(len)) / 2, LANE.gutter, 0.02, len, [0.12, 0.12, 0.15]);
      this.box(cx + s * (LANE.half + LANE.gutter + 0.04), 0.0, Z(capLen / 2), 0.08, 0.05, capLen, [0.2, 0.2, 0.24]);
    }
    // Pin deck: lighter maple, kickbacks, pit and the masking unit above the pins.
    this.material(0.5, 0, 0.25, 2);
    this.box(cx, -0.006, (HEAD + Z(len)) / 2 + 0.3, LANE.half * 2, 0.02, LANE.deck + 0.6, [0.8, 0.68, 0.5]);
    this.material(0.3, 0, 0);
    this.box(cx, -0.25, Z(len) - 0.6, LANE.wall * 2, 0.4, 1.2, [0.03, 0.03, 0.04]);
    for (const s of [-1, 1])
      this.box(cx + s * (LANE.wall + 0.03), 0.4, (HEAD + Z(len + 1.2)) / 2, 0.06, 0.8, LANE.deck + 1.6, look.wall);
    this.box(cx, 0.7, Z(len + 1.25), LANE.wall * 2 + 0.1, 1.4, 0.05, [0.02, 0.02, 0.03]);
    // Masking unit with the LED board.
    this.material(0.4, 0, 0);
    this.box(cx, 1.25, HEAD + 0.3, LANE.wall * 2 + 0.12, 0.7, 0.08, look.wall);
    this.material(0.2, 1.1);
    this.box(cx, 0.92, HEAD + 0.25, LANE.wall * 2 + 0.12, 0.025, 0.03, look.neon);
    this.box(cx, 1.6, HEAD + 0.25, LANE.wall * 2 + 0.12, 0.025, 0.03, look.neon2);
    if (main) {
      this.material(0.2, 0.9);
      this.text("SPORTLE", cx - 0.62, 1.12, HEAD + 0.25, 0.03, 1, 0, [0.95, 0.95, 1]);
      this.material(0.15);
    }
    // Ball return between this lane and the next (on the right).
    this.material(0.5, 0, 0.1);
    const rx = cx + LANE.half + LANE.gutter + 0.45;
    this.box(rx, 0.32, Z(-2.4), 0.5, 0.64, 1.1, look.wall);
    this.blob(rx, 0.66, Z(-2.4), 0.26, 0.12, 0.5, [0.15, 0.15, 0.2]);
    this.material(0.85, 0.05, 0.3);
    this.blob(rx - 0.08, 0.74, Z(-2.6), 0.11, 0.11, 0.11, [0.85, 0.2, 0.3], 0, 8, 12);
    this.blob(rx + 0.08, 0.74, Z(-2.25), 0.11, 0.11, 0.11, [0.2, 0.45, 0.95], 0, 8, 12);
    this.material(0.15);
  }
  alley() {
    const id = this.lane ?? "neon";
    const look = LANE_COLORS[id];
    const pitch = LANE.half * 2 + LANE.gutter * 2 + 0.9;
    if (id === "rooftop" || id === "beach") {
      // The pickleball map's scenery around the lane (rooftop: New York, beach: Hawaii).
      const map = id === "rooftop" ? "nyc" : "hawaii";
      this.map = map;
      buildMap(this, map);
      this.material(0.2, 0, 0.05);
      this.box(0, -0.052, Z(7), 4.2, 0.08, 34, look.floor);
      this.laneAt(0, true, look);
      this.material(0.15);
      return;
    }
    this.map = "arena";
    // Floor, walls and ceiling of an indoor house with neighbouring lanes.
    this.material(0.15, 0, 0.05, 1);
    this.box(0, -0.06, Z(2), 30, 0.08, 46, look.floor);
    this.material(0.2);
    for (let k = -3; k <= 3; k++) this.laneAt(k * pitch, k === 0, look);
    // Static pins on the neighbouring lanes.
    this.material(0.6, 0.04, 0.15);
    for (let k = -3; k <= 3; k++) {
      if (!k) continue;
      for (const p of freshSpots()) this.pin(k * pitch + p.x, Z(p.d), 0, 0, 0);
    }
    this.material(0.2);
    // Back wall above the pins and the side walls.
    this.box(0, 3.6, HEAD - 2.2, 30, 7, 0.2, look.wall);
    for (const s of [-1, 1]) this.box(s * 15, 3.5, Z(2), 0.2, 7, 46, look.wall);
    this.box(0, 7.1, Z(2), 29.8, 0.2, 46, [0.03, 0.03, 0.05]);
    // Seating behind the approach.
    this.material(0.4, 0, 0.05);
    for (let k = -3; k <= 3; k++) {
      this.box(k * pitch, 0.22, Z(-6.4), 1.6, 0.44, 0.6, [0.12, 0.12, 0.2]);
      this.box(k * pitch, 0.6, Z(-6.75), 1.6, 0.4, 0.12, look.neon2.map((v) => v * 0.5));
    }
    if (id === "neon") {
      // Neon: glowing strips on the walls and ceiling, stars and a giant neon pin.
      this.material(0.2, 1.6);
      for (let i = 0; i < 9; i++) {
        const z = Z(-3 + i * 2.6);
        this.box(-14.85, 2.4 + (i % 2) * 0.6, z, 0.04, 0.06, 1.6, i % 2 ? look.neon : look.neon2);
        this.box(14.85, 2.4 + (i % 2) * 0.6, z, 0.04, 0.06, 1.6, i % 2 ? look.neon2 : look.neon);
        this.box(0, 6.95, z, 26, 0.04, 0.06, i % 2 ? look.neon : look.neon2);
      }
      this.text("BOWLING", -3.1, 4.6, HEAD - 2.08, 0.13, 1, 0, look.neon);
      this.text("SPORTLE", -2.7, 5.9, HEAD - 2.08, 0.11, 1, 0, look.neon2);
      this.material(0.15);
    } else {
      // Championship: stands with a crowd along both sides, a scoreboard above the pins.
      this.material(0.25);
      for (const s of [-1, 1])
        for (let row = 0; row < 6; row++) {
          const x = s * (9.5 + row * 0.9),
            y = 0.4 + row * 0.55;
          this.box(x, y - 0.2, Z(6), 0.9, 0.12, 28, [0.1, 0.1, 0.14]);
          for (let i = 0; i < 26; i++) {
            const seed = Math.sin(i * 12.9898 + row * 78.233 + s) * 43758.5453;
            const r = seed - Math.floor(seed);
            const shirt = [palette.blue, palette.red, palette.orange, palette.white, palette.gold][Math.floor(r * 5)];
            this.blob(x, y + 0.22, Z(-6 + i * 1.05 + r * 0.3), 0.16, 0.22, 0.14, shirt, 0, 4, 6);
            this.blob(x, y + 0.5, Z(-6 + i * 1.05 + r * 0.3), 0.08, 0.09, 0.08, [0.85, 0.68, 0.55], 0, 4, 6);
          }
        }
      this.material(0.2, 1.0);
      this.box(0, 4.4, HEAD - 2.05, 8.2, 2.2, 0.06, [0.04, 0.04, 0.07]);
      this.text("SPORTLE", -2.2, 4.6, HEAD - 2.0, 0.12, 1, 0, palette.orange);
      this.text("BOWLING", -2.4, 3.5, HEAD - 2.0, 0.11, 1, 0, palette.white);
      this.material(0.15);
    }
  }
  /** One pin: a lathe of the classic outline, white with red neck stripes, tipped by `tilt`. */
  pin(x: number, z: number, tilt: number, dir: number, y = 0) {
    // Falling direction in world space: dir 0 = down the lane (-z), + toward +x.
    const fx = Math.sin(dir),
      fz = -Math.cos(dir);
    const st = Math.sin(tilt),
      ct = Math.cos(tilt);
    const u = [st * fx, ct, st * fz];
    const e1 = [ct * fx, -st, ct * fz];
    const e2 = [-fz, 0, fx];
    const base = [x, y + st * 0.055, z];
    const segs = 10;
    const at = (h: number, r: number, a: number): V => [
      base[0] + u[0] * h + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * r,
      base[1] + u[1] * h + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * r,
      base[2] + u[2] * h + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * r,
    ];
    const nrm = (a: number, slope: number): V => {
      const rx = e1[0] * Math.cos(a) + e2[0] * Math.sin(a),
        ry = e1[1] * Math.cos(a) + e2[1] * Math.sin(a),
        rz = e1[2] * Math.cos(a) + e2[2] * Math.sin(a);
      const n = [rx - u[0] * slope, ry - u[1] * slope, rz - u[2] * slope];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      return [n[0] / l, n[1] / l, n[2] / l];
    };
    for (let i = 0; i < PIN_PROFILE.length - 1; i++) {
      const [h0, r0] = PIN_PROFILE[i],
        [h1, r1] = PIN_PROFILE[i + 1];
      const slope = (r1 - r0) / Math.max(0.001, h1 - h0);
      const mid = (h0 + h1) / 2;
      const col = mid > 0.232 && mid < 0.268 ? [0.85, 0.1, 0.14] : palette.white;
      for (let j = 0; j < segs; j++) {
        const a0 = (j / segs) * Math.PI * 2,
          a1 = ((j + 1) / segs) * Math.PI * 2;
        const p00 = at(h0, r0, a0),
          p01 = at(h0, r0, a1),
          p10 = at(h1, r1, a0),
          p11 = at(h1, r1, a1);
        const n0 = nrm(a0, slope),
          n1 = nrm(a1, slope);
        this.vertex(p00, n0, col);
        this.vertex(p10, n0, col);
        this.vertex(p11, n1, col);
        this.vertex(p00, n0, col);
        this.vertex(p11, n1, col);
        this.vertex(p01, n1, col);
      }
    }
  }
  /** Bowling ball with three finger holes, rolling with the distance travelled. */
  ballAt(x: number, y: number, z: number, roll: number, col: V) {
    const r = LANE.ballR;
    this.with([0.9, 0.08, 0.35], () => this.blob(x, y, z, r, r, r, col, 0, 12, 18));
    // Finger holes turning about the x axis as it rolls.
    for (const [a, o] of [
      [0, 0],
      [0.5, -0.35],
      [0.5, 0.35],
    ]) {
      const ang = roll + a;
      const hx = Math.sin(o) * r * 0.86,
        hy = Math.cos(ang) * Math.cos(o) * r * 0.86,
        hz = -Math.sin(ang) * Math.cos(o) * r * 0.86;
      this.with([0.2, 0], () => this.blob(x + hx, y + hy, z + hz, r * 0.17, r * 0.17, r * 0.17, [0.04, 0.04, 0.05], 0, 3, 6));
    }
  }
  /** Interpolated view of the latest state: ball extrapolated with its velocity. */
  private current(now: number) {
    const last = this.snaps[this.snaps.length - 1];
    if (!last) return null;
    const b = last.b;
    const ahead = Math.min(0.1, (now - last.at) / 1000);
    const ball =
      b.ball && b.phase === "rolling"
        ? { ...b.ball, x: b.ball.x + b.ball.vx * ahead, d: b.ball.d + b.ball.vd * ahead }
        : b.ball;
    const pins = b.pins.map((p) => ({
      ...p,
      x: p.x + p.vx * ahead,
      d: p.d + p.vd * ahead,
      tilt: Math.min(Math.PI / 2, p.tilt + p.tiltRate * ahead),
    }));
    return { b, ball, pins };
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
    this.vertices = [];
    this.fxv = [];
    this.decals = [];
    this.tags = [];
    const cur = this.current(now);
    const b = cur?.b ?? null;
    const phaseAge = (now - this.phaseSeen.at) / 1000;
    // Strike replay from the pin cam, in slow motion, during the result.
    let replayFrame: { ball: Bowl["ball"]; pins: Pin[] } | null = null;
    if (this.replay && b?.phase === "result") {
      const t = (now - this.replay.start) / 2.2; // half speed
      const tape = this.replay.tape;
      if (t >= 0) {
        const end = tape[tape.length - 1].at;
        const at = end - 1100 + t;
        const f = tape.find((q) => q.at >= at) ?? tape[tape.length - 1];
        replayFrame = { ball: f.ball, pins: f.pins };
      }
    } else if (b?.phase !== "result") this.replay = null;
    const ball = replayFrame ? replayFrame.ball : cur?.ball ?? null;
    let pins: Pin[] = replayFrame ? replayFrame.pins : cur?.pins ?? freshSpots().map(standing);
    // ——— Pins (with sweep and drop-in animations) ———
    let pinLift = 0,
      barZ: number | null = null;
    if (b?.phase === "sweep" && !replayFrame) {
      const t = clamp(phaseAge / SWEEP_TIME, 0, 1);
      // Rack lifts the standing pins, the sweep bar clears the deadwood, the rack sets them back.
      pinLift = Math.sin(clamp((t - 0.05) / 0.9, 0, 1) * Math.PI) * 0.32;
      barZ = HEAD + 0.5 - clamp((t - 0.2) / 0.5, 0, 1) * (LANE.deck + 0.9);
    }
    const drop = b?.phase === "aim" && phaseAge < 0.6 ? (1 - phaseAge / 0.6) ** 2 * 0.4 : 0;
    this.material(0.6, 0.04, 0.15);
    for (const p of pins) {
      if (p.gone) continue;
      const z = Z(p.d);
      if (barZ !== null && p.down && z > barZ) continue; // swept into the pit
      const wobble = p.down ? 0 : p.wob * Math.sin(now / 45);
      const lift = p.down ? 0 : pinLift + drop;
      this.pin(p.x, z, p.down ? p.tilt : Math.abs(wobble), p.down ? p.dir : wobble > 0 ? 1.57 : -1.57, lift);
    }
    if (barZ !== null) {
      this.material(0.5, 0.05);
      const y = 0.1 + Math.max(0, 1 - clamp(phaseAge / SWEEP_TIME, 0, 1) * 5) * 0.5;
      this.box(0, y, barZ, LANE.wall * 2, 0.12, 0.04, [0.15, 0.15, 0.18]);
    }
    // ——— Ball ———
    const up = b ? b.players[b.turn] : undefined;
    const ballCol = up ? ballColor(up) : [0.85, 0.2, 0.3];
    let ballPos: Vec | null = null;
    if (ball && ball.phase !== "pit") {
      ballPos = { x: ball.x, y: ball.y, z: Z(ball.d) };
      this.ballAt(ball.x, ball.y, Z(ball.d), ball.roll, ballCol);
    }
    // ——— Bowlers ———
    if (b) this.drawBowlers(b, up, now, phaseAge);
    // ——— LED word on the masking unit (flashes on strikes) ———
    if (this.led && now - this.led.at < 2600) {
      const on = Math.floor((now - this.led.at) / 160) % 2 === 0 || this.led.word !== "STRIKE";
      if (on) {
        this.material(0.1, 2.2);
        const word = this.led.word;
        const size = 0.034;
        const width = word.length * 6 * size;
        this.text(word, -width / 2, 1.1, HEAD + 0.21, size, 1, 0, word === "STRIKE" ? palette.orange : word === "GUTTER" ? [0.6, 0.6, 0.7] : palette.gold);
        this.material(0.15);
      }
    }
    // ——— Camera ———
    const view = this.cameraFor(b, ballPos, up, now, !!replayFrame);
    this.view = view;
    const vp = camera(w / Math.max(1, h), view.eye, view.target, view.fov, view.shift);
    const seen = new Set<string>();
    this.placeTags(vp, 0, canvas.clientWidth, 0, seen);
    for (const [key, el] of this.tagEls) if (!seen.has(key)) el.style.display = "none";
    const light = laneLight(this.lane);
    this.gl.frame(
      w,
      h,
      light,
      [
        {
          rect: [0, 0, w, h],
          vp,
          eye: view.eye,
          dynamic: new Float32Array(this.vertices),
          fx: new Float32Array(this.fxv),
          decals: this.decals,
        },
      ],
      this.postFx(now),
      now / 1000,
    );
  };
  drawBowlers(b: Bowl, up: Bowler | undefined, now: number, age: number) {
    const others = b.players.filter((p) => p !== up);
    const cheer =
      b.phase === "result" && (b.shot?.callout === "STRIKE" || b.shot?.callout === "SPARE") ? 1 : 0;
    others.forEach((p, i) => {
      // Waiting bowlers stand beside the approach, out of the camera's way.
      const x = -2.3 - (i % 3) * 0.75,
        z = Z(-1.6 - Math.floor(i / 3) * 1.1);
      this.material(0.55);
      this.mascotBody(
        { team: 0, hand: p.hand, bot: !!p.bot, id: p.id, outfit: p.outfit, gear: p.gear },
        { x, y: 0, z },
        { swing: 0, pitch: 0, roll: 0, yaw: 0, moving: 0, server: false, owner: false, cheer: cheer * (b.shot?.by === p.id ? 0 : 0.6), bowl: { arm: 0, ball: null } },
      );
      this.tags.push({ id: p.id, name: p.name, team: 0, x, y: 2.1, z });
    });
    if (!up || b.phase === "lobby" || b.phase === "over") return;
    // The bowler who is up: waits at the approach, then the slide to the foul line.
    const hand = up.hand === "left" ? -1 : 1;
    const x = up.board * 0.4 - hand * 0.3;
    let z = Z(-2.6),
      arm = 0.25,
      held: V | null = ballColor(up);
    if (b.phase === "aim") {
      arm = 0.3 + Math.sin(now / 600) * 0.05;
    } else if (b.phase === "rolling") {
      const t = clamp(age / 0.5, 0, 1);
      z = Z(-0.5 - (1 - t) * 0.6);
      arm = 1.3 - (1 - t) * 0.6;
      held = null;
    } else {
      z = Z(-0.5);
      arm = 0.4;
      held = null;
    }
    this.material(0.55);
    const celebrate = b.phase === "result" && (b.shot?.callout === "STRIKE" || b.shot?.callout === "SPARE");
    this.mascotBody(
      { team: 0, hand: up.hand, bot: !!up.bot, id: up.id, outfit: up.outfit, gear: up.gear },
      { x, y: 0, z },
      { swing: 0, pitch: 0, roll: 0, yaw: 0, moving: b.phase === "rolling" ? 1 : 0, server: false, owner: true, cheer: celebrate ? 1 : 0, bowl: { arm, ball: held } },
    );
    this.tags.push({ id: up.id, name: up.name, team: 0, x, y: 2.15, z });
  }
  cameraFor(
    b: Bowl | null,
    ball: Vec | null,
    up: Bowler | undefined,
    now: number,
    replay: boolean,
  ) {
    const shift = this.panelOpen ? 0.3 : 0;
    // Menu / lobby: a slow drift over the lane toward the pins.
    if (!b || b.phase === "lobby" || b.phase === "over") {
      const t = now / 9000;
      return { eye: [Math.sin(t) * 1.6, 1.9, Z(-4.5)], target: [0, 0.4, Z(12)], fov: 46, shift };
    }
    const pinCam = { eye: [0.55, 0.42, HEAD + 2.1], target: [0, 0.18, HEAD - 0.35], fov: 40, shift: 0 };
    if (replay) return pinCam;
    const mode = this.viewMode2;
    const hand = up?.hand === "left" ? -1 : 1;
    const ux = up ? up.board * 0.4 : 0;
    const d = ball ? FOUL - ball.z : 0;
    if (mode === "broadcast") {
      // High TV angle from behind and to the side; it pans down the lane with the ball.
      const look = b.phase === "rolling" && ball ? Math.min(LANE.length, d + 5) : b.phase === "aim" ? 9 : LANE.length;
      return { eye: [-2.1, 3.1, Z(-4 + look * 0.35)], target: [0, 0, Z(look)], fov: 40, shift: 0 };
    }
    // Behind the bowler, over the shoulder on the free-hand side.
    const behind = { eye: [ux + hand * 0.85, 3.0, Z(-8.6)], target: [ux * 0.4, 0.2, Z(12)], fov: 40, shift: b.phase === "aim" ? shift * 0.5 : 0 };
    if (mode === "behind" || b.phase === "aim") return behind;
    // Ball cam: chase the ball, then cut to the pin cam near the pins and for the result.
    if (b.phase !== "rolling" || !ball || d > LANE.length - 3.2) return pinCam;
    return { eye: [ball.x * 0.6, 0.75, ball.z + 2.4], target: [ball.x * 0.3, 0.15, ball.z - 6], fov: 46, shift: 0 };
  }
}
/** Pin spots as plain {x, d}. */
function freshSpots() {
  const row = LANE.spacing * Math.sin(Math.PI / 3);
  const out: { x: number; d: number }[] = [];
  for (let k = 0; k < 4; k++)
    for (let j = 0; j <= k; j++) out.push({ x: (j - k / 2) * LANE.spacing, d: LANE.length + k * row });
  return out;
}
const standing = (p: { x: number; d: number }): Pin => ({
  ...p,
  vx: 0,
  vd: 0,
  tilt: 0,
  tiltRate: 0,
  dir: 0,
  down: false,
  gone: false,
  wob: 0,
});
/** Each bowler's ball colour comes from their gear colour choice (cosmetic). */
export const ballColor = (p: Bowler): V =>
  p.bot ? [0.2, 0.22, 0.28] : ((PADDLES[p.gear?.paddle ?? 0] ?? PADDLES[0]).color as unknown as V).map((c, i) =>
    p.gear?.paddle ? c : [0.85, 0.2, 0.3][i],
  );
export { RESULT_TIME };
