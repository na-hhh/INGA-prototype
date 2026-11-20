// A leaf drying out.
//
// A leaf blade is a fabric: soft tissue stretched over a frame of veins.
// Full of water the tissue is swollen and taut. As it dries the tissue
// shrinks a great deal and the woody veins hardly at all, the thin margin
// before the middle, and the two faces of the blade by different amounts.
// None of that can happen in a flat sheet, so the blade buckles, cups,
// crinkles between its veins and rolls up on itself. Wetting it swells the
// tissue again, though tissue that has been bone dry never quite recovers.
//
// The blade is modelled as two layers of points, the upper and lower faces,
// a small thickness apart and braced to each other (after Jeong, Park and
// Kim, "Simulation of morphology changes in drying leaves", Computer
// Graphics Forum 2013). Every link between neighbouring points has a length
// it wants to be, and that length follows the water in the tissue there.
// Links that run along a vein barely change. Each step moves the points to
// satisfy the links as nearly as possible (position-based dynamics, Müller
// et al. 2007). The shape is whatever comes out.

import { noise } from '../vines/leaf.js';

export const dryDefaults = () => ({
  humidity: 0, // water in the air: the tissue dries (or swells) towards this
  rate: 0.2, // how fast water leaves, per second
  supply: 0, // water still arriving through the stalk (0 = cut off)
  shrink: 0.32, // how much dry tissue shrinks
  veinShrink: 0.04, // how much dry veins shrink along their length
  curl: 0.24, // how much more the upper face shrinks than the lower (negative: curls under)
  recover: 0.4, // how much of the shrinkage wetting undoes
  unevenness: 0.5, // patchiness of the shrinking
  thickness: 0.035,
  veinThickness: 1.6, // how much thicker the blade is at a main vein
  gravity: 0.25,
  damping: 0.86,
  iterations: 8,
  collide: true,
  hold: 'Stalk', // or 'Table': lying loose on a flat surface
});

// How strongly a main vein runs through a point, as felt at the scale of
// the mesh, and which way it runs.
const NEAR = { strength: 0, angle: 0 };
function mainVein(bx, bz, axes, width) {
  const rho = Math.hypot(bx, bz), theta = Math.atan2(bz, bx);
  let strength = 0, angle = theta;
  for (const lobe of axes) {
    const d = theta - lobe.angle - lobe.bend * rho;
    const along = rho * Math.cos(d), across = Math.abs(rho * Math.sin(d));
    if (along <= 0 || along > lobe.length) continue;
    // Veins taper towards the tip of their lobe.
    const s = Math.exp(-((across / width) ** 2)) * (1 - 0.65 * (along / lobe.length));
    if (s > strength) {
      strength = s;
      angle = lobe.angle + lobe.bend * rho;
    }
  }
  NEAR.strength = strength;
  NEAR.angle = angle;
  return NEAR;
}

