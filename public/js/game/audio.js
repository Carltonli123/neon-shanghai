// All game sound, synthesized with Web Audio (no files): weapons, impacts, engine, siren. Rain is visual only.
// Browsers only allow audio after a user gesture, so the context starts (or resumes) on any
// click, tap or key press, and the SOUND button shows the current state.
import { G, store, $ } from '../state.js';

let ctx = null, master = null, sfxBus = null, ambBus = null, noise = null;
let humGain = null, engGain = null, engOsc = null, engOsc2 = null, engFilter = null, sirenGain = null, sirenOsc = null;
let muted = store('nh-mute') === '1';

export const audioState = () => (!ctx ? 'off' : muted ? 'muted' : ctx.state);

function build() {
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.connect(ctx.destination);
  master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(comp);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
  ambBus = ctx.createGain(); ambBus.gain.value = 0.7; ambBus.connect(master);
  const n = ctx.sampleRate * 2; noise = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  ctx.onstatechange = refreshButton;
  startAmbience();
  return true;
}
export function ensureAudio() {
  try {
    if (!ctx && !build()) return;
    if (ctx.state !== 'running') ctx.resume().then(refreshButton, () => {});
  } catch (e) { console.warn('Audio unavailable:', e); }
  refreshButton();
}
for (const ev of ['pointerdown', 'mousedown', 'keydown', 'touchend']) addEventListener(ev, ensureAudio, { capture: true, passive: true });

export function toggleMute() {
  muted = !muted; store('nh-mute', muted ? '1' : '0');
  ensureAudio();
  if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
  refreshButton(); return muted;
}
export function refreshButton() {
  const b = $('#btnSnd'); if (!b) return;
  const s = audioState(), on = s === 'running';
  b.textContent = s === 'muted' ? 'MUTED' : on ? 'SOUND' : 'SOUND ▶';
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Sound is on. Click to mute (M).' : s === 'muted' ? 'Sound is muted. Click to unmute (M).' : 'Click to start sound';
}

/* ---------- building blocks ---------- */
function noiseSrc() { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.loopStart = Math.random(); return s; }
function filt(type, f, q) { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; if (q) x.Q.value = q; return x; }
function burst(dest, t, { type = 'lowpass', f0 = 2000, f1 = 300, dur = 0.2, gain = 0.3, attack = 0.002 }) {
  const s = noiseSrc(), fl = filt(type, f0), g = ctx.createGain();
  fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl).connect(g).connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function tone(dest, t, { wave = 'sine', f0 = 140, f1 = 40, dur = 0.14, gain = 0.3 }) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = wave;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
// Volume falls off with distance from the camera; pan follows the camera's left/right.
function spatial(x, z) {
  if (x == null || !G.camera) return { vol: 1, pan: 0 };
  const c = G.camera, dx = x - c.position.x, dz = z - c.position.z, d = Math.hypot(dx, dz);
  const e = c.matrixWorld.elements, rx = e[0], rz = e[2], rl = Math.hypot(rx, rz) || 1;
  return { vol: 1 / (1 + d / 22), pan: d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / rl / d)) * 0.8 : 0 };
}

