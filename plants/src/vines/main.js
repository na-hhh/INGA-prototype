import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { createRng } from '../sim/math.js';
import { SUPPORTS, distanceField } from './supports.js';
import { cliffWet } from './cliff.js';
import { loadSurface, surfaceMaterial } from './surface.js';
import { VineSim } from './vine.js';
import { VineView } from './view.js';
import { Air } from './air.js';
import { createPlayer } from './player.js';
import { createAbilities } from './abilities.js';
import { createIngaSmoke, smokeDefaults } from './smoke.js';
import { defaults } from './params.js';
import { AMBIANCES, Weather } from './weather.js';

const canvas = document.getElementById('scene');
const viewport = document.getElementById('viewport');
const statsEl = document.getElementById('stats');
const statusEl = document.getElementById('status');

const state = {
  support: 'Cliff',
  seed: 1,
  paused: false,
  mode: 'Follow cursor',
  colors: { stem: '#7a9a3c', wood: '#5a4630', leaf: '#31782c', leafYoung: '#b8643a', leafOld: '#d9a12c', leafDead: '#6e4a26', tendril: '#b5653c' },
  sunAzimuth: 35,
  sunElevation: 50,
  shadows: true,
  air: true, // work out how the air flows round the support and the leaves
  ambiance: 'Rain',
};
const params = defaults();

// --- Renderer and scene ---------------------------------------------------
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
camera.position.set(9, 9, 30);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 7, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
// Left button is for the vine; orbit with the right button, pan with the middle.
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

