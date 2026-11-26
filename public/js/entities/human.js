// Chen Wei (陈伟), the player character, and the instanced crowd.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, clamp } from '../state.js';
import { blockedStatic } from '../world/world.js';

/* ---------- Chen Wei ---------- */
export function makeHero() {
  const M = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0 }, o));
  const skin = M(0xd9a37e, { roughness: 0.55 }), hair = M(0x0b0b0d, { roughness: 0.35 }), jacket = M(0x1a1d26, { roughness: 0.45, metalness: 0.15 });
  const rib = M(0x111318, { roughness: 0.9 }), lining = M(0xc8102e, { roughness: 0.5 }), shirt = M(0xececec, { roughness: 0.8 });
  const jeans = M(0x2b3d60, { roughness: 0.85 }), shoe = M(0xf2f2f2, { roughness: 0.5 }), sole = M(0xb8b8b8), dark = M(0x101010);
  const cap = (r, len, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
  const mesh = (g, mat, x = 0, y = 0, z = 0, parent) => { const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.2, 14).scale(1, 1, 0.68), jeans, 0, 0, 0, hips);
  mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.04, 14).scale(1, 1, 0.7), dark, 0, 0.09, 0, hips); // belt
  const legs = [];
  for (const sx of [-1, 1]) {
    const thigh = new THREE.Group(); thigh.position.set(sx * 0.095, -0.06, 0); hips.add(thigh);
    const t = cap(0.085, 0.3, jeans); t.position.y = -0.21; t.castShadow = true; thigh.add(t);
    const knee = new THREE.Group(); knee.position.y = -0.42; thigh.add(knee);
    const s = cap(0.07, 0.3, jeans); s.position.y = -0.2; s.castShadow = true; knee.add(s);
    const foot = new THREE.Group(); foot.position.y = -0.43; knee.add(foot);
    mesh(new THREE.BoxGeometry(0.11, 0.08, 0.27), shoe, 0, -0.01, 0.05, foot);
    mesh(new THREE.BoxGeometry(0.115, 0.025, 0.28), sole, 0, -0.055, 0.05, foot);
    legs.push({ thigh, knee });
  }
  const spine = new THREE.Group(); spine.position.y = 0.1; hips.add(spine);
  const torso = mesh(new THREE.CylinderGeometry(0.205, 0.175, 0.5, 18).scale(1, 1, 0.62), jacket, 0, 0.26, 0, spine);
  mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 18).scale(1, 1, 0.64), rib, 0, 0.02, 0, spine); // waistband
  mesh(new THREE.BoxGeometry(0.15, 0.4, 0.02), shirt, 0, 0.26, 0.122, spine);
  for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.03, 0.42, 0.02), lining, sx * 0.09, 0.26, 0.124, spine);
  mesh(new THREE.TorusGeometry(0.085, 0.03, 8, 20).rotateX(Math.PI / 2), rib, 0, 0.52, 0, spine); // collar
  const shoulders = new THREE.Group(); shoulders.position.y = 0.48; spine.add(shoulders);
  mesh(new THREE.SphereGeometry(0.075, 12, 8), jacket, -0.215, 0, 0, shoulders); mesh(new THREE.SphereGeometry(0.075, 12, 8), jacket, 0.215, 0, 0, shoulders);
  const arms = [];
  for (const sx of [-1, 1]) {
    const up = new THREE.Group(); up.position.set(sx * 0.235, 0, 0); shoulders.add(up);
    const u = cap(0.062, 0.2, jacket); u.position.y = -0.14; u.castShadow = true; up.add(u);
    const el = new THREE.Group(); el.position.y = -0.29; up.add(el);
    const f = cap(0.054, 0.19, jacket); f.position.y = -0.13; f.castShadow = true; el.add(f);
    mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.05, 12), rib, 0, -0.26, 0, el);
    const hand = mesh(new THREE.SphereGeometry(0.05, 12, 10).scale(0.85, 1.15, 0.7), skin, 0, -0.32, 0, el);
    arms.push({ up, el, hand });
  }
  const neck = mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.09, 12), skin, 0, 0.57, 0, spine);
  const head = new THREE.Group(); head.position.y = 0.7; spine.add(head);
  mesh(new THREE.SphereGeometry(1, 24, 18).scale(0.105, 0.128, 0.118), skin, 0, 0, 0, head);
  mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.113, 0.11, 0.126), hair, 0, 0.022, -0.004, head);
  mesh(new THREE.BoxGeometry(0.2, 0.03, 0.05), hair, 0, 0.085, 0.095, head).rotation.x = -0.35; // fringe
  for (const sx of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.022, 8, 6).scale(0.6, 1, 0.8), skin, sx * 0.104, -0.005, 0, head); // ears
    mesh(new THREE.SphereGeometry(0.012, 8, 6).scale(1.3, 0.8, 0.5), dark, sx * 0.038, 0.012, 0.108, head); // eyes
    mesh(new THREE.BoxGeometry(0.04, 0.008, 0.01), hair, sx * 0.04, 0.038, 0.11, head).rotation.z = sx * -0.12; // brows
  }
  mesh(new THREE.BoxGeometry(0.018, 0.035, 0.02), skin, 0, -0.012, 0.118, head); // nose
  mesh(new THREE.BoxGeometry(0.035, 0.006, 0.005), M(0x8a4a3a), 0, -0.055, 0.112, head); // mouth
  const gun = new THREE.Group(); arms[1].el.add(gun); gun.position.set(0, -0.36, 0.04);
  mesh(new THREE.BoxGeometry(0.04, 0.16, 0.035), M(0x1a1b1f, { metalness: 0.6, roughness: 0.4 }), 0, -0.04, 0.0, gun);
  mesh(new THREE.BoxGeometry(0.04, 0.05, 0.11), M(0x1a1b1f, { metalness: 0.6, roughness: 0.4 }), 0, -0.13, 0.03, gun);
  const smg = new THREE.Group(); arms[1].el.add(smg); smg.position.set(0, -0.36, 0.05);
  mesh(new THREE.BoxGeometry(0.05, 0.36, 0.07), M(0x202226, { metalness: 0.5, roughness: 0.45 }), 0, -0.1, 0, smg);
  mesh(new THREE.BoxGeometry(0.03, 0.04, 0.16), M(0x202226), 0, 0.02, 0.07, smg);
  gun.visible = smg.visible = false;
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.28, 0); arms[1].el.add(muzzle);
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, hips, spine, legs, arms, head, gun, smg, muzzle, phase: 0, torso, neck };
}

