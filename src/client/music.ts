/**
 * Background music, synthesised live with Web Audio (no audio files, no vocals, no network).
 * Several styles (owner request: house music, and a choice of backgrounds):
 *   house     — 124 BPM four-on-the-floor: kick every beat, off-beat open hats, claps,
 *               rolling off-beat bass and filtered chord stabs that "pump" with the kick.
 *   chill     — the original laid-back loop: warm pads, bouncy bass, plucky arp, light drums.
 *   synthwave — 100 BPM driving saw bass, big gated snare, saw pads and an arpeggio.
 *   lofi      — 78 BPM swung, dusty beat with soft electric-piano chords and vinyl crackle.
 * Intensity rises during play (fuller drums) and relaxes on menus.
 */
export type MusicStyle = "house" | "chill" | "synthwave" | "lofi";
export const MUSIC_STYLES: { id: MusicStyle; name: string }[] = [
  { id: "house", name: "House" },
  { id: "chill", name: "Chill pop" },
  { id: "synthwave", name: "Synthwave" },
  { id: "lofi", name: "Lo-fi" },
];
const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

type Style = {
  bpm: number;
  /** Volume trim so every style plays at a similar loudness. */
  level: number;
  /** Swing: delay of every off 16th, as a fraction of a 16th. */
  swing: number;
  chords: number[][];
  bass: number[];
  echo: number; // echo time in 16ths
  play(m: Music, step: number, t: number, hot: boolean): void;
};

