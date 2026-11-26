// World container and static collision: building polygons and circles in a spatial grid,
// water as a 2 m raster.
import * as THREE from 'three';

const GC = 32;
const key = (ix, iz) => ix * 100003 + iz;

export function newWorld(data) {
  return {
    data, group: new THREE.Group(), bounds: data.bounds,
    polyGrid: new Map(), circleGrid: new Map(), water: null,
    roadGrid: new Map(), roads: [],
    landmarks: [], billboards: [], traffic: [], parked: [], police: [], peds: null, pedAreas: [],
    lamps: [], anim: [], detailChunks: [], heroCar: null, spawn: null, photo: null,
    onResize: null, ground: null, lightPool: null, cones: null
  };
}

function gridInsert(grid, o, minX, maxX, minZ, maxZ) {
  for (let ix = Math.floor(minX / GC); ix <= Math.floor(maxX / GC); ix++)
    for (let iz = Math.floor(minZ / GC); iz <= Math.floor(maxZ / GC); iz++) {
      const k = key(ix, iz); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(o);
    }
}
export function addPoly(W, flat) {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < flat.length; i += 2) { const x = flat[i], z = flat[i + 1]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  const o = { p: flat, minX, maxX, minZ, maxZ };
  gridInsert(W.polyGrid, o, minX, maxX, minZ, maxZ); return o;
}
export function addCircle(W, x, z, r, soft) { const o = { x, z, r, soft: !!soft }; gridInsert(W.circleGrid, o, x - r, x + r, z - r, z + r); return o; }
export function addBoxCollider(W, x, z, w, d, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), pts = [];
  for (const [u, v] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) pts.push(x + u * c - v * s, z + u * s + v * c);
  return addPoly(W, pts);
}

export function pointInPoly(p, x, z) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function nearEdge(p, x, z, r) {
  const r2 = r * r;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j], az = p[j + 1], dx = p[i] - ax, dz = p[i + 1] - az, L = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - x, ez = az + t * dz - z; if (ex * ex + ez * ez < r2) return true;
  }
  return false;
}

// Water raster from OSM water polygons, 2 m per cell.
export function buildWater(W) {
  const b = W.bounds, res = 2, w = Math.ceil((b[1] - b[0]) / res), h = Math.ceil((b[3] - b[2]) / res);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.setTransform(1 / res, 0, 0, 1 / res, -b[0] / res, -b[2] / res); g.fillStyle = '#fff';
  for (const wa of W.data.water) { const p = wa.p; g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); g.fill(); }
  const img = g.getImageData(0, 0, w, h).data, mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = img[i * 4 + 3] > 128 ? 1 : 0;
  W.water = { mask, w, h, res, x0: b[0], z0: b[2] };
}
export function isWater(W, x, z) {
  const m = W.water; if (!m) return false;
  const ix = Math.floor((x - m.x0) / m.res), iz = Math.floor((z - m.z0) / m.res);
  if (ix < 0 || iz < 0 || ix >= m.w || iz >= m.h) return false;
  return m.mask[iz * m.w + ix] === 1;
}

export function blockedStatic(W, x, z, r, ignoreSoft) {
  const B = W.bounds;
  if (x < B[0] + r || x > B[1] - r || z < B[2] + r || z > B[3] - r) return true;
  if (isWater(W, x, z) || (r > 0.6 && (isWater(W, x + r, z) || isWater(W, x - r, z) || isWater(W, x, z + r) || isWater(W, x, z - r)))) return true;
  for (let ix = Math.floor((x - r) / GC); ix <= Math.floor((x + r) / GC); ix++)
    for (let iz = Math.floor((z - r) / GC); iz <= Math.floor((z + r) / GC); iz++) {
      const k = key(ix, iz);
      const polys = W.polyGrid.get(k);
      if (polys) for (const o of polys) {
        if (x < o.minX - r || x > o.maxX + r || z < o.minZ - r || z > o.maxZ + r) continue;
        if (pointInPoly(o.p, x, z) || (r > 0 && nearEdge(o.p, x, z, r))) return true;
      }
      const circles = W.circleGrid.get(k);
      if (circles) for (const c of circles) {
        if (ignoreSoft && c.soft) continue;
        const dx = x - c.x, dz = z - c.z, rr = c.r + r; if (dx * dx + dz * dz < rr * rr) return true;
      }
    }
  return false;
}
export function insideBuilding(W, x, z) {
  const polys = W.polyGrid.get(key(Math.floor(x / GC), Math.floor(z / GC)));
  if (polys) for (const o of polys) if (x >= o.minX && x <= o.maxX && z >= o.minZ && z <= o.maxZ && pointInPoly(o.p, x, z)) return true;
  return false;
}
// Height of the building at a point (0 if none). Colliders without a height count as very tall.
export function buildingHeightAt(W, x, z) {
  const polys = W.polyGrid.get(key(Math.floor(x / GC), Math.floor(z / GC)));
  let h = 0;
  if (polys) for (const o of polys) if (x >= o.minX && x <= o.maxX && z >= o.minZ && z <= o.maxZ && pointInPoly(o.p, x, z)) h = Math.max(h, o.h || 999);
  return h;
}
export function losClear(W, x1, z1, x2, z2) {
  const d = Math.hypot(x2 - x1, z2 - z1), n = Math.ceil(d / 1.5);
  for (let i = 1; i < n; i++) { const t = i / n; if (insideBuilding(W, x1 + (x2 - x1) * t, z1 + (z2 - z1) * t)) return false; }
  return true;
}

// Road segment grid for "is this point on a carriageway" queries.
export function buildRoadGrid(W) {
  for (const r of W.data.roads) {
    if (r.e) continue;
    const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const s = { ax: p[i], az: p[i + 1], bx: p[i + 2], bz: p[i + 3], hw: r.w / 2, k: r.k };
      gridInsert(W.roadGrid, s, Math.min(s.ax, s.bx) - s.hw, Math.max(s.ax, s.bx) + s.hw, Math.min(s.az, s.bz) - s.hw, Math.max(s.az, s.bz) + s.hw);
    }
  }
}
export function onRoad(W, x, z, pad, kinds) {
  const a = W.roadGrid.get(key(Math.floor(x / GC), Math.floor(z / GC)));
  if (a) for (const s of a) {
    if (kinds && !kinds.includes(s.k)) continue;
    const dx = s.bx - s.ax, dz = s.bz - s.az, L = dx * dx + dz * dz || 1e-9;
    let t = ((x - s.ax) * dx + (z - s.az) * dz) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = s.ax + t * dx - x, ez = s.az + t * dz - z, lim = s.hw + pad;
    if (ex * ex + ez * ez < lim * lim) return true;
  }
  return false;
}
