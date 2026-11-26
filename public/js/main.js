// Neon Huangpu — entry point: boot, input, game loop, quality and weather controls.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { G, $, clamp, store, wrapAng } from './state.js';
import { TIERS, ORDER, detectTier } from './engine/quality.js';
import { createRenderer, buildPipeline, resize, render, pipe } from './engine/renderer.js';
import { createSky, setRain, updateSky, MOON_DIR } from './engine/sky.js';
import { makeNoiseTexture } from './engine/textures.js';
import { buildDistrict, DISTRICTS } from './world/district.js';
import { updateBuildings } from './world/buildings.js';
import { updateLamps } from './world/streets.js';
import { blockedStatic, insideBuilding } from './world/world.js';
import { makeHero, animateHero, updateCrowd } from './entities/human.js';
import { updateTraffic, updateDriving, updatePolice, tryEnterExit, clearPolice, blocked, resetSpot } from './entities/vehicles.js';
import { WEAPONS, fire, fireRay, initCombat, updateCombat, alertPeds, knockDown } from './game/combat.js';
import { ensureAudio, toggleMute, updateAudio, refreshButton, sfx } from './game/audio.js';
import { renderStars, updateWanted, starsOf, clearHeat } from './game/wanted.js';
import { trackAds, redrawAds } from './game/ads.js';
import { drawMini, updateHud, sizeMini, showPrompt } from './game/hud.js';
import { track } from './game/analytics.js';
import { initFeedback } from './game/feedback.js';

const canvas = $('#game');
const loadMsg = m => { $('#loadMsg').textContent = m; };
let renderer;
try { renderer = createRenderer(canvas); renderer.info.autoReset = false; } catch (e) { $('#loading').hidden = true; $('#nogl').hidden = false; throw e; }

/* ---------- quality ---------- */
const savedQ = store('nh-q');
G.autoTier = !savedQ || savedQ === 'auto';
G.tierKey = G.autoTier ? detectTier(renderer) : (TIERS[savedQ] ? savedQ : 'high');
G.q = TIERS[G.tierKey];
function qLabel() { $('#btnQ').textContent = G.autoTier ? 'AUTO · ' + G.q.label : G.q.label; }

/* ---------- scene ---------- */
const scene = new THREE.Scene(); G.scene = scene;
scene.fog = new THREE.FogExp2(0x1a1226, 0.00042);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 12000); G.camera = camera;
camera.layers.enable(1);
createSky(scene);
const hemi = new THREE.HemisphereLight(0x5a6aa8, 0x1a1020, 0.5); scene.add(hemi);
const moon = new THREE.DirectionalLight(0xb4c2ff, 0.45); scene.add(moon); scene.add(moon.target);
const noiseTex = makeNoiseTexture(256);
G.hero = makeHero(); scene.add(G.hero.root);
initCombat();
const controls = new OrbitControls(camera, canvas); controls.enabled = false; controls.enableDamping = true; controls.autoRotateSpeed = 0.4; controls.maxPolarAngle = 1.5; controls.minDistance = 60; controls.maxDistance = 3500; G.controls = controls;

function applyShadows() {
  moon.castShadow = G.q.shadows > 0;
  if (moon.castShadow) {
    moon.shadow.mapSize.set(G.q.shadows, G.q.shadows);
    const s = moon.shadow.camera; s.left = s.bottom = -110; s.right = s.top = 110; s.near = 10; s.far = 900; s.updateProjectionMatrix();
    moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.6;
    if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; }
  }
}

/* ---------- environment reflections from the city itself ---------- */
let envRT = null;
function captureEnv() {
  const W = G.world, size = G.q.envSize;
  const cube = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
  const cc = new THREE.CubeCamera(2, 7000, cube);
  const t = W.photo.target; cc.position.set(t.x, 60, t.z);
  const hv = G.hero.root.visible; G.hero.root.visible = false;
  cc.update(renderer, scene);
  G.hero.root.visible = hv;
  const pm = new THREE.PMREMGenerator(renderer);
  if (envRT) envRT.dispose();
  envRT = pm.fromCubemap(cube.texture); scene.environment = envRT.texture; scene.environmentIntensity = 0.35;
  pm.dispose(); cube.dispose();
}

