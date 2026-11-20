import * as THREE from 'three/webgpu';
import { attribute, color, float, mix, normalMap, step, texture, uniform, uv, vec2 } from 'three/tsl';
import { stemTextures } from './bark.js';
import { LEAF, TENDRIL, SWEEP_RATE } from './vine.js';
import { leafGeometry, leafTextures, lobeAxes } from './leaf.js';
import { dryingStages } from '../leaf/dry.js';
import { createRng } from '../sim/math.js';

// A leaf starts as a bud and unrolls into existence. All of the blade is
// there from the start, wound up tightly around the point where the stalk
// joins it. As the leaf grows, the blade unrolls outwards from that point in
// every direction: the part already unrolled lies flat, and the rest is
// still coiled in a rim around its edge.
//
// Only leaves that are still opening need this, and there are never many at
// once, so they are bent vertex by vertex here and drawn as ordinary
// meshes. Once a leaf is fully open it is handed over to the instanced
// mesh, where it costs almost nothing.
const STALK = 0.5; // where the blade begins along the leaf (see leaf.js)
const JOINT_Y = 0.06; // how high the stalk meets the blade (see leaf.js)
const ROLL = 0.1; // radius of the coil
const OPEN_AT = 0.42; // a leaf has finished unrolling by the time it is this fraction of full size
const OPENING = 70; // leaves per variant that can be opening or curling at once
const REROLL = 0.006; // an opening leaf is bent afresh only once it has unrolled this much further
const CURLED = 0.09; // how little of a dead leaf is left flat: it folds almost onto itself
const DRY_ROLL = 0.19; // a dry leaf curls in a looser, wider roll than a bud
const CURL_TIME = 10; // seconds a dead leaf takes to dry and curl

const VARIANTS = 5; // different leaves to draw from, so that no two neighbours match

const SIDES = 7; // faces around a stem
const RING = SIDES + 1; // vertices per ring: the first is repeated so the texture can wrap
const T_SEG = 36; // segments along a tendril
const T_SIDES = 3;
const T_VERTS = (T_SEG + 1) * T_SIDES;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const RING_COS = Float64Array.from({ length: RING }, (_, q) => Math.cos((q / SIDES) * Math.PI * 2));
const RING_SIN = Float64Array.from({ length: RING }, (_, q) => Math.sin((q / SIDES) * Math.PI * 2));
const T_COS = Float64Array.from({ length: T_SIDES }, (_, q) => Math.cos((q / T_SIDES) * Math.PI * 2));
const T_SIN = Float64Array.from({ length: T_SIDES }, (_, q) => Math.sin((q / T_SIDES) * Math.PI * 2));
const YOUNG = 24; // seconds a stretch of stem goes on thickening quickly
const SWEEP = 200; // older stem nodes refreshed each frame, in turn

// Only the parts of a buffer that changed are sent to the graphics card.
// The changes are gathered as runs of items [from, to), neighbouring runs
// merged; `mark` then flags the same runs in each buffer that holds
// `size` numbers per item.
class Runs {
  constructor() {
    this.list = [];
  }
  clear() {
    this.list.length = 0;
  }
  add(from, to, gap = 8) {
    const list = this.list, n = list.length;
    if (n > 0 && from >= list[n - 2] && from <= list[n - 1] + gap) {
      if (to > list[n - 1]) list[n - 1] = to;
    } else list.push(from, to);
  }
  mark(attribute, size) {
    const list = this.list;
    if (list.length === 0) return;
    // Ranges pile up while a mesh is hidden; past a point, send the lot.
    if (attribute.updateRanges.length > 200) attribute.clearUpdateRanges();
    else if (list.length > 96) {
      let lo = Infinity, hi = 0;
      for (let k = 0; k < list.length; k += 2) {
        lo = Math.min(lo, list[k]);
        hi = Math.max(hi, list[k + 1]);
      }
      attribute.addUpdateRange(lo * size, (hi - lo) * size);
    } else for (let k = 0; k < list.length; k += 2) attribute.addUpdateRange(list[k] * size, (list[k + 1] - list[k]) * size);
    attribute.needsUpdate = true;
  }
}

// Draws a VineSim: one persistent tube mesh for the stems (each node owns a
// ring of vertices) and one instanced mesh for the leaves.
// ---- WebGL materials (for the INGA gallery) ----
// Stem: vertex colour × (green shoot → bark, by the `woody` attribute).
function glStemMaterial(bark, wet) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, map: bark.shoot.map, normalMap: bark.shoot.normalMap });
  m.normalScale.set(0.9, 0.9);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.woodMap = { value: bark.wood.map };
    sh.uniforms.uWet = wet;
    sh.vertexShader = 'attribute float woody;\nvarying float vWoody;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvWoody = woody;');
    sh.fragmentShader = 'uniform sampler2D woodMap;\nuniform float uWet;\nvarying float vWoody;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', 'diffuseColor *= mix(texture2D(map, vMapUv), texture2D(woodMap, vMapUv), vWoody) * mix(1.0, 0.6, uWet);')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(0.55, 0.92, vWoody), 0.3, uWet * 0.85);');
  };
  return m;
}
// Leaf: cut to the part of the blade the unrolling edge has reached, with a
// little light let through from behind.
function glLeafMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide, alphaTest: 0.5 });
  m.normalScale.set(1.3, 1.3);
  m.userData.front = { value: null };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.frontMap = m.userData.front;
    sh.vertexShader = 'attribute float grown;\nvarying float vGrown;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvGrown = grown;');
    sh.fragmentShader = 'uniform sampler2D frontMap;\nvarying float vGrown;\n' + sh.fragmentShader
      .replace('#include <alphatest_fragment>', 'if (texture2D(frontMap, vMapUv).r > vGrown + 0.22) discard;\n#include <alphatest_fragment>')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.12;');
  };
  return m;
}

