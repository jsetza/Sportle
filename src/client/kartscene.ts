/**
 * Sportle Kart's 3D view. Reuses the pickleball Scene (renderer, lighting, shadows, bloom,
 * box/blob/text builders, capsule characters, sounds) and draws a track, karts and items.
 * Every position comes from the server's snapshots; the screen only interpolates between them
 * and adds effects (sparks, glow, replays). Split screen: one view per local driver (2 = side
 * by side, 3–4 = quadrants) or one shared view following the leader.
 */
import { GLYPHS, Scene, camera, palette } from "./scene.ts";
import { lightingFor } from "./maps.ts";
import type { Lighting } from "./renderer.ts";
import type { ViewDraw } from "./renderer.ts";
import { DRIFT_LEVELS, boardWidth, cameraReach, driftLevel, ledSize, pointAt, roadTop, track } from "../shared/kart.ts";
import type { Kart, Racer, Shot, Track, TrackId } from "../shared/kart.ts";
import { PADDLES, clamp } from "../shared/types.ts";

type V = number[];
export type KartView = "chase" | "bumper" | "broadcast";
export const KART_VIEW_LABELS: Record<KartView, string> = {
  chase: "Chase",
  bumper: "Bumper",
  broadcast: "TV broadcast",
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Paint colour of a kart. */
export const paint = (r: Pick<Racer, "color" | "bot">): V =>
  ((PADDLES[r.color] ?? PADDLES[0]).color as unknown as V).slice();
const SPARK: V[] = [palette.blue, palette.orange, [0.95, 0.3, 0.62]];
const GROUND: Record<string, { ground: V; verge: V; road: V; road2: V }> = {
  grass: { ground: [0.24, 0.46, 0.2], verge: [0.3, 0.52, 0.24], road: [0.2, 0.2, 0.23], road2: [0.23, 0.23, 0.26] },
  sand: { ground: [0.9, 0.81, 0.6], verge: [0.93, 0.85, 0.64], road: [0.25, 0.24, 0.26], road2: [0.28, 0.27, 0.29] },
  asphalt: { ground: [0.07, 0.07, 0.1], verge: [0.12, 0.11, 0.16], road: [0.16, 0.15, 0.2], road2: [0.19, 0.18, 0.23] },
  roof: { ground: [0.2, 0.2, 0.23], verge: [0.45, 0.44, 0.42], road: [0.22, 0.22, 0.25], road2: [0.26, 0.26, 0.29] },
  snow: { ground: [0.9, 0.93, 0.97], verge: [0.84, 0.89, 0.95], road: [0, 0, 0], road2: [0, 0, 0] },
  jungle: { ground: [0.15, 0.34, 0.13], verge: [0.32, 0.27, 0.15], road: [0, 0, 0], road2: [0, 0, 0] },
  arena: { ground: [0.1, 0.09, 0.13], verge: [0.2, 0.2, 0.27], road: [0, 0, 0], road2: [0, 0, 0] },
  desert: { ground: [0.86, 0.63, 0.42], verge: [0.8, 0.57, 0.37], road: [0, 0, 0], road2: [0, 0, 0] },
};
type Cam = { eye: V; target: V; fov: number };
export class KartScene extends Scene {
  trackId: TrackId = "court";
  kart: Kart | null = null;
  snaps: { k: Kart; at: number }[] = [];
  viewMode2: KartView = "chase";
  /** Ids of this screen's drivers (one view each), or [] for the shared leader view. */
  local: string[] = [];
  shared = false;
  cams = new Map<string, Cam>();
  /** Shown positions per kart (eased corrections, like the pickleball view). */
  shown = new Map<string, { x: number; y: number; z: number; h: number }>();
  /** Recent snapshots for the finish-line slow-motion replay. */
  tape: { at: number; racers: Racer[] }[] = [];
  replay: { id: string; start: number; frames: { at: number; racers: Racer[] }[] } | null = null;
  /** Time-trial ghost: the best lap's samples (t, x, y, z, h). */
  ghost: number[] | null = null;
  ghostStart = 0;
  engine: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  lastShotIds = new Set<number>();
  lastBoosts = new Map<string, number>();
  lastHits = new Map<string, number>();
  cubesUp = 0;
  /** DOM overlays per view (place, lap, item, callouts), keyed by racer id. */
  onViews: (rects: { id: string; x: number; y: number; w: number; h: number }[]) => void = () => {};
  setTrack(id: TrackId) {
    if (id === this.trackId) return;
    this.trackId = id;
    this.build();
  }
  update(k: Kart | any) {
    const kart = k as Kart;
    const now = performance.now();
    this.snaps.push({ k: kart, at: now });
    if (this.snaps.length > 4) this.snaps.shift();
    if (kart.track !== this.trackId) this.setTrack(kart.track);
    this.tape.push({ at: now, racers: kart.racers });
    while (this.tape.length && now - this.tape[0].at > 3500) this.tape.shift();
    this.sounds(kart);
    this.kart = kart;
    this.state = null;
  }
  /** Item, boost and hit sounds from what changed in the snapshot. */
  sounds(k: Kart) {
    const ids = new Set(k.shots.map((s) => s.id));
    for (const s of k.shots)
      if (!this.lastShotIds.has(s.id)) {
        if (s.kind === "dink" || s.kind === "serve" || s.kind === "mball") this.hitSound(0.6);
        else if (s.kind === "pinbowl" || s.kind === "strike") this.tone(110, 70, 0.4, 0.12, "triangle");
        else if (s.kind === "wave") this.roar(0.5);
        else if (s.kind === "net") this.click(900, 1, 0.2, 0.15, "bandpass");
        else if (s.kind === "fence") this.click(2000, 2, 0.1, 0.15, "bandpass");
      }
    this.lastShotIds = ids;
    for (const r of k.racers) {
      const b = this.lastBoosts.get(r.id);
      if (b !== undefined && r.boosts > b && (this.local.includes(r.id) || !this.local.length)) {
        this.click(600, 0.7, 0.35, 0.12, "lowpass");
        this.tone(220, 660, 0.3, 0.05, "sawtooth");
      }
      this.lastBoosts.set(r.id, r.boosts);
      const h = this.lastHits.get(r.id);
      if (h !== undefined && r.hits > h) this.tone(300, 90, 0.35, 0.1, "square");
      this.lastHits.set(r.id, r.hits);
    }
    const up = k.cubes.filter((c) => c.up).length;
    if (up < this.cubesUp) this.tone(880, 1320, 0.15, 0.06, "triangle");
    this.cubesUp = up;
  }
  /** Engine hum that rises with the speed of this screen's karts. */
  engineHum(speed: number, on: boolean) {
    if (this.muted || !this.audio) {
      if (this.engine) this.engine.gain.gain.value = 0;
      return;
    }
    if (!this.engine) {
      const a = this.audio;
      const osc = a.createOscillator(),
        gain = a.createGain(),
        filter = a.createBiquadFilter();
      osc.type = "sawtooth";
      filter.type = "lowpass";
      filter.frequency.value = 500;
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.sfxOut());
      osc.start();
      this.engine = { osc, gain, filter };
    }
    const t = this.audio.currentTime;
    this.engine.osc.frequency.setTargetAtTime(55 + speed * 5.5, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(300 + speed * 40, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(on ? 0.035 : 0, t, 0.15);
  }
  // ——————————————————————————— Static track ———————————————————————————
  build() {
    this.vertices = [];
    this.fxv = [];
    this.mat = [0.15, 0, 0, 0];
    const t = track(this.trackId ?? "court");
    this.map = t.def.light;
    this.trackMesh(t);
    this.scenery(t);
    this.gl.setStatic(new Float32Array(this.vertices));
    this.vertices = [];
    this.gl.setStaticFx(new Float32Array(0));
    this.mat = [0.15, 0, 0, 0];
  }
  lighting(): Lighting {
    const t = track(this.trackId ?? "court");
    const l = lightingFor(t.def.light);
    return { ...l, fogNear: Math.max(l.fogNear, 60), fogFar: Math.max(l.fogFar, 220), spots: [] };
  }
  /** Lateral point on the track centre line i at offset d, height y + dy. */
  P(t: Track, i: number, d: number, dy = 0): V {
    i = ((i % t.n) + t.n) % t.n;
    return [t.x[i] - t.tz[i] * d, t.y[i] + dy, t.z[i] + t.tx[i] * d];
  }
  /** A strip along the track between lateral offsets (functions of the index). */
  strip(t: Track, d0: (i: number) => number, d1: (i: number) => number, dy: number, col: (i: number) => V, skip: (i: number) => boolean) {
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      if (skip(i)) continue;
      const a = this.P(t, i, d0(i), dy),
        b = this.P(t, i, d1(i), dy),
        c = this.P(t, j, d1(j), dy),
        d = this.P(t, j, d0(j), dy);
      const cl = col(i);
      this.tri(a, b, c, cl);
      this.tri(a, c, d, cl);
    }
  }
  trackMesh(t: Track) {
    const def = t.def,
      look = GROUND[def.ground];
    const gap = (i: number) => !t.ground[i] || !t.ground[(i + 1) % t.n];
    const cut = t.cut;
    const nearCut = (i: number, side: number) => {
      if (!cut) return false;
      const inside = Math.sign(this.cutSide(t));
      if (side !== inside) return false;
      const ds = (a: number) => Math.min(Math.abs(t.s[i] - a), t.L - Math.abs(t.s[i] - a));
      return ds(cut.s0) < 9 || ds(cut.s1) < 9;
    };
    // Ground far below everything.
    let minY = Infinity;
    for (let i = 0; i < t.n; i++) minY = Math.min(minY, t.y[i]);
    this.material(0.1, 0, 0.03);
    if (def.id !== "beach") this.box(0, minY - 0.12, 0, 520, 0.1, 520, look.ground);
    else {
      // Beach: sand to the west, the ocean to the east (and under the pier jump).
      this.box(-110, minY - 0.12, 0, 380, 0.1, 520, look.ground);
      this.material(0.9, 0, 0.55);
      this.box(190, minY - 0.5, 0, 220, 0.1, 520, [0.08, 0.38, 0.55]);
      this.material(0.1, 0, 0.03);
    }
    // Under each jump gap: a river (water) or a dark ravine, across the track.
    for (const rp of def.ramps) {
      if (!rp.gap || def.id === "beach" || def.id === "skyline") continue;
      const mid = pointAt(t, rp.at * t.L + rp.len + rp.gap / 2, 0);
      const ry = Math.atan2(t.tx[mid.i], t.tz[mid.i]);
      if (def.water) this.material(0.9, 0, 0.6);
      else this.material(0.1);
      this.box(mid.x, minY - 0.1, mid.z, 400, 0.1, rp.gap + 6, def.water ? [0.1, 0.42, 0.45] : [0.22, 0.09, 0.05], 0, 0, ry);
      this.material(0.1, 0, 0.03);
    }
    const road = def.road;
    const lane = def.pins;
    const laneFrom = lane ? lane.at * t.L - 6 : -1,
      laneTo = lane ? lane.at * t.L + lane.len + 6 : -1;
    const isLane = (i: number) => !!lane && t.s[i] > laneFrom && t.s[i] < laneTo;
    const bridge = def.bridge;
    const isBridge = (i: number) => !!bridge && t.s[i] > bridge[0] * t.L && t.s[i] < bridge[1] * t.L && t.y[i] > 1;
    const ry = (i: number) => Math.atan2(t.tx[i], t.tz[i]);
    const segLen = (i: number) => Math.hypot(t.x[(i + 1) % t.n] - t.x[i], t.z[(i + 1) % t.n] - t.z[i]);
    const WOOD: V = [0.82, 0.62, 0.38],
      WOOD2: V = [0.76, 0.55, 0.32],
      GLASS: V = [0.55, 0.8, 0.95];
    const band = (i: number, m: number) => Math.floor(t.s[i] / m) % 2;
    // ——— Road surface: each track its own ———
    const S: Record<string, { spec: number; refl: number; col: (i: number) => V }> = {
      court: { spec: 0.3, refl: 0.08, col: (i) => (band(i, 6) ? [0.2, 0.36, 0.66] : [0.22, 0.39, 0.7]) },
      neon: { spec: 0.4, refl: 0.3, col: (i) => (isLane(i) ? (i % 2 ? WOOD : WOOD2) : band(i, 6) ? [0.08, 0.07, 0.12] : [0.1, 0.09, 0.15]) },
      planks: { spec: 0.2, refl: 0.04, col: (i) => (i % 4 === 0 ? [0.4, 0.27, 0.15] : i % 2 ? [0.58, 0.41, 0.24] : [0.52, 0.36, 0.21]) },
      rooftop: { spec: 0.25, refl: 0.05, col: (i) => (band(i, 8) ? [0.4, 0.4, 0.42] : [0.37, 0.37, 0.39]) },
      ice: { spec: 0.95, refl: 0.55, col: (i) => (band(i, 5) ? [0.72, 0.86, 0.96] : [0.66, 0.82, 0.94]) },
      dirt: { spec: 0.05, refl: 0, col: (i) => (band(i, 9) ? [0.46, 0.33, 0.2] : [0.44, 0.315, 0.19]) },
      hardwood: { spec: 0.55, refl: 0.25, col: (i) => (band(i, 7) ? WOOD : WOOD2) },
      sandstone: { spec: 0.15, refl: 0.02, col: (i) => (band(i, 6) ? [0.72, 0.42, 0.26] : [0.67, 0.38, 0.23]) },
    };
    const surf = S[road.surface];
    this.material(surf.spec, 0, surf.refl, road.surface === "court" ? 0 : 0);
    if (road.surface === "hardwood") {
      // Boards run along the road: five strips across, alternating tones.
      for (let k = 0; k < 5; k++)
        this.strip(
          t,
          (i) => -t.w[i] / 2 + (t.w[i] * k) / 5,
          (i) => -t.w[i] / 2 + (t.w[i] * (k + 1)) / 5,
          0,
          (i) => (k % 2 ? WOOD : WOOD2).map((c) => c * (band(i, 7) ? 1 : 0.95)),
          (i) => gap(i) || isBridge(i),
        );
    } else this.strip(t, (i) => -t.w[i] / 2, (i) => t.w[i] / 2, 0, surf.col, (i) => gap(i) || isBridge(i));
    // Glass skybridge: glossy and faintly glowing, with a steel deck under it.
    if (bridge) {
      this.material(0.95, 0.25, 0.7);
      this.strip(t, (i) => -t.w[i] / 2 - 1, (i) => t.w[i] / 2 + 1, 0, () => GLASS, (i) => !isBridge(i));
      this.material(0.4);
      this.strip(t, (i) => -t.w[i] / 2 - 1, (i) => t.w[i] / 2 + 1, -0.45, () => [0.2, 0.22, 0.26], (i) => !isBridge(i));
    }
    // ——— Road markings ———
    const mark = (i: number, d: number, w: number, col: V, dy = 0.012, len = segLen(i)) => {
      const p = this.P(t, i, d, dy);
      this.box(p[0], p[1], p[2], w, 0.012, len, col, 0, 0, ry(i));
    };
    for (let i = 0; i < t.n; i++) {
      if (gap(i) || isLane(i) || isBridge(i)) continue;
      const hw = t.w[i] / 2;
      if (road.surface === "court") {
        // White court lines along both edges and a dashed centre line.
        this.material(0.2, 0.15);
        for (const s of [-1, 1]) mark(i, s * (hw - 0.4), 0.14, palette.white);
        if (i % 4 === 0) mark(i, 0, 0.14, palette.white, 0.012, 2.2);
      } else if (road.surface === "neon") {
        // Glowing edge lines (pink left, cyan right) and violet centre dashes.
        this.material(0.2, 1.6);
        mark(i, -(hw - 0.3), 0.16, [1, 0.25, 0.75]);
        mark(i, hw - 0.3, 0.16, [0.2, 0.85, 1]);
        if (i % 4 === 0) mark(i, 0, 0.16, [0.6, 0.35, 1], 0.012, 2.2);
      } else if (road.surface === "rooftop") {
        // Double yellow centre line and dark tar seams across.
        this.material(0.2, 0.15);
        for (const s of [-0.15, 0.15]) mark(i, s, 0.1, [0.95, 0.78, 0.15]);
        if (i % 8 === 0) {
          const p = this.P(t, i, 0, 0.012);
          this.box(p[0], p[1], p[2], t.w[i] - 0.4, 0.012, 0.12, [0.12, 0.12, 0.14], 0, 0, ry(i));
        }
      } else if (road.surface === "ice") {
        // Pale frost streaks scattered on the ice.
        this.material(0.8, 0.1, 0.3);
        if (i % 3 === 0) mark(i, ((i * 37) % 11) - 5, 0.25, [0.95, 0.97, 1], 0.012, 3.5);
      } else if (road.surface === "dirt") {
        // Two darker tyre ruts.
        this.material(0.05);
        for (const s of [-2.2, 2.2]) mark(i, s, 0.9, [0.3, 0.21, 0.12]);
      } else if (road.surface === "hardwood") {
        // Blue painted borders and a white centre line, like a court floor.
        this.material(0.4, 0.1, 0.2);
        for (const s of [-1, 1]) mark(i, s * (hw - 0.35), 0.7, [0.2, 0.4, 0.85]);
        if (i % 2 === 0) mark(i, 0, 0.12, palette.white);
      } else if (road.surface === "sandstone") {
        // Cracks in the rock road.
        this.material(0.1);
        if (i % 5 === 0) {
          const p = this.P(t, i, ((i * 13) % 9) - 4, 0.012);
          this.box(p[0], p[1], p[2], 0.08, 0.012, 2.4, [0.42, 0.2, 0.12], 0, 0, ry(i) + ((i % 3) - 1) * 0.6);
        }
      }
    }
    // ——— Verges (the ground's own colour; glass on the skybridge) ———
    this.material(0.1, 0, 0.02);
    for (const side of [-1, 1])
      this.strip(
        t,
        (i) => (side * t.w[i]) / 2,
        (i) => side * (t.w[i] / 2 + def.verge),
        -0.012,
        (i) => (isLane(i) ? [0.1, 0.1, 0.13] : look.verge),
        (i) => gap(i) || isBridge(i),
      );
    // ——— Kerbs ———
    const corner = (i: number) => Math.abs(t.k[i]) >= 0.012;
    for (let i = 0; i < t.n; i++) {
      if (gap(i) || isLane(i) || isBridge(i)) continue;
      for (const side of [-1, 1]) {
        const p = this.P(t, i, side * (t.w[i] / 2 + 0.35), 0.02);
        const len = segLen(i) * 0.98;
        if (road.kerb === "court" && corner(i)) {
          this.material(0.4, 0.05);
          this.box(p[0], p[1], p[2], 0.7, 0.05, len, i % 2 ? palette.white : palette.blue, 0, 0, ry(i));
        } else if (road.kerb === "hazard" && corner(i)) {
          this.material(0.4, 0.05);
          this.box(p[0], p[1], p[2], 0.7, 0.05, len, i % 2 ? [0.1, 0.1, 0.1] : [0.98, 0.8, 0.1], 0, 0, ry(i));
        } else if (road.kerb === "neonline") {
          this.material(0.2, 1.4);
          this.box(p[0], p[1], p[2], 0.25, 0.05, len, side < 0 ? [1, 0.25, 0.75] : [0.2, 0.85, 1], 0, 0, ry(i));
        } else if (road.kerb === "rope" && i % 3 === 0) {
          this.material(0.3);
          this.box(p[0], p[1] + 0.3, p[2], 0.14, 0.6, 0.14, [0.45, 0.32, 0.18]);
          this.box(p[0], p[1] + 0.48, p[2], 0.05, 0.05, segLen(i) * 3, [0.85, 0.78, 0.6], 0, 0, ry(i));
        } else if (road.kerb === "iceblocks" && corner(i) && i % 2 === 0) {
          this.material(0.9, 0.15, 0.4);
          this.box(p[0], p[1] + 0.15, p[2], 0.6, 0.35, 0.6, i % 4 ? [0.8, 0.92, 1] : [0.96, 0.98, 1], 0, 0, ry(i) + 0.3);
        } else if (road.kerb === "rocks" && corner(i) && i % 2 === 0) {
          this.material(0.15);
          const r = 0.3 + ((i * 7) % 5) * 0.06;
          this.blob(p[0], p[1], p[2], r, r * 0.7, r, road.surface === "sandstone" ? [0.55, 0.3, 0.2] : [0.45, 0.45, 0.42], 0, 3, 6);
        } else if (road.kerb === "paint") {
          this.material(0.3, 0.1, 0.2);
          this.box(p[0], p[1] - 0.008, p[2], 0.5, 0.01, len, corner(i) ? (i % 2 ? palette.white : palette.orange) : palette.white, 0, 0, ry(i));
        }
      }
    }
    // ——— Barriers along the outer edge (open at the shortcut's ends and over gaps) ———
    for (let i = 0; i < t.n; i++) {
      for (const side of [-1, 1]) {
        if (nearCut(i, side) || gap(i)) continue;
        const bridgeHere = isBridge(i);
        const at = side * (t.w[i] / 2 + (bridgeHere ? 1.2 : def.verge) + 0.35);
        const p = this.P(t, i, at, 0);
        const len = segLen(i) + 0.05,
          r0 = ry(i);
        const kind = bridgeHere ? "glass" : road.barrier;
        if (kind === "glass") {
          this.material(0.95, 0.6, 0.5);
          this.box(p[0], p[1] + 0.55, p[2], 0.08, 1.1, len, [0.6, 0.85, 1], 0, 0, r0);
          this.material(0.6, 1.2);
          this.box(p[0], p[1] + 1.12, p[2], 0.14, 0.06, len, [0.3, 0.9, 1], 0, 0, r0);
        } else if (kind === "neon") {
          this.material(0.45, 0.9, 0.05);
          this.box(p[0], p[1] + 0.4, p[2], 0.5, 0.8, len, i % 6 < 3 ? [0.9, 0.2, 0.7] : [0.2, 0.75, 1], 0, 0, r0);
        } else if (kind === "fence") {
          // Court fencing: dark mesh between posts, a white top rail.
          this.material(0.3);
          this.box(p[0], p[1] + 0.75, p[2], 0.06, 1.5, len, [0.12, 0.16, 0.14], 0, 0, r0);
          this.material(0.4, 0.1);
          this.box(p[0], p[1] + 1.52, p[2], 0.1, 0.08, len, palette.white, 0, 0, r0);
          if (i % 3 === 0) this.box(p[0], p[1] + 0.8, p[2], 0.14, 1.6, 0.14, [0.3, 0.32, 0.34]);
        } else if (kind === "rail") {
          // Boardwalk railing: wooden posts and two rails.
          this.material(0.25);
          for (const h of [0.45, 0.85]) this.box(p[0], p[1] + h, p[2], 0.1, 0.1, len, [0.62, 0.46, 0.3], 0, 0, r0);
          if (i % 2 === 0) this.box(p[0], p[1] + 0.48, p[2], 0.16, 0.96, 0.16, [0.5, 0.36, 0.22]);
        } else if (kind === "guardrail") {
          // Steel guardrail on short posts.
          this.material(0.8, 0, 0.3);
          this.box(p[0], p[1] + 0.6, p[2], 0.08, 0.32, len, [0.72, 0.74, 0.78], 0, 0, r0);
          if (i % 2 === 0) {
            this.material(0.4);
            this.box(p[0] + side * 0.1 * -t.tz[i], p[1] + 0.35, p[2] + side * 0.1 * t.tx[i], 0.12, 0.7, 0.12, [0.35, 0.36, 0.4]);
          }
        } else if (kind === "snowbank") {
          this.material(0.4, 0.05);
          if (i % 2 === 0) this.blob(p[0], p[1] + 0.1, p[2], 0.9, 0.75 + ((i * 7) % 5) * 0.08, 1.8, [0.95, 0.97, 1], 0, 4, 8);
        } else if (kind === "logs") {
          this.material(0.2);
          for (const h of [0.25, 0.7]) this.box(p[0], p[1] + h, p[2], 0.45, 0.45, len, h > 0.5 ? [0.42, 0.27, 0.14] : [0.36, 0.23, 0.12], 0, 0, r0);
        } else if (kind === "pads") {
          // Padded arena wall in Sportle colours with a white top trim.
          this.material(0.35, 0.05);
          const c = [palette.blue, palette.orange, palette.red][Math.floor(i / 4) % 3];
          this.box(p[0], p[1] + 0.6, p[2], 0.35, 1.2, len, c, 0, 0, r0);
          this.material(0.4, 0.2);
          this.box(p[0], p[1] + 1.23, p[2], 0.4, 0.06, len, palette.white, 0, 0, r0);
        } else if (kind === "boulders" && i % 2 === 0) {
          this.material(0.15);
          const r = 0.7 + ((i * 13) % 7) * 0.12;
          this.blob(p[0], p[1] + r * 0.4, p[2], r, r * 0.8, r * 1.2, [0.62 - (i % 3) * 0.05, 0.34, 0.22], 0, 4, 7);
        }
      }
    }
    // Bridge supports: pillars at the skybridge's ends, clear of the road underneath.
    if (bridge)
      for (let i = 0; i < t.n; i += 6) {
        if (!isBridge(i) || t.y[i] > 5) continue;
        this.material(0.5, 0, 0.2);
        for (const side of [-1, 1]) {
          const p = this.P(t, i, side * (t.w[i] / 2 + 1.6), 0);
          this.box(p[0], p[1] / 2 - 0.2, p[2], 0.5, p[1] - 0.4, 0.5, [0.75, 0.78, 0.82]);
        }
      }
    // Shortcut strip (dirt / gravel / sand): drivable, slow without a boost.
    if (cut) {
      this.material(0.08, 0, 0.02);
      const col: V = def.ground === "sand" ? [0.8, 0.68, 0.46] : def.ground === "grass" || def.ground === "jungle" ? [0.45, 0.33, 0.2] : def.ground === "snow" ? [0.78, 0.84, 0.9] : def.ground === "desert" ? [0.62, 0.42, 0.28] : [0.32, 0.3, 0.3];
      for (let q = 0; q + 1 < cut.x.length; q++) {
        const ex = cut.x[q + 1] - cut.x[q],
          ez = cut.z[q + 1] - cut.z[q],
          l = Math.hypot(ex, ez) || 1;
        const nx = -ez / l,
          nz = ex / l,
          hw = cut.width / 2;
        const A = [cut.x[q] + nx * hw, cut.y[q] - 0.006, cut.z[q] + nz * hw],
          B = [cut.x[q] - nx * hw, cut.y[q] - 0.006, cut.z[q] - nz * hw],
          C = [cut.x[q + 1] - nx * hw, cut.y[q + 1] - 0.006, cut.z[q + 1] - nz * hw],
          D = [cut.x[q + 1] + nx * hw, cut.y[q + 1] - 0.006, cut.z[q + 1] + nz * hw];
        this.tri(A, B, C, col);
        this.tri(A, C, D, col);
        // Low posts marking its sides.
        if (q > 1 && q < cut.x.length - 3 && q % 2 === 0)
          for (const s of [-1, 1]) {
            this.material(0.3, 0.6);
            this.box(cut.x[q] + nx * (hw + 0.5) * s, cut.y[q] + 0.4, cut.z[q] + nz * (hw + 0.5) * s, 0.2, 0.8, 0.2, palette.orange);
            this.material(0.08, 0, 0.02);
          }
      }
    }
    // Start/finish line: a checkered band and the arch.
    this.material(0.3, 0.1);
    const i0 = pointAt(t, t.S0).i,
      w0 = t.w[i0];
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < Math.round(w0 / 0.7); c++) {
        const d = -w0 / 2 + 0.35 + c * 0.7;
        const p = this.P(t, i0, d, 0.006);
        this.box(p[0] + t.tx[i0] * (r - 0.5) * 0.7, p[1], p[2] + t.tz[i0] * (r - 0.5) * 0.7, 0.7, 0.008, 0.7, (r + c) % 2 ? palette.white : palette.dark, 0, 0, Math.atan2(t.tx[i0], t.tz[i0]));
      }
    // Boost pads: glowing orange chevrons.
    for (const pad of def.pads) {
      const s = pad.at * t.L,
        pt = pointAt(t, s, 0);
      const d = (pad.d * pt.w) / 2;
      const ry = Math.atan2(t.tx[pt.i], t.tz[pt.i]);
      this.material(0.2, 1.3);
      for (let k = 0; k < 3; k++) {
        const q = pointAt(t, s - 1.2 + k * 1.2, d);
        for (const side of [-1, 1])
          this.box(q.x - t.tz[pt.i] * side * 0.55 - t.tx[pt.i] * 0.25, q.y + 0.014, q.z + t.tx[pt.i] * side * 0.55 - t.tz[pt.i] * 0.25, 0.22, 0.01, 1.3, palette.orange, 0, 0, ry + side * 0.7);
      }
      this.material(0.2, 0.3);
      this.box(pt.x - t.tz[pt.i] * d, pt.y + 0.007, pt.z + t.tx[pt.i] * d, 3.4, 0.008, 4.2, [0.35, 0.12, 0.03], 0, 0, ry);
    }
    // Ramps: striped side panels under the lip.
    for (const rp of def.ramps) {
      const a = Math.round(rp.at * t.n) % t.n;
      this.material(0.3, 0.2);
      for (let q = 0; q < 12; q++) {
        const i = (a + q) % t.n;
        if (!t.ground[i]) break;
        const h = t.y[i] - t.y[a];
        if (h < 0.05) continue;
        for (const side of [-1, 1]) {
          const p = this.P(t, i, side * (t.w[i] / 2 + 0.05), -h / 2);
          this.box(p[0], p[1], p[2], 0.1, h, 1.6, q % 2 ? palette.orange : palette.dark, 0, 0, Math.atan2(t.tx[i], t.tz[i]));
        }
      }
    }
    // Gantries with LED boards (text drawn live) and the finish arch.
    this.material(0.4, 0, 0.1);
    for (const g of def.gantries) {
      const pt = pointAt(t, g * t.L, 0);
      const span = pt.w / 2 + def.verge + 1.2;
      for (const side of [-1, 1]) {
        const p = pointAt(t, g * t.L, side * span);
        this.box(p.x, p.y + 3.4, p.z, 0.5, 6.8, 0.5, [0.16, 0.16, 0.2]);
      }
      const ry = Math.atan2(t.tx[pt.i], t.tz[pt.i]);
      this.box(pt.x, pt.y + 6.6, pt.z, span * 2 + 0.5, 1.8, 0.5, [0.05, 0.05, 0.08], 0, 0, ry);
    }
  }
  /** Which side (+1/-1 of the normal) the shortcut is on. */
  cutSide(t: Track) {
    const c = t.cut!;
    const mid = Math.floor(c.x.length / 2);
    const p = pointAt(t, (c.s0 + ((c.s1 - c.s0 + t.L) % t.L) / 2) % t.L, 0);
    return Math.sign(-(c.x[mid] - p.x) * t.tz[p.i] + (c.z[mid] - p.z) * t.tx[p.i]) || 1;
  }
  // ——————————————————————————— Scenery ———————————————————————————
  scenery(t: Track) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const def = t.def;
    // Keep scenery clear of the road: true if (x, z) is near any part of the track.
    const clear = (x: number, z: number, m: number) => {
      for (let i = 0; i < t.n; i += 2) {
        const r = t.w[i] / 2 + def.verge + m;
        if ((x - t.x[i]) ** 2 + (z - t.z[i]) ** 2 < r * r) return false;
      }
      const c = t.cut;
      if (c) for (let q = 0; q < c.x.length; q++) if ((x - c.x[q]) ** 2 + (z - c.z[q]) ** 2 < (c.width / 2 + m + 1) ** 2) return false;
      return true;
    };
    const tree = (x: number, z: number, s: number, y = 0) => {
      this.material(0.2);
      this.box(x, y + 1.2 * s, z, 0.35 * s, 2.4 * s, 0.35 * s, [0.38, 0.26, 0.16]);
      this.blob(x, y + 3.2 * s, z, 1.6 * s, 1.7 * s, 1.6 * s, [0.18 + rnd() * 0.08, 0.42 + rnd() * 0.12, 0.18], 0, 5, 7);
    };
    const palm = (x: number, z: number, s: number) => {
      this.material(0.2);
      for (let k = 0; k < 6; k++) this.box(x + k * 0.12 * s, (0.6 + k * 1.1) * s, z, 0.4 * s, 1.15 * s, 0.4 * s, [0.55, 0.42, 0.26]);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        this.box(x + 0.7 * s + Math.cos(a) * 1.6 * s, 6.9 * s, z + Math.sin(a) * 1.6 * s, 0.5 * s, 0.12 * s, 3.4 * s, [0.2, 0.55, 0.22], 0.35, 0, Math.PI / 2 - a);
      }
    };
    const crowd = (x: number, z: number, len: number, ry: number, rows = 4) => {
      this.material(0.25);
      const c = Math.cos(ry),
        s = Math.sin(ry);
      for (let row = 0; row < rows; row++) {
        const back = row * 1.1,
          y = 0.4 + row * 0.6;
        // Rows step up away from the track.
        const bx = x - s * back,
          bz = z - c * back;
        this.box(bx, y / 2 - 0.1, bz, len, y, 1.1, [0.14, 0.14, 0.2], 0, 0, ry);
        for (let i = 0; i < len / 1.1; i++) {
          const u = -len / 2 + i * 1.1;
          const shirt = [palette.blue, palette.red, palette.orange, palette.white, palette.gold][Math.floor(rnd() * 5)];
          const px = bx + c * u,
            pz = bz - s * u;
          this.blob(px, y + 0.25, pz, 0.22, 0.28, 0.2, shirt, 0, 3, 6);
          this.blob(px, y + 0.62, pz, 0.12, 0.13, 0.12, [0.85, 0.68, 0.55], 0, 3, 6);
        }
      }
    };
    // Footprints already built: scenery towers never overlap each other (no shared faces).
    const placed: number[][] = [];
    const building = (x: number, z: number, w: number, d: number, h: number, col: V, lit: number, y = 0, overlap = false) => {
      const f = [x - w / 2, x + w / 2, z - d / 2, z + d / 2];
      if (!overlap && placed.some((q) => f[0] < q[1] + 0.5 && f[1] > q[0] - 0.5 && f[2] < q[3] + 0.5 && f[3] > q[2] - 0.5)) return;
      placed.push(f);
      this.material(0.25, 0, 0.05);
      this.box(x, y + h / 2, z, w, h, d, col);
      if (lit <= 0) return;
      this.material(0.2, lit);
      for (let fy = y + 2; fy < y + h - 1; fy += 2.6)
        for (const face of [-1, 1]) {
          for (let fx = -w / 2 + 1.2; fx < w / 2 - 0.8; fx += 2.2)
            if (rnd() < 0.55) this.box(x + fx, fy, z + face * (d / 2 + 0.03), 1.1, 1.2, 0.04, rnd() < 0.5 ? [1, 0.85, 0.55] : [0.6, 0.8, 1]);
          for (let fz = -d / 2 + 1.2; fz < d / 2 - 0.8; fz += 2.2)
            if (rnd() < 0.55) this.box(x + face * (w / 2 + 0.03), fy, z + fz, 0.04, 1.2, 1.1, rnd() < 0.5 ? [1, 0.85, 0.55] : [0.6, 0.8, 1]);
        }
    };
    if (def.id === "court") {
      // A giant pickleball complex: courts in the infield, stands, trees, the nets to jump.
      for (let cx = -3; cx <= 3; cx++)
        for (let cz = -1; cz <= 1; cz++) {
          const x = cx * 15,
            z = cz * 17 - 6;
          if (!clear(x, z, 9)) continue;
          this.material(0.15, 0, 0.05);
          this.box(x, -0.04, z, 7.2, 0.03, 14.6, [0.3, 0.52, 0.86]);
          this.box(x, -0.04, z, 9.2, 0.02, 17, [0.2, 0.36, 0.65]);
          this.material(0.2, 0.1);
          for (const lz of [-6.7, -2.1, 2.1, 6.7]) this.box(x, -0.021, z + lz, 6.2, 0.006, 0.07, palette.white);
          for (const lx of [-3.05, 3.05]) this.box(x + lx, -0.021, z, 0.07, 0.006, 13.4, palette.white);
          this.box(x, -0.021, z - 4.4, 0.07, 0.006, 4.6, palette.white);
          this.box(x, -0.021, z + 4.4, 0.07, 0.006, 4.6, palette.white);
          this.material(0.3);
          this.box(x, 0.45, z, 6.6, 0.8, 0.03, [0.1, 0.1, 0.12]);
          this.box(x, 0.88, z, 6.6, 0.06, 0.05, palette.white);
        }
      for (const rp of def.ramps) {
        // Giant net across the road just after the lip (karts fly over it).
        const pt = pointAt(t, rp.at * t.L + rp.len + 2, 0);
        const ry = Math.atan2(t.tx[pt.i], t.tz[pt.i]);
        this.material(0.3);
        for (const side of [-1, 1]) {
          const p = pointAt(t, rp.at * t.L + rp.len + 2, side * (pt.w / 2 + 0.8));
          this.box(p.x, p.y + 1, p.z, 0.3, 2, 0.3, [0.2, 0.2, 0.24]);
        }
        this.box(pt.x, pt.y + 0.55, pt.z, pt.w + 1.6, 0.7, 0.05, [0.08, 0.08, 0.1], 0, 0, ry);
        this.material(0.3, 0.3);
        this.box(pt.x, pt.y + 0.93, pt.z, pt.w + 1.6, 0.1, 0.08, palette.white, 0, 0, ry);
      }
      for (let i = 0; i < 70; i++) {
        const a = rnd() * Math.PI * 2,
          r = 135 + rnd() * 50;
        tree(Math.cos(a) * r, Math.sin(a) * r * 0.8, 1 + rnd() * 0.5);
      }
      for (let i = 0; i < 40; i++) {
        const x = (rnd() * 2 - 1) * 120,
          z = (rnd() * 2 - 1) * 80;
        if (clear(x, z, 4)) tree(x, z, 0.8 + rnd() * 0.4);
      }
      crowd(0, -88, 60, 0, 6);
      crowd(-20, 78, 50, Math.PI, 5);
    } else if (def.id === "neon") {
      // Night city: towers with lit windows and neon strips; the bowling lane section.
      for (let i = 0; i < 70; i++) {
        const x = (rnd() * 2 - 1) * 170,
          z = (rnd() * 2 - 1) * 130;
        if (!clear(x, z, 10)) continue;
        const h = 10 + rnd() * 40;
        building(x, z, 8 + rnd() * 10, 8 + rnd() * 10, h, [0.07 + rnd() * 0.05, 0.06, 0.12 + rnd() * 0.06], 1.4);
        this.material(0.2, 1.8);
        this.box(x, h + 0.2, z, 6, 0.2, 0.2, rnd() < 0.5 ? [1, 0.25, 0.75] : [0.2, 0.85, 1]);
      }
      const lane = def.pins!;
      const a = pointAt(t, lane.at * t.L, 0);
      // Pin-deck arch at the end of the lane and big lane arrows.
      const e = pointAt(t, lane.at * t.L + lane.len + 4, 0);
      const ry = Math.atan2(t.tx[e.i], t.tz[e.i]);
      this.material(0.3, 1.2);
      this.box(e.x, e.y + 7, e.z, e.w + 8, 1.2, 0.6, [1, 0.3, 0.7], 0, 0, ry);
      this.text("SPORTLE", e.x - 4.2 * Math.cos(ry), e.y + 7.8, e.z + 4.2 * Math.sin(ry), 0.2, Math.abs(Math.cos(ry)) > 0.7 ? Math.sign(Math.cos(ry)) : 0, Math.abs(Math.cos(ry)) > 0.7 ? 0 : -Math.sign(Math.sin(ry)), [0.95, 0.95, 1]);
      this.material(0.2, 0.6);
      for (let k = -3; k <= 3; k++) {
        const q = pointAt(t, lane.at * t.L + 12 + Math.abs(k) * 1.5, (k * a.w) / 9);
        this.box(q.x, q.y + 0.014, q.z, 0.3, 0.01, 1.6, [0.15, 0.09, 0.05], 0, 0, Math.atan2(t.tx[q.i], t.tz[q.i]));
      }
    } else if (def.id === "beach") {
      for (let i = 0; i < 80; i++) {
        const x = -170 + rnd() * 260,
          z = (rnd() * 2 - 1) * 120;
        if (clear(x, z, 3) && x < 80) palm(x, z, 0.9 + rnd() * 0.4);
      }
      // Pier posts under the jump and along the boardwalk.
      this.material(0.3);
      for (let i = 0; i < t.n; i += 3) {
        if (t.y[i] < 0.8 && t.ground[i]) continue;
        for (const side of [-1, 1]) {
          const p = this.P(t, i, side * (t.w[i] / 2 - 0.4), 0);
          const h = p[1] + 0.6;
          this.box(p[0], p[1] - h / 2, p[2], 0.35, h, 0.35, [0.42, 0.3, 0.18]);
        }
      }
      // Umbrellas and towels on the sand.
      for (let i = 0; i < 30; i++) {
        const x = -140 + rnd() * 200,
          z = (rnd() * 2 - 1) * 100;
        if (!clear(x, z, 3)) continue;
        const c = [[0.95, 0.3, 0.3], [0.98, 0.8, 0.2], [0.2, 0.6, 0.9], [0.95, 0.5, 0.7]][Math.floor(rnd() * 4)];
        this.material(0.3);
        this.box(x, 1.1, z, 0.08, 2.2, 0.08, palette.white);
        this.blob(x, 2.2, z, 1.4, 0.35, 1.4, c, 0, 3, 8);
        this.box(x + 1.4, -0.05, z, 0.9, 0.02, 1.9, c);
      }
      crowd(-30, -86, 50, 0, 4);
    } else if (def.id === "skyline") {
      // Skyline: buildings under the rooftop sections, garage pillars, the city around.
      for (let i = 0; i < t.n; i += 8) {
        if (!t.ground[i]) continue;
        const y = t.y[i];
        if (y < 0.5) continue;
        const roof = y > 11;
        const p = this.P(t, i, 0, 0);
        const w = t.w[i] + def.verge * 2 + 2;
        // Roof blocks under the track overlap each other: staggered tops, no windows.
        if (roof) building(p[0], p[2], w + 2, w + 2, y - 0.06 - (((i / 8) * 5) % 9) * 0.009, [0.42 - (i % 3) * 0.05, 0.38, 0.36], 0, 0, true);
        else {
          this.material(0.3);
          for (const side of [-1, 1]) {
            const q = this.P(t, i, side * (t.w[i] / 2 + def.verge * 0.5), 0);
            this.box(q[0], y / 2 - 0.3, q[2], 0.7, y - 0.6, 0.7, [0.55, 0.55, 0.58]);
          }
          // Slab under the road.
          const q0 = this.P(t, i, 0, -0.35);
          this.box(q0[0], q0[1], q0[2], w, 0.5, 6, [0.5, 0.5, 0.53], 0, 0, Math.atan2(t.tx[i], t.tz[i]));
        }
      }
      for (let i = 0; i < 90; i++) {
        const x = (rnd() * 2 - 1) * 200,
          z = (rnd() * 2 - 1) * 150;
        if (!clear(x, z, 12)) continue;
        building(x, z, 10 + rnd() * 12, 10 + rnd() * 12, 8 + rnd() * 50, [0.3 + rnd() * 0.2, 0.32, 0.38], 0.5);
      }
    } else if (def.id === "frost") {
      // Snowy mountain: rock and snow under the climbing road, pines, peaks all round.
      for (let i = 0; i < t.n; i += 8) {
        const y = t.y[i];
        if (y < 0.6) continue;
        const p = this.P(t, i, 0, 0);
        const w = t.w[i] + def.verge * 2 + 3;
        building(p[0], p[2], w, w, y - 0.06 - (((i / 8) * 5) % 9) * 0.009, [0.82, 0.86, 0.9], 0, 0, true);
      }
      const pine = (x: number, z: number, s: number) => {
        this.material(0.2);
        this.box(x, 0.6 * s, z, 0.3 * s, 1.2 * s, 0.3 * s, [0.35, 0.24, 0.15]);
        for (let k = 0; k < 3; k++) {
          this.blob(x, (1.4 + k * 1.1) * s, z, (1.5 - k * 0.4) * s, 0.9 * s, (1.5 - k * 0.4) * s, [0.1, 0.3 + k * 0.03, 0.18], 0, 4, 7);
          this.blob(x, (1.75 + k * 1.1) * s, z, (0.9 - k * 0.25) * s, 0.3 * s, (0.9 - k * 0.25) * s, [0.95, 0.97, 1], 0, 3, 7);
        }
      };
      for (let i = 0; i < 90; i++) {
        const x = (rnd() * 2 - 1) * 170,
          z = (rnd() * 2 - 1) * 140;
        if (clear(x, z, 4)) pine(x, z, 0.9 + rnd() * 0.6);
      }
      this.material(0.3, 0, 0.1);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + rnd() * 0.3,
          r = 230 + rnd() * 60,
          h = 50 + rnd() * 60;
        this.blob(Math.cos(a) * r, h * 0.3, Math.sin(a) * r, 55 + rnd() * 30, h, 55 + rnd() * 30, [0.42, 0.45, 0.52], 0, 5, 9);
        this.blob(Math.cos(a) * r, h * 0.3 + h * 0.72, Math.sin(a) * r, 22, h * 0.32, 22, [0.96, 0.97, 1], 0, 4, 9);
      }
    } else if (def.id === "jungle") {
      // Dense jungle: big canopy trees, palms, ferns and mossy rocks; the river under the jump.
      for (let i = 0; i < 110; i++) {
        const x = (rnd() * 2 - 1) * 170,
          z = (rnd() * 2 - 1) * 130;
        if (!clear(x, z, 3)) continue;
        if (rnd() < 0.3) palm(x, z, 0.9 + rnd() * 0.4);
        else {
          const s = 1.2 + rnd() * 0.9;
          this.material(0.2);
          this.box(x, 2 * s, z, 0.5 * s, 4 * s, 0.5 * s, [0.32, 0.22, 0.13]);
          this.blob(x, 5 * s, z, 2.6 * s, 1.8 * s, 2.6 * s, [0.08 + rnd() * 0.06, 0.32 + rnd() * 0.12, 0.1], 0, 5, 8);
        }
      }
      this.material(0.15);
      for (let i = 0; i < 60; i++) {
        const x = (rnd() * 2 - 1) * 150,
          z = (rnd() * 2 - 1) * 110;
        if (clear(x, z, 1)) this.blob(x, 0.2, z, 0.8 + rnd(), 0.5, 0.8 + rnd(), rnd() < 0.5 ? [0.2, 0.5, 0.18] : [0.38, 0.42, 0.34], 0, 3, 6);
      }
    } else if (def.id === "stadium") {
      // An indoor-style stadium: stands with a crowd on every side, floodlight towers.
      crowd(0, -78, 150, 0, 8);
      crowd(0, 78, 150, Math.PI, 8);
      crowd(-142, 0, 90, -Math.PI / 2, 8);
      crowd(142, 0, 90, Math.PI / 2, 8);
      for (const [x, z] of [[-130, -70], [130, -70], [-130, 70], [130, 70]]) {
        this.material(0.4);
        this.box(x, 14, z, 1.2, 28, 1.2, [0.3, 0.3, 0.34]);
        this.material(0.2, 2.2);
        this.box(x, 28.5, z, 6, 2, 1, [1, 0.97, 0.88]);
      }
      this.material(0.2, 1.1);
      this.box(0, 18, -98, 40, 12, 0.6, [0.05, 0.05, 0.08]);
      this.text("SPORTLE KART", -16, 17, -97.6, 0.45, 1, 0, palette.orange);
    } else if (def.id === "canyon") {
      // Red-rock desert: layered mesas, rock spires and cacti; ground under the raised road.
      for (let i = 0; i < t.n; i += 8) {
        const y = t.y[i];
        if (y < 0.6) continue;
        const p = this.P(t, i, 0, 0);
        const w = t.w[i] + def.verge * 2 + 3;
        building(p[0], p[2], w, w, y - 0.06 - (((i / 8) * 5) % 9) * 0.009, [0.74, 0.46, 0.3], 0, 0, true);
      }
      for (let i = 0; i < 24; i++) {
        const x = (rnd() * 2 - 1) * 210,
          z = (rnd() * 2 - 1) * 170;
        if (!clear(x, z, 25)) continue;
        const w = 18 + rnd() * 30,
          h = 12 + rnd() * 30;
        for (let k = 0; k < 3; k++) building(x, z, w - k * 4, w * 0.8 - k * 4, (h * (k + 1)) / 3, [0.72 - k * 0.07, 0.38 + k * 0.03, 0.24], 0, 0, true);
      }
      for (let i = 0; i < 70; i++) {
        const x = (rnd() * 2 - 1) * 160,
          z = (rnd() * 2 - 1) * 120;
        if (!clear(x, z, 3)) continue;
        this.material(0.2);
        const h = 2 + rnd() * 2.5;
        this.box(x, h / 2, z, 0.5, h, 0.5, [0.25, 0.5, 0.25]);
        this.box(x + 0.55, h * 0.6, z, 0.4, 1.2, 0.4, [0.25, 0.5, 0.25]);
        this.box(x - 0.55, h * 0.45, z, 0.4, 1, 0.4, [0.25, 0.5, 0.25]);
      }
    }
  }
  // ——————————————————————————— Dynamic ———————————————————————————
  /** Apply a rotation (yaw about y, then pitch/roll) and move vertices [from, end) into place. */
  place(from: number, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0, scale = 1, recolor?: [V, V]) {
    const v = this.vertices;
    const cy = Math.cos(yaw),
      sy = Math.sin(yaw),
      cp = Math.cos(pitch),
      sp = Math.sin(pitch),
      cr = Math.cos(roll),
      sr = Math.sin(roll);
    const rot = (a: number, b: number, c: number, s: number): [number, number, number] => {
      // Local frame: +x forward, +y up, +z right. Roll about x, then pitch about z, then yaw.
      let px = a * s,
        py = b * s,
        pz = c * s;
      const ry = py * cr - pz * sr;
      pz = py * sr + pz * cr;
      py = ry;
      const rx = px * cp - py * sp;
      py = px * sp + py * cp;
      px = rx;
      return [px * cy - pz * sy, py, px * sy + pz * cy];
    };
    for (let k = from; k < v.length; k += 13) {
      const p = rot(v[k], v[k + 1], v[k + 2], scale);
      v[k] = p[0] + x;
      v[k + 1] = p[1] + y;
      v[k + 2] = p[2] + z;
      const n = rot(v[k + 3], v[k + 4], v[k + 5], 1);
      v[k + 3] = n[0];
      v[k + 4] = n[1];
      v[k + 5] = n[2];
      if (recolor && Math.abs(v[k + 6] - recolor[0][0]) < 0.002 && Math.abs(v[k + 7] - recolor[0][1]) < 0.002 && Math.abs(v[k + 8] - recolor[0][2]) < 0.002) {
        v[k + 6] = recolor[1][0];
        v[k + 7] = recolor[1][1];
        v[k + 8] = recolor[1][2];
      }
    }
  }
  /** A kart with its driver, built at the origin (+x forward) then placed. */
  kartModel(r: Racer, pos: { x: number; y: number; z: number; h: number }, now: number, hideDriver = false) {
    const from = this.vertices.length;
    const col = paint(r);
    const dark: V = [0.08, 0.08, 0.1];
    const spin = (now / 1000) * Math.max(0, r.v) * 2.5;
    // Wheels.
    this.material(0.3, 0, 0);
    for (const [wx, wz, rad] of [
      [0.75, 0.62, 0.26],
      [0.75, -0.62, 0.26],
      [-0.72, 0.66, 0.3],
      [-0.72, -0.66, 0.3],
    ]) {
      this.blob(wx, rad, wz, rad, rad, 0.16, dark, 0, 6, 10);
      this.box(wx, rad, wz + Math.sign(wz) * 0.17, rad * 1.2, 0.07, 0.02, [0.6, 0.6, 0.65], 0, spin, 0);
    }
    this.material(0.7, 0, 0.25);
    if (r.body === "paddle") {
      // A pickleball paddle as the chassis, handle pointing back.
      this.blob(0.15, 0.36, 0, 1.05, 0.12, 0.72, col, 0, 4, 16);
      this.box(-1.05, 0.36, 0, 0.7, 0.14, 0.2, [0.12, 0.12, 0.14]);
      this.material(0.5, 0.15);
      this.blob(0.15, 0.43, 0, 0.95, 0.04, 0.64, palette.white.map((c) => c * 0.9), 0, 2, 16);
      this.blob(0.15, 0.45, 0, 0.85, 0.04, 0.56, col, 0, 2, 16);
    } else if (r.body === "roller") {
      // A bowling ball body with finger holes, the driver sitting in a cut-out on top.
      this.blob(-0.1, 0.62, 0, 0.72, 0.5, 0.62, col, 0, 10, 16);
      this.material(0.2);
      for (const [hx, hz] of [
        [0.45, -0.18],
        [0.5, 0.12],
        [0.3, 0.02],
      ])
        this.blob(hx, 0.98, hz, 0.07, 0.03, 0.07, [0.03, 0.03, 0.04], 0, 2, 8);
      this.material(0.4);
      this.box(0.9, 0.32, 0, 0.3, 0.16, 1.3, [0.15, 0.15, 0.18]);
    } else {
      // Classic go-kart: low frame, side pods, nose and a rear wing.
      this.box(0, 0.24, 0, 2.0, 0.14, 1.05, dark);
      this.box(0.15, 0.36, 0, 1.7, 0.16, 0.85, col);
      this.box(1.05, 0.32, 0, 0.45, 0.2, 1.2, col);
      for (const s of [-1, 1]) this.box(-0.1, 0.38, s * 0.62, 1.0, 0.22, 0.24, col);
      this.box(-1.05, 0.75, 0, 0.12, 0.5, 0.12, dark);
      this.box(-1.1, 1.02, 0, 0.36, 0.06, 1.3, col);
    }
    // Steering wheel in front of the driver.
    this.material(0.4);
    this.box(0.42, 0.82, 0, 0.06, 0.3, 0.32, dark, 0, 0.35, 0);
    // Exhaust and a number board.
    this.box(-0.95, 0.42, -0.35, 0.3, 0.1, 0.1, [0.5, 0.5, 0.55]);
    const driverFrom = this.vertices.length;
    if (!hideDriver) {
      this.material(0.55);
      this.mascotBody(
        { team: 0, hand: "right", bot: !!r.bot, id: r.id, outfit: r.outfit, gear: r.gear },
        { x: 0, y: 0, z: 0 },
        { swing: 0, pitch: 0, roll: 0, yaw: 0, moving: 0, server: false, owner: false, cheer: r.finished ? 1 : 0, bowl: { arm: 1.15, ball: null } },
      );
      // The character faces -z: turn it to face +x, sit it down and shrink it into the seat.
      this.place(driverFrom, -0.15, r.body === "roller" ? 0.42 : 0.02, 0, Math.PI / 2, 0, 0, 0.62, [palette.blue, col]);
    }
    const nose = pos.h + r.yaw;
    this.place(from, pos.x, pos.y, pos.z, nose, 0, r.tilt + (r.air ? 0 : 0));
    this.material(0.15);
  }
  /** Glow effects (additive): drift sparks, boost flames, shields, sweet spot. */
  kartFx(r: Racer, pos: { x: number; y: number; z: number; h: number }, now: number) {
    const keep = this.vertices;
    this.vertices = this.fxv;
    const c = Math.cos(pos.h + r.yaw),
      s = Math.sin(pos.h + r.yaw);
    const at = (fx: number, fz: number, y: number): [number, number, number] => [pos.x + c * fx - s * fz, pos.y + y, pos.z + s * fx + c * fz];
    if (r.drift && r.charge > 0.25 && !r.air) {
      const lvl = driftLevel(r.charge);
      const col = lvl ? SPARK[lvl - 1] : [1, 1, 0.8];
      this.mat = [0, 2.2, 0.6, 0];
      for (const side of [-1, 1])
        for (let k = 0; k < 3; k++) {
          const j = Math.sin(now / 23 + k * 2 + side) * 0.12;
          const p = at(-0.9 - k * 0.15, side * 0.62 + j, 0.12 + Math.abs(j));
          this.blob(p[0], p[1], p[2], 0.09 + lvl * 0.03, 0.06, 0.09, col, 0, 2, 5);
        }
    }
    if (r.boost > 0) {
      this.mat = [0, 2.6, 0.8, 0];
      const len = 0.5 + Math.sin(now / 30) * 0.12 + Math.min(1, r.boost) * 0.4;
      const p = at(-1.2 - len / 2, -0.35, 0.42);
      this.blob(p[0], p[1], p[2], len / 2, 0.12, 0.12, [1, 0.6, 0.2], 0, 3, 6);
    }
    if (r.guard > 0) {
      // A paddle orbiting the kart.
      this.mat = [0, 1.6, 0.6, 0];
      const a = now / 140;
      const p = at(Math.cos(a) * 1.5, Math.sin(a) * 1.5, 0.9);
      this.blob(p[0], p[1], p[2], 0.35, 0.45, 0.35, [0.3, 0.75, 1], 0, 3, 8);
    }
    if (r.sweet > 0) {
      this.mat = [0, 1.2 + Math.sin(now / 80) * 0.4, 0.4, 0];
      this.blob(pos.x, pos.y + 0.8, pos.z, 1.5, 1.0, 1.5, [1, 0.85, 0.3], 0, 4, 10);
    }
    if (r.net > 0) {
      this.mat = [0, 0.8, 0.5, 0];
      this.blob(pos.x, pos.y + 1, pos.z, 1.2, 0.9, 1.2, [0.85, 0.85, 0.9], 0, 3, 8);
    }
    this.vertices = keep;
    this.material(0.15);
  }
  shotModel(sh: Shot, now: number) {
    if (sh.kind === "dink" || sh.kind === "serve" || sh.kind === "mball") {
      this.material(0.3, 0.6);
      this.blob(sh.x, sh.y, sh.z, sh.r, sh.r, sh.r, palette.ball, 0, 6, 8);
    } else if (sh.kind === "pinbowl" || sh.kind === "strike") {
      this.material(0.9, 0.05, 0.3);
      const r = sh.r;
      this.blob(sh.x, sh.y, sh.z, r, r, r, sh.kind === "strike" ? [0.55, 0.2, 0.95] : [0.85, 0.2, 0.3], 0, 10, 14);
      this.material(0.2);
      const a = now / 120;
      for (const o of [0, 0.5, -0.5]) this.blob(sh.x + Math.cos(sh.h + o) * r * 0.85, sh.y + Math.cos(a + o) * r * 0.5, sh.z + Math.sin(sh.h + o) * r * 0.85, r * 0.15, r * 0.15, r * 0.15, [0.04, 0.04, 0.05], 0, 3, 5);
    } else if (sh.kind === "fence") {
      this.material(0.6, 0.05, 0.15);
      this.blob(sh.x, sh.y + 0.55, sh.z, 0.28, 0.55, 0.28, palette.white, 0, 6, 10);
      this.blob(sh.x, sh.y + 1.2, sh.z, 0.16, 0.2, 0.16, palette.white, 0, 5, 8);
      this.box(sh.x, sh.y + 0.98, sh.z, 0.3, 0.06, 0.3, palette.red);
    } else if (sh.kind === "net") {
      this.material(0.3, 0.3);
      this.blob(sh.x, sh.y, sh.z, 1.1, 0.12, 1.1, [0.85, 0.85, 0.9], 0, 2, 10);
    } else if (sh.kind === "machine") {
      this.material(0.4, 0.2);
      this.box(sh.x, sh.y + 0.6, sh.z, 1.2, 1.2, 1.2, [0.2, 0.6, 0.35]);
      this.blob(sh.x, sh.y + 1.4, sh.z, 0.5, 0.4, 0.5, palette.ball, 0, 4, 8);
      this.box(sh.x, sh.y + 0.9, sh.z, 1.6, 0.3, 0.3, [0.15, 0.15, 0.18], 0, 0, sh.h + Math.PI / 2);
    } else if (sh.kind === "wave") {
      // Rows of fans rising and falling across the road.
      const keep = this.vertices;
      this.vertices = this.fxv;
      this.mat = [0, 1.4, 0.7, 0];
      for (let k = -4; k <= 4; k++) {
        const ox = Math.cos(sh.h + Math.PI / 2) * k * (sh.r / 4),
          oz = Math.sin(sh.h + Math.PI / 2) * k * (sh.r / 4);
        this.blob(sh.x + ox, sh.y + 1 + Math.sin(now / 90 + k) * 0.5, sh.z + oz, 0.5, 0.9, 0.5, [palette.blue, palette.orange, palette.red][(k + 9) % 3], 0, 3, 6);
      }
      this.vertices = keep;
    }
    this.material(0.15);
  }
  /** Interpolated racers: extrapolate from the latest snapshot with each kart's speed. */
  positions(now: number) {
    const last = this.snaps[this.snaps.length - 1];
    const out = new Map<string, { x: number; y: number; z: number; h: number }>();
    if (!last) return out;
    const ahead = Math.min(0.1, (now - last.at) / 1000);
    for (const r of last.k.racers) {
      const moving = last.k.phase === "race" && !r.lift && !last.k.paused;
      const goal = {
        x: r.x + (moving ? Math.cos(r.h) * r.v * ahead : 0),
        y: r.y,
        z: r.z + (moving ? Math.sin(r.h) * r.v * ahead : 0),
        h: r.h,
      };
      const prev = this.shown.get(r.id);
      let p = goal;
      if (prev && Math.hypot(prev.x - goal.x, prev.z - goal.z) < 6) {
        const k = 0.45;
        p = { x: lerp(prev.x, goal.x, k), y: lerp(prev.y, goal.y, k), z: lerp(prev.z, goal.z, k), h: prev.h + angle(goal.h - prev.h) * k };
      }
      this.shown.set(r.id, p);
      out.set(r.id, p);
    }
    return out;
  }
  /** Camera for one view: chase, bumper or trackside broadcast; shared view follows the leader. */
  camFor(key: string, r: Racer | undefined, pos: { x: number; y: number; z: number; h: number } | undefined, t: Track, now: number, dt: number): Cam {
    const k = this.kart;
    let goal: Cam;
    if (!k || !r || !pos || k.phase === "lobby") {
      // Menu: a slow orbit over the start straight.
      const a = now / 14000;
      const p = pointAt(t, t.S0, 0);
      goal = { eye: [p.x + Math.cos(a) * 34, p.y + 14, p.z + Math.sin(a) * 34], target: [p.x, p.y + 1, p.z], fov: 50 };
      this.cams.set(key, goal);
      return goal;
    }
    const mode = key === "shared" && this.viewMode2 === "bumper" ? "chase" : this.viewMode2;
    const c = Math.cos(pos.h),
      s = Math.sin(pos.h);
    if (r.lift) {
      goal = { eye: [pos.x - c * 9, pos.y + 6, pos.z - s * 9], target: [pos.x, pos.y + 1, pos.z], fov: 55 };
    } else if (mode === "bumper") {
      goal = { eye: [pos.x + c * 0.95, pos.y + 1.15, pos.z + s * 0.95], target: [pos.x + c * 12, pos.y + 0.9, pos.z + s * 12], fov: 72 };
    } else if (mode === "broadcast") {
      // Trackside camera posts every ~60 m, high and wide; the nearest one films the kart.
      const step = 60;
      const at = Math.round(r.s / step) * step;
      const side = Math.floor(at / step) % 2 ? 1 : -1;
      const post = pointAt(t, at + 18, side * (pointAt(t, at, 0).w / 2 + t.def.verge + 10));
      // Above any other level of the track or terrain near the post.
      const top = Math.max(post.y, roadTop(t, post.x, post.z));
      goal = { eye: [post.x, top + 8, post.z], target: [pos.x, pos.y + 0.8, pos.z], fov: 38 };
    } else {
      const far = key === "shared" ? 1.5 : 1;
      const boost = r.boost > 0 ? 0.6 : 0;
      goal = {
        eye: [pos.x - c * (6.3 + boost) * far, pos.y + 2.5 * far, pos.z - s * (6.3 + boost) * far],
        target: [pos.x + c * 4, pos.y + 1, pos.z + s * 4],
        fov: 62 + boost * 8,
      };
    }
    const prev = this.cams.get(key);
    if (prev && mode !== "broadcast") {
      const e = 1 - Math.exp(-dt * (mode === "bumper" ? 30 : 7));
      goal = {
        eye: prev.eye.map((v, i) => lerp(v, goal.eye[i], e)),
        target: prev.target.map((v, i) => lerp(v, goal.target[i], Math.min(1, e * 1.6))),
        fov: lerp(prev.fov, goal.fov, e),
      };
    } else if (prev && mode === "broadcast") {
      const e = 1 - Math.exp(-dt * 6);
      const jump = Math.hypot(prev.eye[0] - goal.eye[0], prev.eye[2] - goal.eye[2]) > 30;
      if (!jump) goal = { eye: goal.eye, target: prev.target.map((v, i) => lerp(v, goal.target[i], e)), fov: goal.fov };
    }
    // Chase cameras never leave the road corridor (no clipping into walls, rock or buildings).
    if (mode === "chase" && !r.lift) {
      const from = [pos.x, pos.y + 1.2, pos.z];
      const f = cameraReach(t, r.s, from, goal.eye);
      if (f < 1) goal = { ...goal, eye: goal.eye.map((v, i) => from[i] + (v - from[i]) * f) };
    }
    this.cams.set(key, goal);
    return goal;
  }
  lastFrame2 = 0;
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
    const dt = Math.min(0.1, (now - this.lastFrame2) / 1000 || 0.016);
    this.lastFrame2 = now;
    const t = track(this.trackId ?? "court");
    const k = this.kart;
    this.vertices = [];
    this.fxv = [];
    this.decals = [];
    let pos = this.positions(now);
    let racers = k?.racers ?? [];
    // Finish-line slow motion: replay the last two seconds at a third of the speed.
    let replaying = false;
    if (this.replay) {
      const age = now - this.replay.start;
      const fr = this.replay.frames;
      if (age > 3400 || !fr.length) this.replay = null;
      else {
        const span = fr[fr.length - 1].at - fr[0].at;
        const at = fr[0].at + Math.min(span, age * 0.36 + Math.max(0, span - 1300));
        const f = fr.find((q) => q.at >= at) ?? fr[fr.length - 1];
        racers = f.racers;
        pos = new Map(racers.map((r) => [r.id, { x: r.x, y: r.y, z: r.z, h: r.h }]));
        replaying = true;
      }
    }
    // Karts, drivers and their effects.
    const views = this.shared || !this.local.length ? ["shared"] : this.local.slice(0, 4);
    const bumperOwn = this.viewMode2 === "bumper" && views.length === 1 && views[0] !== "shared" ? views[0] : "";
    for (const r of racers) {
      const p = pos.get(r.id);
      if (!p) continue;
      if (r.lift > 0) {
        // The pickup drone carries the kart up and over.
        const lift = (1.5 - r.lift) / 1.5;
        const lp = { ...p, y: p.y + 2 + lift * 3 };
        this.kartModel(r, lp, now);
        this.material(0.4, 0.4);
        this.box(lp.x, lp.y + 2.4, lp.z, 1.6, 0.25, 1.6, [0.2, 0.2, 0.24]);
        for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) this.blob(lp.x + a * 0.9, lp.y + 2.6, lp.z + b * 0.9, 0.5, 0.03, 0.5, [0.7, 0.9, 1], 0, 2, 8);
        this.box(lp.x, lp.y + 1.7, lp.z, 0.05, 1.2, 0.05, [0.1, 0.1, 0.1]);
        continue;
      }
      this.kartModel(r, p, now, r.id === bumperOwn && !replaying);
      this.kartFx(r, p, now);
      if (!r.bot || r.botFor) this.tags.push({ id: r.id, name: r.name, team: 0, x: p.x, y: p.y + 2.1, z: p.z });
    }
    if (k && !replaying) {
      for (const sh of k.shots) this.shotModel(sh, now);
      // Item cubes: glowing, spinning, bobbing.
      for (const c of k.cubes) {
        if (!c.up) continue;
        const pt = pointAt(t, c.s, c.d);
        const a = now / 600 + c.s;
        const y = pt.y + 1.1 + Math.sin(now / 300 + c.d) * 0.15;
        this.material(0.6, 0.5, 0.2);
        const hue = [palette.orange, palette.blue, [0.95, 0.3, 0.62], palette.gold][Math.floor(now / 400 + c.s) % 4];
        this.box(pt.x, y, pt.z, 0.95, 0.95, 0.95, hue, a * 0.7, a * 0.5, a);
        this.material(0.2, 1.4);
        this.box(pt.x, y, pt.z, 0.5, 0.5, 0.5, palette.white, a * 0.7, a * 0.5, a);
      }
      // Neon Lanes: the giant moving pins.
      const pinDef = t.def.pins;
      if (pinDef)
        k.pins.forEach((d, n) => {
          const s = pinDef.at * t.L + ((n + 0.5) * pinDef.len) / pinDef.n;
          const pt = pointAt(t, s, d);
          this.material(0.6, 0.05, 0.2);
          this.blob(pt.x, pt.y + 1.4, pt.z, 1.0, 1.4, 1.0, palette.white, 0, 8, 12);
          this.blob(pt.x, pt.y + 3.4, pt.z, 0.55, 0.75, 0.55, palette.white, 0, 6, 10);
          this.material(0.3, 0.4);
          this.blob(pt.x, pt.y + 2.75, pt.z, 0.62, 0.12, 0.62, palette.red, 0, 2, 10);
        });
      // LED boards on the gantries: the top three.
      const top = [...k.racers].sort((a, b) => a.place - b.place).slice(0, 3);
      const msg = k.phase === "countdown" ? "GET READY" : top.map((r) => `${r.place} ${r.name.toUpperCase().slice(0, 6)}`).join("  ");
      for (const g of t.def.gantries) {
        const pt = pointAt(t, g * t.L, 0);
        // On the face toward the oncoming karts, along the board whatever its angle, sized to fit.
        this.material(0.1, 2);
        this.ledText(msg, pt.x - t.tx[pt.i] * 0.27, pt.y + 6.6, pt.z - t.tz[pt.i] * 0.27, -t.tz[pt.i], t.tx[pt.i], ledSize(msg, boardWidth(t, g)), palette.gold);
        this.material(0.15);
      }
      // Time trial ghost: the best lap, glowing.
      if (this.ghost && k.mode === "trial" && k.phase === "race") {
        const tt = (now - this.ghostStart) / 1000;
        const g = this.ghost;
        for (let q = 0; q + 5 < g.length; q += 5)
          if (g[q + 5] >= tt) {
            const f = clamp((tt - g[q]) / (g[q + 5] - g[q] || 1), 0, 1);
            const gx = lerp(g[q + 1], g[q + 6], f),
              gy = lerp(g[q + 2], g[q + 7], f),
              gz = lerp(g[q + 3], g[q + 8], f),
              gh = g[q + 4] + angle(g[q + 9] - g[q + 4]) * f;
            const keep = this.vertices;
            this.vertices = this.fxv;
            this.mat = [0, 0.9, 0.7, 0];
            this.blob(gx + Math.cos(gh) * 0.2, gy + 0.6, gz + Math.sin(gh) * 0.2, 1.2, 0.5, 1.2, [0.5, 0.8, 1], 0, 4, 10);
            this.vertices = keep;
            break;
          }
      }
    }
    this.material(0.15);
    const light = this.lighting();
    const dyn = new Float32Array(this.vertices);
    const fx = new Float32Array(this.fxv);
    // Views: one per local driver (split screen) or one shared.
    const rects: { id: string; x: number; y: number; w: number; h: number }[] = [];
    const n = views.length;
    const draws: ViewDraw[] = [];
    const seen = new Set<string>();
    const leader = racers.find((r) => r.place === 1);
    let speedSum = 0,
      speedN = 0;
    views.forEach((id, idx) => {
      // Pixel rect (origin bottom-left): 2 = side by side, 3-4 = quadrants.
      let vx = 0,
        vy = 0,
        vw = w,
        vh = h;
      if (n === 2) {
        vw = Math.floor(w / 2) - 1;
        vx = idx ? w - vw : 0;
      } else if (n >= 3) {
        vw = Math.floor(w / 2) - 1;
        vh = Math.floor(h / 2) - 1;
        vx = idx % 2 ? w - vw : 0;
        vy = idx < 2 ? h - vh : 0;
      }
      const follow = id === "shared" ? (this.replay ? racers.find((r) => r.id === this.replay!.id) : leader) : racers.find((r) => r.id === id);
      const fp = follow ? pos.get(follow.id) : undefined;
      if (follow && follow.v) {
        speedSum += Math.abs(follow.v);
        speedN++;
      }
      let cam = this.camFor(id, follow, fp, t, now, dt);
      if (replaying && fp) {
        const a = (now - this.replay!.start) / 2600;
        cam = { eye: [fp.x + Math.cos(fp.h + 1.2 + a) * 7, fp.y + 2.2, fp.z + Math.sin(fp.h + 1.2 + a) * 7], target: [fp.x, fp.y + 0.8, fp.z], fov: 46 };
      }
      const vp = camera(vw / Math.max(1, vh), cam.eye, cam.target, cam.fov, 0);
      const cw = canvas.clientWidth,
        ch = canvas.clientHeight;
      const ox = (vx / w) * cw,
        oy = ch - ((vy + vh) / h) * ch;
      this.placeTagsIn(vp, ox, oy, (vw / w) * cw, (vh / h) * ch, idx, seen, id);
      rects.push({ id, x: ox, y: oy, w: (vw / w) * cw, h: (vh / h) * ch });
      draws.push({ rect: [vx, vy, vw, vh], vp, eye: cam.eye, dynamic: dyn, fx, decals: this.decals });
    });
    this.view = { eye: this.cams.get(views[0])?.eye ?? [0, 10, 10], target: this.cams.get(views[0])?.target ?? [0, 0, 0], fov: 60, shift: 0 };
    this.gl.frame(w, h, light, draws, this.postFx(now), now / 1000);
    for (const [key, el] of this.tagEls) if (!seen.has(key)) el.style.display = "none";
    this.tags = [];
    this.onViews(rects);
    this.engineHum(speedN ? speedSum / speedN : 0, !!k && (k.phase === "race" || k.phase === "countdown") && !k.paused);
  };
  /** Name tags inside one view rectangle (CSS pixels, origin top-left). */
  placeTagsIn(vp: V, ox: number, oy: number, cw: number, ch: number, pass: number, seen: Set<string>, own: string) {
    for (const t of this.tags) {
      if (t.id === own) continue;
      const cx = vp[0] * t.x + vp[4] * t.y + vp[8] * t.z + vp[12],
        cy = vp[1] * t.x + vp[5] * t.y + vp[9] * t.z + vp[13],
        cw4 = vp[3] * t.x + vp[7] * t.y + vp[11] * t.z + vp[15];
      if (cw4 <= 0.5 || cw4 > 70) continue;
      const sx = ox + ((cx / cw4 + 1) / 2) * cw,
        sy = oy + ((1 - cy / cw4) / 2) * ch;
      if (sx < ox || sx > ox + cw || sy < oy || sy > oy + ch) continue;
      const key = t.id + "@" + pass;
      let el = this.tagEls.get(key);
      if (!el) {
        el = document.createElement("div");
        this.tagLayer.appendChild(el);
        this.tagEls.set(key, el);
      }
      if (el.textContent !== t.name) el.textContent = t.name;
      if (el.className !== "nametag team0") el.className = "nametag team0";
      const scale = Math.max(0.55, Math.min(1, 12 / cw4));
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(2)})`;
      el.style.display = "";
      seen.add(key);
    }
  }
  /** Pixel text centred at (x, y, z), reading along (dx, dz) (any angle), facing along the road. */
  ledText(msg: string, x: number, y: number, z: number, dx: number, dz: number, size: number, col: number[]) {
    let units = 0;
    for (const ch of msg) units += ch === " " ? 3 : (GLYPHS[ch]?.[0].length ?? 5) + 1;
    let cursor = -units / 2;
    const ry = Math.atan2(dz, -dx); // the box's local x runs along the reading direction
    for (const ch of msg) {
      if (ch === " ") {
        cursor += 3;
        continue;
      }
      const g = GLYPHS[ch];
      if (!g) {
        cursor += 6;
        continue;
      }
      g.forEach((row, r) =>
        [...row].forEach((bit, c) => {
          if (bit !== "1") return;
          const u = (cursor + c + 0.5 + (6 - r) * 0.22) * size;
          this.box(x + dx * u, y + (3 - r) * size, z + dz * u, size * 0.92, size * 0.92, 0.03, col, 0, 0, ry);
        }),
      );
      cursor += g[0].length + 1;
    }
  }
  /** Start the slow-motion finish replay for a driver. */
  finishReplay(id: string) {
    if (this.replay) return;
    this.replay = { id, start: performance.now(), frames: this.tape.slice() };
  }
}
export { DRIFT_LEVELS };
