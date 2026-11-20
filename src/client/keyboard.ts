// "Use the keyboard instead" (owner request): this screen claims a player seat and
// drives its paddle from the keyboard. It is a normal controller session (same join, same
// timestamped/sequenced /api/input path, same server rules); its inputs are marked `kb` so
// nothing pretends they came from phone sensors.
//
// Keys: hold and release SPACE to swing (longer hold = harder). While releasing, hold
// SHIFT = dink, E = topspin roll, Q = slice, R = lob, F = smash. A / D (your movement keys)
// also aim the shot left / right. 1 / 2 / 3 pick a drive / roll / slice serve.
import { Connection } from "./net.ts";
import type { Input } from "../shared/types.ts";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class KeyboardPaddle {
  net = new Connection();
  playerId = "";
  active = false;
  seq = 0;
  swingId = 0;
  sv = 0;
  timer: ReturnType<typeof setInterval> | undefined;
  held = new Set<string>();
  spaceAt = 0;
  /** Repeat each swing in a few packets so one lost packet can't drop it (as the phone does). */
  pending: { input: Partial<Input>; left: number } | null = null;
  onError: (e: unknown) => void = () => {};

  /** Join as a player with this screen's pairing token, or resume a saved seat. */
  async start(room: string, pair: string) {
    this.net.room = room;
    const saved = this.saved();
    const r = await this.net.api("join", {
      pair: saved ? undefined : pair,
      credential: saved?.room === room ? saved.credential : undefined,
      name: "Keyboard",
      hand: "right",
      outfit: "classic",
    });
    this.net.credential = r.credential;
    this.playerId = r.player.id;
    try {
      sessionStorage.setItem("pov-kb", JSON.stringify({ room, credential: r.credential }));
    } catch {}
    await this.net.clock();
    this.active = true;
    this.listen();
    this.timer = setInterval(() => this.send(), 50);
    // The server wants a few live inputs before Ready.
    setTimeout(() => this.net.api("ready", { ready: true }).catch(this.onError), 400);
  }
  saved(): { room: string; credential: string } | null {
    try {
      return JSON.parse(sessionStorage.getItem("pov-kb") || "null");
    } catch {
      return null;
    }
  }
  /** Rejoin after a page reload if this screen had a keyboard seat in this room. */
  async resume(room: string) {
    const s = this.saved();
    if (!s || s.room !== room || this.active) return false;
    await this.start(room, "");
    return true;
  }
  stop() {
    clearInterval(this.timer);
    this.active = false;
    try {
      sessionStorage.removeItem("pov-kb");
    } catch {}
  }
  listen() {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      return t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA";
    };
    addEventListener("keydown", (e) => {
      if (!this.active || typing(e) || e.metaKey || e.ctrlKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!this.held.has("Space")) this.spaceAt = performance.now();
      }
      if (e.code === "Digit1") this.sv = 0;
      if (e.code === "Digit2") this.sv = 1;
      if (e.code === "Digit3") this.sv = 2;
      this.held.add(e.code);
    });
    addEventListener("keyup", (e) => {
      if (!this.active) return;
      if (e.code === "Space" && this.held.has("Space")) this.swing();
      this.held.delete(e.code);
    });
    addEventListener("blur", () => this.held.clear());
  }
  /** Build one swing from the keys held right now. */
  swing() {
    const h = this.held;
    const hold = (performance.now() - this.spaceAt) / 1000;
    let strength = clamp(0.42 + (hold / 0.45) * 0.5, 0.42, 0.95);
    let direction = 0.12,
      pitch = 0;
    if (h.has("ShiftLeft") || h.has("ShiftRight")) strength = 0.28;
    if (h.has("KeyE")) direction = 0.5;
    if (h.has("KeyQ")) {
      direction = -0.3;
      pitch = 28;
    }
    if (h.has("KeyR")) {
      direction = 0.55;
      pitch = 45;
      strength = Math.max(strength, 0.55);
    }
    if (h.has("KeyF")) {
      direction = -0.85;
      strength = Math.max(strength, 0.7);
    }
    const side = (h.has("KeyD") ? 0.7 : 0) - (h.has("KeyA") ? 0.7 : 0);
    this.pending = {
      input: { swing: true, strength, direction, pitch, side, swingId: ++this.swingId },
      left: 3,
    };
    this.send();
  }
  send() {
    if (!this.active) return;
    const swing = this.pending;
    const input: Input = {
      seq: this.seq++,
      t: Date.now() + this.net.offset,
      pitch: 0,
      roll: 0,
      yaw: 0,
      strength: 0,
      direction: 0,
      swing: false,
      sensors: true,
      calibrated: true,
      kb: true,
      ctl: 1,
      sv: this.sv,
      ...(swing ? swing.input : {}),
    };
    if (swing && --swing.left <= 0) this.pending = null;
    this.net.api("input", input).catch(() => {});
  }
}