export function animateHero(H, speed, dt, s) {
  const run = clamp((speed - 3.5) / 4, 0, 1), moving = clamp(speed / 2, 0, 1);
  H.phase += dt * (speed * (1.55 - run * 0.35) + 0.0001);
  const ph = H.phase, sw = Math.sin(ph) * (0.55 + run * 0.35) * moving;
  H.legs[0].thigh.rotation.x = -sw; H.legs[1].thigh.rotation.x = sw;
  H.legs[0].knee.rotation.x = Math.max(0, Math.sin(ph - 1.2)) * (0.8 + run * 0.8) * moving + 0.05;
  H.legs[1].knee.rotation.x = Math.max(0, Math.sin(ph + Math.PI - 1.2)) * (0.8 + run * 0.8) * moving + 0.05;
  H.hips.position.y = 0.95 - run * 0.03 + Math.abs(Math.cos(ph)) * 0.035 * moving;
  H.spine.rotation.x = run * 0.22; H.spine.rotation.y = Math.sin(ph) * 0.12 * moving;
  const breathe = 1 + Math.sin(G.time * 2.2) * 0.012 * (1 - moving); H.torso.scale.set(breathe, 1, breathe);
  const armSw = sw * 0.9;
  if (s.aim) {
    const pitch = s.pitch || 0;
    H.arms[1].up.rotation.set(-Math.PI / 2 + 0.05 - pitch, 0, 0.05); H.arms[1].el.rotation.x = 0;
    H.arms[0].up.rotation.set(-1.25 - pitch, 0, -0.55); H.arms[0].el.rotation.x = -0.6;
    H.spine.rotation.y = 0.15; H.head.rotation.x = -pitch * 0.6;
  } else {
    H.head.rotation.x = 0;
    const punch = s.punch > 0 ? s.punch / 0.18 : 0;
    H.arms[0].up.rotation.set(armSw, 0, 0.06); H.arms[0].el.rotation.x = -(0.25 + run * 0.9);
    H.arms[1].up.rotation.set(-armSw * (1 - punch) - Math.PI / 2 * punch, 0, -0.06); H.arms[1].el.rotation.x = -(0.25 + run * 0.9) * (1 - punch);
  }
  H.gun.visible = s.weapon === 'Pistol'; H.smg.visible = s.weapon === 'SMG';
}

