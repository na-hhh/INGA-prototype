import * as THREE from 'three/webgpu';
import { color, float, uniform } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { createRng } from '../sim/math.js';
import { bladeMesh, leafTextures, lobeAxes, noise } from '../vines/leaf.js';
import { DryLeaf, dryDefaults, dryingStages } from './dry.js';

// One leaf, drying. See dry.js for how it works; this file draws it.

const canvas = document.getElementById('scene');
const viewport = document.getElementById('viewport');
const statsEl = document.getElementById('stats');
const statusEl = document.getElementById('status');

const DETAIL = { Coarse: { rim: 144, rings: 9, fill: 1 }, Medium: { rim: 216, rings: 15, fill: 1 }, Fine: { rim: 288, rings: 22, fill: 1 } };
const EXTENT = 1.15; // as in leaf.js: the blade's texture covers this far each way

const state = {
  variant: 1,
  lobes: 5,
  lobeDepth: 0.45,
  teeth: 0.075,
  detail: 'Medium',
  speed: 2, // simulation steps per frame
  paused: false,
  show: 'Leaf',
  wire: false,
  relief: 1.6,
  colors: { fresh: '#2f7a2c', turning: '#b99a2e', dry: '#7d5a33', under: '#9db57a' },
};
const params = dryDefaults();

// --- Scene ----------------------------------------------------------------
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color('#aab6bd');
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
camera.position.set(-0.4, 2.3, 2.6);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0.1, 0.1, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight('#e6efff', '#6d6a5c', 1.3));
const sun = new THREE.DirectionalLight('#fff1dd', 3.2);
sun.position.set(2.5, 5, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.01;
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 12 });
scene.add(sun);

const table = new THREE.Mesh(new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8f8676', roughness: 0.9 }));
table.receiveShadow = true;
scene.add(table);

// The two faces of the blade are drawn separately: the upper one darker with
// its veins sunk in, the lower one paler with its veins standing out.
const translucency = uniform(1);
const face = (flip) => {
  const m = new THREE.MeshSSSNodeMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
  m.thicknessColorNode = color('#8fc02f').mul(translucency);
  m.thicknessDistortionNode = float(0.35);
  m.thicknessAmbientNode = float(0.04);
  m.thicknessAttenuationNode = float(0.55);
  m.thicknessPowerNode = float(2.5);
  m.thicknessScaleNode = float(2.5);
  m.userData.flip = flip;
  return m;
};
const upper = face(1), lower = face(-1);
const stalkMaterial = new THREE.MeshStandardMaterial({ color: '#7d6a3a', roughness: 0.7 });

let leaf = null; // the simulation
let mesh = null; // what is drawn
let stalk = null;
let textures = null;
let axes = null;
let stepMs = 0;

function shape() {
  axes = lobeAxes(state.lobes, createRng(4242 + Math.round(state.lobes) * 97 + state.variant * 13));
  return bladeMesh(state, axes, state.variant, DETAIL[state.detail]);
}

function build() {
  const blade = shape();
  leaf = new DryLeaf(blade, axes, state.variant, params);
  const N = blade.count;
  if (mesh) {
    scene.remove(mesh, stalk);
    mesh.geometry.dispose();
    stalk.geometry.dispose();
    for (const t of [textures.map, textures.normalMap, textures.frontMap]) t.dispose();
  }
  textures = leafTextures(axes, state.lobeDepth, state.variant, 1024);
  for (const m of [upper, lower]) {
    m.map = textures.map;
    m.normalMap = textures.normalMap;
    m.needsUpdate = true;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const uv = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    uv[i * 2] = uv[(N + i) * 2] = (blade.x[i] + EXTENT) / (2 * EXTENT);
    uv[i * 2 + 1] = uv[(N + i) * 2 + 1] = (blade.z[i] + EXTENT) / (2 * EXTENT);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Upper face, lower face (turned over), and a strip round the edge.
  const tris = blade.tris;
  const index = [];
  for (let t = 0; t < tris.length; t++) index.push(tris[t]);
  const upperCount = index.length;
  const used = new Map();
  for (let t = 0; t < tris.length; t += 3) {
    index.push(N + tris[t], N + tris[t + 2], N + tris[t + 1]);
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k], b = tris[t + ((k + 1) % 3)];
      const key = Math.min(a, b) * N + Math.max(a, b);
      used.set(key, used.has(key) ? null : [a, b]);
    }
  }
  const lowerCount = index.length - upperCount;
  for (const edge of used.values()) {
    if (!edge) continue;
    const [a, b] = edge;
    index.push(a, N + a, b, b, N + a, N + b);
  }
  geometry.setIndex(index);
  geometry.addGroup(0, upperCount, 0);
  geometry.addGroup(upperCount, lowerCount, 1);
  geometry.addGroup(upperCount + lowerCount, index.length - upperCount - lowerCount, 0);
  mesh = new THREE.Mesh(geometry, [upper, lower]);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  // The stalk: it comes in along -x and meets the blade at the joint.
  const path = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.75, -0.1, 0), new THREE.Vector3(-0.4, -0.03, 0), new THREE.Vector3(0.02, 0, 0)]);
  stalk = new THREE.Mesh(new THREE.TubeGeometry(path, 12, 0.02, 6), stalkMaterial);
  stalk.castShadow = true;
  scene.add(mesh, stalk);
  place();
  draw();
}

