// WebGL renderer, post-processing pipeline and resolution management.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { G } from '../state.js';
import { DynamicResolution } from './quality.js';

// Film look applied after tone mapping: chromatic fringe at the edges, split toning, vignette, grain.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.34 }, uGrain: { value: 0.03 }, uCA: { value: 0.0018 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uCA; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec2 off = d * uCA * (1.0 + r2 * 4.0);
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, c * vec3(0.92, 1.0, 1.1), (1.0 - l) * 0.35);
      c = mix(c, c * vec3(1.06, 1.0, 0.93), l * 0.22);
      c *= 1.0 - uVig * smoothstep(0.1, 0.75, r2 * 2.0);
      c += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.0) - 0.5) * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`
};

export const pipe = { bloom: null, bokeh: null, grade: null, ao: null, dyn: new DynamicResolution() };

export function createRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 0.9;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  G.renderer = r;
  return r;
}

export function pixelRatio() {
  return Math.max(0.5, Math.min(window.devicePixelRatio || 1, G.q.prMax) * pipe.dyn.scale);
}

export function buildPipeline() {
  const q = G.q, r = G.renderer;
  if (G.composer) { G.composer.passes.forEach(p => p.dispose && p.dispose()); G.composer.renderTarget1.dispose(); G.composer.renderTarget2.dispose(); G.composer = null; }
  pipe.bloom = pipe.bokeh = pipe.grade = pipe.ao = null;
  r.shadowMap.enabled = q.shadows > 0;
  r.setPixelRatio(pixelRatio());
  r.setSize(innerWidth, innerHeight, false);
  if (!q.composer) return;
  const size = r.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
  const c = new EffectComposer(r, rt);
  c.setPixelRatio(r.getPixelRatio());
  c.setSize(innerWidth, innerHeight);
  c.addPass(new RenderPass(G.scene, G.camera));
  if (q.ao) {
    const ao = new GTAOPass(G.scene, G.camera, size.x, size.y);
    ao.updateGtaoMaterial({ radius: 3, distanceExponent: 1.4, thickness: 4, scale: 1.1, samples: 12 });
    ao.blendIntensity = 0.8; c.addPass(ao); pipe.ao = ao;
  }
  if (q.bloom) { pipe.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.5, 0.92); c.addPass(pipe.bloom); }
  pipe.bokeh = new BokehPass(G.scene, G.camera, { focus: 800, aperture: 0.000012, maxblur: 0.006 });
  pipe.bokeh.enabled = G.mode === 'photo'; c.addPass(pipe.bokeh);
  c.addPass(new OutputPass());
  pipe.grade = new ShaderPass(GradeShader); c.addPass(pipe.grade);
  if (q.smaa) c.addPass(new SMAAPass(size.x, size.y));
  G.composer = c;
}

export function resize() {
  const r = G.renderer; if (!r || !G.q) return;
  const pr = pixelRatio();
  r.setPixelRatio(pr); r.setSize(innerWidth, innerHeight, false);
  if (G.composer) { G.composer.setPixelRatio(pr); G.composer.setSize(innerWidth, innerHeight); }
  G.camera.aspect = innerWidth / innerHeight; G.camera.updateProjectionMatrix();
  if (G.world && G.world.onResize) G.world.onResize();
}

export function render(dt) {
  if (G.autoTier && pipe.dyn.update(dt)) resize();
  if (G.composer) {
    if (pipe.grade) pipe.grade.uniforms.uTime.value = G.time;
    if (pipe.bokeh) {
      pipe.bokeh.enabled = G.mode === 'photo';
      if (pipe.bokeh.enabled && G.controls) pipe.bokeh.uniforms.focus.value = G.camera.position.distanceTo(G.controls.target);
    }
    G.composer.render(dt);
  } else G.renderer.render(G.scene, G.camera);
}
