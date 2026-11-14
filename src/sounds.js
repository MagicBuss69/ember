let ctx = null;

function getCtx() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

function masterGain(audio, volume, when) {
  const g = audio.createGain();
  const vol = Math.max(0, Math.min(1, Number(volume) ?? 0.65));
  g.gain.setValueAtTime(vol * 0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * 0.5), when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);
  g.connect(audio.destination);
  return g;
}

function tone(audio, freq, type, start, dur, dest) {
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(0.35, start + 0.008);
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
    const out = masterGain(audio, volume, now);

    if (kind === "check") {
      const base = pack === "arcade" ? [880, 1175] : [784, 988, 1175];
      base.forEach((f, i) => tone(audio, f, pack === "arcade" ? "square" : "sine", now + i * 0.045, 0.12, out));
      return;
    }
    if (kind === "combo") {
      const arp = pack === "arcade" ? [440, 554, 659, 880, 988] : [523, 659, 784, 988, 1175];
      arp.forEach((f, i) => tone(audio, f, "triangle", now + i * 0.055, 0.1, out));
      return;
    }
    if (kind === "level") {
      const fan = [392, 494, 587, 784, 988, 1175];
      fan.forEach((f, i) => tone(audio, f, "sine", now + i * 0.09, 0.22, out));
      return;
    }
    if (kind === "penalty") {
      tone(audio, 92, "sawtooth", now, 0.55, out);
      tone(audio, 55, "sine", now + 0.12, 0.7, out);
      return;
    }
    if (kind === "down") {
      tone(audio, 220, "sine", now, 0.14, out);
      return;
    }
    tone(audio, 620, "sine", now, 0.12, out);
  } catch {
    /* autoplay */
  }
}