import * as THREE from 'three/webgpu';
import { TYPE, TYPE_NAMES } from './sim/plant.js';
import { DETAIL } from './sim/genome.js';

const MAX_CELLS = 90400;
const MAX_TRIANGLES = MAX_CELLS * 3;
const MAX_WATER = 18000;
const MAX_MINERALS = 8000;
const MAX_PHOTONS = 260;

const hex = (h) => new THREE.Color(h);

export const TYPE_COLORS = ['#ff4d6d', '#cfe86a', '#a8d08d', '#5fa052', '#8fb8de', '#e8a04c', '#2e9e48', '#eadfc4', '#6b4a2a'];
const TYPE_RGB = TYPE_COLORS.map(hex);
const WALL = hex('#1d2a1a');
const YELLOW = hex('#d6bd3e');
const BROWN = hex('#6b4a2a');
const SICK = hex('#b04adf');
const NECROTIC = hex('#241a12');
const LOW = hex('#1b2330');

// Colours for the 'Natural' mode: what the tissue would look like, rather
// than what kind of cell it is.
const NATURAL = {
  blade: hex('#2f7d32'),
  stalk: hex('#6c9440'),
  vein: hex('#8fb85a'),
  young: hex('#a6d455'),
  rhizome: hex('#6b5636'),
  root: hex('#d8c9a6'),
  rootCore: hex('#b9a780'),
  dead: hex('#5a4630'),
};

function naturalColor(c, out) {
  if (c.type === TYPE.DEAD) return out.copy(c.necrotic ? NECROTIC : NATURAL.dead);
  if (c.root) return out.copy(c.core ? NATURAL.rootCore : NATURAL.root);
  if (c.organ === 'rhizome') return out.copy(NATURAL.rhizome);
  if (c.type <= TYPE.MERISTEM) out.copy(NATURAL.young);
  else if (c.type === TYPE.MESOPHYLL) out.copy(NATURAL.blade);
  else if (c.type === TYPE.XYLEM) out.copy(c.organ === 'frond' ? NATURAL.stalk : NATURAL.vein);
  else out.copy(NATURAL.stalk);
  if (c.infected > 0) out.lerp(BROWN, 0.6);
  if (c.sen > 0) out.lerp(YELLOW, Math.min(1, c.sen * 1.5)).lerp(BROWN, Math.max(0, c.sen * 2 - 1));
  else if (c.alive && c.water < 0.5) out.lerp(YELLOW, (0.5 - c.water) * 1.2);
  // Tissue that has been catching light reads brighter than shaded tissue.
  return out.multiplyScalar(0.72 + 0.28 * Math.min(1, c.light / 1.2));
}

// Each "colour by" mode: a per-cell value in [0, 1] and the colour it maps to.
export const COLOR_MODES = {
  Natural: null,
  'Cell type': null,
  Sugar: { value: (c) => (c.sugar * DETAIL * DETAIL) / 0.375, color: hex('#ffd24a') },
  Water: { value: (c) => c.water, color: hex('#4aa8ff') },
  Minerals: { value: (c) => (c.minerals * DETAIL * DETAIL) / 0.25, color: hex('#ff9d4a') },
  'Auxin (shoot → root)': { value: (c) => Math.sqrt(c.auxin) / 1.5, color: hex('#ff5fd2') },
  'Cytokinin (root → shoot)': { value: (c) => Math.sqrt(c.cyto) / 1.2, color: hex('#5fffd0') },
  'Drought hormone (ABA)': { value: (c) => c.aba * 2, color: hex('#ffe14a') },
  'Immune alarm': { value: (c) => Math.max(c.sa, c.infected > 0 ? 1 : 0), color: hex('#c77dff') },
  'Light caught': { value: (c) => c.light / 2, color: hex('#fff6a0') },
};

function instanced(geometry, color, max, order) {
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.count = 0;
  // Identity everywhere; only scale and position are rewritten per frame.
  const m = mesh.instanceMatrix.array;
  for (let i = 0; i < max; i++) m[i * 16] = m[i * 16 + 5] = m[i * 16 + 10] = m[i * 16 + 15] = 1;
  return mesh;
}

