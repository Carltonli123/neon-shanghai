// Street furniture from OSM roads: lamps (with pooled real lights and rain light cones),
// plane trees, elevated highways, and the areas pedestrians walk in.
import * as THREE from 'three';
import { G, hash1 } from '../state.js';
import { addCircle, blockedStatic, insideBuilding, isWater, onRoad, pointInPoly } from './world.js';
import { makeGlowTexture } from '../engine/textures.js';

let glowTex = null;

// Lamp positions are computed first because the ground bakes their light pools.
export function computeLamps(W) {
  const out = [];
  for (const r of W.data.roads) {
    if (r.e || !'TPSRLW'.includes(r.k)) continue;
    const step = r.k === 'L' ? 46 : r.k === 'W' ? 26 : 36, p = r.p;
    let carry = step * 0.5;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = Math.hypot(dx, dz); if (L < 1) continue;
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
      for (let s = carry; s < L; s += step) {
        for (const side of r.k === 'W' ? [0] : [-1, 1]) {
          const off = r.k === 'W' ? 0 : r.w / 2 + 1.3, x = ax + ux * s + nx * side * off, z = az + uz * s + nz * side * off;
          if (r.k !== 'W' && (insideBuilding(W, x, z) || isWater(W, x, z) || onRoad(W, x, z, 0.3, 'TPSRL'))) continue;
          out.push({ x, z, nx: -nx * side, nz: -nz * side, warm: hash1(Math.round(x * 3 + z)) < 0.7 });
        }
      }
      carry = (carry - L % step + step) % step || step;
    }
  }
  W.lamps = out;
}

export function buildLamps(W) {
  const q = G.q, L = W.lamps, n = L.length; if (!n) return;
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.14, 8.5, 6).translate(0, 4.25, 0);
  const armGeo = new THREE.BoxGeometry(0.1, 0.1, 1.6).translate(0, 8.4, 0.75);
  const headGeo = new THREE.BoxGeometry(0.35, 0.12, 0.7).translate(0, 8.3, 1.45);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.5, metalness: 0.7 });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, n), arms = new THREE.InstancedMesh(armGeo, poleMat, n), heads = new THREE.InstancedMesh(headGeo, headMat, n);
  const o = new THREE.Object3D(), warm = new THREE.Color(3.2, 1.9, 0.9), cool = new THREE.Color(2.6, 2.8, 3.0);
  L.forEach((l, i) => {
    o.position.set(l.x, 0, l.z); o.rotation.y = Math.atan2(l.nx, l.nz); o.updateMatrix();
    poles.setMatrixAt(i, o.matrix); arms.setMatrixAt(i, o.matrix); heads.setMatrixAt(i, o.matrix); heads.setColorAt(i, l.warm ? warm : cool);
    l.hx = l.x + l.nx * 1.45; l.hz = l.z + l.nz * 1.45;
    addCircle(W, l.x, l.z, 0.25, true);
  });
  poles.castShadow = true;
  W.group.add(poles, arms, heads);
  if (q.lampGlow) {
    glowTex = glowTex || makeGlowTexture();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    L.forEach((l, i) => { pos.set([l.hx, 8.15, l.hz], i * 3); const c = l.warm ? [1, 0.62, 0.3] : [0.75, 0.82, 1]; col.set(c, i * 3); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex, size: 9, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    pts.layers.set(1); W.group.add(pts);
  }
  if (q.cones) {
    // soft light cones that show up in the rain; only the nearest lamps get one
    const coneGeo = new THREE.ConeGeometry(4.2, 8.2, 20, 1, true).translate(0, -4.1, 0);
    const coneMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0.05 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying float vY; varying vec3 vC; varying float vF; void main(){ vY = position.y; vC = instanceColor; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal); vF = pow(abs(dot(n, normalize(-mv.xyz))), 2.5); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uOpacity; varying float vY; varying vec3 vC; varying float vF; void main(){ float a = smoothstep(-8.2, -0.5, vY) * (1.0 - smoothstep(-0.4, 0.0, vY)) * vF; gl_FragColor = vec4(vC * a * uOpacity, 1.0); }'
    });
    const cones = new THREE.InstancedMesh(coneGeo, coneMat, 160);
    cones.count = 0; cones.frustumCulled = false; cones.layers.set(1);
    cones.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(160 * 3), 3);
    W.group.add(cones); W.cones = cones;
  }
  // pool of real point lights that follow the player through the nearest lamps
  if (q.lights) {
    const pool = [];
    for (let i = 0; i < q.lights; i++) { const pl = new THREE.PointLight(0xffb070, 0, 32, 1.6); pl.position.y = 7.9; W.group.add(pl); pool.push(pl); }
    W.lightPool = pool;
  }
  W._lampT = 0;
}

