import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { createRng } from '../sim/math.js';
import { parse, derive } from './lsystem.js';
import { buildPlant } from './turtle.js';
import { PRESETS } from './presets.js';

const canvas = document.getElementById('scene');
const viewport = document.getElementById('viewport');
const statsEl = document.getElementById('stats');
const sourceEl = document.getElementById('source');
const errorEl = document.getElementById('error');

// --- State ----------------------------------------------------------------
const state = {
  preset: 'Fern',
  seed: 1,
  iterations: PRESETS.Fern.iterations,
  age: PRESETS.Fern.iterations + 10,
  growing: false,
  copies: 1,
  spread: 14,
  colors: { ...PRESETS.Fern.colors },
  environment: { light: 1, water: 1, nutrients: 1, gravity: 1, wind: 0, windDirection: 0, sunAzimuth: 40, sunElevation: 55 },
  view: { shadows: true, ground: true, autoRotate: false, wireframe: false },
};
const ENV_NAMES = ['light', 'water', 'nutrients', 'vigor'];
let system = null; // the parsed grammar
let constants = {}; // current constant values, by name
let derived = []; // one derivation per copy

// --- Renderer and scene ---------------------------------------------------
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#b9d4e8');
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
camera.position.set(34, 22, 40);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 8, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.02;

// The ground light is kept green and fairly bright: it stands in for the
// light that really passes through thin leaves and lights their undersides.
const hemi = new THREE.HemisphereLight('#dcebff', '#7f8f5a', 1.1);
const sun = new THREE.DirectionalLight('#fff3dc', 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.05;
scene.add(hemi, sun, sun.target);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(120, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: '#4a3b2a', roughness: 1 }),
);
ground.receiveShadow = true;
scene.add(ground);

const stemMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
const leafMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
const stemMesh = new THREE.Mesh(new THREE.BufferGeometry(), stemMaterial);
const leafMesh = new THREE.Mesh(new THREE.BufferGeometry(), leafMaterial);
for (const mesh of [stemMesh, leafMesh]) {
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
}
const plant = new THREE.Group();
plant.name = 'plant';
plant.add(stemMesh, leafMesh);
scene.add(plant);

// --- Building the plant ---------------------------------------------------
const linear = (hex) => new THREE.Color(hex).toArray();
let lastBuild = { ms: 0, modules: 0, segments: 0, leaves: 0, flowers: 0, triangles: 0, truncated: false };
let size = 20;

