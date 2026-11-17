/**
 * Development phone test over a real, trusted HTTPS URL — no hosting account required.
 *
 * Starts a Cloudflare "quick tunnel" (https://<random>.trycloudflare.com, a valid public
 * certificate), waits for its URL, then starts this server with PUBLIC_ORIGIN set to it so
 * the display's QR points at a public HTTPS origin, never at localhost.
 *
 * Requires the official `cloudflared` binary on PATH:
 *   macOS:   brew install cloudflared
 *   Windows: winget install --id Cloudflare.cloudflared
 *   Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
 *
 * Quick tunnels are for testing: the URL changes every run and has no uptime guarantee.
 * For a stable address, deploy (docs/DEPLOYMENT.md).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const port = process.env.PORT || "3000";
const entry = existsSync("dist/server/index.js")
  ? "dist/server/index.js"
  : "src/server/index.ts";

let tunnel;
try {
  tunnel = spawn(
    "cloudflared",
    ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
} catch {
  tunnel = null;
}
const fail = (msg) => {
  console.error("\n" + msg);
  process.exit(1);
};
tunnel?.on("error", () =>
  fail(
    "cloudflared was not found on PATH.\n" +
      "Install it (macOS: brew install cloudflared · Windows: winget install --id Cloudflare.cloudflared)\n" +
      "then run `npm run tunnel` again.",
  ),
);

const url = await new Promise((resolve) => {
  let log = "";
  const onData = (d) => {
    log += d;
    const m = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) resolve(m[0]);
  };
  tunnel.stdout.on("data", onData);
  tunnel.stderr.on("data", onData);
  tunnel.on("exit", (c) =>
    fail("cloudflared exited (" + c + ") before a URL was issued:\n" + log),
  );
  setTimeout(
    () => fail("Timed out waiting for the tunnel URL:\n" + log),
    45000,
  ).unref();
});

const server = spawn(process.execPath, ["--env-file-if-exists=.env", entry], {
  stdio: "inherit",
  env: { ...process.env, PORT: port, HOST: "127.0.0.1", PUBLIC_ORIGIN: url },
});
console.log(`
  ┌───────────────────────────────────────────────────────────────
  │  Public HTTPS origin: ${url}
  │  1. Open that URL on your computer or TV browser (not localhost).
  │  2. Choose Motion lab → Create game, then scan the QR with your phone.
  │  The URL changes each run. Ctrl+C stops both the tunnel and the server.
  └───────────────────────────────────────────────────────────────
`);
const stop = () => {
  server.kill("SIGTERM");
  tunnel.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", stop);
