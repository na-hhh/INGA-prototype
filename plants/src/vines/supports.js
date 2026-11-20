// Things for vines to climb. Each support is a list of simple solids, so
// the same description gives both the mesh that is drawn and an exact
// distance-to-surface function for the vines to feel their way along.
//
//   box:      centre c, half-size h
//   cylinder: centre c, radius r, half-length h (upright, or lying along axis 'x' or 'z')
// A part may name its material: 'concrete' or 'metal'; `glow` makes it a lamp.
//   sphere:   centre c, radius r

import { buildCliff, loadCliff } from './cliff.js';

// The cliff is made of scanned rock (see cliff.js) rather than parts. Its
// scans have to be loaded before it can be built: `await support.prepare()`.
let cliff = null;
const cliffSupport = {
  async prepare() {
    cliff ??= buildCliff(await loadCliff());
  },
  build: () => cliff,
  get seeds() { return cliff.seeds; },
};


// A concrete wall with things on it for a vine to get round: ledges and
// piers, a balcony with a railing, pipes, brackets, bars left sticking out,
// and lamps on arms.
function concreteWall() {
  const parts = [];
  const box = (c, h, material = 'concrete', extra = {}) => parts.push({ type: 'box', c, h, material, ...extra });
  const bar = (c, r, h, axis, extra = {}) => parts.push({ type: 'cylinder', c, r, h, axis, material: 'metal', ...extra });
  box([0, 9, -0.8], [20, 9, 0.8]); // the wall
  box([0, 0.6, 0.15], [20.3, 0.6, 0.35]); // plinth
  box([0, 8.6, 0.3], [20.2, 0.22, 0.5]); // a ledge half-way up
  box([0, 18.2, 0.1], [20.4, 0.3, 1.2]); // coping, overhanging
  for (const x of [-20, -10, 0, 10, 20]) box([x, 9, 0.2], [0.7, 9, 0.35]); // piers
  // Balcony: a slab on brackets, with a railing round it.
  box([5, 5.2, 1.6], [3.4, 0.16, 1.6]);
  for (const x of [2.4, 7.6]) box([x, 4.7, 1.2], [0.15, 0.4, 1.1]);
  for (let x = 1.7; x <= 8.31; x += 0.6) bar([x, 5.95, 3.1], 0.03, 0.6, 'y');
  for (const x of [1.7, 8.3]) for (let z = 0.4; z < 3; z += 0.6) bar([x, 5.95, z], 0.03, 0.6, 'y');
  for (const y of [6.55, 5.9]) {
    bar([5, y, 3.1], y > 6 ? 0.055 : 0.03, 3.35, 'x');
    for (const x of [1.7, 8.3]) bar([x, y, 1.55], y > 6 ? 0.055 : 0.03, 1.55, 'z');
  }
  // A long handrail low on the left, standing off the wall on stubs.
  bar([-11, 3.2, 0.75], 0.06, 6.5, 'x');
  for (let x = -17; x <= -5; x += 3) bar([x, 3.2, 0.38], 0.04, 0.4, 'z');
  // Downpipes with their brackets, and a fat pipe that comes out and turns down.
  for (const x of [-15.2, 14.6]) {
    bar([x, 9.3, 0.55], 0.16, 8.6, 'y');
    for (const y of [2.5, 7, 11.5, 16]) box([x, y, 0.4], [0.24, 0.06, 0.26], 'metal');
  }
  bar([-4.5, 12.4, 0.8], 0.28, 0.9, 'z');
  bar([-4.5, 11.2, 1.55], 0.28, 1.25, 'y');
  // Bars and stubs left sticking out of the concrete.
  const stubs = [[-18, 12, 0.07, 1.1], [-12.5, 14.5, 0.1, 0.8], [-8, 6.3, 0.05, 1.3], [-2, 15.6, 0.12, 0.7], [1.5, 10.6, 0.06, 1.5], [8.5, 13.2, 0.09, 1], [12.3, 4.4, 0.07, 1.2], [16.8, 10.2, 0.11, 0.9], [17.5, 15.3, 0.05, 1.4], [-6.3, 2.4, 0.08, 0.9]];
  for (const [x, y, r, len] of stubs) bar([x, y, len / 2], r, len / 2, 'z');
  for (const x of [-17.5, -17.1, -9.2, 6.8, 7.3, 13.9]) bar([x, 18.9, -0.3 + 0.3 * Math.sin(x)], 0.035, 0.5, 'y'); // reinforcing bar out of the top
  // Lamps on arms.
  for (const x of [-9, 3, 14]) {
    bar([x, 14.6, 1.1], 0.05, 1.1, 'z');
    bar([x, 14.2, 0.7], 0.035, 0.85, 'z');
    box([x, 14.45, 2.25], [0.22, 0.09, 0.42], 'metal');
    box([x, 14.34, 2.25], [0.16, 0.03, 0.34], 'metal', { glow: true });
  }
  return parts;
}