/* ---------- crowd ---------- */
// One merged low-poly body; aPart picks the colour (top, pants, shoes, skin, hair) and aLimb
// marks legs and arms so the vertex shader can swing them.
function pedGeometry() {
  const parts = [];
  const add = (g, part, limb) => { const n = g.attributes.position.count; g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1)); g.setAttribute('aLimb', new THREE.Float32BufferAttribute(new Float32Array(n).fill(limb), 1)); parts.push(g); };
  for (const [sx, limb] of [[-0.09, 1], [0.09, 2]]) { add(new THREE.CapsuleGeometry(0.075, 0.68, 3, 8).translate(sx, 0.5, 0), 1, limb); add(new THREE.BoxGeometry(0.11, 0.08, 0.24).translate(sx, 0.04, 0.04), 2, limb); }
  add(new THREE.CylinderGeometry(0.19, 0.16, 0.6, 10).scale(1, 1, 0.62).translate(0, 1.22, 0), 0, 0);
  add(new THREE.CylinderGeometry(0.16, 0.15, 0.14, 10).scale(1, 1, 0.66).translate(0, 0.93, 0), 1, 0);
  for (const [sx, limb] of [[-0.23, 3], [0.23, 4]]) { add(new THREE.CapsuleGeometry(0.055, 0.5, 3, 8).translate(sx, 1.18, 0), 0, limb); add(new THREE.SphereGeometry(0.05, 8, 6).translate(sx, 0.86, 0), 3, limb); }
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8).translate(0, 1.56, 0), 3, 0);
  add(new THREE.SphereGeometry(1, 14, 10).scale(0.1, 0.12, 0.11).translate(0, 1.7, 0), 3, 0);
  add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.107, 0.1, 0.117).translate(0, 1.72, -0.005), 4, 0);
  const g = mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); return p.index ? p.toNonIndexed() : p; }));
  return g;
}
const SKIN = [[0.85, 0.66, 0.5], [0.78, 0.58, 0.42], [0.7, 0.5, 0.36], [0.9, 0.74, 0.6]];

