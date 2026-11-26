// Graphics quality tiers and automatic resolution scaling.
export const TIERS = {
  low: {
    key: 'low', label: 'LOW', prMax: 1, composer: false, msaa: 0, bloom: false, smaa: false, ao: false,
    reflect: 0, shadows: 0, lights: 0, spot: false, rain: 1200, groundPPM: 0.35, texScale: 0.5,
    trees: 0.3, cones: false, dashes: false, details: false, clearcoat: false, envSize: 64, peds: 70, lampGlow: false
  },
  medium: {
    key: 'medium', label: 'MED', prMax: 1.25, composer: true, msaa: 0, bloom: true, smaa: true, ao: false,
    reflect: 0, shadows: 0, lights: 4, spot: true, rain: 3000, groundPPM: 0.5, texScale: 0.5,
    trees: 0.6, cones: false, dashes: true, details: true, clearcoat: false, envSize: 128, peds: 110, lampGlow: true
  },
  high: {
    key: 'high', label: 'HIGH', prMax: 1.5, composer: true, msaa: 4, bloom: true, smaa: false, ao: false,
    reflect: 0.5, shadows: 2048, lights: 8, spot: true, rain: 6000, groundPPM: 0.75, texScale: 1,
    trees: 1, cones: true, dashes: true, details: true, clearcoat: true, envSize: 256, peds: 150, lampGlow: true
  },
  ultra: {
    key: 'ultra', label: 'ULTRA', prMax: 2, composer: true, msaa: 4, bloom: true, smaa: false, ao: true,
    reflect: 0.75, shadows: 4096, lights: 12, spot: true, rain: 9000, groundPPM: 1.0, texScale: 1,
    trees: 1, cones: true, dashes: true, details: true, clearcoat: true, envSize: 256, peds: 180, lampGlow: true
  }
};
export const ORDER = ['low', 'medium', 'high', 'ultra'];

// Picks a starting tier from what the device reports. AUTO then adjusts resolution live.
export function detectTier(renderer) {
  const gl = renderer.getContext();
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  let gpu = '';
  try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); if (ext) gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || ''; } catch (e) { /* not exposed */ }
  if (!renderer.capabilities.isWebGL2) return 'low';
  if (mobile) return /Apple GPU|Adreno \(TM\) (7|8)\d\d|Mali-G7/.test(gpu) ? 'medium' : 'low';
  if (/SwiftShader|llvmpipe|Software/i.test(gpu)) return 'low';
  if (/Intel/i.test(gpu) && !/Arc/i.test(gpu)) return 'medium';
  if (/RTX|Radeon RX [67]|Apple M[2-9] (Pro|Max|Ultra)/i.test(gpu)) return 'ultra';
  return 'high';
}

// Lowers or raises the render scale to hold roughly 50-60 fps.
export class DynamicResolution {
  constructor() { this.scale = 1; this.acc = 0; this.n = 0; this.cool = 2; }
  update(dt) {
    this.acc += dt; this.n++; this.cool -= dt;
    if (this.acc < 1.5) return false;
    const ms = this.acc / this.n * 1000; this.acc = 0; this.n = 0;
    if (this.cool > 0) return false;
    const before = this.scale;
    if (ms > 22) this.scale = Math.max(0.55, this.scale - (ms > 34 ? 0.15 : 0.08));
    else if (ms < 14.5 && this.scale < 1) this.scale = Math.min(1, this.scale + 0.05);
    if (before !== this.scale) { this.cool = 1.5; return true; }
    return false;
  }
}
