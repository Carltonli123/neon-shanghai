// Loads a district's OSM data and builds everything in it, in dependency order.
import * as THREE from 'three';
import { G } from '../state.js';
import { newWorld, buildWater, buildRoadGrid, blockedStatic } from './world.js';
import { buildGround, buildMarkings } from './ground.js';
import { buildBuildings } from './buildings.js';
import { computeLamps, buildLamps, buildTrees, buildElevated, buildPedAreas } from './streets.js';
import { buildLandmarks } from './landmarks.js';
import { buildTraffic, spawnHeroCar } from '../entities/vehicles.js';
import { createCrowd } from '../entities/human.js';
import { placeBillboards } from '../game/ads.js';
import { buildMiniMap } from '../game/hud.js';

export const DISTRICTS = {
  ljz: {
    file: 'data/ljz.json', en: 'Lujiazui', cn: '陆家嘴 · Pudong', prefix: 'LJZ',
    spawnNear: d => [d.landmarks.ring.x + 170, d.landmarks.ring.z + 170], lookAt: d => d.landmarks.pearl,
    ledFocus: d => [d.landmarks.ring.x + 200, d.landmarks.ring.z + 200], ledRadius: 900, ledCount: 9, ledWalls: 4,
    adFocus: d => [d.landmarks.ring.x + 150, d.landmarks.ring.z + 150], ledFace: [-1, -0.2],
    oldBank: { x: -700 },
    photo: d => { const t = new THREE.Vector3((d.landmarks.pearl.x + d.landmarks.jinmao.x) / 2, 170, (d.landmarks.pearl.z + d.landmarks.jinmao.z) / 2); return { target: t, cam: t.clone().add(new THREE.Vector3(-1300, 230, 380)) }; }
  },
  psq: {
    file: 'data/psq.json', en: "People's Square", cn: '人民广场 · Huangpu', prefix: 'PSQ',
    spawnNear: d => [(d.landmarks.museum.x + d.landmarks.cityhall.x) / 2, (d.landmarks.museum.z + d.landmarks.cityhall.z) / 2], lookAt: d => d.landmarks.tomorrow,
    ledFocus: d => [d.landmarks.museum.x, d.landmarks.museum.z], ledRadius: 1100, ledCount: 5, ledWalls: 3,
    adFocus: d => [(d.landmarks.museum.x + d.landmarks.cityhall.x) / 2, (d.landmarks.museum.z + d.landmarks.cityhall.z) / 2], ledFace: null,
    oldBank: null,
    photo: d => { const t = new THREE.Vector3(d.landmarks.museum.x - 120, 40, d.landmarks.museum.z - 120); return { target: t, cam: t.clone().add(new THREE.Vector3(620, 360, 640)) }; }
  }
};
const cache = {};
export async function fetchDistrict(key) {
  if (!cache[key]) cache[key] = fetch(DISTRICTS[key].file).then(r => { if (!r.ok) throw new Error('Could not load ' + DISTRICTS[key].file); return r.json(); });
  return cache[key];
}

// Finds a spot on a main road near the target, with the car facing the look-at landmark.
function findSpawn(W, near, look) {
  let best = null;
  for (const r of W.data.roads) {
    if (r.e || !'PSR'.includes(r.k) || r.w < 9) continue;
    const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); if (L < 30) continue;
      const mx = (p[i] + p[i + 2]) / 2, mz = (p[i + 1] + p[i + 3]) / 2, d = Math.hypot(mx - near[0], mz - near[1]);
      if (!best || d < best.d) best = { d, mx, mz, fx: (p[i + 2] - p[i]) / L, fz: (p[i + 3] - p[i + 1]) / L, w: r.w, oneway: !!r.o };
    }
  }
  let { fx, fz } = best; if (!best.oneway && look && (look.x - best.mx) * fx + (look.z - best.mz) * fz < 0) { fx = -fx; fz = -fz; }
  const rx = -fz, rz = fx, off = best.oneway ? best.w * 0.2 : best.w / 4;
  const car = { x: best.mx + rx * off, z: best.mz + rz * off, h: Math.atan2(fx, fz) };
  let hero = null;
  for (const s of [1.8, 2.6, 3.4, -2.6]) { const x = car.x + rx * s * 1.2 + fx * 1.5, z = car.z + rz * s * 1.2 + fz * 1.5; if (!blockedStatic(W, x, z, 0.5)) { hero = { x, z }; break; } }
  return { car, hero: hero || { x: car.x + fx * 4, z: car.z + fz * 4 }, h: car.h };
}

export async function buildDistrict(key, noiseTex, status) {
  const cfg = DISTRICTS[key], data = await fetchDistrict(key);
  const W = newWorld(data); G.world = W; G.district = key;
  const T = W.timing = {}; let t0 = performance.now();
  const mark = n => { const t = performance.now(); T[n] = Math.round(t - t0); t0 = t; };
  status('Reading streets…'); await frame();
  buildWater(W); buildRoadGrid(W); mark('water+grid');
  status('Raising ' + data.buildings.length.toLocaleString() + ' buildings…'); await frame();
  buildBuildings(W, { ledFocus: cfg.ledFocus(data), ledRadius: cfg.ledRadius, ledCount: cfg.ledCount, oldBank: cfg.oldBank });
  mark('buildings'); buildLandmarks(W); mark('landmarks');
  status('Lighting the streets…'); await frame();
  computeLamps(W); mark('computeLamps'); buildGround(W, noiseTex); mark('ground'); buildMarkings(W); mark('markings'); buildLamps(W); mark('lamps'); buildElevated(W); buildTrees(W); mark('elevated+trees');
  status('Filling the city with people…'); await frame();
  buildPedAreas(W); mark('pedAreas');
  const sp = findSpawn(W, cfg.spawnNear(data), cfg.lookAt(data)); W.spawn = sp;
  G.P.x = sp.hero.x; G.P.z = sp.hero.z; G.P.h = sp.h;
  spawnHeroCar(W, sp.car.x, sp.car.z, sp.car.h);
  buildTraffic(W); mark('traffic');
  placeBillboards(W, { prefix: cfg.prefix, focus: cfg.adFocus(data), ledWalls: cfg.ledWalls, ledFace: cfg.ledFace });
  mark('billboards'); createCrowd(W, G.q.peds); mark('crowd');
  W.photo = cfg.photo(data);
  buildMiniMap(W);
  return W;
}
// Yields so the loading text can paint; the timeout keeps loading moving when rAF is throttled in background tabs.
const frame = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 30); });
