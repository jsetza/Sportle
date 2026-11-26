/**
 * Seeded fall hunt (developer tool): the same race as the CI test "bots: a full race with items on
 * every track" (Club bots, items on, 2 laps, the phone's kart driven by a Pro bot), over many
 * seeds. Prints every fall with the kart's last moments, so any failure can be replayed exactly.
 * Run: node scripts/dev/kart-falls.ts [tracks=all] [seeds=200] [firstSeed=1] [verbose]
 */
import { newKart, addRacer, kartInput, startKart, stepKart, physOf } from "../../src/server/kart.ts";
import { TRACKS, track } from "../../src/shared/kart.ts";
import type { TrackId } from "../../src/shared/kart.ts";
import { DEFAULT_GEAR } from "../../src/shared/types.ts";
import type { Input } from "../../src/shared/types.ts";

const ids = (process.argv[2] && process.argv[2] !== "all" ? process.argv[2].split(",") : TRACKS.map((t) => t.id)) as TrackId[];
const seeds = Number(process.argv[3] || 200),
  first = Number(process.argv[4] || 1),
  verbose = process.argv[5] === "verbose";
/** One seeded race; returns the falls (with history) and whether it finished. */
export function seededRace(id: TrackId, seed: number) {
  const t = track(id);
  const k = newKart("race", id, (process.env.LEVEL || "club") as "club", true, Number(process.env.LAPS || 2));
  k.seed = seed;
  let now = 5_000_000;
  const me = addRacer(k, "h", "Me", "classic", { ...DEFAULT_GEAR }, "classic", 0);
  kartInput(k, me, { seq: 1, t: now, pitch: 0, roll: 0, yaw: 0, strength: 0, direction: 0, swing: false, sensors: true, calibrated: true, mx: 0, mz: 1 } as Input, now);
  me.ready = true;
  startKart(k, now);
  me.bot = "pro";
  const hist = new Map<string, string[]>();
  const falls: { who: string; at: string; history: string[] }[] = [];
  // Also report a kart whose road position jumps to another part of the track in one step (e.g.
  // another level of the garage spiral) without a cannon, drone or respawn: that would put it on
  // the wrong floor.
  const lastHint = new Map<string, number>();
  for (let i = 0; i < 120 * 300 && k.phase !== "results"; i++) {
    now += 1000 / 120;
    stepKart(k, 1 / 120, now);
    for (const r of k.racers) {
      const p = physOf(r);
      const H = hist.get(r.id) ?? [];
      hist.set(r.id, H);
      H.push(`t${k.clock.toFixed(2)} f${(r.s / t.L).toFixed(3)} i${p.hint} d${r.d.toFixed(2)} y${r.y.toFixed(2)} road${t.y[p.hint].toFixed(2)} g${t.ground[p.hint]} air${+r.air} vy${p.vy.toFixed(2)} v${r.v.toFixed(2)} m${p.m.toFixed(2)} h${r.h.toFixed(2)} spin${r.spin.toFixed(2)} wob${r.wobble.toFixed(2)} cut${+p.onCut} cannon${r.cannon.toFixed(1)}`);
      if (H.length > 240) H.shift();
      // (Cannon flights, drone pickups, respawns and shortcut strips move the kart on purpose.)
      const was = lastHint.get(r.id);
      if (p.onCut || r.lift || r.cannon || k.phase !== "race") lastHint.delete(r.id);
      else lastHint.set(r.id, p.hint);
      const jump = was === undefined ? 0 : Math.min(Math.abs(p.hint - was), t.n - Math.abs(p.hint - was));
      if (jump > 25 && lastHint.has(r.id))
        falls.push({ who: r.name + " (jumped " + jump + " samples)", at: `${(r.s / t.L).toFixed(3)} d ${r.d.toFixed(1)}`, history: H.slice() });
      if (r.lift > 1.49 && r.lift - 1.5 > -1 / 240) falls.push({ who: r.name, at: `${(r.s / t.L).toFixed(3)} d ${r.d.toFixed(1)}`, history: H.slice() });
    }
  }
  return { falls, finished: k.phase === "results" };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const id of ids) {
    let bad = 0,
      falls = 0;
    for (let s = first; s < first + seeds; s++) {
      const r = seededRace(id, s);
      if (r.falls.length || !r.finished) {
        bad++;
        falls += r.falls.length;
        console.log(`${id} seed ${s}: ${r.falls.length} fall(s) ${r.finished ? "" : "UNFINISHED "}${r.falls.map((f) => f.who + " @" + f.at).join("; ")}`);
        if (verbose) for (const f of r.falls) console.log(f.history.filter((_, j) => j % 6 === 0 || j > f.history.length - 6).join("\n"));
      }
    }
    console.log(`== ${id}: ${seeds} seeded races, ${bad} with a fall or unfinished, ${falls} falls`);
  }
}
