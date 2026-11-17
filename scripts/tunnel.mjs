/**
 * Development phone test over a real, trusted HTTPS URL — no hosting account required.
 *
 * Starts a Cloudflare "quick tunnel" (https://<random>.trycloudflare.com, a valid public
 * certificate) to a free local port, waits until Cloudflare reports the tunnel connection as
 * registered, then starts this server with PUBLIC_ORIGIN set to that URL so the display's QR
 * points at a public HTTPS origin, never at localhost.
 *
 * Requires the official `cloudflared` binary on PATH:
 *   macOS:   brew install cloudflared   (or the cloudflared-darwin-arm64.tgz release download)
 *   Windows: winget install --id Cloudflare.cloudflared
 *
 * Options (environment variables):
 *   PORT=3001              preferred local port (the next free one is used if it is taken)
 *   TUNNEL_PROTOCOL=http2  use TCP instead of QUIC/UDP (helps on networks that block UDP)
 *
 * Quick tunnels are for testing: the URL changes every run and has no uptime guarantee.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";

const entry = existsSync("dist/server/index.js")
  ? "dist/server/index.js"
  : "src/server/index.ts";
let tunnel = null,
  server = null;
const cleanup = () => {
  server?.kill("SIGTERM");
  tunnel?.kill("SIGTERM");
};
const fail = (msg) => {
  console.error("\n" + msg + "\n");
  cleanup();
  process.exit(1);
};
const tail = (s) => s.trim().split("\n").slice(-8).join("\n");

/** First free port at or after `start` on 127.0.0.1. */
const freePort = (start) =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(freePort(start + 1)));
    probe.listen(start, "127.0.0.1", () => probe.close(() => resolve(start)));
  });
const wanted = Number(process.env.PORT || 3000);
const port = await freePort(wanted);
if (port !== wanted)
  console.log(
    `Port ${wanted} is busy (an older game still running?), so using ${port}.`,
  );

const args = ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`];
if (process.env.TUNNEL_PROTOCOL)
  args.push("--protocol", process.env.TUNNEL_PROTOCOL);
tunnel = spawn("cloudflared", args, { stdio: ["ignore", "pipe", "pipe"] });
tunnel.on("error", () =>
  fail(
    "cloudflared was not found on PATH.\n" +
      'macOS: brew install cloudflared  (or run with PATH="$HOME/cloudflared-bin:$PATH")\n' +
      "Windows: winget install --id Cloudflare.cloudflared\n" +
      "Then run `npm run tunnel` again.",
  ),
);

console.log("Connecting the tunnel to Cloudflare…");
let log = "",
  connected = false;
const url = await new Promise((resolve) => {
  let found = null,
    registered = false;
  const onData = (d) => {
    log += d;
    // The game's address, not Cloudflare's own api.trycloudflare.com endpoint.
    for (const m of log.matchAll(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/g))
      if (m[1] !== "api") found ||= m[0];
    registered ||= /Registered tunnel connection/i.test(log);
    if (found && registered) {
      connected = true;
      resolve(found);
    }
  };
  tunnel.stdout.on("data", onData);
  tunnel.stderr.on("data", onData);
  tunnel.on("exit", (c) => {
    if (connected)
      fail(
        "The Cloudflare tunnel closed (free quick tunnels can drop at any time).\n" +
          "Run the same command again and use the NEW link it prints.\n\n" +
          tail(log),
      );
    fail(
      "cloudflared stopped (code " +
        c +
        ") before the tunnel connected.\n" +
        (/lookup|no such host|dial/i.test(log)
          ? "It could not reach Cloudflare: check your internet connection, or try a phone hotspot.\n"
          : "") +
        "\n" +
        tail(log),
    );
  });
  setTimeout(() => {
    if (connected) return;
    const blocked = /quic|7844|dial|timeout|refused|failed/i.test(log);
    fail(
      "The tunnel did not connect within 45 seconds." +
        (blocked
          ? "\nYour network seems to block Cloudflare tunnels (common on school or work Wi-Fi)." +
            "\nTry:  TUNNEL_PROTOCOL=http2 npm run tunnel" +
            "\nIf that also fails, connect the computer to a phone hotspot or home Wi-Fi."
          : "") +
        "\n\nLast cloudflared output:\n" +
        tail(log),
    );
  }, 45000).unref();
});

server = spawn(process.execPath, ["--env-file-if-exists=.env", entry], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    PUBLIC_ORIGIN: url,
  },
});
server.on("exit", (c) => {
  if (c)
    fail(
      "The game server stopped unexpectedly (code " +
        c +
        "), so the tunnel was closed.",
    );
  else cleanup();
});
console.log(`
  ┌───────────────────────────────────────────────────────────────
  │  Tunnel connected. Your game's public address:
  │  ${url}
  │  1. Open that address in your computer or TV browser (not localhost).
  │     If Cloudflare shows an error page, wait ~20 seconds and refresh.
  │  2. Pick a mode → Create game, then scan the QR with your phone.
  │  The address changes each run. Ctrl+C stops the tunnel and the game.
  └───────────────────────────────────────────────────────────────
`);
const stop = () => {
  cleanup();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