export class DryLeaf {
  // `mesh` comes from bladeMesh() in vines/leaf.js; `axes` are its lobes.
  constructor(mesh, axes, seed = 0, params = dryDefaults()) {
    this.params = params;
    this.mesh = mesh;
    const N = (this.n = mesh.count);
    const tris = mesh.tris;
    this.pos = new Float32Array(N * 6); // upper face, then lower face
    this.prev = new Float32Array(N * 6);
    this.rest = new Float32Array(N * 3);
    this.inv = new Float32Array(N * 2).fill(1); // 0 = held in place
    this.water = new Float32Array(N).fill(1);
    this.driest = new Float32Array(N); // the driest each point has ever been
    this.dry = new Float32Array(N); // how shrunk the tissue is now (0 to 1)
    this.flux = new Float32Array(N);
    this.midPos = new Float32Array(N * 3);
    this.normal = new Float32Array(N * 3);
    this.time = 0;
    for (let i = 0; i < N; i++) {
      this.rest[i * 3] = mesh.x[i];
      this.rest[i * 3 + 1] = mesh.y[i];
      this.rest[i * 3 + 2] = mesh.z[i];
    }
    // Every pair of neighbours, once.
    const seen = new Set();
    const eI = [], eJ = [];
    for (let t = 0; t < tris.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = tris[t + k], b = tris[t + ((k + 1) % 3)];
        const key = a < b ? a * N + b : b * N + a;
        if (seen.has(key)) continue;
        seen.add(key);
        eI.push(Math.min(a, b));
        eJ.push(Math.max(a, b));
      }
    }
    const E = (this.edges = eI.length);
    this.eI = Uint32Array.from(eI);
    this.eJ = Uint32Array.from(eJ);
    let total = 0;
    for (let e = 0; e < E; e++) total += this.restDistance(eI[e], eJ[e]);
    const spacing = (this.spacing = total / E);
    // Veins: how much of one each point and each link has in it.
    this.vein = new Float32Array(N);
    this.evaporate = new Float32Array(N);
    this.thick = new Float32Array(N);
    const width = Math.max(0.03, spacing * 0.7);
    for (let i = 0; i < N; i++) {
      const v = mainVein(mesh.x[i], mesh.z[i], axes, width).strength;
      this.vein[i] = v;
      const r = mesh.reach[i];
      // The margin dries first; tissue next to a big vein last.
      this.evaporate[i] = (0.2 + 0.8 * r * r) * (1 - 0.55 * v) * (0.6 + 0.8 * noise(mesh.x[i] * 4 + seed * 9, mesh.z[i] * 4 + 3));
      this.thick[i] = 1 + (params.veinThickness - 1) * v;
    }
    this.eVein = new Float32Array(E);
    this.ePatch = new Float32Array(E);
    for (let e = 0; e < E; e++) {
      const a = eI[e], b = eJ[e];
      const mx = (mesh.x[a] + mesh.x[b]) / 2, mz = (mesh.z[a] + mesh.z[b]) / 2;
      const near = mainVein(mx, mz, axes, width);
      const ex = mesh.x[b] - mesh.x[a], ez = mesh.z[b] - mesh.z[a];
      const l = Math.hypot(ex, ez) || 1;
      const along = (ex * Math.cos(near.angle) + ez * Math.sin(near.angle)) / l;
      // A link is "vein" as far as a vein passes through it and it runs the vein's way.
      this.eVein[e] = Math.min(1, near.strength * 1.4) * along * along;
      this.ePatch[e] = noise(mx * 6 + seed * 5, mz * 6 + 11) + 0.3 * noise(mx * 13 + 2, mz * 13 + seed) - 0.65;
    }
    this.place();
    // Rest lengths of the links as built: along each face, and the braces
    // that cross from one face to the other.
    this.top0 = new Float32Array(E);
    this.bot0 = new Float32Array(E);
    this.cross0 = new Float32Array(E * 2);
    const P = this.pos;
    const dist = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    for (let e = 0; e < E; e++) {
      const a = eI[e], b = eJ[e];
      this.top0[e] = dist(a, b);
      this.bot0[e] = dist(N + a, N + b);
      this.cross0[e * 2] = dist(a, N + b);
      this.cross0[e * 2 + 1] = dist(N + a, b);
    }
    this.setHold();
    // For keeping the blade from passing through itself.
    this.cellStart = new Int32Array(4096 + 1);
    this.cellItems = new Int32Array(N);
  }

  restDistance(a, b) {
    const R = this.rest;
    return Math.hypot(R[a * 3] - R[b * 3], R[a * 3 + 1] - R[b * 3 + 1], R[a * 3 + 2] - R[b * 3 + 2]);
  }

  // Puts both faces where the fresh leaf has them.
  place() {
    const N = this.n, R = this.rest, P = this.pos;
    const nrm = this.surfaceNormals(R, 0);
    const h = this.params.thickness / 2;
    for (let i = 0; i < N; i++) {
      const t = h * this.thick[i];
      for (let k = 0; k < 3; k++) {
        // Veins stand out from the underside, not the top.
        P[i * 3 + k] = R[i * 3 + k] + nrm[i * 3 + k] * h;
        P[(N + i) * 3 + k] = R[i * 3 + k] - nrm[i * 3 + k] * (2 * t - h);
      }
    }
    this.prev.set(P);
  }

  // Normals of a face of the blade, from its triangles.
  surfaceNormals(P, base) {
    const N = this.n, tris = this.mesh.tris, out = this.normal;
    out.fill(0);
    for (let t = 0; t < tris.length; t += 3) {
      const a = (base + tris[t]) * 3, b = (base + tris[t + 1]) * 3, c = (base + tris[t + 2]) * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (let k = 0; k < 3; k++) {
        const o = tris[t + k] * 3;
        out[o] += nx; out[o + 1] += ny; out[o + 2] += nz;
      }
    }
    for (let i = 0; i < N; i++) {
      const l = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]) || 1;
      out[i * 3] /= l; out[i * 3 + 1] /= l; out[i * 3 + 2] /= l;
    }
    return out;
  }

  // Held by its stalk (the points around the joint cannot move), or loose.
  setHold() {
    const N = this.n;
    const held = this.params.hold === 'Stalk';
    const radius = Math.max(0.09, this.spacing * 1.2);
    for (let i = 0; i < N; i++) {
      const near = Math.hypot(this.mesh.x[i], this.mesh.z[i]) < radius;
      this.inv[i] = this.inv[N + i] = held && near ? 0 : 1;
    }
    let low = Infinity;
    for (let i = 0; i < N; i++) low = Math.min(low, this.rest[i * 3 + 1]);
    this.floor = low - this.params.thickness;
  }

  // Back to a fresh, wet leaf.
  reset() {
    this.water.fill(1);
    this.driest.fill(0);
    this.dry.fill(0);
    this.time = 0;
    this.place();
    this.setHold();
  }

  // Water leaves through the surface, fastest at the margin, and moves
  // through the blade, fastest along the veins.
  moveWater(dt) {
    const p = this.params;
    const N = this.n, W = this.water, F = this.flux;
    F.fill(0);
    for (let e = 0; e < this.edges; e++) {
      const a = this.eI[e], b = this.eJ[e];
      const f = (W[b] - W[a]) * (0.25 + 2.5 * this.eVein[e]);
      F[a] += f;
      F[b] -= f;
    }
    const spread = Math.min(0.15, p.rate * 0.6 * dt * 6);
    let mean = 0;
    for (let i = 0; i < N; i++) {
      let w = W[i] + F[i] * spread;
      const gap = w - p.humidity;
      // Dry air draws water out; damp air or rain puts it back, more slowly.
      w -= gap * Math.min(1, p.rate * dt * (gap > 0 ? this.evaporate[i] * 2.5 : 0.8));
      if (p.supply > 0) w += (1 - w) * Math.min(1, p.supply * p.rate * dt * 6 * Math.max(0, 1 - this.mesh.reach[i] * 2.5));
      W[i] = w = w < 0 ? 0 : w > 1 ? 1 : w;
      const d = 1 - w;
      if (d > this.driest[i]) this.driest[i] = d;
      // Tissue that has been dry does not swell all the way back.
      this.dry[i] = Math.max(d, this.driest[i] * (1 - p.recover));
      mean += this.dry[i];
    }
    this.dryness = mean / N;
  }

  step(dt = 1 / 60) {
    const p = this.params;
    const N = this.n, P = this.pos, Q = this.prev, inv = this.inv;
    this.time += dt;
    this.moveWater(dt);
    const g = p.gravity * dt * dt;
    for (let i = 0; i < N * 2; i++) {
      if (inv[i] === 0) continue;
      const o = i * 3;
      for (let k = 0; k < 3; k++) {
        const v = (P[o + k] - Q[o + k]) * p.damping;
        Q[o + k] = P[o + k];
        P[o + k] += v;
      }
      P[o + 1] -= g;
    }
    const { eI, eJ, top0, bot0, cross0, eVein, ePatch, dry, thick } = this;
    const half = p.thickness;
    const table = p.hold === 'Table';
    for (let it = 0; it < p.iterations; it++) {
      for (let e = 0; e < this.edges; e++) {
        const a = eI[e], b = eJ[e];
        const d = (dry[a] + dry[b]) / 2;
        const v = eVein[e];
        // How much this link has shrunk: tissue a lot, vein hardly.
        const s = d * (p.shrink * (1 + p.unevenness * ePatch[e]) * (1 - v) + p.veinShrink * v);
        // The upper face shrinks more than the lower, which is what rolls the blade.
        const lean = p.curl * (1 - 0.7 * v);
        const ft = 1 - s * (1 + lean), fb = 1 - s * (1 - lean);
        this.link(a, b, top0[e] * ft);
        this.link(N + a, N + b, bot0[e] * fb);
        // Braces keep the two faces square to each other.
        const fm = 1 - s, l0 = (top0[e] + bot0[e]) / 2;
        const c1 = cross0[e * 2], c2 = cross0[e * 2 + 1];
        this.link(a, N + b, Math.sqrt(Math.max(1e-8, c1 * c1 - l0 * l0 + l0 * l0 * fm * fm)));
        this.link(N + a, b, Math.sqrt(Math.max(1e-8, c2 * c2 - l0 * l0 + l0 * l0 * fm * fm)));
      }
      for (let i = 0; i < N; i++) this.link(i, N + i, half * thick[i] * (1 - 0.3 * dry[i]));
      if (table) {
        const floor = this.floor;
        for (let i = 0; i < N * 2; i++) {
          const o = i * 3;
          if (P[o + 1] < floor) {
            P[o + 1] = floor;
            // It grips the table a little.
            Q[o] += (P[o] - Q[o]) * 0.3;
            Q[o + 2] += (P[o + 2] - Q[o + 2]) * 0.3;
          }
        }
      }
    }
    if (p.collide) this.separate();
  }

  // Moves two points so that they are `rest` apart.
  link(a, b, rest) {
    const P = this.pos, inv = this.inv;
    const wa = inv[a], wb = inv[b];
    const w = wa + wb;
    if (w === 0) return;
    const oa = a * 3, ob = b * 3;
    const dx = P[ob] - P[oa], dy = P[ob + 1] - P[oa + 1], dz = P[ob + 2] - P[oa + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    const k = (d - rest) / d / w;
    P[oa] += dx * k * wa; P[oa + 1] += dy * k * wa; P[oa + 2] += dz * k * wa;
    P[ob] -= dx * k * wb; P[ob + 1] -= dy * k * wb; P[ob + 2] -= dz * k * wb;
  }

  // The middle of the blade (between its two faces), and its normals.
  mid() {
    const N = this.n, P = this.pos, M = this.midPos;
    for (let i = 0; i < N * 3; i++) M[i] = (P[i] + P[N * 3 + i]) / 2;
    return M;
  }

  // Keeps parts of the blade that have curled round from passing through
  // each other: points that were far apart in the flat leaf may not come
  // closer than the gap between neighbours.
  separate() {
    const N = this.n, P = this.pos, M = this.mid(), R = this.rest, inv = this.inv;
    const min = this.spacing * 0.85, cell = min;
    const size = this.cellStart.length - 1;
    const start = this.cellStart, items = this.cellItems;
    const hashOf = (x, y, z) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (size - 1);
    start.fill(0);
    for (let i = 0; i < N; i++) start[hashOf(Math.floor(M[i * 3] / cell), Math.floor(M[i * 3 + 1] / cell), Math.floor(M[i * 3 + 2] / cell))]++;
    let sum = 0;
    for (let c = 0; c <= size; c++) {
      sum += start[c];
      start[c] = sum;
    }
    for (let i = 0; i < N; i++) items[--start[hashOf(Math.floor(M[i * 3] / cell), Math.floor(M[i * 3 + 1] / cell), Math.floor(M[i * 3 + 2] / cell))]] = i;
    const apart = min * 2.6;
    for (let i = 0; i < N; i++) {
      const x = M[i * 3], y = M[i * 3 + 1], z = M[i * 3 + 2];
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let a = cx - 1; a <= cx + 1; a++) for (let b = cy - 1; b <= cy + 1; b++) for (let c = cz - 1; c <= cz + 1; c++) {
        const h = hashOf(a, b, c);
        for (let q = start[h]; q < start[h + 1]; q++) {
          const j = items[q];
          if (j <= i) continue;
          const dx = M[j * 3] - x, dy = M[j * 3 + 1] - y, dz = M[j * 3 + 2] - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= min * min || d2 < 1e-12) continue;
          if (Math.hypot(R[j * 3] - R[i * 3], R[j * 3 + 1] - R[i * 3 + 1], R[j * 3 + 2] - R[i * 3 + 2]) < apart) continue;
          const wi = inv[i], wj = inv[j];
          if (wi + wj === 0) continue;
          const d = Math.sqrt(d2);
          const k = ((min - d) / d / (wi + wj)) * 0.5;
          for (const o of [i * 3, (N + i) * 3]) {
            P[o] -= dx * k * wi; P[o + 1] -= dy * k * wi; P[o + 2] -= dz * k * wi;
          }
          for (const o of [j * 3, (N + j) * 3]) {
            P[o] += dx * k * wj; P[o + 1] += dy * k * wj; P[o + 2] += dz * k * wj;
          }
        }
      }
    }
  }
}

// Dries a leaf from fresh to crisp and keeps its shape at even stages on the
// way, as plain meshes anything else can use. A generator, so the work can
// be spread over several frames: it yields now and then, and finally
// returns [{ position, normal, dry }] with `stages + 1` entries, the first
// being the fresh leaf.
export function* dryingStages(mesh, axes, seed = 0, stages = 4, overrides = {}) {
  const params = { ...dryDefaults(), gravity: 0, rate: 0.6, ...overrides };
  const leaf = new DryLeaf(mesh, axes, seed, params);
  const keep = () => {
    const position = Float32Array.from(leaf.mid());
    const normal = Float32Array.from(leaf.surfaceNormals(position, 0));
    return { position, normal, dry: Float32Array.from(leaf.dry) };
  };
  const frames = [keep()];
  for (let step = 0; step < 4000 && frames.length <= stages; step++) {
    leaf.step();
    if (leaf.dryness >= (frames.length / stages) * 0.985) {
      // Let the last one come to rest.
      if (frames.length === stages) for (let k = 0; k < 90; k++) leaf.step();
      frames.push(keep());
    }
    if (step % 12 === 0) yield frames.length;
  }
  while (frames.length <= stages) frames.push(keep());
  return frames;
}