const STYLES: Record<MusicStyle, Style> = {
  house: {
    level: 1.15,
    bpm: 124,
    swing: 0,
    // Deep-house minor progression: Am9 · Fmaj9 · Cmaj7 · G6/9
    chords: [
      [57, 60, 64, 67, 71],
      [53, 57, 60, 64, 67],
      [48, 55, 59, 64, 67],
      [55, 59, 62, 64, 69],
    ],
    bass: [33, 29, 36, 31],
    echo: 3,
    play(m, step, t, hot) {
      const bar = Math.floor(step / 16) % 4,
        s = step % 16,
        chord = this.chords[bar],
        root = this.bass[bar];
      // Four on the floor (menus: half-time kick so it's calmer).
      if (s % 4 === 0 && (hot || s % 8 === 0)) {
        m.kick(t, 0.5, 150, 45);
        m.pump(t);
      }
      if (hot && (s === 4 || s === 12)) m.clap(t, 0.09);
      if (s % 4 === 2) m.openHat(t, hot ? 0.05 : 0.03);
      if (hot && s % 2 === 1) m.hat(t, 0.016);
      // Rolling off-beat bass (octave bounce), a pickup into the next bar.
      if (s % 4 === 2)
        m.bassNote(hz(root + (s === 10 ? 12 : 0)), t, 0.26, "sawtooth", 500);
      if (hot && s === 15) m.bassNote(hz(root + 7), t, 0.18, "sawtooth", 500);
      // Chord stabs on the off-beats, filter opening across the 4 bars.
      if (s === 3 || s === 6 || (hot && s === 11) || s === 14)
        m.stab(
          chord.map(hz),
          t,
          hot ? 0.05 : 0.035,
          900 + bar * 400 + (hot ? 600 : 0),
        );
      // A soft pad underneath, sidechained with the kick.
      if (s === 0)
        for (const n of chord.slice(0, 3))
          m.pad(hz(n), t, m.step16 * 16, 0.028, 900, true);
    },
  },
  chill: {
    level: 1,
    bpm: 104,
    swing: 0,
    // I – V – vi – IV in C major, voiced warm.
    chords: [
      [60, 64, 67, 71],
      [55, 62, 67, 71],
      [57, 60, 64, 67],
      [53, 57, 60, 64],
    ],
    bass: [36, 43, 45, 41],
    echo: 3,
    play(m, step, t, hot) {
      const ARP = [0, -1, 2, 1, 3, -1, 2, -1, 1, -1, 3, 2, 0, -1, 2, -1];
      const BASS = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
      const bar = Math.floor(step / 16) % 4,
        s = step % 16,
        chord = this.chords[bar];
      if (s === 0)
        for (const n of chord)
          m.pad(hz(n), t, m.step16 * 16, 0.045, hot ? 1800 : 1200);
      if (BASS[s])
        m.bassNote(hz(this.bass[bar] + (s === 14 ? 7 : 0)), t, 0.28, "sine");
      const a = ARP[s];
      if (a >= 0) m.pluck(hz(chord[a] + 12), t, hot ? 0.07 : 0.05);
      if (s % 4 === 0 && (hot || s % 8 === 0)) m.kick(t, 0.45, 140, 42);
      if (s === 4 || s === 12) m.snare(t, hot ? 0.09 : 0.05);
      if (s % 2 === 1) m.hat(t, hot ? 0.035 : 0.018);
      if (hot && s % 4 === 3) m.hat(t, 0.02);
    },
  },
  synthwave: {
    level: 1.1,
    bpm: 100,
    swing: 0,
    // Am · F · C · G, big and bright.
    chords: [
      [57, 60, 64, 69],
      [53, 57, 60, 65],
      [48, 55, 60, 64],
      [55, 59, 62, 67],
    ],
    bass: [33, 29, 36, 31],
    echo: 3,
    play(m, step, t, hot) {
      const bar = Math.floor(step / 16) % 4,
        s = step % 16,
        chord = this.chords[bar];
      // Driving eighth-note saw bass.
      if (s % 2 === 0)
        m.bassNote(
          hz(this.bass[bar] + (s % 8 === 6 ? 12 : 0)),
          t,
          0.2,
          "sawtooth",
          700,
        );
      if (s % 4 === 0 && (hot || s % 8 === 0)) m.kick(t, 0.5, 120, 40);
      if (s === 4 || s === 12) m.bigSnare(t, hot ? 0.13 : 0.08);
      if (hot && s % 2 === 0) m.hat(t, 0.02);
      if (s === 0)
        for (const n of chord)
          m.pad(
            hz(n),
            t,
            m.step16 * 16,
            0.03,
            hot ? 2400 : 1500,
            false,
            "sawtooth",
          );
      // Arpeggio up and down the chord, an octave up.
      const order = [0, 1, 2, 3, 2, 1];
      if (hot || s % 2 === 0)
        m.pluck(
          hz(chord[order[s % order.length]] + 12),
          t,
          hot ? 0.05 : 0.035,
          "sawtooth",
        );
    },
  },
  lofi: {
    level: 1.7,
    bpm: 78,
    swing: 0.28,
    // ii – V – I – vi with sevenths: Dm7 · G7 · Cmaj7 · Am7
    chords: [
      [50, 53, 57, 60],
      [55, 59, 62, 65],
      [48, 52, 55, 59],
      [45, 48, 52, 55],
    ],
    bass: [38, 31, 36, 33],
    echo: 4,
    play(m, step, t, hot) {
      const bar = Math.floor(step / 16) % 4,
        s = step % 16,
        chord = this.chords[bar];
      // Lazy, dusty beat.
      if (s === 0 || s === 10 || (hot && s === 7)) m.kick(t, 0.38, 110, 45);
      if (s === 4 || s === 12) m.snare(t, hot ? 0.07 : 0.05, 1400);
      if (s % 2 === 0) m.hat(t, hot ? 0.022 : 0.014);
      if (s === 0 || s === 8) m.bassNote(hz(this.bass[bar]), t, 0.22, "sine");
      if (s === 14) m.bassNote(hz(this.bass[bar] + 7), t, 0.16, "sine");
      // Soft electric-piano chords, slightly strummed.
      if (s === 0 || (hot && s === 10))
        chord.forEach((n, i) => m.keys(hz(n + 12), t + i * 0.025, 0.035));
      if (s % 4 === 0) m.crackle(t);
    },
  },
};

