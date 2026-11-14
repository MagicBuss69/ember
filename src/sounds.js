let ctx = null;
let unlocked = false;

function getCtx() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

/** Call on first user gesture so Android Chrome can play audio. */
export function ensureAudio() {
  const audio = getCtx();
  if (!audio) return false;
  if (audio.state === "suspended") audio.resume().catch(() => {});
  unlocked = true;
  return true;
}

function masterGain(audio, volume, when, peak = 0.5, tail = 0.35) {
  const g = audio.createGain();
  const vol = Math.max(0, Math.min(1, Number(volume) ?? 0.72));
  g.gain.setValueAtTime(vol * 0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * peak), when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + tail);
  g.connect(audio.destination);
  return g;
}

function tone(audio, freq, type, start, dur, dest, peak = 0.35) {
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export function playSound(kind, { volume = 0.65, pack = "system" } = {}) {
  const audio = getCtx();
  if (!audio) return;
  try {
    if (audio.state === "suspended") audio.resume();
    const now = audio.currentTime;
    const vol = Math.max(0, Math.min(1, Number(volume) ?? 0.72));

    if (kind === "check") {
      const out = masterGain(audio, vol, now, 0.55, 0.28);
      const base = pack === "arcade" ? [659, 988, 1319] : [880, 1175, 1568];
      base.forEach((f, i) => tone(audio, f, pack === "arcade" ? "square" : "sine", now + i * 0.04, 0.1, out, 0.4));
      return;
    }
    if (kind === "combo") {
      const out = masterGain(audio, vol, now, 0.5, 0.45);
      const arp = pack === "arcade" ? [440, 554, 659, 880, 988, 1175] : [523, 659, 784, 988, 1175, 1568];
      arp.forEach((f, i) => tone(audio, f, "triangle", now + i * 0.05, 0.09, out, 0.32));
      return;
    }
    if (kind === "level") {
      const out = masterGain(audio, vol, now, 0.65, 0.95);
      const fan = [392, 494, 587, 740, 988, 1175, 1397, 1760];
      fan.forEach((f, i) => tone(audio, f, "sine", now + i * 0.085, 0.2, out, 0.42));
      return;
    }
    if (kind === "rank") {
      const out = masterGain(audio, vol, now, 0.75, 1.35);
      const fan = [262, 330, 392, 523, 659, 784, 988, 1175, 1319, 1568];
      fan.forEach((f, i) => tone(audio, f, "sine", now + i * 0.1, 0.26, out, 0.48));
      tone(audio, 196, "triangle", now + 0.05, 0.9, out, 0.25);
      return;
    }
    if (kind === "penalty") {
      const out = masterGain(audio, vol, now, 0.45, 0.7);
      tone(audio, 92, "sawtooth", now, 0.55, out, 0.3);
      tone(audio, 55, "sine", now + 0.12, 0.7, out, 0.28);
      return;
    }
    if (kind === "down") {
      const out = masterGain(audio, vol, now, 0.4, 0.2);
      tone(audio, 220, "sine", now, 0.14, out, 0.3);
      return;
    }
    if (kind === "crystal") {
      const out = masterGain(audio, vol, now, 0.45, 0.22);
      tone(audio, 1319, "sine", now, 0.08, out, 0.35);
      tone(audio, 1760, "triangle", now + 0.05, 0.1, out, 0.28);
      return;
    }
    const out = masterGain(audio, vol, now, 0.45, 0.25);
    tone(audio, 620, "sine", now, 0.12, out);
  } catch {
    /* autoplay */
  }
}

export function isAudioUnlocked() {
  return unlocked;
}