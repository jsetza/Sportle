import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, extname, dirname } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import {
  createRoom,
  rooms,
  joinController,
  begin,
  acceptInput,
  housekeeping,
  token,
} from "./rooms.ts";
import { step, announce } from "./engine.ts";
import type { Room, Session } from "./rooms.ts";
import type { ServerResponse } from "node:http";
import type { Mode, Difficulty } from "../shared/types.ts";
const source = dirname(fileURLToPath(import.meta.url));
const built = source.includes("/dist/");
const root = resolve(source, "../client");
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || "0.0.0.0";
const origin = (process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
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
        return json(res, { publicOrigin: publicURL, serverTime: Date.now() });
      if (path === "/api/clock") return json(res, { serverTime: Date.now() });
      const ip = req.socket.remoteAddress || "unknown";
      let bucket = rate.get(ip);
      if (!bucket || Date.now() - bucket.t > 60000) {
        bucket = { t: Date.now(), n: 0 };
        rate.set(ip, bucket);
      }
      if (++bucket.n > 12000)
        return json(res, { error: "Too many requests" }, 429);
      if (req.method === "POST" && path === "/api/create") {
        const a = await body(req);
        if (
          !["practice", "solo", "singles", "coop", "doubles"].includes(
            a.mode,
          ) ||
          !["easy", "medium", "hard"].includes(a.difficulty)
        )
          throw Error("Invalid mode");
        if (rooms.size >= 100) throw Error("Server room limit reached");
        const r = createRoom(a.mode as Mode, a.difficulty as Difficulty);
        return json(res, {
          ...view(r),
          credential: r.host,
          pair: r.pair,
          pairExpires: r.pairExpires,
          publicOrigin: publicURL,
        });
      }
      const code = (u.searchParams.get("room") || "").toUpperCase();
      const r = rooms.get(code);
      if (!r) return json(res, { error: "Room not found or expired" }, 404);
      if (path === "/api/join" && req.method === "POST") {
        const a = await body(req);
        if (a.role === "display") {
          const credential = token();
          r.sessions.set(credential, {
            role: "display",
            expires: Date.now() + 86400000,
            lastSeq: -1,
            lastInput: 0,
          });
          r.updated = Date.now();
          return json(res, { ...view(r), credential });
        }
        if (!a.credential) {
          // Rate limit unauthenticated pairing separately, including short-code joins.
          const key = "join:" + ip;
          let b = rate.get(key);
          if (!b || Date.now() - b.t > 60000) {
            b = { t: Date.now(), n: 0 };
            rate.set(key, b);
          }
          if (++b.n > 15)
            return json(
              res,
              { error: "Pairing rate limit; wait a minute" },
              429,
            );
          if (Date.now() > r.pairExpires)
            throw Error(
              "Pairing expired. Ask the host to refresh the QR code.",
            );
          if (a.pair && a.pair !== r.pair) throw Error("Invalid pairing link");
        }
        const name =
          typeof a.name === "string" ? a.name.trim().slice(0, 20) : "Player";
        const result = joinController(
          r,
          name || "Player",
          a.hand === "left" ? "left" : "right",
          a.credential,
        );
        r.updated = Date.now();
        return json(res, { ...view(r), ...result });
      }
      const key = (req.headers.authorization || "").replace(/^Bearer /, "");
      const session = r.sessions.get(key);
      if (!session || session.expires < Date.now())
        return json(res, { error: "Session expired. Rejoin the room." }, 401);
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
        return;
      }
      if (req.method !== "POST") return json(res, { error: "Not found" }, 404);
      const a = await body(req);
      r.updated = Date.now();
      if (path === "/api/input")
        return json(res, { accepted: acceptInput(r, session, a) });
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
        p.ready = false;
        r.state.paused = r.state.phase !== "lobby";
        announce(r.state, p.name + " paused their controller");
        return json(res, { ok: true });
      }
      if (path === "/api/pause" && (session.role === "host" || p)) {
        r.state.paused = true;
        announce(r.state, "Paused");
        return json(res, { ok: true });
      }
      if (session.role !== "host")
        return json(res, { error: "Host action only" }, 403);
      if (path === "/api/start") {
        begin(r);
        return json(res, { ok: true });
      }
      if (path === "/api/resume") {
        if (
          r.state.players.some(
            (p) =>
              !p.bot &&
              (!p.connected || !p.ready || Date.now() - p.lastSeen > 2000),
          )
        )
          throw Error("All phones must reconnect and ready");
        r.state.paused = false;
        announce(r.state, "Play resumed");
        return json(res, { ok: true });
      }
      if (path === "/api/pair") {
        r.pair = token();
        r.pairExpires = Date.now() + 600000;
        return json(res, { pair: r.pair, pairExpires: r.pairExpires });
      }
      return json(res, { error: "Unknown action" }, 404);
    }
    if (req.method !== "GET") return json(res, { error: "Not found" }, 404);
    let file =
      path === "/" || path === "/controller"
        ? resolve(root, "index.html")
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
            : "application/octet-stream";
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch (e) {
    json(
      res,
      { error: e instanceof Error ? e.message : "Request failed" },
      400,
    );
  }
});
let last = performance.now(),
  acc = 0,
  tick = 0;
const interval = setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= 1 / 120) {
    for (const r of rooms.values()) step(r.state);
    acc -= 1 / 120;
  }
  if (++tick % 4 === 0) {
    for (const r of rooms.values()) housekeeping(r);
    for (const [res, { room, session }] of streams) {
      if (!rooms.has(room.code) || session.expires < Date.now()) {
        res.end();
        streams.delete(res);
        continue;
      }
      if (res.writableLength > 65536) continue;
      res.write(`data: ${JSON.stringify(view(room))}\n\n`);
    }
  }
  if (tick % 7200 === 0)
    for (const [k, v] of rate) if (Date.now() - v.t > 60000) rate.delete(k);
}, 8);
server.listen(port, host, () =>
  console.log(
    `visual listening on http://localhost:${port} • phone origin: ${publicURL || "not configured (set PUBLIC_ORIGIN to HTTPS deployment)"}`,
  ),
);
function stop() {
  clearInterval(interval);
  for (const res of streams.keys()) res.end();
  server.close();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
