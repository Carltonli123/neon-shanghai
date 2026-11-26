#!/usr/bin/env node
// Converts raw Overpass JSON (data-raw/<district>.json) into compact game data
// (public/data/<district>.json). Coordinates become local meters: +x east, +z south.
// Map data © OpenStreetMap contributors, ODbL 1.0.
'use strict';
const fs = require('fs');
const path = require('path');

const DISTRICTS = {
  ljz: { origin: [31.2380, 121.5010], bbox: [31.2235, 121.4790, 31.2525, 121.5230] },
  psq: { origin: [31.2310, 121.4740], bbox: [31.2195, 121.4585, 31.2425, 121.4895] }
};
const LANDMARKS = [
  { key: 'pearl', re: /东方明珠电视塔|Oriental Pearl/i, h: 468, model: true, en: 'Oriental Pearl Tower', cn: '东方明珠' },
  { key: 'stower', re: /^上海中心大厦$|^Shanghai Tower$/i, h: 632, model: true, en: 'Shanghai Tower', cn: '上海中心大厦' },
  { key: 'jinmao', re: /^金茂大厦$|Jin Mao/i, h: 421, model: true, en: 'Jin Mao Tower', cn: '金茂大厦' },
  { key: 'swfc', re: /^上海环球金融中心$|World Financial Center/i, h: 492, model: true, en: 'Shanghai World Financial Center', cn: '上海环球金融中心' },
  { key: 'museum', re: /^上海博物馆$/, h: 30, model: true, en: 'Shanghai Museum', cn: '上海博物馆' },
  { key: 'theatre', re: /^上海大剧院$/, h: 40, model: true, en: 'Shanghai Grand Theatre', cn: '上海大剧院' },
  { key: 'planning', re: /城市规划展示馆/, h: 43, model: true, en: 'Shanghai Urban Planning Exhibition Hall', cn: '上海城市规划展示馆' },
  { key: 'tomorrow', re: /^明天广场$/, h: 285, model: true, en: 'Tomorrow Square', cn: '明天广场' },
  { key: 'radisson', re: /丽笙/, h: 208, model: true, en: 'Radisson Blu New World', cn: '新世界丽笙大酒店' },
  { key: 'cityhall', re: /^上海市人民政府$/, h: 50, model: false, en: 'Shanghai Municipal Government', cn: '上海市人民政府' },
  { key: 'parkhotel', re: /^国际饭店$/, h: 83, model: false, en: 'Park Hotel', cn: '国际饭店' },
  { key: 'raffles', re: /^来福士广场$/, h: 222, model: false, en: 'Raffles City', cn: '来福士广场' }
];

const R = 6378137;
function projector(lat0, lon0) {
  const kx = Math.cos(lat0 * Math.PI / 180) * Math.PI / 180 * R;
  const kz = Math.PI / 180 * R;
  return (lat, lon) => [(lon - lon0) * kx, -(lat - lat0) * kz];
}
const r1 = v => Math.round(v * 10) / 10;
function hash(n) { let x = (n * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; }

function dp(pts, eps) { // Douglas-Peucker on [[x,z],...]
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function ringArea(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] * p[i][1] - p[i][0] * p[j][1]); return a / 2; }
function centroid(p) { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; }
function closeRing(p) { if (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p = p.slice(0, -1); return p; }
function obb(p) { // minimum-area oriented rectangle by angle search
  let best = null; const [cx, cz] = centroid(p);
  for (let deg = 0; deg < 90; deg += 1) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
    for (const [x, z] of p) { const u = (x - cx) * c + (z - cz) * s, v = -(x - cx) * s + (z - cz) * c; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) best = { area, a, w: maxU - minU, d: maxV - minV, cu: (maxU + minU) / 2, cv: (maxV + minV) / 2 };
  }
  const c = Math.cos(best.a), s = Math.sin(best.a);
  return { x: r1(cx + best.cu * c - best.cv * s), z: r1(cz + best.cu * s + best.cv * c), angle: Math.round(best.a * 1000) / 1000, w: r1(best.w), d: r1(best.d) };
}
function stitch(ways) { // join open member ways into closed rings
  const segs = ways.map(w => w.slice()); const rings = [];
  while (segs.length) {
    let ring = segs.shift(); let changed = true;
    while (changed && !(ring.length > 2 && same(ring[0], ring[ring.length - 1]))) {
      changed = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], end = ring[ring.length - 1], start = ring[0];
        if (same(end, s[0])) ring = ring.concat(s.slice(1));
        else if (same(end, s[s.length - 1])) ring = ring.concat(s.slice(0, -1).reverse());
        else if (same(start, s[s.length - 1])) ring = s.slice(0, -1).concat(ring);
        else if (same(start, s[0])) ring = s.slice(1).reverse().concat(ring);
        else continue;
        segs.splice(i, 1); changed = true; break;
      }
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}
function same(a, b) { return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01; }
function flat(p) { const o = []; for (const [x, z] of p) o.push(r1(x), r1(z)); return o; }
function parseNum(v) { if (v == null) return NaN; const m = String(v).match(/[\d.]+/); return m ? parseFloat(m[0]) : NaN; }