// Where the leaf sits: held up by its stalk, or lying on the table.
function place() {
  const held = params.hold === 'Stalk';
  const lift = held ? 0.75 : -leaf.floor + 0.002;
  mesh.position.y = stalk.position.y = lift;
  stalk.visible = held;
  controls.target.set(0.1, lift, 0);
}

const tmp = new THREE.Color();
function draw() {
  const N = leaf.n;
  const g = mesh.geometry;
  g.attributes.position.array.set(leaf.pos);
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
  const C = g.attributes.color.array;
  const fresh = tmp.set(state.colors.fresh).clone(), turning = tmp.set(state.colors.turning).clone(), dry = tmp.set(state.colors.dry).clone(), under = tmp.set(state.colors.under).clone();
  for (let i = 0; i < N; i++) {
    const d = leaf.dry[i];
    if (state.show === 'Water') {
      const w = leaf.water[i];
      tmp.setRGB(0.95 - 0.8 * w, 0.85 - 0.45 * w, 0.55 + 0.4 * w);
    } else if (state.show === 'Veins') {
      tmp.setRGB(0.25 + 0.75 * leaf.vein[i], 0.35, 0.3);
    } else {
      // Green, then yellowing, then brown, with the odd darker patch.
      if (d < 0.45) tmp.copy(fresh).lerp(turning, d / 0.45);
      else tmp.copy(turning).lerp(dry, Math.min(1, (d - 0.45) / 0.45));
      tmp.multiplyScalar(1 - 0.3 * d * noise(leaf.mesh.x[i] * 9, leaf.mesh.z[i] * 9 + 4));
    }
    C[i * 3] = tmp.r; C[i * 3 + 1] = tmp.g; C[i * 3 + 2] = tmp.b;
    // The underside is paler while the leaf is alive.
    if (state.show === 'Leaf') tmp.lerp(under, 0.55 * (1 - d));
    C[(N + i) * 3] = tmp.r; C[(N + i) * 3 + 1] = tmp.g; C[(N + i) * 3 + 2] = tmp.b;
  }
  g.attributes.color.needsUpdate = true;
  // Veins stand out more as the tissue between them shrinks away, and a dry
  // leaf lets less light through.
  const dryness = leaf.dryness ?? 0;
  const relief = state.relief * (1 + 0.8 * dryness);
  upper.normalScale.set(relief, relief);
  lower.normalScale.set(-relief * 0.8, -relief * 0.8);
  translucency.value = 1 - 0.75 * dryness;
  upper.roughness = lower.roughness = 0.5 + 0.45 * dryness; // a dry leaf is matt
  upper.wireframe = lower.wireframe = state.wire;
}

// --- Export ---------------------------------------------------------------
function save(object, name) {
  new GLTFExporter().parse(
    object,
    (buffer) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    (error) => (statusEl.textContent = `Export failed: ${error.message ?? error}`),
    { binary: true },
  );
}

// A plain one-sided mesh of the blade in a given shape.
function plainMesh(blade, position, normal) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(position), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(normal), 3));
  const uv = new Float32Array(blade.count * 2);
  for (let i = 0; i < blade.count; i++) {
    uv[i * 2] = (blade.x[i] + EXTENT) / (2 * EXTENT);
    uv[i * 2 + 1] = (blade.z[i] + EXTENT) / (2 * EXTENT);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(blade.tris, 1));
  return geometry;
}

const actions = {
  fresh() {
    leaf.reset();
    draw();
  },
  dryOut() {
    params.humidity = 0;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  },
  rain() {
    params.humidity = 1;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  },
  // The leaf exactly as it is now.
  exportNow() {
    const m = new THREE.Mesh(plainMesh(leaf.mesh, leaf.mid(), leaf.surfaceNormals(leaf.mid(), 0)), new THREE.MeshStandardMaterial({ color: '#5d7d3a', side: THREE.DoubleSide }));
    m.name = 'leaf';
    save(m, 'leaf.glb');
  },
  // One mesh that can be blended from fresh to crisp: the fresh leaf with
  // four morph targets, each a stage further dried.
  exportStages() {
    statusEl.textContent = 'Drying a copy of this leaf…';
    setTimeout(() => {
      const blade = shape();
      const run = dryingStages(blade, axes, state.variant, 4, { ...params, humidity: 0, supply: 0, gravity: 0, rate: 0.6 });
      let result;
      while (!(result = run.next()).done);
      const frames = result.value;
      const geometry = plainMesh(blade, frames[0].position, frames[0].normal);
      geometry.morphAttributes.position = frames.slice(1).map((f) => new THREE.BufferAttribute(f.position, 3));
      geometry.morphAttributes.normal = frames.slice(1).map((f) => new THREE.BufferAttribute(f.normal, 3));
      const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#5d7d3a', side: THREE.DoubleSide }));
      m.name = 'leaf-drying';
      m.morphTargetDictionary = { dry25: 0, dry50: 1, dry75: 2, dry100: 3 };
      m.morphTargetInfluences = [0, 0, 0, 0];
      save(m, 'leaf-drying.glb');
      statusEl.textContent = '';
    }, 30);
  },
};

