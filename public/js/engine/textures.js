// Procedural textures generated at load time: facades, noise, glow sprites. Nothing is downloaded.
import * as THREE from 'three';
import { rng } from '../state.js';

export const TILE_W = 32, TILE_H = 128; // one facade texture covers 32 m x 128 m

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function srgb(tex) { tex.colorSpace = THREE.SRGBColorSpace; return tex; }
function tiled(c, aniso, color) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
  t.repeat.set(1 / TILE_W, 1 / TILE_H); if (color) srgb(t); return t;
}

// Facade styles. Each returns { map, emissiveMap } drawn on a 32 m x 128 m tile.
const STYLES = {
  glass: { cols: 8, rows: 32, lit: 0.38, palette: ['#ffe6bf', '#fff1d6', '#d6ecff', '#bfe0ff'] },
  office: { cols: 8, rows: 32, lit: 0.42, palette: ['#ffd9a0', '#ffe8c4', '#fff4e0'] },
  resi: { cols: 10, rows: 40, lit: 0.34, palette: ['#ffcf8a', '#ffdcae', '#ffc070', '#9fc4ff'] },
  old: { cols: 8, rows: 32, lit: 0.7, palette: ['#ffe2a0', '#fff0c8', '#ffd27a'] },
  low: { cols: 10, rows: 40, lit: 0.22, palette: ['#ffc77a', '#ffd9a4'] }
};
export function makeFacade(style, scale, aniso, seed) {
  const S = STYLES[style], W = Math.round(512 * scale), H = Math.round(2048 * scale);
  const ca = canvas(W, H), ce = canvas(W, H), a = ca.getContext('2d'), e = ce.getContext('2d'), r = rng(seed);
  const cw = W / S.cols, chh = H / S.rows;
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  if (style === 'glass') {
    for (let row = 0; row < S.rows; row++) { const g = 26 + r() * 8; a.fillStyle = `rgb(${g * .75 | 0},${g * .9 | 0},${g * 1.25 | 0})`; a.fillRect(0, row * chh, W, chh); }
  } else if (style === 'office') { a.fillStyle = '#5a5650'; a.fillRect(0, 0, W, H); }
  else if (style === 'resi') { a.fillStyle = '#6a655f'; a.fillRect(0, 0, W, H); }
  else if (style === 'old') { a.fillStyle = '#8c6c44'; a.fillRect(0, 0, W, H); e.fillStyle = 'rgb(70,42,14)'; e.fillRect(0, 0, W, H); }
  else { a.fillStyle = '#3d3936'; a.fillRect(0, 0, W, H); }
  for (let row = 0; row < S.rows; row++) {
    const rowLit = S.lit * (0.45 + r() * 1.1), y0 = row * chh;
    const officeFloor = r() < 0.15; // a whole floor left on
    for (let col = 0; col < S.cols; col++) {
      const x0 = col * cw;
      let wx, wy, ww, wh;
      if (style === 'glass') { wx = x0 + cw * .06; wy = y0 + chh * .2; ww = cw * .88; wh = chh * .74; }
      else if (style === 'office') { wx = x0 + cw * .18; wy = y0 + chh * .24; ww = cw * .64; wh = chh * .58; }
      else if (style === 'resi') { wx = x0 + cw * .2; wy = y0 + chh * .22; ww = cw * .6; wh = chh * .56; }
      else if (style === 'old') { wx = x0 + cw * .28; wy = y0 + chh * .18; ww = cw * .44; wh = chh * .64; }
      else { wx = x0 + cw * .25; wy = y0 + chh * .3; ww = cw * .5; wh = chh * .5; }
      // glass
      a.fillStyle = style === 'glass' ? `rgba(14,20,34,.9)` : '#14171d';
      if (style === 'old') { a.beginPath(); a.moveTo(wx, wy + wh); a.lineTo(wx, wy + ww / 2); a.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0); a.lineTo(wx + ww, wy + wh); a.fill(); }
      else a.fillRect(wx, wy, ww, wh);
      const lit = officeFloor ? r() < 0.9 : r() < rowLit;
      if (lit) {
        const c = S.palette[(r() * S.palette.length) | 0];
        const gr = e.createLinearGradient(0, wy, 0, wy + wh);
        const k = 0.55 + r() * 0.45;
        gr.addColorStop(0, shade(c, k * 0.75)); gr.addColorStop(1, shade(c, k));
        e.fillStyle = gr; e.fillRect(wx, wy, ww, wh);
        if (r() < 0.35) { e.fillStyle = 'rgba(0,0,0,.55)'; for (let b = 0; b < 4; b++) e.fillRect(wx, wy + wh * (b / 4), ww, wh * 0.08); } // blinds
        if (r() < 0.25) { e.fillStyle = 'rgba(0,0,0,.7)'; e.fillRect(wx + ww * (0.3 + r() * 0.4), wy + wh * 0.35, ww * 0.18, wh * 0.65); } // figure / furniture
        a.fillStyle = 'rgba(255,230,190,.25)'; a.fillRect(wx, wy, ww, wh);
      }
    }
    // slabs, mullions, balconies, cornices
    if (style === 'glass') { a.fillStyle = '#3a404c'; a.fillRect(0, y0, W, chh * .16); a.fillStyle = '#596071'; for (let col = 0; col <= S.cols; col++) a.fillRect(col * cw - 1, y0, 2, chh); }
    if (style === 'resi' && row % 2 === 0) { a.fillStyle = '#4a4642'; a.fillRect(0, y0 + chh * .82, W, chh * .1); a.fillStyle = '#8a857e'; a.fillRect(0, y0 + chh * .8, W, 2); }
    if (style === 'old' && row % 4 === 3) { a.fillStyle = '#a5845a'; a.fillRect(0, y0, W, chh * .14); e.fillStyle = 'rgb(120,74,26)'; e.fillRect(0, y0, W, chh * .14); }
    if (style === 'office') { a.fillStyle = '#6a665f'; a.fillRect(0, y0, W, chh * .12); }
  }
  return { map: tiled(ca, aniso, true), emissiveMap: tiled(ce, aniso, true) };
}
function shade(hex, k) { const n = parseInt(hex.slice(1), 16); return `rgb(${((n >> 16) & 255) * k | 0},${((n >> 8) & 255) * k | 0},${(n & 255) * k | 0})`; }

