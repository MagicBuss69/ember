let ctx = null;
let unlocked = false;
let masterBus = null;

function getCtx() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

function ensureMasterBus(audio) {
  if (masterBus) return masterBus;
  const comp = audio.createDynamicsCompressor();
  comp.threshold.setValueAtTime(-18, audio.currentTime);
  comp.knee.setValueAtTime(24, audio.currentTime);
  comp.ratio.setValueAtTime(6, audio.currentTime);
  comp.attack.setValueAtTime(0.003, audio.currentTime);
  comp.release.setValueAtTime(0.18, audio.currentTime);
  const limiter = audio.createDynamicsCompressor();
  limiter.threshold.setValueAtTime(-3, audio.currentTime);
  limiter.knee.setValueAtTime(0, audio.currentTime);
  limiter.ratio.setValueAtTime(20, audio.currentTime);
  limiter.attack.setValueAtTime(0.001, audio.currentTime);
  limiter.release.setValueAtTime(0.08, audio.currentTime);
  comp.connect(limiter);
  limiter.connect(audio.destination);
  masterBus = { in: comp, limiter };
  return masterBus;
}

/** Call on first user gesture so Android Chrome can play audio. */
export function ensureAudio() {
  const audio = getCtx();
  if (!audio) return false;
  ensureMasterBus(audio);
  if (audio.state === "suspended") audio.resume().catch(() => {});
  unlocked = true;
  return true;
}

function masterGain(audio, volume, when, peak = 0.9, tail = 0.35) {
  const bus = ensureMasterBus(audio);
  const g = audio.createGain();
  const vol = Math.max(0, Math.min(1, Number(volume) ?? 0.8));
  g.gain.setValueAtTime(vol * 0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * peak), when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, when + tail);
  g.connect(bus.in);
  return g;
}

function tone(audio, freq, type, start, dur, dest, peak = 0.55) {
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export function playSound(kind, { volume = 0.8, pack = "system" } = {}) {
  const audio = getCtx();
  if (!audio) return;
  try {
    ensureMasterBus(audio);
    if (audio.state === "suspended") audio.resume();
    const now = audio.currentTime;
    const vol = Math.max(0, Math.min(1, Number(volume) ?? 0.8));

    if (kind === "check") {
      const out = masterGain(audio, vol, now, 1, 0.32);
      const base = pack === "arcade" ? [659, 988, 1572] : pack === "chime" ? [2093, 2637, 3136] : [988, 1319, 1760];
      base.forEach((f, i) => tone(audio, f, pack === "arcade" ? "square" : "sine", now + i * (pack === "chime" ? 0.07 : 0.035), pack === "chime" ? 0.22 : 0.12, out, 0.72));
      tone(audio, 220, "triangle", now + 0.02, 0.08, out, 0.35);
      return;
    }
    if (kind === "combo") {
      const out = masterGain(audio, vol, now, 0.95, 0.45);
      const arp = pack === "arcade" ? [440, 554, 659, 880, 988, 1319] : [523, 659, 784, 988, 1175, 1568];
      arp.forEach((f, i) => tone(audio, f, "triangle", now + i * 0.045, 0.1, out, 0.5));
      return;
    }
    if (kind === "level") {
      const out = masterGain(audio, vol, now, 1, 0.95);
      const fan = [392, 494, 587, 740, 988, 1175, 1397, 1760];
      fan.forEach((f, i) => tone(audio, f, "sine", now + i * 0.08, 0.22, out, 0.58));
      return;
    }
    if (kind === "rank") {
      const out = masterGain(audio, vol, now, 1, 1.4);
      const fan = [196, 262, 330, 392, 523, 659, 784, 988, 1175, 1568];
      fan.forEach((f, i) => tone(audio, f, "sine", now + i * 0.09, 0.28, out, 0.62));
      tone(audio, 110, "sawtooth", now, 0.35, out, 0.22);
      tone(audio, 78, "sine", now + 0.08, 0.9, out, 0.38);
      return;
    }
    if (kind === "penalty") {
      const out = masterGain(audio, vol, now, 0.55, 0.7);
      tone(audio, 92, "sawtooth", now, 0.55, out, 0.35);
      tone(audio, 55, "sine", now + 0.12, 0.7, out, 0.32);
      return;
    }
    if (kind === "down") {
      const out = masterGain(audio, vol, now, 0.5, 0.22);
      tone(audio, 220, "sine", now, 0.14, out, 0.38);
      return;
    }
    if (kind === "crystal" || kind === "shard") {
      const out = masterGain(audio, vol, now, 0.6, 0.24);
      tone(audio, 988, "sine", now, 0.07, out, 0.45);
      tone(audio, 1319, "triangle", now + 0.04, 0.1, out, 0.38);
      return;
    }
    const out = masterGain(audio, vol, now, 0.55, 0.25);
    tone(audio, 620, "sine", now, 0.12, out);
  } catch {
    /* autoplay */
  }
}

export function isAudioUnlocked() {
  return unlocked;
}