export function createCrowd(W, n) {
  const cap = n + 40, geo = pedGeometry();
  const aAnim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
  const aTop = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  const aPants = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  const aSkin = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  geo.setAttribute('aAnim', aAnim); geo.setAttribute('aTop', aTop); geo.setAttribute('aPants', aPants); geo.setAttribute('aSkin', aSkin);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
  const flash = { value: 0 };
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aPart, aLimb; attribute vec2 aAnim; attribute vec3 aTop, aPants, aSkin; varying vec3 vPedCol;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sw = sin(aAnim.x) * aAnim.y, ang = 0.0, py = 0.0;
        if (aLimb > 0.5 && aLimb < 1.5) { ang = sw; py = 0.9; }
        else if (aLimb > 1.5 && aLimb < 2.5) { ang = -sw; py = 0.9; }
        else if (aLimb > 2.5 && aLimb < 3.5) { ang = -sw * 0.8; py = 1.45; }
        else if (aLimb > 3.5) { ang = sw * 0.8; py = 1.45; }
        if (ang != 0.0) { float c = cos(ang), s = sin(ang); vec3 q = transformed - vec3(0.0, py, 0.0); transformed = vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c) + vec3(0.0, py, 0.0); }
        vPedCol = aPart < 0.5 ? aTop : aPart < 1.5 ? aPants : aPart < 2.5 ? vec3(0.06) : aPart < 3.5 ? aSkin : vec3(0.02);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPedCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPedCol;');
  };
  const mesh = new THREE.InstancedMesh(geo, mat, cap); mesh.count = 0; mesh.castShadow = true; mesh.frustumCulled = false;
  const umb = new THREE.InstancedMesh(umbrellaGeo(), new THREE.MeshStandardMaterial({ roughness: 0.5, side: THREE.DoubleSide }), cap);
  umb.count = 0; umb.frustumCulled = false;
  umb.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  W.group.add(mesh, umb);
  W.peds = { mesh, umb, list: [], cap, aAnim, aTop, aPants, aSkin, recycleT: 0 };
  const pal = [[0.8, 0.15, 0.2], [0.15, 0.3, 0.7], [0.9, 0.9, 0.88], [0.1, 0.1, 0.12], [0.85, 0.6, 0.15], [0.2, 0.5, 0.35], [0.55, 0.25, 0.6], [0.4, 0.4, 0.45]];
  for (let i = 0; i < n; i++) { const p = spawnPedNear(W, G.P.x, G.P.z, 0, 450); if (p) addPed(W, p[0], p[1], pal); }
  W.peds.pal = pal;
}
function umbrellaGeo() {
  const canopy = new THREE.ConeGeometry(0.58, 0.26, 12, 1, true).translate(0, 2.08, 0);
  const pole = new THREE.CylinderGeometry(0.012, 0.012, 0.9, 4).translate(0, 1.65, 0);
  canopy.deleteAttribute('uv'); pole.deleteAttribute('uv');
  return mergeGeometries([canopy.toNonIndexed(), pole.toNonIndexed()]);
}
function pickArea(W, x, z, minD, maxD) {
  const near = W.pedAreas.filter(a => { const d = Math.hypot(a.x - x, a.z - z); return d >= minD * 0.5 && d < maxD; });
  if (!near.length) return null;
  let tot = 0; for (const a of near) tot += a.weight; let r = Math.random() * tot;
  for (const a of near) { r -= a.weight; if (r <= 0) return a; } return near[near.length - 1];
}
function spawnPedNear(W, x, z, minD, maxD) {
  for (let k = 0; k < 6; k++) { const a = pickArea(W, x, z, minD, maxD); if (!a) return null; const p = a.sample(); if (p && Math.hypot(p[0] - x, p[1] - z) >= minD) return [p[0], p[1], a]; }
  return null;
}
export function addPed(W, x, z, pal, area) {
  const P = W.peds; if (!P || P.list.length >= P.cap) return null;
  pal = pal || P.pal;
  const i = P.list.length, top = pal[(Math.random() * pal.length) | 0], pants = [[0.12, 0.14, 0.2], [0.2, 0.2, 0.22], [0.35, 0.3, 0.25], [0.15, 0.2, 0.35]][(Math.random() * 4) | 0];
  const sk = SKIN[(Math.random() * SKIN.length) | 0];
  P.aTop.setXYZ(i, ...top); P.aPants.setXYZ(i, ...pants); P.aSkin.setXYZ(i, ...sk);
  P.aTop.needsUpdate = P.aPants.needsUpdate = P.aSkin.needsUpdate = true;
  const p = { i, x, z, h: Math.random() * 6.28, area: area || null, tx: x, tz: z, v: 1 + Math.random() * 0.6, state: 'walk', hp: 100, t: 0, flash: 0, vx: 0, vz: 0, fleeT: 0, thx: 0, thz: 0, phase: Math.random() * 6, top, umbrella: Math.random() < 0.55 };
  const uc = [[0.1, 0.1, 0.12], [0.75, 0.1, 0.15], [0.1, 0.25, 0.6], [0.9, 0.85, 0.8], [0.3, 0.6, 0.55]][(Math.random() * 5) | 0];
  P.umb.setColorAt(i, new THREE.Color(...uc)); P.umb.instanceColor.needsUpdate = true;
  P.list.push(p); P.mesh.count = P.umb.count = P.list.length;
  return p;
}
function respawn(W, p, minD) {
  const s = spawnPedNear(W, G.P.x, G.P.z, minD, 420); if (!s) return;
  p.x = s[0]; p.z = s[1]; p.area = s[2]; p.tx = p.x; p.tz = p.z; p.state = 'walk'; p.dead = false; p.hp = 100; p.t = 0; p.vx = p.vz = 0;
}