const hemi = new THREE.HemisphereLight('#dcebff', '#7f8f5a', 1.5);
const sun = new THREE.DirectionalLight('#fff3dc', 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
const shadowCam = sun.shadow.camera;
shadowCam.left = shadowCam.bottom = -22;
shadowCam.right = shadowCam.top = 22;
shadowCam.near = 1;
shadowCam.far = 140;
scene.add(hemi, sun, sun.target);
sun.target.position.set(0, 6, 0);

const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4a3b2a', roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);

const supportMaterial = new THREE.MeshStandardMaterial({ color: '#b3aa9c', roughness: 0.95 });
// Scanned concrete and metal, loaded the first time a support wants them.
const surfaces = {};
const lampMaterial = new THREE.MeshStandardMaterial({ color: '#fff2d0', emissive: '#ffd9a0', emissiveIntensity: 6 });
async function prepare(name) {
  const support = SUPPORTS[name];
  statusEl.textContent = 'Loading scanned surfaces…';
  await support.prepare?.();
  if (support.parts?.some((p) => p.material) && !surfaces.concrete) {
    const [concrete, metal] = await Promise.all([loadSurface('concrete_wall_008'), loadSurface('rusty_metal_02')]);
    surfaces.concrete = surfaceMaterial(concrete, { tile: 5, strength: 1.3 });
    surfaces.metal = surfaceMaterial(metal, { tile: 1.6, strength: 1, metal: true, tint: '#b9b2ac' });
  }
  statusEl.textContent = '';
}
let supportGroup = new THREE.Group();
scene.add(supportGroup);

// Sky, haze, light and rain (see weather.js). Wet stone and earth darken and shine.
const weather = new Weather(scene, sun, hemi, [
  { material: ground.material, wetColor: '#33271c', wetRoughness: 0.32 },
  { material: supportMaterial, wetColor: '#8b857c', wetRoughness: 0.45 },
], state.ambiance);
// The shadows are redrawn at most 45 times a second: on a fast display
// that is every other frame, and nobody can tell.
sun.shadow.autoUpdate = false;
let shadowAge = 1;

// What the vine is chasing.
const marker = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff7c2' }));
scene.add(marker);

function sunDirection() {
  const az = THREE.MathUtils.degToRad(state.sunAzimuth);
  const el = THREE.MathUtils.degToRad(state.sunElevation);
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

function updateSun() {
  const [x, y, z] = sunDirection();
  sun.position.set(x * 60, y * 60 + 6, z * 60);
  sun.castShadow = state.shadows;
  if (sim) sim.sun = [x, y, z];
}

// --- The vine -------------------------------------------------------------
let sim = null;
let view = null;
const colors = {};
function updateColors() {
  for (const [k, v] of Object.entries(state.colors)) colors[k] = new THREE.Color(v);
}

function buildSupport() {
  scene.remove(supportGroup);
  // The cliff is built once and kept; the rest are cheap to remake.
  if (!supportGroup.userData.kept) supportGroup.traverse((o) => o.geometry?.dispose());
  const support = SUPPORTS[state.support];
  if (support.build) {
    supportGroup = support.build().group;
    supportGroup.userData.kept = true;
  } else {
    supportGroup = new THREE.Group();
    for (const p of support.parts) {
      const geometry =
        p.type === 'box' ? new THREE.BoxGeometry(p.h[0] * 2, p.h[1] * 2, p.h[2] * 2)
        : p.type === 'cylinder' ? new THREE.CylinderGeometry(p.r, p.r, p.h * 2, p.r < 0.1 ? 12 : 48)
        : new THREE.SphereGeometry(p.r, 48, 32);
      if (p.axis === 'x') geometry.rotateZ(Math.PI / 2);
      else if (p.axis === 'z') geometry.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, p.glow ? lampMaterial : surfaces[p.material] ?? supportMaterial);
      mesh.position.fromArray(p.c);
      mesh.castShadow = !p.glow;
      mesh.receiveShadow = true;
      supportGroup.add(mesh);
      if (p.glow) {
        // A lamp: warm light spilling down the wall beneath it.
        const light = new THREE.PointLight('#ffd9a0', 60, 14, 1.6);
        light.position.set(p.c[0], p.c[1] - 0.25, p.c[2]);
        supportGroup.add(light);
      }
    }
  }
  scene.add(supportGroup);
  ingaSmoke?.setWorld(distanceField(support), supportGroup);
  // Frame it: the cliff and the concrete wall are far bigger than the others.
  const big = !!support.build || support.size === 'large';
  const reach = big ? 36 : 22;
  shadowCam.left = shadowCam.bottom = -reach;
  shadowCam.right = shadowCam.top = reach;
  shadowCam.updateProjectionMatrix();
  sun.shadow.mapSize.setScalar(big ? 4096 : 2048);
  sun.shadow.map?.dispose();
  sun.shadow.map = null;
  sun.target.position.set(0, big ? 11 : 6, 0);
  camera.position.set(big ? 12 : 9, big ? 11 : 9, big ? 56 : 30);
  controls.target.set(0, big ? 10 : 7, 0);
}

function reset() {
  view?.dispose(scene);
  updateColors();
  const support = SUPPORTS[state.support];
  sim = new VineSim(params, distanceField(support), createRng(state.seed));
  if (state.air) sim.air = new Air(sim.distance);
  sim.plant(...support.seeds[0]);
  sim.target = [...support.seeds[0]];
  view = new VineView(scene, sim, colors);
  updateSun();
  weather.step(0, sim);
}

// --- Pointer: the vine follows it; a click plants a new one ----------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let lastMoved = -Infinity;
let down = null;

// Where a screen point lands on the support or the ground. If it lands on
// neither, the point on that line of sight nearest to the vine's leading tip.
function aim(ndcX, ndcY) {
  pointer.set(ndcX, ndcY);
  raycaster.setFromCamera(pointer, camera);
  // Walk along the line of sight until something is met. The distance to
  // the nearest surface says how far it is safe to step each time.
  const { origin, direction } = raycaster.ray;
  for (let t = 0.5, n = 0; t < 220 && n < 400; n++) {
    const x = origin.x + direction.x * t, y = origin.y + direction.y * t, z = origin.z + direction.z * t;
    const d = sim.distance(x, y, z);
    if (d < 0.04) {
      if (Math.hypot(x, y, z) > 80) break;
      const g = sim.gradient(x, y, z);
      return new THREE.Vector3(x + g[0] * 0.12, y + g[1] * 0.12, z + g[2] * 0.12);
    }
    t += Math.max(0.03, d * 0.9);
  }
  let lead = null;
  for (const tip of sim.tips) if (tip.lead && !tip.dead) lead = tip;
  const from = lead ? new THREE.Vector3(sim.x[lead.node], sim.y[lead.node], sim.z[lead.node]) : new THREE.Vector3(0, 6, 0);
  const point = raycaster.ray.closestPointToPoint(from, new THREE.Vector3());
  point.y = Math.max(0.2, point.y);
  return point;
}

function toNdc(event) {
  const rect = canvas.getBoundingClientRect();
  return [((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1];
}

// --- The character (see player.js) and what it can do (abilities.js) --------
// P or the button walks about as the character: the mouse looks, the vine's
// lead shoot goes where the character is looking, a click uses the chosen
// ability. Escape goes back to the overview.
const player = createPlayer({ scene, camera, canvas, distance: (x, y, z) => sim.distance(x, y, z) });
const smokeSettings = smokeDefaults();
const abilities = createAbilities({ scene, camera, settings: smokeSettings });
// INGA's smoke, in a layer of its own over the picture (see smoke.js). If
// the graphics card cannot run it, the soft puffs stand in.
let ingaSmoke = null;
try {
  ingaSmoke = createIngaSmoke({ viewport, canvas, settings: smokeSettings });
  abilities.smoke = ingaSmoke;
} catch (error) {
  console.error('INGA smoke unavailable:', error);
}
function feedSmoke(dt) {
  if (!ingaSmoke) return;
  if (ingaSmoke.failed) {
    abilities.smoke = null;
    return;
  }
  const lamps = [];
  supportGroup.traverse((o) => { if (o.isPointLight) lamps.push({ x: o.position.x, y: o.position.y, z: o.position.z, range: o.distance, r: o.color.r * 6, g: o.color.g * 6, b: o.color.b * 6 }); });
  const f = player.feet, v = player.velocity;
  ingaSmoke.update(dt, camera, {
    airBalls: abilities.airBalls, gusts: abilities.gusts, balls: abilities.balls, sun: sunDirection(), lamps,
    player: player.active ? { x: f.x, y: f.y, z: f.z, vx: v.x, vy: v.y, vz: v.z, shown: player.thirdPerson } : null,
  });
}
const toolHud = document.createElement('div');
toolHud.style.cssText = 'position:absolute;bottom:52px;right:14px;display:none;gap:6px;font:10px system-ui,sans-serif;letter-spacing:.14em;color:#e4e8de;pointer-events:none';
const crosshair = document.createElement('div');
crosshair.style.cssText = 'position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;border:1px solid #fff;opacity:.7;display:none;pointer-events:none';
viewport.append(toolHud, crosshair);
function setTool(i) {
  abilities.tool = (i + abilities.tools.length) % abilities.tools.length;
  toolHud.textContent = '';
  abilities.tools.forEach((t, k) => {
    const d = document.createElement('div');
    const on = k === abilities.tool;
    d.textContent = `${k + 1} · ${t.name}`;
    d.style.cssText = `padding:7px 10px;border-radius:5px;border:1px solid #ffffff${on ? '88' : '2a'};background:${on ? '#f5f0e933' : '#10151266'};opacity:${on ? 1 : 0.6}`;
    toolHud.append(d);
  });
}
setTool(0);
const hintEl = document.getElementById('hint');
const overviewHint = hintEl.textContent;
function setPlaying(on) {
  if (on === player.active) return;
  if (on) {
    const seed = SUPPORTS[state.support].seeds[0];
    player.enter(seed[0] + 2, seed[2] + 6);
  } else player.exit();
  controls.enabled = !on;
  toolHud.style.display = on ? 'flex' : 'none';
  crosshair.style.display = on ? 'block' : 'none';
  hintEl.textContent = on ? 'WASD move · Shift run · Space jump · Mouse look · Click use · 1–3 or wheel choose · T first/third person · Esc leave' : `${overviewHint} · P to walk around`;
}
hintEl.textContent = `${overviewHint} · P to walk around`;
function useTool() {
  const id = abilities.tools[abilities.tool].id;
  player.gesture(id);
  if (id === 'air') abilities.throwAir(player.eye, player.look);
  else if (id === 'ball') abilities.throwBall(player.eye, player.look, player.velocity);
  else {
    const point = player.aim(40);
    if (sim.distance(point.x, point.y, point.z) < 0.5) sim.plant(point.x, point.y, point.z);
  }
}
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.repeat) return;
  if (e.code === 'KeyP') setPlaying(!player.active);
  if (player.active && /^Digit[1-9]$/.test(e.code)) setTool(Number(e.code.slice(5)) - 1);
});
window.addEventListener('wheel', (e) => {
  if (player.active && document.pointerLockElement === canvas) setTool(abilities.tool + (e.deltaY > 0 ? 1 : -1));
});
canvas.addEventListener('mousedown', (e) => {
  if (!player.active || e.button !== 0) return;
  if (document.pointerLockElement === canvas) useTool();
  else try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* needs a gesture */ }
});
// Escape releases the mouse (the browser does that itself): take it as leaving.
let lockedOnce = false;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) lockedOnce = true;
  else if (player.active && lockedOnce) {
    lockedOnce = false;
    setPlaying(false);
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (player.active) return;
  if (state.mode !== 'Follow cursor') return;
  const [x, y] = toNdc(event);
  sim.target = aim(x, y).toArray();
  lastMoved = performance.now();
});
canvas.addEventListener('pointerdown', (event) => {
  if (event.button === 0) down = [event.clientX, event.clientY];
});
canvas.addEventListener('pointerup', (event) => {
  if (player.active) return;
  if (event.button !== 0 || !down) return;
  const moved = Math.hypot(event.clientX - down[0], event.clientY - down[1]);
  down = null;
  if (moved > 5) return;
  const [x, y] = toNdc(event);
  const point = aim(x, y);
  if (sim.distance(point.x, point.y, point.z) < 0.5) sim.plant(point.x, point.y, point.z);
});
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

