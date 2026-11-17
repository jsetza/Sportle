/**
 * Background music, synthesised live with Web Audio (no audio files, no network).
 * An upbeat, laid-back loop: warm pad chords, a bouncy bassline, a plucky arpeggio with echo
 * and light drums. Intensity rises during play (full drums) and relaxes on menus.
 */
const BPM = 104;
const STEP = 60 / BPM / 4; // sixteenth note
// I – V – vi – IV in C major, voiced warm (MIDI note numbers).
const CHORDS = [
  [60, 64, 67, 71], // Cmaj7
  [55, 62, 67, 71], // G/B-ish (G add)
  [57, 60, 64, 67], // Am7
  [53, 57, 60, 64], // Fmaj7
];
const BASS = [36, 43, 45, 41];
// Arp pattern over chord tones per 16th step (index into chord, -1 = rest).
const ARP = [0, -1, 2, 1, 3, -1, 2, -1, 1, -1, 3, 2, 0, -1, 2, -1];
const BASS_PATTERN = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);

export class Music {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  echo: DelayNode | null = null;
  noise: AudioBuffer | null = null;
  timer = 0;
  step = 0;
  nextTime = 0;
  playing = false;
  /** 0 = menu (pad, arp, soft beat), 1 = match (full drums, brighter). */
  intensity = 0;

  start() {
    if (this.playing) return;
    if (!this.ctx) this.setup();
    const ctx = this.ctx!;
    ctx.resume();
    this.master!.gain.cancelScheduledValues(ctx.currentTime);
    this.master!.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.master!.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 1.5);
    this.playing = true;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }
  stop() {
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
  setup() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 9000;
    master.connect(tone).connect(ctx.destination);
    this.master = master;
    // Echo send for the arp.
    const echo = ctx.createDelay(1);
    echo.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    echo.connect(fb).connect(echo);
    echo.connect(wet).connect(master);
    this.echo = echo;
    const len = ctx.sampleRate * 0.4;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  schedule() {
    const ctx = this.ctx!;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.play(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % (16 * CHORDS.length);
    }
  }
  play(step: number, t: number) {
    const bar = Math.floor(step / 16),
      s = step % 16,
      chord = CHORDS[bar],
      hot = this.intensity > 0.5;
    if (s === 0) for (const n of chord) this.pad(hz(n), t, STEP * 16);
    if (BASS_PATTERN[s]) this.bass(hz(BASS[bar] + (s === 14 ? 7 : 0)), t);
    const a = ARP[s];
    if (a >= 0) this.pluck(hz(chord[a] + 12), t, hot ? 0.07 : 0.05);
    // Drums
    if (s % 4 === 0 && (hot || s % 8 === 0)) this.kick(t);
    if (s === 4 || s === 12) this.snare(t, hot ? 0.09 : 0.05);
    if (s % 2 === 1) this.hat(t, hot ? 0.035 : 0.018);
    if (hot && s % 4 === 3) this.hat(t, 0.02);
  }
  env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  pad(f: number, t: number, dur: number) {
    const ctx = this.ctx!,
      g = ctx.createGain(),
      lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = this.intensity > 0.5 ? 1800 : 1200;
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    lp.connect(g).connect(this.master!);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.5);
    g.gain.setValueAtTime(0.045, t + dur - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
  }
  bass(f: number, t: number) {
    const ctx = this.ctx!,
      o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    o.connect(g).connect(this.master!);
    this.env(g, t, 0.28, 0.01, STEP * 2.2);
    o.start(t);
    o.stop(t + STEP * 2.5);
  }
  pluck(f: number, t: number, peak: number) {
    const ctx = this.ctx!,
      o = ctx.createOscillator(),
      g = ctx.createGain(),
      lp = ctx.createBiquadFilter();
    o.type = "square";
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
  kick(t: number) {
    const ctx = this.ctx!,
      o = ctx.createOscillator(),
      g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.connect(g).connect(this.master!);
    this.env(g, t, 0.45, 0.003, 0.22);
    o.start(t);
    o.stop(t + 0.26);
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
    src.start(t);
    src.stop(t + dur + 0.02);
  }
  snare(t: number, peak: number) {
    this.noiseHit(t, peak, 1800, "bandpass", 0.14);
  }
  hat(t: number, peak: number) {
    this.noiseHit(t, peak, 8000, "highpass", 0.04);
  }
}
