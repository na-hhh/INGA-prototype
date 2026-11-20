import { clamp } from './math.js';

// Water particles a 1x1 patch of soil can hold against gravity.
export const FIELD_CAPACITY = 8;
// How much plant-side water / mineral one soil particle is worth.
export const WATER_UNIT = 1.5;
export const MINERAL_UNIT = 2;

const DRAIN = 0.6; // downward speed per particle above field capacity
const EVAPORATION = 0.006; // chance per hour, per particle in the top layer
const UPTAKE_WATER = 0.08;
const UPTAKE_MINERAL = 0.04;

class Particles {
  constructor(max) {
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.n = 0;
    this.max = max;
  }
  add(x, y) {
    if (this.n >= this.max) return;
    this.x[this.n] = x;
    this.y[this.n] = y;
    this.n++;
  }
  remove(i) {
    const last = --this.n;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
  }
}

// A 2D slab of soil (x across, y down from 0) holding water and dissolved
// minerals as particles. A coarse grid counts them so that water can drain
// when a patch is over-full and roots can sense which way is wetter.
export class Soil {
  constructor(rng, { width = 60, depth = 24 } = {}) {
    this.rng = rng;
    this.width = width;
    this.depth = depth;
    this.half = width / 2;
    this.nx = width;
    this.ny = depth;
    const n = this.nx * this.ny;
    this.waterCount = new Float32Array(n);
    this.mineralCount = new Float32Array(n);
    this.absorb = new Float32Array(n); // absorbing root surface per patch
    this.water = new Particles(18000);
    this.minerals = new Particles(8000);
  }

  idx(x, y) {
    const ix = clamp(Math.floor(x + this.half), 0, this.nx - 1);
    const iy = clamp(Math.floor(-y), 0, this.ny - 1);
    return ix + this.nx * iy;
  }

  fill(moisture, mineralCount) {
    const { rng, width, depth, half } = this;
    const nWater = Math.round(this.nx * this.ny * FIELD_CAPACITY * moisture);
    for (let i = 0; i < nWater; i++) this.water.add(rng() * width - half, -rng() * depth);
    // Minerals are patchy: a thin background plus a few rich pockets.
    const pockets = [];
    for (let i = 0; i < 7; i++) pockets.push([(rng() - 0.5) * width * 0.85, -2 - rng() * (depth - 4)]);
    for (let i = 0; i < mineralCount; i++) {
      if (rng() < 0.5) {
        this.minerals.add(rng() * width - half, -rng() * depth);
      } else {
        const p = pockets[Math.floor(rng() * pockets.length)];
        const x = clamp(p[0] + (rng() + rng() + rng() - 1.5) * 4, -half + 0.1, half - 0.1);
        const y = clamp(p[1] + (rng() + rng() + rng() - 1.5) * 4, -depth + 0.1, -0.1);
        this.minerals.add(x, y);
      }
    }
    this.recount();
  }

  addWater(count) {
    for (let i = 0; i < count; i++) this.water.add(this.rng() * this.width - this.half, -0.05 - this.rng() * 0.6);
  }

  addMinerals(count) {
    for (let i = 0; i < count; i++) this.minerals.add(this.rng() * this.width - this.half, -0.1 - this.rng() * 4);
  }

  recount() {
    this.waterCount.fill(0);
    this.mineralCount.fill(0);
    const w = this.water;
    for (let i = 0; i < w.n; i++) this.waterCount[this.idx(w.x[i], w.y[i])]++;
    const m = this.minerals;
    for (let i = 0; i < m.n; i++) this.mineralCount[this.idx(m.x[i], m.y[i])]++;
  }

  waterAt(x, y) {
    return this.waterCount[this.idx(x, y)];
  }

  // Direction of increasing moisture around a point, roughly in [-1, 1].
  waterGradient(x, y, out) {
    const c = this.waterCount;
    out[0] = (c[this.idx(x + 1.5, y)] - c[this.idx(x - 1.5, y)]) / FIELD_CAPACITY;
    out[1] = (c[this.idx(x, y + 1.5)] - c[this.idx(x, y - 1.5)]) / FIELD_CAPACITY;
    return out;
  }

  // Moves every particle one step and lets roots take up to the given number
  // of water and mineral particles. Returns how many were actually taken.
  step(dt, evapDrive, waterRoom, mineralRoom) {
    this.recount();
    const { rng, half, depth, waterCount, absorb } = this;
    let tookWater = 0;
    let tookMinerals = 0;

    const w = this.water;
    for (let i = w.n - 1; i >= 0; i--) {
      const ci = this.idx(w.x[i], w.y[i]);
      const count = waterCount[ci];
      const roots = absorb[ci];
      if (roots > 0 && tookWater < waterRoom && rng() < 1 - Math.exp(-UPTAKE_WATER * roots * dt)) {
        w.remove(i);
        waterCount[ci]--;
        tookWater++;
        continue;
      }
      if (w.y[i] > -1.5 && rng() < EVAPORATION * evapDrive * dt) {
        w.remove(i);
        continue;
      }
      const excess = count - FIELD_CAPACITY;
      // Wet soil lets water spread; dry soil holds on to what it has.
      const spread = Math.sqrt(6 * (0.03 + 0.08 * Math.min(count / FIELD_CAPACITY, 2)) * dt);
      let x = w.x[i] + (rng() * 2 - 1) * spread;
      let y = w.y[i] + (rng() * 2 - 1) * spread;
      if (excess > 0) y -= Math.min(1, DRAIN * excess * dt);
      if (x < -half) x = -half - (x + half);
      else if (x > half) x = half - (x - half);
      if (y > -0.02) y = -0.02;
      if (y < -depth) {
        if (excess > 0) {
          w.remove(i); // drains out of the bottom
          continue;
        }
        y = -depth + 0.02;
      }
      w.x[i] = x;
      w.y[i] = y;
    }

    const m = this.minerals;
    for (let i = m.n - 1; i >= 0; i--) {
      const ci = this.idx(m.x[i], m.y[i]);
      const count = waterCount[ci];
      const roots = absorb[ci];
      // Minerals only move, and are only taken up, dissolved in water.
      if (roots > 0 && count >= 1 && tookMinerals < mineralRoom && rng() < 1 - Math.exp(-UPTAKE_MINERAL * roots * dt)) {
        m.remove(i);
        tookMinerals++;
        continue;
      }
      const excess = count - FIELD_CAPACITY;
      const spread = Math.sqrt(6 * 0.015 * Math.min(count / FIELD_CAPACITY, 1.5) * dt);
      let x = m.x[i] + (rng() * 2 - 1) * spread;
      let y = m.y[i] + (rng() * 2 - 1) * spread;
      if (excess > 0) y -= Math.min(1, DRAIN * 0.3 * excess * dt); // leaching
      x = clamp(x, -half + 0.01, half - 0.01);
      if (y > -0.02) y = -0.02;
      if (y < -depth) {
        if (excess > 0) {
          m.remove(i);
          continue;
        }
        y = -depth + 0.02;
      }
      m.x[i] = x;
      m.y[i] = y;
    }

    return [tookWater, tookMinerals];
  }
}