export const SUPPORTS = {
  Cliff: cliffSupport,
  'Concrete wall': {
    parts: concreteWall(),
    seeds: [[-6, 0.15, 0.6], [5, 0.15, 0.6], [15, 0.15, 0.6]],
    size: 'large',
  },
  Wall: {
    parts: [{ type: 'box', c: [0, 7, -0.6], h: [12, 7, 0.6] }],
    seeds: [[-6, 0.15, 0.3], [0.5, 0.15, 0.3], [7, 0.15, 0.3]],
  },
  'Wall with window': {
    parts: [
      { type: 'box', c: [0, 2.5, -0.6], h: [12, 2.5, 0.6] },
      { type: 'box', c: [0, 12, -0.6], h: [12, 2, 0.6] },
      { type: 'box', c: [-8, 7.5, -0.6], h: [4, 2.5, 0.6] },
      { type: 'box', c: [8, 7.5, -0.6], h: [4, 2.5, 0.6] },
    ],
    seeds: [[-7, 0.15, 0.3], [1, 0.15, 0.3], [8, 0.15, 0.3]],
  },
  Pillar: {
    parts: [{ type: 'cylinder', c: [0, 8, 0], r: 1.5, h: 8 }],
    seeds: [[1.8, 0.15, 0.2], [-1.6, 0.15, -0.9]],
  },
  Arch: {
    parts: [
      { type: 'cylinder', c: [-5, 6, 0], r: 1.1, h: 6 },
      { type: 'cylinder', c: [5, 6, 0], r: 1.1, h: 6 },
      { type: 'box', c: [0, 12.8, 0], h: [6.6, 0.8, 1.3] },
    ],
    seeds: [[-5, 0.15, 1.4], [5, 0.15, 1.4]],
  },
  Trellis: {
    parts: [
      ...[-8, -4, 0, 4, 8].map((x) => ({ type: 'box', c: [x, 6, 0], h: [0.18, 6, 0.18] })),
      ...[3, 6, 9, 12].map((y) => ({ type: 'box', c: [0, y, 0], h: [8.2, 0.15, 0.15] })),
    ],
    seeds: [[-8, 0.15, 0.4], [0, 0.15, 0.4], [8, 0.15, 0.4]],
  },
  Boulder: {
    parts: [{ type: 'sphere', c: [0, 2.2, 0], r: 5 }],
    seeds: [[0.5, 0.15, 4.6], [-4.4, 0.15, -1]],
  },
};

// Math.hypot is careful about overflow and slow for it; lengths here are small.
const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c);
function partDistance(p, x, y, z) {
  const dx = x - p.c[0];
  const dy = y - p.c[1];
  const dz = z - p.c[2];
  if (p.type === 'sphere') return hyp(dx, dy, dz) - p.r;
  if (p.type === 'cylinder') {
    // Upright unless it says which way it lies.
    const radial = (p.axis === 'x' ? hyp(dy, dz) : p.axis === 'z' ? hyp(dx, dy) : hyp(dx, dz)) - p.r;
    const axial = Math.abs(p.axis === 'x' ? dx : p.axis === 'z' ? dz : dy) - p.h;
    return Math.min(Math.max(radial, axial), 0) + hyp(Math.max(radial, 0), Math.max(axial, 0));
  }
  const qx = Math.abs(dx) - p.h[0];
  const qy = Math.abs(dy) - p.h[1];
  const qz = Math.abs(dz) - p.h[2];
  return hyp(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
}

// Distance from a point to the nearest surface: the support or the ground.
//
// The vine asks this many thousands of times a frame, so supports made of
// several parts are sorted into a coarse grid first. Each cell lists only
// the parts that could be the nearest one somewhere inside it: a part is
// left out when some other part is certain to be nearer everywhere in the
// cell (distance cannot change faster than position, so the distances at
// the cell's centre bound those in the rest of it). The answer is exactly
// the same as checking every part; outside the grid every part is checked.
export function distanceField(support) {
  if (support.build) return support.build().distance;
  const parts = support.parts;
  const all = (x, y, z) => {
    let d = y; // the ground
    for (let i = 0; i < parts.length; i++) {
      const pd = partDistance(parts[i], x, y, z);
      if (pd < d) d = pd;
    }
    return d;
  };
  if (parts.length < 3) return all;

  const CELL = 1, PAD = 4;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const half = p.type === 'box' ? p.h : p.type === 'cylinder' ? (p.axis === 'x' ? [p.h, p.r, p.r] : p.axis === 'z' ? [p.r, p.r, p.h] : [p.r, p.h, p.r]) : [p.r, p.r, p.r];
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], p.c[a] - half[a]);
      hi[a] = Math.max(hi[a], p.c[a] + half[a]);
    }
  }
  const x0 = lo[0] - PAD, y0 = Math.max(0, lo[1] - PAD) - CELL, z0 = lo[2] - PAD;
  const nx = Math.ceil((hi[0] + PAD - x0) / CELL), ny = Math.ceil((hi[1] + PAD - y0) / CELL), nz = Math.ceil((hi[2] + PAD - z0) / CELL);
  const reach = (CELL * Math.sqrt(3)) / 2 + 1e-6; // centre of a cell to its corner
  const cells = new Array(nx * ny * nz);
  const dist = new Float64Array(parts.length);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const cx = x0 + (i + 0.5) * CELL, cy = y0 + (j + 0.5) * CELL, cz = z0 + (k + 0.5) * CELL;
        let nearest = cy; // the ground counts as a rival too
        for (let q = 0; q < parts.length; q++) {
          dist[q] = partDistance(parts[q], cx, cy, cz);
          if (dist[q] < nearest) nearest = dist[q];
        }
        const keep = [];
        for (let q = 0; q < parts.length; q++) if (dist[q] - reach <= nearest + reach) keep.push(parts[q]);
        cells[i + nx * (j + ny * k)] = keep;
      }
    }
  }
  return (x, y, z) => {
    const i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL), k = Math.floor((z - z0) / CELL);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return all(x, y, z);
    const near = cells[i + nx * (j + ny * k)];
    let d = y;
    for (let q = 0; q < near.length; q++) {
      const pd = partDistance(near[q], x, y, z);
      if (pd < d) d = pd;
    }
    return d;
  };
}