/* ---------- districts ---------- */
function disposeWorld(W) {
  scene.remove(W.group);
  W.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.isReflector) o.getRenderTarget().dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) if (m.map && m.map.isCanvasTexture && m.map.image && m.map.image.width >= 512 && !m.map.userData.keep) m.map.dispose();
  });
  if (W.ground) { W.ground.uniforms.tMask.value.dispose(); }
}
let loading = false;
async function loadDistrict(key, keepPos) {
  if (loading) return; loading = true;
  const keep = keepPos ? { x: G.P.x, z: G.P.z, h: G.P.h } : null;
  $('#loading').classList.remove('done'); $('#loading').hidden = false; loadMsg('Loading ' + DISTRICTS[key].en + '…');
  if (G.world) { if (G.P.veh) G.P.veh = null; resetSpot(); disposeWorld(G.world); }
  G.P.mode = 'foot'; G.P.veh = null; G.hero.root.visible = true; clearHeat();
  try {
    const W = await buildDistrict(key, noiseTex, loadMsg);
    scene.add(W.group);
    if (keep && !blockedStatic(W, keep.x, keep.z, 0.5)) { G.P.x = keep.x; G.P.z = keep.z; G.P.h = keep.h; }
    loadMsg('Capturing reflections…'); await new Promise(r => setTimeout(r, 30));
    captureEnv();
    const L = DISTRICTS[key]; $('#locEn').textContent = L.en; $('#locCn').textContent = L.cn;
    for (const [id, k] of [['#btnLjz', 'ljz'], ['#btnPsq', 'psq']]) { $(id).classList.toggle('on', key === k); $(id).setAttribute('aria-pressed', String(key === k)); }
    placeHero(); snapCam(); if (G.mode === 'photo') enterPhoto();
    store('nh-loc', key); track('location', { to: key, buildings: W.data.buildings.length });
  } catch (e) {
    console.error(e); loadMsg('Could not build the city: ' + e.message); loading = false; return;
  }
  $('#loading').classList.add('done'); setTimeout(() => { $('#loading').hidden = true; }, 600);
  loading = false;
}

function setTier(key, auto) {
  G.autoTier = auto; G.tierKey = key; G.q = TIERS[key]; pipe.dyn.scale = 1;
  store('nh-q', auto ? 'auto' : key); qLabel(); applyShadows(); buildPipeline(); setRain(G.weather.rain ? G.q.rain : 0);
  track('quality', { tier: key, auto });
  loadDistrict(G.district, true);
}

/* ---------- camera ---------- */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function placeHero() { G.hero.root.position.set(G.P.x, 0, G.P.z); G.hero.root.rotation.y = G.P.h; }
// Mouse look (pointer lock): yaw/pitch orbit the camera; right button zooms over the shoulder.
const look = G.look = { yaw: 0, pitch: -0.06, locked: false, aiming: false, aimT: 0, carOff: 0, carIdle: 0, sens: 0.0024, lockFailed: false, cx: 0, cy: 0, overCanvas: false, mouseShot: false };
const camDir = new THREE.Vector3();
function chaseTargets() {
  const P = G.P;
  if (look.locked && P.mode === 'foot') {
    const k = look.aimT, yaw = look.yaw, cp = Math.cos(look.pitch);
    const dx = Math.sin(yaw) * cp, dy = Math.sin(look.pitch), dz = Math.cos(yaw) * cp, rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const sh = 0.55 + 0.2 * k, px = P.x + rx * sh, py = 1.6 - 0.05 * k, pz = P.z + rz * sh;
    let dist = (G.camFar ? 7.5 : 4.3) * (1 - k) + 1.9 * k;
    for (let t = 0.6; t < dist; t += 0.25) if (insideBuilding(G.world, px - dx * t, pz - dz * t)) { dist = Math.max(0.6, t - 0.35); break; }
    camPos.set(px - dx * dist, Math.max(0.35, py - dy * dist), pz - dz * dist);
    camLook.set(px + dx * 30, py + dy * 30, pz + dz * 30);
    return;
  }
  if (P.mode === 'car') { const v = P.veh, yaw = v.h + (look.locked ? look.carOff : 0), fx = Math.sin(yaw), fz = Math.cos(yaw), back = G.camFar ? 24 : 11.5, up = G.camFar ? 10 : 4.4; camPos.set(v.x - fx * back, up, v.z - fz * back); camLook.set(v.x + fx * 12, G.camFar ? 4 : 2.6, v.z + fz * 12); }
  else { const fx = Math.sin(P.h), fz = Math.cos(P.h), back = G.camFar ? 9 : 4.6, up = G.camFar ? 4.5 : 2.3; camPos.set(P.x - fx * back + fz * 0.7, up, P.z - fz * back - fx * 0.7); camLook.set(P.x + fx * 5, 1.55, P.z + fz * 5); }
}
function snapCam() { chaseTargets(); camera.position.copy(camPos); camera.lookAt(camLook); }
function enterPhoto() {
  if (document.pointerLockElement) document.exitPointerLock();
  G.mode = 'photo'; document.body.classList.add('photo');
  const ph = G.world.photo; camera.position.copy(ph.cam); controls.target.copy(ph.target); controls.enabled = true; controls.autoRotate = true; controls.update();
  $('#btnMode').textContent = 'Play'; $('#btnMode').setAttribute('aria-pressed', 'true');
}
function exitPhoto() {
  G.mode = 'play'; document.body.classList.remove('photo'); controls.enabled = false; snapCam();
  $('#btnMode').textContent = 'Photo mode'; $('#btnMode').setAttribute('aria-pressed', 'false'); canvas.focus({ preventScroll: true });
}
function respawn() {
  const W = G.world, s = W.spawn; clearPolice();
  if (G.P.veh) { G.P.veh.kind = 'parked'; G.P.veh.mesh.userData.beam.visible = false; W.parked.push(G.P.veh); G.P.veh = null; resetSpot(); }
  G.P.mode = 'foot'; G.P.x = s.hero.x; G.P.z = s.hero.z; G.P.h = s.h; G.P.speed = 0; G.hero.root.visible = true; placeHero(); snapCam();
}
function bust() { if (G.P.busted > 0) return; G.P.busted = 2.6; $('#banner').hidden = false; track('busted', { stars: starsOf(G.P.heat) }); }

