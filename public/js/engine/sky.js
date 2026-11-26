// Night sky dome (city glow, overcast clouds, stars, moon), rain streaks and lightning.
import * as THREE from 'three';
import { G } from '../state.js';

export const MOON_DIR = new THREE.Vector3(-0.45, 0.42, -0.55).normalize();
const sky = { dome: null, rain: null, flash: 0, nextFlash: 8 };

export function createSky(scene) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uRain: { value: 1 }, uTime: { value: 0 }, uFlash: { value: 0 }, uMoon: { value: MOON_DIR } },
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uRain, uTime, uFlash; uniform vec3 uMoon; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){
        vec3 d = normalize(vDir); float h = d.y, t = clamp(h, 0.0, 1.0);
        vec3 zen = vec3(0.003, 0.004, 0.012), mid = vec3(0.018, 0.016, 0.045), hor = vec3(0.13, 0.05, 0.09);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, t)); c = mix(c, zen, smoothstep(0.18, 0.7, t));
        c += vec3(0.32, 0.12, 0.04) * exp(-max(h, 0.0) * 12.0) * (0.55 + uRain * 0.6);
        float n = noise(d * 5.0 + vec3(uTime * 0.012, 0.0, uTime * 0.004)) * 0.6 + noise(d * 13.0 + uTime * 0.01) * 0.4;
        vec3 cloud = mix(vec3(0.03, 0.022, 0.035), vec3(0.13, 0.065, 0.06), n) * (0.55 + 0.9 * exp(-max(h, 0.0) * 3.0));
        cloud += vec3(0.5, 0.55, 0.75) * uFlash * n;
        c = mix(c, cloud, uRain * smoothstep(-0.05, 0.06, h) * 0.92);
        if (h > 0.0) { vec3 sp = floor(d * 420.0); float s = hash(sp);
          c += vec3(step(0.9975, s) * (1.0 - uRain) * smoothstep(0.05, 0.3, h) * (0.5 + 0.5 * sin(uTime * 3.0 + s * 100.0))); }
        float m = dot(d, uMoon);
        c += (1.0 - uRain * 0.9) * (smoothstep(0.9993, 0.9996, m) * vec3(2.2, 2.1, 1.9) + pow(max(m, 0.0), 300.0) * vec3(0.12, 0.12, 0.16));
        if (h < 0.0) c = mix(c, hor * 0.5, smoothstep(0.0, -0.1, h));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  sky.dome = new THREE.Mesh(new THREE.SphereGeometry(8000, 48, 24), mat);
  sky.dome.renderOrder = -10; sky.dome.frustumCulled = false;
  scene.add(sky.dome);
}

export function setRain(count) {
  if (sky.rain) { G.scene.remove(sky.rain); sky.rain.geometry.dispose(); sky.rain = null; }
  if (!count) return;
  const seeds = new Float32Array(count * 6), ends = new Float32Array(count * 2), pos = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    seeds.set([x, y, z, x, y, z], i * 6); ends[i * 2] = 0; ends[i * 2 + 1] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: new THREE.Vector3(80, 45, 80) }, uVel: { value: new THREE.Vector3(2.5, -26, 1.2) }, uLen: { value: 0.9 }, uOpacity: { value: 0.32 } },
    transparent: true, depthWrite: false, fog: false,
    vertexShader: `
      uniform vec3 uCam, uBox, uVel; uniform float uTime, uLen; attribute vec3 aSeed; attribute float aEnd; varying float vA;
      void main(){
        vec3 p = aSeed * uBox + uVel * uTime;
        vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
        vec3 wp = uCam + rel - normalize(uVel) * uLen * aEnd;
        vA = (1.0 - aEnd * 0.85) * (1.0 - smoothstep(0.25, 0.5, length(rel.xz) / uBox.x));
        if (wp.y < 0.0) vA = 0.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: 'uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(0.62, 0.7, 0.86, vA * uOpacity); }'
  });
  sky.rain = new THREE.LineSegments(g, m); sky.rain.frustumCulled = false; sky.rain.renderOrder = 5;
  G.scene.add(sky.rain);
}

// Returns the lightning flash level (0..1) so lights can react.
export function updateSky(dt) {
  const u = sky.dome.material.uniforms, rain = G.weather.rain ? 1 : 0;
  u.uRain.value += (rain - u.uRain.value) * Math.min(1, dt * 0.8);
  u.uTime.value = G.time;
  sky.dome.position.copy(G.camera.position);
  if (sky.rain) { const r = sky.rain.material.uniforms; r.uCam.value.copy(G.camera.position); r.uTime.value = G.time; }
  sky.flash = Math.max(0, sky.flash - dt * 5);
  if (G.weather.rain) { sky.nextFlash -= dt; if (sky.nextFlash <= 0) { sky.flash = 1; sky.nextFlash = 14 + Math.random() * 30; setTimeout(() => { sky.flash = 0.8; }, 120); } }
  u.uFlash.value = sky.flash;
  return sky.flash;
}
