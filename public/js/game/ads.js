// In-game ad inventory (roadside boards, rooftop boards, LED walls) and viewability tracking.
import * as THREE from 'three';
import { G, $, hash1 } from '../state.js';
import { insideBuilding, isWater, onRoad, addCircle } from '../world/world.js';
import { track } from './analytics.js';

export const ADS = [
  { brand: 'DRAGON COLA', cn: '龙可乐', tag: 'Ice cold since 1997', bg: '#c8102e', fg: '#ffffff' },
  { brand: 'PEARL NOODLES', cn: '明珠拉面', tag: 'Hand-pulled in 15 minutes', bg: '#ffb400', fg: '#2a1300' },
  { brand: 'HUANGPU AIR', cn: '黄浦航空', tag: 'Shanghai to anywhere', bg: '#0b3d91', fg: '#ffffff' },
  { brand: 'YOUR BRAND HERE', cn: '广告位招租', tag: 'In-game slot · 1024×512', bg: '#0d0f16', fg: '#3fd6ff' },
  { brand: 'METRO MILK TEA', cn: '地铁奶茶', tag: 'Line 2 · Exit 6', bg: '#2e1a47', fg: '#ffd6f0' },
  { brand: 'NEBULA PHONE', cn: '星云手机', tag: 'Night mode, all day', bg: '#101820', fg: '#9bf2c8' }
];
function fitFont(ctx, text, weight, size, family, maxW) { let s = size; do { ctx.font = weight + ' ' + s + 'px ' + family; s -= 2; } while (ctx.measureText(text).width > maxW && s > 10); }
export function drawAd(b) {
  const ad = ADS[b.ad % ADS.length], ctx = b.ctx, W = ctx.canvas.width, H = ctx.canvas.height, portrait = H > W, u = (portrait ? H : W) / 1024;
  ctx.fillStyle = ad.bg; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = 0.1; ctx.fillStyle = ad.fg; for (let i = -H; i < W; i += 92 * u) { ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + 36 * u, H); ctx.lineTo(i + 36 * u + H, 0); ctx.lineTo(i + H, 0); ctx.fill(); } ctx.restore();
  ctx.strokeStyle = ad.fg; ctx.globalAlpha = 0.5; ctx.lineWidth = 8 * u; ctx.strokeRect(20 * u, 20 * u, W - 40 * u, H - 40 * u); ctx.globalAlpha = 1;
  ctx.fillStyle = ad.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (portrait) {
    ctx.font = '700 ' + Math.round(W * 0.28) + 'px "Noto Sans SC",sans-serif'; const ch = [...ad.cn], step = Math.min(W * 0.36, (H * 0.58) / ch.length);
    ch.forEach((c, i) => ctx.fillText(c, W / 2, H * 0.12 + step * (i + 0.5)));
    fitFont(ctx, ad.brand, '700', Math.round(W * 0.13), '"Chakra Petch",sans-serif', W * 0.86); ctx.fillText(ad.brand, W / 2, H * 0.8);
    fitFont(ctx, ad.tag, '500', Math.round(W * 0.07), '"IBM Plex Sans",sans-serif', W * 0.86); ctx.globalAlpha = 0.85; ctx.fillText(ad.tag, W / 2, H * 0.87); ctx.globalAlpha = 1;
  } else {
    fitFont(ctx, ad.brand, '700', Math.round(H * 0.3), '"Chakra Petch",sans-serif', W * 0.86); ctx.fillText(ad.brand, W / 2, H * 0.38);
    ctx.font = '700 ' + Math.round(H * 0.18) + 'px "Noto Sans SC",sans-serif'; ctx.fillText(ad.cn, W / 2, H * 0.64);
    fitFont(ctx, ad.tag, '500', Math.round(H * 0.085), '"IBM Plex Sans",sans-serif', W * 0.86); ctx.globalAlpha = 0.85; ctx.fillText(ad.tag, W / 2, H * 0.84); ctx.globalAlpha = 1;
  }
  ctx.font = '600 ' + Math.round(28 * u) + 'px "IBM Plex Sans",sans-serif'; ctx.textAlign = 'left'; ctx.globalAlpha = 0.7; ctx.fillText('AD · ' + b.id, 40 * u, 52 * u); ctx.globalAlpha = 1;
  b.tex.needsUpdate = true;
}