// With no cursor to chase, the target drifts around on its own.
function wanderTarget(time) {
  sim.target = aim(0.62 * Math.sin(time * 0.23), 0.08 + 0.55 * Math.sin(time * 0.37 + 1)).toArray();
}

// --- UI -------------------------------------------------------------------
const gui = new GUI({ container: document.getElementById('controls'), title: 'Controls' });
{
  const v = gui.addFolder('Vine');
  v.add(state, 'support', Object.keys(SUPPORTS)).name('Grow on').onChange(() => changeSupport());
  v.add({ walk: () => setPlaying(true) }, 'walk').name('Walk around (P)');
  v.add(state, 'mode', ['Follow cursor', 'Wander']).name('Lead shoot');
  v.add(state, 'paused').name('Pause');
  v.add({ clear: reset }, 'clear').name('Clear and replant');

  const g = gui.addFolder('Growth');
  g.add(params, 'speed', 1, 40, 0.5).name('Speed');
  g.add(params, 'sideSpeed', 0.05, 1, 0.05).name('Side shoot speed');
  g.add(params, 'follow', 0, 2, 0.05).name('Follow strength');
  g.add(params, 'climb', 0, 1, 0.01).name('Climb to light');
  g.add(params, 'wander', 0, 1, 0.01).name('Wander');
  g.add(params, 'cling', 0, 2, 0.05).name('Cling');
  g.add(params, 'branching', 0, 0.4, 0.005).name('Branching');
  g.add(params, 'branchAngle', 5, 120, 1).name('Branch angle');
  g.add(params, 'branchLife', 5, 300, 1).name('Side shoot length');
  g.add(params, 'maxTips', 1, 150, 1).name('Growing tips');
  g.add(params, 'maxHang', 0.5, 20, 0.5).name('Reach into air');
  g.add(params, 'activeRadius', 1, 30, 0.5).name('Branch near lead');

  const t = gui.addFolder('Twining');
  t.add(params, 'twining', ['Mixed', 'Clockwise', 'Counter-clockwise']).name('Direction');
  t.add(params, 'twine', 0, 2, 0.05).name('Winds around');
  t.add(params, 'nutation', 0, 1, 0.01).name('Circling in air');
  t.add(params, 'tendrilDensity', 0, 0.6, 0.01).name('Tendrils');
  t.add(params, 'tendrilLength', 0.3, 4, 0.05).name('Tendril length');

  const l = gui.addFolder('Leaves');
  l.add(params, 'leafDensity', 0, 1, 0.01).name('Density');
  l.add(params, 'leafSize', 0.2, 3, 0.05).name('Size');
  l.add(params, 'leafLife', 0, 600, 5).name('Lifetime (s)');
  l.add(params, 'evergreen', 0, 1, 0.01).name('Never die of age');
  l.add(params, 'detachWind', 0, 6, 0.05).name('Gust to detach');
  l.add(params, 'leafOverlap', 0, 6, 1).name('Allowed overlap');
  l.add(params, 'leafPush', 0, 3, 0.05).name('Push apart');
  l.add(params, 'leafShare', 0, 3, 0.05).name('Sway together');
  l.add(params, 'clipPatience', 0, 120, 1).name('Clipping tolerated (s)');
  l.add(params, 'leafGrowTime', 5, 180, 1).name('Time to grow (s)');
  l.add(params, 'lightNeed', 0, 1, 0.01).name('Light needed');
  l.add(params, 'shadePatience', 1, 120, 1).name('Survives shade (s)');
  l.add(params, 'translucency', 0, 3, 0.05).name('Translucency');
  l.add(params, 'lobes', 1, 9, 2).name('Lobes').onFinishChange(() => view.setLeafShape());
  l.add(params, 'lobeDepth', 0, 0.8, 0.01).name('Lobe depth').onFinishChange(() => view.setLeafShape());
  l.add(params, 'teeth', 0, 0.2, 0.005).name('Teeth').onFinishChange(() => view.setLeafShape());

  const p = gui.addFolder('Physics');
  p.add(params, 'stemWidth', 0.03, 0.4, 0.005).name('Stem width');
  p.add(params, 'stiffness', 0, 1, 0.01).name('Stiffness');
  p.add(params, 'damping', 0.8, 1, 0.005).name('Keeps swinging');
  p.add(params, 'stick', 0, 10, 0.1).name('Takes hold');
  p.add(params, 'gravity', 0, 3, 0.05).name('Gravity');
  p.add(params, 'wind', 0, 6, 0.1).name('Wind');
  p.add(params, 'windDirection', 0, 360, 1).name('Wind direction');

  // INGA's smoke, with INGA's settings.
  const k = gui.addFolder('Smoke').close();
  const S = smokeSettings;
  k.add(S, 'on').name('Show smoke');
  k.add(S, 'gain', 1, 60, 0.5).name('Opacity');
  k.add(S, 'lum', 0, 2, 0.01).name('Brightness in shade');
  k.add(S, 'weight', -6, 12, 0.1).name('Weight (sinks / rises)');
  k.add(S, 'swirl', 0, 10, 0.1).name('Swirl');
  k.add(S, 'dissip', 0, 1, 0.005).name('Fades away');
  k.add(S, 'visc', 0, 1, 0.005).name('Thickness of the air');
  k.add(S, 'turb', 0, 3, 0.05).name('Fine turbulence');
  k.add(S, 'airSize', 0.3, 4, 0.05).name('Ball size');
  k.add(S, 'airSpeed', 2, 45, 0.5).name('Ball speed');
  k.add(S, 'airAccel', 0.02, 2, 0.01).name('Ball gets up to speed (s)');
  k.add(S, 'airSmoke', 0, 4, 0.05).name('Smoke in the ball');
  k.add(S, 'airCloud', 0.3, 1.6, 0.05).name('Cloud size in the ball');
  k.add(S, 'body', 0, 3, 0.05).name('Character stirs it');
  k.add(S, 'res', [96, 128, 192, 256]).name('Grid');
  k.add(S, 'simHz', [10, 20, 30, 60]).name('Steps per second');
  k.add(S, 'march', 0.5, 3, 0.25).name('Ray-march fineness');
  k.add(S, 'full').name('Full-resolution rays');
  k.add(S, 'focus').name('Finer cells near you');
  k.add({ clear: () => ingaSmoke?.clear() }, 'clear').name('Clear the smoke');

  const c = gui.addFolder('Colours').close();
  c.addColor(state.colors, 'stem').name('Young stem').onChange(updateColors);
  c.addColor(state.colors, 'wood').name('Old stem').onChange(updateColors);
  c.addColor(state.colors, 'leafYoung').name('New leaf').onChange(updateColors);
  c.addColor(state.colors, 'leaf').name('Leaf').onChange(updateColors);
  c.addColor(state.colors, 'leafOld').name('Turning leaf').onChange(updateColors);
  c.addColor(state.colors, 'leafDead').name('Fallen leaf').onChange(updateColors);
  c.addColor(state.colors, 'tendril').name('Tendril').onChange(updateColors);

  const w = gui.addFolder('Weather');
  w.add(state, 'ambiance', Object.keys(AMBIANCES)).name('Ambiance').onChange((name) => weather.set(name));
  w.add(weather.goal, 'rain', 0, 1, 0.01).name('Rain').listen();
  w.add(weather.goal, 'wind', 0, 4, 0.05).name('Wind strength ×').listen();
  w.add(weather.goal, 'gusts', 0, 1.5, 0.05).name('Gustiness').listen();
  w.add(state, 'air').name('Air flows round things').onChange((on) => (sim.air = on ? new Air(sim.distance) : null));
  w.add(weather.goal, 'fog', 0, 0.04, 0.0005).name('Fog').listen();

  const s = gui.addFolder('Light').close();
  s.add(state, 'sunAzimuth', 0, 360, 1).name('Sun direction').onChange(updateSun);
  s.add(state, 'sunElevation', 5, 90, 1).name('Sun height').onChange(updateSun);
  s.add(state, 'shadows').name('Shadows').onChange(updateSun);
}

