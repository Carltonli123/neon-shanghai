// Hand-built landmark models, placed and rotated to match their OpenStreetMap footprints.
import * as THREE from 'three';
import { G } from '../state.js';
import { addCircle, addBoxCollider } from './world.js';
import { blinkMat } from './buildings.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Merges a model's static meshes by material so each landmark costs a handful of draw calls.
function mergeStatic(g) {
  g.updateMatrixWorld(true);
  const byMat = new Map(), remove = [];
  g.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.keep || Array.isArray(o.material)) return;
    let geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo); remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  for (const [mat, geos] of byMat) { const m = new THREE.Mesh(mergeGeometries(geos), mat); g.add(m); }
}

const hdr = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.2 }, o));
function cylBetween(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m;
}
function place(W, g, L) { mergeStatic(g); g.position.set(L.x, 0, L.z); g.rotation.y = -(L.angle || 0); g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); W.group.add(g); }
function blink(W, x, y, z) { const m = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), blinkMat); m.position.set(x, y, z); W.group.add(m); }
function toast(W, L, r, extra) { W.landmarks.push({ x: L.x, z: L.z, r, cn: L.cn, en: L.en + (extra || '') }); }

const BUILD = {
  pearl(W, L) {
    const t = new THREE.Group();
    const col = std(0xc9ccd8, { roughness: 0.35, metalness: 0.6 });
    const pink = std(0xd8407e, { roughness: 0.25, metalness: 0.3, emissive: new THREE.Color(0.9, 0.08, 0.35), emissiveIntensity: 1 });
    const grid = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.5, 1.0), wireframe: true, transparent: true, opacity: 0.3 });
    const strip = hdr(1.6, 1.8, 2.6);
    for (let i = 0; i < 3; i++) {
      const a = i * 2 * Math.PI / 3, cx = Math.cos(a) * 10, cz = Math.sin(a) * 10;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 296, 24), col); c.position.set(cx, 148, cz); t.add(c);
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.4, 290, 0.4), strip); s.position.set(Math.cos(a) * 14.7, 148, Math.sin(a) * 14.7); t.add(s);
      const b = a + Math.PI / 3; t.add(cylBetween(new THREE.Vector3(Math.cos(b) * 48, 0, Math.sin(b) * 48), new THREE.Vector3(Math.cos(b) * 9, 100, Math.sin(b) * 9), 3.4, col));
    }
    const sph = (r, y) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), pink); s.position.y = y; t.add(s); const w = new THREE.Mesh(new THREE.SphereGeometry(r * 1.012, 32, 18), grid); w.position.y = y; t.add(w); };
    sph(25, 93); [150, 175, 200, 225].forEach(y => { const s = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 14), pink); s.position.y = y; t.add(s); });
    sph(22.5, 272);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 42, 16), col); shaft.position.y = 315; t.add(shaft);
    sph(8, 342);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.6, 118, 10), col); spire.position.y = 409; t.add(spire);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(26, 0.7, 8, 96), hdr(3, 3, 3)); ring.rotation.x = Math.PI / 2; ring.position.y = 93; ring.userData.keep = true; t.add(ring);
    const ring2 = ring.clone(); ring2.userData = {}; ring2.scale.setScalar(0.88); ring2.position.y = 272; t.add(ring2);
    W.anim.push(tm => { const h = (tm * 0.03) % 1; pink.emissive.setHSL(0.92 + Math.sin(tm * 0.4) * 0.06, 0.85, 0.32 + 0.1 * Math.sin(tm * 1.3)); grid.color.setHSL(h, 0.9, 0.6).multiplyScalar(1.2); ring.scale.setScalar(1 + 0.04 * Math.sin(tm * 2)); });
    place(W, t, { x: L.x, z: L.z, angle: 0 }); blink(W, L.x, 470, L.z);
    addCircle(W, L.x, L.z, 50); toast(W, L, 260, ' · 468 m');
  },
  stower(W, L) {
    const t = new THREE.Group();
    const shape = new THREE.Shape();
    for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI * 2, r = 1 + 0.09 * Math.cos(3 * a) - (Math.abs(Math.sin(a * 1.5)) > 0.995 ? 0.04 : 0); const px = Math.cos(a) * r, py = Math.sin(a) * r; i ? shape.lineTo(px, py) : shape.moveTo(px, py); }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 4 }); geo.rotateX(-Math.PI / 2);
    const glass = std(0x8fb0c8, { roughness: 0.08, metalness: 0.75, emissive: new THREE.Color(0.06, 0.14, 0.22), envMapIntensity: 1.6 });
    const band = hdr(1.2, 2.4, 3.0), N = 80, H = 580;
    for (let i = 0; i < N; i++) {
      const f = i / N, s = 35 * (1 - 0.56 * f);
      const m = new THREE.Mesh(geo, glass); m.scale.set(s, H / N * 0.985, s); m.position.y = i * H / N; m.rotation.y = f * Math.PI * 2 / 3; t.add(m);
      if (i % 10 === 9) { const b = new THREE.Mesh(geo, band); b.scale.set(s * 1.02, 0.9, s * 1.02); b.position.y = (i + 1) * H / N - 0.9; b.rotation.y = f * Math.PI * 2 / 3; t.add(b); }
    }
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(9, 15.4, 44, 24, 6, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.2, 3), wireframe: true })); crown.position.y = H + 22; t.add(crown);
    place(W, t, L); blink(W, L.x, 634, L.z); addCircle(W, L.x, L.z, 40); toast(W, L, 230, ' · 632 m');
  },
  jinmao(W, L) {
    const t = new THREE.Group();
    const facade = std(0x7d705a, { roughness: 0.5, metalness: 0.5, emissive: new THREE.Color(0.18, 0.12, 0.05) });
    const gold = std(0xffd27a, { roughness: 0.3, metalness: 0.9, emissive: new THREE.Color(1.6, 1.0, 0.3), emissiveIntensity: 1 });
    const pod = new THREE.Mesh(new THREE.BoxGeometry(90, 24, 70), facade); pod.position.y = 12; t.add(pod);
    let y = 24, w = 52, h = 55;
    for (let i = 0; i < 13; i++) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), facade); a.position.y = y + h / 2; t.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, h, w * 0.8), facade); b.position.y = y + h / 2; b.rotation.y = Math.PI / 4; t.add(b);
      const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, 1.4, w * 1.05), gold); band.position.y = y + h; t.add(band);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), gold); fin.position.set(sx * w * 0.52, y + h / 2, sz * w * 0.52); t.add(fin); }
      y += h; w *= 0.925; h *= 0.86;
    }
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(2, w * 0.62, 48, 8), gold); crown.position.y = y + 24; t.add(crown);
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.6, 30, 8), gold); sp.position.y = y + 63; t.add(sp);
    place(W, t, L); blink(W, L.x, y + 80, L.z); addBoxCollider(W, L.x, L.z, 90, 70, L.angle); toast(W, L, 200, ' · 421 m');
  },
  swfc(W, L) {
    const t = new THREE.Group();
    const glass = std(0x7a90ab, { roughness: 0.1, metalness: 0.7, emissive: new THREE.Color(0.05, 0.08, 0.13), envMapIntensity: 1.5 });
    const edge = hdr(0.8, 2.4, 3.2);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(24, 44, 420, 4, 12), glass); body.rotation.y = Math.PI / 4; body.position.y = 210; t.add(body);
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(9, 72, 34), glass); p.position.set(sx * 12.5, 456, 0); t.add(p);
      for (const sz of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.9, 62, 0.9), edge); e.position.set(sx * 8, 452, sz * 17.2); t.add(e); }
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.6, 420, 0.6), hdr(0.4, 0.9, 1.4)); v.position.set(sx * 31, 210, 0); v.rotation.z = sx * -0.0476; t.add(v);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(34, 8, 34), glass); beam.position.y = 488; t.add(beam);
    for (const sz of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(16, 0.9, 0.9), edge); e.position.set(0, 483.5, sz * 17.2); t.add(e); }
    place(W, t, L); blink(W, L.x, 495, L.z); addBoxCollider(W, L.x, L.z, 64, 64, L.angle); toast(W, L, 200, ' · 492 m');
  },
  ring(W, L) {
    const t = new THREE.Group(), r = L.r || 55;
    const deck = new THREE.Mesh(new THREE.TorusGeometry(r, 3.6, 12, 160), std(0xe6ecf5, { roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(0.25, 0.3, 0.4) }));
    deck.rotation.x = Math.PI / 2; deck.position.y = 9; deck.scale.z = 0.5; t.add(deck);
    const glow = new THREE.Mesh(new THREE.TorusGeometry(r, 0.45, 6, 200), hdr(0.6, 2.2, 3)); glow.rotation.x = Math.PI / 2; glow.position.y = 7; t.add(glow);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(r + 3.2, 0.12, 4, 200), hdr(2.4, 2.4, 2.6)); rail.rotation.x = Math.PI / 2; rail.position.y = 10.6; t.add(rail);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, px = Math.cos(a) * r, pz = Math.sin(a) * r; const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 8, 10), std(0x8a909c)); p.position.set(px, 4, pz); t.add(p); addCircle(W, L.x + px, L.z + pz, 1.3); }
    place(W, t, { x: L.x, z: L.z, angle: 0 }); toast(W, L, 110);
  },
  museum(W, L) {
    const t = new THREE.Group(), s = Math.min(L.w, L.d) * 0.95;
    const stone = std(0xbfae8c, { roughness: 0.8, metalness: 0, emissive: new THREE.Color(0.32, 0.23, 0.12) });
    const base = new THREE.Mesh(new THREE.BoxGeometry(s, 16, s), stone); base.position.y = 8; t.add(base);
    const k = s / 112, prof = [[36, 16], [40, 16.5], [44, 20], [49, 26], [54, 31], [57, 34], [57.5, 35.5]].map(p => new THREE.Vector2(p[0] * k, p[1]));
    const lathe = new THREE.Mesh(new THREE.LatheGeometry(prof, 128), std(0xcbb895, { roughness: 0.7, side: THREE.DoubleSide, emissive: new THREE.Color(0.4, 0.3, 0.15) })); t.add(lathe);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(52 * k, 52 * k, 1, 128), stone); lid.position.y = 33; t.add(lid);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2, h = new THREE.Mesh(new THREE.TorusGeometry(11 * k, 2 * k, 10, 32, Math.PI), stone); h.position.set(Math.cos(a) * 40 * k, 35, Math.sin(a) * 40 * k); h.rotation.y = -a + Math.PI / 2; t.add(h); }
    const glow = new THREE.Mesh(new THREE.TorusGeometry(57.6 * k, 0.4, 4, 160), hdr(3, 2.2, 1)); glow.rotation.x = Math.PI / 2; glow.position.y = 35.4; t.add(glow);
    place(W, t, L); addBoxCollider(W, L.x, L.z, s, s, L.angle); toast(W, L, 150);
  },
  theatre(W, L) {
    const t = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(92, 27, 62), std(0xffe2b0, { roughness: 0.2, metalness: 0.1, emissive: new THREE.Color(1.4, 0.9, 0.4) })); box.position.y = 13.5; t.add(box);
    const g = new THREE.BoxGeometry(126, 3, 80, 48, 1, 16), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const xx = p.getX(i) / 63, zz = p.getZ(i) / 40; p.setY(i, p.getY(i) + 13 * xx * xx + 2.5 * zz * zz); }
    g.computeVertexNormals();
    const roof = new THREE.Mesh(g, std(0xeef2fa, { roughness: 0.3, metalness: 0.2, emissive: new THREE.Color(0.35, 0.4, 0.55) })); roof.position.y = 29; t.add(roof);
    for (let i = -4; i <= 4; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 27, 10), std(0xffffff, { emissive: new THREE.Color(0.5, 0.5, 0.5) })); c.position.set(i * 10, 13.5, 32); t.add(c); }
    place(W, t, L); addBoxCollider(W, L.x, L.z, 92, 62, L.angle); toast(W, L, 120);
  },
  planning(W, L) {
    const t = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(56, 36, 56), std(0x6a8098, { roughness: 0.15, metalness: 0.6, emissive: new THREE.Color(0.25, 0.32, 0.4) })); box.position.y = 18; t.add(box);
    const petal = std(0xf2f4fa, { roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide, emissive: new THREE.Color(0.5, 0.55, 0.65) });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(12, 10, 32, 1, true), petal); c.rotation.x = Math.PI; c.position.set(sx * 14, 41, sz * 14); t.add(c); }
    place(W, t, L); addBoxCollider(W, L.x, L.z, 56, 56, L.angle); toast(W, L, 110);
  },
  tomorrow(W, L) {
    const t = new THREE.Group(), facade = std(0x5f7590, { roughness: 0.15, metalness: 0.6, emissive: new THREE.Color(0.12, 0.16, 0.22) });
    const base = new THREE.Mesh(new THREE.BoxGeometry(54, 110, 54), facade); base.position.y = 55; t.add(base);
    const up = new THREE.Mesh(new THREE.BoxGeometry(44, 130, 44), facade); up.position.y = 175; up.rotation.y = Math.PI / 4; t.add(up);
    const cr = new THREE.Mesh(new THREE.ConeGeometry(31.5, 34, 4, 1, true), std(0x3a3f52, { side: THREE.DoubleSide })); cr.position.y = 257; t.add(cr);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.ConeGeometry(31.7, 34, 4)), new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2, 0.8) })); edges.position.y = 257; t.add(edges);
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.2, 24, 8), std(0x9aa0aa)); sp.position.y = 286; t.add(sp);
    place(W, t, L); blink(W, L.x, 298, L.z); addBoxCollider(W, L.x, L.z, 54, 54, L.angle); toast(W, L, 170, ' · 285 m');
  },
  radisson(W, L) {
    const t = new THREE.Group(), facade = std(0x8aa0b8, { roughness: 0.15, metalness: 0.6, emissive: new THREE.Color(0.12, 0.16, 0.24) });
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 170, 40), facade); tw.position.y = 85; t.add(tw);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(36, 26, 9, 64), std(0xcfe6ff, { emissive: new THREE.Color(0.5, 0.8, 1.2) })); disc.position.y = 176; t.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(36, 0.8, 8, 96), hdr(3, 0.6, 1.6)); ring.rotation.x = Math.PI / 2; ring.position.y = 180.5; ring.userData.keep = true; t.add(ring);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(16, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), std(0x9fc8ff, { roughness: 0.1, metalness: 0.5, emissive: new THREE.Color(0.2, 0.45, 0.8) })); dome.position.y = 180.5; t.add(dome);
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 24, 8), std(0x9aa0aa)); sp.position.y = 206; t.add(sp);
    W.anim.push(tm => { ring.rotation.z = tm * 0.4; });
    place(W, t, L); blink(W, L.x, 218, L.z); addCircle(W, L.x, L.z, 22); toast(W, L, 140, ' · 208 m');
  }
};

export function buildLandmarks(W) {
  for (const [key, L] of Object.entries(W.data.landmarks)) {
    if (L.model && BUILD[key]) BUILD[key](W, L);
    else toast(W, L, 110, L.h ? ' · ' + Math.round(L.h) + ' m' : '');
  }
}