const frameMat = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.6, metalness: 0.6 });
const poleMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.5, metalness: 0.7 });
function addBillboard(W, o) {
  const portrait = o.h > o.w, c = document.createElement('canvas'); c.width = portrait ? 512 : 1024; c.height = portrait ? 1024 : 512;
  const ctx = c.getContext('2d'), tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = G.renderer.capabilities.getMaxAnisotropy();
  const holder = new THREE.Group(); holder.position.set(o.x, o.y, o.z); holder.rotation.y = o.rotY;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(o.led ? 1.5 : 1.15, o.led ? 1.5 : 1.15, o.led ? 1.5 : 1.15) }));
  face.position.z = 0.06; holder.add(face);
  if (!o.flush) { const back = new THREE.Mesh(new THREE.BoxGeometry(o.w + 0.8, o.h + 0.8, 0.6), frameMat); back.position.z = -0.3; back.castShadow = true; holder.add(back); }
  if (o.pole) { const ph = o.y - o.h / 2; const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, ph, 10), poleMat); p.position.set(0, -o.h / 2 - ph / 2, -0.6); p.castShadow = true; holder.add(p); addCircle(W, o.x, o.z, 1.1, false); }
  W.group.add(holder);
  const b = { id: o.id, ctx, tex, ad: o.ad, rotate: !!o.rotate, x: o.x, y: o.y, z: o.z, h: o.h, nx: Math.sin(o.rotY), nz: Math.cos(o.rotY), vis: 0, counted: false, next: 5 + Math.random() * 3 };
  drawAd(b); W.billboards.push(b); return b;
}

export function placeBillboards(W, cfg) {
  const d = W.data; let n = 0;
  const id = (kind) => cfg.prefix + '-' + kind + '-' + String(++n).padStart(2, '0');
  // roadside boards every ~280 m along main roads near the action
  let road = 0, carry = 140;
  for (const r of d.roads) {
    if (r.e || !'PS'.includes(r.k) || road >= 16) continue;
    const p = r.p;
    for (let i = 0; i + 3 < p.length && road < 16; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = Math.hypot(dx, dz); if (L < 1) continue;
      const fx = dx / L, fz = dz / L, nx = -fz, nz = fx;
      for (let s = carry; s < L && road < 16; s += 280) {
        const side = hash1(Math.round(ax + s)) < 0.5 ? 1 : -1, off = r.w / 2 + 4;
        const x = ax + fx * s + nx * side * off, z = az + fz * s + nz * side * off;
        if (Math.hypot(x - cfg.focus[0], z - cfg.focus[1]) > 1300) continue;
        if (insideBuilding(W, x, z) || isWater(W, x, z) || onRoad(W, x, z, 2)) continue;
        const face = side > 0 ? [-fx, -fz] : [fx, fz];
        addBillboard(W, { x, y: 13, z, w: 14, h: 7, rotY: Math.atan2(face[0], face[1]), id: id('ROAD'), ad: road % ADS.length, pole: true }); road++;
      }
      carry = Math.max(0, carry - L) || 280;
    }
  }
  // LED walls on tall buildings facing the focus point
  const cands = [];
  for (const b of d.buildings) {
    if (b.lm || b.h < 70 || b.h > 260) continue;
    let p = b.p, A = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) A += p[j] * p[i + 1] - p[i] * p[j + 1];
    if (A > 0) { const o = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); p = o; }
    let cx = 0, cz = 0; for (let i = 0; i < p.length; i += 2) { cx += p[i]; cz += p[i + 1]; } cx /= p.length / 2; cz /= p.length / 2;
    const dist = Math.hypot(cx - cfg.focus[0], cz - cfg.focus[1]); if (dist > 900 || dist < 120) continue;
    const tx = (cfg.ledFace ? cfg.ledFace[0] : cfg.focus[0] - cx), tz = (cfg.ledFace ? cfg.ledFace[1] : cfg.focus[1] - cz), tl = Math.hypot(tx, tz) || 1;
    let best = null;
    for (let i = 0; i < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], j = (i + 2) % p.length, ex = p[j] - ax, ez = p[j + 1] - az, L = Math.hypot(ex, ez); if (L < 22) continue;
      const onx = -ez / L, onz = ex / L, dot = (onx * tx + onz * tz) / tl;
      if (dot > 0.6 && (!best || dot * L > best.score)) best = { score: dot * L, x: ax + ex / 2 + onx * 0.6, z: az + ez / 2 + onz * 0.6, L, rot: Math.atan2(onx, onz) };
    }
    if (best) cands.push({ b, best, score: best.score + b.h * 0.3 - dist * 0.05 });
  }
  cands.sort((a, b) => b.score - a.score).slice(0, cfg.ledWalls).forEach((c, i) => {
    const w = Math.min(c.best.L * 0.85, 60), h = Math.min(c.b.h * 0.5, w * 1.7);
    addBillboard(W, { x: c.best.x, y: c.b.h * 0.42 + h * 0.1, z: c.best.z, w, h, rotY: c.best.rot, id: id('LED'), ad: (i * 2) % ADS.length, rotate: true, flush: true, led: true });
  });
  // rooftop boards on mid-rise buildings near the focus
  let roof = 0;
  for (const b of d.buildings) {
    if (roof >= 10 || b.lm || b.h < 28 || b.h > 90) continue;
    let cx = 0, cz = 0; for (let i = 0; i < b.p.length; i += 2) { cx += b.p[i]; cz += b.p[i + 1]; } cx /= b.p.length / 2; cz /= b.p.length / 2;
    if (Math.hypot(cx - cfg.focus[0], cz - cfg.focus[1]) > 700 || hash1(Math.round(cx * 7 + cz)) > 0.08) continue;
    const ang = Math.atan2(cfg.focus[0] - cx, cfg.focus[1] - cz);
    addBillboard(W, { x: cx, y: b.h + 6, z: cz, w: 18, h: 8, rotY: ang, id: id('ROOF'), ad: roof % ADS.length }); roof++;
  }
}

