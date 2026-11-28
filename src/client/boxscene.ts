/**
 * Sportle Boxing's 3D view. Reuses the pickleball Scene (WebGL2 renderer, lighting, shadows,
 * bloom, box/blob/text builders, capsule characters, sounds, name tags) and draws a ring,
 * its venue and the fighters with big padded gloves. Positions and every outcome come from the
 * server's snapshots; the client only animates them (punch arcs from the punch's progress,
 * squash and stretch on hits, slips, ducks, knockdowns and stars).
 */
import { Scene, camera, palette } from "./scene.ts";
import { buildMap, lightingFor } from "./maps.ts";
import type { Lighting, Spot, ViewDraw } from "./renderer.ts";
import { GLYPHS } from "./scene.ts";
import { PUNCH, RING, botDef } from "../shared/boxing.ts";
import type { Box, Fighter, HitEvent, Punch, RingId } from "../shared/boxing.ts";
import { PADDLES, clamp } from "../shared/types.ts";

type V = number[];
export type BoxView = "behind" | "broadcast";
export const BOX_VIEW_LABELS: Record<BoxView, string> = { behind: "Behind you", broadcast: "Broadcast" };
const lin = (c: V): [number, number, number] => [c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2];
const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);
const spot = (pos: [number, number, number], at: [number, number, number], color: [number, number, number], outer = 30, range = 16): Spot => ({
  pos,
  dir: unit(at[0] - pos[0], at[1] - pos[1], at[2] - pos[2]),
  color,
  inner: outer * 0.5,
  outer,
  range,
});
/** Spots over the ring from the lighting truss. */
const ringSpots = (c: [number, number, number], k = 1) => [
  spot([-2.4, 6.5, 2.4], [0.3, 0, -0.3], [c[0] * k, c[1] * k, c[2] * k], 34),
  spot([2.4, 6.5, -2.4], [-0.3, 0, 0.3], [c[0] * k, c[1] * k, c[2] * k], 34),
  spot([0, 7.2, 0], [0, 0, 0], [c[0] * 0.8 * k, c[1] * 0.8 * k, c[2] * 0.8 * k], 26, 12),
];
export function ringLight(id: RingId): Lighting {
  if (id === "rooftop") {
    const l = lightingFor("nyc");
    return { ...l, spots: ringSpots([1.3, 1.25, 1.15], 1) };
  }
  if (id === "neon")
    return {
      sky: lin([0.03, 0.02, 0.06]),
      fogNear: 14,
      fogFar: 40,
      sunDir: unit(0.2, -1, -0.3),
      sunColor: [0.2, 0.16, 0.3],
      skyAmb: [0.1, 0.06, 0.16],
      groundAmb: [0.06, 0.02, 0.07],
      spots: ringSpots([1.5, 1.25, 1.6]),
      exposure: 1.35,
      bloom: 0.14,
    };
  return {
    sky: lin([0.03, 0.03, 0.06]),
    fogNear: 22,
    fogFar: 70,
    sunDir: unit(0.32, -1, 0.42),
    sunColor: [0.3, 0.28, 0.28],
    skyAmb: [0.1, 0.1, 0.16],
    groundAmb: [0.06, 0.03, 0.04],
    spots: ringSpots([1.5, 1.42, 1.3]),
    exposure: 1.2,
    bloom: 0.08,
  };
}
const RING_LOOK: Record<RingId, { canvas: V; apron: V; rope: V[]; post: V; floor: V; logo: V; neon: number }> = {
  neon: { canvas: [0.16, 0.1, 0.26], apron: [0.1, 0.06, 0.18], rope: [[1, 0.25, 0.75], [0.2, 0.85, 1], [1, 0.25, 0.75]], post: [0.12, 0.12, 0.16], floor: [0.06, 0.03, 0.09], logo: [0.25, 0.14, 0.4], neon: 1.4 },
  arena: { canvas: [0.66, 0.66, 0.66], apron: [0.12, 0.16, 0.32], rope: [[0.86, 0.17, 0.27], palette.white, [0.33, 0.66, 0.98]], post: [0.7, 0.7, 0.74], floor: [0.05, 0.05, 0.08], logo: [0.8, 0.7, 0.5], neon: 0 },
  rooftop: { canvas: [0.3, 0.55, 0.85], apron: [0.95, 0.52, 0.16], rope: [palette.white, palette.white, palette.white], post: [0.2, 0.2, 0.24], floor: [0.3, 0.3, 0.32], logo: [0.38, 0.62, 0.9], neon: 0 },
};
/** Ring height above the venue floor (the canvas is at y = 0). */
const DECK = 0.9;
const H = RING.half;
/** A 3×3 matrix applied to a run of vertices around a pivot (squash, lean, fall). */
type M3 = number[];
const mul = (a: M3, b: M3): M3 => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
const scaleM = (x: number, y: number, z: number): M3 => [x, 0, 0, 0, y, 0, 0, 0, z];
/** Rotation by `a` about the unit axis `u`. */
const rotM = (u: V, a: number): M3 => {
  const c = Math.cos(a),
    s = Math.sin(a),
    t = 1 - c;
  const [x, y, z] = u;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
};
/** Rest positions of a fighter's gloves in their own frame (x right, y up, z forward): stance and guard. */
export const REST_GLOVES: { stance: V[]; guard: V[] } = {
  stance: [
    [0.3, 1.05, 0.3],
    [-0.3, 1.1, 0.34],
  ],
  guard: [
    [0.18, 1.38, 0.18],
    [-0.18, 1.38, 0.18],
  ],
};
export const GLOVE_R = 0.17;
/** The "behind you" camera in a fighter's own frame: over the left shoulder, up high. */
export const BEHIND = { side: -0.8, up: 2.7, back: 1.3, look: 1.2, fov: 56 };
/**
 * The "behind you" camera: up and over the shoulder, so your own see-through fighter and gloves
 * sit low and to one side while the opponent's head, body and gloves stay clear in the middle
 * (scripts/tests check this by projecting both). Slips and ducks move it with you.
 */