export class Music {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  /** Pads/stabs/bass go through here so house can "pump" with the kick. */
  pumpBus: GainNode | null = null;
  echo: DelayNode | null = null;
  noise: AudioBuffer | null = null;
  timer = 0;
  step = 0;
  nextTime = 0;
  playing = false;
  style: MusicStyle = "house";
  /** 0 = menu (calmer), 1 = match (full drums, brighter). */
  intensity = 0;
  get step16() {
    return 60 / STYLES[this.style].bpm / 4;
  }

  // ——— Licensed audio file (owner request): if src/client/music/<style>.<ext> exists, that
  // style plays the file on loop instead of the synthesised loop. ———
  files: Partial<Record<MusicStyle, string>> = {};
  /** Music volume 0..1 (Settings), applied after everything else. */
  volume = 0.8;
  out: GainNode | null = null;
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.out && this.ctx)
      this.out.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }
  fileGain: GainNode | null = null;
  filePlaying = false;
  fileTimer = 0;
  /** Look for supplied music files (e.g. /music/house.mp3). Call once at start-up. */
  async findFiles() {
    try {
      const c = await (await fetch("/api/config", { cache: "no-store" })).json();
      for (const s of MUSIC_STYLES)
        if (typeof c.music?.[s.id] === "string" && c.music[s.id].startsWith("/music/"))
          this.files[s.id] = c.music[s.id];
    } catch {
      /* no supplied music: the synthesised styles play */
    }
    // Already playing that style's synth loop? Switch over to the file.
    if (this.playing && this.files[this.style]) {
      this.stopSynth();
      this.startFile();
    }
  }
  /** Decoded file per style (looped sample-accurately, so a cut loop has no gap). */
  buffers: Partial<Record<MusicStyle, AudioBuffer>> = {};
  source: AudioBufferSourceNode | null = null;
  startFile() {
    if (this.filePlaying) return;
    if (!this.ctx) this.setup();
    const ctx = this.ctx!,
      style = this.style;
    if (!this.fileGain) {
      this.fileGain = ctx.createGain();
      this.fileGain.gain.value = 0.0001;
      this.fileGain.connect(this.out!);
    }
    ctx.resume();
    this.filePlaying = true;
    const go = (buf: AudioBuffer) => {
      if (!this.filePlaying || this.style !== style || this.source) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.fileGain!);
      src.start();
      this.source = src;
    };
    const have = this.buffers[style];
    if (have) go(have);
    else
      fetch(this.files[style]!)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buf) => {
          this.buffers[style] = buf;
          go(buf);
        })
        .catch(() => {
          // Couldn't load the file: fall back to the synthesised loop for this style.
          delete this.files[style];
          this.filePlaying = false;
          this.start();
        });
    // Quieter on the menu, fuller in a match; eased so changes are smooth.
    const level = () => (this.intensity > 0.5 ? 0.85 : 0.55);
    const g = this.fileGain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(Math.max(0.0001, g.value), ctx.currentTime);
    g.linearRampToValueAtTime(level(), ctx.currentTime + 1.2);
    clearInterval(this.fileTimer);
    this.fileTimer = window.setInterval(() => {
      g.setTargetAtTime(level(), ctx.currentTime, 0.4);
    }, 500);
  }
  stopFile() {
    if (!this.filePlaying || !this.ctx) return;
    const ctx = this.ctx,
      g = this.fileGain!.gain,
      src = this.source;
    clearInterval(this.fileTimer);
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    this.filePlaying = false;
    this.source = null;
    src?.stop(ctx.currentTime + 0.65);
  }
  setStyle(style: MusicStyle) {
    if (!STYLES[style] || style === this.style) return;
    if (this.filePlaying || (this.playing && (this.files[style] || this.files[this.style]))) {
      // Switching to or from a file-backed style: stop whatever plays, start the new one.
      const on = this.filePlaying || this.playing;
      this.stop();
      this.style = style;
      this.step = 0;
      if (this.echo) this.echo.delayTime.value = this.step16 * STYLES[style].echo;
      if (on) this.start();
      return;
    }
    this.style = style;
    this.step = 0;
    if (this.echo) this.echo.delayTime.value = this.step16 * STYLES[style].echo;
    if (this.playing && this.ctx) {
      const g = this.master!.gain,
        now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0.16 * STYLES[style].level, now + 0.3);
    }
  }
  start() {
    if (this.files[this.style]) return this.startFile();
    if (this.playing) return;
    if (!this.ctx) this.setup();
    const ctx = this.ctx!;
    ctx.resume();
    this.master!.gain.cancelScheduledValues(ctx.currentTime);
    this.master!.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.master!.gain.exponentialRampToValueAtTime(
      0.16 * STYLES[this.style].level,
      ctx.currentTime + 1.5,
    );
    this.playing = true;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }
  stop() {
    this.stopFile();
    this.stopSynth();
  }
  stopSynth() {
    if (!this.playing || !this.ctx) return;
    const ctx = this.ctx;
    this.master!.gain.cancelScheduledValues(ctx.currentTime);
    this.master!.gain.setValueAtTime(this.master!.gain.value, ctx.currentTime);
    this.master!.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + 0.6,
    );
    clearInterval(this.timer);
    this.playing = false;
  }
  /** Render a few seconds of a style without playing it (previews and automated checks). */
  static async render(style: MusicStyle, seconds: number, hot = true) {
    const ctx = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
    const m = new Music();
    m.style = style;
    m.intensity = hot ? 1 : 0;
    m.setup(ctx as unknown as AudioContext);
    m.master!.gain.value = 0.16 * STYLES[style].level;
    const st = STYLES[style];
    for (let step = 0, t = 0.05; t < seconds - 0.3; step++, t += m.step16)
      st.play(m, step % 64, t + (step % 2 ? st.swing * m.step16 : 0), hot);
    return ctx.startRendering();
  }
  setup(given?: AudioContext) {
    const ctx = given ?? new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 9000;
    const out = ctx.createGain();
    out.gain.value = this.volume;
    out.connect(ctx.destination);
    this.out = out;
    master.connect(tone).connect(out);
    this.master = master;
    const pump = ctx.createGain();
    pump.gain.value = 1;
    pump.connect(master);
    this.pumpBus = pump;
    // Echo send.
    const echo = ctx.createDelay(2);
    echo.delayTime.value = this.step16 * STYLES[this.style].echo;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    echo.connect(fb).connect(echo);
    echo.connect(wet).connect(master);
    this.echo = echo;
    const len = ctx.sampleRate * 0.6;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  schedule() {
    const ctx = this.ctx!;
    const st = STYLES[this.style];
    while (this.nextTime < ctx.currentTime + 0.12) {
      // Swing pushes every off 16th a little late.
      const t = this.nextTime + (this.step % 2 ? st.swing * this.step16 : 0);
      st.play(this, this.step, t, this.intensity > 0.5);
      this.nextTime += this.step16;
      this.step = (this.step + 1) % 64;
    }
  }
  // ——— instruments ———
  env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  /** Duck the music bus on each kick (house "pump"). */
  pump(t: number) {
    const g = this.pumpBus!.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.35, t);
    g.linearRampToValueAtTime(1, t + this.step16 * 3);
  }
  pad(
    f: number,
    t: number,
    dur: number,
    peak = 0.045,
    cutoff = 1200,
    pumped = false,
    type: OscillatorType = "triangle",
  ) {
    const ctx = this.ctx!,
      g = ctx.createGain(),
      lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cutoff;
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    lp.connect(g).connect(pumped ? this.pumpBus! : this.master!);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.4);
    g.gain.setValueAtTime(peak, t + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
  }
  bassNote(
    f: number,
    t: number,
    peak: number,
    type: OscillatorType,
    cutoff = 0,
  ) {
    const ctx = this.ctx!,
      o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    let out: AudioNode = o;
    if (cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(cutoff * 1.8, t);
      lp.frequency.exponentialRampToValueAtTime(
        cutoff * 0.5,
        t + this.step16 * 2,
      );
      o.connect(lp);
      out = lp;
    }
    out.connect(g).connect(this.pumpBus!);
    this.env(g, t, peak, 0.008, this.step16 * 1.9);
    o.start(t);
    o.stop(t + this.step16 * 2.3);
  }
  /** Short filtered chord hit (house stabs). */
  stab(fs: number[], t: number, peak: number, cutoff: number) {
    const ctx = this.ctx!,
      g = ctx.createGain(),
      lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(cutoff * 1.6, t);
    lp.frequency.exponentialRampToValueAtTime(cutoff * 0.5, t + 0.16);
    for (const f of fs) {
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.24);
    }
    lp.connect(g);
    g.connect(this.pumpBus!);
    g.connect(this.echo!);
    this.env(g, t, peak, 0.004, 0.18);
  }
  pluck(f: number, t: number, peak: number, type: OscillatorType = "square") {
    const ctx = this.ctx!,
      o = ctx.createOscillator(),
      g = ctx.createGain(),
      lp = ctx.createBiquadFilter();
    o.type = type;
    o.frequency.value = f;
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + 0.18);
    o.connect(lp).connect(g);
    g.connect(this.master!);
    g.connect(this.echo!);
    this.env(g, t, peak, 0.005, 0.2);
    o.start(t);
    o.stop(t + 0.25);
  }
  /** Soft electric piano: sine + a quiet overtone, gentle tremolo-free decay. */
  keys(f: number, t: number, peak: number) {
    const ctx = this.ctx!,
      g = ctx.createGain();
    for (const [mult, amt] of [
      [1, 1],
      [2, 0.25],
      [3, 0.08],
    ]) {
      const o = ctx.createOscillator(),
        og = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f * mult;
      og.gain.value = amt;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 1.6);
    }
    g.connect(this.master!);
    g.connect(this.echo!);
    this.env(g, t, peak, 0.01, 1.4);
  }
  kick(t: number, peak = 0.45, from = 140, to = 42) {
    const ctx = this.ctx!,
      o = ctx.createOscillator(),
      g = ctx.createGain();
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + 0.12);
    o.connect(g).connect(this.master!);
    this.env(g, t, peak, 0.003, 0.24);
    o.start(t);
    o.stop(t + 0.28);
  }
  noiseHit(
    t: number,
    peak: number,
    freq: number,
    type: BiquadFilterType,
    dur: number,
  ) {
    const ctx = this.ctx!,
      src = ctx.createBufferSource(),
      f = ctx.createBiquadFilter(),
      g = ctx.createGain();
    src.buffer = this.noise;
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(g).connect(this.master!);
    this.env(g, t, peak, 0.002, dur);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }
  snare(t: number, peak: number, freq = 1800) {
    this.noiseHit(t, peak, freq, "bandpass", 0.14);
  }
  /** Big 80s snare: a body thump plus a long noise tail. */
  bigSnare(t: number, peak: number) {
    this.noiseHit(t, peak, 1500, "bandpass", 0.32);
    this.kick(t, peak * 1.2, 260, 160);
  }
  /** House clap: three quick noise bursts and a short tail. */
  clap(t: number, peak: number) {
    for (const d of [0, 0.011, 0.022])
      this.noiseHit(t + d, peak * 0.8, 1200, "bandpass", 0.03);
    this.noiseHit(t + 0.03, peak, 1100, "bandpass", 0.16);
  }
  hat(t: number, peak: number) {
    this.noiseHit(t, peak, 8000, "highpass", 0.04);
  }
  openHat(t: number, peak: number) {
    this.noiseHit(t, peak, 7000, "highpass", 0.16);
  }
  /** Lo-fi vinyl crackle: a few random tiny clicks. */
  crackle(t: number) {
    for (let i = 0; i < 3; i++)
      this.noiseHit(
        t + Math.random() * this.step16 * 4,
        0.012,
        3000 + Math.random() * 3000,
        "highpass",
        0.006,
      );
  }
}
