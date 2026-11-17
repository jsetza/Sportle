export class Connection {
  room = "";
  credential = "";
  offset = 0;
  latency = 0;
  controller: AbortController | null = null;
  running = false;
  onState: (s: any) => void = () => {};
  onStatus: (s: string) => void = () => {};
  async api(action: string, data?: unknown) {
    const r = await fetch(
      "/api/" +
        action +
        (this.room ? "?room=" + encodeURIComponent(this.room) : ""),
      {
        method: data === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.credential
            ? { Authorization: "Bearer " + this.credential }
            : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      },
    );
    const a = await r.json();
    if (!r.ok) throw Error(a.error || "Connection failed");
    return a;
  }
  async clock() {
    const start = Date.now();
    const r = await this.api("clock");
    this.latency = Date.now() - start;
    this.offset = r.serverTime - (start + this.latency / 2);
  }
  async stream() {
    if (this.running) return;
    this.running = true;
    while (this.running) {
      this.controller = new AbortController();
      try {
        this.onStatus("Connecting");
        const r = await fetch(
          "/api/events?room=" + encodeURIComponent(this.room),
          {
            headers: { Authorization: "Bearer " + this.credential },
            signal: this.controller.signal,
          },
        );
        if (!r.ok || !r.body) throw Error("Session lost");
        this.onStatus("Connected");
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
            if (part.startsWith("data: "))
              this.onState(JSON.parse(part.slice(6)));
          }
        }
      } catch {
        if (this.running) {
          this.onStatus("Reconnecting…");
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    }
  }
  stop() {
    this.running = false;
    this.controller?.abort();
  }
}