// --- Resize and loop ------------------------------------------------------
function resize() {
  const { clientWidth: w, clientHeight: h } = viewport;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

// Switches to the support named in state.support, loading what it needs. If
// its scans are missing (see scripts/fetch-assets.mjs) the plain wall stands in.
async function changeSupport() {
  try {
    await prepare(state.support);
  } catch (error) {
    console.error(error);
    state.support = 'Wall';
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    missing = 'Scanned assets not found: run “node scripts/fetch-assets.mjs”. Showing the plain wall.';
  }
  buildSupport();
  reset();
}
let missing = '';
await changeSupport();

const clock = new THREE.Clock();
let frames = 0, fpsTime = 0, simMs = 0;
function advance(dt) {
  if (player.active) {
    // The lead shoot goes where the character is looking.
    sim.target = player.aim().toArray();
    lastMoved = performance.now();
  } else if (state.mode === 'Wander' || performance.now() - lastMoved > 6000) wanderTarget(sim.time);
  weather.step(dt, sim);
  sim.update(dt);
}
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  player.update(dt);
  if (!state.paused) abilities.update(dt, sim);
  if (!state.paused) {
    const t0 = performance.now();
    advance(dt);
    view.update();
    simMs += performance.now() - t0;
  }
  else weather.step(dt, null); // the sky still changes while the vine is paused
  weather.draw(dt, sim, player.active ? player.feet : controls.target);
  cliffWet.value = weather.wet;
  for (const m of Object.values(surfaces)) m.userData.wet.value = weather.wet;
  shadowAge += dt;
  if (shadowAge >= 1 / 45) {
    shadowAge = 0;
    sun.shadow.needsUpdate = true;
  }
  view.translucency.value = params.translucency;
  marker.position.fromArray(sim.target);
  marker.scale.setScalar(1 + 0.25 * Math.sin(clock.elapsedTime * 4));
  if (!player.active) controls.update();
  camera.updateMatrixWorld();
  renderer.render(scene, camera);
  feedSmoke(state.paused ? 0 : dt);

  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    const s = sim.stats;
    statsEl.innerHTML = [
      ['Stem nodes', s.nodes.toLocaleString()],
      ['Growing tips', s.tips],
      ['Hanging free', s.hanging.toLocaleString()],
      ['Leaves', s.leaves.toLocaleString()],
      ['Leaves short of light', s.shaded.toLocaleString()],
      ['Dead leaves hanging on', s.withered.toLocaleString()],
      ['Leaves clipping now', s.clipping.toLocaleString()],
      ['Tendrils gripping', `${s.gripping} / ${s.tendrils}`],
      ['Simulation', `${(simMs / frames).toFixed(1)} ms`],
      ['Frame rate', `${Math.round(frames / fpsTime)} fps`],
    ]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
      .join('');
    statusEl.textContent = sim.full ? 'The vine is fully grown — press “Clear and replant”' : missing;
    frames = 0;
    fpsTime = 0;
    simMs = 0;
  }
});
document.getElementById('backend').textContent = backend;

// Handy for poking at things from the browser console.
window.app = {
  state,
  params,
  camera,
  controls,
  get sim() { return sim; },
  get view() { return view; },
  renderer,
  weather,
  reset,
  buildSupport,
  changeSupport,
  player,
  abilities,
  setPlaying,
  get ingaSmoke() { return ingaSmoke; },
  smokeSettings,
  useTool,
  // Runs the simulation ahead without drawing.
  skip(seconds) {
    for (let t = 0; t < seconds; t += 1 / 30) advance(1 / 30);
    view.update();
  },
};
