export class Connection {
  room = "";
  credential = "";
  offset = 0;
  latency = 0;
  controller: AbortController | null = null;
  running = false;
  onState: (s: any) => void = () => {};
  onStatus: (s: string) => void = () => {};
  /**
   * Live state transport. Server-Sent Events by default; falls back to short polling when
   * SSE cannot work — e.g. Cloudflare quick tunnels (*.trycloudflare.com), which do not
   * support SSE — or when the stream stalls. Polling keeps the same authoritative snapshots.
   */
  mode: "sse" | "poll" =
    location.hostname.endsWith(".trycloudflare.com") ||
    new URLSearchParams(location.search).get("transport") === "poll"
      ? "poll"
      : "sse";
  async api(action: string, data?: unknown) {
    const r = await fetch(
      "/api/" +
        action +
        (this.room ? "?room=" + encodeURIComponent(this.room) : ""),
      {
        method: data === undefined ? "GET" : "POST",
        // Never cache: browsers otherwise queue identical in-flight GETs behind each other,
        // which would serialise the parallel state pollers.
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(this.credential
            ? { Authorization: "Bearer " + this.credential }
            : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      },
    );
    const text = await r.text();
    let a: any;
    try {
      a = JSON.parse(text);
    } catch {
      // A proxy/tunnel error page instead of the game server's JSON.
      throw Error(
        r.status === 429
          ? "The connection is busy (too many requests through the tunnel). Wait a moment and try again."
          : `Couldn't reach the game server (HTTP ${r.status}). Check that it's still running on the computer, then try again.`,
      );
    }
    if (!r.ok) throw Error(a.error || "Connection failed");
    return a;
  }
  async clock() {
    const start = Date.now();
    const r = await this.api("clock");
    this.latency = Date.now() - start;
    this.offset = r.serverTime - (start + this.latency / 2);
  }
  /** Drop a stream that may have gone stale (e.g. phone returning from the background). */
  kick() {
    this.controller?.abort();
  }
  lastData = 0;
  async stream() {
    if (this.running) return;
    this.running = true;
    let failures = 0;
    while (this.running) {
      if (this.mode === "poll") {
        await this.poll();
        continue;
      }
      this.controller = new AbortController();
      const controller = this.controller;
      // If no snapshot arrives soon, the path is buffering the stream: switch to polling.
      const watchdog = setTimeout(() => {
        this.mode = "poll";
        controller.abort();
      }, 4000);
      // A stream that was working but went quiet (server restart, network switch, phone
      // asleep) is dropped and reopened instead of hanging forever.
      this.lastData = Date.now();
      const stall = setInterval(() => {
        if (Date.now() - this.lastData > 3500) controller.abort();
      }, 1000);
      try {
        this.onStatus("Connecting");
        const r = await fetch(
          "/api/events?room=" + encodeURIComponent(this.room),
          {
            headers: { Authorization: "Bearer " + this.credential },
            signal: controller.signal,
          },
        );
        if (!r.ok || !r.body) throw Error("Session lost");
        const reader = r.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        while (this.running) {
          const { value, done } = await reader.read();
          if (done) throw Error("Connection interrupted");
          buffer += decoder.decode(value, { stream: true });
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const part = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (part.startsWith("data: ")) {
              clearTimeout(watchdog);
              this.lastData = Date.now();
              failures = 0;
              this.onStatus("Connected");
              this.onState(JSON.parse(part.slice(6)));
            }
          }
        }
        clearInterval(stall);
      } catch {
        clearTimeout(watchdog);
        clearInterval(stall);
        if (++failures >= 2) this.mode = "poll";
        if (this.running) {
          this.onStatus("Reconnecting…");
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    }
  }
  /**
   * Polling session: three staggered pollers so a slow round trip (tunnels, cellular) does not
   * cap the update rate at one per round trip. Out-of-order replies are dropped by sim time.
   */
  async poll() {
    let newest = -1;
    const loop = async (delay: number) => {
      await new Promise((r) => setTimeout(r, delay));
      let errors = 0;
      while (this.running && this.mode === "poll") {
        const t = performance.now();
        try {
          const s = await this.api("state");
          errors = 0;
          this.onStatus("Connected");
          const time = s?.state?.time ?? 0;
          if (time >= newest || s?.state?.phase === "lobby") {
            newest = time;
            this.onState(s);
          }
        } catch {
          errors++;
          this.onStatus("Reconnecting…");
          await new Promise((r) => setTimeout(r, Math.min(3000, 300 * errors)));
        }
        // Each poller aims for ~11/s, so three together give ~30 updates/s.
        const wait = 90 - (performance.now() - t);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    };
    await Promise.all([loop(0), loop(30), loop(60)]);
  }
  stop() {
    this.running = false;
    this.controller?.abort();
  }
}