export function sfx(name, x, z) {
  if (!ctx || ctx.state !== 'running' || muted) return;
  const t = ctx.currentTime, { vol, pan } = spatial(x, z); if (vol < 0.02) return;
  const out = ctx.createGain(); out.gain.value = vol;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p).connect(sfxBus); } else out.connect(sfxBus);
  switch (name) {
    case 'pistol':
      burst(out, t, { type: 'highpass', f0: 3000, f1: 1500, dur: 0.035, gain: 0.55 });
      burst(out, t, { f0: 2200, f1: 220, dur: 0.3, gain: 0.5 });
      tone(out, t, { f0: 150, f1: 38, dur: 0.16, gain: 0.55 });
      burst(out, t + 0.07, { f0: 900, f1: 150, dur: 0.45, gain: 0.07, attack: 0.03 }); // street echo
      break;
    case 'smg':
      burst(out, t, { type: 'highpass', f0: 3500, f1: 1800, dur: 0.025, gain: 0.4 });
      burst(out, t, { f0: 3000, f1: 300, dur: 0.12, gain: 0.35 });
      tone(out, t, { f0: 180, f1: 50, dur: 0.08, gain: 0.35 });
      break;
    case 'ric': tone(out, t, { f0: 2600 + Math.random() * 800, f1: 900, dur: 0.14, gain: 0.07 }); burst(out, t, { type: 'bandpass', f0: 4000, f1: 2000, dur: 0.04, gain: 0.12 }); break;
    case 'carhit': tone(out, t, { wave: 'square', f0: 700, f1: 260, dur: 0.09, gain: 0.08 }); burst(out, t, { type: 'bandpass', f0: 2500, f1: 1200, dur: 0.07, gain: 0.25 }); break;
    case 'thud': burst(out, t, { f0: 500, f1: 120, dur: 0.12, gain: 0.35 }); break;
    case 'body': burst(out, t, { f0: 400, f1: 80, dur: 0.22, gain: 0.45 }); tone(out, t + 0.02, { f0: 95, f1: 45, dur: 0.22, gain: 0.35 }); break;
    case 'punch': burst(out, t, { type: 'bandpass', f0: 900, f1: 300, dur: 0.09, gain: 0.4 }); break;
    case 'swing': burst(out, t, { type: 'bandpass', f0: 600, f1: 1800, dur: 0.12, gain: 0.08, attack: 0.04 }); break;
    case 'door': burst(out, t, { f0: 700, f1: 150, dur: 0.1, gain: 0.3 }); tone(out, t + 0.05, { f0: 120, f1: 60, dur: 0.12, gain: 0.25 }); break;
  }
}

/* ---------- continuous sounds ---------- */
function startAmbience() {
  const hum = noiseSrc(), hLp = filt('lowpass', 160); humGain = ctx.createGain(); humGain.gain.value = 0.05;
  hum.connect(hLp).connect(humGain).connect(ambBus); hum.start();
  engOsc = ctx.createOscillator(); engOsc.type = 'sawtooth'; engOsc2 = ctx.createOscillator(); engOsc2.type = 'square';
  engFilter = filt('lowpass', 420, 2); engGain = ctx.createGain(); engGain.gain.value = 0;
  const half = ctx.createGain(); half.gain.value = 0.5;
  engOsc.connect(engFilter); engOsc2.connect(half).connect(engFilter); engFilter.connect(engGain).connect(sfxBus);
  engOsc.start(); engOsc2.start();
  sirenOsc = ctx.createOscillator(); sirenOsc.type = 'triangle'; sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
  sirenOsc.connect(sirenGain).connect(ambBus); sirenOsc.start();
}
export function updateAudio() {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, P = G.P, W = G.world;
  const driving = P.mode === 'car' && P.veh;
  const sp = driving ? Math.abs(P.veh.speed) : 0, throttle = G.keys.up ? 1 : 0;
  const f = 38 + sp * 3.2 + throttle * 12;
  engOsc.frequency.setTargetAtTime(f, t, 0.08); engOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
  engFilter.frequency.setTargetAtTime(300 + sp * 22 + throttle * 300, t, 0.1);
  engGain.gain.setTargetAtTime(driving ? 0.05 + Math.min(0.07, sp / 600) + throttle * 0.02 : 0, t, 0.15);
  let near = 1e9;
  if (W) for (const c of W.police) near = Math.min(near, Math.hypot(c.x - P.x, c.z - P.z));
  sirenGain.gain.setTargetAtTime(near < 300 ? 0.07 * (1 - near / 300) : 0, t, 0.3);
  sirenOsc.frequency.setTargetAtTime((G.time % 0.9) < 0.45 ? 650 : 870, t, 0.02); // two-tone siren
}