// Tileable value noise: R and G are independent fields, B is a large-scale field (puddles).
export function makeNoiseTexture(size = 256) {
  const c = canvas(size, size), g = c.getContext('2d'), img = g.createImageData(size, size), r = rng(99);
  function field(cells) {
    const grid = []; for (let i = 0; i < cells * cells; i++) grid.push(r());
    const at = (x, y) => grid[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
    return (u, v) => { const x = u * cells, y = v * cells, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      return (at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx) * (1 - sy) + (at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx) * sy; };
  }
  const fa = [field(8), field(16), field(32)], fb = [field(8), field(16), field(32)], fc = [field(4), field(8)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    img.data[i] = (fa[0](u, v) * .55 + fa[1](u, v) * .3 + fa[2](u, v) * .15) * 255;
    img.data[i + 1] = (fb[0](u, v) * .55 + fb[1](u, v) * .3 + fb[2](u, v) * .15) * 255;
    img.data[i + 2] = (fc[0](u, v) * .7 + fc[1](u, v) * .3) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export function makeGlowTexture() {
  const c = canvas(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,.55)'); gr.addColorStop(0.45, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return srgb(new THREE.CanvasTexture(c));
}
export function makeBeamTexture() {
  const c = canvas(64, 128), g = c.getContext('2d'), gr = g.createRadialGradient(32, 128, 4, 32, 90, 110);
  gr.addColorStop(0, 'rgba(255,240,200,.6)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 128); return srgb(new THREE.CanvasTexture(c));
}
export function makeRoofTexture(aniso) {
  const c = canvas(256, 256), g = c.getContext('2d'), r = rng(7);
  g.fillStyle = '#2a2c31'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) { const v = 30 + r() * 30 | 0; g.fillStyle = `rgb(${v},${v},${v + 4})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
  g.strokeStyle = 'rgba(0,0,0,.35)'; for (let i = 0; i < 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  const t = srgb(new THREE.CanvasTexture(c)); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 16, 1 / 16); t.anisotropy = aniso; return t;
}
