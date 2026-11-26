// Shared game state and small helpers used by every module.
export const G = {
  renderer: null, scene: null, camera: null, composer: null, controls: null,
  world: null, district: 'ljz', tierKey: 'high', autoTier: true, q: null,
  mode: 'play', time: 0, dt: 0, frame: 0,
  keys: { up: 0, down: 0, left: 0, right: 0, brake: 0, sprint: 0, fire: 0 },
  fireQueued: false, camFar: false,
  P: { x: 0, z: 0, h: 0, mode: 'foot', veh: null, weapon: 0, cool: 0, heat: 0, calm: 99, punch: 0, aim: 0, busted: 0, speed: 0 },
  hero: null,
  weather: { rain: true, wet: 1 },
  stats: { total: 0, last: '' },
  shake: 0
};
export const $ = s => document.querySelector(s);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapAng = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export function rng(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function hash1(n) { let x = (n * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; }
export function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; } }
