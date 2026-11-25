/**
 * Music & sound for Sportle Bowling and Kart, the same as Pickleball: a Music button that cycles
 * the styles (House is the licensed file in src/client/music/ when present), a Sound on/off
 * button and a "Music & sound" dialog with music style, music volume, sound effects on/off and
 * volume. Choices use the same localStorage keys as Pickleball, so they carry across games.
 * Browsers block audio until the page gets a tap or key, so music starts on the first one.
 */
import { Music, MUSIC_STYLES } from "./music.ts";
import type { MusicStyle } from "./music.ts";

type Sfx = {
  muted: boolean;
  sfxVolume: number;
  sound(): boolean;
  wakeAudio(): void;
  setSfxVolume(v: number): void;
  hitSound(power: number): void;
};
type Pick = MusicStyle | "off";
const ORDER: Pick[] = [...MUSIC_STYLES.map((m) => m.id), "off"];
const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode: not saved */
  }
};
const vol = (key: string, d: number) => {
  const raw = read(key),
    v = Number(raw);
  return raw !== null && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : d;
};
export function mountSound(opts: {
  scene: Sfx;
  musicBtn: HTMLElement;
  soundBtn: HTMLElement;
  openBtn: HTMLElement;
  /** What the sound effects are, for the checkbox label. */
  sfxNote: string;
}): Music {
  const { scene, musicBtn, soundBtn, openBtn } = opts;
  const dlg = document.createElement("dialog");
  dlg.className = "settings";
  dlg.id = "settings";
  dlg.innerHTML = `<h2>Music &amp; sound</h2><label for="setMusic">Music</label><select id="setMusic">${MUSIC_STYLES.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}<option value="off">Off</option></select><label for="setMusicVol">Music volume <b id="setMusicVolV"></b></label><input id="setMusicVol" type="range" min="0" max="100" step="1"><label class="check"><input id="setSfx" type="checkbox"> Sound effects (${opts.sfxNote})</label><label for="setSfxVol">Sound effects volume <b id="setSfxVolV"></b></label><input id="setSfxVol" type="range" min="0" max="100" step="1"><p class="fine">House music: “COULD BE WRONG (Edit)” by LOSTBOYJAY, used with the artist’s permission. Settings are saved in this browser and shared by every Sportle game.</p><button class="cta" id="settingsClose">Done</button>`;
  document.body.appendChild(dlg);
  const q = <T extends HTMLElement>(id: string) => dlg.querySelector<T>("#" + id)!;
  const music = new Music();
  music.findFiles();
  music.setVolume(vol("pov-music-vol", 80) / 100);
  scene.setSfxVolume(vol("pov-sfx-vol", 80) / 100);
  scene.muted = read("visual-sound") === "off";
  let choice: Pick = (ORDER as string[]).includes(read("visual-music") || "") ? (read("visual-music") as Pick) : "house";
  let acted = false;
  const sync = () => {
    const name = MUSIC_STYLES.find((m) => m.id === choice)?.name;
    musicBtn.textContent = name ? "Music: " + name : "Music off";
    soundBtn.textContent = scene.muted ? "Sound off" : "Sound on";
    if (choice !== "off") music.setStyle(choice);
    if (choice !== "off" && acted) music.start();
    else music.stop();
    q<HTMLSelectElement>("setMusic").value = choice;
    const mv = Math.round(music.volume * 100),
      sv = Math.round(scene.sfxVolume * 100);
    q<HTMLInputElement>("setMusicVol").value = String(mv);
    q("setMusicVolV").textContent = mv + "%";
    q<HTMLInputElement>("setSfxVol").value = String(sv);
    q("setSfxVolV").textContent = sv + "%";
    q<HTMLInputElement>("setSfx").checked = !scene.muted;
    q<HTMLInputElement>("setSfxVol").disabled = scene.muted;
  };
  // The first tap or key anywhere on the page starts the music (browser autoplay rule).
  const first = () => {
    if (acted) return;
    acted = true;
    sync();
    scene.wakeAudio();
    removeEventListener("pointerdown", first, true);
    removeEventListener("keydown", first, true);
  };
  addEventListener("pointerdown", first, true);
  addEventListener("keydown", first, true);
  const pick = (c: Pick) => {
    choice = c;
    write("visual-music", c);
    acted = true;
    sync();
  };
  musicBtn.onclick = () => pick(ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length]);
  const toggleSfx = () => {
    scene.sound();
    write("visual-sound", scene.muted ? "off" : "on");
    sync();
  };
  soundBtn.onclick = toggleSfx;
  q("setMusic").onchange = () => pick(q<HTMLSelectElement>("setMusic").value as Pick);
  q("setMusicVol").oninput = () => {
    const v = Number(q<HTMLInputElement>("setMusicVol").value);
    music.setVolume(v / 100);
    write("pov-music-vol", String(v));
    sync();
  };
  q("setSfxVol").oninput = () => {
    const v = Number(q<HTMLInputElement>("setSfxVol").value);
    scene.setSfxVolume(v / 100);
    write("pov-sfx-vol", String(v));
    sync();
  };
  q("setSfxVol").onchange = () => scene.hitSound(0.6);
  q("setSfx").onchange = () => {
    if (q<HTMLInputElement>("setSfx").checked === scene.muted) toggleSfx();
  };
  openBtn.onclick = () => {
    sync();
    dlg.showModal();
  };
  q("settingsClose").onclick = () => dlg.close();
  // A page that went to the background (and was suspended) picks the music up again.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && acted && choice !== "off") {
      music.ctx?.resume();
      music.start();
    }
  });
  sync();
  if (location.hash.includes("test")) (window as any).__sportleMusic = music;
  return music;
}
