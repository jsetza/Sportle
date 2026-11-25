import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, extname, dirname } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import {
  createRoom,
  rooms,
  joinController,
  issuePair,
  checkPair,
  setTeam,
  acceptMove,
  rematch,
  begin,
  setRules,
  chooseSide,
  swapSides,
  dropPause,
  hostPause,
  resume,
  acceptInput,
  housekeeping,
  token,
} from "./rooms.ts";
import { step, announce } from "./engine.ts";
import { createBowlRoom, joinBowler } from "./rooms.ts";
import {
  botForTurn,
  reorder,
  setOptions,
  skipTurn,
  startBowl,
  stepBowl,
} from "./bowling.ts";
import { LANES, MAX_BOWLERS } from "../shared/bowling.ts";
import { createKartRoom, joinRacer } from "./rooms.ts";
import {
  botForNow,
  humans as kartHumans,
  kartBackground,
  kartLive,
  kartView,
  nextRace,
  setOptions as kartOptions,
  startKart,
  stepKart,
  toLobby,
} from "./kart.ts";
import { BODIES, CUP } from "../shared/kart.ts";
import type { BodyId, BotLevel as KartBot, KartMode, TrackId } from "../shared/kart.ts";
import type { BotLevel, LaneId } from "../shared/bowling.ts";
import {
  createLobby,
  search,
  cancel,
  matchmake,
  rankedTick,
  setRank,
} from "./ranked.ts";
import { loadRatings, saveRatings, leaderboard, rankId } from "./ratings.ts";
import type { RankedQueue } from "../shared/types.ts";
import type { Room, Session } from "./rooms.ts";
import { detectOrigin, detectPlatform, clientIp } from "./hosting.ts";
import type { ServerResponse } from "node:http";
import type { Mode, Difficulty, MapId, Outfit } from "../shared/types.ts";
import { MAPS, OUTFITS, cleanGear, cleanRules } from "../shared/types.ts";
const source = dirname(fileURLToPath(import.meta.url));
const built = source.includes("/dist/");
const root = resolve(source, "../client");
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || "0.0.0.0";
const origin = detectOrigin(process.env).replace(/\/$/, "");
const platform = detectPlatform(process.env);
export function publicOrigin(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
      u.pathname === "/" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
      ? u.origin
      : null;
  } catch {
    return null;
  }
}
const publicURL = publicOrigin(origin);
const streams = new Map<ServerResponse, { room: Room; session: Session }>();
const rate = new Map<string, { t: number; n: number }>();
function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}
function view(r: Room) {
  if (r.kart)
    return { code: r.code, game: "kart", state: kartView(r.kart), serverTime: Date.now() };
  if (r.bowl)
    return { code: r.code, game: "bowling", state: r.bowl, serverTime: Date.now() };
  return { code: r.code, state: r.state, serverTime: Date.now() };
}
async function body(req: any) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8192) throw Error("Request too large");
  }
  return JSON.parse(text || "{}");
}
/** Music files the owner supplies under src/client/music/ (licensed audio only). */
const AUDIO: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
};
/** Supplied music files by style, e.g. { house: "/music/house.mp3" } (checked per request). */
function musicFiles() {
  const out: Record<string, string> = {};
  try {
    for (const f of readdirSync(resolve(root, "music"))) {
      const m = /^(house|chill|synthwave|lofi)\.(mp3|m4a|ogg|wav)$/.exec(f);
      if (m && !out[m[1]]) out[m[1]] = "/music/" + f;
    }
  } catch {
    /* no music folder */
  }
  return out;
}
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(self), gyroscope=(self), magnetometer=(self)",
  );
  try {
    const u = new URL(req.url || "/", `http://${req.headers.host}`),
      path = u.pathname;
    // Health check for hosting platforms (Render healthCheckPath, Fly checks, uptime monitors).
    if (path === "/healthz")
      return json(res, {
        ok: true,
        rooms: rooms.size,
        uptime: process.uptime(),
      });
    if (path.startsWith("/api/")) {
      const requestOrigin = req.headers.origin;
      if (
        requestOrigin &&
        requestOrigin !== publicURL &&
        requestOrigin !== `http://${req.headers.host}` &&
        requestOrigin !== `https://${req.headers.host}`
      )
        return json(res, { error: "Origin rejected" }, 403);
      if (path === "/api/config")
        return json(res, {
          publicOrigin: publicURL,
          serverTime: Date.now(),
          music: musicFiles(),
        });
      if (path === "/api/clock") return json(res, { serverTime: Date.now() });
      const ip = clientIp(req.headers, req.socket.remoteAddress, platform);
      const authed = /^Bearer ./.test(req.headers.authorization || "");
      // Per-IP limits apply to unauthenticated traffic only. Authenticated controller traffic is
      // budgeted per session below, so several households behind one NAT are not throttled together.
      if (!authed) {
        let bucket = rate.get(ip);
        if (!bucket || Date.now() - bucket.t > 60000) {
          bucket = { t: Date.now(), n: 0 };
          rate.set(ip, bucket);
        }
        if (++bucket.n > 1200)
          return json(res, { error: "Too many requests" }, 429);
      }
      if (req.method === "POST" && path === "/api/create") {
        const a = await body(req);
        if (a.game === "kart") {
          if (rooms.size >= 100) throw Error("Server room limit reached");
          const mode = (["race", "cup", "trial"].includes(a.mode) ? a.mode : "race") as KartMode;
          const trackId = (CUP.includes(a.track) ? a.track : "court") as TrackId;
          const bot = (["rookie", "club", "pro"].includes(a.bot) ? a.bot : "club") as KartBot;
          const laps = Number.isInteger(a.laps) && a.laps >= 1 && a.laps <= 5 ? a.laps : 3;
          const r = createKartRoom(mode, trackId, bot, a.items !== false, laps);
          if (a.shared === true) r.kart!.shared = true;
          return json(res, {
            ...view(r),
            credential: r.host,
            displayId: "host",
            pair: r.pair,
            pairExpires: r.pairExpires,
            publicOrigin: publicURL,
          });
        }
        if (a.game === "bowling") {
          if (rooms.size >= 100) throw Error("Server room limit reached");
          const lane = (LANES.some((l) => l.id === a.lane) ? a.lane : "neon") as LaneId;
          const bot = (["easy", "medium", "hard"].includes(a.bot) ? a.bot : "") as BotLevel;
          const r = createBowlRoom(
            a.mode === "practice" ? "practice" : "game",
            lane,
            bot,
            a.players === "single" ? 1 : MAX_BOWLERS,
          );
          return json(res, {
            ...view(r),
            credential: r.host,
            displayId: "host",
            pair: r.pair,
            pairExpires: r.pairExpires,
            publicOrigin: publicURL,
          });
        }
        if (
          !["practice", "solo", "singles", "coop", "doubles"].includes(
            a.mode,
          ) ||
          !["easy", "medium", "hard"].includes(a.difficulty)
        )
          throw Error("Invalid mode");
        if (rooms.size >= 100) throw Error("Server room limit reached");
        const map = (
          MAPS.some((m) => m.id === a.map) ? a.map : "arena"
        ) as MapId;
        const ranked = (
          a.ranked === "1v1" || a.ranked === "2v2" ? a.ranked : null
        ) as RankedQueue | null;
        const r = ranked
          ? createLobby(ranked, map)
          : createRoom(
              a.mode as Mode,
              a.difficulty as Difficulty,
              map,
              cleanRules(a.rules),
            );
        return json(res, {
          ...view(r),
          credential: r.host,
          displayId: "host",
          pair: r.pair,
          pairExpires: r.pairExpires,
          publicOrigin: publicURL,
        });
      }
      if (path === "/api/leaderboard" && req.method === "GET")
        return json(res, { top: leaderboard(20) });
      const code = (u.searchParams.get("room") || "").toUpperCase();
      // Room codes are short, so guessing them is rate limited per visitor: too many
      // unknown codes in a minute blocks further lookups (checked before the lookup).
      const missKey = "miss:" + ip;
      const miss = rate.get(missKey);
      if (!authed && miss && Date.now() - miss.t <= 60000 && miss.n >= 20)
        return json(
          res,
          { error: "Too many wrong room codes; wait a minute" },
          429,
        );
      const r = rooms.get(code);
      if (!r) {
        if (!authed) {
          const m0 =
            miss && Date.now() - miss.t <= 60000
              ? miss
              : { t: Date.now(), n: 0 };
          m0.n++;
          rate.set(missKey, m0);
        }
        return json(res, { error: "Room not found or expired" }, 404);
      }
      if (path === "/api/join" && req.method === "POST") {
        const a = await body(req);
        if (a.role === "display") {
          const credential = token();
          const s: Session = {
            role: "display",
            expires: Date.now() + 86400000,
            lastSeq: -1,
            lastInput: 0,
          };
          r.sessions.set(credential, s);
          r.updated = Date.now();
          // Each household display gets its own pairing QR for its own phones.
          return json(res, {
            ...view(r),
            credential,
            ...issuePair(r, s),
            displayId: s.displayId,
            publicOrigin: publicURL,
          });
        }
        let preferTeam: number | null = null,
          display = "";
        if (!a.credential) {
          // Rate limit unauthenticated pairing separately, including short-code joins.
          // Manual room-code joins are guessable, so they get a strict per-IP limit.
          // QR joins carry an unguessable pairing token and get a looser one.
          const manual = !a.pair;
          const key = (manual ? "join:" : "qrjoin:") + ip;
          let b = rate.get(key);
          if (!b || Date.now() - b.t > 60000) {
            b = { t: Date.now(), n: 0 };
            rate.set(key, b);
          }
          if (++b.n > (manual ? 15 : 240))
            return json(
              res,
              { error: "Pairing rate limit; wait a minute" },
              429,
            );
          ({ team: preferTeam, display } = checkPair(r, a.pair));
        }
        const name =
          typeof a.name === "string" ? a.name.trim().slice(0, 20) : "Player";
        if (r.kart) {
          const result = joinRacer(
            r,
            name || "Driver",
            a.credential,
            display,
            (OUTFITS.some((o) => o.id === a.outfit) ? a.outfit : "classic") as Outfit,
            cleanGear(a.gear),
            (BODIES.some((b) => b.id === a.body) ? a.body : "classic") as BodyId,
            Number.isInteger(a.color) ? a.color : 0,
          );
          r.updated = Date.now();
          r.kart.event++;
          return json(res, { ...view(r), ...result });
        }
        if (r.bowl) {
          const result = joinBowler(
            r,
            name || "Player",
            a.hand === "left" ? "left" : "right",
            a.credential,
            display,
            (OUTFITS.some((o) => o.id === a.outfit) ? a.outfit : "classic") as Outfit,
            cleanGear(a.gear),
          );
          r.updated = Date.now();
          r.bowl.event++;
          return json(res, { ...view(r), ...result });
        }
        const result = joinController(
          r,
          name || "Player",
          a.hand === "left" ? "left" : "right",
          a.credential,
          preferTeam,
          display,
          (OUTFITS.some((o) => o.id === a.outfit)
            ? a.outfit
            : "classic") as Outfit,
          cleanGear(a.gear),
        );
        // Ranked identity: the phone's own random key (only a hash is kept on the server).
        if (r.state.ranked) setRank(r, result.player.id, rankId(a.rankKey));
        r.updated = Date.now();
        return json(res, { ...view(r), ...result });
      }
      const key = (req.headers.authorization || "").replace(/^Bearer /, "");
      const session = r.sessions.get(key);
      if (!session || session.expires < Date.now())
        return json(res, { error: "Session expired. Rejoin the room." }, 401);
      const sb = rate.get("s:" + key);
      const sbucket =
        sb && Date.now() - sb.t <= 60000 ? sb : { t: Date.now(), n: 0 };
      rate.set("s:" + key, sbucket);
      // ~30 Hz input + ~25 Hz state polling + control calls fit; 7200/min = 120 req/s.
      if (++sbucket.n > 7200)
        return json(res, { error: "Too many requests" }, 429);
      // Polling fallback for paths that cannot stream SSE (e.g. Cloudflare quick tunnels).
      if (path === "/api/state" && req.method === "GET") {
        r.updated = Date.now();
        return json(res, view(r));
      }
      if (path === "/api/events" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`data: ${JSON.stringify(view(r))}\n\n`);
        streams.set(res, { room: r, session });
        req.on("close", () => streams.delete(res));
        res.on("error", () => streams.delete(res));
        return;
      }
      if (req.method !== "POST") return json(res, { error: "Not found" }, 404);
      const a = await body(req);
      r.updated = Date.now();
      if (path === "/api/input")
        return json(res, { accepted: acceptInput(r, session, a) });
      if (path === "/api/move")
        return json(res, { accepted: acceptMove(r, session, a) });
      if (r.kart) {
        const k = r.kart;
        const kp = k.racers.find((p) => p.id === session.playerId && !p.bot);
        if (path === "/api/ready" && kp) {
          if (!kartLive(kp)) throw Error("Turn on motion and set the centre first");
          kp.ready = !!a.ready;
          k.event++;
          return json(res, { ok: true });
        }
        if (path === "/api/background" && kp) {
          kartBackground(k, kp);
          return json(res, { ok: true });
        }
        if (path === "/api/pair" && session.role !== "controller")
          return json(res, issuePair(r, session, null));
        // Pause: the host screen, or the phone in a one-driver race.
        if (path === "/api/pause" || path === "/api/resume") {
          if (session.role === "controller" && !(kp && kartHumans(k).length === 1))
            return json(res, { error: "Only the host can pause a race with several drivers" }, 403);
          if (k.phase === "countdown" || k.phase === "race") k.paused = path === "/api/pause";
          k.message = k.paused ? "Paused" : "Racing";
          k.event++;
          return json(res, { ok: true });
        }
        if (path === "/api/kart/layout" && session.role !== "controller") {
          kartOptions(k, { shared: !!a.shared });
          return json(res, { ok: true });
        }
        if (session.role !== "host") return json(res, { error: "Host action only" }, 403);
        if (path === "/api/start") startKart(k);
        else if (path === "/api/kart/next") nextRace(k);
        else if (path === "/api/kart/lobby") toLobby(k);
        else if (path === "/api/kart/options") kartOptions(k, a);
        else if (path === "/api/kart/bot") botForNow(k, String(a.id || ""));
        else return json(res, { error: "Unknown action" }, 404);
        return json(res, { ok: true });
      }
      if (r.bowl) {
        const b = r.bowl;
        const bp = b.players.find((p) => p.id === session.playerId);
        if (path === "/api/ready" && bp) {
          if (!bp.sensors || !bp.calibrated || Date.now() - bp.lastSeen > 2000)
            throw Error("Turn on motion and aim at the screen first");
          bp.ready = !!a.ready;
          b.event++;
          return json(res, { ok: true });
        }
        if (path === "/api/background" && bp) {
          bp.connected = false;
          b.event++;
          return json(res, { ok: true });
        }
        if (path === "/api/pair" && session.role !== "controller")
          return json(res, issuePair(r, session, null));
        if ((path === "/api/pause" || path === "/api/resume") && (session.role !== "controller" || bp)) {
          if (b.phase !== "lobby" && b.phase !== "over") b.paused = path === "/api/pause";
          b.message = b.paused ? "Paused · press Resume to keep bowling" : "Back to bowling";
          b.event++;
          return json(res, { ok: true });
        }
        if (session.role !== "host")
          return json(res, { error: "Host action only" }, 403);
        if (path === "/api/start" || path === "/api/rematch") startBowl(b);
        else if (path === "/api/bowl/order") reorder(b, a.ids);
        else if (path === "/api/bowl/options") setOptions(b, a);
        else if (path === "/api/bowl/skip") skipTurn(b);
        else if (path === "/api/bowl/bot") botForTurn(b);
        else return json(res, { error: "Unknown action" }, 404);
        return json(res, { ok: true });
      }
      const p = r.state.players.find((p) => p.id === session.playerId);
      if (path === "/api/ready" && p) {
        if (
          !p.input.sensors ||
          !p.input.calibrated ||
          Date.now() - p.lastSeen > 2000
        )
          throw Error("Enable sensors and calibrate first");
        p.ready = !!a.ready;
        return json(res, { ok: true });
      }
      if (path === "/api/background" && p) {
        p.connected = false;
        dropPause(
          r,
          p.name + " left the game screen · resumes when they're back",
        );
        return json(res, { ok: true });
      }
      if (path === "/api/side" && p) {
        chooseSide(r, p.id, a.side);
        return json(res, { ok: true });
      }
      if (path === "/api/swap" && session.role !== "controller") {
        swapSides(r, session.displayId || "host");
        return json(res, { ok: true });
      }
      if (path === "/api/pause" && (session.role !== "controller" || p)) {
        hostPause(r);
        return json(res, { ok: true });
      }
      if (path === "/api/resume" && (session.role !== "controller" || p)) {
        resume(r);
        return json(res, { ok: true });
      }
      if (path === "/api/pair" && session.role !== "controller") {
        const team = a.team === 0 || a.team === 1 ? a.team : null;
        return json(res, issuePair(r, session, team));
      }
      if (session.role !== "host")
        return json(res, { error: "Host action only" }, 403);
      if (path === "/api/ranked/search") {
        search(r);
        return json(res, { ok: true });
      }
      if (path === "/api/ranked/cancel") {
        cancel(r);
        return json(res, { ok: true });
      }
      if (r.state.ranked && (path === "/api/start" || path === "/api/rematch"))
        throw Error("Ranked matches start by themselves");
      if (path === "/api/rules") {
        setRules(r, a.rules, a.difficulty);
        return json(res, { ok: true });
      }
      if (path === "/api/team") {
        setTeam(r, String(a.playerId || ""), Number(a.team));
        return json(res, { ok: true });
      }
      if (path === "/api/rematch") {
        rematch(r);
        return json(res, { ok: true });
      }
      if (path === "/api/start") {
        begin(r);
        return json(res, { ok: true });
      }
      return json(res, { error: "Unknown action" }, 404);
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      return json(res, { error: "Not found" }, 404);
    let file =
      path === "/" || path === "/controller"
        ? resolve(root, "index.html")
        : path === "/bowling" || path === "/bowling/phone"
          ? resolve(root, "bowling.html")
        : path === "/kart" || path === "/kart/phone"
          ? resolve(root, "kart.html")
        : resolve(root, "." + decodeURIComponent(path));
    if (path.startsWith("/shared/")) file = resolve(source, "..", "." + path);
    const allowed =
      file.startsWith(root + "/") ||
      file.startsWith(resolve(source, "../shared") + "/");
    if (!allowed) throw Error("Invalid path");
    if (!built && file.endsWith(".js")) file = file.slice(0, -3) + ".ts";
    if (!existsSync(file)) {
      res.writeHead(404);
      return res.end("Not found");
    }
    let content = await readFile(file);
    if (file.endsWith(".ts"))
      content = Buffer.from(
        stripTypeScriptTypes(content.toString()).replaceAll(
          /(from\s+['"][^'"]+)\.ts(['"])/g,
          "$1.js$2",
        ),
      );
    const type =
      file.endsWith(".ts") || file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".html")
            ? "text/html"
            : AUDIO[file.slice(file.lastIndexOf(".") + 1)] ??
              "application/octet-stream";
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    // Audio: byte ranges (Safari won't play audio without them) and a long cache.
    if (AUDIO[file.slice(file.lastIndexOf(".") + 1)]) {
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "public, max-age=86400");
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
      if (range) {
        const size = content.length;
        let start = range[1] ? Number(range[1]) : size - Number(range[2]);
        let end = range[1] && range[2] ? Number(range[2]) : size - 1;
        start = Math.max(0, start);
        end = Math.min(size - 1, end);
        if (start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${size}` });
          return res.end();
        }
        res.writeHead(206, {
          "Content-Type": type,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": end - start + 1,
        });
        return res.end(req.method === "HEAD" ? undefined : content.subarray(start, end + 1));
      }
    }
    // Game code and pages: always check for the current version, so a deploy never leaves a
    // browser running a mix of old and new files (audio keeps its day-long cache above).
    if (!AUDIO[file.slice(file.lastIndexOf(".") + 1)]) res.setHeader("Cache-Control", "no-cache");
    res.writeHead(200, { "Content-Type": type, "Content-Length": content.length });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (e) {
    json(
      res,
      { error: e instanceof Error ? e.message : "Request failed" },
      400,
    );
  }
});
/**
 * One room's bug must never take down the server (and every other room and the tunnel with it).
 * Pause that match with a visible message and log the error for diagnosis.
 */
function safely(r: Room, fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.error(`[room ${r.code}] simulation error:`, e);
    if (r.kart && !r.kart.paused) {
      r.kart.paused = true;
      r.kart.message = "Something went wrong in this race. Host: press Resume.";
      r.kart.event++;
    }
    if (r.bowl && !r.bowl.paused) {
      r.bowl.paused = true;
      r.bowl.message = "Something went wrong in this game. Host: press Resume.";
      r.bowl.event++;
    }
    if (!r.bowl && !r.kart && !r.state.paused) {
      r.state.paused = true;
      r.state.pauseReason = "host";
      r.state.message =
        "Something went wrong in this match. Host: press Resume.";
      r.state.event++;
    }
  }
}
let last = performance.now(),
  acc = 0,
  tick = 0;
const interval = setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= 1 / 120) {
    for (const r of rooms.values())
      safely(r, () =>
        r.kart ? stepKart(r.kart) : r.bowl ? stepBowl(r.bowl) : step(r.state),
      );
    acc -= 1 / 120;
  }
  if (++tick % 4 === 0) {
    for (const r of rooms.values()) safely(r, () => housekeeping(r));
    for (const r of [...rooms.values()]) safely(r, () => rankedTick(r));
    for (const [res, { room, session }] of streams) {
      if (!rooms.has(room.code) || session.expires < Date.now()) {
        res.end();
        streams.delete(res);
        continue;
      }
      if (res.writableLength > 65536) continue;
      if (res.destroyed || res.writableEnded) {
        streams.delete(res);
        continue;
      }
      try {
        res.write(`data: ${JSON.stringify(view(room))}\n\n`);
      } catch {
        streams.delete(res);
      }
    }
  }
  if (tick % 120 === 0)
    try {
      matchmake();
    } catch (e) {
      console.error("[ranked] matchmaking error:", e);
    }
  if (tick % 3600 === 0) saveRatings();
  if (tick % 7200 === 0)
    for (const [k, v] of rate) if (Date.now() - v.t > 60000) rate.delete(k);
}, 8);
// Last line of defence: a stray error (a dropped phone mid-write, a bad request) is logged,
// never allowed to stop the process and end every game on the server.
process.on("uncaughtException", (e) => console.error("[server] uncaught:", e));
process.on("unhandledRejection", (e) =>
  console.error("[server] unhandled:", e),
);
server.on("clientError", (_e, socket) => socket.destroy());
loadRatings();
for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.on(sig, () => {
    saveRatings();
    process.exit(0);
  });
server.listen(port, host, () =>
  console.log(
    `Sportle listening on http://localhost:${port} • host: ${platform} • phone origin: ${publicURL || "not configured (set PUBLIC_ORIGIN to HTTPS deployment)"}`,
  ),
);
function stop() {
  clearInterval(interval);
  for (const res of streams.keys()) res.end();
  server.close();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
