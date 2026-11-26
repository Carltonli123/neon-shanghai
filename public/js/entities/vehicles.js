// Cars: procedural models, traffic that follows real OSM streets, player driving, police pursuit.
import * as THREE from 'three';
import { G, clamp, wrapAng } from '../state.js';
import { blockedStatic } from '../world/world.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeBeamTexture } from '../engine/textures.js';
import { addPed } from './human.js';
import { addHeat, starsOf } from '../game/wanted.js';
import { track } from '../game/analytics.js';

const CL = 4.6, CW = 1.84;
let geoCache = null, beamTex = null;

function carGeometries() {
  if (geoCache) return geoCache;
  const body = new THREE.Shape();
  body.moveTo(2.3, 0.3); body.lineTo(1.88, 0.3);
  body.absarc(1.42, 0.36, 0.46, 0, Math.PI, false); body.lineTo(0.96, 0.3); body.lineTo(-0.96, 0.3);
  body.absarc(-1.42, 0.36, 0.46, 0, Math.PI, false); body.lineTo(-1.88, 0.3); body.lineTo(-2.3, 0.32);
  body.lineTo(-2.34, 0.7); body.quadraticCurveTo(-2.33, 0.98, -2.05, 1.0); body.lineTo(1.1, 1.02);
  body.lineTo(2.12, 0.86); body.quadraticCurveTo(2.35, 0.82, 2.34, 0.6); body.lineTo(2.3, 0.3);
  const ext = (shape, depth, bevel) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12 });
    g.translate(0, 0, -depth / 2); g.rotateY(-Math.PI / 2); return g;
  };
  const cabin = new THREE.Shape(); cabin.moveTo(-1.55, 1.0); cabin.lineTo(-0.95, 1.4); cabin.lineTo(0.35, 1.42); cabin.lineTo(1.12, 1.0); cabin.lineTo(-1.55, 1.0);
  const roof = new THREE.Shape(); roof.moveTo(-1.0, 1.39); roof.lineTo(0.38, 1.41); roof.lineTo(0.36, 1.47); roof.lineTo(-0.98, 1.45); roof.lineTo(-1.0, 1.39);
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 22); wheel.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.23, 0.23, 0.27, 14); rim.rotateZ(Math.PI / 2);
  const flat = gs => mergeGeometries(gs.map(x => { x = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); return x; }));
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  geoCache = {
    body: flat([ext(body, CW - 0.12, 0.06), box(0.16, 0.1, 0.08, -0.98, 1.08, 0.95), box(0.16, 0.1, 0.08, 0.98, 1.08, 0.95)]),
    cabin: ext(cabin, CW - 0.36, 0.04), roof: ext(roof, CW - 0.28, 0.03),
    head: flat([box(0.42, 0.12, 0.08, -0.62, 0.74, 2.3), box(0.42, 0.12, 0.08, 0.62, 0.74, 2.3), box(1.1, 0.04, 0.05, 0, 0.86, 2.29)]),
    tail: flat([box(0.5, 0.11, 0.06, -0.6, 0.86, -2.36), box(0.5, 0.11, 0.06, 0.6, 0.86, -2.36)]),
    wheel: mergeGeometries([wheel.toNonIndexed(), rim.toNonIndexed()], true), wheelPlain: wheel
  };
  return geoCache;
}
function textTexture(lines, bg, fg, w = 256, h = 64) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${h * 0.55}px "Chakra Petch","Noto Sans SC",sans-serif`; g.fillText(lines, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TAXI_COLORS = { teal: 0x2fb3b8, gold: 0xd9a21a, green: 0x3c9a4a, white: 0xe8e8e8 };

export function makeCar(opts = {}) {
  const q = G.q, gm = carGeometries(), g = new THREE.Group();
  const color = opts.police ? 0xf0f2f6 : opts.taxi ? TAXI_COLORS[opts.taxi] : opts.color;
  const paint = q.clearcoat
    ? new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 })
    : new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.35, envMapIntensity: 1.1 });
  if (opts.hero) { paint.emissive = new THREE.Color(color).multiplyScalar(0.08); }
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a0e16, metalness: 0.9, roughness: 0.04, envMapIntensity: 1.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc6, metalness: 1, roughness: 0.25 });
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  add(gm.body, paint); add(gm.cabin, glass);
  add(gm.roof, opts.taxi === 'white' ? new THREE.MeshStandardMaterial({ color: 0x1a8a5a, roughness: 0.4 }) : paint);
  add(new THREE.BoxGeometry(1.2, 0.18, 0.08), dark, 0, 0.58, 2.33);
  const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 2.7) });
  const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.05, 0.08) });
  add(gm.head, head); add(gm.tail, tail);
  const wheels = [], front = [];
  for (const [x, z] of [[-0.82, 1.42], [0.82, 1.42], [-0.82, -1.42], [0.82, -1.42]]) {
    const piv = new THREE.Group(); piv.position.set(x, 0.36, z); g.add(piv);
    const w = q.key === 'low' ? new THREE.Mesh(gm.wheelPlain, dark) : new THREE.Mesh(gm.wheel, [dark, metal]); w.castShadow = true; w.layers.set(1); piv.add(w);
    wheels.push(w); if (z > 0) front.push(piv);
  }
  beamTex = beamTex || makeBeamTexture();
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(10, 30), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.rotation.x = -Math.PI / 2; beam.rotation.z = Math.PI; beam.position.set(0, 0.06, 17); beam.visible = false; beam.layers.set(1); g.add(beam);
  if (opts.hero) {
    const under = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5.6), new THREE.MeshBasicMaterial({ color: 0xff3d8b, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    under.rotation.x = -Math.PI / 2; under.position.y = 0.06; g.add(under);
  }
  if (opts.taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.3), [dark, dark, new THREE.MeshBasicMaterial({ color: 0x333333 }), dark,
      new THREE.MeshBasicMaterial({ map: textTexture('TAXI 出租', '#fff6c8', '#1a1a1a'), color: new THREE.Color(1.6, 1.6, 1.4) }), new THREE.MeshBasicMaterial({ map: textTexture('TAXI 出租', '#fff6c8', '#1a1a1a'), color: new THREE.Color(1.6, 1.6, 1.4) })]);
    sign.position.set(0, 1.58, -0.3); sign.rotation.y = Math.PI / 2; g.add(sign);
  }
  let bar = null;
  if (opts.police) {
    add(new THREE.BoxGeometry(CW + 0.02, 0.14, 4.0), new THREE.MeshStandardMaterial({ color: 0x1f4fd8, roughness: 0.4 }), 0, 0.66, 0);
    const decal = new THREE.MeshBasicMaterial({ map: textTexture('POLICE 公安', 'rgba(0,0,0,0)', '#1f4fd8', 512, 96), transparent: true });
    for (const sx of [-1, 1]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.34), decal); d.position.set(sx * 0.95, 0.86, 0); d.rotation.y = sx * Math.PI / 2; g.add(d); }
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.3) }), blue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.5, 4) });
    add(new THREE.BoxGeometry(0.55, 0.14, 0.3), red, -0.32, 1.55, -0.3); add(new THREE.BoxGeometry(0.55, 0.14, 0.3), blue, 0.32, 1.55, -0.3);
    bar = { red, blue, light: null };
    if (q.lights) { const pl = new THREE.PointLight(0xff2040, 0, 22, 1.5); pl.position.set(0, 2.2, 0); g.add(pl); bar.light = pl; }
  }
  g.userData = { beam, wheels, front, tail, bar };
  return g;
}

/* ---------- paths ---------- */
function makePath(pts, off, pingpong) {
  const loop = pingpong ? pts.concat(pts.slice(1, -1).reverse()) : pts, n = loop.length, closed = pingpong, out = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? loop[(i - 1 + n) % n] : loop[Math.max(0, i - 1)], next = closed ? loop[(i + 1) % n] : loop[Math.min(n - 1, i + 1)], cur = loop[i];
    const a = i === 0 && !closed ? cur : prev, b = i === n - 1 && !closed ? cur : next;
    let d1x = cur[0] - a[0], d1z = cur[1] - a[1], d2x = b[0] - cur[0], d2z = b[1] - cur[1];
    const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
    if (l1 < 1e-6) { d1x = d2x; d1z = d2z; } else { d1x /= l1; d1z /= l1; }
    if (l2 < 1e-6) { d2x = d1x; d2z = d1z; } else { d2x /= l2; d2z /= l2; }
    let rx = -d1z - d2z, rz = d1x + d2x; const rl = Math.hypot(rx, rz);
    if (rl < 0.2) { out.push([cur[0], cur[1]]); continue; }
    rx /= rl; rz /= rl; const mit = 1 / Math.max(0.5, rx * -d1z + rz * d1x);
    out.push([cur[0] + rx * off * mit, cur[1] + rz * off * mit]);
  }
  const segs = []; let L = 0;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) { const a = out[i], b = out[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.01) continue; segs.push({ a, b, len, s0: L }); L += len; }
  return { segs, len: L, closed, start: out[0], end: out[n - 1] };
}
function samplePath(p, s) {
  if (p.closed) s = ((s % p.len) + p.len) % p.len; else s = clamp(s, 0, p.len - 0.001);
  let lo = 0, hi = p.segs.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (p.segs[mid].s0 <= s) lo = mid; else hi = mid - 1; }
  const sg = p.segs[lo], t = (s - sg.s0) / sg.len, fx = (sg.b[0] - sg.a[0]) / sg.len, fz = (sg.b[1] - sg.a[1]) / sg.len;
  return { x: sg.a[0] + (sg.b[0] - sg.a[0]) * t, z: sg.a[1] + (sg.b[1] - sg.a[1]) * t, fx, fz };
}
const pairs = p => { const o = []; for (let i = 0; i < p.length; i += 2) o.push([p[i], p[i + 1]]); return o; };
const polyLen = pts => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };

export function buildTraffic(W) {
  const roads = W.data.roads.filter(r => !r.e && 'PST'.includes(r.k)).map(r => ({ r, pts: pairs(r.p) }));
  roads.forEach(o => { o.len = polyLen(o.pts); });
  const nk = (pt) => Math.round(pt[0] / 2) + ',' + Math.round(pt[1] / 2), ends = new Map();
  for (const o of roads) for (const e of [0, 1]) { const k = nk(e ? o.pts[o.pts.length - 1] : o.pts[0]); if (!ends.has(k)) ends.set(k, []); ends.get(k).push({ o, e }); }
  const used = new Set(), chains = [];
  for (const o of roads.slice().sort((a, b) => b.len - a.len)) {
    if (used.has(o)) continue; used.add(o);
    let pts = o.pts.slice(); const ow = !!o.r.o, name = o.r.n; let len = o.len;
    for (let guard = 0; guard < 40 && len < 2600; guard++) {
      const c = (ends.get(nk(pts[pts.length - 1])) || []).find(c => !used.has(c.o) && c.o.r.n === name && !!c.o.r.o === ow && (!ow || c.e === 0));
      if (!c) break; used.add(c.o); const add = c.e === 0 ? c.o.pts : c.o.pts.slice().reverse(); pts = pts.concat(add.slice(1)); len += c.o.len;
    }
    for (let guard = 0; guard < 40 && len < 2600; guard++) {
      const c = (ends.get(nk(pts[0])) || []).find(c => !used.has(c.o) && c.o.r.n === name && !!c.o.r.o === ow && (!ow || c.e === 1));
      if (!c) break; used.add(c.o); const add = c.e === 1 ? c.o.pts : c.o.pts.slice().reverse(); pts = add.slice(0, -1).concat(pts); len += c.o.len;
    }
    if (len > 350) chains.push({ pts, ow, w: o.r.w, lanes: o.r.l, len });
  }
  chains.sort((a, b) => b.len - a.len); chains.length = Math.min(chains.length, 16);
  const budget = { low: 22, medium: 32, high: 42, ultra: 50 }[G.q.key], total = chains.reduce((s, c) => s + c.len, 0) || 1;
  const kinds = [['teal', 0.3], ['gold', 0.1], ['green', 0.08], ['white', 0.07], [null, 0.45]];
  const colors = [0x1a1a1f, 0xe6e6e6, 0x8a8f99, 0x2a3f6a, 0x6a1a1a, 0x3a3a3a];
  for (const c of chains) {
    const lanes = c.lanes || Math.max(1, Math.round((c.w - 1) / 3.4)), lw = (c.ow ? c.w : c.w / 2) / (c.ow ? lanes : Math.max(1, Math.round(lanes / 2)));
    const off = c.ow ? Math.max(0, c.w / 2 - lw * 0.5) * 0.8 : Math.max(1.8, c.w / 4);
    const path = makePath(c.pts, off, !c.ow), n = Math.max(2, Math.round(budget * c.len / total)), cars = [];
    for (let i = 0; i < n; i++) {
      let r = Math.random(), taxi = null; for (const [k, p] of kinds) { r -= p; if (r <= 0) { taxi = k; break; } }
      const mesh = makeCar({ taxi, color: colors[(Math.random() * colors.length) | 0] }); W.group.add(mesh);
      const vmax = 11 + Math.random() * 5;
      cars.push({ kind: 'traffic', taxi: !!taxi, path, s: path.len * i / n, v: vmax, vmax, mesh, x: 0, z: 0, h: 0, speed: 0 });
    }
    cars.forEach((a, i) => { a.leader = cars[(i + 1) % n]; const p = samplePath(path, a.s); a.x = p.x; a.z = p.z; a.h = Math.atan2(p.fx, p.fz); });
    W.traffic.push(...cars);
  }
}
function removeTraffic(W, v) {
  const i = W.traffic.indexOf(v); if (i < 0) return; W.traffic.splice(i, 1);
  for (const a of W.traffic) if (a.leader === v) a.leader = (v.leader === v || v.leader === a) ? a : v.leader;
}

/* ---------- collision ---------- */
function vehicles(self) { const W = G.world, out = []; for (const a of W.traffic) if (a !== self) out.push(a); for (const a of W.parked) if (a !== self) out.push(a); for (const a of W.police) if (a !== self) out.push(a); if (G.P.veh && G.P.veh !== self) out.push(G.P.veh); return out; }
export function blocked(x, z, r, self) {
  if (blockedStatic(G.world, x, z, r)) return true;
  for (const a of vehicles(self)) { const dx = x - a.x, dz = z - a.z, rr = r + 2.1; if (dx * dx + dz * dz < rr * rr) return true; }
  return false;
}

/* ---------- updates ---------- */
export function updateTraffic(dt) {
  const W = G.world, P = G.P, obs = [P.mode === 'car' ? P.veh : P, ...W.parked, ...W.police];
  for (const a of W.traffic) {
    const p = samplePath(a.path, a.s); a.x = p.x; a.z = p.z;
    let gap = a.leader.s - a.s; if (gap < 0) gap += a.path.len;
    let stop = a.leader !== a && gap < 11;
    if (!stop) for (const o of obs) { const dx = o.x - a.x, dz = o.z - a.z, ahead = dx * p.fx + dz * p.fz; if (ahead > 0 && ahead < 14 && Math.abs(dx * -p.fz + dz * p.fx) < 3.4) { stop = true; break; } }
    a.v = stop ? Math.max(0, a.v - 26 * dt) : Math.min(a.vmax, a.v + 5 * dt);
    a.s += a.v * dt;
    if (a.path.closed) a.s %= a.path.len;
    else if (a.s >= a.path.len) {
      const far = q => Math.hypot(q[0] - P.x, q[1] - P.z) > 110;
      if (far(a.path.start) && far(a.path.end)) a.s -= a.path.len; else { a.s = a.path.len - 0.01; a.v = 0; }
    }
    const nh = Math.atan2(p.fx, p.fz); a.h += wrapAng(nh - a.h) * Math.min(1, dt * 8);
    a.mesh.position.set(a.x, 0, a.z); a.mesh.rotation.y = a.h;
    const ud = a.mesh.userData; for (const w of ud.wheels) w.rotation.x += a.v * dt / 0.36;
  }
}

let spot = null;
function ensureSpot() {
  if (spot || !G.q.spot) return spot;
  spot = new THREE.SpotLight(0xfff0d8, 320, 80, 0.48, 0.7, 1.7);
  spot.castShadow = G.q.shadows > 0; spot.shadow.mapSize.set(1024, 1024); spot.shadow.camera.near = 1; spot.shadow.camera.far = 90; spot.shadow.bias = -0.0005;
  spot.target = new THREE.Object3D();
  return spot;
}
export function resetSpot() { if (spot && spot.parent) spot.parent.remove(spot); if (spot) spot.dispose(); spot = null; }
function attachSpot(v) { const s = ensureSpot(); if (!s) return; v.mesh.add(s); v.mesh.add(s.target); s.position.set(0, 0.9, 2.2); s.target.position.set(0, 0, 25); }

export function updateDriving(dt, knockDown) {
  const v = G.P.veh, k = G.keys;
  const thr = k.up - k.down, steer = k.left - k.right;
  if (thr > 0) v.speed += (v.speed < 0 ? 40 : 17) * dt; else if (thr < 0) v.speed -= (v.speed > 0 ? 34 : 11) * dt; else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 5 * dt);
  if (k.brake) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 40 * dt);
  v.speed = clamp(v.speed, -14, 52);
  const grip = Math.min(1, Math.abs(v.speed) / 7) * (v.speed >= 0 ? 1 : -1);
  v.h += steer * (k.brake ? 2.6 : 1.8) * grip * dt * (1 - Math.min(0.45, Math.abs(v.speed) / 120));
  const nx = v.x + Math.sin(v.h) * v.speed * dt, nz = v.z + Math.cos(v.h) * v.speed * dt;
  if (!blocked(nx, nz, 2, v)) { v.x = nx; v.z = nz; }
  else if (!blocked(nx, v.z, 2, v)) { v.x = nx; v.speed *= 0.96; }
  else if (!blocked(v.x, nz, 2, v)) { v.z = nz; v.speed *= 0.96; }
  else { if (Math.abs(v.speed) > 12) track('crash', { kmh: Math.round(Math.abs(v.speed) * 3.6) }); v.speed *= -0.3; G.shake = 0.35; }
  const W = G.world;
  if (Math.abs(v.speed) > 4 && W.peds) for (const p of W.peds.list) { if (p.state === 'down') continue; const dx = p.x - v.x, dz = p.z - v.z; if (dx * dx + dz * dz < 6.5) { knockDown(p, Math.sin(v.h) * v.speed * 0.5, Math.cos(v.h) * v.speed * 0.5, 'vehicle', Math.abs(v.speed) > 9); v.speed *= 0.88; G.shake = 0.2; } }
  v.mesh.position.set(v.x, 0, v.z); v.mesh.rotation.y = v.h;
  v.mesh.rotation.z = -steer * Math.min(0.05, Math.abs(v.speed) / 500); v.mesh.rotation.x = clamp(-thr * 0.012 + (k.brake ? 0.02 : 0), -0.02, 0.03);
  const ud = v.mesh.userData; for (const w of ud.wheels) w.rotation.x += v.speed * dt / 0.36; for (const f of ud.front) f.rotation.y = steer * 0.45;
  ud.tail.color.setRGB(k.brake || thr < 0 ? 5 : 1.4, k.brake || thr < 0 ? 0.25 : 0.05, k.brake || thr < 0 ? 0.3 : 0.08);
  G.P.x = v.x; G.P.z = v.z; G.P.h = v.h;
}

/* ---------- enter / exit / carjack ---------- */
export function nearestVehicle(r) { const W = G.world; let best = null, bd = r; for (const v of [...W.parked, ...W.traffic, ...W.police]) { const d = Math.hypot(v.x - G.P.x, v.z - G.P.z); if (d < bd) { bd = d; best = v; } } return best; }
export function actionLabel() {
  const P = G.P; if (P.busted > 0) return '';
  if (P.mode === 'car') return Math.abs(P.veh.speed) < 4 ? 'Get out' : '';
  const v = nearestVehicle(4.5); if (!v) return '';
  return v.kind === 'traffic' ? (v.taxi ? 'Carjack taxi' : 'Carjack car') : v.kind === 'police' ? 'Steal police car' : 'Get in';
}
export function tryEnterExit(showPrompt, alertPeds) {
  const P = G.P, W = G.world; if (P.busted > 0 || G.mode === 'photo') return;
  if (P.mode === 'car') {
    const v = P.veh; if (Math.abs(v.speed) >= 4) { showPrompt('Slow down to get out', 1.2); return; }
    const fx = Math.sin(v.h), fz = Math.cos(v.h), lx = fz, lz = -fx; let ok = false;
    for (const side of [1, -1]) { const x = v.x + lx * side * 2.4, z = v.z + lz * side * 2.4; if (!blockedStatic(W, x, z, 0.45)) { P.x = x; P.z = z; ok = true; break; } }
    if (!ok) { showPrompt('No room to get out', 1.2); return; }
    v.speed = 0; v.kind = 'parked'; v.mesh.userData.beam.visible = false; v.mesh.userData.tail.color.setRGB(1.4, 0.05, 0.08);
    if (spot && spot.parent) { spot.parent.remove(spot.target); spot.parent.remove(spot); }
    W.parked.push(v); P.veh = null; P.mode = 'foot'; P.h = v.h; G.hero.root.visible = true; track('exit_car'); return;
  }
  const v = nearestVehicle(4.5); if (!v) return;
  if (v.kind === 'traffic') {
    removeTraffic(W, v);
    const fx = Math.sin(v.h), fz = Math.cos(v.h), d = addPed(W, v.x + fz * 2.6, v.z - fx * 2.6);
    if (d) { d.state = 'flee'; d.fleeT = 6; d.thx = P.x; d.thz = P.z; }
    addHeat(35); showPrompt(v.taxi ? 'Taxi carjacked' : 'Car carjacked', 1.4); track('carjack', { taxi: !!v.taxi });
  } else if (v.kind === 'police') { W.police.splice(W.police.indexOf(v), 1); addHeat(160); track('steal_police'); }
  else W.parked.splice(W.parked.indexOf(v), 1);
  v.kind = 'driven'; v.speed = 0; P.veh = v; P.mode = 'car'; v.mesh.userData.beam.visible = !G.q.spot; G.hero.root.visible = false;
  attachSpot(v); alertPeds(v.x, v.z, 25);
}

/* ---------- police ---------- */
let spawnT = 0;
function spawnPolice() {
  const W = G.world, P = G.P, tx = P.x, tz = P.z, roads = W.data.roads.filter(r => !r.e && 'PSRL'.includes(r.k));
  for (let k = 0; k < 50; k++) {
    const r = roads[(Math.random() * roads.length) | 0], i = ((Math.random() * (r.p.length / 2 - 1)) | 0) * 2, t = Math.random();
    const x = r.p[i] + (r.p[i + 2] - r.p[i]) * t, z = r.p[i + 1] + (r.p[i + 3] - r.p[i + 1]) * t, d = Math.hypot(x - tx, z - tz);
    if (d < 200 || d > 480 || blocked(x, z, 2.5, null)) continue;
    const mesh = makeCar({ police: true }); mesh.position.set(x, 0, z); W.group.add(mesh);
    W.police.push({ kind: 'police', mesh, x, z, h: Math.atan2(tx - x, tz - z), speed: 0, stuck: 0, rev: 0, holdT: 0 }); track('police_spawn'); return;
  }
}
export function clearPolice() { const W = G.world; for (const c of W.police) W.group.remove(c.mesh); W.police = []; }
export function updatePolice(dt, bust) {
  const W = G.world, P = G.P, s = starsOf(P.heat), want = s >= 2 ? Math.min(4, s - 1) : 0;
  spawnT -= dt; if (W.police.length < want && spawnT <= 0) { spawnPolice(); spawnT = 4; }
  if (s === 0 && W.police.length) clearPolice();
  let close = false;
  for (const c of W.police) {
    const dx = P.x - c.x, dz = P.z - c.z, dist = Math.hypot(dx, dz); if (dist < 70) close = true;
    const bar = c.mesh.userData.bar, on = (G.time * 6 | 0) % 2;
    bar.red.color.setRGB(on ? 4 : 0.2, on ? 0.2 : 0.02, on ? 0.3 : 0.03); bar.blue.color.setRGB(on ? 0.02 : 0.2, on ? 0.05 : 0.5, on ? 0.3 : 4);
    if (bar.light) { bar.light.color.set(on ? 0xff2040 : 0x2050ff); bar.light.intensity = 120; }
    if (c.rev > 0) { c.rev -= dt; c.speed = -7; c.h += 1.2 * dt; }
    else { const diff = wrapAng(Math.atan2(dx, dz) - c.h); c.h += clamp(diff * 2, -1, 1) * 2.2 * dt * Math.min(1, Math.abs(c.speed) / 5 + 0.2); const target = dist < 10 ? 3 : (Math.abs(diff) > 1.2 ? 11 : 30); c.speed += clamp(target - c.speed, -25 * dt, 16 * dt); }
    const nx = c.x + Math.sin(c.h) * c.speed * dt, nz = c.z + Math.cos(c.h) * c.speed * dt;
    if (!blocked(nx, nz, 2, c)) { c.x = nx; c.z = nz; c.stuck = Math.max(0, c.stuck - dt); }
    else if (!blocked(nx, c.z, 2, c)) c.x = nx; else if (!blocked(c.x, nz, 2, c)) c.z = nz;
    else { c.stuck += dt; if (c.rev <= 0 && c.stuck > 0.6) { c.rev = 0.9; c.stuck += 0.5; } c.speed *= 0.5; }
    if (c.stuck > 8) { W.group.remove(c.mesh); c.dead = true; }
    c.mesh.position.set(c.x, 0, c.z); c.mesh.rotation.y = c.h;
    for (const w of c.mesh.userData.wheels) w.rotation.x += c.speed * dt / 0.36;
    if (dist < 5.5 && (P.mode === 'foot' || Math.abs(P.veh.speed) < 2)) { c.holdT += dt; if (P.mode === 'foot' || c.holdT > 1.8) bust(); } else c.holdT = 0;
  }
  W.police = W.police.filter(c => !c.dead);
  if (close) P.calm = 0;
}

export function spawnHeroCar(W, x, z, h) {
  const mesh = makeCar({ hero: true, color: 0xff3d8b }); mesh.position.set(x, 0, z); mesh.rotation.y = h; W.group.add(mesh);
  const v = { kind: 'parked', mesh, x, z, h, speed: 0 }; W.parked.push(v); W.heroCar = v; return v;
}