function sunDirection() {
  const e = state.environment;
  const az = THREE.MathUtils.degToRad(e.sunAzimuth);
  const el = THREE.MathUtils.degToRad(e.sunElevation);
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

// Rewrites the grammar. Needed when the rules, constants, seed or the
// growing conditions change.
function rederive() {
  if (!system) return;
  const e = state.environment;
  const vigor = Math.max(0, Math.min(1.5, e.light, e.water, e.nutrients));
  const values = [...system.constants.map((c) => constants[c.name]), e.light, e.water, e.nutrients, vigor];
  derived = [];
  try {
    for (let i = 0; i < state.copies; i++) derived.push(derive(system, values, state.iterations, state.seed + i * 101));
    errorEl.textContent = '';
  } catch (err) {
    errorEl.textContent = `While growing: ${err.message}`;
    derived = [];
  }
  rebuild();
}

// Turns the current generation into meshes. Needed when only the age, the
// colours or the physical forces change.
function rebuild() {
  if (!derived.length) return;
  const t0 = performance.now();
  const e = state.environment;
  const wind = THREE.MathUtils.degToRad(e.windDirection);
  // Hungry leaves go pale and yellow.
  const hunger = Math.max(0, 1 - e.nutrients);
  const pale = (hex) => new THREE.Color(hex).lerp(new THREE.Color('#c9c04a'), hunger * 0.7).toArray();
  const opts = {
    colors: {
      stem: linear(state.colors.stem),
      wood: linear(state.colors.wood),
      leaf: pale(state.colors.leaf),
      leafTip: pale(state.colors.leafTip),
      flower: linear(state.colors.flower),
      flowerCenter: linear(state.colors.flowerCenter),
    },
    constants,
    env: { gravity: e.gravity, water: e.water, nutrients: e.nutrients, wind: e.wind, windX: Math.sin(wind), windZ: Math.cos(wind), sun: sunDirection() },
  };
  let out = null;
  const totals = { modules: 0, segments: 0, leaves: 0, flowers: 0, truncated: false };
  derived.forEach((d, i) => {
    const gen = d.generations[Math.min(d.generations.length - 1, Math.max(0, Math.ceil(state.age)))];
    // Copies are laid out on a sunflower spiral.
    const r = i === 0 ? 0 : state.spread * Math.sqrt(i);
    const a = i * 2.39996;
    out = buildPlant(gen, state.age, { ...opts, origin: [r * Math.cos(a), 0, r * Math.sin(a)], rng: createRng(state.seed * 7919 + i) }, out);
    totals.modules += gen.s.length;
    totals.segments += out.stats.segments;
    totals.leaves += out.stats.leaves;
    totals.flowers += out.stats.flowers;
    totals.truncated ||= d.truncated;
  });
  let triangles = 0;
  for (const [mesh, builder] of [[stemMesh, out.stems], [leafMesh, out.leaves]]) {
    const data = builder.done();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(data.color, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
    geometry.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    triangles += data.index.length / 3;
  }
  const bounds = new THREE.Box3().setFromObject(plant);
  size = bounds.isEmpty() ? 10 : Math.max(4, bounds.getSize(new THREE.Vector3()).length());
  lastBuild = { ...totals, triangles, ms: performance.now() - t0 };
  updateLights();
  updateStats();
}

function updateLights() {
  const [x, y, z] = sunDirection();
  const reach = size * 0.75 + 4;
  sun.position.set(x * reach * 3, y * reach * 3, z * reach * 3);
  sun.target.position.set(0, size * 0.25, 0);
  sun.intensity = 3 * state.environment.light;
  hemi.intensity = 0.9 + 0.8 * Math.min(1, state.environment.light);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -reach;
  cam.right = cam.top = reach;
  cam.near = 0.5;
  cam.far = reach * 6;
  cam.updateProjectionMatrix();
  sun.castShadow = state.view.shadows;
  ground.visible = state.view.ground;
  stemMaterial.wireframe = leafMaterial.wireframe = state.view.wireframe;
  controls.autoRotate = state.view.autoRotate;
}

function frame() {
  const bounds = new THREE.Box3().setFromObject(plant);
  if (bounds.isEmpty()) return;
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(3, bounds.getSize(new THREE.Vector3()).length() / 2);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.95;
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(centre);
  camera.position.copy(centre).addScaledVector(dir, distance);
}

function updateStats() {
  const b = lastBuild;
  statsEl.innerHTML = [
    ['Modules', b.modules.toLocaleString()],
    ['Stem segments', b.segments.toLocaleString()],
    ['Leaves', b.leaves.toLocaleString()],
    ['Flowers', b.flowers.toLocaleString()],
    ['Triangles', b.triangles.toLocaleString()],
    ['Build', `${b.ms.toFixed(0)} ms`],
  ]
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
    .join('');
  if (b.truncated) errorEl.textContent = 'The plant got too large and was cut short: lower the iterations.';
}

// --- Grammar --------------------------------------------------------------
function applySource(keepValues) {
  try {
    const parsed = parse(sourceEl.value);
    const clash = parsed.constants.find((c) => ENV_NAMES.includes(c.name));
    if (clash) throw new Error(`"${clash.name}" is set by the environment and cannot be redefined`);
    // The environment is passed to every rule as four extra constants.
    const names = [...parsed.constants.map((c) => c.name), ...ENV_NAMES];
    system = parse(`${sourceEl.value}\n${ENV_NAMES.map((n) => `${n} = 1`).join('\n')}`);
    system.constants = system.constants.slice(0, names.length - ENV_NAMES.length);
    const previous = constants;
    constants = {};
    for (const c of system.constants) constants[c.name] = keepValues && c.name in previous ? previous[c.name] : c.value;
    errorEl.textContent = '';
  } catch (err) {
    errorEl.textContent = err.message;
    return;
  }
  buildUI();
  rederive();
}

function loadPreset(name) {
  const preset = PRESETS[name];
  sourceEl.value = preset.source;
  state.iterations = preset.iterations;
  state.age = preset.iterations + 10;
  Object.assign(state.colors, preset.colors);
  applySource(false);
  frame();
}

async function exportGlb() {
  const buffer = await new GLTFExporter().parseAsync(plant, { binary: true });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
  link.download = `${state.preset.toLowerCase()}-${state.seed}.glb`;
  link.click();
  URL.revokeObjectURL(link.href);
  return buffer.byteLength;
}

// --- UI -------------------------------------------------------------------
let gui;
function buildUI() {
  const open = gui ? Object.fromEntries(gui.folders.map((f) => [f._title, !f._closed])) : {};
  gui?.destroy();
  gui = new GUI({ container: document.getElementById('controls'), title: 'Controls' });

  const p = gui.addFolder('Plant');
  p.add(state, 'preset', Object.keys(PRESETS)).name('Start from').onChange(loadPreset);
  p.add(state, 'seed', 1, 999, 1).name('Seed').onChange(rederive);
  p.add(state, 'iterations', 1, 80, 1).name('Iterations').onChange(() => {
    ageControl.max(state.iterations + 12);
    rederive();
  });
  const ageControl = p.add(state, 'age', 0, state.iterations + 12, 0.05).name('Age').onChange(rebuild).listen();
  p.add(state, 'growing').name('Play growth').onChange((on) => {
    if (on && state.age >= state.iterations + 12) state.age = 0;
  }).listen();
  p.add(state, 'copies', 1, 12, 1).name('Copies').onChange(rederive);
  p.add(state, 'spread', 2, 40, 0.5).name('Spacing').onChange(rebuild);

  const e = gui.addFolder('Environment');
  e.add(state.environment, 'light', 0, 1.5, 0.05).name('Light').onChange(rederive);
  e.add(state.environment, 'water', 0, 1.5, 0.05).name('Water').onChange(rederive);
  e.add(state.environment, 'nutrients', 0, 1.5, 0.05).name('Nutrients').onChange(rederive);
  e.add(state.environment, 'gravity', 0, 4, 0.05).name('Gravity').onChange(rebuild);
  e.add(state.environment, 'wind', 0, 10, 0.1).name('Wind').onChange(rebuild);
  e.add(state.environment, 'windDirection', 0, 360, 1).name('Wind direction').onChange(rebuild);
  e.add(state.environment, 'sunAzimuth', 0, 360, 1).name('Sun direction').onChange(rebuild);
  e.add(state.environment, 'sunElevation', 5, 90, 1).name('Sun height').onChange(rebuild);

  const g = gui.addFolder('Genes');
  for (const c of system?.constants ?? []) {
    const step = Number.isInteger(c.value) && c.max - c.min >= 8 ? 1 : (c.max - c.min) / 200;
    g.add(constants, c.name, c.min, c.max, step).onChange(rederive);
  }

  const col = gui.addFolder('Colours');
  col.addColor(state.colors, 'stem').name('Young stem').onChange(rebuild);
  col.addColor(state.colors, 'wood').name('Old stem').onChange(rebuild);
  col.addColor(state.colors, 'leaf').name('Leaf').onChange(rebuild);
  col.addColor(state.colors, 'leafTip').name('Leaf tip').onChange(rebuild);
  col.addColor(state.colors, 'flower').name('Petal').onChange(rebuild);
  col.addColor(state.colors, 'flowerCenter').name('Petal base').onChange(rebuild);

  const v = gui.addFolder('View');
  v.add(state.view, 'shadows').name('Shadows').onChange(updateLights);
  v.add(state.view, 'ground').name('Ground').onChange(updateLights);
  v.add(state.view, 'wireframe').name('Wireframe').onChange(updateLights);
  v.add(state.view, 'autoRotate').name('Auto-rotate').onChange(updateLights);
  v.add({ frame }, 'frame').name('Frame plant');
  v.add({ exportGlb }, 'exportGlb').name('Export .glb');

  for (const folder of gui.folders) if (open[folder._title] === false) folder.close();
  if (!('Colours' in open)) col.close();
}

document.getElementById('apply').addEventListener('click', () => applySource(true));
sourceEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) applySource(true);
});

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

loadPreset(state.preset);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (state.growing) {
    state.age = Math.min(state.iterations + 12, state.age + dt * 4);
    if (state.age >= state.iterations + 12) state.growing = false;
    rebuild();
  }
  controls.update();
  renderer.render(scene, camera);
});
document.getElementById('backend').textContent = backend;

// Handy for poking at things from the browser console.
window.app = { state, rederive, rebuild, frame, exportGlb, loadPreset, get build() { return lastBuild; } };