function buildDistrict(key) {
  const cfg = DISTRICTS[key];
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data-raw', key + '.json'), 'utf8'));
  const proj = projector(cfg.origin[0], cfg.origin[1]);
  const sw = proj(cfg.bbox[0], cfg.bbox[1]), ne = proj(cfg.bbox[2], cfg.bbox[3]);
  const bounds = [r1(sw[0]), r1(ne[0]), r1(ne[1]), r1(sw[1])]; // minX,maxX,minZ,maxZ
  const geomOf = g => g.map(pt => proj(pt.lat, pt.lon));
  const ringsOf = el => {
    if (el.type === 'way' && el.geometry) return [closeRing(geomOf(el.geometry))];
    if (el.type === 'relation' && el.members) {
      const outers = el.members.filter(m => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === '')).map(m => geomOf(m.geometry));
      return stitch(outers).map(closeRing);
    }
    return [];
  };
  const inside = (x, z, pad) => x > bounds[0] - pad && x < bounds[1] + pad && z > bounds[2] - pad && z < bounds[3] + pad;

  const out = { name: key, origin: cfg.origin, bounds, attribution: '© OpenStreetMap contributors (ODbL)', buildings: [], roads: [], water: [], parks: [], squares: [], landmarks: {}, names: [] };
  const nameIdx = new Map();
  const nameRef = (cn, en) => { const k = cn + '|' + (en || ''); if (!nameIdx.has(k)) { nameIdx.set(k, out.names.length); out.names.push([cn, en || '']); } return nameIdx.get(k); };
  const seenBuilding = new Set();

  for (const el of raw.elements) {
    const t = el.tags || {};
    if (t.building && t.building !== 'no') {
      if (seenBuilding.has(el.type + el.id)) continue; seenBuilding.add(el.type + el.id);
      if (t.layer && +t.layer < 0) continue;
      for (let ring of ringsOf(el)) {
        ring = dp(ring, 0.4); if (ring.length < 3) continue;
        let area = ringArea(ring); if (Math.abs(area) < 12) continue;
        if (area > 0) ring.reverse(); // store counter-clockwise when viewed from above (+y)
        area = Math.abs(area);
        const [cx, cz] = centroid(ring); if (!inside(cx, cz, 0)) continue;
        const name = t.name || '', en = (t['name:en'] || '').trim();
        const lm = LANDMARKS.find(L => L.re.test(name) || (en && L.re.test(en)));
        let h = parseNum(t.height), src = 'tag';
        if (!(h > 0)) { const lv = parseNum(t['building:levels']); if (lv > 0) { h = lv * 3.3 + 2; src = 'levels'; } }
        if (!(h > 0) && lm) { h = lm.h; src = 'landmark'; }
        if (!(h > 0)) {
          const r = hash(el.id); src = 'est';
          h = area < 150 ? 7 + r * 4 : area < 600 ? 10 + r * 14 : area < 3000 ? 16 + r * 30 : 20 + r * 40;
        }
        let minH = parseNum(t.min_height); if (!(minH > 0)) minH = 0;
        const bt = t.building;
        const kind = bt === 'roof' || bt === 'canopy' ? 'f' : /apartments|residential|house|dormitory|terrace/.test(bt) ? 'r' : /commercial|office|retail|hotel|mall/.test(bt) ? 'c' : (t.historic || t.heritage) ? 'h' : 'g';
        if (kind === 'f') { minH = Math.max(minH, h - 1.2); }
        const b = { h: r1(h), k: kind, p: flat(ring) };
        if (minH) b.m = r1(minH);
        if (src === 'est') b.e = 1;
        if (lm || h >= 100) b.n = nameRef(name, en);
        if (lm) {
          b.lm = lm.key;
          if (!out.landmarks[lm.key] || area > out.landmarks[lm.key].area) {
            out.landmarks[lm.key] = Object.assign(obb(ring), { area: Math.round(area), h: r1(Math.max(h, lm.h)), model: lm.model, cn: lm.cn, en: lm.en });
          }
        }
        out.buildings.push(b);
      }
      continue;
    }
    if (t.highway && el.type === 'way' && el.geometry) {
      const hw = t.highway;
      if (t.tunnel === 'yes' || (t.layer && +t.layer < 0) || /proposed|construction|corridor|platform|bus_stop|elevator/.test(hw)) continue;
      const kind = /^(motorway|trunk)/.test(hw) ? 'T' : /^primary/.test(hw) ? 'P' : /^secondary/.test(hw) ? 'S' : /^tertiary/.test(hw) ? 'R'
        : /^(residential|unclassified|living_street|road)$/.test(hw) ? 'L' : hw === 'service' ? 'V' : hw === 'pedestrian' ? 'W'
        : /^(footway|path|steps|cycleway|track)$/.test(hw) ? 'F' : null;
      if (!kind) continue;
      const isArea = t.area === 'yes';
      let pts = geomOf(el.geometry);
      if (isArea && (kind === 'W' || kind === 'F')) { pts = dp(closeRing(pts), 0.8); if (pts.length >= 3) out.squares.push({ p: flat(pts), n: t.name ? nameRef(t.name, t['name:en']) : undefined }); continue; }
      pts = dp(pts, kind === 'F' ? 0.8 : 1.0);
      if (!pts.some(([x, z]) => inside(x, z, 60))) continue;
      const lanes = parseNum(t.lanes), oneway = t.oneway === 'yes' || /motorway|trunk/.test(hw) && t.oneway !== 'no';
      const defaults = { T: 20, P: 18, S: 14, R: 10, L: 7, V: 5, W: 8, F: 2.6 };
      let width = parseNum(t.width);
      if (!(width > 0)) width = lanes > 0 ? lanes * 3.4 + (oneway ? 1 : 2) : defaults[kind];
      if (kind === 'F') width = Math.min(width, 4);
      const layer = parseNum(t.layer) || 0;
      const elevated = t.bridge && t.bridge !== 'no' && layer >= 1 && /T|P/.test(kind) ? Math.round(layer) : 0;
      const road = { k: kind, w: r1(width), p: flat(pts) };
      if (oneway) road.o = 1;
      if (lanes > 0) road.l = lanes;
      if (elevated) road.e = elevated;
      if (t.bridge && t.bridge !== 'no') road.b = 1;
      if (t.name) road.n = nameRef(t.name, t['name:en']);
      out.roads.push(road);
      continue;
    }
    const isWater = t.natural === 'water' || t.waterway === 'riverbank';
    const isPark = /^(park|garden|pitch)$/.test(t.leisure || '') || /^(grass|recreation_ground|village_green)$/.test(t.landuse || '');
    const isSquare = t.place === 'square' || !!t['area:highway'];
    if (isWater || isPark || isSquare) {
      for (let ring of ringsOf(el)) {
        ring = dp(ring, isWater ? 1.5 : 0.8); if (ring.length < 3) continue;
        const item = { p: flat(ring) };
        if (t.name) item.n = nameRef(t.name, t['name:en']);
        if (isWater) out.water.push(item);
        else if (isPark) { if (t.leisure === 'pitch') item.pitch = 1; out.parks.push(item); }
        else out.squares.push(item);
      }
    }
  }
  // Ring bridge in Lujiazui (circular footway on a bridge)
  for (const el of raw.elements) {
    const t = el.tags || {};
    if (el.type === 'way' && t.highway === 'footway' && t.bridge && el.geometry && el.geometry.length > 12) {
      const pts = geomOf(el.geometry), [cx, cz] = centroid(pts);
      const rs = pts.map(([x, z]) => Math.hypot(x - cx, z - cz)), mean = rs.reduce((a, b) => a + b, 0) / rs.length;
      const dev = Math.max(...rs.map(r => Math.abs(r - mean)));
      if (mean > 30 && mean < 120 && dev < mean * 0.25 && same(pts[0], pts[pts.length - 1])) {
        if (!out.landmarks.ring || /环|ring/i.test(t.name || '')) out.landmarks.ring = { x: r1(cx), z: r1(cz), r: r1(mean), model: true, cn: '陆家嘴环形天桥', en: 'Lujiazui Ring Bridge' };
      }
    }
  }
  for (const L of Object.values(out.landmarks)) delete L.area;
  const stats = { buildings: out.buildings.length, estimatedHeights: out.buildings.filter(b => b.e).length, roads: out.roads.length, water: out.water.length, parks: out.parks.length, squares: out.squares.length, landmarks: Object.keys(out.landmarks) };
  fs.mkdirSync(path.join(__dirname, '..', 'public', 'data'), { recursive: true });
  const file = path.join(__dirname, '..', 'public', 'data', key + '.json');
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(key, JSON.stringify(stats), (fs.statSync(file).size / 1024).toFixed(0) + ' KB', 'bounds', bounds.join(','));
}
for (const k of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(DISTRICTS)) buildDistrict(k);
