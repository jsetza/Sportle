// Developer check: lists visible coplanar overlapping faces (flicker) per map.
// Run: node --experimental-strip-types scripts/dev/find-zfighting.ts
// Finds coplanar overlapping faces (z-fighting) in each map's static geometry.
import { buildMap, LOOKS } from "../../src/client/maps.ts";
import { MAPS } from "../../src/shared/types.ts";
import { LANES } from "../../src/shared/bowling.ts";
import { BowlScene } from "../../src/client/bowlscene.ts";
import { KartScene } from "../../src/client/kartscene.ts";
import { TRACKS, track } from "../../src/shared/kart.ts";
import { BoxScene } from "../../src/client/boxscene.ts";
import { RINGS } from "../../src/shared/boxing.ts";
import type { MapId } from "../../src/shared/types.ts";
type Box = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  c: number[];
  rot: boolean;
  src: string;
  glow: number;
  r?: number[];
};
/** Axis-aligned bounds of a rotated box (same rotation order as the renderer: x, then y, then z). */
function bounds(q: Box) {
  if (!q.r) return q;
  const [rx, rz, ry] = q.r;
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        let a = (sx * q.w) / 2,
          b = (sy * q.h) / 2,
          c = (sz * q.d) / 2;
        const by = b * Math.cos(rx) - c * Math.sin(rx);
        c = b * Math.sin(rx) + c * Math.cos(rx);
        b = by;
        const ax = a * Math.cos(ry) + c * Math.sin(ry);
        c = -a * Math.sin(ry) + c * Math.cos(ry);
        a = ax;
        const p = [
          a * Math.cos(rz) - b * Math.sin(rz),
          a * Math.sin(rz) + b * Math.cos(rz),
          c,
        ];
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i], p[i]);
          hi[i] = Math.max(hi[i], p[i]);
        }
      }
  return {
    ...q,
    x: q.x + (lo[0] + hi[0]) / 2,
    y: q.y + (lo[1] + hi[1]) / 2,
    z: q.z + (lo[2] + hi[2]) / 2,
    w: hi[0] - lo[0],
    h: hi[1] - lo[1],
    d: hi[2] - lo[2],
  };
}
const EPS = 0.004;
import { readFileSync } from "node:fs";
// Lines of buildMap()'s wrapper (box/blob pass-through) — skip them when naming the caller.
const WRAP =
  readFileSync(new URL("../../src/client/maps.ts", import.meta.url), "utf8")
    .split("\n")
    .findIndex((l) => l.startsWith("export function buildMap")) + 1;