export function updateLamps(dt, focusX, focusZ) {
  const W = G.world; W._lampT -= dt; if (W._lampT > 0) return; W._lampT = 0.25;
  const near = [];
  for (const l of W.lamps) { const d = (l.hx - focusX) ** 2 + (l.hz - focusZ) ** 2; if (d < 220 * 220) near.push([d, l]); }
  near.sort((a, b) => a[0] - b[0]);
  if (W.lightPool) W.lightPool.forEach((pl, i) => {
    const e = near[i]; if (!e) { pl.intensity = 0; return; }
    const l = e[1]; pl.position.set(l.hx, 7.9, l.hz); pl.color.set(l.warm ? 0xffa860 : 0xcfdcff);
    pl.intensity = 110 * (1 - Math.min(1, Math.sqrt(e[0]) / 140));
  });
  if (W.cones) {
    const o = new THREE.Object3D(), c = new THREE.Color(), k = G.weather.rain ? 1 : 0.35, n = Math.min(near.length, 160);
    for (let i = 0; i < n; i++) { const l = near[i][1]; o.position.set(l.hx, 8.2, l.hz); o.updateMatrix(); W.cones.setMatrixAt(i, o.matrix); c.setRGB(l.warm ? 1 * k : 0.7 * k, l.warm ? 0.6 * k : 0.8 * k, l.warm ? 0.3 * k : 1 * k); W.cones.setColorAt(i, c); }
    W.cones.count = n; W.cones.instanceMatrix.needsUpdate = true; W.cones.instanceColor.needsUpdate = true;
  }
}

// Plane trees along major streets plus trees in parks.
export function buildTrees(W) {
  const q = G.q, pts = [], cap = { low: 1200, medium: 3500, high: 7000, ultra: 9000 }[q.key];
  for (const r of W.data.roads) {
    if (r.e || !'PSR'.includes(r.k)) continue;
    const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L = Math.hypot(dx, dz); if (L < 1) continue;
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
      for (let s = 6; s < L - 4; s += 11) for (const side of [-1, 1]) {
        if (hash1(Math.round((ax + s) * 7 + side)) > q.trees) continue;
        const x = ax + ux * s + nx * side * (r.w / 2 + 3.4), z = az + uz * s + nz * side * (r.w / 2 + 3.4);
        if (insideBuilding(W, x, z) || isWater(W, x, z) || onRoad(W, x, z, 0.8)) continue;
        pts.push([x, z, 3 + hash1(Math.round(x * 13)) * 1.8, 0]);
      }
    }
  }
  for (const pk of W.data.parks) {
    if (pk.pitch) continue;
    const p = pk.p; let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < p.length; i += 2) { minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]); minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]); }
    const n = Math.min(120, ((maxX - minX) * (maxZ - minZ) / 260 * q.trees) | 0);
    for (let k = 0; k < n; k++) {
      const x = minX + hash1(k * 7 + Math.round(minX)) * (maxX - minX), z = minZ + hash1(k * 13 + Math.round(minZ)) * (maxZ - minZ);
      if (!pointInPoly(p, x, z) || onRoad(W, x, z, 1) || insideBuilding(W, x, z)) continue;
      pts.push([x, z, 2.6 + hash1(k + Math.round(x)) * 2.4, 1]);
    }
  }
  if (pts.length > cap) pts.length = cap;
  if (!pts.length) return;
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x3a6a3e, roughness: 0.9 }), pts.length);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 4.4, 5).translate(0, 2.2, 0), new THREE.MeshStandardMaterial({ color: 0x5a5046, roughness: 0.9 }), pts.length);
  const o = new THREE.Object3D(), col = new THREE.Color();
  pts.forEach((p, i) => {
    const s = p[2];
    o.position.set(p[0], 4.2 + s * 0.75, p[1]); o.scale.set(s * 1.15, s * 0.95, s * 1.15); o.rotation.y = s * 10; o.updateMatrix(); crown.setMatrixAt(i, o.matrix);
    col.setHSL(0.26 + hash1(i) * 0.08, 0.38, 0.16 + hash1(i * 3) * 0.12); crown.setColorAt(i, col);
    o.position.set(p[0], 0, p[1]); o.scale.set(1, 1, 1); o.updateMatrix(); trunk.setMatrixAt(i, o.matrix);
    addCircle(W, p[0], p[1], 0.45, true);
  });
  crown.castShadow = true; trunk.castShadow = true; trunk.layers.set(1);
  W.group.add(crown, trunk);
}