export function behindCam(s: { x: number; z: number; facing: number }, os: { x: number; z: number }, dodge: string) {
  const lean = dodge === "left" ? -0.25 : dodge === "right" ? 0.25 : 0;
  const duck = dodge === "duck" ? 0.25 : 0;
  const eye: V = [s.x + s.facing * (BEHIND.side + lean), BEHIND.up - duck, s.z + BEHIND.back * s.facing];
  return { eye, target: [os.x * 0.85 + s.x * 0.15, BEHIND.look - duck * 0.5, os.z], fov: BEHIND.fov };
}
/** Per-fighter animation state on this screen. */
type Anim = { hitAt: number; hitPow: number; hitDir: number; blockAt: number; downAt: number; upAt: number; lastPunch: Punch | null; lastPunchAt: number };
export class BoxScene extends Scene {
  ringId: RingId = "neon";
  bout: Box | null = null;
  snapAt = 0;
  viewMode2: BoxView = "behind";
  /** This screen's fighters (one view each; empty = one broadcast view). */
  local: string[] = [];
  anims = new Map<string, Anim>();
  lastHit = 0;
  lastPhase = "";
  lastCount = 0;
  /** Big hits flash the arena's camera bulbs. */
  flashes: { at: number; x: number; y: number; z: number }[] = [];
  onViews: (rects: { id: string; x: number; y: number; w: number; h: number }[]) => void = () => {};
  onHit: (h: HitEvent) => void = () => {};
  setRing(id: RingId) {
    if (id === this.ringId) return;
    this.ringId = id;
    this.build();
  }
  anim(id: string): Anim {
    let a = this.anims.get(id);
    if (!a) {
      a = { hitAt: -1e9, hitPow: 0, hitDir: 0, blockAt: -1e9, downAt: -1e9, upAt: -1e9, lastPunch: null, lastPunchAt: 0 };
      this.anims.set(id, a);
    }
    return a;
  }
  update(b: Box | any) {
    const box = b as Box;
    const now = performance.now();
    if (box.ring !== this.ringId) this.setRing(box.ring);
    // New hits: reactions, sparks, sounds.
    for (const h of box.hits) {
      if (h.at <= this.lastHit) continue;
      this.lastHit = h.at;
      if (!this.bout) continue; // first snapshot: old hits already happened
      this.hitFx(box, h, now);
      this.onHit(h);
    }
    if (!this.bout) this.lastHit = Math.max(0, ...box.hits.map((h) => h.at));
    for (const f of box.fighters) {
      const a = this.anim(f.id);
      const was = this.bout?.fighters.find((q) => q.id === f.id);
      if (f.punch && (!a.lastPunch || a.lastPunch.id !== f.punch.id)) {
        a.lastPunch = f.punch;
        a.lastPunchAt = now - f.punch.t * 1000;
        this.whoosh(f.punch.type);
      } else if (f.punch) a.lastPunch = f.punch;
      if (was && was.hp > 0 && f.hp <= 0) a.downAt = now;
      if (was && was.hp <= 0 && f.hp > 0) a.upAt = now;
    }
    // Bell at the start and end of rounds, the count's beats, the crowd.
    if (box.phase !== this.lastPhase) {
      if (box.phase === "fight" && this.lastPhase === "intro") this.bell(1);
      if ((box.phase === "break" || box.phase === "over") && this.lastPhase) this.bell(box.phase === "over" ? 3 : 2);
      if (box.phase === "down") this.roar(0.9);
      if (box.phase === "over" && box.result.how && box.result.how !== "DRAW") this.roar(1);
      this.lastPhase = box.phase;
    }
    if (box.count.n && box.count.n !== this.lastCount) this.tone(520, 500, 0.12, 0.08, "square");
    this.lastCount = box.count.n;
    this.bout = box;
    this.snapAt = now;
    this.state = null;
  }
  /** A punch whooshing through the air (louder for bigger punches). */
  whoosh(type: Punch["type"]) {
    const k = type === "jab" ? 0.5 : type === "hook" ? 0.75 : 1;
    this.click(900 + 400 * k, 0.8, 0.12 + 0.08 * k, 0.05 * k, "bandpass");
  }
  /** Ding-ding: the ring bell (n strikes). */
  bell(n: number) {
    for (let i = 0; i < n; i++)
      setTimeout(() => {
        this.tone(1480, 1460, 1.1, 0.07, "sine");
        this.tone(2960, 2940, 0.6, 0.025, "sine");
        this.tone(740, 735, 0.9, 0.03, "triangle");
      }, i * 260);
  }
  /** Where a fighter stands and which way they face (+1 = facing -z, corner 0). */
  spotOf(f: Fighter, b: Box) {
    const facing = f.corner ? -1 : 1;
    if (b.mode === "training") return { x: f.x, z: RING.start + 0.3, facing: 1 };
    return { x: 0, z: RING.start * facing, facing };
  }
  hitFx(b: Box, h: HitEvent, now: number) {
    const by = b.fighters.find((f) => f.id === h.by);
    const to = b.fighters.find((f) => f.id === h.to);
    if (!by) return;
    const s = this.spotOf(by, b);
    // Contact point: between the fighters at head height (or the bag / mitt in training).
    const cz = to ? 0 : s.z - 1.0 * s.facing;
    const cx = (to ? 0 : s.x) + (h.hand === "right" ? 0.12 : -0.12) * s.facing;
    const at = { x: cx, y: h.type === "upper" ? 1.5 : 1.4, z: cz + (to ? this.spotOf(to, b).facing * 0.25 : 0) };
    const strong = h.power >= 0.7;
    if (h.result === "dodge") {
      this.click(500, 0.6, 0.2, 0.06, "lowpass");
      return;
    }
    const blocked = h.result === "block";
    if (to) {
      const a = this.anim(to.id);
      if (blocked) a.blockAt = now;
      else {
        a.hitAt = now;
        a.hitPow = clamp(h.power, 0.2, 1) * (h.result === "counter" ? 1.3 : 1);
        a.hitDir = h.type === "hook" ? (h.hand === "right" ? 1 : -1) * s.facing : 0;
      }
    }
    const col: V = blocked ? [0.6, 0.85, 1] : h.result === "counter" ? [1, 0.55, 0.12] : strong ? [1, 0.85, 0.3] : [1, 0.97, 0.8];
    this.fx.add("ring", at, now, 360, col, blocked ? 0.7 : 1 + h.power * 0.6, now % 997);
    if (!blocked) this.fx.add("sparkle", at, now, 520, col, 0.6 + h.power, (now % 991) + 1);
    if (h.result === "counter" || h.result === "guardbreak") this.fx.add("shock", at, now, 520, palette.orange, 1, (now % 983) + 2);
    if (h.type === "upper" && !blocked && strong) this.fx.add("bolt", at, now, 420, [1, 0.95, 0.55], 1, (now % 977) + 3);
    // The camera punch is felt by the one hit (and the hitter on a big one).
    if (to && (this.local.includes(to.id) || (strong && this.local.includes(by.id)))) {
      this.fx.punch = blocked ? 0.2 : 0.35 + h.power * 0.5;
      this.fx.punchAt = now;
      if (!blocked && strong) this.fx.freezeUntil = now + 60;
    }
    // Sound: a padded thump; blocks are duller; big ones get a crowd "ooh".
    const p = clamp(h.power, 0, 1);
    if (blocked) {
      this.click(380, 1.2, 0.08, 0.2, "lowpass");
      this.tone(160, 110, 0.1, 0.07, "triangle");
    } else {
      this.click(260 + 300 * p, 0.9, 0.12 + 0.06 * p, 0.3 + 0.2 * p, "lowpass");
      this.tone(120 + 40 * p, 60, 0.18, 0.12 + 0.06 * p, "sine");
      if (h.result === "counter") this.tone(880, 1320, 0.18, 0.05, "triangle");
      if (strong || h.result === "counter") this.roar(0.35 + 0.3 * p);
      if (strong && this.ringId === "arena") this.flashes.push({ at: now, x: 0, y: 0, z: 0 });
    }
  }
  build() {
    this.vertices = [];
    this.fxv = [];
    this.mat = [0.15, 0, 0, 0];
    this.ringStatic();
    this.gl.setStatic(new Float32Array(this.vertices));
    this.vertices = [];
    for (const sp of ringLight(this.ringId ?? "neon").spots) if (sp.pos[1] > 3.5) this.shaft(sp.pos, sp.dir, sp.outer * 0.8, sp.color.map((c) => c * 0.5));
    this.gl.setStaticFx(new Float32Array(this.vertices));
    this.vertices = [];
    this.mat = [0.15, 0, 0, 0];
  }
  /** The ring (canvas, apron, posts, ropes, truss) and its venue. No two faces share a plane. */
  ringStatic() {
    const id = this.ringId ?? "neon";
    const L = RING_LOOK[id];
    this.map = id === "rooftop" ? "nyc" : "arena";
    if (id === "rooftop") {
      // The pickleball New York rooftop around a low ring on the roof deck.
      buildMap(this, "nyc");
    } else {
      this.material(0.2, 0, 0.08, 1);
      this.box(0, -DECK - 0.05, 0, 40, 0.1, 40, L.floor);
    }
    const deck = id === "rooftop" ? 0.12 : DECK;
    // Platform and apron skirt (skirt sits just outside the deck so their sides never touch).
    this.material(0.3, 0, 0.05);
    this.box(0, -deck / 2 - 0.03, 0, 2 * H + 0.5, deck - 0.06, 2 * H + 0.5, L.apron);
    // Canvas: one slab, with a Sportle circle on it (a flat disc just above).
    this.material(0.35, 0, 0.12, 1);
    this.box(0, -0.02, 0, 2 * H + 0.4, 0.04, 2 * H + 0.4, L.canvas);
    this.material(0.3, L.neon ? 0.12 : 0);
    this.blob(0, 0.004, 0, 1.25, 0.002, 1.25, L.logo, 0, 2, 32);
    this.material(0.3, L.neon ? 0.2 : 0.05);
    this.blob(0, 0.008, 0, 0.55, 0.002, 0.55, id === "arena" ? palette.orange : palette.gold, 0, 2, 24);
    // Corner posts with pads: blue (corner 0, +z +x), red (corner 1, -z -x), white for the neutral corners.
    const pads: Record<string, V> = { "1,1": palette.blue, "-1,-1": palette.red, "1,-1": palette.white, "-1,1": palette.white };
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        this.material(0.5, 0.05, 0.1);
        this.box(sx * H, 0.72, sz * H, 0.12, 1.52, 0.12, L.post);
        this.material(0.4);
        this.box(sx * (H - 0.09), 0.86, sz * (H - 0.09), 0.17, 1.02, 0.17, pads[`${sx},${sz}`]);
      }
    // Ropes: three per side, slightly inset from the posts.
    const ropeY = [0.42, 0.82, 1.22];
    ropeY.forEach((y, i) => {
      this.material(0.6, L.neon ? L.neon : 0.02, 0.1);
      const c = L.rope[i];
      for (const s of [-1, 1]) {
        this.box(s * (H - 0.06), y, 0, 0.045, 0.045, 2 * H - 0.3, c);
        this.box(0, y + 0.003, s * (H - 0.06), 2 * H - 0.3, 0.045, 0.045, c);
      }
    });
    // Turnbuckle ties between ropes in the middle of each side.
    this.material(0.4);
    for (const s of [-1, 1]) {
      this.box(s * (H - 0.06), 0.82, 0, 0.06, 0.82, 0.06, palette.white);
      this.box(0, 0.82, s * (H - 0.06), 0.06, 0.82, 0.06, palette.white);
    }
    // Lighting truss above the ring.
    this.material(0.6, 0.05, 0.1);
    for (const s of [-1, 1]) {
      this.box(s * 2.6, 7, 0, 0.12, 0.12, 5.3, [0.18, 0.18, 0.2]);
      this.box(0, 7.02, s * 2.6, 5.3, 0.12, 0.12, [0.18, 0.18, 0.2]);
    }
    if (id === "rooftop") {
      // String lights over the deck and a few fold-out chairs with fans.
      this.material(0.2, 1.4);
      for (let i = 0; i < 18; i++) {
        const t = i / 17;
        this.blob(-4.5 + 9 * t, 4.2 - Math.sin(t * Math.PI) * 0.5, -4.4, 0.06, 0.06, 0.06, [1, 0.85, 0.5], 0, 4, 6);
        this.blob(-4.5 + 9 * t, 4.2 - Math.sin(t * Math.PI) * 0.5, 4.4, 0.06, 0.06, 0.06, [1, 0.85, 0.5], 0, 4, 6);
      }
      this.crowd(4.4, 1, 0.12, 1);
      this.material(0.15);
      return;
    }
    if (id === "neon") {
      // Night club: dark walls, neon strips, a neon sign, and fans at little tables.
      this.material(0.2);
      for (const s of [-1, 1]) {
        this.box(s * 13, 3, 0, 0.2, 8, 26, [0.05, 0.03, 0.09]);
        this.box(0, 3, s * 13, 26, 8, 0.2, [0.05, 0.03, 0.09]);
      }
      this.material(0.2, 1.7);
      for (let i = 0; i < 8; i++) {
        const c = i % 2 ? RING_LOOK.neon.rope[0] : RING_LOOK.neon.rope[1];
        this.box(-12.85, 1.6 + (i % 3) * 0.9, -9 + i * 2.6, 0.05, 0.06, 1.8, c);
        this.box(12.85, 1.6 + ((i + 1) % 3) * 0.9, -9 + i * 2.6, 0.05, 0.06, 1.8, c);
      }
      this.text("SPORTLE", -2.9, 4.3, -12.85, 0.13, 1, 0, RING_LOOK.neon.rope[1]);
      this.text("BOXING", -2.4, 2.9, -12.85, 0.12, 1, 0, RING_LOOK.neon.rope[0]);
      this.material(0.3);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        const x = Math.cos(a) * 7.5,
          z = Math.sin(a) * 7.5;
        this.box(x, -DECK + 0.38, z, 0.7, 0.04, 0.7, [0.15, 0.1, 0.22]);
        this.box(x, -DECK + 0.18, z, 0.08, 0.36, 0.08, [0.2, 0.2, 0.24]);
      }
      this.crowd(6.4, 0, -DECK, 0.7);
      this.material(0.15);
      return;
    }
    // Championship arena: stands rising on every side, packed with fans.
    this.material(0.25);
    for (let row = 0; row < 7; row++) {
      const d = 6.2 + row * 0.95,
        y = -DECK + 0.25 + row * 0.6;
      for (const s of [-1, 1]) {
        this.box(s * d, y - 0.25, 0, 0.9, 0.12, 2 * d - 0.95, [0.1, 0.1, 0.14]);
        this.box(0, y - 0.25 + 0.003, s * d, 2 * d + 0.9, 0.12, 0.9, [0.1, 0.1, 0.14]);
      }
    }
    for (let row = 0; row < 7; row++) this.crowd(6.2 + row * 0.95, 0, -DECK + 0.25 + row * 0.6, 1, row);
    this.material(0.2);
    for (const s of [-1, 1]) this.box(s * 13.5, 4, 0, 0.2, 10, 27, [0.03, 0.03, 0.05]);
    this.box(0, 4, -13.5, 27, 10, 0.2, [0.03, 0.03, 0.05]);
    this.box(0, 4, 13.5, 27, 10, 0.2, [0.03, 0.03, 0.05]);
    this.material(0.15);
  }
  /** Fans around the ring at distance d (square), seated on a row at height y. */
  crowd(d: number, outdoor: number, y: number, density: number, row = 0) {
    const shirts = [palette.blue, palette.red, palette.orange, palette.white, palette.gold, [0.55, 0.36, 0.9], [0.2, 0.75, 0.72]];
    const skin = [[0.85, 0.68, 0.55], [0.62, 0.45, 0.33], [0.42, 0.3, 0.22], [0.93, 0.78, 0.66]];
    const n = Math.round(2 * d * density * 1.6);
    this.material(0.45);
    for (const side of [0, 1, 2, 3])
      for (let i = 0; i < n; i++) {
        const seed = Math.sin(i * 12.9898 + side * 78.233 + row * 3.7 + outdoor) * 43758.5453;
        const r = seed - Math.floor(seed);
        if (r < 0.12) continue;
        const u = -d + 0.5 + ((2 * d - 1) * (i + r * 0.4)) / n;
        const x = side === 0 ? u : side === 1 ? d : side === 2 ? -u : -d;
        const z = side === 0 ? d : side === 1 ? u : side === 2 ? -d : -u;
        const shirt = shirts[Math.floor(r * shirts.length)];
        this.blob(x, y + 0.3, z, 0.17, 0.24, 0.15, shirt, 0, 4, 6);
        this.blob(x, y + 0.62, z, 0.1, 0.11, 0.1, skin[Math.floor(r * 37) % skin.length], 0, 4, 6);
      }
  }
  // ——————————————————————————— Fighters ———————————————————————————
  /** Apply matrix m around pivot to the vertices written since `start`. */
  xform(arr: number[], start: number, pivot: V, m: M3) {
    // Normals use the inverse transpose; for rotations × scales that is the rotation × inverse scale,
    // so a cofactor matrix (proportional to it) and a renormalise are enough.
    const c = [
      m[4] * m[8] - m[5] * m[7], m[5] * m[6] - m[3] * m[8], m[3] * m[7] - m[4] * m[6],
      m[2] * m[7] - m[1] * m[8], m[0] * m[8] - m[2] * m[6], m[1] * m[6] - m[0] * m[7],
      m[1] * m[5] - m[2] * m[4], m[2] * m[3] - m[0] * m[5], m[0] * m[4] - m[1] * m[3],
    ];
    for (let i = start; i < arr.length; i += 13) {
      const x = arr[i] - pivot[0],
        y = arr[i + 1] - pivot[1],
        z = arr[i + 2] - pivot[2];
      arr[i] = pivot[0] + m[0] * x + m[1] * y + m[2] * z;
      arr[i + 1] = pivot[1] + m[3] * x + m[4] * y + m[5] * z;
      arr[i + 2] = pivot[2] + m[6] * x + m[7] * y + m[8] * z;
      const nx = arr[i + 3],
        ny = arr[i + 4],
        nz = arr[i + 5];
      const ox = c[0] * nx + c[1] * ny + c[2] * nz,
        oy = c[3] * nx + c[4] * ny + c[5] * nz,
        oz = c[6] * nx + c[7] * ny + c[8] * nz;
      const l = Math.hypot(ox, oy, oz) || 1;
      arr[i + 3] = ox / l;
      arr[i + 4] = oy / l;
      arr[i + 5] = oz / l;
    }
  }
  gloveColor(f: Fighter): V {
    if (f.bot) return botDef(f.bot).glove;
    return f.gear?.paddle ? (PADDLES[f.gear.paddle].color as unknown as V) : f.corner ? palette.red : palette.blue;
  }
  /**
   * One glove's position in the fighter's own frame (x = their right, y up, z forward) from the
   * stance, guard, a punch's progress and the hit reaction.
   */
  glovePos(f: Fighter, side: 1 | -1, pt: number, now: number): { p: V; glow: number } {
    const hand = side > 0 ? "right" : "left";
    let p: V = [...REST_GLOVES[f.guard ? "guard" : "stance"][side > 0 ? 0 : 1]];
    if (f.stamina < 0.25 && !f.guard) p = [p[0] * 1.15, p[1] - 0.15, p[2] - 0.05]; // tired: gloves drop
    const tell = f.tellAnim;
    if (tell === "tap" && !f.punch) p = [0.05 * side + Math.sin(now / 70) * 0.03 * side, 1.38, 0.38];
    if (tell === "breathe") p = [0.3 * side, 0.95, 0.25];
    if (tell === "huff") p = [0.32 * side, 0.9, 0.22];
    const k = f.punch;
    let glow = 0;
    if (k && k.hand === hand) {
      const t = pt;
      const w = k.windup;
      const back: Record<string, V> = { jab: [0.25 * side, 1.22, 0.18], hook: [0.62 * side, 1.28, 0.12], upper: [0.28 * side, 0.82, 0.22] };
      const out: Record<string, V> = { jab: [0.1 * side, 1.38, 0.92], hook: [-0.1 * side, 1.36, 0.78], upper: [0.08 * side, 1.62, 0.66] };
      if (t < w) {
        // Wind-up: pull back (the tell), shaking a little on a long bot tell.
        const e = ease(clamp(t / Math.max(0.05, w), 0, 1));
        const b = back[k.type];
        p = [lerp(p[0], b[0], e), lerp(p[1], b[1], e), lerp(p[2], b[2], e)];
        if (k.tell) {
          glow = 0.6 + 0.6 * e;
          p = [p[0] + Math.sin(now / 30) * 0.015, p[1], p[2]];
        }
      } else {
        const s = t - w;
        const strike = 0.08,
          rec = PUNCH[k.type].recover;
        const e = s < strike ? 1 : 1 - ease(clamp((s - strike) / rec, 0, 1));
        const b = back[k.type],
          o = out[k.type];
        if (k.type === "hook") {
          // A hook arcs round from the side.
          const a = (s < strike ? s / strike : 1) * (Math.PI / 2);
          const arc: V = [lerp(b[0], o[0], Math.sin(a)), lerp(b[1], o[1], e), lerp(b[2], o[2], Math.sin(a))];
          p = [lerp(p[0], arc[0], e), lerp(p[1], arc[1], e), lerp(p[2], arc[2], e)];
        } else p = [lerp(p[0], o[0], e), lerp(p[1], o[1], e), lerp(p[2], o[2], e)];
      }
    }
    return { p, glow };
  }
  /** A fighter: capsule body, big gloves, all the moves. `ghost` draws them see-through (your own view). */
  boxer(b: Box, f: Fighter, now: number, ghost: boolean) {
    const s = this.spotOf(f, b);
    const a = this.anim(f.id);
    const age = (now - this.snapAt) / 1000;
    const pt = f.punch ? f.punch.t + (b.paused ? 0 : Math.min(0.12, age)) : 0;
    const facing = s.facing;
    const R: V = [facing, 0, 0],
      Fw: V = [0, 0, -facing];
    const world = (q: V): V => [s.x + R[0] * q[0] + Fw[0] * q[2], q[1], s.z + R[2] * q[0] + Fw[2] * q[2]];
    const def = f.bot ? botDef(f.bot) : null;
    const target = ghost ? this.fxv : this.vertices;
    const keep = this.vertices;
    this.vertices = target;
    const start = target.length;
    // Your own fighter, see-through: a faint glow (and every material call stays see-through).
    const GHOST: [number, number, number, number] = [0, 0.045, 0.85, 0];
    if (ghost) {
      this.mat = GHOST;
      this.material = (() => (this.mat = GHOST)) as never;
    } else this.material(0.55);
    // Bounce on the toes (faster for Zola's tell and Dina's dance); tired fighters sag.
    const bounceRate = f.tellAnim === "bounce" ? 70 : f.tellAnim === "dance" ? 110 : 160;
    const fightOn = b.phase === "fight" || b.phase === "training" || b.phase === "intro";
    const hop = fightOn && f.hp > 0 ? Math.abs(Math.sin(now / bounceRate)) * (f.tellAnim === "bounce" ? 0.07 : 0.03) : 0;
    const gColor = this.gloveColor(f);
    const glovesAt = (y0: number, col: V) => {
      for (const side of [1, -1] as const) {
        const g = this.glovePos(f, side, pt, now);
        const sh: V = world([0.33 * side, 1.38 + y0, 0.02]);
        const gp = world([g.p[0], g.p[1] + y0, g.p[2]]);
        // Arm: a chain of small blobs from the shoulder to the glove.
        for (let i = 0; i <= 4; i++) {
          const t = i / 4;
          this.blob(lerp(sh[0], gp[0], t), lerp(sh[1], gp[1], t) - Math.sin(t * Math.PI) * 0.05, lerp(sh[2], gp[2], t), 0.06, 0.06, 0.06, col, 0, 5, 8);
        }
        if (ghost) this.mat = [0, 0.38 + g.glow * 0.4, 0.3, 0];
        else this.material(0.75, g.glow, 0.25);
        // Big padded glove (a fist and its thumb), then the white cuff.
        this.blob(gp[0], gp[1], gp[2], 0.15, 0.135, 0.17, g.glow ? [Math.min(1, gColor[0] + 0.3), Math.min(1, gColor[1] + 0.2), gColor[2]] : gColor, 0, 8, 12);
        this.blob(gp[0] - R[0] * side * 0.09, gp[1] + 0.03, gp[2] + Fw[2] * 0.05, 0.06, 0.07, 0.08, gColor, 0, 5, 8);
        if (ghost) this.mat = GHOST;
        else this.material(0.5);
        this.blob(gp[0] - Fw[0] * 0.13, gp[1] - 0.01, gp[2] - Fw[2] * 0.13, 0.11, 0.1, 0.06, palette.white, 0, 5, 10);
        if (ghost) this.mat = GHOST;
        else this.material(0.55);
      }
    };
    this.mascotBody(
      { team: f.corner, hand: "right", bot: false, id: f.id, outfit: f.outfit, gear: f.gear, body: def?.body },
      { x: s.x, y: hop, z: s.z },
      { swing: 0, pitch: 0, roll: 0, yaw: 0, moving: fightOn ? 1 : 0, server: false, owner: false, noRing: true, arms: glovesAt, cheer: b.phase === "over" && b.result.winner === f.id ? 1 : 0 },
    );
    // Whole-body moves, applied to what was just drawn: slips, ducks, hit squash, knockdowns.
    const feet: V = [s.x, 0, s.z];
    let m: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (f.dodge === "left" || f.dodge === "right") {
      const k = Math.sin(clamp(1 - f.dodgeLeft / 0.45, 0, 1) * Math.PI) * (f.dodge === "right" ? 1 : -1);
      m = mul(rotM(Fw, 0.42 * k), m);
    } else if (f.dodge === "duck") {
      const k = Math.sin(clamp(1 - f.dodgeLeft / 0.45, 0, 1) * Math.PI);
      m = mul(mul(rotM(R, -0.3 * k), scaleM(1, 1 - 0.3 * k, 1)), m);
    }
    if (f.tellAnim === "dance") m = mul(rotM(Fw, Math.sin(now / 110) * 0.12), m);
    const hitAge = (now - a.hitAt) / 1000;
    if (hitAge < 0.45 && f.hp > 0) {
      // Squash on impact, stretch on the rebound, snapped back and to the side for a hook.
      const k = a.hitPow;
      const sq = hitAge < 0.09 ? hitAge / 0.09 : Math.max(0, 1 - (hitAge - 0.09) / 0.36);
      const wob = Math.sin(hitAge * 30) * (1 - hitAge / 0.45);
      m = mul(mul(rotM(R, 0.25 * k * sq), rotM(Fw, a.hitDir * 0.3 * k * sq)), m);
      m = mul(scaleM(1 + 0.12 * k * wob, 1 - 0.12 * k * wob, 1 + 0.12 * k * wob), m);
    }
    const blockAge = (now - a.blockAt) / 1000;
    if (blockAge < 0.2) m = mul(rotM(R, 0.08 * (1 - blockAge / 0.2)), m);
    const down = f.hp <= 0 && (b.phase === "down" || b.phase === "over");
    if (down) {
      // Fall backward over 0.5 s, bounce a little; stars circle while counting.
      const t = clamp((now - a.downAt) / 500, 0, 1);
      const fall = t < 1 ? ease(t) : 1 - Math.sin(clamp((now - a.downAt - 500) / 180, 0, 1) * Math.PI) * 0.04;
      m = mul(rotM(R, 1.45 * fall), m);
      // Trying to get up: the meter lifts them a little.
      if (f.rise > 0) m = mul(rotM(R, -0.5 * f.rise), m);
    }
    if (m.some((v, i) => Math.abs(v - [1, 0, 0, 0, 1, 0, 0, 0, 1][i]) > 1e-4)) this.xform(target, start, feet, m);
    if (ghost) delete (this as { material?: unknown }).material;
    this.vertices = keep;
    this.material(0.15);
    // Stars over a dazed or downed fighter (glow).
    if ((down || f.stun > 0.3) && !ghost) {
      const head = down ? world([0, 0.35, -1.25]) : world([0, 2.05, 0]);
      const keep2 = this.vertices;
      this.vertices = this.fxv;
      for (let i = 0; i < 5; i++) {
        const ang = now / 240 + (i / 5) * Math.PI * 2;
        this.mat = [0, 1.4, 0.6, 0];
        this.blob(head[0] + Math.cos(ang) * 0.32, head[1] + Math.sin(ang * 2) * 0.05, head[2] + Math.sin(ang) * 0.32, 0.05, 0.05, 0.05, palette.gold, 0, 3, 5);
      }
      this.vertices = keep2;
      this.material(0.15);
    }
    // Shadow blob on the canvas (unless real shadows are on).
    if (!this.gl.shadows) this.blob(s.x, 0.012, s.z, 0.45, 0.003, 0.45, [0.03, 0.03, 0.05], 0, 2, 14);
    if (!ghost) this.tags.push({ id: f.id, name: f.name, team: f.corner, x: s.x, y: down ? 0.9 : 2.25, z: down ? s.z + 1.1 * facing : s.z });
  }
  /** Training: a heavy bag hanging in front of the fighter, swinging when hit. */
  bag(b: Box, f: Fighter, now: number) {
    const s = this.spotOf(f, b);
    const d = f.drill;
    const age = d ? b.time - d.bagAt + (now - this.snapAt) / 1000 : 9;
    const k = age < 2.2 ? Math.exp(-age * 2.2) * Math.sin(age * 9) * (0.15 + 0.35 * (d?.bagPower ?? 0)) : 0;
    const top: V = [s.x, 3.2, s.z - 1.05];
    const start = this.vertices.length;
    this.material(0.4, 0.02, 0.08);
    this.box(top[0], top[1] - 0.45, top[2], 0.02, 0.9, 0.02, [0.3, 0.3, 0.32]);
    this.blob(top[0], 1.5, top[2], 0.3, 0.6, 0.3, f.corner ? palette.red : [0.75, 0.15, 0.2], 0.25, 10, 14);
    this.material(0.4);
    this.blob(top[0], 1.5, top[2], 0.315, 0.05, 0.315, palette.white, 0, 2, 14);
    this.text("SPORTLE", top[0] - 0.26, 1.18, top[2] + 0.33, 0.012, 1, 0, palette.white);
    const side = d?.bagDir ?? 0;
    const m = mul(rotM([1, 0, 0], -k), rotM([0, 0, 1], side * k * 0.8));
    this.xform(this.vertices, start, top, m);
    this.material(0.15);
  }
  /** Training: Coach Kip holding up mitts, showing the call. */
  coach(b: Box, f: Fighter, now: number) {
    const s = this.spotOf(f, b);
    const z = s.z - 1.55;
    const call = f.drill?.call ?? "";
    this.material(0.55);
    const mitt = (side: 1 | -1): V => {
      // Mitts held where that punch should land; they jab back on a guard/duck call.
      if (call === "upper") return [s.x + 0.12 * side, 1.25, z + 0.5];
      if (call === "hook") return [s.x - 0.42 * side, 1.4, z + 0.42];
      if (call === "guard" || call === "duck" || call === "left" || call === "right") return [s.x + 0.15 * side, 1.45 + Math.sin(now / 90) * 0.03, z + 0.55 + Math.max(0, Math.sin(now / 160)) * 0.25];
      return [s.x + 0.15 * side, 1.4, z + 0.55];
    };
    const glovesAt = () => {
      for (const side of [1, -1] as const) {
        const p = mitt(side);
        this.material(0.6, call ? 0.4 : 0, 0.2);
        this.blob(p[0], p[1], p[2], 0.15, 0.17, 0.07, call ? palette.gold : [0.85, 0.75, 0.3], 0, 8, 12);
        this.material(0.55);
        this.blob((p[0] + s.x - 0.3 * side) / 2, (p[1] + 1.35) / 2, (p[2] + z) / 2, 0.06, 0.06, 0.2, [0.2, 0.75, 0.72], 0, 5, 8);
      }
    };
    this.mascotBody(
      { team: 1, hand: "right", bot: false, id: "coach-" + f.id, outfit: "cap", gear: { paddle: 0, shoes: 1, eyes: 1 }, body: [0.2, 0.75, 0.72] },
      { x: s.x, y: 0, z },
      { swing: 0, pitch: 0, roll: 0, yaw: 0, moving: 0, server: false, owner: false, noRing: true, arms: glovesAt },
    );
    this.material(0.15);
  }
  /** Pixel text centred at (x, y, z), reading along +x (dx = 1) or -x, on a board facing ±z. */
  ledText(msg: string, x: number, y: number, z: number, dx: number, size: number, col: V) {
    let units = 0;
    for (const ch of msg) units += ch === " " ? 3 : (GLYPHS[ch]?.[0].length ?? 5) + 1;
    let cursor = -units / 2;
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
          const u = (cursor + c + 0.5) * size;
          this.box(x + dx * u, y + (3 - r) * size, z, size * 0.9, size * 0.9, 0.02, col);
        }),
      );
      cursor += g[0].length + 1;
    }
  }
  /** The hanging scoreboard: round and clock, names and punches landed on its faces. */
  scoreboard(b: Box | null) {
    this.material(0.4, 0.02);
    this.box(0, 5.2, 0, 2.4, 1.1, 2.4, [0.05, 0.05, 0.08]);
    this.box(0, 5.9, 0, 0.06, 0.4, 0.06, [0.2, 0.2, 0.22]);
    const clock = b ? Math.ceil(b.clock) : 0;
    const top = !b || b.phase === "lobby" ? "SPORTLE" : b.mode === "training" ? "TRAINING" : b.phase === "over" ? (b.result.how || "FINAL").replace("DECISION", "POINTS") : `R${b.round} ${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, "0")}`;
    const [p, q] = b?.fighters ?? [];
    const sub = p && q && b?.mode !== "training" ? `${p.stats.landed} - ${q.stats.landed}` : "BOXING";
    this.material(0.1, 2.2);
    for (const s of [-1, 1]) {
      this.ledText(top, 0, 5.38, s * 1.215, -s, 0.05, b?.phase === "fight" && clock <= 10 ? palette.orange : palette.gold);
      this.ledText(sub, 0, 4.98, s * 1.215, -s, 0.04, palette.white);
    }
    this.material(0.15);
  }
  /** Camera for one view: just behind this fighter (gloves big, opponent across) or broadcast. */
  camFor(b: Box | null, id: string, now: number): { eye: V; target: V; fov: number } {
    const shake = this.fx.shake(now);
    if (!b || b.phase === "lobby") {
      const t = now / 7000;
      return { eye: [Math.sin(t) * 6.2, 2.6, Math.cos(t) * 6.2], target: [0, 1, 0], fov: 46 };
    }
    const f = b.fighters.find((q) => q.id === id);
    if (!f || this.viewMode2 === "broadcast" || id === "broadcast") {
      const t = Math.sin(now / 9000) * 0.25;
      return { eye: [6 * Math.cos(t) + shake.x, 2.5 + shake.y, 6 * Math.sin(t)], target: [0, 1.15, 0], fov: 40 + shake.fov };
    }
    const s = this.spotOf(f, b);
    const o = b.mode === "training" ? null : b.fighters.find((q) => q !== f);
    const os = o ? this.spotOf(o, b) : { x: s.x, z: s.z - 1.6 * s.facing };
    // Down: the camera looks down at your own fighter on the canvas.
    if (f.hp <= 0 && (b.phase === "down" || b.phase === "over")) {
      return { eye: [s.x + 2.6, 3.3, s.z - 0.9 * s.facing], target: [s.x, 0.4, s.z + 0.6 * s.facing], fov: 48 };
    }
    const cam = behindCam(s, os, f.dodge);
    return { eye: [cam.eye[0] + shake.x, cam.eye[1] + shake.y, cam.eye[2]], target: cam.target, fov: cam.fov + shake.fov };
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
    const b = this.bout;
    this.decals = [];
    this.tags = [];
    // Shared dynamic geometry: scoreboard, training bags and coaches.
    this.vertices = [];
    this.fxv = [];
    this.scoreboard(b);
    if (b && b.phase !== "lobby" && b.mode === "training")
      for (const f of b.fighters) {
        if (b.drill === "bag") this.bag(b, f, now);
        else this.coach(b, f, now);
      }
    // Camera bulbs flashing in the stands after a big hit.
    this.flashes = this.flashes.filter((q) => now - q.at < 600);
    if (this.flashes.length) {
      const keep = this.vertices;
      this.vertices = this.fxv;
      for (let i = 0; i < 14; i++) {
        const r = Math.sin(i * 91.7 + this.flashes[0].at) * 43758.5;
        const u = r - Math.floor(r);
        const side = i % 4,
          d = 7 + u * 4,
          v = (u * 2 - 1) * d;
        const x = side === 0 ? v : side === 1 ? d : side === 2 ? -v : -d,
          z = side === 0 ? d : side === 1 ? v : side === 2 ? -d : -v;
        if ((now - this.flashes[0].at) / 600 < u) continue;
        this.mat = [0, 2.5, 0.8, 0];
        this.blob(x, 0.5 + u * 3, z, 0.12, 0.12, 0.12, [1, 1, 0.95], 0, 3, 5);
      }
      this.vertices = keep;
    }
    const commonV = this.vertices,
      commonFx = this.fxv;
    // Views: one per local fighter (split screen side by side), else one broadcast view.
    const fighting = b && b.phase !== "lobby";
    const ids = fighting && this.viewMode2 === "behind" && this.local.length ? this.local.filter((id) => b!.fighters.some((f) => f.id === id)).slice(0, 2) : [];
    const views = ids.length ? ids : ["broadcast"];
    const n = views.length;
    const draws: ViewDraw[] = [];
    const rects: { id: string; x: number; y: number; w: number; h: number }[] = [];
    const seen = new Set<string>();
    const light = ringLight(this.ringId);
    views.forEach((id, idx) => {
      let vx = 0,
        vw = w;
      if (n === 2) {
        vw = Math.floor(w / 2) - 1;
        vx = idx ? w - vw : 0;
      }
      this.vertices = commonV.slice();
      this.fxv = commonFx.slice();
      this.tags = [];
      if (b) for (const f of b.fighters) this.boxer(b, f, now, f.id === id && id !== "broadcast" && this.viewMode2 === "behind" && !(f.hp <= 0));
      const cam = this.camFor(b, id, now);
      const vp = camera(vw / Math.max(1, h), cam.eye, cam.target, cam.fov, 0);
      this.view = { eye: cam.eye, target: cam.target, fov: cam.fov, shift: 0 };
      this.effects(now, null, idx, n > 1);
      const cw = canvas.clientWidth,
        ch = canvas.clientHeight;
      const ox = (vx / w) * cw;
      // Name tags only in the broadcast view: behind you, the names are on the health bars.
      if (id === "broadcast") this.placeTagsIn(vp, ox, (vw / w) * cw, ch, idx, seen, id);
      rects.push({ id, x: ox, y: 0, w: (vw / w) * cw, h: ch });
      draws.push({ rect: [vx, 0, vw, h], vp, eye: cam.eye, dynamic: new Float32Array(this.vertices), fx: new Float32Array(this.fxv), decals: this.decals });
    });
    this.fx.track(null, now);
    this.gl.frame(w, h, light, draws, this.postFx(now), now / 1000);
    for (const [key, el] of this.tagEls) if (!seen.has(key)) el.style.display = "none";
    this.onViews(rects);
  };
  /** Name tags inside one view (CSS pixels); your own fighter has none in your view. */
  placeTagsIn(vp: V, ox: number, cw: number, ch: number, pass: number, seen: Set<string>, own: string) {
    for (const t of this.tags) {
      if (t.id === own) continue;
      const cx = vp[0] * t.x + vp[4] * t.y + vp[8] * t.z + vp[12],
        cy = vp[1] * t.x + vp[5] * t.y + vp[9] * t.z + vp[13],
        cw4 = vp[3] * t.x + vp[7] * t.y + vp[11] * t.z + vp[15];
      if (cw4 <= 0.3) continue;
      const sx = ox + ((cx / cw4 + 1) / 2) * cw,
        sy = ((1 - cy / cw4) / 2) * ch;
      if (sx < ox || sx > ox + cw || sy < 0 || sy > ch) continue;
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
      const scale = Math.max(0.6, Math.min(1.1, 8 / cw4));
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(2)})`;
      el.style.display = "";
      seen.add(key);
    }
  }
}
