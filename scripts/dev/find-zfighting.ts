// Developer check: lists visible coplanar overlapping faces (flicker) per map.
// Run: node --experimental-strip-types scripts/dev/find-zfighting.ts
// Finds coplanar overlapping faces (z-fighting) in each map's static geometry.
import { buildMap, LOOKS } from "../../src/client/maps.ts";
import { MAPS } from "../../src/shared/types.ts";
type Box = { x: number; y: number; z: number; w: number; h: number; d: number; c: number[]; rot: boolean; src: string; glow: number };
const EPS = 0.004;
for (const map of MAPS.map((m) => m.id)) {
  const boxes: Box[] = [];
  let glow = 0;
  const caller = () => (new Error().stack!.split("\n").map((l) => /maps\.ts:(\d+)/.exec(l)?.[1]).filter((n) => n && Math.abs(Number(n) - 1605) > 12)[0] ?? "?");
  const b = {
    box(x: number, y: number, z: number, w: number, h: number, d: number, c: number[], rx = 0, rz = 0, ry = 0) {
      boxes.push({ x, y, z, w, h, d, c, rot: !!(rx || rz || ry), src: caller(), glow });
    },
    blob() {},
    text() { return 0; },
    glow(k: number) { glow = k; },
  };
  // The scene's own court-area layers (scene.ts arena()).
  const look = LOOKS[map];
  if (look.ground) boxes.push({ x: 0, y: -0.085, z: 0, w: 90, h: 0.1, d: 90, c: look.ground, rot: false, src: "scene ground", glow: 0 });
  boxes.push({ x: 0, y: -0.02, z: 0, w: 11, h: 0.04, d: 21, c: look.apron, rot: false, src: "scene apron", glow: 0 });
  boxes.push({ x: 0, y: -0.005, z: 0, w: 6.096, h: 0.03, d: 13.4112, c: [0, 0, 1], rot: false, src: "scene court", glow: 0 });
  if (map !== "arena") buildMap(b as never, map);
  const flat = boxes.filter((q) => !q.rot);
  const hits = new Map<string, { n: number; area: number; ex: string }>();
  const overl = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const same = (p: number[], q: number[]) => p.every((v, i) => Math.abs(v - q[i]) < 0.01);
  // Faces: top/bottom (y), sides (x), front/back (z). Bucket by plane position.
  for (const axis of ["y", "x", "z"] as const) {
    const faces: { p: number; box: Box }[] = [];
    for (const q of flat) {
      const half = axis === "y" ? q.h / 2 : axis === "x" ? q.w / 2 : q.d / 2;
      faces.push({ p: q[axis] + half, box: q, dir: 1 } as never, { p: q[axis] - half, box: q, dir: -1 } as never);
    }
    faces.sort((u, v) => u.p - v.p);
    for (let i = 0; i < faces.length; i++)
      for (let j = i + 1; j < faces.length && faces[j].p - faces[i].p < EPS; j++) {
        const A = faces[i].box, B = faces[j].box;
        if ((faces[i] as never as { dir: number }).dir !== (faces[j] as never as { dir: number }).dir) continue; // touching, hidden
        if (axis === "y" && (faces[i] as never as { dir: number }).dir < 0 && faces[i].p < 0.05) continue; // undersides at/below ground
        if (A === B || same(A.c, B.c)) continue;
        const ext = (q: Box, ax: string) => (ax === "x" ? [q.x - q.w / 2, q.x + q.w / 2] : ax === "y" ? [q.y - q.h / 2, q.y + q.h / 2] : [q.z - q.d / 2, q.z + q.d / 2]);
        const [u, v] = axis === "y" ? ["x", "z"] : axis === "x" ? ["y", "z"] : ["x", "y"];
        const [a0, a1] = ext(A, u), [b0, b1] = ext(B, u), [c0, c1] = ext(A, v), [d0, d1] = ext(B, v);
        // Interior faces (one box's face inside the other box) are hidden; skip if face is enclosed.
        const area = overl(a0, a1, b0, b1) * overl(c0, c1, d0, d1);
        if (area < 0.01) continue;
        // Hidden if the shared patch sits inside some other solid box.
        const cu = (Math.max(a0, b0) + Math.min(a1, b1)) / 2, cv = (Math.max(c0, d0) + Math.min(c1, d1)) / 2;
        const P: Record<string, number> = { [axis]: faces[i].p, [u]: cu, [v]: cv };
        const inside = (q: Box) => Math.abs(P.x - q.x) < q.w / 2 - 0.002 && Math.abs(P.y - q.y) < q.h / 2 - 0.002 && Math.abs(P.z - q.z) < q.d / 2 - 0.002;
        if (flat.some((q) => q !== A && q !== B && inside(q))) continue;
        // Is the shared plane actually visible? If both faces point into each other's solid, skip.
        const key = [A.src, B.src, axis].sort().join(" × ");
        const h = hits.get(key) ?? { n: 0, area: 0, ex: `${axis}=${faces[i].p.toFixed(3)}` };
        h.n++; h.area += area; hits.set(key, h);
      }
  }
  const list = [...hits.entries()].sort((a, b) => b[1].area - a[1].area);
  console.log(`\n== ${map}: ${flat.length} boxes, ${list.length} coplanar overlap kinds`);
  for (const [k, v] of list.slice(0, 12)) console.log(`  ${v.area.toFixed(1).padStart(8)} m²  ×${v.n}  ${k}  (${v.ex})`);
}