/* ---------- input ---------- */
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'brake', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyJ: 'fire' };
const K = G.keys;
function setWeapon(i) { G.P.weapon = (i + WEAPONS.length) % WEAPONS.length; track('weapon', { weapon: WEAPONS[G.P.weapon].name }); }
const act = () => { const before = G.P.mode; tryEnterExit(showPrompt, alertPeds); if (G.P.mode !== before) sfx('door'); };
addEventListener('keydown', e => {
  if (loading || G.uiOpen || (e.target && e.target.closest && e.target.closest('input,textarea'))) return;
  const k = KEYMAP[e.code];
  if (k) { if (k === 'fire' && !K.fire) G.fireQueued = true; K[k] = 1; e.preventDefault(); if (G.mode === 'photo' && k !== 'sprint') exitPhoto(); return; }
  if (e.repeat) return;
  if (e.code === 'KeyF' || e.code === 'KeyE') act();
  else if (/^Digit[123]$/.test(e.code)) setWeapon(+e.code.slice(5) - 1);
  else if (e.code === 'KeyQ') setWeapon(G.P.weapon + 1);
  else if (e.code === 'KeyC') G.camFar = !G.camFar;
  else if (e.code === 'KeyP') G.mode === 'photo' ? exitPhoto() : enterPhoto();
  else if (e.code === 'KeyR') { clearHeat(); respawn(); }
  else if (e.code === 'KeyM') showPrompt(toggleMute() ? 'Sound off' : 'Sound on', 1);
});
addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) { K[k] = 0; e.preventDefault(); } });
addEventListener('blur', () => { for (const k in K) K[k] = 0; });
const canLock = !!canvas.requestPointerLock;
canvas.addEventListener('pointerdown', e => {
  if (G.mode !== 'play' || e.pointerType !== 'mouse' || loading || G.uiOpen) return;
  ensureAudio(); canvas.focus({ preventScroll: true });
  { const r = canvas.getBoundingClientRect(); look.cx = e.clientX - r.left; look.cy = e.clientY - r.top; look.overCanvas = true; }
  if (canLock && !look.lockFailed && !look.locked) { // first click captures the mouse; it does not shoot
    look.yaw = G.P.mode === 'car' ? G.P.veh.h : G.P.h; look.pitch = -0.06;
    try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(lockDenied); } catch (_) { lockDenied(); }
    return;
  }
  // without pointer lock, shots go through the cursor
  if (e.button === 0) { K.fire = 1; G.fireQueued = true; look.mouseShot = !look.locked; }
  if (e.button === 2) look.aiming = true;
});
addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') return; if (e.button === 0) K.fire = 0; if (e.button === 2) look.aiming = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
function lockDenied() { if (look.lockFailed) return; look.lockFailed = true; showPrompt('Mouse capture is blocked here: click where you want to shoot', 3); track('mouse_aim', { on: false, denied: true }); }
document.addEventListener('pointerlockerror', lockDenied);
canvas.addEventListener('mousemove', e => { const r = canvas.getBoundingClientRect(); look.cx = e.clientX - r.left; look.cy = e.clientY - r.top; look.overCanvas = true; });
canvas.addEventListener('mouseleave', () => { look.overCanvas = false; });
document.addEventListener('pointerlockchange', () => {
  look.locked = document.pointerLockElement === canvas;
  if (!look.locked) { look.aiming = false; K.fire = 0; }
  document.body.classList.toggle('mouse-aim', look.locked);
  track('mouse_aim', { on: look.locked });
});
addEventListener('mousemove', e => {
  if (!look.locked) return;
  const s = look.sens * (look.aiming ? 0.5 : 1);
  if (G.P.mode === 'car') { look.carOff = clamp(look.carOff - e.movementX * s, -Math.PI, Math.PI); look.carIdle = 0; return; }
  look.yaw -= e.movementX * s; look.pitch = clamp(look.pitch - e.movementY * s, -0.85, 0.65);
});
canvas.addEventListener('wheel', e => { if (!look.locked) return; e.preventDefault(); setWeapon(G.P.weapon + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
document.querySelectorAll('#touch button[data-k]').forEach(b => {
  const k = b.dataset.k, off = () => { K[k] = 0; b.classList.remove('held'); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); if (k === 'fire') G.fireQueued = true; K[k] = 1; b.classList.add('held'); try { b.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ } });
  b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
});
document.querySelectorAll('#touch button[data-tap]').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); if (b.dataset.tap === 'act') act(); else setWeapon(G.P.weapon + 1); }));
if (matchMedia('(pointer:coarse)').matches) document.body.classList.add('is-touch');
$('#btnLjz').addEventListener('click', e => { e.currentTarget.blur(); if (G.district !== 'ljz') loadDistrict('ljz'); });
$('#btnPsq').addEventListener('click', e => { e.currentTarget.blur(); if (G.district !== 'psq') loadDistrict('psq'); });
$('#btnMode').addEventListener('click', e => { e.currentTarget.blur(); G.mode === 'photo' ? exitPhoto() : enterPhoto(); });
$('#btnQ').addEventListener('click', e => {
  e.currentTarget.blur(); if (loading) return;
  if (G.autoTier) setTier('low', false);
  else { const i = ORDER.indexOf(G.tierKey); if (i === ORDER.length - 1) setTier(detectTier(renderer), true); else setTier(ORDER[i + 1], false); }
});
$('#btnWx').addEventListener('click', e => {
  const b = e.currentTarget; b.blur(); G.weather.rain = !G.weather.rain;
  b.textContent = G.weather.rain ? 'RAIN' : 'CLEAR'; b.setAttribute('aria-pressed', String(G.weather.rain));
  setRain(G.weather.rain ? G.q.rain : 0); store('nh-rain', G.weather.rain ? '1' : '0'); track('weather', { rain: G.weather.rain });
});
$('#btnSnd').addEventListener('click', e => { e.currentTarget.blur(); const m = toggleMute(); track('sound', { muted: m }); });
refreshButton();
initFeedback();
$('#btnInfo').addEventListener('click', e => { const b = e.currentTarget; b.blur(); const p = $('#info'); p.hidden = !p.hidden; b.setAttribute('aria-pressed', String(!p.hidden)); });
addEventListener('resize', () => { resize(); sizeMini(); });

