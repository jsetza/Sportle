import { COURT } from "./types.ts";
import type { Match, Player } from "./types.ts";
/** Foot radius around the character origin used for NVZ line contact. */
export const FOOT = 0.22;
/** Time needed to plant both feet outside the NVZ after leaving it. */
export const FEET_RESET = 0.2;
export const inKitchen = (p: Player) =>
  Math.abs(p.pos.z) <= COURT.kitchen + FOOT;
export const doubles = (m: Match) => m.mode === "coop" || m.mode === "doubles";
export function rightPlayer(m: Match, team: number): Player {
  const ps = m.players.filter((p) => p.team === team);
  return ps[m.score[team] % 2 && ps.length > 1 ? 1 : 0];
}
export function serviceX(m: Match, p: Player) {
  const side = p.team === 0 ? 1 : -1;
  return (
    (doubles(m)
      ? rightPlayer(m, p.team).id === p.id
        ? 1
        : -1
      : m.score[p.team] % 2
        ? -1
        : 1) *
    side *
    1.524
  );
}
export function rotateService(m: Match, winner: number) {
  if (winner === m.serving) {
    m.score[winner]++;
  } else if (doubles(m) && m.serverNumber === 1) {
    m.serverNumber = 2;
    m.serverId = m.players.find(
      (p) => p.team === m.serving && p.id !== m.serverId,
    )!.id;
  } else {
    m.serving = 1 - m.serving;
    m.serverNumber = 1;
    m.serverId = rightPlayer(m, m.serving).id;
  }
  if (gameWon(m, winner)) {
    m.games[winner]++;
    if (m.games[winner] >= Math.ceil(m.rules.bestOf / 2)) {
      m.phase = "over";
      m.winner = winner;
    } else m.gameWinner = winner;
  }
}
/** Has `team` reached the game target with a two-point lead? */
export function gameWon(m: Match, team: number) {
  return (
    m.score[team] >= m.rules.to && m.score[team] - m.score[1 - team] >= 2
  );
}
/** Would winning the next rally end the game for `team`? (game point; needs the serve) */
export function gamePoint(m: Match, team: number) {
  return (
    m.serving === team &&
    m.score[team] + 1 >= m.rules.to &&
    m.score[team] + 1 - m.score[1 - team] >= 2
  );
}
export function contactFault(m: Match, p: Player): string | null {
  if (m.hits < 2 && m.bounces === 0) return "Two-bounce fault";
  if (m.hits === 1 && p.id !== m.receiverId) return "Wrong receiver";
  if (m.bounces === 0 && inKitchen(p)) return "Kitchen volley fault";
  // Rule 9: after entering the NVZ, both feet must be re-established outside before volleying.
  if (m.bounces === 0 && m.time - p.kitchenClearAt < FEET_RESET)
    return "Volley before both feet re-established outside kitchen";
  return null;
}
export function landingFault(m: Match, x: number, z: number): string | null {
  if (Math.abs(x) > COURT.halfWidth || Math.abs(z) > COURT.halfLength)
    return "Out";
  if ((z > 0 ? 0 : 1) === m.lastTeam) return "Ball did not cross net";
  if (m.hits === 1 && (Math.abs(z) <= COURT.kitchen || x * m.serveX > 0))
    return "Service court fault";
  return null;
}
