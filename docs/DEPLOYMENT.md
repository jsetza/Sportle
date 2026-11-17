# Run and deploy

## Local development

Install Node 24+ from its official distribution, then:

```sh
npm ci
cp .env.example .env
npm run dev
```

`npm run dev` serves the TypeScript modules through Node's type stripper. `.env` is loaded automatically. Desktop preview: http://localhost:3000. Actual phones need the HTTPS deployment below.

## Production

```sh
npm ci
npm run check
npm start
```

Set `HOST=0.0.0.0`, the platform's `PORT`, and `PUBLIC_ORIGIN=https://your-actual-hostname` before starting. `PUBLIC_ORIGIN` must be an origin without a path, query, fragment, credentials, or trailing subdirectory. Restart after changing it. Do not point it to an unrelated site: that origin must route to this server.

Alternatively:

```sh
docker build -t visual-pickleball .
docker run --rm -p 3000:3000 \
  -e PUBLIC_ORIGIN=https://your-actual-hostname \
  visual-pickleball
```

The image builds the app and runs as the unprivileged `node` user. The Docker recipe is supplied but was not built in the original environment.

Put a TLS-terminating reverse proxy or the platform's managed HTTPS ingress in front of port 3000. Use a persistent process/container, not a short-lived request function. Disable buffering/compression for `/api/events`, keep connections open, and allow the controller's POST traffic. Example Nginx location inside an already configured TLS server:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

The application does not trust arbitrary forwarded IP headers. Its basic IP limiter may group clients behind one proxy. Before broader release, configure trusted-proxy-aware limits at the ingress and load-test them; do not blindly trust public `X-Forwarded-For` values.

### Development phone test: `npm run tunnel`

With the official `cloudflared` binary installed (`brew install cloudflared`, `winget install --id Cloudflare.cloudflared`, or the Linux packages from Cloudflare), `npm run tunnel` starts a Cloudflare quick tunnel, reads its `https://<random>.trycloudflare.com` URL, and starts the server with `PUBLIC_ORIGIN` set to that URL. Open the printed URL on the display and scan the QR. Quick tunnels need no account, change URL every run, and have no uptime guarantee: use them for testing, not for hosting. The script uses `dist/` if it has been built, otherwise the TypeScript sources.

Status: the script's missing-binary path was exercised; an end-to-end tunnel could not be opened from the development sandbox (no route to Cloudflare's edge), so the first real run will be on your machine. If phones load the page but the display stops updating, check that the tunnel is not buffering `/api/events`.

Any other trusted HTTPS tunnel works the same way: set its real public URL as `PUBLIC_ORIGIN`, then restart. Never instruct a player to bypass a certificate warning.

## Validate the deployment

1. Open the public origin from a different network. `/api/config` should report the same origin.
2. Create Motion lab. The QR must contain the public origin, not localhost.
3. Scan with an iPhone and an Android phone and complete the physical checklist.
4. Open a second display on another network and join the same room. Compare scores and ball movement.
5. Background a phone; verify pause, reconnect, recalibration, and explicit host resume.
6. Confirm proxy buffering does not batch movement updates and that the host does not sleep between requests.

Keep a single instance for this prototype. Sessions and room state live in memory; rolling deploys and restarts end matches. For scale, add shared room ownership/state, observability, ingress limits, and load testing first.

## GitHub handoff

This repository contains source, a lockfile, tests, Dockerfile, and a GitHub Actions check workflow. Source control does not deploy the server. A hosting target and real public HTTPS origin still need to be selected and configured.
