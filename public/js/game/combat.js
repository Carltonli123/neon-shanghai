// Weapons, auto-aim, hits and knockdowns. Stylized: no blood, people fall and get up later.
import * as THREE from 'three';
import { G, wrapAng } from '../state.js';
import { losClear, insideBuilding, buildingHeightAt } from '../world/world.js';
import { animateHero } from '../entities/human.js';
import { addHeat } from './wanted.js';
import { track } from './analytics.js';
import { sfx } from './audio.js';

export const WEAPONS = [
  { name: 'Fists', range: 2.4, cone: 0.9, dmg: 40, rate: 0.45, gun: false },
  { name: 'Pistol', range: 70, cone: 0.32, dmg: 100, rate: 0.3, gun: true, auto: false },
  { name: 'SMG', range: 50, cone: 0.38, dmg: 40, rate: 0.09, gun: true, auto: true }
];
const tracers = [];
let flash = null, flashT = 0;
const tmp = new THREE.Vector3();

/* ---------- impact sparks (one pooled point cloud) ---------- */
const IMP = 300, impVel = new Float32Array(IMP * 3), impLife = new Float32Array(IMP);
let imp = null, impI = 0;
function spawnImpact(p, color, n, speed) {
  const pos = imp.geometry.attributes.position, col = imp.geometry.attributes.color;
  for (let k = 0; k < n; k++) {
    const i = impI++ % IMP;
    pos.setXYZ(i, p.x, p.y, p.z); col.setXYZ(i, color[0], color[1], color[2]);
    impVel[i * 3] = (Math.random() - 0.5) * speed; impVel[i * 3 + 1] = Math.random() * speed * 0.8 + 1; impVel[i * 3 + 2] = (Math.random() - 0.5) * speed;
    impLife[i] = 0.25 + Math.random() * 0.3;
  }
  pos.needsUpdate = col.needsUpdate = true;
}

