/**
 * Sportle Boxing "Behind you" camera: at rest, your own fighter's solid parts (the gloves, and
 * the see-through head) must not cover the opponent's head or chest on screen, in a full view
 * and in a side-by-side split view; and a jab's glove must still travel toward the opponent.
 * Pure projection maths with the renderer's own camera(); no browser needed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { camera } from "../src/client/scene.ts";
import { BEHIND, GLOVE_R, REST_GLOVES, behindCam } from "../src/client/boxscene.ts";
import { RING } from "../src/shared/boxing.ts";

type V = number[];
/** Clip-space projection → normalised screen (x right, y up, both −1..1) and depth w. */
function project(vp: V, p: V) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12],
    y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13],
    w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  return { x: x / w, y: y / w, w };
}
/** A sphere's screen radius (in the y unit), from the vertical field of view. */
const radius = (r: number, w: number, fov: number) => r / (w * Math.tan(((fov / 2) * Math.PI) / 180));

for (const corner of [0, 1] as const)
  for (const [label, aspect] of [
    ["full screen", 16 / 9],
    ["split screen", 8 / 9],
  ] as const)
    test(`behind-you camera: the opponent stays clear at rest (corner ${corner}, ${label})`, () => {
      const facing = corner ? -1 : 1;
      const me = { x: 0, z: RING.start * facing, facing };
      const opp = { x: 0, z: -RING.start * facing };
      // Own frame → world (right = facing · x, forward = −facing · z).
      const mine = (q: V): V => [me.x + facing * q[0], q[1], me.z - facing * q[2]];
      const theirs = (q: V): V => [opp.x - facing * q[0], q[1], opp.z + facing * q[2]];
      for (const dodge of ["", "left", "right"]) {
        const cam = behindCam(me, opp, dodge);
        const vp = camera(aspect, cam.eye, cam.target, cam.fov, 0);
        const sx = (p: { x: number; y: number }) => ({ x: p.x * aspect, y: p.y }); // square units
        const targets: [string, V][] = [
          ["head", theirs([0, 1.3, 0])],
          ["chest", theirs([0, 0.95, 0])],
          ...REST_GLOVES.stance.map((g, i) => ["glove " + i, theirs(g)] as [string, V]),
        ];
        const blockers: [string, V, number][] = [
          ...[...REST_GLOVES.stance, ...REST_GLOVES.guard].map((g, i) => ["my glove " + i, mine(g), GLOVE_R] as [string, V, number]),
          ["my head (see-through)", mine([0, 1.3, 0]), 0.25],
        ];
        for (const [tn, t] of targets) {
          const pt = project(vp, t);
          assert.ok(Math.abs(pt.x) < 0.9 && Math.abs(pt.y) < 0.9, `${tn} on screen (${label}, dodge ${dodge || "none"})`);
          for (const [bn, b, r] of blockers) {
            const pb = project(vp, b);
            if (pb.w >= pt.w) continue; // behind the target
            const a = sx(pt),
              c = sx(pb);
            const d = Math.hypot(a.x - c.x, a.y - c.y);
            const rr = radius(r, pb.w, cam.fov) * 1.1;
            // Gloves fully clear; a slip may graze the opponent's gloves, never the head or chest.
            if (tn.startsWith("glove") && dodge) continue;
            assert.ok(d > rr, `${bn} covers the opponent's ${tn} (${label}, corner ${corner}, dodge ${dodge || "none"}): ${d.toFixed(3)} ≤ ${rr.toFixed(3)}`);
          }
        }
      }
      // A jab still reads: the glove travels from its rest spot toward the opponent's head on screen.
      const cam = behindCam(me, opp, "");
      const vp = camera(aspect, cam.eye, cam.target, cam.fov, 0);
      const head = project(vp, theirs([0, 1.3, 0]));
      const rest = project(vp, mine(REST_GLOVES.stance[0])),
        out = project(vp, mine([0.1, 1.38, 0.92]));
      const dist = (p: { x: number; y: number }) => Math.hypot((p.x - head.x) * aspect, p.y - head.y);
      assert.ok(dist(out) < dist(rest) * 0.6, `the jab moves toward the opponent: ${dist(rest).toFixed(2)} → ${dist(out).toFixed(2)}`);
      assert.ok(out.w > rest.w, "and away from the camera");
    });

test("behind-you camera sits up and over a shoulder", () => {
  assert.ok(BEHIND.up > 2.2 && Math.abs(BEHIND.side) > 0.4, JSON.stringify(BEHIND));
});