export class VineView {
  // `webgl`: drawn by a WebGLRenderer (the INGA gallery) rather than WebGPU:
  // the same meshes, with ordinary materials patched to do what the node
  // materials do (bark blending with age, leaves cut to their growing edge).
  constructor(scene, sim, colors, { webgl = false } = {}) {
    this.sim = sim;
    this.webgl = webgl;
    this.colors = colors;
    const max = sim.max;
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(max * RING * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.normal = new THREE.BufferAttribute(new Float32Array(max * RING * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(new Float32Array(max * RING * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.uv = new THREE.BufferAttribute(new Float32Array(max * RING * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.woody = new THREE.BufferAttribute(new Float32Array(max * RING), 1).setUsage(THREE.DynamicDrawUsage);
    this.index = new THREE.BufferAttribute(new Uint32Array(max * SIDES * 6), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('normal', this.normal);
    geometry.setAttribute('color', this.color);
    geometry.setAttribute('uv', this.uv);
    geometry.setAttribute('woody', this.woody);
    geometry.setIndex(this.index);
    geometry.setDrawRange(0, 0);
    // Surface detail fades from green shoot to bark as each stretch of
    // stem turns woody.
    // How wet everything is, 0 to 1 (the simulation's `wet`): wet surfaces
    // are darker and shinier.
    this.wet = webgl ? { value: 0 } : uniform(0);
    const bark = (this.bark = stemTextures());
    let stemMaterial;
    if (webgl) stemMaterial = glStemMaterial(bark, this.wet);
    else {
      stemMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
      const woody = attribute('woody', 'float');
      stemMaterial.colorNode = attribute('color', 'vec3').mul(mix(texture(bark.shoot.map, uv()).rgb, texture(bark.wood.map, uv()).rgb, woody)).mul(mix(float(1), float(0.6), this.wet));
      stemMaterial.normalNode = mix(normalMap(texture(bark.shoot.normalMap, uv()), vec2(0.8)), normalMap(texture(bark.wood.normalMap, uv()), vec2(1.6)), woody).normalize();
      stemMaterial.roughnessNode = mix(mix(float(0.55), float(0.92), woody), float(0.3), this.wet.mul(0.85));
    }
    this.stems = new THREE.Mesh(geometry, stemMaterial);
    this.stems.frustumCulled = false;
    this.stems.castShadow = this.stems.receiveShadow = true;

    // Leaves are thin: light soaks through them. This material adds that
    // glow to ordinary surface lighting, and it is shadowed like any light.
    this.translucency = webgl ? { value: 1 } : uniform(1);
    this.leafMeshes = [];
    const perVariant = Math.ceil(sim.maxLeaves / VARIANTS);
    for (let v = 0; v < VARIANTS; v++) {
      let material;
      if (webgl) material = glLeafMaterial();
      else {
        material = new THREE.MeshSSSNodeMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide });
        material.normalScale.set(1.3, 1.3);
        material.thicknessColorNode = color('#84b82c').mul(this.translucency);
        material.roughnessNode = mix(float(0.5), float(0.3), this.wet);
        material.thicknessDistortionNode = float(0.35);
        material.thicknessAmbientNode = float(0.06);
        material.thicknessAttenuationNode = float(0.55);
        material.thicknessPowerNode = float(2.5);
        material.thicknessScaleNode = float(3);
      }
      // How far each leaf's growing edge has got (see the front map).
      material.alphaTest = 0.5;
      const mesh = new THREE.InstancedMesh(new THREE.BufferGeometry(), material, perVariant);
      // (An open leaf is all there: leaves still coming in are drawn by the opening mesh.)
      mesh.userData.grown = new THREE.InstancedBufferAttribute(new Float32Array(perVariant).fill(1), 1);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      this.leafMeshes.push(mesh);
      // Dead leaves, already curled: instanced, like the open ones.
      const curled = new THREE.InstancedMesh(new THREE.BufferGeometry(), material, perVariant);
      curled.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      curled.setColorAt(0, new THREE.Color(1, 1, 1));
      curled.instanceColor.setUsage(THREE.DynamicDrawUsage);
      curled.count = 0;
      curled.frustumCulled = false;
      curled.castShadow = curled.receiveShadow = true;
      curled.userData.grown = new THREE.InstancedBufferAttribute(new Float32Array(perVariant).fill(1), 1);
      mesh.userData.curled = curled;
      // The same variant's opening leaves: an ordinary mesh, rewritten each frame.
      const opening = new THREE.Mesh(new THREE.BufferGeometry(), material);
      opening.frustumCulled = false;
      opening.castShadow = opening.receiveShadow = true;
      mesh.userData.opening = opening;
    }
    this.rolled = new Float32Array(6);
    this.setLeafShape();

    // Tendrils: every one owns a fixed run of vertices in one mesh.
    const maxT = sim.maxTendrils;
    const tg = new THREE.BufferGeometry();
    this.tPosition = new THREE.BufferAttribute(new Float32Array(maxT * T_VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tNormal = new THREE.BufferAttribute(new Float32Array(maxT * T_VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tColor = new THREE.BufferAttribute(new Float32Array(maxT * T_VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const ti = new Uint32Array(maxT * T_SEG * T_SIDES * 6);
    let o = 0;
    for (let t = 0; t < maxT; t++) {
      for (let k = 0; k < T_SEG; k++) {
        const a = t * T_VERTS + k * T_SIDES, b = a + T_SIDES;
        for (let q = 0; q < T_SIDES; q++) {
          const q1 = (q + 1) % T_SIDES;
          ti[o++] = a + q; ti[o++] = a + q1; ti[o++] = b + q;
          ti[o++] = a + q1; ti[o++] = b + q1; ti[o++] = b + q;
        }
      }
    }
    tg.setAttribute('position', this.tPosition);
    tg.setAttribute('normal', this.tNormal);
    tg.setAttribute('color', this.tColor);
    tg.setIndex(new THREE.BufferAttribute(ti, 1));
    tg.setDrawRange(0, 0);
    this.tendrils = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    this.tendrils.frustumCulled = false;
    this.tendrils.castShadow = this.tendrils.receiveShadow = true;
    this.curve = new Float32Array((T_SEG + 1) * 3);
    this.curve2 = new Float32Array((T_SEG + 1) * 3);
    this.settled = new Uint8Array(maxT); // tendrils that have stopped changing

    this.group = new THREE.Group();
    this.group.add(this.stems, ...this.leafMeshes, ...this.leafMeshes.map((m) => m.userData.opening), ...this.leafMeshes.map((m) => m.userData.curled), this.tendrils);
    scene.add(this.group);
    this.linked = 0; // nodes already joined to their parent by triangles
    this.indexCount = 0;
    this.cursor = 0;
    this.young = 0; // every node before this one has finished its first thickening
    this.wasLoose = new Int32Array(max); // the nodes that were swinging free last time
    this.wasLooseCount = 0;
    this.runs = new Runs();
    this.frame = 0;
    this.indexStart = 0;
    this.tmp = new THREE.Color();
  }

  // Builds the leaf variants: each has its own outline and its own veins.
  setLeafShape() {
    const params = this.sim.params;
    const rng = createRng(4242 + Math.round(params.lobes) * 97);
    this.leafMeshes.forEach((mesh, v) => {
      const axes = lobeAxes(params.lobes, rng);
      const textures = leafTextures(axes, params.lobeDepth, v + 1);
      mesh.geometry.dispose();
      mesh.geometry = leafGeometry(params, axes, v + 1);
      mesh.geometry.setAttribute('grown', mesh.userData.grown);
      // Room for this variant's opening leaves: OPENING copies of the leaf.
      const base = mesh.geometry;
      const verts = base.attributes.position.count;
      const og = mesh.userData.opening.geometry;
      og.dispose();
      const fresh = new THREE.BufferGeometry();
      for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['uv', 2], ['grown', 1]]) {
        fresh.setAttribute(name, new THREE.BufferAttribute(new Float32Array(OPENING * verts * size), size).setUsage(THREE.DynamicDrawUsage));
      }
      const bi = base.index.array;
      const index = new Uint32Array(OPENING * bi.length);
      for (let k = 0; k < OPENING; k++) {
        for (let q = 0; q < bi.length; q++) index[k * bi.length + q] = bi[q] + k * verts;
        fresh.attributes.uv.array.set(base.attributes.uv.array, k * verts * 2);
      }
      fresh.setIndex(new THREE.BufferAttribute(index, 1));
      fresh.setDrawRange(0, 0);
      mesh.userData.opening.geometry = fresh;
      // Each opening or curling leaf keeps one place in that mesh for as
      // long as it needs it. Its bent shape is kept too, so that it is only
      // worked out again when the leaf has visibly unrolled further; in
      // between, the kept shape is just moved with the leaf.
      mesh.userData.local = new Float32Array(OPENING * verts * 6);
      mesh.userData.slotLeaf = new Int32Array(OPENING).fill(-1); // which leaf has each place
      mesh.userData.slotOpen = new Float64Array(OPENING); // how far unrolled its kept shape is
      mesh.userData.slotCoil = new Float64Array(OPENING);
      mesh.userData.slotSeen = new Uint8Array(OPENING);
      mesh.userData.slotOf = new Map();
      mesh.userData.slotTop = 0;
      // How this leaf dries and curls is worked out by actually drying it
      // (see leaf/dry.js): a little each frame, in the background. Until
      // that is done a simple rolled-up shape stands in.
      mesh.userData.stages = null;
      this.drying = (this.drying ?? []).filter((job) => job.mesh !== mesh);
      this.drying.push({ mesh, run: dryingStages(base.userData.blade.mesh, axes, v + 1, 4) });
      const dry = base.clone();
      const dp = dry.attributes.position.array, dn = dry.attributes.normal.array;
      const r = this.rolled;
      for (let v = 0; v < verts; v++) {
        this.roll(base, v, CURLED * 1.45, DRY_ROLL);
        dp[v * 3] = r[0]; dp[v * 3 + 1] = r[1]; dp[v * 3 + 2] = r[2];
        dn[v * 3] = r[3]; dn[v * 3 + 1] = r[4]; dn[v * 3 + 2] = r[5];
      }
      dry.setAttribute('grown', mesh.userData.curled.userData.grown);
      mesh.userData.curled.geometry.dispose();
      mesh.userData.curled.geometry = dry;
      mesh.material.map?.dispose();
      mesh.material.normalMap?.dispose();
      mesh.userData.frontMap?.dispose();
      mesh.material.map = textures.map;
      mesh.material.normalMap = textures.normalMap;
      mesh.userData.frontMap = textures.frontMap;
      if (this.webgl) {
        mesh.material.userData.front.value = textures.frontMap;
        mesh.material.needsUpdate = true;
        return;
      }
      // Only the part of the blade the growing edge has reached is drawn.
      const front = texture(textures.frontMap, uv()).r;
      const grown = attribute('grown', 'float');
      // Tissue is drawn once the unrolling edge is nearly upon it, so the
      // coil is only a few turns thick and the edge advances raggedly.
      mesh.material.opacityNode = step(front, grown.add(0.22));
      // The same cut-out for the shadow, so a leaf's shadow grows with it.
      mesh.material.maskShadowNode = grown.add(0.22).greaterThan(front);
      mesh.material.needsUpdate = true;
    });
  }

  dispose(scene) {
    scene.remove(this.group);
    this.stems.geometry.dispose();
    for (const t of [this.bark.shoot, this.bark.wood]) {
      t.map.dispose();
      t.normalMap.dispose();
    }
    for (const mesh of this.leafMeshes) {
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.normalMap?.dispose();
      mesh.userData.opening.geometry.dispose();
      mesh.userData.curled.geometry.dispose();
      mesh.userData.curled.dispose();
      mesh.dispose();
    }
    this.tendrils.geometry.dispose();
  }

  // Rewrites the ring of vertices around one node.
  ring(i) {
    const sim = this.sim;
    const par = sim.parent[i];
    let x = sim.x[i], y = sim.y[i], z = sim.z[i];
    let tx = 0, ty = 1, tz = 0;
    if (par >= 0) {
      // A brand-new node slides out from its parent rather than popping in.
      const f = Math.min(1, (sim.time - sim.born[i]) * sim.params.speed);
      if (f < 1) {
        x = sim.x[par] + (x - sim.x[par]) * f;
        y = sim.y[par] + (y - sim.y[par]) * f;
        z = sim.z[par] + (z - sim.z[par]) * f;
      }
      tx = sim.x[i] - sim.x[par];
      ty = sim.y[i] - sim.y[par];
      tz = sim.z[i] - sim.z[par];
      const l = Math.hypot(tx, ty, tz) || 1;
      tx /= l; ty /= l; tz /= l;
    }
    // Keep this node's sideways vector square to the stem, without twisting.
    let ax = sim.ax[i], ay = sim.ay[i], az = sim.az[i];
    const d = ax * tx + ay * ty + az * tz;
    ax -= tx * d; ay -= ty * d; az -= tz * d;
    let l = Math.hypot(ax, ay, az);
    if (l < 1e-4) {
      ax = Math.abs(ty) < 0.9 ? 0 : 1;
      ay = Math.abs(ty) < 0.9 ? 1 : 0;
      az = 0;
      const d2 = ax * tx + ay * ty + az * tz;
      ax -= tx * d2; ay -= ty * d2; az -= tz * d2;
      l = Math.hypot(ax, ay, az) || 1;
    }
    ax /= l; ay /= l; az /= l;
    sim.ax[i] = ax; sim.ay[i] = ay; sim.az[i] = az;
    const bx = ty * az - tz * ay, by = tz * ax - tx * az, bz = tx * ay - ty * ax;
    const r = sim.radius(i);
    // Young shoots are green; old thick stems turn to wood.
    const { stem, wood } = this.colors;
    const shade = smooth((r / sim.params.stemWidth - 0.45) * 1.6);
    const cr = stem.r + (wood.r - stem.r) * shade, cg = stem.g + (wood.g - stem.g) * shade, cb = stem.b + (wood.b - stem.b) * shade;
    const P = this.position.array, N = this.normal.array, C = this.color.array, U = this.uv.array, W = this.woody.array;
    let o = i * RING * 3;
    const along = sim.along[i] * 0.55;
    for (let q = 0; q < RING; q++, o += 3) {
      const c = RING_COS[q], s = RING_SIN[q];
      const nx = ax * c + bx * s, ny = ay * c + by * s, nz = az * c + bz * s;
      P[o] = x + nx * r; P[o + 1] = y + ny * r; P[o + 2] = z + nz * r;
      N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
      C[o] = cr; C[o + 1] = cg; C[o + 2] = cb;
      const k = i * RING + q;
      U[k * 2] = q / SIDES;
      U[k * 2 + 1] = along;
      W[k] = shade;
    }
  }

  update() {
    this.dryLeaves();
    const sim = this.sim;
    // Join new nodes to their parents.
    const I = this.index.array;
    for (let i = this.linked; i < sim.n; i++) {
      const par = sim.parent[i];
      if (par < 0) continue;
      const a = par * RING, b = i * RING;
      for (let q = 0; q < SIDES; q++) {
        const q1 = q + 1;
        I[this.indexCount++] = a + q; I[this.indexCount++] = a + q1; I[this.indexCount++] = b + q;
        I[this.indexCount++] = a + q1; I[this.indexCount++] = b + q1; I[this.indexCount++] = b + q;
      }
    }
    // Every new node gets its ring at once, however long ago this last ran.
    const runs = this.runs;
    runs.clear();
    const first = this.linked;
    for (let i = first; i < sim.n; i++) this.ring(i);
    if (first !== sim.n) {
      if (this.indexCount > this.indexStart) {
        this.index.addUpdateRange(this.indexStart, this.indexCount - this.indexStart);
        this.index.needsUpdate = true;
      }
      this.linked = sim.n;
      this.stems.geometry.setDrawRange(0, this.indexCount);
    }
    this.indexStart = this.indexCount;
    // Rings that are changing. Anything swinging free (the simulation keeps
    // a list; last frame's is the one used, so that a node that has just
    // taken hold is drawn where it came to rest), and anything still
    // thickening fast: nodes are numbered in the
    // order they grew, so those are simply the last ones.
    const time = sim.time;
    while (this.young < sim.n && time - sim.born[this.young] >= YOUNG) this.young++;
    const young = Math.min(this.young, first);
    for (let q = 0; q < this.wasLooseCount; q++) {
      const i = this.wasLoose[q];
      if (i >= young) break;
      this.ring(i);
      runs.add(i, i + 1);
    }
    this.wasLoose.set(sim.loose.subarray(0, sim.looseCount));
    this.wasLooseCount = sim.looseCount;
    // (The newest are sliding out and are redrawn every frame; the rest of
    // the young ones thicken smoothly enough at every fourth.)
    const turn = this.frame & 3;
    for (let i = young; i < first; i++) if ((i & 3) === turn || time - sim.born[i] < 1.5) this.ring(i);
    // The rest are refreshed a few at a time, for slow thickening.
    if (sim.n > 0) {
      const from = this.cursor % sim.n, to = Math.min(sim.n, from + SWEEP);
      for (let i = from; i < to; i++) this.ring(i);
      this.cursor = to;
      runs.add(from, to, 0);
    }
    if (young < sim.n) runs.add(young, sim.n, 0);
    runs.mark(this.position, RING * 3);
    runs.mark(this.normal, RING * 3);
    runs.mark(this.color, RING * 3);
    runs.mark(this.uv, RING * 2);
    runs.mark(this.woody, RING);
    this.wet.value = sim.wet ?? 0;
    this.frame++;
    this.updateLeaves();
    this.updateTendrils();
  }

  // The path of a tendril that is free: straight at first, then curling in
  // on itself. `curl` 0 is a searching tendril, 1 one that has given up
  // and wound itself into a tight spiral.
  freeCurve(i, out, angle, curl, length) {
    const sim = this.sim, T = sim.tendril;
    const node = T.node[i];
    const dx = T.dx[i], dy = T.dy[i], dz = T.dz[i], ux = T.ux[i], uy = T.uy[i], uz = T.uz[i];
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    // The plane the tendril curls in turns about its own axis as it searches.
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const wx = ux * ca + vx * sa, wy = uy * ca + vy * sa, wz = uz * ca + vz * sa;
    const start = 0.55 - 0.35 * curl; // where along it the curl begins
    const turns = (1.2 + 2.4 * curl) * 2 * Math.PI * T.hand[i];
    let x = sim.x[node], y = sim.y[node], z = sim.z[node];
    const step = length / T_SEG;
    for (let k = 0; k <= T_SEG; k++) {
      out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z;
      const s = (k + 0.5) / T_SEG;
      const c = s > start ? (s - start) / (1 - start) : 0;
      const phi = 0.45 * s + turns * c * c;
      const cp = Math.cos(phi), sp = Math.sin(phi);
      // Tighter turns take shorter steps, so the spiral closes in.
      const shrink = 1 - 0.75 * c * curl;
      x += (dx * cp + wx * sp) * step * shrink;
      y += (dy * cp + wy * sp) * step * shrink;
      z += (dz * cp + wz * sp) * step * shrink;
    }
  }

  // The path of a tendril that has taken hold: from the stem to its anchor,
  // winding up into a spring, with its tip wrapped tight at the anchor.
  gripCurve(i, out, coiled) {
    const sim = this.sim, T = sim.tendril;
    const node = T.node[i];
    const bx = sim.x[node], by = sim.y[node], bz = sim.z[node];
    let ax = T.ax[i] - bx, ay = T.ay[i] - by, az = T.az[i] - bz;
    const len = Math.hypot(ax, ay, az) || 1e-4;
    const tx = ax / len, ty = ay / len, tz = az / len;
    // Two directions square to the line from stem to anchor.
    let ux = T.ny[i] * tz - T.nz[i] * ty, uy = T.nz[i] * tx - T.nx[i] * tz, uz = T.nx[i] * ty - T.ny[i] * tx;
    let l = Math.hypot(ux, uy, uz);
    if (l < 1e-3) {
      ux = -ty; uy = tx; uz = 0;
      l = Math.hypot(ux, uy, uz) || 1;
    }
    ux /= l; uy /= l; uz /= l;
    const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
    const hand = T.hand[i];
    const coils = 5 * coiled, radius = 0.075 * coiled;
    const SPRING = 0.7; // the rest of its length wraps the anchor
    // In the surface at the anchor.
    const nx = T.nx[i], ny = T.ny[i], nz = T.nz[i];
    let e1x = ny * tz - nz * ty, e1y = nz * tx - nx * tz, e1z = nx * ty - ny * tx;
    l = Math.hypot(e1x, e1y, e1z) || 1;
    e1x /= l; e1y /= l; e1z /= l;
    const e2x = ny * e1z - nz * e1y, e2y = nz * e1x - nx * e1z, e2z = nx * e1y - ny * e1x;
    for (let k = 0; k <= T_SEG; k++) {
      const s = k / T_SEG;
      let x, y, z;
      if (s <= SPRING) {
        const m = s / SPRING;
        const a = 2 * Math.PI * coils * m * hand;
        const r = radius * Math.sin(Math.PI * m);
        x = bx + ax * m + (ux * Math.cos(a) + vx * Math.sin(a)) * r;
        y = by + ay * m + (uy * Math.cos(a) + vy * Math.sin(a)) * r;
        z = bz + az * m + (uz * Math.cos(a) + vz * Math.sin(a)) * r;
      } else {
        const m = (s - SPRING) / (1 - SPRING);
        const a = 2 * Math.PI * (0.6 + 0.7 * coiled) * m * hand;
        const r = 0.07 * Math.sin(Math.PI * Math.pow(m, 0.7)) + 0.012 * m;
        x = T.ax[i] + (e1x * Math.cos(a) + e2x * Math.sin(a)) * r + nx * 0.012;
        y = T.ay[i] + (e1y * Math.cos(a) + e2y * Math.sin(a)) * r + ny * 0.012;
        z = T.az[i] + (e1z * Math.cos(a) + e2z * Math.sin(a)) * r + nz * 0.012;
      }
      out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z;
    }
  }

  updateTendrils() {
    const sim = this.sim, T = sim.tendril;
    const P = this.tPosition.array, N = this.tNormal.array, C = this.tColor.array;
    const { tendril, wood } = this.colors;
    const curve = this.curve, other = this.curve2;
    const time = sim.time;
    const runs = this.runs;
    runs.clear();
    for (let i = 0; i < T.n; i++) {
      const state = T.state[i];
      const node = T.node[i];
      // A settled tendril on a stem that is holding still needs no redrawing.
      if (this.settled[i] && sim.attached[node]) continue;
      // One that has finished coiling is only still changing colour, slowly:
      // those are redrawn a batch at a time, each every couple of seconds.
      if (sim.attached[node] && ((i >> 4) + this.frame) % 128 !== 0 && time - T.since[i] > (state === TENDRIL.GRIPPING ? 9.5 : state === TENDRIL.CURLED ? 6.5 : Infinity)) continue;
      const age = time - T.born[i];
      const grown = smooth(age / 4);
      const length = T.len[i] * grown;
      const sweep = T.hand[i] * SWEEP_RATE * (state === TENDRIL.SEARCHING ? time : T.since[i]) + T.phase[i];
      let woody = 0;
      if (age <= 0) {
        curve.fill(0);
      } else if (state === TENDRIL.SEARCHING) {
        this.freeCurve(i, curve, sweep, 0, length);
      } else if (state === TENDRIL.CURLED) {
        const since = time - T.since[i];
        this.freeCurve(i, curve, sweep, smooth(since / 6), length);
        woody = smooth(since / 30);
        if (since > 32) this.settled[i] = 1;
      } else {
        const since = time - T.since[i];
        this.gripCurve(i, curve, smooth(since / 9));
        // Ease from where it was reaching into where it now holds.
        if (since < 0.7) {
          this.freeCurve(i, other, sweep, 0, length);
          const m = smooth(since / 0.7);
          for (let k = 0; k < curve.length; k++) curve[k] = other[k] + (curve[k] - other[k]) * m;
        }
        woody = smooth((since - 8) / 30);
        if (since > 40) this.settled[i] = 1;
      }
      const cr = tendril.r + (wood.r - tendril.r) * woody, cg = tendril.g + (wood.g - tendril.g) * woody, cb = tendril.b + (wood.b - tendril.b) * woody;
      let o = i * T_VERTS * 3;
      for (let k = 0; k <= T_SEG; k++) {
        const a = Math.max(0, k - 1) * 3, b = Math.min(T_SEG, k + 1) * 3;
        let tx = curve[b] - curve[a], ty = curve[b + 1] - curve[a + 1], tz = curve[b + 2] - curve[a + 2];
        let l = Math.hypot(tx, ty, tz) || 1;
        tx /= l; ty /= l; tz /= l;
        // Any two directions square to the tendril here.
        let px = ty, py = -tx, pz = 0;
        if (Math.abs(tz) > 0.9) {
          px = 0; py = tz; pz = -ty;
        }
        l = Math.hypot(px, py, pz) || 1;
        px /= l; py /= l; pz /= l;
        const qx = ty * pz - tz * py, qy = tz * px - tx * pz, qz = tx * py - ty * px;
        const r = (0.02 - 0.014 * (k / T_SEG)) * grown;
        for (let q = 0; q < T_SIDES; q++, o += 3) {
          const c = T_COS[q], s2 = T_SIN[q];
          const nx = px * c + qx * s2, ny = py * c + qy * s2, nz = pz * c + qz * s2;
          P[o] = curve[k * 3] + nx * r; P[o + 1] = curve[k * 3 + 1] + ny * r; P[o + 2] = curve[k * 3 + 2] + nz * r;
          N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
          C[o] = cr; C[o + 1] = cg; C[o + 2] = cb;
        }
      }
      runs.add(i, i + 1, 2);
    }
    this.tendrils.geometry.setDrawRange(0, T.n * T_SEG * T_SIDES * 6);
    this.tendrils.visible = T.n > 0;
    runs.mark(this.tPosition, T_VERTS * 3);
    runs.mark(this.tNormal, T_VERTS * 3);
    runs.mark(this.tColor, T_VERTS * 3);
  }

  updateLeaves() {
    const sim = this.sim;
    const L = sim.leaf;
    const meshes = this.leafMeshes;
    for (const mesh of meshes) {
      mesh.userData.slotSeen.fill(0);
      mesh.userData.rerolled = false;
      mesh.userData.used = mesh.userData.curled.userData.used = 0;
    }
    const { leaf, leafYoung, leafOld, leafDead } = this.colors;
    const damp = 1 - 0.22 * (sim.wet ?? 0); // wet leaves are darker
    const tmp = this.tmp;
    const time = sim.time;
    for (let i = 0; i < L.n; i++) {
      // Leaf i is drawn with variant i % VARIANTS. A living leaf is drawn
      // open, a dead one curled: two instanced meshes, each holding just the
      // leaves it is drawing this frame, packed together, so nothing is
      // spent on places that are empty.
      const mesh = meshes[i % VARIANTS];
      const state = L.state[i];
      const age = time - L.born[i];
      if (state === LEAF.FREE || age <= 0) continue;
      const dead = state !== LEAF.ON;
      const live = dead ? mesh.userData.curled : mesh;
      const M = live.instanceMatrix.array, C = live.instanceColor.array;
      // Everything about a leaf's coming-in follows from one number, how
      // far it has grown, which rises steadily from nothing: its size, how
      // far it has unrolled, how it is held and its colour.
      const scale = L.scale[i];
      const unrolled = smooth(scale / OPEN_AT);
      // A leaf that is opening or curling needs a place in the opening mesh.
      const curl = state === LEAF.WITHERED ? smooth((time - L.since[i]) / CURL_TIME) : dead ? 1 : 0;
      const place = (state === LEAF.ON && unrolled < 1) || (state === LEAF.WITHERED && curl < 1) ? this.place(mesh, i) : -1;
      const opening = state === LEAF.ON && place >= 0;
      // A dead leaf dries and curls in from its edges over a few seconds.
      const curling = state === LEAF.WITHERED && place >= 0;
      let dx = L.dx[i], dy = L.dy[i], dz = L.dz[i];
      let fx = L.fx[i], fy = L.fy[i], fz = L.fz[i];
      let wx = dy * fz - dz * fy, wy = dz * fx - dx * fz, wz = dx * fy - dy * fx;
      let px, py, pz;
      let size = L.size[i] * Math.pow(scale, 1.15) * (mesh.userData.stages ? 1 : 1 - 0.12 * curl); // the dried shapes have their own shrinkage
      let open = unrolled; // a new leaf is held up at first, then settles
      const phase = L.phase[i];
      // How far through its life: 0 fresh, 1 about to fall.
      const lifetime = sim.params.leafLife > 0 || L.shaded[i] ? Math.min(1, age / L.life[i]) : 0;
      let pitch, roll;
      if (state === LEAF.ON || state === LEAF.WITHERED) {
        const node = L.node[i];
        const r = sim.radius(node);
        // Stand off the surface by the stem's thickness plus this leaf's own
        // layer, so neighbouring leaves stack rather than cut through.
        const lift = (r + L.lift[i]) * sim.attached[node];
        px = sim.x[node] + sim.nx[node] * lift;
        py = sim.y[node] + sim.ny[node] * lift;
        pz = sim.z[node] + sim.nz[node] * lift;
        // Flutter in the wind, and hang lower with age.
        // Tilted by the wind (worked out in the simulation); a new leaf is
        // held up and folded, and an old one on a free strand hangs.
        pitch = L.pitch[i] + (1 - open) * 0.45 - (sim.attached[node] ? 0 : 0.3 * lifetime * lifetime + 0.4 * curl);
        roll = L.roll[i];
      } else {
        px = L.x[i]; py = L.y[i]; pz = L.z[i];
        open = 1;
        if (state === LEAF.FALLING) {
          // Tumbling.
          pitch = Math.sin(time * 3.1 + phase) * 1.2;
          roll = time * 2.2 + phase;
        } else {
          // Lying on the ground, shrivelling.
          pitch = 0;
          roll = phase;
          size *= 1 - smooth((time - L.since[i]) / 9);
          fx = 0; fy = 1; fz = 0;
          dy = 0;
          const l = Math.hypot(dx, dz) || 1;
          dx /= l; dz /= l;
          wx = -dz; wy = 0; wz = dx;
        }
      }
      // Rotate the frame: pitch about the leaf's width, roll about its length.
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const d2x = dx * cp + fx * sp, d2y = dy * cp + fy * sp, d2z = dz * cp + fz * sp;
      const f2x = fx * cp - dx * sp, f2y = fy * cp - dy * sp, f2z = fz * cp - dz * sp;
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const f3x = f2x * cr + wx * sr, f3y = f2y * cr + wy * sr, f3z = f2z * cr + wz * sr;
      const w3x = wx * cr - f2x * sr, w3y = wy * cr - f2y * sr, w3z = wz * cr - f2z * sr;
      // Some leaves are broader than others.
      const width = size * (0.84 + 0.34 * ((phase * 7.3) % 1));
      if (curling) {
        this.unroll(mesh, 1 - curl * (1 - CURLED), 1, DRY_ROLL, px, py, pz, d2x * size, d2y * size, d2z * size, f3x * size, f3y * size, f3z * size, w3x * width, w3y * width, w3z * width, tmp.copy(leafOld).lerp(leafDead, curl), (0.94 + 0.12 * (phase % 1)) * damp, place);
        continue;
      }
      if (opening) {
        // Drawn by the opening-leaf mesh instead; see unroll().
        this.unroll(mesh, unrolled, unrolled, ROLL, px, py, pz, d2x * size, d2y * size, d2z * size, f3x * size, f3y * size, f3z * size, w3x * width, w3y * width, w3z * width, tmp.copy(leafYoung).lerp(leaf, smooth(scale / 0.6)), (0.94 + 0.12 * (phase % 1)) * damp, place);
        continue;
      }
      const slot = live.userData.used++;
      const o = slot * 16;
      M[o] = d2x * size; M[o + 1] = d2y * size; M[o + 2] = d2z * size; M[o + 3] = 0;
      M[o + 4] = f3x * size; M[o + 5] = f3y * size; M[o + 6] = f3z * size; M[o + 7] = 0;
      M[o + 8] = w3x * width; M[o + 9] = w3y * width; M[o + 10] = w3z * width; M[o + 11] = 0;
      M[o + 12] = px; M[o + 13] = py; M[o + 14] = pz; M[o + 15] = 1;

      // Colour through life: pale when new, deep green, then turning.
      tmp.copy(leafYoung).lerp(leaf, smooth(scale / 0.6));
      if (lifetime > 0.78) tmp.lerp(leafOld, smooth((lifetime - 0.78) / 0.2));
      if (dead) tmp.copy(leafDead);
      const tint = (0.94 + 0.12 * (phase % 1)) * damp;
      const k = slot * 3;
      C[k] = tmp.r * tint; C[k + 1] = tmp.g * tint; C[k + 2] = tmp.b * tint;
    }
    for (const mesh of meshes) {
      for (const live of [mesh, mesh.userData.curled]) {
        const used = live.userData.used;
        live.count = used;
        live.visible = used > 0;
        if (used === 0) continue;
        live.instanceMatrix.addUpdateRange(0, used * 16);
        live.instanceMatrix.needsUpdate = true;
        live.instanceColor.addUpdateRange(0, used * 3);
        live.instanceColor.needsUpdate = true;
      }
      // Give up the places of leaves that have finished opening or curling.
      const ud = mesh.userData;
      const verts = mesh.geometry.attributes.position.count;
      const og = ud.opening.geometry;
      let top = 0; // one past the last place in use
      const was = ud.slotTop;
      for (let k = 0; k < was; k++) {
        if (ud.slotLeaf[k] < 0) continue;
        if (ud.slotSeen[k]) top = k + 1;
        else {
          ud.slotOf.delete(ud.slotLeaf[k]);
          ud.slotLeaf[k] = -1;
          og.attributes.position.array.fill(0, k * verts * 3, (k + 1) * verts * 3);
        }
      }
      ud.slotTop = top;
      og.setDrawRange(0, top * mesh.geometry.index.count);
      ud.opening.visible = top > 0;
      if (was > 0) {
        for (const name of ['position', 'normal']) {
          og.attributes[name].addUpdateRange(0, was * verts * 3);
          og.attributes[name].needsUpdate = true;
        }
        if (ud.rerolled) {
          og.attributes.color.addUpdateRange(0, was * verts * 3);
          og.attributes.grown.addUpdateRange(0, was * verts);
          og.attributes.color.needsUpdate = og.attributes.grown.needsUpdate = true;
        }
      }
    }
  }

  // Carries on drying the leaf variants, for a few milliseconds. When one is
  // done, its stages become the shapes a dying leaf passes through, and the
  // last of them the shape of every dead leaf of that variant.
  dryLeaves() {
    const job = this.drying?.[0];
    if (!job) return;
    const until = performance.now() + 4;
    let step;
    do step = job.run.next();
    while (!step.done && performance.now() < until);
    if (!step.done) return;
    this.drying.shift();
    const mesh = job.mesh, base = mesh.geometry;
    const { offset, mesh: blade } = base.userData.blade;
    const bp = base.attributes.position.array, bn = base.attributes.normal.array;
    // Each stage as a whole leaf: the stalk as it was, the blade as dried.
    mesh.userData.stages = step.value.map((frame) => {
      const position = Float32Array.from(bp), normal = Float32Array.from(bn);
      for (let v = 0; v < blade.count; v++) {
        const o = (offset + v) * 3;
        position[o] = frame.position[v * 3] + STALK;
        position[o + 1] = frame.position[v * 3 + 1] + JOINT_Y;
        position[o + 2] = frame.position[v * 3 + 2];
        normal[o] = frame.normal[v * 3]; normal[o + 1] = frame.normal[v * 3 + 1]; normal[o + 2] = frame.normal[v * 3 + 2];
      }
      return { position, normal };
    });
    const last = mesh.userData.stages[mesh.userData.stages.length - 1];
    const dry = mesh.userData.curled.geometry;
    dry.attributes.position.array.set(last.position);
    dry.attributes.normal.array.set(last.normal);
    dry.attributes.position.needsUpdate = dry.attributes.normal.needsUpdate = true;
    mesh.userData.slotOpen.fill(-1); // any leaf part-way through curling takes up the new shapes
  }

  // The place in its variant's opening mesh that a leaf has, or is given
  // now; -1 if they are all taken.
  place(mesh, leaf) {
    const ud = mesh.userData;
    let k = ud.slotOf.get(leaf);
    if (k === undefined) {
      for (k = 0; k < OPENING && ud.slotLeaf[k] >= 0; k++);
      if (k === OPENING) return -1;
      ud.slotLeaf[k] = leaf;
      ud.slotOpen[k] = -1; // nothing kept yet
      ud.slotOf.set(leaf, k);
      if (k >= ud.slotTop) ud.slotTop = k + 1;
    }
    ud.slotSeen[k] = 1;
    return k;
  }

  // Where one vertex of a leaf goes when the blade is unrolled only as far
  // as `open` from the stalk joint: anything beyond is wound into a coil at
  // that edge. Leaves the position and normal in this.rolled.
  roll(base, v, open, coil = ROLL) {
    const bp = base.attributes.position.array, bn = base.attributes.normal.array, bc = base.attributes.color.array;
    const i = v * 3;
    let x = bp[i], y = bp[i + 1], z = bp[i + 2];
    let nx = bn[i], ny = bn[i + 1], nz = bn[i + 2];
    if (bc[i] < 1.5) {
      // Blade (the stalk is marked by its red tint and is left alone).
      const bx = x - STALK;
      const reach = Math.hypot(bx, z);
      const wound = reach - open;
      if (wound > 0) {
        const dx = bx / reach, dz = z / reach;
        // The coil tightens towards its middle.
        const radius = coil * (1 - 0.45 * Math.min(1, wound));
        const angle = wound / radius;
        const c = Math.cos(angle), s2 = Math.sin(angle);
        const out = open + radius * s2;
        x = STALK + dx * out;
        z = dz * out;
        y = y * c + radius * (1 - c);
        // Turn the normal with the surface: about the axis across the roll.
        const nr = nx * dx + nz * dz;
        const nt = -nx * dz + nz * dx;
        const r2 = nr * c - ny * s2;
        ny = nr * s2 + ny * c;
        nx = r2 * dx - nt * dz;
        nz = r2 * dz + nt * dx;
      }
    }
    const r = this.rolled;
    r[0] = x; r[1] = y; r[2] = z; r[3] = nx; r[4] = ny; r[5] = nz;
  }

  // Writes one opening or curling leaf into its variant's mesh, at the
  // place `k` it was given (see place()). `unrolled` is how much of the
  // blade lies flat (1 = all of it); `shown` is how much of the blade exists
  // yet. X, Y and Z are the leaf's length, face and width directions.
  //
  // Bending the blade is the costly part, and a leaf unrolls slowly while
  // the wind moves it all the time. So the bent shape is kept, in the
  // leaf's own frame, and only bent afresh once the leaf has unrolled by
  // REROLL more; every frame, the kept shape is just carried to where the
  // leaf now is.
  unroll(mesh, unrolled, shown, coil, px, py, pz, Xx, Xy, Xz, Yx, Yy, Yz, Zx, Zy, Zz, tint, shade, k) {
    const base = mesh.geometry;
    const ud = mesh.userData;
    const verts = base.attributes.position.count;
    const og = ud.opening.geometry;
    const P = og.attributes.position.array, N = og.attributes.normal.array;
    const local = ud.local;
    const open = unrolled * 1.45;
    const first = k * verts;
    if (ud.slotOpen[k] < 0 || Math.abs(open - ud.slotOpen[k]) > REROLL || coil !== ud.slotCoil[k]) {
      ud.slotOpen[k] = open;
      ud.slotCoil[k] = coil;
      ud.rerolled = true;
      const bc = base.attributes.color.array;
      const C = og.attributes.color.array, G = og.attributes.grown.array;
      const tr = tint.r * shade, tg = tint.g * shade, tb = tint.b * shade;
      const r = this.rolled;
      // A dying leaf passes through the shapes it dried into; a bud is unrolled.
      const stages = coil === DRY_ROLL ? ud.stages : null;
      let from = null, to = null, mixing = 0;
      if (stages) {
        const f = Math.min(0.9999, Math.max(0, (1 - unrolled) / (1 - CURLED))) * (stages.length - 1);
        from = stages[Math.floor(f)];
        to = stages[Math.floor(f) + 1];
        mixing = f - Math.floor(f);
      }
      for (let v = 0; v < verts; v++) {
        const i = v * 3, o = (first + v) * 3, l = (first + v) * 6;
        if (stages) {
          for (let q = 0; q < 3; q++) {
            r[q] = from.position[i + q] + (to.position[i + q] - from.position[i + q]) * mixing;
            r[q + 3] = from.normal[i + q] + (to.normal[i + q] - from.normal[i + q]) * mixing;
          }
        } else this.roll(base, v, open, coil);
        local[l] = r[0]; local[l + 1] = r[1]; local[l + 2] = r[2];
        local[l + 3] = r[3]; local[l + 4] = r[4]; local[l + 5] = r[5];
        C[o] = bc[i] * tr;
        C[o + 1] = bc[i + 1] * tg;
        C[o + 2] = bc[i + 2] * tb;
        G[first + v] = shown;
      }
    }
    const yl = Math.hypot(Yx, Yy, Yz) || 1, xl = Math.hypot(Xx, Xy, Xz) || 1, zl = Math.hypot(Zx, Zy, Zz) || 1;
    const Ax = Xx / xl, Ay = Xy / xl, Az = Xz / xl, Bx = Yx / yl, By = Yy / yl, Bz = Yz / yl, Cx = Zx / zl, Cy = Zy / zl, Cz = Zz / zl;
    for (let v = 0, o = first * 3, l = first * 6; v < verts; v++, o += 3, l += 6) {
      const x = local[l], y = local[l + 1], z = local[l + 2], nx = local[l + 3], ny = local[l + 4], nz = local[l + 5];
      P[o] = px + Xx * x + Yx * y + Zx * z;
      P[o + 1] = py + Xy * x + Yy * y + Zy * z;
      P[o + 2] = pz + Xz * x + Yz * y + Zz * z;
      N[o] = Ax * nx + Bx * ny + Cx * nz;
      N[o + 1] = Ay * nx + By * ny + Cy * nz;
      N[o + 2] = Az * nx + Bz * ny + Cz * nz;
    }
  }
}