export function initCombat() {
  flash = new THREE.PointLight(0xffc870, 0, 18, 1.6); G.scene.add(flash);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(IMP * 3).fill(-1000), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(IMP * 3), 3));
  imp = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  imp.frustumCulled = false; G.scene.add(imp);
}
export function alertPeds(x, z, r) {
  const W = G.world; if (!W.peds) return;
  for (const p of W.peds.list) { if (p.state === 'down') continue; if (Math.hypot(p.x - x, p.z - z) < r) { p.state = 'flee'; p.fleeT = 6 + Math.random() * 3; p.thx = x; p.thz = z; } }
}
// lethal: the person dies and stays down. Otherwise (fists, slow car bumps) they are knocked out and get up.
export function knockDown(p, vx, vz, src, lethal = true) {
  if (p.state === 'down') { if (lethal && !p.dead) { p.dead = true; track('npc_killed', { src }); } return; }
  p.state = 'down'; p.dead = lethal; p.t = 0; p.vx = vx; p.vz = vz;
  if (vx || vz) p.h = Math.atan2(-vx, -vz); // face the hit so they fall away from it
  addHeat(lethal ? 70 : 30); alertPeds(p.x, p.z, 40);
  sfx(lethal ? 'body' : 'thud', p.x, p.z);
  track(lethal ? 'npc_killed' : 'npc_down', { src });
}
function hitPed(p, dmg, lethal = true) {
  const P = G.P; p.hp -= dmg; p.flash = 0.12;
  const dx = p.x - P.x, dz = p.z - P.z, d = Math.max(0.1, Math.hypot(dx, dz));
  if (p.hp <= 0) knockDown(p, dx / d * 2.5, dz / d * 2.5, lethal ? 'gun' : 'fists', lethal);
  else { p.state = 'flee'; p.fleeT = 7; p.thx = P.x; p.thz = P.z; p.x += dx / d * 0.3; p.z += dz / d * 0.3; addHeat(35); sfx('thud', p.x, p.z); }
}
function findTarget(w) {
  const P = G.P, W = G.world; let best = null, bs = 1e9; if (!W.peds) return null;
  for (const p of W.peds.list) {
    if (p.state === 'down') continue;
    const dx = p.x - P.x, dz = p.z - P.z, d = Math.hypot(dx, dz); if (d > w.range || d < 0.1) continue;
    const ang = Math.abs(wrapAng(Math.atan2(dx, dz) - P.h)); if (ang > w.cone) continue;
    if (w.gun && !losClear(W, P.x, P.z, p.x, p.z)) continue;
    const sc = d * (1 + ang * 2); if (sc < bs) { bs = sc; best = p; }
  }
  return best;
}
export function fire(w) {
  const P = G.P, H = G.hero, tgt = findTarget(w);
  if (tgt) P.h = Math.atan2(tgt.x - P.x, tgt.z - P.z);
  H.root.position.set(P.x, 0, P.z); H.root.rotation.y = P.h;
  if (w.gun) {
    P.aim = 1.4; animateHero(H, 0, 0, { aim: true, punch: 0, weapon: w.name }); H.root.updateMatrixWorld(true);
    H.muzzle.getWorldPosition(tmp); const from = tmp.clone(); let to;
    if (tgt) { to = new THREE.Vector3(tgt.x, 1.25, tgt.z); hitPed(tgt, w.dmg); }
    else { const fx = Math.sin(P.h), fz = Math.cos(P.h); let d = 2; while (d < w.range && !insideBuilding(G.world, P.x + fx * d, P.z + fz * d)) d += 2; to = new THREE.Vector3(P.x + fx * d, from.y, P.z + fz * d); }
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2.6, 1.6), transparent: true, opacity: 0.9 }));
    G.scene.add(line); tracers.push({ line, t: 0.07 });
    flash.position.copy(from); flash.intensity = 300; flashT = 0.05; sfx(w.name === 'SMG' ? 'smg' : 'pistol');
    alertPeds(P.x, P.z, 45);
    if (G.world.peds && G.world.peds.list.some(p => p.state !== 'down' && Math.hypot(p.x - P.x, p.z - P.z) < 30)) addHeat(4);
    track('shot', { weapon: w.name, hit: !!tgt });
  } else { P.punch = 0.18; sfx('swing'); if (tgt) { sfx('punch', tgt.x, tgt.z); hitPed(tgt, w.dmg, false); } }
}
// Shoots along a ray (camera through the crosshair). Tests people, cars, buildings and the ground,
// then draws the tracer from the gun muzzle to the hit point.
const rd = new THREE.Vector3();
export function fireRay(w, ro, dir, tMin, aiming, pitch) {
  const P = G.P, W = G.world, H = G.hero, range = w.range + 40;
  const sp = w.name === 'SMG' ? (aiming ? 0.01 : 0.028) : (aiming ? 0.002 : 0.012);
  rd.copy(dir); rd.x += (Math.random() - 0.5) * sp * 2; rd.y += (Math.random() - 0.5) * sp * 2; rd.z += (Math.random() - 0.5) * sp * 2; rd.normalize();
  let hitT = range, hit = { kind: 'none' };
  const h2 = rd.x * rd.x + rd.z * rd.z;
  const testUpright = (x, z, r, top, bottom) => {
    if (h2 < 1e-8) return -1;
    const t = ((x - ro.x) * rd.x + (z - ro.z) * rd.z) / h2;
    if (t < tMin || t > hitT) return -1;
    const cx = ro.x + rd.x * t - x, cz = ro.z + rd.z * t - z; if (cx * cx + cz * cz > r * r) return -1;
    const y = ro.y + rd.y * t; return y >= bottom && y <= top ? t : -1;
  };
  if (W.peds) for (const p of W.peds.list) {
    const t = testUpright(p.x, p.z, p.state === 'down' ? 0.7 : 0.42, p.state === 'down' ? 0.5 : 1.85, 0);
    if (t > 0) { hitT = t; hit = { kind: 'ped', p }; }
  }
  for (const v of [...W.traffic, ...W.parked, ...W.police]) {
    if (v === P.veh) continue;
    const t = testUpright(v.x, v.z, 1.9, 1.6, 0);
    if (t > 0) { hitT = t; hit = { kind: 'car', v }; }
  }
  if (rd.y < -1e-4) { const tg = -ro.y / rd.y; if (tg > tMin && tg < hitT) { hitT = tg; hit = { kind: 'ground' }; } }
  for (let t = tMin; t < hitT; t += 0.7) {
    const x = ro.x + rd.x * t, y = ro.y + rd.y * t, z = ro.z + rd.z * t, bh = buildingHeightAt(W, x, z);
    if (bh > 0 && y < bh) { hitT = t; hit = { kind: 'wall' }; break; }
  }
  const hp = ro.clone().addScaledVector(rd, hitT);
  G.lastShot = { kind: hit.kind, dist: Math.round(hitT * 10) / 10 };
  P.h = Math.atan2(hp.x - P.x, hp.z - P.z); P.aim = 1.4;
  H.root.position.set(P.x, 0, P.z); H.root.rotation.y = P.h;
  animateHero(H, 0, 0, { aim: true, punch: 0, weapon: w.name, pitch }); H.root.updateMatrixWorld(true);
  H.muzzle.getWorldPosition(tmp); const from = tmp.clone();
  const g = new THREE.BufferGeometry().setFromPoints([from, hp]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2.6, 1.6), transparent: true, opacity: 0.9 }));
  G.scene.add(line); tracers.push({ line, t: 0.06 });
  flash.position.copy(from); flash.intensity = 300; flashT = 0.05;
  sfx(w.name === 'SMG' ? 'smg' : 'pistol');
  if (hit.kind === 'ped') { hitPed(hit.p, w.dmg); spawnImpact(hp, [3, 3, 3], 6, 3); }
  else if (hit.kind === 'car') {
    spawnImpact(hp, [4, 2.6, 0.8], 10, 6); sfx('carhit', hp.x, hp.z);
    const v = hit.v;
    if (v.kind === 'traffic') { v.v = 0; v.vmax = Math.max(4, v.vmax * 0.9); }
    if (v.kind === 'police') addHeat(25);
  } else if (hit.kind === 'wall' || hit.kind === 'ground') { spawnImpact(hp, [1.6, 1.5, 1.4], 7, 3); sfx('ric', hp.x, hp.z); }
  alertPeds(hp.x, hp.z, 30); alertPeds(P.x, P.z, 45);
  if (W.peds && W.peds.list.some(p => p.state !== 'down' && Math.hypot(p.x - P.x, p.z - P.z) < 30)) addHeat(4);
  track('shot', { weapon: w.name, hit: hit.kind, aimed: true, zoom: !!aiming, dist: Math.round(hitT) });
  return hit.kind === 'ped' || hit.kind === 'car';
}

export function updateCombat(dt) {
  if (imp) {
    const pos = imp.geometry.attributes.position; let live = false;
    for (let i = 0; i < IMP; i++) {
      if (impLife[i] <= 0) continue;
      impLife[i] -= dt; live = true;
      impVel[i * 3 + 1] -= 14 * dt;
      if (impLife[i] <= 0) pos.setXYZ(i, 0, -1000, 0);
      else pos.setXYZ(i, pos.getX(i) + impVel[i * 3] * dt, Math.max(0.02, pos.getY(i) + impVel[i * 3 + 1] * dt), pos.getZ(i) + impVel[i * 3 + 2] * dt);
    }
    if (live) pos.needsUpdate = true;
  }
  for (let i = tracers.length - 1; i >= 0; i--) { const t = tracers[i]; t.t -= dt; if (t.t <= 0) { G.scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); tracers.splice(i, 1); } }
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) flash.intensity = 0; }
}
