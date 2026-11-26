// Minimap (drawn from OSM data), speedometer, prompts and landmark toasts.
import { G, $ } from '../state.js';
import { WEAPONS } from './combat.js';
import { actionLabel } from '../entities/vehicles.js';
import { inViewLabel } from './ads.js';
import { track } from './analytics.js';

const mini = $('#mini'), mctx = mini.getContext('2d'), MS = 0.25;
let mapImg = null, mapX0 = 0, mapZ0 = 0, hudT = 0, toastKey = '', promptT = 0, promptMsg = '';
const ROADW = { T: '#6a5a3a', P: '#57607a', S: '#4a5268', R: '#3f465a', L: '#353b4c', V: '#2c3140', W: '#5a3e3e', F: '#2a2e3a' };

export function sizeMini() { const r = mini.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2); mini.width = Math.round(r.width * d) || 176; mini.height = Math.round(r.height * d) || 176; }
const path = (g, p, close) => { g.beginPath(); g.moveTo((p[0] - mapX0) * MS, (p[1] - mapZ0) * MS); for (let i = 2; i < p.length; i += 2) g.lineTo((p[i] - mapX0) * MS, (p[i + 1] - mapZ0) * MS); if (close) g.closePath(); };
export function buildMiniMap(W) {
  const b = W.bounds, pad = 300; mapX0 = b[0] - pad; mapZ0 = b[2] - pad;
  const c = document.createElement('canvas'); c.width = Math.ceil((b[1] - b[0] + 2 * pad) * MS); c.height = Math.ceil((b[3] - b[2] + 2 * pad) * MS);
  const g = c.getContext('2d'); g.fillStyle = '#0b0e17'; g.fillRect(0, 0, c.width, c.height); g.lineJoin = g.lineCap = 'round';
  for (const pk of W.data.parks) { path(g, pk.p, true); g.fillStyle = '#13261a'; g.fill(); }
  for (const wa of W.data.water) { path(g, wa.p, true); g.fillStyle = '#123c5e'; g.fill(); }
  for (const k of ['F', 'V', 'L', 'W', 'R', 'S', 'P', 'T']) for (const r of W.data.roads) { if (r.k !== k) continue; path(g, r.p); g.strokeStyle = ROADW[k]; g.lineWidth = Math.max(1, r.w * MS); g.stroke(); }
  g.fillStyle = '#232838'; for (const bd of W.data.buildings) { path(g, bd.p, true); g.fill(); }
  g.fillStyle = '#ffc35a'; for (const bb of W.billboards) g.fillRect((bb.x - mapX0) * MS - 2, (bb.z - mapZ0) * MS - 2, 4, 4);
  for (const l of W.landmarks) { g.fillStyle = '#ff4f97'; g.beginPath(); g.arc((l.x - mapX0) * MS, (l.z - mapZ0) * MS, 3.5, 0, 7); g.fill(); }
  mapImg = c;
}
export function drawMini() {
  const W = G.world, P = G.P, w = mini.width, h = mini.height, k = w / 176;
  mctx.fillStyle = '#0b0e17'; mctx.fillRect(0, 0, w, h);
  if (mapImg) {
    mctx.save(); mctx.translate(w / 2, h / 2); mctx.scale(k * 1.2, k * 1.2);
    mctx.drawImage(mapImg, -(P.x - mapX0) * MS, -(P.z - mapZ0) * MS);
    mctx.fillStyle = '#e8ecf7'; for (const a of W.traffic) mctx.fillRect((a.x - P.x) * MS - 1, (a.z - P.z) * MS - 1, 2, 2);
    const on = (G.time * 6 | 0) % 2; for (const c of W.police) { mctx.fillStyle = on ? '#ff3040' : '#3070ff'; mctx.fillRect((c.x - P.x) * MS - 2.5, (c.z - P.z) * MS - 2.5, 5, 5); }
    mctx.restore();
  }
  mctx.save(); mctx.translate(w / 2, h / 2); mctx.rotate(Math.PI - P.h);
  mctx.fillStyle = P.mode === 'car' ? '#ff4f97' : '#ffffff'; mctx.strokeStyle = P.mode === 'car' ? '#fff' : '#ff4f97'; mctx.lineWidth = 1.5 * k;
  mctx.beginPath(); mctx.moveTo(0, -8 * k); mctx.lineTo(6 * k, 7 * k); mctx.lineTo(0, 3 * k); mctx.lineTo(-6 * k, 7 * k); mctx.closePath(); mctx.fill(); mctx.stroke(); mctx.restore();
  mctx.fillStyle = '#9097b3'; mctx.font = (10 * k) + 'px "Chakra Petch",sans-serif'; mctx.fillText('N', w / 2 - 3 * k, 12 * k);
}
export function showPrompt(msg, secs) { promptMsg = msg; promptT = secs; }
export function updateHud(dt) {
  promptT -= dt; hudT += dt; if (hudT < 0.12) return; hudT = 0;
  const P = G.P, sb = $('#speedBox');
  if (P.mode === 'car') { sb.classList.remove('foot'); $('#spd').textContent = Math.round(Math.abs(P.veh.speed) * 3.6); $('#spdLab').textContent = 'KM/H'; }
  else { sb.classList.add('foot'); $('#spd').textContent = P.speed > 5 ? 'SPRINT' : P.speed > 0 ? 'WALK' : 'ON FOOT'; $('#spdLab').textContent = ''; }
  $('#weapon').textContent = WEAPONS[P.weapon].name; $('#mode').textContent = P.mode === 'car' ? 'Driving' : 'On foot';
  $('#inview').innerHTML = 'In view: ' + inViewLabel();
  const pr = $('#prompt');
  if (promptT > 0) { pr.textContent = promptMsg; pr.classList.add('show'); }
  else { const a = G.mode === 'play' ? actionLabel() : ''; if (a) { pr.innerHTML = '<kbd>F</kbd>' + a; pr.classList.add('show'); } else pr.classList.remove('show'); }
  let near = null, nd = 1e9;
  if (G.mode === 'play') for (const l of G.world.landmarks) { const d = Math.hypot(l.x - P.x, l.z - P.z); if (d < l.r && d < nd) { nd = d; near = l; } }
  const t = $('#toast');
  if (near) { if (toastKey !== near.cn + near.en) { toastKey = near.cn + near.en; $('#toastCn').textContent = near.cn; $('#toastEn').textContent = near.en; track('landmark', { name: near.en }); } t.classList.add('show'); }
  else { t.classList.remove('show'); toastKey = ''; }
}