const dummy = new THREE.Object3D(); dummy.rotation.order = 'YXZ';
export function updateCrowd(dt) {
  const W = G.world, P = W.peds; if (!P) return;
  const veh = G.P.mode === 'car' ? G.P.veh : null, cx = veh ? veh.x : G.P.x, cz = veh ? veh.z : G.P.z, fast = veh && Math.abs(veh.speed) > 2;
  const rain = G.weather.rain;
  // move far-away pedestrians closer to the player, out of sight
  P.recycleT -= dt;
  if (P.recycleT <= 0) { P.recycleT = 0.5; let n = 0; for (const p of P.list) { if (n > 6) break; if (Math.hypot(p.x - cx, p.z - cz) > 480 && p.state !== 'down') { respawn(W, p, 160); n++; } } }
  for (const p of P.list) {
    let moving = 0;
    if (p.state === 'down') {
      p.t += dt; if (p.vx || p.vz) { p.x += p.vx * dt; p.z += p.vz * dt; p.vx *= 0.9; p.vz *= 0.9; if (Math.abs(p.vx) + Math.abs(p.vz) < 0.05) p.vx = p.vz = 0; }
      if (p.dead) { if (p.t > 45 && Math.hypot(p.x - cx, p.z - cz) > 60) respawn(W, p, 120); }
      else if (p.t > 8) { p.state = 'flee'; p.fleeT = 5; p.thx = cx; p.thz = cz; p.hp = 100; }
    } else {
      if (fast && Math.hypot(p.x - cx, p.z - cz) < 12) { p.state = 'flee'; p.fleeT = 3; p.thx = cx; p.thz = cz; }
      let dx, dz, spd;
      if (p.state === 'flee') { p.fleeT -= dt; dx = p.x - p.thx; dz = p.z - p.thz; spd = 4.8; if (p.fleeT <= 0) { p.state = 'walk'; p.tx = p.x; p.tz = p.z; } }
      else {
        dx = p.tx - p.x; dz = p.tz - p.z; spd = p.v * (rain ? 1.15 : 1);
        if (Math.hypot(dx, dz) < 0.8) {
          const s = p.area ? p.area.sample() : null;
          if (s && Math.hypot(s[0] - p.x, s[1] - p.z) < 60) { p.tx = s[0]; p.tz = s[1]; }
          else { p.tx = p.x + (Math.random() - 0.5) * 16; p.tz = p.z + (Math.random() - 0.5) * 16; }
          dx = dz = 0;
        }
      }
      const d = Math.hypot(dx, dz);
      if (d > 0.01) {
        const ux = dx / d, uz = dz / d, nx = p.x + ux * spd * dt, nz = p.z + uz * spd * dt;
        if (!blockedStatic(W, nx, nz, 0.3, true)) { p.x = nx; p.z = nz; p.h = Math.atan2(ux, uz); moving = spd; }
        else if (p.state === 'flee') { p.thx = p.x + (Math.random() - 0.5) * 10; p.thz = p.z + (Math.random() - 0.5) * 10; }
        else { p.tx = p.x; p.tz = p.z; }
      }
    }
    if (p.flash > 0) { p.flash -= dt; P.aTop.setXYZ(p.i, ...(p.flash > 0 ? [3, 3, 3] : p.top)); P.aTop.needsUpdate = true; }
    const down = p.state === 'down';
    p.phase += dt * moving * 2.6;
    P.aAnim.setXY(p.i, p.phase, Math.min(0.65, moving * 0.3) * (down ? 0 : 1));
    const fall = down ? 1 - Math.pow(1 - Math.min(1, p.t / 0.5), 3) : 0; // eased fall over half a second
    dummy.position.set(p.x, fall * 0.15 + (1 - fall) * Math.abs(Math.sin(p.phase)) * 0.05, p.z);
    dummy.rotation.set(-Math.PI / 2 * fall, p.h, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    P.mesh.setMatrixAt(p.i, dummy.matrix);
    const showUmb = rain && p.umbrella && !down && p.state !== 'flee';
    if (!showUmb) dummy.scale.set(0, 0, 0);
    dummy.updateMatrix(); P.umb.setMatrixAt(p.i, dummy.matrix);
  }
  P.aAnim.needsUpdate = true; P.mesh.instanceMatrix.needsUpdate = true; P.umb.instanceMatrix.needsUpdate = true;
}