// Elevated highways (OSM bridges on layer >= 1): deck, glowing barriers, pillars and lamps.
export function buildElevated(W) {
  const decks = [], pillars = [], lamps = [];
  for (const r of W.data.roads) {
    if (!r.e) continue;
    const y = 10.5 * r.e, p = r.p; let carry = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.5) continue;
      decks.push({ x: (ax + bx) / 2, z: (az + bz) / 2, L: L + 0.6, w: r.w + 1.5, a: Math.atan2(dx, dz), y });
      for (let s = (40 - carry % 40); s < L; s += 40) {
        const x = ax + dx / L * s, z = az + dz / L * s;
        if (!isWater(W, x, z) && !insideBuilding(W, x, z)) { pillars.push([x, z, y]); addCircle(W, x, z, 1.6, false); }
        lamps.push([x, y, z]);
      }
      carry += L;
    }
  }
  if (!decks.length) return;
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x4a4e57, roughness: 0.75, metalness: 0.1 });
  const deckGeo = new THREE.BoxGeometry(1, 1.4, 1), glowGeo = new THREE.BoxGeometry(1, 0.22, 1);
  const deck = new THREE.InstancedMesh(deckGeo, deckMat, decks.length);
  const glow = new THREE.InstancedMesh(glowGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 2.2) }), decks.length * 2);
  const o = new THREE.Object3D();
  decks.forEach((s, i) => {
    o.position.set(s.x, s.y - 0.7, s.z); o.rotation.set(0, s.a, 0); o.scale.set(s.w, 1, s.L); o.updateMatrix(); deck.setMatrixAt(i, o.matrix);
    for (const side of [-1, 1]) {
      const nx = Math.cos(s.a) * side * (s.w / 2), nz = -Math.sin(s.a) * side * (s.w / 2);
      o.position.set(s.x + nx, s.y + 0.55, s.z + nz); o.scale.set(0.25, 1, s.L); o.updateMatrix(); glow.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), o.matrix);
    }
  });
  deck.castShadow = true; deck.receiveShadow = true;
  const pil = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.2, 1.4, 1, 10).translate(0, 0.5, 0), deckMat, pillars.length);
  pillars.forEach((p, i) => { o.position.set(p[0], 0, p[1]); o.rotation.set(0, 0, 0); o.scale.set(1, p[2] - 1.4, 1); o.updateMatrix(); pil.setMatrixAt(i, o.matrix); });
  pil.castShadow = true;
  const lm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.2) }), lamps.length);
  lamps.forEach((p, i) => { o.position.set(p[0], p[1] + 6, p[2]); o.scale.set(1, 1, 1); o.updateMatrix(); lm.setMatrixAt(i, o.matrix); });
  W.group.add(deck, glow, pil, lm);
}

// Where pedestrians walk: squares, pedestrian streets, park paths and sidewalks of big roads.
export function buildPedAreas(W) {
  const A = [];
  const polyArea = (p, kind) => {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < p.length; i += 2) { minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]); minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]); }
    A.push({ kind, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, weight: Math.min(4, (maxX - minX) * (maxZ - minZ) / 4000 + 0.5),
      sample() { for (let k = 0; k < 20; k++) { const x = minX + Math.random() * (maxX - minX), z = minZ + Math.random() * (maxZ - minZ); if (pointInPoly(p, x, z) && !blockedStatic(W, x, z, 0.4, true)) return [x, z]; } return null; } });
  };
  for (const s of W.data.squares) polyArea(s.p, 'square');
  for (const pk of W.data.parks) if (!pk.pitch) polyArea(pk.p, 'park');
  for (const r of W.data.roads) {
    if (r.e) continue;
    const p = r.p, isWalk = r.k === 'W', side = 'PSR'.includes(r.k);
    if (!isWalk && !side) continue;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az); if (L < 20) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L, w = r.w;
      A.push({ kind: isWalk ? 'walk' : 'sidewalk', x: (ax + bx) / 2, z: (az + bz) / 2, weight: (isWalk ? 2.5 : 0.35) * L / 60,
        sample() { for (let k = 0; k < 8; k++) { const t = Math.random(); const off = isWalk ? (Math.random() - 0.5) * w * 0.8 : (Math.random() < 0.5 ? -1 : 1) * (w / 2 + 2.2); const x = ax + (bx - ax) * t + nx * off, z = az + (bz - az) * t + nz * off; if (!blockedStatic(W, x, z, 0.4, true) && (isWalk || !onRoad(W, x, z, 0.2))) return [x, z]; } return null; } });
    }
  }
  W.pedAreas = A;
}
