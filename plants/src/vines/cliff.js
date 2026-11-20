import * as THREE from 'three/webgpu';
import { float, mix, normalMap, texture, transformNormalToView, uniform, uv } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRng } from '../sim/math.js';
import { loadSurface, surfaceMaterial, tri, triTilt } from './surface.js';
import { modelSource } from './scans.js';

// A cliff to climb, put together from photoscanned rock: real cliff faces
// stacked into a wall some fifty units wide and over twenty high, with
// scanned boulders fallen at its foot. The scans are Poly Haven's (CC0;
// see scans.js for where they are loaded from): "mountainside",
// "coastal_cliff_02", "namaqualand_cliff_01/02" and several boulders,
// around two and a half million triangles in all.
//
// The vine needs to know how far it is from the rock at any point. That is
// worked out once, on a grid, from the scans' own points, so the vine
// touches the rock exactly where the rock is seen to be.

const CELL = 0.18;
const X0 = -28, X1 = 28, Y0 = 0.04, Y1 = 27, Z0 = -9.5, Z1 = 13;
const WALL = -6; // a plain slab of rock stands behind the scans, to close any gaps

// Where each piece goes: [model, x, y, z, size (times its scanned size), turn about y, lean back]
const PIECES = [
  ['mountainside', -16, -0.3, 0, 2.2, 0.12, 0],
  ['mountainside', 0.5, -0.6, -1.3, 2.05, -0.03, 0.03],
  ['mountainside', 16, -0.4, -0.4, 2.3, -0.14, -0.04],
  ['coastal_cliff_02', 0, -0.2, 5.6, 1.15, 0, 0],
  ['namaqualand_cliff_02', 3, 17.5, -2.5, 1.5, 0.05, -0.5],
  ['namaqualand_cliff_01', -19, -0.3, 9, 1.25, 0.5, 0],
  ['namaqualand_cliff_01', 20, -0.5, 9.3, 1.1, -2.6, 0],
];
const BOULDERS = ['boulder_01', 'namaqualand_boulder_06', 'namaqualand_boulder_03', 'boulder_01', 'rock_07', 'rock_09'];

// The thirteen neighbours of a grid point that a sweep reaches before it.
const BEFORE = [];
for (let dk = -1; dk <= 0; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
  if (dk < 0 || dj < 0 || (dj === 0 && di < 0)) BEFORE.push([di, dj, dk]);
}

let loading = null;
export function loadCliff() {
  return (loading ??= (async () => {
    const models = {};
    const names = [...new Set([...PIECES.map((p) => p[0]), ...BOULDERS])];
    const [detail] = await Promise.all([
      loadSurface('rock_face_03'),
      ...names.map(async (name) => {
        // From Poly Haven, the files the .gltf names sit at their own urls.
        const src = await modelSource(name);
        const manager = new THREE.LoadingManager();
        if (src.files) manager.setURLModifier((u) => src.files[Object.keys(src.files).find((rel) => u.endsWith(rel))] ?? u);
        const scene = (await new GLTFLoader(manager).loadAsync(src.url)).scene;
        let mesh = null;
        scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        models[name] = { geometry: mesh.geometry, material: scanMaterial(mesh.material, detail0), size: Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) };
      }),
    ]);
    detail0.resolve(detail);
    return { models, detail };
  })());
}
// The detail maps arrive while the models are still loading; materials are
// finished once both are in.
const detail0 = (() => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
})();

const wetness = uniform(0);
export const cliffWet = wetness;

// A scan carries its own colour, normal and roughness maps. From any
// distance that is all it needs, but close up one scan stretched over a
// cliff goes soft, so a fine layer of rock grain is laid over it: small
// bumps and speckled roughness that stay crisp however near the camera is.
function scanMaterial(source, pending) {
  const material = new THREE.MeshStandardNodeMaterial();
  pending.promise.then((detail) => {
    const base = normalMap(texture(source.normalMap, uv()));
    const grain = triTilt(detail.normal, float(0.55), 0.3).add(triTilt(detail.normal, float(2.3), 0.2));
    material.normalNode = base.add(transformNormalToView(grain)).normalize();
    const arm = texture(source.roughnessMap ?? source.aoMap, uv());
    const speck = tri(detail.arm, float(1.7)).g.mul(0.3).add(0.82);
    const tone = tri(detail.diffuse, float(0.9)).g.mul(0.3).add(0.88);
    material.colorNode = texture(source.map, uv()).rgb.mul(arm.r.mul(0.6).add(0.4)).mul(tone).mul(mix(float(1), float(0.58), wetness));
    const rough = arm.g.mul(speck).clamp(0.15, 1);
    material.roughnessNode = mix(rough, rough.mul(0.45), wetness.mul(0.85));
    material.metalnessNode = float(0);
    material.needsUpdate = true;
  });
  return material;
}

