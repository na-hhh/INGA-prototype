import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { params } from './params.js';
import { createGenome } from './sim/genome.js';
import { Simulation } from './sim/simulation.js';
import { View, TYPE_COLORS, TYPE_NAMES } from './view.js';
import { createUI } from './ui.js';

const canvas = document.getElementById('scene');
const viewport = document.getElementById('viewport');
const statsEl = document.getElementById('stats');
const legendEl = document.getElementById('legend');
const statusEl = document.getElementById('status');

// --- Renderer -------------------------------------------------------------
// WebGPU where the browser has it, WebGL 2 otherwise.
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
await renderer.init();
const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

// --- Simulation -----------------------------------------------------------
const genome = createGenome();
const sim = new Simulation(params, genome);

// --- Scene: a flat, side-on cut through the plant and the soil ------------
const scene = new THREE.Scene();
const VIEW_HEIGHT = 34;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.position.set(0, 3, 10);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 3, 0);
controls.enableRotate = false;
controls.zoomToCursor = true;
controls.screenSpacePanning = true;
controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
controls.touches.ONE = THREE.TOUCH.PAN;
controls.minZoom = 0.4;
controls.maxZoom = 40;

const view = new View(scene, sim);

function frame() {
  const s = sim.plant.stats;
  const top = Math.max(4, s.height + 2);
  const bottom = -Math.max(5, s.depth + 2);
  camera.zoom = Math.min(6, VIEW_HEIGHT / (top - bottom));
  camera.position.set(0, (top + bottom) / 2, 10);
  controls.target.set(0, (top + bottom) / 2, 0);
  camera.updateProjectionMatrix();
}
frame();

// --- UI -------------------------------------------------------------------
let gui;
function buildUI() {
  gui?.destroy();
  gui = createUI(params, genome, {
    container: document.getElementById('controls'),
    actions: {
      replant() {
        sim.reset();
        frame();
      },
      water: () => sim.soil.addWater(1000),
      fertilise: () => sim.soil.addMinerals(600),
      frame,
      resetGenome() {
        const fresh = createGenome();
        for (const key of Object.keys(genome)) genome[key] = fresh[key];
        buildUI();
      },
    },
  });
}
buildUI();

legendEl.innerHTML = TYPE_NAMES.map((name, i) => `<span><i style="background:${TYPE_COLORS[i]}"></i>${name}</span>`).join('');

function updateStats() {
  const s = sim.plant.stats;
  const hour = sim.hour % 24;
  statsEl.innerHTML = [
    ['Day', `${Math.floor(sim.day) + 1}, ${String(hour).padStart(2, '0')}:00`],
    ['Cells', `${s.alive} living / ${s.cells}`],
    ['Fronds', s.fronds],
    ['Pinnae', s.pinnae],
    ['Pinnules', s.pinnules],
    ['Root tips', s.roots],
    ['Height', s.height.toFixed(1)],
    ['Root depth', s.depth.toFixed(1)],
    ['Sugar', s.sugar.toFixed(1)],
    ['Water status', `${Math.round(s.turgor * 100)}%`],
    ['Infected cells', s.infected],
  ]
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
    .join('');
  legendEl.style.display = params.view.colorBy === 'Cell type' ? '' : 'none';
  statusEl.textContent = sim.plant.dead ? 'The plant has died — press Replant' : '';
}

// --- Resize ---------------------------------------------------------------
function resize() {
  const { clientWidth: w, clientHeight: h } = viewport;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  const halfH = VIEW_HEIGHT / 2;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.left = (-halfH * w) / h;
  camera.right = (halfH * w) / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

// --- Loop -----------------------------------------------------------------
const STEPS_PER_SECOND = 12; // at speed 1: one simulated day every two seconds
const clock = new THREE.Clock();
let debt = 0;
let frames = 0;
let fpsTimer = 0;
let fps = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);

  if (params.simulation.running && !sim.plant.dead) {
    debt = Math.min(debt + dt * STEPS_PER_SECOND * params.simulation.speed, 200);
    const start = performance.now();
    // Run as many hours as are owed, but never stall a frame for it.
    while (debt >= 1 && performance.now() - start < 12) {
      sim.step();
      debt -= 1;
    }
  }

  controls.update();
  view.update(sim, params.view, dt, params.simulation.running && params.simulation.speed <= 4);
  renderer.render(scene, camera);

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.25) {
    fps = Math.round(frames / fpsTimer);
    frames = 0;
    fpsTimer = 0;
    updateStats();
    document.getElementById('backend').textContent = `${backend} · ${fps} fps`;
  }
});

// Handy for poking at the simulation from the browser console.
window.sim = sim;
window.frame = frame;
