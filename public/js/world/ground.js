// The city floor: one big surface painted from OSM (asphalt, sidewalks, plazas, grass, river),
// lit by baked streetlight pools, made wet by a puddle mask and, on High/Ultra, mirrored by a
// planar reflection so neon, cars and people reflect on the road and the Huangpu.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { G } from '../state.js';

const ROAD_ORDER = ['F', 'V', 'L', 'W', 'R', 'S', 'P', 'T'];
const ASPHALT = { T: '#141619', P: '#15171b', S: '#16181c', R: '#17191d', L: '#1a1b1f', V: '#1c1d21', W: '#3a3330', F: '#2d2b29' };
const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;

function path(g, p, close) { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); if (close) g.closePath(); }

export function buildGround(W, noiseTex) {
  const q = G.q, d = W.data, b = W.bounds, M = 500;
  const ext = { minX: b[0] - M, minZ: b[2] - M, w: b[1] - b[0] + 2 * M, h: b[3] - b[2] + 2 * M };
  const maxTex = Math.min(4096, G.renderer.capabilities.maxTextureSize);
  const ppm = Math.min(q.groundPPM, maxTex / Math.max(ext.w, ext.h));
  const cw = Math.ceil(ext.w * ppm), ch = Math.ceil(ext.h * ppm);
  const ca = document.createElement('canvas'), cm = document.createElement('canvas');
  ca.width = cm.width = cw; ca.height = cm.height = ch;
  const a = ca.getContext('2d'), m = cm.getContext('2d');
  for (const g of [a, m]) { g.setTransform(ppm, 0, 0, ppm, -ext.minX * ppm, -ext.minZ * ppm); g.lineJoin = 'round'; g.lineCap = 'round'; }
  // base: city paving. Mask: R = how wet/reflective, G = water, B = streetlight pool
  a.fillStyle = '#23252b'; a.fillRect(ext.minX, ext.minZ, ext.w, ext.h);
  m.fillStyle = 'rgb(140,0,0)'; m.fillRect(ext.minX, ext.minZ, ext.w, ext.h);
  for (const pk of d.parks) { path(a, pk.p, true); a.fillStyle = pk.pitch ? '#1f4029' : '#1b2f20'; a.fill(); path(m, pk.p, true); m.fillStyle = 'rgb(30,0,0)'; m.fill(); }
  for (const sq of d.squares) { path(a, sq.p, true); a.fillStyle = '#35322f'; a.fill(); path(m, sq.p, true); m.fillStyle = 'rgb(190,0,0)'; m.fill(); }
  // sidewalks under the bigger roads, then asphalt on top
  const roads = d.roads.filter(r => !r.e).sort((x, y) => ROAD_ORDER.indexOf(x.k) - ROAD_ORDER.indexOf(y.k));
  for (const r of roads) if ('TPSR'.includes(r.k)) { path(a, r.p); a.strokeStyle = '#303238'; a.lineWidth = r.w + 7; a.stroke(); }
  for (const r of roads) {
    path(a, r.p); a.strokeStyle = ASPHALT[r.k]; a.lineWidth = r.w; a.stroke();
    path(m, r.p); m.strokeStyle = r.k === 'F' ? 'rgb(150,0,0)' : r.k === 'W' ? 'rgb(200,0,0)' : 'rgb(225,0,0)'; m.lineWidth = r.w; m.stroke();
  }
  for (const wa of d.water) { path(a, wa.p, true); a.fillStyle = '#020c14'; a.fill(); path(m, wa.p, true); m.fillStyle = 'rgb(255,255,0)'; m.fill(); }
  // baked light pools from street lamps (blue channel, added)
  m.globalCompositeOperation = 'lighter';
  for (const L of W.lamps) {
    const gr = m.createRadialGradient(L.x, L.z, 0, L.x, L.z, 11);
    gr.addColorStop(0, 'rgba(0,0,255,0.9)'); gr.addColorStop(0.5, 'rgba(0,0,255,0.35)'); gr.addColorStop(1, 'rgba(0,0,255,0)');
    m.fillStyle = gr; m.fillRect(L.x - 11, L.z - 11, 22, 22);
  }
  m.globalCompositeOperation = 'source-over';

  const aniso = G.renderer.capabilities.getMaxAnisotropy();
  const albedo = new THREE.CanvasTexture(ca); albedo.colorSpace = THREE.SRGBColorSpace; albedo.anisotropy = aniso;
  const mask = new THREE.CanvasTexture(cm); mask.anisotropy = aniso;
  const uniforms = {
    tMask: { value: mask }, tNoise: { value: noiseTex }, tRefl: { value: black }, uTexMat: { value: new THREE.Matrix4() },
    uWet: { value: 1 }, uRain: { value: 1 }, uTime: { value: 0 }, uReflOn: { value: 0 }, uLamp: { value: new THREE.Color(1.0, 0.62, 0.3) }
  };
  const mat = new THREE.MeshStandardMaterial({ map: albedo, roughness: 0.82, metalness: 0, envMapIntensity: 0.35 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uTexMat; varying vec3 vGW; varying vec4 vRUv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz; vRUv = uTexMat * vec4(transformed, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tMask, tNoise, tRefl; uniform float uWet, uRain, uTime, uReflOn; uniform vec3 uLamp;
        varying vec3 vGW; varying vec4 vRUv; float gWet, gWater, gPuddle; vec3 gNz;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec4 gm = texture2D(tMask, vMapUv);
        gWater = gm.g;
        gNz = texture2D(tNoise, vGW.xz * 0.021).rgb;
        float big = texture2D(tNoise, vGW.xz * 0.0041).b;
        gPuddle = smoothstep(0.5, 0.64, big + (gNz.r - 0.5) * 0.25);
        gWet = max(gm.r * uWet * mix(0.45, 1.0, gPuddle), gWater);
        diffuseColor.rgb *= (0.84 + gNz.g * 0.32) * mix(1.0, 0.5, gWet);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, mix(0.2, 0.05, gPuddle), gWet);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uLamp * gm.b * gm.b * 0.3 * (1.0 - gWater);`)
      .replace('#include <opaque_fragment>', `
        vec2 rip = texture2D(tNoise, vGW.xz * 0.11 + vec2(uTime * 0.05, uTime * 0.031)).rg - 0.5;
        vec2 rip2 = texture2D(tNoise, vGW.xz * 0.37 - vec2(uTime * 0.11, uTime * 0.07)).rg - 0.5;
        vec2 dist = (gNz.rg - 0.5) * (0.003 + 0.012 * gWater + 0.03 * (1.0 - gPuddle) * (1.0 - gWater)) + rip * gWater * 0.02 + rip2 * uRain * gWet * 0.006;
        vec3 refl = texture2D(tRefl, vRUv.xy / vRUv.w + dist).rgb;
        vec3 Vd = normalize(cameraPosition - vGW);
        float fres = 0.04 + 0.96 * pow(1.0 - clamp(Vd.y, 0.0, 1.0), 5.0);
        float rs = gWet * mix(0.12, 0.85, fres) * mix(0.28, 1.0, gPuddle);
        rs = max(rs, gWater * mix(0.55, 0.95, fres));
        outgoingLight = mix(outgoingLight, refl, rs * uReflOn * gWater * 0.7) + refl * rs * uReflOn * (1.0 - gWater * 0.7);
        #include <opaque_fragment>`);
  };
  const geo = new THREE.PlaneGeometry(ext.w, ext.h); geo.rotateX(-Math.PI / 2);
  const cx = ext.minX + ext.w / 2, cz = ext.minZ + ext.h / 2;
  // PlaneGeometry UV v runs bottom-to-top along -z after rotation; canvas row 0 is minZ, so flip.
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  albedo.flipY = false; mask.flipY = false;

  const plain = new THREE.Mesh(geo, mat); plain.position.set(cx, 0, cz); plain.receiveShadow = true;
  W.group.add(plain);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x07080b }));
  far.position.y = -0.4; W.group.add(far);

  let refl = null;
  if (q.reflect > 0) {
    const pr = G.renderer.getPixelRatio();
    // Reflector derives its mirror plane from the mesh rotation, so it gets an unrotated plane.
    const rgeo = new THREE.PlaneGeometry(ext.w, ext.h); const ruv = rgeo.attributes.uv; for (let i = 0; i < ruv.count; i++) ruv.setY(i, 1 - ruv.getY(i));
    refl = new Reflector(rgeo, { textureWidth: Math.round(innerWidth * pr * q.reflect), textureHeight: Math.round(innerHeight * pr * q.reflect), clipBias: 0.002, multisample: 0 });
    uniforms.uTexMat.value = refl.material.uniforms.textureMatrix.value;
    uniforms.tRefl.value = refl.getRenderTarget().texture;
    refl.material.dispose(); refl.material = mat;
    refl.position.copy(plain.position); refl.rotation.x = -Math.PI / 2; refl.receiveShadow = true;
    const orig = refl.onBeforeRender; let last = -1;
    refl.onBeforeRender = (r, s, cam, ...rest) => { if (cam !== G.camera || last === G.frame) return; last = G.frame; orig(r, s, cam, ...rest); };
    W.group.add(refl); plain.visible = false; uniforms.uReflOn.value = 1;
    W.onResize = () => { const p2 = G.renderer.getPixelRatio(); refl.getRenderTarget().setSize(Math.round(innerWidth * p2 * q.reflect), Math.round(innerHeight * p2 * q.reflect)); };
  }
  W.ground = { uniforms, ext, albedoCanvas: ca, refl, update(dt) { uniforms.uTime.value = G.time; const target = G.weather.rain ? 1 : 0.55; uniforms.uWet.value += (target - uniforms.uWet.value) * Math.min(1, dt * 0.2); uniforms.uRain.value += ((G.weather.rain ? 1 : 0) - uniforms.uRain.value) * Math.min(1, dt); } };
}