export function buildCliff(assets, seed = 1) {
  const rng = createRng(1000 + seed);
  const nx = Math.round((X1 - X0) / CELL) + 1, ny = Math.round((Y1 - Y0) / CELL) + 1, nz = Math.round((Z1 - Z0) / CELL) + 1;
  // Distance to the nearest rock at each grid point: far, until shown otherwise.
  const FAR = 1e3;
  const grid = new Float32Array(nx * ny * nz).fill(FAR);
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), euler = new THREE.Euler(), v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  const taken = new Uint8Array(Math.ceil(nx * 2) * Math.ceil(ny * 2) * Math.ceil(nz * 2) / 8 + 1);

  // Draws a scan somewhere and writes it into the grid: every grid point
  // near one of its points learns how far away that point is, and from the
  // way the surface faces there, whether it is inside the rock or outside.
  const place = (name, x, y, z, scale, ry, rx, rz = 0) => {
    const model = assets.models[name];
    m.compose(v.set(x, y, z), q.setFromEuler(euler.set(rx, ry, rz, 'YXZ')), new THREE.Vector3(scale, scale, scale));
    const mesh = new THREE.Mesh(model.geometry, model.material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(m);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    nm.setFromMatrix4(m);
    const P = model.geometry.attributes.position, N = model.geometry.attributes.normal;
    const R = 2; // grid points each way that one point of the scan informs
    const hx = Math.ceil(nx * 2), hy = Math.ceil(ny * 2);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m);
      const gx = (v.x - X0) / CELL, gy = (v.y - Y0) / CELL, gz = (v.z - Z0) / CELL;
      if (gx < -R || gy < -R || gz < -R || gx > nx + R || gy > ny + R || gz > nz + R) continue;
      // Scans are far finer than the grid: one point per half grid cell is plenty.
      const key = Math.floor(gx * 2 + 4) + hx * (Math.floor(gy * 2 + 4) + hy * Math.floor(gz * 2 + 4));
      if (key >= 0 && key >> 3 < taken.length) {
        if (taken[key >> 3] & (1 << (key & 7))) continue;
        taken[key >> 3] |= 1 << (key & 7);
      }
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      const ci = Math.round(gx), cj = Math.round(gy), ck = Math.round(gz);
      for (let k = Math.max(0, ck - R); k <= Math.min(nz - 1, ck + R); k++) for (let j = Math.max(0, cj - R); j <= Math.min(ny - 1, cj + R); j++) for (let ii = Math.max(0, ci - R); ii <= Math.min(nx - 1, ci + R); ii++) {
        const dx = X0 + ii * CELL - v.x, dy = Y0 + j * CELL - v.y, dz = Z0 + k * CELL - v.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const o = ii + nx * (j + ny * k);
        if (d < Math.abs(grid[o])) grid[o] = dx * n.x + dy * n.y + dz * n.z < 0 ? -d : d;
      }
    }
    taken.fill(0);
  };
  for (const [name, x, y, z, scale, turn, lean] of PIECES) place(name, x, y, z, scale, turn, lean);
  // Boulders fallen at the foot: a few great blocks, more middling ones, and rubble.
  for (let k = 0; k < 44; k++) {
    const name = BOULDERS[k % BOULDERS.length];
    const size = k < 6 ? 3.2 + rng() * 2.8 : k < 20 ? 1.2 + rng() * 1.6 : 0.4 + rng() * 0.6;
    const x = (rng() * 2 - 1) * 25, z = 8.5 + rng() * rng() * 3.6 + (k < 6 ? 1 : 0);
    place(name, x, -0.14 * size, Math.min(Z1 - size * 0.6, z), size / assets.models[name].size, rng() * 6.28, (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4);
  }
  // The slab behind, and its distances.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(54, 21, 3), surfaceMaterial(assets.detail, { tile: 7, strength: 1.5, tint: '#8a8078' }));
  slab.position.set(0, 10.5, WALL - 1.5);
  slab.castShadow = slab.receiveShadow = true;
  slab.material.userData.wet = wetness;
  group.add(slab);
  for (let k = 0; k < nz; k++) {
    const dz = Z0 + k * CELL - WALL;
    for (let j = 0; j < ny; j++) {
      const dy = Y0 + j * CELL - 21;
      for (let i = 0; i < nx; i++) {
        const dx = Math.abs(X0 + i * CELL) - 27;
        const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0);
        const o = i + nx * (j + ny * k);
        if (outside < Math.abs(grid[o]) || (outside < 0 && grid[o] > 0)) grid[o] = outside;
      }
    }
  }
  // Grid points that no scan came near learn their distance from their
  // neighbours, in two sweeps (a chamfer distance transform).
  const sweep = (dir) => {
    const s = dir > 0 ? 0 : 1;
    for (let kk = 0; kk < nz; kk++) for (let jj = 0; jj < ny; jj++) for (let ii = 0; ii < nx; ii++) {
      const i = s ? nx - 1 - ii : ii, j = s ? ny - 1 - jj : jj, k = s ? nz - 1 - kk : kk;
      const o = i + nx * (j + ny * k);
      let best = Math.abs(grid[o]), sign = grid[o] < 0 ? -1 : 1;
      if (best < CELL * 2) continue;
      for (let c = 0; c < 13; c++) {
        const di = BEFORE[c][0], dj = BEFORE[c][1], dk = BEFORE[c][2];
        const i2 = i + di * dir, j2 = j + dj * dir, k2 = k + dk * dir;
        if (i2 < 0 || j2 < 0 || k2 < 0 || i2 >= nx || j2 >= ny || k2 >= nz) continue;
        const g = grid[i2 + nx * (j2 + ny * k2)];
        const d = Math.abs(g) + CELL * Math.sqrt(di * di + dj * dj + dk * dk);
        if (d < best) {
          best = d;
          sign = g < 0 ? -1 : 1;
        }
      }
      grid[o] = best * sign;
    }
  };
  sweep(1);
  sweep(-1);

  // Distance anywhere: read from the grid, blending between grid points.
  const sample = (x, y, z) => {
    const gx = Math.min(nx - 1.001, Math.max(0, (x - X0) / CELL)), gy = Math.min(ny - 1.001, Math.max(0, (y - Y0) / CELL)), gz = Math.min(nz - 1.001, Math.max(0, (z - Z0) / CELL));
    const i = gx | 0, j = gy | 0, k = gz | 0;
    const u = gx - i, w = gy - j, t = gz - k;
    const o = i + nx * (j + ny * k), oz = o + nx * ny;
    const a = grid[o] + (grid[o + 1] - grid[o]) * u, b = grid[o + nx] + (grid[o + nx + 1] - grid[o + nx]) * u;
    const c = grid[oz] + (grid[oz + 1] - grid[oz]) * u, d = grid[oz + nx] + (grid[oz + nx + 1] - grid[oz + nx]) * u;
    const near = a + (b - a) * w;
    return near + (c + (d - c) * w - near) * t;
  };
  const distance = (x, y, z) => {
    let d = sample(x, y, z) * 0.95;
    // Beyond the grid: at least as far as the way back to it.
    const ox = Math.max(X0 - x, x - X1, 0), oy = Math.max(y - Y1, 0), oz = Math.max(Z0 - z, z - Z1, 0);
    if (ox > 0 || oy > 0 || oz > 0) d = Math.max(d, 0.2) + Math.hypot(ox, oy, oz);
    return Math.min(d, y); // and there is always the ground
  };
  // Somewhere at the foot of the face to plant the first vine.
  const seeds = [];
  for (const x of [0, -9, 9]) {
    let z = Z1 - 0.5; // walking in from the front until rock is met
    while (z > Z0 && sample(x, 0.3, z) > 0.12) z -= 0.05;
    seeds.push([x, 0.3, z]);
  }
  let triangles = 0;
  group.traverse((o) => { if (o.isMesh) triangles += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; });
  return { distance, group, seeds, triangles };
}
