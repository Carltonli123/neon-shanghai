// Wanted level: crimes add heat, heat maps to 0-5 stars, stars decay when things are quiet.
import { G, $ } from '../state.js';
import { track } from './analytics.js';

const STAR_T = [1, 60, 150, 300, 520];
export function starsOf(h) { let s = 0; for (const t of STAR_T) if (h >= t) s++; return s; }
let shown = 0;
export function renderStars(flash) {
  const s = starsOf(G.P.heat), el = $('#stars');
  el.querySelectorAll('i').forEach((i, k) => i.classList.toggle('on', k < s));
  el.setAttribute('aria-label', 'Wanted level ' + s + ' of 5');
  if (flash && s > shown) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  shown = s;
}
export function addHeat(n) {
  if (n <= 0) return;
  const before = starsOf(G.P.heat); G.P.heat = Math.min(800, G.P.heat + n); G.P.calm = 0;
  const after = starsOf(G.P.heat); if (after !== before) { renderStars(true); track('wanted', { stars: after }); }
}
export function clearHeat() { G.P.heat = 0; renderStars(false); }
export function updateWanted(dt) {
  const P = G.P; P.calm += dt;
  if (P.calm > 12 && P.heat > 0) { const b = starsOf(P.heat); P.heat = Math.max(0, P.heat - 9 * dt); if (starsOf(P.heat) !== b) { renderStars(false); track('wanted', { stars: starsOf(P.heat) }); } }
}