// Every pickleball map, then every Sportle Bowling lane ("bowling:<lane>").
for (const map of [
  ...MAPS.map((m) => m.id as string),
  ...LANES.map((l) => "bowling:" + l.id),
  ...TRACKS.map((t) => "kart:" + t.id),
  ...RINGS.map((r) => "boxing:" + r.id),
]) {
  const kart = map.startsWith("kart:");
  const boxing = map.startsWith("boxing:");
  const bowling = map.startsWith("bowling:") || kart || boxing;
  const boxes: Box[] = [];
  const blobs: {
    x: number;
    y: number;
    z: number;
    w: number;
    h: number;
    d: number;
    src: string;
  }[] = [];
  let glow = 0;
  const caller = () =>
    new Error()
      .stack!.split("\n")
      .map((l) => /maps\.ts:(\d+)/.exec(l)?.[1] ?? (/(bowl|kart|box)scene\.ts:(\d+)/.exec(l) ? /(bowl|kart|box)scene\.ts:(\d+)/.exec(l)![0] : undefined))
      .filter((n) => n && (/scene/.test(n) || Number(n) < WRAP || Number(n) > WRAP + 20))[0] ??
    "?";
  const b = {
    box(
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      c: number[],
      rx = 0,
      rz = 0,
      ry = 0,
    ) {
      boxes.push({
        x,
        y,
        z,
        w,
        h,
        d,
        c,
        rot: !!(rx || rz || ry),
        src: caller(),
        glow,
        r: rx || rz || ry ? [rx, rz, ry] : undefined,
      });
    },
    blob(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
      blobs.push({ x, y, z, w: rx * 2, h: ry * 2, d: rz * 2, src: caller() });
    },
    text() {
      return 0;
    },
    glow(k: number) {
      glow = k;
    },
  };
  if (boxing) {
    // The boxing scene's static build (ring, venue, crowd) with this recorder.
    const fake = Object.assign(Object.create(BoxScene.prototype), b, {
      ringId: map.slice(7),
      map: "arena",
      mat: [0, 0, 0, 0],
      material() {},
      with(_m: unknown, fn: () => void) {
        fn();
      },
      tri() {},
      vertex() {},
    });
    fake.ringStatic();
  } else if (kart) {
    // The kart scene's static build (track, barriers, pads, scenery) with this recorder.
    const fake = Object.assign(Object.create(KartScene.prototype), b, {
      trackId: map.slice(5),
      map: "arena",
      mat: [0, 0, 0, 0],
      material() {},
      with(_m: unknown, fn: () => void) {
        fn();
      },
      tri() {},
      vertex() {},
    });
    const t = track(map.slice(5) as never);
    fake.trackMesh(t);
    fake.scenery(t);
  } else if (bowling) {
    // The bowling scene's static build (lane, alley, scenery) with this recorder as the builder.
    const fake = Object.assign(Object.create(BowlScene.prototype), b, {
      lane: map.slice(8),
      map: "arena",
      mat: [0, 0, 0, 0],
      material() {},
      with(_m: unknown, fn: () => void) {
        fn();
      },
      pin() {},
      vertex() {},
    });
    fake.alley();
  }
  // The scene's own court-area layers (scene.ts arena()).
  const look = LOOKS[(bowling ? "arena" : map) as MapId];
  if (!bowling) {
  if (look.ground)
    boxes.push({
      x: 0,
      y: -0.085,
      z: 0,
      w: 90,
      h: 0.1,
      d: 90,
      c: look.ground,
      rot: false,
      src: "scene ground",
      glow: 0,
    });
  boxes.push({
    x: 0,
    y: -0.02,
    z: 0,
    w: 11,
    h: 0.04,
    d: 21,
    c: look.apron,
    rot: false,
    src: "scene apron",
    glow: 0,
  });
  boxes.push({
    x: 0,
    y: -0.005,
    z: 0,
    w: 6.096,
    h: 0.03,
    d: 13.4112,
    c: [0, 0, 1],
    rot: false,
    src: "scene court",
    glow: 0,
  });
  if (map !== "arena") buildMap(b as never, map as MapId);
  }
  const flat = boxes.filter((q) => !q.rot);
  const hits = new Map<string, { n: number; area: number; ex: string }>();
  const overl = (a0: number, a1: number, b0: number, b1: number) =>
    Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const same = (p: number[], q: number[]) =>
    p.every((v, i) => Math.abs(v - q[i]) < 0.01);
  // Faces: top/bottom (y), sides (x), front/back (z). Bucket by plane position.
  for (const axis of ["y", "x", "z"] as const) {
    const faces: { p: number; box: Box }[] = [];
    for (const q of flat) {
      const half = axis === "y" ? q.h / 2 : axis === "x" ? q.w / 2 : q.d / 2;
      faces.push(
        { p: q[axis] + half, box: q, dir: 1 } as never,
        { p: q[axis] - half, box: q, dir: -1 } as never,
      );
    }
    faces.sort((u, v) => u.p - v.p);
    for (let i = 0; i < faces.length; i++)
      for (
        let j = i + 1;
        j < faces.length && faces[j].p - faces[i].p < EPS;
        j++
      ) {
        const A = faces[i].box,
          B = faces[j].box;
        if (
          (faces[i] as never as { dir: number }).dir !==
          (faces[j] as never as { dir: number }).dir
        )
          continue; // touching, hidden
        if (
          axis === "y" &&
          (faces[i] as never as { dir: number }).dir < 0 &&
          faces[i].p < 0.05
        )
          continue; // undersides at/below ground
        if (A === B || same(A.c, B.c)) continue;
        const ext = (q: Box, ax: string) =>
          ax === "x"
            ? [q.x - q.w / 2, q.x + q.w / 2]
            : ax === "y"
              ? [q.y - q.h / 2, q.y + q.h / 2]
              : [q.z - q.d / 2, q.z + q.d / 2];
        const [u, v] =
          axis === "y" ? ["x", "z"] : axis === "x" ? ["y", "z"] : ["x", "y"];
        const [a0, a1] = ext(A, u),
          [b0, b1] = ext(B, u),
          [c0, c1] = ext(A, v),
          [d0, d1] = ext(B, v);
        // Interior faces (one box's face inside the other box) are hidden; skip if face is enclosed.
        const area = overl(a0, a1, b0, b1) * overl(c0, c1, d0, d1);
        if (area < 0.01) continue;
        // Hidden if the shared patch sits inside some other solid box.
        const cu = (Math.max(a0, b0) + Math.min(a1, b1)) / 2,
          cv = (Math.max(c0, d0) + Math.min(c1, d1)) / 2;
        const P: Record<string, number> = {
          [axis]: faces[i].p,
          [u]: cu,
          [v]: cv,
        };
        const inside = (q: Box) =>
          Math.abs(P.x - q.x) < q.w / 2 - 0.002 &&
          Math.abs(P.y - q.y) < q.h / 2 - 0.002 &&
          Math.abs(P.z - q.z) < q.d / 2 - 0.002;
        if (flat.some((q) => q !== A && q !== B && inside(q))) continue;
        // Is the shared plane actually visible? If both faces point into each other's solid, skip.
        const key = [A.src, B.src, axis].sort().join(" × ");
        const h = hits.get(key) ?? {
          n: 0,
          area: 0,
          ex: `${axis}=${faces[i].p.toFixed(3)}`,
        };
        h.n++;
        h.area += area;
        hits.set(key, h);
      }
  }
  const list = [...hits.entries()].sort((a, b) => b[1].area - a[1].area);
  console.log(
    `\n== ${map}: ${flat.length} boxes, ${list.length} coplanar overlap kinds`,
  );
  for (const [k, v] of list.slice(0, 12))
    console.log(
      `  ${v.area.toFixed(1).padStart(8)} m²  ×${v.n}  ${k}  (${v.ex})`,
    );
  // Play area: nothing over 0.3 m on the apron, nothing over 1.5 m where the players and the
  // player/broadcast cameras move (|x| < 8, |z| < 16.5). Rotated boxes count by their real bounds.
  const blocked = new Set<string>();
  for (const q of [
    ...boxes.filter((q) => !q.src.startsWith("scene")).map(bounds),
    ...blobs,
  ]) {
    const r = 0;
    const top = q.y + q.h / 2,
      bottom = q.y - q.h / 2;
    if (bottom > 6) continue;
    const hw = q.w / 2 + r,
      hd = q.d / 2 + r;
    const onApron =
      Math.abs(q.x) - hw < 5.5 && Math.abs(q.z) - hd < 10.5 && top > 0.3;
    const nearCams =
      Math.abs(q.x) - hw < 8 && Math.abs(q.z) - hd < 16.5 && top > 1.5;
    if (!bowling && (onApron || nearCams)) blocked.add(q.src);
  }
  if (blocked.size)
    console.log(
      "  PLAY AREA BLOCKED by maps.ts lines " + [...blocked].join(", "),
    );
}