// --- UI -------------------------------------------------------------------
const gui = new GUI({ container: document.getElementById('controls'), title: 'Controls' });
{
  const a = gui.addFolder('Air');
  a.add(params, 'humidity', 0, 1, 0.01).name('Air humidity');
  a.add(params, 'rate', 0.02, 1, 0.01).name('Drying speed');
  a.add(params, 'supply', 0, 1, 0.01).name('Water from stalk');
  a.add(actions, 'dryOut').name('Dry air');
  a.add(actions, 'rain').name('Rain');
  a.add(actions, 'fresh').name('Start again with a fresh leaf');
  a.add(state, 'speed', 1, 8, 1).name('Time speed');
  a.add(state, 'paused').name('Pause');

  const t = gui.addFolder('Tissue');
  t.add(params, 'shrink', 0, 0.6, 0.01).name('Tissue shrinks');
  t.add(params, 'veinShrink', 0, 0.3, 0.005).name('Veins shrink');
  t.add(params, 'curl', -1, 1, 0.01).name('Curls up / under');
  t.add(params, 'recover', 0, 1, 0.01).name('Recovers when wet');
  t.add(params, 'unevenness', 0, 1, 0.01).name('Patchiness');
  t.add(params, 'thickness', 0.015, 0.08, 0.001).name('Thickness').onFinishChange(() => actions.fresh());
  t.add(params, 'gravity', 0, 2, 0.01).name('Gravity');
  t.add(params, 'collide').name('Cannot pass through itself');
  t.add(params, 'hold', ['Stalk', 'Table']).name('Held by').onChange(() => {
    leaf.reset();
    place();
  });

  const l = gui.addFolder('Leaf');
  l.add(state, 'variant', 1, 20, 1).name('Variant').onFinishChange(build);
  l.add(state, 'lobes', 1, 9, 2).name('Lobes').onFinishChange(build);
  l.add(state, 'lobeDepth', 0, 0.8, 0.01).name('Lobe depth').onFinishChange(build);
  l.add(state, 'teeth', 0, 0.2, 0.005).name('Teeth').onFinishChange(build);
  l.add(state, 'detail', Object.keys(DETAIL)).name('Mesh detail').onChange(build);

  const v = gui.addFolder('Look');
  v.add(state, 'show', ['Leaf', 'Water', 'Veins']).name('Show');
  v.add(state, 'relief', 0, 4, 0.05).name('Surface relief');
  v.add(state, 'wire').name('Wireframe');

  const e = gui.addFolder('Export');
  e.add(actions, 'exportNow').name('This shape (.glb)');
  e.add(actions, 'exportStages').name('Fresh to dry, as morphs (.glb)');
}

// --- Loop -----------------------------------------------------------------
function resize() {
  const { clientWidth: w, clientHeight: h } = viewport;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();
build();

let frames = 0, since = performance.now();
renderer.setAnimationLoop(() => {
  if (!state.paused) {
    const t0 = performance.now();
    for (let k = 0; k < state.speed; k++) leaf.step();
    stepMs += (performance.now() - t0) / state.speed;
    draw();
  }
  controls.update();
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - since > 500) {
    let water = 0;
    for (let i = 0; i < leaf.n; i++) water += leaf.water[i];
    statsEl.innerHTML = [
      ['Water left', `${Math.round((100 * water) / leaf.n)} %`],
      ['Shrunk', `${Math.round(100 * (leaf.dryness ?? 0))} %`],
      ['Points', (leaf.n * 2).toLocaleString()],
      ['Links', (leaf.edges * 4 + leaf.n).toLocaleString()],
      ['One step', `${(stepMs / Math.max(1, frames)).toFixed(1)} ms`],
      ['Frame rate', `${Math.round((frames * 1000) / (now - since))} fps`],
    ]
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
      .join('');
    frames = 0;
    stepMs = 0;
    since = now;
  }
});
document.getElementById('backend').textContent = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

// Handy for poking at things from the browser console.
window.app = {
  state,
  params,
  camera,
  controls,
  get leaf() { return leaf; },
  build,
  place,
  skip(steps) {
    for (let k = 0; k < steps; k++) leaf.step();
    draw();
  },
};
