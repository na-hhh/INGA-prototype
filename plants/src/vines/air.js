// The air around the vine, as a coarse grid of moving air.
//
// Wind is not the same everywhere: it cannot blow through rock, so it
// slows, piles up against a wall and slides along it; it spills round
// corners and over the top; and it is held back inside foliage, so leaves
// shelter each other and a cushion of slower air sits between them and the
// wall. All of that comes from one rule: air is not created or destroyed
// anywhere. Each step the air is carried along by itself, held back by
// solids and leaves, and then corrected by pressure so that as much flows
// out of every cell as into it (Stam, "Stable Fluids", 1999; the same
// advect-then-pressure scheme as the smoke in the INGA prototype, on the
// CPU and far coarser, since it only has to push leaves about).

const STEP = 1 / 20; // seconds between updates of the air

export class Air {
  constructor(distance, { min = [-30, 0, -10], max = [30, 27.5, 15], cell = 1.25 } = {}) {
    this.cell = cell;
    this.min = min;
    const nx = (this.nx = Math.round((max[0] - min[0]) / cell)), ny = (this.ny = Math.round((max[1] - min[1]) / cell)), nz = (this.nz = Math.round((max[2] - min[2]) / cell));
    const n = (this.n = nx * ny * nz);
    this.u = new Float32Array(n); this.v = new Float32Array(n); this.w = new Float32Array(n);
    this.u0 = new Float32Array(n); this.v0 = new Float32Array(n); this.w0 = new Float32Array(n);
    this.p = new Float32Array(n); this.p0 = new Float32Array(n); this.div = new Float32Array(n);
    this.leaves = new Float32Array(n); // how much foliage is in each cell
    // Which cells are solid: inside the support, or below ground.
    this.solid = new Uint8Array(n);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (distance(min[0] + (i + 0.5) * cell, min[1] + (j + 0.5) * cell, min[2] + (k + 0.5) * cell) < -0.1 * cell) this.solid[i + nx * (j + ny * k)] = 1;
    }
    this.clock = 0;
    this.out = [0, 0, 0];
    this.started = false;
  }

  // `wind` is the wind far from anything; `leafCells` fills this.leaves.
  update(dt, wind, countLeaves) {
    if (!this.started) {
      // Begin with the wind blowing straight through.
      for (let c = 0; c < this.n; c++) if (!this.solid[c]) { this.u[c] = wind[0]; this.v[c] = wind[1]; this.w[c] = wind[2]; }
      this.started = true;
    }
    this.clock += dt;
    if (this.clock < STEP) return;
    this.clock = Math.min(this.clock - STEP, STEP);
    countLeaves(this);
    this.step(STEP, wind);
  }

  step(dt, wind) {
    const { nx, ny, nz, n, cell, solid, u, v, w, u0, v0, w0, p, p0, div, leaves } = this;
    const sx = 1, sy = nx, sz = nx * ny;
    // Carry the air along with itself: each cell takes the velocity of the
    // air that arrives there, traced back along the flow.
    u0.set(u); v0.set(v); w0.set(w);
    const s = dt / cell;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = i + nx * (j + ny * k);
      if (solid[c]) {
        u[c] = v[c] = w[c] = 0;
        continue;
      }
      // The outer faces of the grid are open sky: the far wind blows there.
      if (i === 0 || i === nx - 1 || j === ny - 1 || k === 0 || k === nz - 1) {
        u[c] = wind[0]; v[c] = wind[1]; w[c] = wind[2];
        continue;
      }
      this.read(u0, v0, w0, i - u0[c] * s, j - v0[c] * s, k - w0[c] * s);
      // Foliage holds the air back; and everything is drawn gently towards
      // the far wind, which is what keeps the air moving at all.
      const hold = 1 / (1 + leaves[c] * 0.5 * dt);
      const pull = 0.25 * dt;
      u[c] = (this.out[0] + (wind[0] - this.out[0]) * pull) * hold;
      v[c] = (this.out[1] + (wind[1] - this.out[1]) * pull) * hold;
      w[c] = (this.out[2] + (wind[2] - this.out[2]) * pull) * hold;
    }
    // Pressure: find it such that, once air has been pushed from high
    // pressure to low, as much leaves each cell as enters it. Air cannot
    // enter a solid cell, so a solid neighbour simply pushes back.
    for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const c = i + nx * (j + ny * k);
      if (solid[c]) continue;
      const below = j === 0 ? 0 : v[c - sy];
      div[c] = 0.5 * (u[c + sx] - u[c - sx] + v[c + sy] - below + w[c + sz] - w[c - sz]);
    }
    for (let it = 0; it < 24; it++) {
      p0.set(p);
      for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const c = i + nx * (j + ny * k);
        if (solid[c]) continue;
        const here = p0[c];
        const a = solid[c - sx] ? here : p0[c - sx], b = solid[c + sx] ? here : p0[c + sx];
        const d = j === 0 || solid[c - sy] ? here : p0[c - sy], e = solid[c + sy] ? here : p0[c + sy];
        const f = solid[c - sz] ? here : p0[c - sz], g = solid[c + sz] ? here : p0[c + sz];
        p[c] = (a + b + d + e + f + g - div[c]) / 6;
      }
    }
    for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const c = i + nx * (j + ny * k);
      if (solid[c]) continue;
      const here = p[c];
      u[c] -= 0.5 * ((solid[c + sx] ? here : p[c + sx]) - (solid[c - sx] ? here : p[c - sx]));
      v[c] -= 0.5 * ((solid[c + sy] ? here : p[c + sy]) - (j === 0 || solid[c - sy] ? here : p[c - sy]));
      w[c] -= 0.5 * ((solid[c + sz] ? here : p[c + sz]) - (solid[c - sz] ? here : p[c - sz]));
    }
  }

  // Velocity at a point given in cells, blended between cell centres.
  read(u, v, w, gi, gj, gk) {
    const { nx, ny, nz } = this;
    const x = Math.min(nx - 1.001, Math.max(0, gi)), y = Math.min(ny - 1.001, Math.max(0, gj)), z = Math.min(nz - 1.001, Math.max(0, gk));
    const i = x | 0, j = y | 0, k = z | 0;
    const a = x - i, b = y - j, c = z - k;
    const o = i + nx * (j + ny * k), sy = nx, sz = nx * ny;
    const mixed = (f) => {
      const p = f[o] + (f[o + 1] - f[o]) * a, q = f[o + sy] + (f[o + sy + 1] - f[o + sy]) * a;
      const r = f[o + sz] + (f[o + sz + 1] - f[o + sz]) * a, t = f[o + sz + sy] + (f[o + sz + sy + 1] - f[o + sz + sy]) * a;
      const near = p + (q - p) * b;
      return near + (r + (t - r) * b - near) * c;
    };
    this.out[0] = mixed(u); this.out[1] = mixed(v); this.out[2] = mixed(w);
    return this.out;
  }

  // The air's velocity at a point in the world.
  at(x, y, z) {
    const { min, cell } = this;
    return this.read(this.u, this.v, this.w, (x - min[0]) / cell - 0.5, (y - min[1]) / cell - 0.5, (z - min[2]) / cell - 0.5);
  }

  // Sets air moving: everything within `radius` of a point is brought
  // towards a velocity, most strongly at the middle. This is how a gust
  // made by something other than the weather (a thrown ball of air, say)
  // enters the flow; after that it is air like any other.
  blow(x, y, z, vx, vy, vz, radius, strength) {
    const { min, cell, nx, ny, nz } = this;
    const r = Math.max(radius, cell * 0.9);
    const i0 = Math.max(1, Math.floor((x - r - min[0]) / cell)), i1 = Math.min(nx - 2, Math.floor((x + r - min[0]) / cell));
    const j0 = Math.max(0, Math.floor((y - r - min[1]) / cell)), j1 = Math.min(ny - 2, Math.floor((y + r - min[1]) / cell));
    const k0 = Math.max(1, Math.floor((z - r - min[2]) / cell)), k1 = Math.min(nz - 2, Math.floor((z + r - min[2]) / cell));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = i + nx * (j + ny * k);
      if (this.solid[c]) continue;
      const d = Math.hypot(min[0] + (i + 0.5) * cell - x, min[1] + (j + 0.5) * cell - y, min[2] + (k + 0.5) * cell - z) / r;
      if (d >= 1.3) continue;
      const w = strength * Math.max(0, 1 - (d * d) / 1.69);
      this.u[c] += (vx - this.u[c]) * w;
      this.v[c] += (vy - this.v[c]) * w;
      this.w[c] += (vz - this.w[c]) * w;
    }
  }

  // Which cell a point is in, or -1.
  cellAt(x, y, z) {
    const i = Math.floor((x - this.min[0]) / this.cell), j = Math.floor((y - this.min[1]) / this.cell), k = Math.floor((z - this.min[2]) / this.cell);
    if (i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz) return -1;
    return i + this.nx * (j + this.ny * k);
  }
}