// Lane markings, edge lines and zebra crossings as one merged mesh (not reflected).
export function buildMarkings(W) {
  const d = W.data, pos = [], col = [], idx = [];
  const WHITE = [0.85, 0.87, 0.9], YELLOW = [0.95, 0.72, 0.15];
  function quad(ax, az, bx, bz, ox, oz, w, c) { // segment a->b offset by o, width w
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, nx = -dz / L * w / 2, nz = dx / L * w / 2, i = pos.length / 3;
    pos.push(ax + ox - nx, 0.035, az + oz - nz, bx + ox - nx, 0.035, bz + oz - nz, bx + ox + nx, 0.035, bz + oz + nz, ax + ox + nx, 0.035, az + oz + nz);
    for (let k = 0; k < 4; k++) col.push(c[0], c[1], c[2]);
    idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }
  const nodeCount = new Map(), nk = (x, z) => Math.round(x / 3) + ',' + Math.round(z / 3);
  for (const r of d.roads) { if (r.e || !'TPSRL'.includes(r.k)) continue; const p = r.p; for (const i of [0, p.length - 2]) { const k = nk(p[i], p[i + 1]); nodeCount.set(k, (nodeCount.get(k) || 0) + 1); } }
  for (const r of d.roads) {
    if (r.e || !'TPSR'.includes(r.k)) continue;
    const p = r.p, w = r.w, oneway = !!r.o;
    const lanesDir = r.l ? (oneway ? r.l : Math.max(1, Math.round(r.l / 2))) : oneway ? Math.max(1, Math.round((w - 1) / 3.4)) : (w >= 12 ? 2 : 1);
    const lw = (oneway ? w - 1 : w / 2 - 0.5) / lanesDir;
    let s0 = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.5) continue;
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
      for (const side of [-1, 1]) quad(ax, az, bx, bz, nx * side * (w / 2 - 0.45), nz * side * (w / 2 - 0.45), 0.15, WHITE);
      if (!oneway) for (const off of [-0.16, 0.16]) quad(ax, az, bx, bz, nx * off, nz * off, 0.13, YELLOW);
      if (G.q.dashes) {
        const offsets = [];
        if (oneway) for (let k = 1; k < lanesDir; k++) offsets.push(-w / 2 + 0.5 + k * lw);
        else for (let k = 1; k < lanesDir; k++) offsets.push(k * lw, -k * lw);
        if (offsets.length) for (let s = (9 - s0 % 9); s < L; s += 9) {
          const e = Math.min(L, s + 4);
          for (const off of offsets) quad(ax + ux * s, az + uz * s, ax + ux * e, az + uz * e, nx * off, nz * off, 0.14, WHITE);
        }
      }
      s0 += L;
    }
    // zebra crossings near intersections
    for (const end of [0, 1]) {
      const i = end ? p.length - 2 : 0, j = end ? p.length - 4 : 2;
      if ((nodeCount.get(nk(p[i], p[i + 1])) || 0) < 3) continue;
      const dx = p[j] - p[i], dz = p[j + 1] - p[i + 1], L = Math.hypot(dx, dz); if (L < 18) continue;
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux, cx = p[i] + ux * 9, cz = p[i + 1] + uz * 9;
      for (let o = -w / 2 + 0.8; o < w / 2 - 0.5; o += 1.2) quad(cx + nx * o - ux * 1.6, cz + nz * o - uz * 1.6, cx + nx * o + ux * 1.6, cz + nz * o + uz * 1.6, 0, 0, 0.55, WHITE);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  g.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissive: 0x1a1a1a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(g, mat); mesh.layers.set(1); mesh.receiveShadow = true;
  W.group.add(mesh);
}