/* ---------- crosshair ---------- */
const xhair = $('#xhair'); let hitT = 0;
function flashHit() { hitT = 0.15; xhair.classList.add('hit'); }
function updateCrosshair(w) {
  const cursorMode = !look.locked && look.lockFailed && look.overCanvas && w.gun;
  const show = (look.locked || cursorMode) && G.P.mode === 'foot' && G.mode === 'play';
  xhair.hidden = !show; if (!show) return;
  xhair.style.left = cursorMode ? look.cx + 'px' : '50%'; xhair.style.top = cursorMode ? look.cy + 'px' : '50%';
  document.body.classList.toggle('cursor-aim', cursorMode);
  const spread = w.gun ? (w.name === 'SMG' ? 16 : 9) * (1 - 0.6 * look.aimT) + (G.P.speed > 0 ? 6 : 0) : 4;
  xhair.style.setProperty('--gap', spread.toFixed(1) + 'px');
  xhair.classList.toggle('melee', !w.gun);
  if (hitT > 0) { hitT -= G.dt; if (hitT <= 0) xhair.classList.remove('hit'); }
}

/* ---------- main loop ---------- */
let last = performance.now(), fpsAcc = 0, fpsN = 0;
const showFps = /[?&](debug|fps)\b/.test(location.search);
function frame(now) {
  renderer.info.reset();
  const dt = Math.min(0.05, (now - last) / 1000); last = now; G.time += dt; G.dt = dt; G.frame++;
  const P = G.P, W = G.world;
  if (W && !loading) {
    if (P.busted > 0) { P.busted -= dt; for (const k of ['up', 'down', 'left', 'right', 'fire']) K[k] = 0; if (P.busted <= 0) { $('#banner').hidden = true; clearHeat(); respawn(); } }
    if (G.mode === 'play') {
      if (P.mode !== look.lastMode) { look.yaw = P.h; look.carOff = 0; look.lastMode = P.mode; }
      look.aimT += ((look.aiming && look.locked && P.mode === 'foot' ? 1 : 0) - look.aimT) * Math.min(1, dt * 10);
      if (P.mode === 'car') { updateDriving(dt, knockDown); look.carIdle += dt; if (look.carIdle > 1.5) look.carOff *= Math.exp(-dt * 2); }
      else if (look.locked) {
        // camera-relative movement; the character faces the crosshair while aiming or shooting
        const fx = Math.sin(look.yaw), fz = Math.cos(look.yaw), mv = K.up - K.down, st = K.right - K.left;
        let dx = fx * mv - fz * st, dz = fz * mv + fx * st; const len = Math.hypot(dx, dz);
        const aimingNow = look.aiming || P.aim > 0, spd = len ? (aimingNow ? 2.6 : K.sprint ? 7.5 : 3.8) : 0;
        if (len) { dx /= len; dz /= len; }
        const nx = P.x + dx * spd * dt, nz = P.z + dz * spd * dt;
        if (!blocked(nx, nz, 0.45, null)) { P.x = nx; P.z = nz; } else if (!blocked(nx, P.z, 0.45, null)) P.x = nx; else if (!blocked(P.x, nz, 0.45, null)) P.z = nz;
        const target = aimingNow ? look.yaw : len ? Math.atan2(dx, dz) : P.h;
        P.h += wrapAng(target - P.h) * Math.min(1, dt * 14); P.speed = spd;
        placeHero(); animateHero(G.hero, spd, dt, { aim: WEAPONS[P.weapon].gun && aimingNow, punch: P.punch, weapon: WEAPONS[P.weapon].name, pitch: look.pitch + 0.08 });
      }
      else {
        const turn = K.left - K.right, mv = K.up - K.down;
        P.h += turn * 2.8 * dt; const spd = mv > 0 ? (K.sprint ? 7.5 : 3.8) : mv < 0 ? -2.2 : 0; P.speed = Math.abs(spd);
        const nx = P.x + Math.sin(P.h) * spd * dt, nz = P.z + Math.cos(P.h) * spd * dt;
        if (!blocked(nx, nz, 0.45, null)) { P.x = nx; P.z = nz; } else if (!blocked(nx, P.z, 0.45, null)) P.x = nx; else if (!blocked(P.x, nz, 0.45, null)) P.z = nz;
        placeHero(); animateHero(G.hero, Math.abs(spd), dt, { aim: WEAPONS[P.weapon].gun && P.aim > 0, punch: P.punch, weapon: WEAPONS[P.weapon].name });
      }
      P.cool -= dt; P.aim = Math.max(0, P.aim - dt); P.punch = Math.max(0, P.punch - dt);
      const w = WEAPONS[P.weapon];
      chaseTargets(); camera.position.lerp(camPos, 1 - Math.pow(look.locked && P.mode === 'foot' ? 1e-7 : P.mode === 'car' ? 0.002 : 0.0004, dt));
      if (G.shake > 0) { G.shake = Math.max(0, G.shake - dt); camera.position.x += (Math.random() - 0.5) * G.shake * 2; camera.position.y += (Math.random() - 0.5) * G.shake; }
      camera.lookAt(camLook);
      const fov = P.mode === 'car' ? 60 + Math.min(14, Math.abs(P.veh.speed) * 0.25) : 56 - 14 * look.aimT;
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 8); camera.updateProjectionMatrix(); }
      if (P.mode === 'foot' && P.busted <= 0 && P.cool <= 0 && (w.auto ? K.fire : G.fireQueued)) {
        const cursorShot = !look.locked && look.mouseShot && w.gun;
        if ((look.locked || cursorShot) && w.gun) {
          camera.updateMatrixWorld();
          if (cursorShot) { camDir.set(look.cx / canvas.clientWidth * 2 - 1, -(look.cy / canvas.clientHeight) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize(); }
          else camera.getWorldDirection(camDir);
          const tMin = Math.max(0, (P.x - camera.position.x) * camDir.x + (1.5 - camera.position.y) * camDir.y + (P.z - camera.position.z) * camDir.z) + 0.6;
          if (fireRay(w, camera.position, camDir, tMin, look.aimT > 0.5, cursorShot ? Math.asin(clamp(camDir.y, -1, 1)) + 0.1 : look.pitch + 0.08)) flashHit();
          G.shake = Math.max(G.shake, w.name === 'SMG' ? 0.05 : 0.1);
        } else { if (look.locked) P.h = look.yaw; fire(w); }
        P.cool = w.rate;
      }
      G.fireQueued = false; if (!K.fire) look.mouseShot = false;
      updateCrosshair(w);
    } else controls.update();
    updateWanted(dt); updateTraffic(dt); updatePolice(dt, bust); updateCrowd(dt); updateCombat(dt);
    for (const f of W.anim) f(G.time);
    updateBuildings(); updateLamps(dt, P.x, P.z);
    if (W.ground) W.ground.update(dt);
    // moon shadow box follows the player, snapped to texels to avoid shimmering
    if (moon.castShadow) { const step = 220 / G.q.shadows, sx = Math.round(P.x / step) * step, sz = Math.round(P.z / step) * step; moon.target.position.set(sx, 0, sz); moon.position.set(sx + MOON_DIR.x * 400, MOON_DIR.y * 400, sz + MOON_DIR.z * 400); }
  }
  updateAudio();
  const flash = updateSky(dt);
  hemi.intensity = 0.5 + flash * 4; moon.intensity = 0.45 + flash * 3;
  camera.updateMatrixWorld();
  if (W && !loading) trackAds(dt);
  render(dt);
  if (W && !loading) { drawMini(); updateHud(dt); }
  if (showFps) { fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { const el = $('#fps'); el.hidden = false; el.textContent = Math.round(fpsN / fpsAcc) + ' FPS · ' + G.q.label + ' · ' + Math.round(renderer.getPixelRatio() * 100) / 100 + 'x · ' + renderer.info.render.calls + ' draws'; fpsAcc = 0; fpsN = 0; } }
  requestAnimationFrame(frame);
}

/* ---------- boot ---------- */
(async function boot() {
  qLabel();
  G.weather.rain = store('nh-rain') !== '0';
  $('#btnWx').textContent = G.weather.rain ? 'RAIN' : 'CLEAR'; $('#btnWx').setAttribute('aria-pressed', String(G.weather.rain));
  applyShadows(); buildPipeline(); sizeMini();
  track('session_start', { w: innerWidth, h: innerHeight, dpr: window.devicePixelRatio || 1, touch: document.body.classList.contains('is-touch'), ref: document.referrer || '', webgl2: renderer.capabilities.isWebGL2, tier: G.tierKey, auto: G.autoTier });
  const startKey = DISTRICTS[store('nh-loc')] ? store('nh-loc') : 'ljz';
  await loadDistrict(startKey);
  setRain(G.weather.rain ? G.q.rain : 0);
  renderStars(false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (G.world) redrawAds(); });
  setInterval(() => track('heartbeat', { mode: G.P.mode, stars: starsOf(G.P.heat), impressions: G.stats.total }), 30000);
  if (/[?&]debug\b/.test(location.search)) window.NH = { G, THREE, setTier, loadDistrict, respawn };
  requestAnimationFrame(frame);
})();
