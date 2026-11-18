/** Hosting-platform helpers: public origin detection and proxy-aware client addresses. */

export type Platform = "render" | "railway" | "fly" | "proxy" | "direct";

/** Which known host we run on (each sets these variables itself), or a generic trusted proxy. */
export function detectPlatform(env: NodeJS.ProcessEnv): Platform {
  if (env.RENDER || env.RENDER_EXTERNAL_URL) return "render";
  if (env.FLY_APP_NAME) return "fly";
  if (
    env.RAILWAY_ENVIRONMENT_NAME ||
    env.RAILWAY_ENVIRONMENT ||
    env.RAILWAY_PUBLIC_DOMAIN
  )
    return "railway";
  if (env.TRUST_PROXY === "1") return "proxy";
  return "direct";
}

/**
 * Public HTTPS origin for phone QR links. PUBLIC_ORIGIN wins; otherwise it is detected from
 * the hosts this repo documents, so a deploy there needs no setup.
 */
export function detectOrigin(env: NodeJS.ProcessEnv) {
  if (env.PUBLIC_ORIGIN) return env.PUBLIC_ORIGIN;
  if (env.RENDER_EXTERNAL_URL) return env.RENDER_EXTERNAL_URL;
  if (env.RAILWAY_PUBLIC_DOMAIN) return "https://" + env.RAILWAY_PUBLIC_DOMAIN;
  if (env.FLY_APP_NAME) return `https://${env.FLY_APP_NAME}.fly.dev`;
  return "";
}

/**
 * The visitor's address for per-IP limits. Behind a host's proxy every request arrives from
 * the proxy, so each platform's own trustworthy header is used:
 * - Render: Cloudflare's True-Client-IP (Render only appends to X-Forwarded-For, which a
 *   client can pre-fill, so that header is not trusted there).
 * - Fly.io: Fly-Client-IP (on Fly the rightmost X-Forwarded-For entry is the app's own IP).
 * - Railway: X-Real-IP set by its edge proxy.
 * - TRUST_PROXY=1 (your own single reverse proxy): the rightmost X-Forwarded-For entry,
 *   which is the address that proxy saw.
 * Running directly (no proxy), headers are ignored entirely because they are spoofable.
 */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  socketIp: string | undefined,
  platform: Platform,
) {
  const one = (name: string) => {
    const v = headers[name];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s || null;
  };
  let ip: string | null = null;
  if (platform === "render") ip = one("true-client-ip");
  else if (platform === "fly") ip = one("fly-client-ip");
  else if (platform === "railway") ip = one("x-real-ip");
  else if (platform === "proxy") {
    const xff = headers["x-forwarded-for"];
    const list = (Array.isArray(xff) ? xff.join(",") : xff || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    ip = list[list.length - 1] || null;
  }
  return ip || socketIp || "unknown";
}