function setDots(mesh, xs, ys, n, radius) {
  const m = mesh.instanceMatrix.array;
  for (let i = 0; i < n; i++) {
    const o = i * 16;
    m[o] = m[o + 5] = radius;
    m[o + 12] = xs[i];
    m[o + 13] = ys[i];
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
}

// Draws the simulation: soil and sky, particles, and one disc per cell.
export class View {
  constructor(scene, sim) {
    this.scene = scene;
    const { width, depth } = sim.soil;

    const sky = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: '#bcd9ee', depthTest: false }));
    sky.position.set(0, 0, 0);
    sky.renderOrder = 0;
    this.sky = sky;
    // The soil is a tinted pane, so roots and particles read clearly in it.
    const soil = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ color: '#3a2a1e', depthTest: false, transparent: true }));
    this.soil = soil;
    soil.position.set(0, -depth / 2, 0);
    soil.renderOrder = 1;
    this.sun = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshBasicMaterial({ color: '#fff2b0', depthTest: false }));
    this.sun.renderOrder = 1;
    scene.add(sky, soil, this.sun);

    const dot = new THREE.CircleGeometry(1, 8);
    const disc = new THREE.CircleGeometry(1, 16);
    this.water = instanced(dot, '#4aa8ff', MAX_WATER, 2);
    this.minerals = instanced(dot, '#ffa64a', MAX_MINERALS, 2);
    this.walls = instanced(disc, '#ffffff', MAX_CELLS, 3);
    this.cells = instanced(disc, '#ffffff', MAX_CELLS, 4);
    this.photons = instanced(dot, '#fff6a0', MAX_PHOTONS, 5);
    for (const mesh of [this.walls, this.cells]) {
      mesh.setColorAt(0, WALL);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    // Continuous tissue: one vertex per cell, one triangle for every three
    // cells that share walls with each other.
    const tissue = new THREE.BufferGeometry();
    tissue.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CELLS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    tissue.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_CELLS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    tissue.setIndex(new THREE.BufferAttribute(new Uint32Array(MAX_TRIANGLES * 3), 1).setUsage(THREE.DynamicDrawUsage));
    tissue.setDrawRange(0, 0);
    this.tissue = new THREE.Mesh(tissue, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
    this.tissue.frustumCulled = false;
    this.tissue.renderOrder = 4.5;
    this.tissueKey = '';
    this.tissueAge = 0;

    scene.add(this.water, this.minerals, this.walls, this.cells, this.tissue, this.photons);

    this.flying = []; // photons in flight: { x0, y0, x1, y1, t }
    this.photonSerial = -1;
    this.tmp = new THREE.Color();
  }

  update(sim, viewParams, realDt, animate) {
    const { plant, soil } = sim;

    this.soil.material.opacity = viewParams.soilOpacity;
    this.water.visible = viewParams.water;
    this.minerals.visible = viewParams.minerals;
    if (viewParams.water) setDots(this.water, soil.water.x, soil.water.y, Math.min(soil.water.n, MAX_WATER), 0.03);
    if (viewParams.minerals) setDots(this.minerals, soil.minerals.x, soil.minerals.y, Math.min(soil.minerals.n, MAX_MINERALS), 0.04);

    // Sky and sun follow the time of day.
    // With daylight display off the sky stays a steady daytime blue; the
    // simulated day and night carry on underneath.
    const light = viewParams.daylight ? sim.sun.light : 0.85;
    this.sky.material.color.setRGB(0.05 + 0.5 * light, 0.08 + 0.68 * light, 0.16 + 0.76 * light, THREE.SRGBColorSpace);
    this.sun.visible = viewParams.daylight && light > 0.02;
    this.sun.position.set(sim.sun.x * 46, 4 + sim.sun.y * 34, 0);

    // Cells.
    const cells = plant.cells;
    const n = Math.min(cells.length, MAX_CELLS);
    const wm = this.walls.instanceMatrix.array;
    const cm = this.cells.instanceMatrix.array;
    const wc = this.walls.instanceColor.array;
    const cc = this.cells.instanceColor.array;
    const mode = COLOR_MODES[viewParams.colorBy];
    const smooth = viewParams.smooth;
    const natural = viewParams.colorBy === 'Natural';
    const inner = viewParams.cellWalls && !smooth ? 0.84 : 1;
    const tp = this.tissue.geometry.attributes.position.array;
    const tc = this.tissue.geometry.attributes.color.array;
    const tmp = this.tmp;
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      c.index = i;
      const o = i * 16;
      wm[o] = wm[o + 5] = c.r;
      wm[o + 12] = cm[o + 12] = c.x;
      wm[o + 13] = cm[o + 13] = c.y;
      // Xylem is hollow, so it is drawn with a thicker wall.
      cm[o] = cm[o + 5] = c.r * (c.type === TYPE.XYLEM && !smooth ? inner * 0.8 : inner);

      if (natural) {
        naturalColor(c, tmp);
      } else if (mode) {
        tmp.copy(LOW).lerp(mode.color, Math.min(1, Math.max(0, mode.value(c))));
      } else {
        tmp.copy(TYPE_RGB[c.type]);
        if (c.necrotic) tmp.copy(NECROTIC);
        else if (c.infected > 0) tmp.lerp(SICK, 0.8);
        else if (c.alive && c.sen > 0) tmp.lerp(YELLOW, Math.min(1, c.sen * 1.5)).lerp(BROWN, Math.max(0, c.sen * 2 - 1));
        else if (c.alive && c.water < 0.5) tmp.lerp(YELLOW, (0.5 - c.water) * 1.2);
      }
      const k = i * 3;
      cc[k] = tmp.r;
      cc[k + 1] = tmp.g;
      cc[k + 2] = tmp.b;
      tp[k] = c.x;
      tp[k + 1] = c.y;
      tc[k] = tmp.r;
      tc[k + 1] = tmp.g;
      tc[k + 2] = tmp.b;
      wc[k] = WALL.r;
      wc[k + 1] = WALL.g;
      wc[k + 2] = WALL.b;
    }
    this.walls.count = this.cells.count = n;
    this.walls.visible = viewParams.cellWalls && !smooth && n > 0;
    this.updateTissue(plant, n, smooth);
    this.cells.visible = n > 0;
    this.walls.instanceMatrix.needsUpdate = this.cells.instanceMatrix.needsUpdate = true;
    this.walls.instanceColor.needsUpdate = this.cells.instanceColor.needsUpdate = true;

    this.updatePhotons(plant, viewParams, realDt, animate);
  }

  updateTissue(plant, n, smooth) {
    this.tissue.visible = smooth && n > 2;
    if (!this.tissue.visible) return;
    const geometry = this.tissue.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    // Triangles only change when cells are born, bonded or shed.
    const key = `${plant.cells.length}:${plant.bonds.length}:${plant.nextId}`;
    if (key === this.tissueKey && ++this.tissueAge < 120) return;
    this.tissueKey = key;
    this.tissueAge = 0;
    const index = geometry.index.array;
    const bonds = plant.bonds;
    let t = 0;
    for (let k = 0; k < bonds.length && t < index.length - 3; k++) {
      const a = bonds[k].a;
      const b = bonds[k].b;
      if (a.index >= n || b.index >= n) continue;
      for (let j = 0; j < a.nb.length; j++) {
        const c = a.nb[j];
        // Each triangle is found from all three of its edges; keep it once.
        if (c.id <= a.id || c.id <= b.id || c.index >= n || !b.nb.includes(c)) continue;
        index[t++] = a.index;
        index[t++] = b.index;
        index[t++] = c.index;
      }
    }
    geometry.index.needsUpdate = true;
    geometry.setDrawRange(0, t);
  }

  // Shows a sample of the simulated photons flying in to where they landed.
  updatePhotons(plant, viewParams, realDt, animate) {
    const flying = this.flying;
    if (plant.photonSerial !== this.photonSerial) {
      this.photonSerial = plant.photonSerial;
      const p = plant.photonPaths;
      for (let i = 0; i < plant.photonCount && animate && flying.length < MAX_PHOTONS; i++) {
        const o = i * 5;
        flying.push({ x0: p[o], y0: p[o + 1], x1: p[o + 2], y1: p[o + 3], t: -Math.random() * 0.3 });
      }
    }
    const m = this.photons.instanceMatrix.array;
    let n = 0;
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i];
      f.t += realDt * 2.2;
      if (f.t >= 1) {
        flying[i] = flying[flying.length - 1];
        flying.pop();
        continue;
      }
      if (f.t < 0) continue;
      const o = n++ * 16;
      m[o] = m[o + 5] = 0.05;
      m[o + 12] = f.x0 + (f.x1 - f.x0) * f.t;
      m[o + 13] = f.y0 + (f.y1 - f.y0) * f.t;
    }
    this.photons.count = n;
    this.photons.visible = viewParams.photons && n > 0;
    this.photons.instanceMatrix.needsUpdate = true;
  }
}

export { TYPE_NAMES };
