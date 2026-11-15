// HARBOURFALL — audio.js
// All sound is synthesised with WebAudio: no files, no network. One shared
// context, a handful of tiny generators (noise bursts for gunfire, filtered
// sweeps for the pack, two-tone stingers for round results). Distant shots
// are quieter and duller, using the listener distance main.js passes in.

let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}
export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
function noiseBuffer(seconds) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
let sharedNoise = null;
function burst({ dur = 0.12, freq = 1800, gain = 0.5, type = 'lowpass', when = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = sharedNoise || (sharedNoise = noiseBuffer(0.5));
  const filter = ctx.createBiquadFilter();
  filter.type = type; filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter); filter.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}
function tone({ freq = 440, dur = 0.15, gain = 0.2, type = 'square', slide = 0, when = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type; osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.02);
}

// dist: metres from the listener; vol scales and muffles with distance.
export function sndShot(weaponKey, dist = 0) {
  if (!ctx) return;
  const near = Math.max(0.12, 1 - dist / 60);
  const freq = 2400 - Math.min(1600, dist * 30);
  if (weaponKey === 'scatter') {
    burst({ dur: 0.28, freq: freq * 0.6, gain: 0.8 * near });
    tone({ freq: 120, dur: 0.18, gain: 0.4 * near, type: 'triangle', slide: -60 });
  } else if (weaponKey === 'longshot') {
    burst({ dur: 0.22, freq, gain: 0.7 * near });
    tone({ freq: 90, dur: 0.22, gain: 0.45 * near, type: 'triangle', slide: -40 });
  } else if (weaponKey === 'smg') {
    burst({ dur: 0.07, freq, gain: 0.4 * near });
  } else {
    burst({ dur: 0.11, freq, gain: 0.55 * near });
    tone({ freq: 160, dur: 0.07, gain: 0.18 * near, type: 'triangle', slide: -70 });
  }
}
export function sndReload() { tone({ freq: 300, dur: 0.05, gain: 0.12 }); tone({ freq: 210, dur: 0.05, gain: 0.12, when: 0.16 }); }
export function sndDryFire() { tone({ freq: 900, dur: 0.04, gain: 0.1, type: 'square' }); }
export function sndHit(head) { tone({ freq: head ? 1560 : 1180, dur: 0.06, gain: 0.16, type: 'sine' }); }
export function sndHurt() { tone({ freq: 140, dur: 0.12, gain: 0.22, type: 'sawtooth', slide: -50 }); }
export function sndKill() { tone({ freq: 660, dur: 0.09, gain: 0.16 }); tone({ freq: 990, dur: 0.12, gain: 0.16, when: 0.07 }); }
export function sndBeep(final) { tone({ freq: final ? 1760 : 1180, dur: final ? 0.3 : 0.07, gain: 0.14, type: 'sine' }); }
export function sndPlant() { tone({ freq: 520, dur: 0.08, gain: 0.15 }); tone({ freq: 780, dur: 0.1, gain: 0.15, when: 0.1 }); }
export function sndBoom() {
  if (!ctx) return;
  burst({ dur: 1.4, freq: 300, gain: 1.0 });
  tone({ freq: 55, dur: 1.2, gain: 0.7, type: 'sine', slide: -25 });
}
export function sndFlash() { burst({ dur: 0.3, freq: 5000, gain: 0.25, type: 'highpass' }); }
export function sndRoundWin() { tone({ freq: 523, dur: 0.14, gain: 0.16 }); tone({ freq: 784, dur: 0.22, gain: 0.16, when: 0.12 }); }
export function sndRoundLose() { tone({ freq: 392, dur: 0.14, gain: 0.16 }); tone({ freq: 262, dur: 0.24, gain: 0.16, when: 0.12 }); }
export function sndBuy() { tone({ freq: 880, dur: 0.06, gain: 0.12 }); tone({ freq: 1320, dur: 0.08, gain: 0.1, when: 0.05 }); }