/* ---------- viewability ---------- */
const frustum = new THREE.Frustum(), projM = new THREE.Matrix4(), v = new THREE.Vector3();
let inView = '—';
function endView(b) { if (b.counted) track('view_end', { slot: b.id, brand: ADS[b.ad % ADS.length].brand, secs: Math.round(b.vis * 10) / 10 }); b.vis = 0; b.counted = false; }
export function trackAds(dt) {
  const W = G.world, cam = G.camera;
  projM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(projM);
  const cp = cam.position, fpx = innerHeight / (2 * Math.tan(cam.fov * Math.PI / 360)); let best = null;
  for (const b of W.billboards) {
    if (b.rotate) { b.next -= dt; if (b.next <= 0) { endView(b); b.ad = (b.ad + 1) % ADS.length; drawAd(b); b.next = 7; } }
    v.set(b.x, b.y, b.z);
    const dx = cp.x - b.x, dz = cp.z - b.z, dist = Math.max(1, Math.hypot(dx, dz, cp.y - b.y));
    const facing = (dx * b.nx + dz * b.nz) / Math.max(1, Math.hypot(dx, dz)), px = b.h / dist * fpx;
    const ok = G.mode !== 'photo' && frustum.containsPoint(v) && facing > 0.2 && px > 18;
    if (ok) {
      b.vis += dt;
      if (!b.counted && b.vis >= 1) {
        b.counted = true; G.stats.total++; const brand = ADS[b.ad % ADS.length].brand; G.stats.last = brand + ' · ' + b.id;
        const e = $('#impr'); e.textContent = G.stats.total; e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); $('#lastImp').textContent = 'Last: ' + G.stats.last;
        track('impression', { slot: b.id, brand, px: Math.round(px), dist: Math.round(dist), mode: G.P.mode });
      }
      if (!best || px > best.px) best = { b, px };
    } else if (b.vis > 0) endView(b);
  }
  inView = best ? '<b>' + ADS[best.b.ad % ADS.length].brand + '</b> · ' + best.b.id : '—';
}
export function inViewLabel() { return inView; }
export function redrawAds() { for (const b of G.world.billboards) drawAd(b); }
