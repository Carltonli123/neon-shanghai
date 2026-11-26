// Extrudes OSM building footprints into merged, chunked meshes with procedural facades.
import * as THREE from 'three';
import { G, hash1 } from '../state.js';
import { makeFacade, makeRoofTexture } from '../engine/textures.js';
import { addPoly, pointInPoly, isWater } from './world.js';

const CHUNK = 700;
export const timeU = { value: 0 };
export const blinkMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
let cache = null;

const STYLE_PARAMS = {
  glass: { rough: 0.14, metal: 0.55, env: 1.4, ei: 2.2, tint: 0xffffff },
  office: { rough: 0.6, metal: 0.05, env: 0.5, ei: 2.0, tint: 0xffffff },
  resi: { rough: 0.75, metal: 0.02, env: 0.35, ei: 1.9, tint: 0xffffff },
  old: { rough: 0.7, metal: 0.02, env: 0.4, ei: 1.9, tint: 0xffffff },
  low: { rough: 0.85, metal: 0.0, env: 0.3, ei: 1.6, tint: 0xffffff }
};
function facadeMaterial(style, tex, led, seed) {
  const P = STYLE_PARAMS[style];
  const m = new THREE.MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissiveMap, emissive: 0xffffff, emissiveIntensity: P.ei, roughness: P.rough, metalness: P.metal, envMapIntensity: P.env, color: P.tint });
  const u = { uTime: timeU, uLed: { value: led ? 1 : 0 }, uSeed: { value: seed || 0 }, uShop: { value: style === 'glass' ? 0.5 : 1 } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vH; varying float vU;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y; vU = uv.x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH; varying float vU; uniform float uTime, uLed, uSeed, uShop;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float shop = 1.0 - smoothstep(3.4, 4.6, vH);
        float rnd = fract(sin(floor(vU / 6.0) * 12.9898 + uSeed * 7.0) * 43758.5453);
        totalEmissiveRadiance += vec3(1.0, 0.66, 0.36) * shop * step(0.3, rnd) * (0.8 + rnd) * uShop;
        if (uLed > 0.5) {
          float t = uTime * 0.5 + uSeed * 10.0;
          float mode = mod(floor(t / 9.0) + floor(uSeed * 3.0), 4.0), k;
          if (mode < 1.0) k = 0.5 + 0.5 * sin(vH * 0.06 - t * 3.0);
          else if (mode < 2.0) k = step(0.55, fract(vU * 0.015 - t * 0.4));
          else if (mode < 3.0) k = 0.5 + 0.5 * sin(vU * 0.05 + t * 2.0) * sin(vH * 0.035 - t * 1.4);
          else k = step(0.82, fract(sin(dot(floor(vec2(vU, vH) * 0.25), vec2(12.9, 78.2)) + floor(t * 4.0)) * 43758.5));
          vec3 lc = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + t * 0.05 + vH * 0.0015));
          totalEmissiveRadiance = totalEmissiveRadiance * 0.35 + lc * k * 2.6;
        }`);
  };
  m.customProgramCacheKey = () => 'facade' + (led ? '-led' : '');
  return m;
}

function materials() {
  const q = G.q, aniso = G.renderer.capabilities.getMaxAnisotropy();
  if (cache && cache.scale === q.texScale) return cache;
  const tex = {}; let s = 1;
  for (const st of Object.keys(STYLE_PARAMS)) tex[st] = makeFacade(st, q.texScale, aniso, s++ * 17);
  cache = { scale: q.texScale, tex, mats: {}, roof: null, detail: null };
  for (const st of Object.keys(STYLE_PARAMS)) cache.mats[st] = facadeMaterial(st, tex[st], false, 0);
  const roofTex = makeRoofTexture(aniso);
  cache.roof = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.9, metalness: 0, color: 0x9a9aa0 });
  cache.detail = new THREE.MeshStandardMaterial({ color: 0x5a5d64, roughness: 0.7, metalness: 0.3 });
  return cache;
}

function bucket() { return { pos: [], nrm: [], uv: [], idx: [] }; }
function signedArea(p) { let a = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1]; return a / 2; }
function ordered(p) { if (signedArea(p) <= 0) return p; const o = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); return o; }

function addWalls(B, p, y0, y1, uOff) {
  let u = uOff;
  for (let i = 0; i < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], j = (i + 2) % p.length, bx = p[j], bz = p[j + 1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.05) continue;
    const nx = -dz / L, nz = dx / L, v = B.pos.length / 3;
    B.pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    for (let k = 0; k < 4; k++) B.nrm.push(nx, 0, nz);
    B.uv.push(u, y0, u + L, y0, u + L, y1, u, y1);
    B.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    u += L;
  }
}
function addRoof(B, p, y) {
  const contour = []; for (let i = 0; i < p.length; i += 2) contour.push(new THREE.Vector2(p[i], p[i + 1]));
  let tris; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { return; }
  const v0 = B.pos.length / 3;
  for (const c of contour) { B.pos.push(c.x, y, c.y); B.nrm.push(0, 1, 0); B.uv.push(c.x, c.y); }
  for (const [a, b, c] of tris) {
    const A = contour[a], Bq = contour[b], C = contour[c];
    const cy = (Bq.y - A.y) * (C.x - A.x) - (Bq.x - A.x) * (C.y - A.y);
    if (cy > 0) B.idx.push(v0 + a, v0 + b, v0 + c); else B.idx.push(v0 + a, v0 + c, v0 + b);
  }
}
function addBox(B, x, y, z, w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z);
  const v0 = B.pos.length / 3, pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
  for (let i = 0; i < pa.count; i++) { B.pos.push(pa.getX(i), pa.getY(i), pa.getZ(i)); B.nrm.push(na.getX(i), na.getY(i), na.getZ(i)); B.uv.push(ua.getX(i), ua.getY(i)); }
  for (const i of g.index.array) B.idx.push(v0 + i);
  g.dispose();
}
function toMesh(B, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
  g.setIndex(B.idx); g.computeBoundingSphere(); g.computeBoundingBox();
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
}

function chooseStyle(b, cx, cz, W, cfg) {
  const r = hash1(Math.round(cx * 7 + cz * 13));
  if (b.k === 'h') return 'old';
  if (cfg.oldBank && b.h < 75 && cx < cfg.oldBank.x) { for (const d of [30, 70, 110, 150]) if (isWater(W, cx + d, cz)) return 'old'; }
  if (b.h >= 90) return r < 0.72 ? 'glass' : 'office';
  if (b.h < 14) return 'low';
  if (b.k === 'r') return 'resi';
  if (b.k === 'c') return r < 0.5 ? 'office' : 'glass';
  return r < 0.55 ? 'resi' : 'office';
}

export function buildBuildings(W, cfg) {
  const d = W.data, q = G.q, C = materials(), b0 = W.bounds;
  const models = Object.entries(d.landmarks).filter(([k, L]) => L.model && k !== 'ring').map(([k, L]) => ({ k, x: L.x, z: L.z, r: Math.max(L.w || 40, L.d || 40) * 0.55 }));
  const buckets = new Map(), details = new Map();
  const crown = { pos: [], col: [], idx: [] }, blinks = [];
  const get = (map, key) => { let B = map.get(key); if (!B) map.set(key, B = bucket()); return B; };
  // choose LED light-show towers: tallest glass towers near the focus point
  const cands = [];
  for (const b of d.buildings) {
    if (b.lm || b.h < 100) continue;
    const p = b.p; let cx = 0, cz = 0; for (let i = 0; i < p.length; i += 2) { cx += p[i]; cz += p[i + 1]; } cx /= p.length / 2; cz /= p.length / 2;
    const dist = Math.hypot(cx - cfg.ledFocus[0], cz - cfg.ledFocus[1]); if (dist > cfg.ledRadius) continue;
    cands.push({ b, score: b.h - dist * 0.08 });
  }
  const ledSet = new Set(cands.sort((a, b) => b.score - a.score).slice(0, cfg.ledCount).map(c => c.b));
  const CROWN = [[0.6, 0.85, 1.6], [1.8, 0.4, 1.1], [1.8, 1.25, 0.45], [0.4, 1.6, 1.8], [1.6, 1.6, 1.7]];
  let ledSeed = 0;
  for (const b of d.buildings) {
    if (b.lm && d.landmarks[b.lm] && d.landmarks[b.lm].model) continue;
    const p = ordered(b.p);
    let cx = 0, cz = 0; for (let i = 0; i < p.length; i += 2) { cx += p[i]; cz += p[i + 1]; } cx /= p.length / 2; cz /= p.length / 2;
    if (models.some(m => Math.hypot(cx - m.x, cz - m.z) < m.r)) continue;
    const y0 = b.m || 0, y1 = b.h, style = chooseStyle(b, cx, cz, W, cfg);
    if (y0 < 3) addPoly(W, Float32Array.from(p)).h = y1;
    const chunk = Math.floor((cx - b0[0]) / CHUNK) + ',' + Math.floor((cz - b0[2]) / CHUNK);
    const uOff = hash1(Math.round(cx * 3 + cz)) * 200;
    if (ledSet.has(b)) {
      const B = bucket(); addWalls(B, p, y0, y1, uOff); addRoof(B, p, y1);
      const m = toMesh(B, facadeMaterial('glass', C.tex.glass, true, ++ledSeed * 0.37)); W.group.add(m);
    } else {
      addWalls(get(buckets, chunk + '|' + style), p, y0, y1, uOff);
      addRoof(get(buckets, chunk + '|roof'), p, y1);
    }
    if (y1 >= 120 && !b.lm) { // crown light
      const c = CROWN[(hash1(Math.round(cx + cz * 3)) * CROWN.length) | 0];
      for (let i = 0; i < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], j = (i + 2) % p.length, bx = p[j], bz = p[j + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.5) continue;
        const nx = -dz / L * 0.3, nz = dx / L * 0.3, v = crown.pos.length / 3;
        crown.pos.push(ax + nx, y1 - 1, az + nz, bx + nx, y1 - 1, bz + nz, bx + nx, y1 + 0.2, bz + nz, ax + nx, y1 + 0.2, az + nz);
        for (let k = 0; k < 4; k++) crown.col.push(c[0], c[1], c[2]);
        crown.idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
        if (hash1(Math.round(cx * 5)) < 0.35) { // vertical corner lines
          const v2 = crown.pos.length / 3, w = 0.35;
          crown.pos.push(ax + nx - dx / L * w, y1 * 0.12, az + nz - dz / L * w, ax + nx + dx / L * w, y1 * 0.12, az + nz + dz / L * w, ax + nx + dx / L * w, y1, az + nz + dz / L * w, ax + nx - dx / L * w, y1, az + nz - dz / L * w);
          for (let k = 0; k < 4; k++) crown.col.push(c[0] * 0.6, c[1] * 0.6, c[2] * 0.6);
          crown.idx.push(v2, v2 + 1, v2 + 2, v2, v2 + 2, v2 + 3);
        }
      }
    }
    if (y1 >= 100) blinks.push([cx, y1 + 3, cz]);
    if (q.details && y1 > 12 && y1 < 120 && Math.abs(signedArea(p)) > 160) {
      const D = get(details, chunk), n = 1 + (hash1(Math.round(cx * 11 + cz)) * 3 | 0);
      for (let k = 0; k < n; k++) {
        const ox = cx + (hash1(k * 31 + Math.round(cx)) - 0.5) * 12, oz = cz + (hash1(k * 17 + Math.round(cz)) - 0.5) * 12;
        if (!pointInPoly(p, ox, oz)) continue;
        const s = 1.5 + hash1(k + Math.round(ox * 3)) * 3;
        addBox(D, ox, y1, oz, s, 1 + hash1(k * 7 + Math.round(oz)) * 2.2, s * (0.6 + hash1(k) * 0.8));
      }
    }
  }
  for (const [key, B] of buckets) {
    const style = key.split('|')[1];
    W.group.add(toMesh(B, style === 'roof' ? C.roof : C.mats[style]));
  }
  for (const [key, B] of details) {
    const m = toMesh(B, C.detail); m.castShadow = false; m.layers.set(1); W.group.add(m);
    const s = m.geometry.boundingSphere; W.detailChunks.push({ mesh: m, x: s.center.x, z: s.center.z });
  }
  if (crown.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(crown.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(crown.col, 3));
    g.setIndex(crown.idx);
    W.group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }
  if (blinks.length) {
    const m = new THREE.InstancedMesh(new THREE.SphereGeometry(1.3, 8, 6), blinkMat, blinks.length), o = new THREE.Object3D();
    blinks.forEach((p, i) => { o.position.set(p[0], p[1], p[2]); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    W.group.add(m);
  }
  // named towers become landmark toasts
  for (const b of d.buildings) {
    if (b.n == null || b.h < 150 || (b.lm && d.landmarks[b.lm])) continue;
    const [cn, en] = d.names[b.n]; if (!cn && !en) continue;
    let cx = 0, cz = 0; for (let i = 0; i < b.p.length; i += 2) { cx += b.p[i]; cz += b.p[i + 1]; } cx /= b.p.length / 2; cz /= b.p.length / 2;
    W.landmarks.push({ x: cx, z: cz, r: Math.max(90, b.h * 0.4), cn: cn || en, en: (en || '') + (en ? ' · ' : '') + Math.round(b.h) + ' m' });
  }
}

export function updateBuildings() {
  timeU.value = G.time;
  blinkMat.color.setRGB(...((G.time % 1.6) < 0.22 ? [3, 0.15, 0.15] : [0.15, 0.01, 0.01]));
  const cx = G.camera.position.x, cz = G.camera.position.z;
  for (const c of G.world.detailChunks) c.mesh.visible = Math.hypot(c.x - cx, c.z - cz) < 900;
}
