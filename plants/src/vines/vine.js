// A living vine.
//
// The vine is a tree of nodes, a short step apart. Growing tips add nodes;
// each tip decides where to step next by adding up a few urges:
//   - keep going the way it was going
//   - head for the target (the lead shoot only: this is what the cursor steers)
//   - climb towards the light, wander a little
//   - cling to any surface within reach
// A tip that would pass through the surface slides along it instead.
//
// Nodes touching the surface take hold and stay put. Nodes that are not
// holding on are simulated as a rope: they have weight, swing in the wind,
// resist bending, cannot pass through the surface, and may take hold if
// they come to rest against it.
//
// Leaves sprout on young nodes, grow, darken, and after their lifetime
// turn, let go and drift to the ground.

// Math.hypot is careful about overflow and slow for it; lengths here are small.
const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c);
const EPS = 0.02;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export const LEAF = { FREE: 0, ON: 1, FALLING: 2, GROUND: 3, WITHERED: 4 };
export const TENDRIL = { FREE: 0, SEARCHING: 1, GRIPPING: 2, CURLED: 3 };
export const SWEEP_RATE = 1.4; // radians per second a searching tendril circles at
export const SWEEP_CONE = 0.45; // half-angle of that circle
const LIGHT_PERIOD = 1.5; // seconds between two measurements of the light on a leaf

const canopyKey = (x, y, z) => (Math.floor(x / 0.8) * 73856093) ^ (Math.floor(y / 0.8) * 19349663) ^ (Math.floor(z / 0.8) * 83492791);

export class VineSim {
  constructor(params, distance, rng, maxNodes = 40000, maxLeaves = 30000) {
    this.params = params;
    this.distance = distance;
    this.rng = rng;
    this.max = maxNodes;
    this.maxLeaves = maxLeaves;
    const f = (n = maxNodes) => new Float32Array(n);
    // Nodes.
    this.x = f(); this.y = f(); this.z = f();
    this.px = f(); this.py = f(); this.pz = f(); // previous position (the rope's memory of its motion)
    this.nx = f(); this.ny = f(); this.nz = f(); // surface normal where the node took hold
    this.ax = f(); this.ay = f(); this.az = f(); // a sideways direction, for building the stem tube
    this.bx = f(); this.by = f(); this.bz = f(); // the bend this node was grown with
    this.born = f();
    this.along = f(); // distance along the stem from its root
    this.weight = f(); // how much vine grows beyond this node
    this.parent = new Int32Array(maxNodes);
    this.attached = new Uint8Array(maxNodes);
    this.n = 0;
    // The nodes that are not holding on, oldest first: only these are
    // simulated, so a vine that is mostly settled costs almost nothing.
    this.loose = new Int32Array(maxNodes);
    this.looseCount = 0;
    // Where each loose node last measured its distance to the surface, and
    // what it was. Until the node has moved that far it cannot be touching
    // anything, so the surface need not be asked again.
    this.cx = f(); this.cy = f(); this.cz = f(); this.cd = f();
    // Leaves.
    const l = () => new Float32Array(maxLeaves);
    this.leaf = {
      node: new Int32Array(maxLeaves), state: new Uint8Array(maxLeaves),
      born: l(), life: l(), size: l(), phase: l(), since: l(), lift: l(),
      pitch: l(), roll: l(), pitchSpeed: l(), rollSpeed: l(), // how the wind has it tilted
      light: l(), dark: l(), // how much sun reaches it, and how long it has gone short
      scale: l(), // how much of its full size it has reached (0 to 1)
      shaded: new Uint8Array(maxLeaves), // died for want of light: nothing regrows there
      blocked: new Uint8Array(maxLeaves), // whether the support stands between it and the sun: 0 not yet known, 1 no, 2 yes
      dx: l(), dy: l(), dz: l(), // direction the leaf points
      fx: l(), fy: l(), fz: l(), // direction its face looks
      x: l(), y: l(), z: l(), vx: l(), vy: l(), vz: l(), // used once it has let go
      cx: l(), cy: l(), cz: l(), ux: l(), uy: l(), uz: l(), reach: l(), // where its blade is now, which way it faces, how far it spreads
      clip: l(), // how long it has spent cutting through its neighbours, lately
      n: 0,
      free: [],
    };
    // Tendrils: thin feelers that circle until they touch something, then
    // coil around it and pull tight.
    const maxTendrils = (this.maxTendrils = 6000);
    const tf = () => new Float32Array(maxTendrils);
    this.tendril = {
      node: new Int32Array(maxTendrils), state: new Uint8Array(maxTendrils), hand: new Int8Array(maxTendrils),
      born: tf(), since: tf(), len: tf(), phase: tf(), rest: tf(),
      dx: tf(), dy: tf(), dz: tf(), // direction it reaches in
      ux: tf(), uy: tf(), uz: tf(), // a direction square to that
      ax: tf(), ay: tf(), az: tf(), // where it has taken hold
      nx: tf(), ny: tf(), nz: tf(), // the surface normal there
      n: 0,
    };
    this.hand = 1; // which way this vine twines: +1 or -1
    this.pairs = new Int32Array(4096);
    this.pairCount = 0;
    this.pairClock = 0;
    this.clipping = 0;
    this.leafGrid = new Map();
    this.air = null; // the moving air, if it is being worked out (see air.js)
    this.leafSpots = new Map(); // where leaves already are, for spacing new ones
    this.canopy = new Map(); // where living leaves are now, for working out shade
    this.lightClock = 0; // seconds since the current round of light measuring began
    this.lightSpan = LIGHT_PERIOD;
    this.lightCursor = 0; // the next leaf to measure in this round
    this.sunSeen = [0, 0, 0];
    // Weather, set from outside: how hard it is raining (0 to 1), how wet
    // everything has become (0 to 1), and what the weather does to the wind.
    this.rain = 0;
    this.wet = 0;
    this.windScale = 1;
    this.gustiness = 0;
    this.drops = 12345; // state of the random numbers that time raindrops
    this.tips = [];
    this.time = 0;
    this.debt = 0;
    this.reroute = 0;
    this.target = [0, 6, 0];
    this.sun = [0.4, 0.8, 0.4];
    this.wind = [0, 0, 0];
    this.windDirX = 1;
    this.windDirZ = 0;
    this.g = [0, 1, 0];
    this.full = false;
  }

  gradient(x, y, z) {
    const d = this.distance;
    const g = this.g;
    g[0] = d(x + EPS, y, z) - d(x - EPS, y, z);
    g[1] = d(x, y + EPS, z) - d(x, y - EPS, z);
    g[2] = d(x, y, z + EPS) - d(x, y, z - EPS);
    const l = hyp(g[0], g[1], g[2]) || 1;
    g[0] /= l;
    g[1] /= l;
    g[2] /= l;
    return g;
  }

  get clearance() {
    return this.params.stemWidth * 0.5 + 0.03;
  }

  // Stems thicken with age and with how much vine they feed.
  radius(i) {
    const age = this.time - this.born[i];
    return (this.params.stemWidth / 2) * (0.1 + 0.9 * smooth(age / 22)) * Math.min(3.4, 1 + 0.26 * Math.log2(1 + this.weight[i] / 10));
  }

  addNode(x, y, z, parent, attached) {
    const i = this.n++;
    this.x[i] = this.px[i] = x;
    this.y[i] = this.py[i] = y;
    this.z[i] = this.pz[i] = z;
    const g = this.gradient(x, y, z);
    this.nx[i] = g[0];
    this.ny[i] = g[1];
    this.nz[i] = g[2];
    this.parent[i] = parent;
    this.born[i] = this.time;
    this.attached[i] = attached ? 1 : 0;
    this.weight[i] = 0;
    this.cd[i] = 0;
    if (!attached) this.loose[this.looseCount++] = i;
    this.along[i] = parent >= 0 ? this.along[parent] + hyp(x - this.x[parent], y - this.y[parent], z - this.z[parent]) : 0;
    if (parent >= 0) {
      this.ax[i] = this.ax[parent];
      this.ay[i] = this.ay[parent];
      this.az[i] = this.az[parent];
      for (let p = parent; p >= 0; p = this.parent[p]) this.weight[p]++;
      // Remember the shape the stem was grown in: it springs back to this.
      const gp = this.parent[parent];
      if (gp >= 0) {
        this.bx[i] = this.x[gp] - 2 * this.x[parent] + x;
        this.by[i] = this.y[gp] - 2 * this.y[parent] + y;
        this.bz[i] = this.z[gp] - 2 * this.z[parent] + z;
      }
    } else {
      this.ax[i] = 1;
      this.ay[i] = 0;
      this.az[i] = 0;
    }
    if (this.n >= this.max) this.full = true;
    return i;
  }

  // Starts a new vine at a point on the surface.
  plant(x, y, z) {
    if (this.full) return;
    const root = this.addNode(x, y, z, -1, true);
    const g = this.gradient(x, y, z);
    let dx = -g[0] * 0.6, dy = 0.8, dz = -g[2] * 0.6;
    const l = hyp(dx, dy, dz);
    for (const tip of this.tips) {
      if (tip.lead) tip.life = 25;
      tip.lead = false;
    }
    const mode = this.params.twining;
    this.hand = mode === 'Clockwise' ? 1 : mode === 'Counter-clockwise' ? -1 : this.rng() < 0.5 ? 1 : -1;
    this.tips.push({ node: root, dx: dx / l, dy: dy / l, dz: dz / l, hang: 0, life: Infinity, lead: true, dead: false, idle: false, hand: this.hand, phase: this.rng() * 6.28 });
  }

  // How many leaves already sit near a point.
  leafCrowd(x, y, z, radius) {
    const cell = 0.7;
    const ix = Math.floor(x / cell), iy = Math.floor(y / cell), iz = Math.floor(z / cell);
    let count = 0;
    for (let a = ix - 1; a <= ix + 1; a++) {
      for (let b = iy - 1; b <= iy + 1; b++) {
        for (let c = iz - 1; c <= iz + 1; c++) {
          const spots = this.leafSpots.get((a * 73856093) ^ (b * 19349663) ^ (c * 83492791));
          if (!spots) continue;
          for (let k = 0; k < spots.length; k += 3) {
            if (hyp(spots[k] - x, spots[k + 1] - y, spots[k + 2] - z) < radius) count++;
          }
        }
      }
    }
    return count;
  }

  // Puts out a leaf at a node. Leaves arrange themselves to catch light
  // without covering each other: the leaf takes whichever side of the stem
  // is emptier, stands a little further out where others are near, and is
  // not grown at all where there is no room.
  addLeaf(node, delay) {
    const L = this.leaf;
    const p = this.params;
    const rng = this.rng;
    const size = p.leafSize * (0.6 + rng() * 0.7);
    // Stem direction here, and the surface normal (straight up in mid-air).
    const par = this.parent[node];
    let tx = this.x[node] - this.x[par], ty = this.y[node] - this.y[par], tz = this.z[node] - this.z[par];
    let l = hyp(tx, ty, tz) || 1;
    tx /= l; ty /= l; tz /= l;
    const on = this.attached[node];
    const nx = on ? this.nx[node] : 0, ny = on ? this.ny[node] : 1, nz = on ? this.nz[node] : 0;
    let best = null;
    const first = rng() < 0.5 ? 1 : -1;
    for (let k = 0; k < 8; k++) {
      const side = k % 2 === 0 ? first : -first;
      const forward = [0.15, -0.35, 0.6, -0.8][k >> 1];
      // Out to one side of the stem, lifted off the surface, hanging a little.
      let dx = (ny * tz - nz * ty) * side * 0.8 + nx * 0.12 + tx * forward;
      let dy = (nz * tx - nx * tz) * side * 0.8 + ny * 0.12 + ty * forward - 0.45 * (1 - Math.abs(ny));
      let dz = (nx * ty - ny * tx) * side * 0.8 + nz * 0.12 + tz * forward;
      l = hyp(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      // The middle of the blade.
      const cx = this.x[node] + dx * size, cy = this.y[node] + dy * size, cz = this.z[node] + dz * size;
      const crowd = this.leafCrowd(cx, cy, cz, size * 0.7);
      if (!best || crowd < best.crowd) best = { dx, dy, dz, cx, cy, cz, crowd };
      if (crowd === 0) break;
    }
    if (best.crowd > p.leafOverlap) return;
    const i = L.free.length ? L.free.pop() : L.n < this.maxLeaves ? L.n++ : -1;
    if (i < 0) return;
    const { dx, dy, dz } = best;
    L.node[i] = node;
    L.state[i] = LEAF.ON;
    L.born[i] = this.time + delay;
    // Some leaves last as long as the vine does.
    L.life[i] = rng() < p.evergreen ? Infinity : p.leafLife * (0.55 + rng() * 0.9);
    L.size[i] = size;
    L.phase[i] = rng() * 100;
    // Each overlapping neighbour puts this leaf one layer further out.
    L.lift[i] = 0.03 + 0.11 * best.crowd + 0.02 * rng();
    L.pitch[i] = L.roll[i] = L.pitchSpeed[i] = L.rollSpeed[i] = 0;
    L.light[i] = 1;
    L.scale[i] = 0;
    L.dark[i] = 0;
    L.shaded[i] = 0;
    L.clip[i] = 0;
    L.blocked[i] = 0;
    // Its face turns away from the surface and towards the light.
    let fx = nx + this.sun[0] * 0.3, fy = ny + this.sun[1] * 0.3 + 0.1, fz = nz + this.sun[2] * 0.3;
    const fd = fx * dx + fy * dy + fz * dz;
    fx -= dx * fd; fy -= dy * fd; fz -= dz * fd;
    l = hyp(fx, fy, fz) || 1;
    L.dx[i] = dx; L.dy[i] = dy; L.dz[i] = dz;
    L.fx[i] = fx / l; L.fy[i] = fy / l; L.fz[i] = fz / l;
    const cell = 0.7;
    const key = (Math.floor(best.cx / cell) * 73856093) ^ (Math.floor(best.cy / cell) * 19349663) ^ (Math.floor(best.cz / cell) * 83492791);
    const spots = this.leafSpots.get(key);
    if (spots) spots.push(best.cx, best.cy, best.cz);
    else this.leafSpots.set(key, [best.cx, best.cy, best.cz]);
  }

  // How hard the wind is blowing at a point, from 0 to about 1.6. Gusts are
  // waves that travel downwind, so motion sweeps across the vine instead of
  // every part shaking on its own.
  gust(x, y, z) {
    const t = this.time;
    const along = x * this.windDirX + z * this.windDirZ;
    const wave = Math.sin(along * 0.5 - t * 1.9 + 0.8 * Math.sin(y * 0.35 + t * 0.4));
    const ripple = Math.sin(along * 1.7 - t * 4.3 + y * 0.9);
    return 0.35 + 0.65 * (0.5 + 0.5 * wave) + 0.3 * ripple * (0.5 + 0.5 * wave);
  }

  // How sharply the surface curves here: 0 on a flat wall, large on a thin
  // bar or a pole. A vine twines around things it can get round.
  curvature(x, y, z) {
    const h = 0.3;
    const d = this.distance;
    return Math.max(0, (d(x + h, y, z) + d(x - h, y, z) + d(x, y + h, z) + d(x, y - h, z) + d(x, y, z + h) + d(x, y, z - h) - 6 * d(x, y, z)) / (h * h));
  }

  addTendril(node, tx, ty, tz, hand) {
    const T = this.tendril;
    if (T.n >= this.maxTendrils) return;
    const rng = this.rng;
    const i = T.n++;
    const on = this.attached[node];
    const nx = on ? this.nx[node] : 0, ny = on ? this.ny[node] : 1, nz = on ? this.nz[node] : 0;
    const side = rng() < 0.5 ? 1 : -1;
    // Out to the side and forwards; on a surface, leaning in slightly so
    // that its sweep brushes against it.
    let dx = (ny * tz - nz * ty) * side * 0.75 + tx * 0.5 - nx * (on ? 0.12 : 0);
    let dy = (nz * tx - nx * tz) * side * 0.75 + ty * 0.5 - ny * (on ? 0.12 : 0) + (on ? 0 : 0.25);
    let dz = (nx * ty - ny * tx) * side * 0.75 + tz * 0.5 - nz * (on ? 0.12 : 0);
    let l = hyp(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    // Any direction square to it.
    let ux = dy * tz - dz * ty, uy = dz * tx - dx * tz, uz = dx * ty - dy * tx;
    l = hyp(ux, uy, uz);
    if (l < 1e-3) {
      ux = -dy; uy = dx; uz = 0;
      l = hyp(ux, uy, uz) || 1;
    }
    T.node[i] = node;
    T.state[i] = TENDRIL.SEARCHING;
    T.hand[i] = hand;
    T.born[i] = this.time + 0.6 + rng();
    T.since[i] = 0;
    T.len[i] = this.params.tendrilLength * (0.6 + rng() * 0.8);
    T.phase[i] = rng() * 6.28;
    T.dx[i] = dx; T.dy[i] = dy; T.dz[i] = dz;
    T.ux[i] = ux / l; T.uy[i] = uy / l; T.uz[i] = uz / l;
  }

  updateTendrils() {
    const T = this.tendril;
    const cosC = Math.cos(SWEEP_CONE), sinC = Math.sin(SWEEP_CONE);
    for (let i = 0; i < T.n; i++) {
      if (T.state[i] !== TENDRIL.SEARCHING) continue;
      const age = this.time - T.born[i];
      if (age < 1.5) continue;
      if (age > 16 + (T.phase[i] % 1) * 10) {
        // Found nothing: it curls up on itself and stays that way.
        T.state[i] = TENDRIL.CURLED;
        T.since[i] = this.time;
        continue;
      }
      // Where its tip is on this sweep.
      const node = T.node[i];
      const dx = T.dx[i], dy = T.dy[i], dz = T.dz[i], ux = T.ux[i], uy = T.uy[i], uz = T.uz[i];
      const wx = dy * uz - dz * uy, wy = dz * ux - dx * uz, wz = dx * uy - dy * ux;
      const a = T.hand[i] * SWEEP_RATE * this.time + T.phase[i];
      const ca = Math.cos(a) * sinC, sa = Math.sin(a) * sinC;
      const reach = T.len[i] * Math.min(1, age / 4) * 0.8;
      const x = this.x[node] + (dx * cosC + ux * ca + wx * sa) * reach;
      const y = this.y[node] + (dy * cosC + uy * ca + wy * sa) * reach;
      const z = this.z[node] + (dz * cosC + uz * ca + wz * sa) * reach;
      const d = this.distance(x, y, z);
      if (d > 0.1) continue;
      // Touched something: take hold of it.
      const g = this.gradient(x, y, z);
      T.state[i] = TENDRIL.GRIPPING;
      T.since[i] = this.time;
      T.ax[i] = x - g[0] * (d - 0.03);
      T.ay[i] = y - g[1] * (d - 0.03);
      T.az[i] = z - g[2] * (d - 0.03);
      T.nx[i] = g[0]; T.ny[i] = g[1]; T.nz[i] = g[2];
      T.rest[i] = hyp(T.ax[i] - this.x[node], T.ay[i] - this.y[node], T.az[i] - this.z[node]);
    }
  }

  update(dt) {
    this.time += dt;
    const p = this.params;
    // Wind: a steady direction with slow gusts.
    const t = this.time;
    // Stormy weather blows harder and in sharper bursts.
    const rough = this.gustiness;
    const gust = p.wind * this.windScale * (0.55 + 0.3 * Math.sin(t * 0.63) + (0.2 * Math.sin(t * 1.7 + 1.3) + 0.12 * Math.sin(t * 3.1 + 0.4)) * (1 + rough) + 0.2 * rough * Math.sin(t * 5.3 + 2));
    const wa = (p.windDirection * Math.PI) / 180 + 0.5 * Math.sin(t * 0.21);
    this.wind[0] = Math.sin(wa) * gust;
    this.wind[1] = 0.15 * gust * Math.sin(t * 0.9);
    this.wind[2] = Math.cos(wa) * gust;
    this.windDirX = Math.sin(wa);
    this.windDirZ = Math.cos(wa);

    this.debt += dt * p.speed;
    while (this.debt >= 1) {
      this.debt -= 1;
      if (!this.full) this.grow();
    }
    this.reroute -= dt;
    if (this.reroute <= 0) {
      this.reroute = 0.35;
      this.chooseLead();
    }
    // The air moves (see air.js); leaves in it hold it back.
    if (this.air) {
      this.air.update(dt, this.wind, (air) => {
        const L = this.leaf;
        air.leaves.fill(0);
        for (let i = 0; i < L.n; i++) {
          if (L.reach[i] === 0) continue;
          const c = air.cellAt(L.cx[i], L.cy[i], L.cz[i]);
          if (c >= 0) air.leaves[c] += L.reach[i] * L.reach[i] * 3;
        }
      });
    }
    this.physics(Math.min(dt, 1 / 30));
    this.ageLeaves(dt);
    this.updateTendrils();
  }

  // If some other part of the vine is much nearer the target than the lead
  // shoot, a new lead sets off from there.
  chooseLead() {
    if (this.n === 0 || this.full) return;
    const [tx, ty, tz] = this.target;
    let lead = null;
    for (const tip of this.tips) if (tip.lead && !tip.dead) lead = tip;
    let leadDist = Infinity;
    if (lead) leadDist = hyp(this.x[lead.node] - tx, this.y[lead.node] - ty, this.z[lead.node] - tz);
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (!this.attached[i]) continue;
      const d = hyp(this.x[i] - tx, this.y[i] - ty, this.z[i] - tz);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best < 0 || bestDist + 3 > leadDist) return;
    if (lead) {
      lead.lead = false;
      lead.life = 25;
    }
    const d = bestDist || 1;
    this.tips.push({ node: best, dx: (tx - this.x[best]) / d, dy: (ty - this.y[best]) / d, dz: (tz - this.z[best]) / d, hang: 0, life: Infinity, lead: true, dead: false, idle: false, hand: this.hand, phase: this.rng() * 6.28 });
  }

  // One growth step for every living tip.
  grow() {
    const p = this.params;
    const rng = this.rng;
    const clearance = this.clearance;
    const lightX = this.sun[0] * 0.5, lightY = 0.5 + this.sun[1] * 0.5, lightZ = this.sun[2] * 0.5;
    const count = this.tips.length;
    let alive = 0;
    let lead = null;
    for (const tip of this.tips) {
      if (tip.dead) continue;
      alive++;
      if (tip.lead) lead = tip;
    }
    // New side shoots only start near the lead shoot, so growth follows it
    // and the parts left behind settle down.
    const leadX = lead ? this.x[lead.node] : 0, leadY = lead ? this.y[lead.node] : 0, leadZ = lead ? this.z[lead.node] : 0;
    for (let k = 0; k < count && !this.full; k++) {
      const tip = this.tips[k];
      if (tip.dead) continue;
      // Only the lead shoot grows at full speed; side shoots take their time.
      tip.wait = (tip.wait ?? 0) + (tip.lead ? 1 : p.sideSpeed);
      if (tip.wait < 1) continue;
      tip.wait -= 1;
      const from = tip.node;
      const x0 = this.x[from], y0 = this.y[from], z0 = this.z[from];
      let vx = tip.dx, vy = tip.dy, vz = tip.dz;
      tip.idle = false;
      // A shoot in mid-air cannot push against anything: it carries on the
      // way it is actually pointing, and circles slowly as it goes, feeling
      // for something to climb.
      const par = this.parent[from];
      const inAir = !this.attached[from] && par >= 0;
      if (inAir) {
        let ax = x0 - this.x[par], ay = y0 - this.y[par], az = z0 - this.z[par];
        let al = hyp(ax, ay, az) || 1;
        ax /= al; ay /= al; az /= al;
        let ux = -az, uy = 0, uz = ax; // square to the stem, level
        al = hyp(ux, uz);
        if (al < 1e-3) {
          ux = 1; uz = 0;
          al = 1;
        }
        ux /= al; uz /= al;
        const wx = ay * uz - az * uy, wy = az * ux - ax * uz, wz = ax * uy - ay * ux;
        const a = tip.hand * p.nutationRate * this.time + tip.phase;
        const c = Math.cos(a) * p.nutation, s = Math.sin(a) * p.nutation;
        vx = vx * 0.3 + ax * 0.7 + ux * c + wx * s;
        vy = vy * 0.3 + ay * 0.7 + uy * c + wy * s;
        vz = vz * 0.3 + az * 0.7 + uz * c + wz * s;
      }
      const tx = this.target[0] - x0, ty = this.target[1] - y0, tz = this.target[2] - z0;
      const dist = hyp(tx, ty, tz) || 1;
      if (tip.lead) {
        if (dist < 0.5) {
          tip.idle = true; // it has caught up: wait for the target to move on
          continue;
        }
        const pull = p.follow * (inAir ? 0.35 : 1);
        vx += (tx / dist) * pull;
        vy += (ty / dist) * pull;
        vz += (tz / dist) * pull;
      } else {
        // Side shoots head for the light, with a slight lean after the lead.
        const lean = p.follow * 0.2;
        const climb = p.climb * (inAir ? 0.3 : 1);
        vx += lightX * climb + (tx / dist) * lean;
        vy += lightY * climb + (ty / dist) * lean;
        vz += lightZ * climb + (tz / dist) * lean;
      }
      vx += (rng() * 2 - 1) * p.wander;
      vy += (rng() * 2 - 1) * p.wander;
      vz += (rng() * 2 - 1) * p.wander;
      const d = this.distance(x0, y0, z0);
      if (d < p.reach) {
        const g = this.gradient(x0, y0, z0);
        const pull = p.cling * (1 - d / p.reach);
        vx -= g[0] * pull;
        vy -= g[1] * pull;
        vz -= g[2] * pull;
        // Twining: where the surface curves, turn across it, always the
        // same way round, so the shoot winds around poles and bars.
        if (p.twine > 0) {
          const turn = tip.hand * p.twine * Math.min(1, this.curvature(x0, y0, z0) * 0.8) * (1 - d / p.reach);
          if (turn !== 0) {
            const cx = g[1] * vz - g[2] * vy, cy = g[2] * vx - g[0] * vz, cz = g[0] * vy - g[1] * vx;
            vx += cx * turn;
            vy += cy * turn;
            vz += cz * turn;
          }
        }
      }
      let l = hyp(vx, vy, vz) || 1;
      vx /= l; vy /= l; vz /= l;

      let x = x0 + vx * p.stepLength, y = y0 + vy * p.stepLength, z = z0 + vz * p.stepLength;
      let nd = this.distance(x, y, z);
      if (nd < clearance) {
        // Blocked: push back out to the surface and slide along it.
        const g = this.gradient(x, y, z);
        x += g[0] * (clearance - nd);
        y += g[1] * (clearance - nd);
        z += g[2] * (clearance - nd);
        const into = vx * g[0] + vy * g[1] + vz * g[2];
        if (into < 0) {
          vx -= g[0] * into;
          vy -= g[1] * into;
          vz -= g[2] * into;
          l = hyp(vx, vy, vz) || 1;
          vx /= l; vy /= l; vz /= l;
        }
        nd = this.distance(x, y, z);
      }
      const attached = nd < clearance + p.grip;
      tip.hang = attached ? 0 : tip.hang + p.stepLength;
      tip.dx = vx; tip.dy = vy; tip.dz = vz;
      const node = this.addNode(x, y, z, from, attached);
      tip.node = node;
      if (rng() < p.leafDensity) this.addLeaf(node, 0.5 + rng());
      if (rng() < p.tendrilDensity) this.addTendril(node, vx, vy, vz, tip.hand);

      if (--tip.life <= 0 || tip.hang > p.maxHang || hyp(x, z) > 70 || y > 70) {
        tip.dead = true;
        alive--;
        continue;
      }
      // Fork: the side shoot sets off at an angle across the surface.
      const nearLead = !lead || hyp(x - leadX, y - leadY, z - leadZ) < p.activeRadius;
      if (nearLead && alive < p.maxTips && rng() < p.branching * (attached ? 1 : 0.3)) {
        const g = this.gradient(x, y, z);
        const ax = attached ? g[0] : 0, ay = attached ? g[1] : 1, az = attached ? g[2] : 0;
        const angle = ((p.branchAngle * Math.PI) / 180) * (0.7 + rng() * 0.6) * (rng() < 0.5 ? 1 : -1);
        const c = Math.cos(angle), s = Math.sin(angle);
        const dot = ax * vx + ay * vy + az * vz;
        this.tips.push({
          node,
          dx: vx * c + (ay * vz - az * vy) * s + ax * dot * (1 - c),
          dy: vy * c + (az * vx - ax * vz) * s + ay * dot * (1 - c),
          dz: vz * c + (ax * vy - ay * vx) * s + az * dot * (1 - c),
          hang: tip.hang,
          life: p.branchLife * (0.4 + rng() * 1.2),
          lead: false,
          dead: false,
          idle: false,
          hand: tip.hand,
          phase: rng() * 6.28,
        });
        alive++;
      }
    }
    // Forget tips that have finished.
    if (this.tips.length > 400) this.tips = this.tips.filter((t) => !t.dead);
  }

  // Rope physics for every node that is not holding on to the surface.
  physics(dt) {
    const p = this.params;
    const { x, y, z, px, py, pz, parent, attached } = this;
    const clearance = this.clearance;
    const h = dt / 2;
    const [wx, wy, wz] = this.wind;
    const { loose, cx, cy, cz, cd } = this;
    const count = this.looseCount;
    const touching = clearance + p.grip + 1e-4;
    for (let sub = 0; sub < 2; sub++) {
      for (let q = 0; q < count; q++) {
        const i = loose[q];
        if (attached[i]) continue;
        // Each strand feels the gusts a little differently.
        const flutter = this.gust(x[i], y[i], z[i]);
        const vx = (x[i] - px[i]) * p.damping, vy = (y[i] - py[i]) * p.damping, vz = (z[i] - pz[i]) * p.damping;
        px[i] = x[i];
        py[i] = y[i];
        pz[i] = z[i];
        // The air where this strand is, if that is being worked out.
        let ax = wx, ay = wy, az = wz;
        if (this.air) {
          const a = this.air.at(x[i], y[i], z[i]);
          ax = a[0]; ay = a[1]; az = a[2];
        }
        x[i] += vx + ax * flutter * 2.2 * h * h;
        y[i] += vy + (ay * flutter * 2.2 - p.gravity * 9) * h * h;
        z[i] += vz + az * flutter * 2.2 * h * h;
      }
      for (let it = 0; it < 3; it++) {
        for (let q = 0; q < count; q++) {
          const i = loose[q];
          if (attached[i]) continue;
          const par = parent[i];
          if (par < 0) continue;
          // Stiffness: a stem springs back to the shape it grew in. The
          // correction is shared between the three nodes involved so that
          // it bends the stem without shoving it along.
          const gp = parent[par];
          if (gp >= 0) {
            const k = p.stiffness * (0.7 + 0.5 * Math.min(1, (this.time - this.born[i]) / 25));
            const ex = (x[gp] - 2 * x[par] + x[i] - this.bx[i]) * k;
            const ey = (y[gp] - 2 * y[par] + y[i] - this.by[i]) * k;
            const ez = (z[gp] - 2 * z[par] + z[i] - this.bz[i]) * k;
            x[i] -= ex * 0.25;
            y[i] -= ey * 0.25;
            z[i] -= ez * 0.25;
            if (!attached[par]) {
              x[par] += ex * 0.5;
              y[par] += ey * 0.5;
              z[par] += ez * 0.5;
            }
            if (!attached[gp]) {
              x[gp] -= ex * 0.25;
              y[gp] -= ey * 0.25;
              z[gp] -= ez * 0.25;
            }
          }
          // Length: a stem does not stretch.
          let dx = x[i] - x[par], dy = y[i] - y[par], dz = z[i] - z[par];
          const d = hyp(dx, dy, dz) || 1e-6;
          const diff = (d - p.stepLength) / d;
          if (attached[par]) {
            x[i] -= dx * diff;
            y[i] -= dy * diff;
            z[i] -= dz * diff;
          } else {
            x[i] -= dx * diff * 0.6;
            y[i] -= dy * diff * 0.6;
            z[i] -= dz * diff * 0.6;
            x[par] += dx * diff * 0.4;
            y[par] += dy * diff * 0.4;
            z[par] += dz * diff * 0.4;
          }
          // The surface is solid, and a strand resting against it takes hold.
          // Not if it has moved less than its last known distance from it.
          const slack = cd[i] - touching;
          if (slack > 0) {
            const mx = x[i] - cx[i], my = y[i] - cy[i], mz = z[i] - cz[i];
            if (mx * mx + my * my + mz * mz < slack * slack) continue;
          }
          const sd = this.distance(x[i], y[i], z[i]);
          cx[i] = x[i];
          cy[i] = y[i];
          cz[i] = z[i];
          cd[i] = sd;
          if (sd < clearance + p.grip) {
            const g = this.gradient(x[i], y[i], z[i]);
            if (sd < clearance) {
              x[i] += g[0] * (clearance - sd);
              y[i] += g[1] * (clearance - sd);
              z[i] += g[2] * (clearance - sd);
              px[i] += (x[i] - px[i]) * 0.5; // friction
              py[i] += (y[i] - py[i]) * 0.5;
              pz[i] += (z[i] - pz[i]) * 0.5;
            }
            if (it === 0 && this.rng() < p.stick * h) {
              attached[i] = 1;
              this.nx[i] = g[0];
              this.ny[i] = g[1];
              this.nz[i] = g[2];
            }
          }
        }
      }
      // A tendril that has taken hold coils up, drawing its stem in.
      const T = this.tendril;
      for (let i = 0; i < T.n; i++) {
        if (T.state[i] !== TENDRIL.GRIPPING) continue;
        const node = T.node[i];
        if (attached[node]) continue;
        const dx = T.ax[i] - x[node], dy = T.ay[i] - y[node], dz = T.az[i] - z[node];
        const d = hyp(dx, dy, dz) || 1e-6;
        const coiled = Math.min(1, (this.time - T.since[i]) / 8);
        const rest = T.rest[i] * (1 - 0.45 * coiled);
        if (d > rest) {
          const k = ((d - rest) / d) * 0.5;
          x[node] += dx * k;
          y[node] += dy * k;
          z[node] += dz * k;
        }
      }
    }
    // Strike off the nodes that took hold.
    let kept = 0;
    for (let q = 0; q < count; q++) if (!attached[loose[q]]) loose[kept++] = loose[q];
    for (let q = count; q < this.looseCount; q++) loose[kept++] = loose[q];
    this.looseCount = kept;
  }

  // How much direct sun reaches each open leaf: none if the support is in
  // the way, less for every other leaf between it and the sun. A leaf that
  // goes short of light for long enough is given up: the vine stops feeding
  // it, and it turns and falls like an old leaf.
  //
  // The leaves are not all measured at once: each frame takes the next few,
  // so that a round is spread evenly over LIGHT_PERIOD seconds. And since
  // neither the support nor a leaf that is holding on to it ever moves,
  // whether the support shades such a leaf is worked out once and kept
  // until the sun moves.
  countCanopy() {
    const L = this.leaf;
    const canopy = this.canopy;
    canopy.clear();
    for (let i = 0; i < L.n; i++) {
      if (L.state[i] !== LEAF.ON || this.time < L.born[i]) continue;
      const node = L.node[i];
      const k = canopyKey(this.x[node] + L.dx[i] * L.size[i], this.y[node] + L.dy[i] * L.size[i], this.z[node] + L.dz[i] * L.size[i]);
      canopy.set(k, (canopy.get(k) ?? 0) + 1);
    }
    const [sx, sy, sz] = this.sun;
    const seen = this.sunSeen;
    if (seen[0] !== sx || seen[1] !== sy || seen[2] !== sz) {
      seen[0] = sx; seen[1] = sy; seen[2] = sz;
      L.blocked.fill(0);
    }
  }

  measureLight(from, to, elapsed) {
    const L = this.leaf;
    const p = this.params;
    const canopy = this.canopy;
    const [sx, sy, sz] = this.sun;
    for (let i = from; i < to; i++) {
      if (L.state[i] !== LEAF.ON || this.time < L.born[i]) continue;
      const node = L.node[i];
      // From the middle of the blade, lifted clear of the surface it grows on.
      const x = this.x[node] + L.dx[i] * L.size[i] + L.fx[i] * 0.25;
      const y = this.y[node] + L.dy[i] * L.size[i] + L.fy[i] * 0.25;
      const z = this.z[node] + L.dz[i] * L.size[i] + L.fz[i] * 0.25;
      let light = 1;
      // Is the support between this leaf and the sun?
      if (L.blocked[i] === 0 || !this.attached[node]) {
        let blocked = 1;
        for (let t = 0.15, n = 0; t < 30 && n < 40; n++) {
          const d = this.distance(x + sx * t, y + sy * t, z + sz * t);
          if (d < 0.02) {
            blocked = 2;
            break;
          }
          t += Math.max(0.08, d);
        }
        L.blocked[i] = this.attached[node] ? blocked : 0;
        if (blocked === 2) light = 0;
      } else if (L.blocked[i] === 2) light = 0;
      // Other leaves on the way to the sun each take their share.
      if (light > 0) {
        let above = 0;
        for (let t = 0.9; t < 6; t += 0.8) above += canopy.get(canopyKey(x + sx * t, y + sy * t, z + sz * t)) ?? 0;
        light = Math.exp(-0.28 * above);
      }
      L.light[i] = light;
      if (light < p.lightNeed) L.dark[i] += elapsed;
      else L.dark[i] = Math.max(0, L.dark[i] - elapsed * 2);
      if (p.lightNeed > 0 && L.dark[i] > p.shadePatience && !L.shaded[i] && this.time - L.born[i] > 16) {
        L.shaded[i] = 1;
        // Bring its end forward: it starts to turn now and falls soon after.
        L.life[i] = Math.min(L.life[i], (this.time - L.born[i]) / 0.8 + 3);
      }
    }
  }

  // Leaves get in each other's way. Each leaf is treated as a flat disc on
  // its stalk; discs near each other are paired up (the list of pairs is
  // refreshed a couple of times a second, since leaves do not travel), and
  // every frame each pair does three things:
  //   - leaves about to cut through each other push each other apart;
  //   - neighbours share their sway, each drawn towards the other's tilt
  //     and motion, so a patch of leaves moves together instead of through
  //     itself;
  //   - a leaf that still spends its time cutting through a neighbour runs
  //     up a tally, and when the tally is long enough the vine gives that
  //     leaf up (the worse lit of the two). What is left, in time, is a
  //     canopy that fits together.
  touchLeaves(dt) {
    const L = this.leaf;
    const p = this.params;
    for (let i = 0; i < L.n; i++) {
      if (L.state[i] !== LEAF.ON || this.time < L.born[i]) {
        L.reach[i] = 0;
        continue;
      }
      const node = L.node[i];
      const lift = (this.radius(node) + L.lift[i]) * this.attached[node];
      const c = Math.cos(L.pitch[i]), s = Math.sin(L.pitch[i]);
      const size = L.size[i] * Math.pow(L.scale[i], 1.15);
      const along = size * 0.95; // from the stem to the middle of the blade
      L.cx[i] = this.x[node] + this.nx[node] * lift + (L.dx[i] * c + L.fx[i] * s) * along;
      L.cy[i] = this.y[node] + this.ny[node] * lift + (L.dy[i] * c + L.fy[i] * s) * along;
      L.cz[i] = this.z[node] + this.nz[node] * lift + (L.dz[i] * c + L.fz[i] * s) * along;
      L.ux[i] = L.fx[i] * c - L.dx[i] * s;
      L.uy[i] = L.fy[i] * c - L.dy[i] * s;
      L.uz[i] = L.fz[i] * c - L.dz[i] * s;
      L.reach[i] = 0.6 * size;
      if (L.clip[i] > 0) L.clip[i] = Math.max(0, L.clip[i] - dt * 0.12);
    }
    this.pairClock -= dt;
    if (this.pairClock <= 0) {
      this.pairClock = 0.5;
      this.pairLeaves();
    }
    const pairs = this.pairs;
    const share = p.leafShare * 5 * dt, push = p.leafPush * 60 * dt;
    let clipping = 0;
    for (let k = 0; k < this.pairCount; k += 2) {
      const i = pairs[k], j = pairs[k + 1];
      const ri = L.reach[i], rj = L.reach[j];
      if (ri === 0 || rj === 0) continue;
      const dx = L.cx[j] - L.cx[i], dy = L.cy[j] - L.cy[i], dz = L.cz[j] - L.cz[i];
      const dist = hyp(dx, dy, dz);
      const room = (ri + rj) * 0.9;
      if (dist >= room) continue;
      const over = 1 - dist / room; // how much the two discs overlap, seen face on
      // Neighbours share their sway.
      const dp = (L.pitchSpeed[j] - L.pitchSpeed[i] + (L.pitch[j] - L.pitch[i]) * 3) * share * over;
      const dr = (L.rollSpeed[j] - L.rollSpeed[i] + (L.roll[j] - L.roll[i]) * 3) * share * over;
      L.pitchSpeed[i] += dp; L.pitchSpeed[j] -= dp;
      L.rollSpeed[i] += dr; L.rollSpeed[j] -= dr;
      // How far j's blade stands above i's (and the other way about), against
      // how far apart they need to be, which is more the more they are
      // tilted to each other.
      const facing = L.ux[i] * L.ux[j] + L.uy[i] * L.uy[j] + L.uz[i] * L.uz[j];
      const h = dx * L.ux[i] + dy * L.uy[i] + dz * L.uz[i];
      const need = 0.05 + 0.45 * Math.min(ri, rj) * Math.sqrt(Math.max(0, 1 - facing * facing)) + 0.06 * over;
      const gap = Math.abs(h);
      if (gap >= need * 1.6) continue;
      const side = h >= 0 ? 1 : -1;
      const force = push * over * Math.min(1, (need * 1.6 - gap) / need);
      L.pitchSpeed[i] -= side * force;
      L.pitchSpeed[j] += side * force * (facing >= 0 ? 1 : -1);
      if (gap < need && over > 0.15) {
        clipping++;
        // The tally goes to whichever of the two is getting less light.
        const loser = L.light[i] < L.light[j] || (L.light[i] === L.light[j] && L.scale[i] < L.scale[j]) ? i : j;
        L.clip[loser] += dt * 1.12;
        if (p.clipPatience > 0 && L.clip[loser] > p.clipPatience && !L.shaded[loser] && this.time - L.born[loser] > 16) {
          L.shaded[loser] = 1; // nothing regrows where a leaf did not fit
          L.life[loser] = Math.min(L.life[loser], (this.time - L.born[loser]) / 0.8 + 3);
        }
      }
    }
    this.clipping = clipping;
  }

  // Lists every two living leaves whose blades are near enough to touch.
  pairLeaves() {
    const L = this.leaf;
    const cell = 1.6;
    const grid = this.leafGrid;
    grid.clear();
    let n = 0;
    for (let i = 0; i < L.n; i++) {
      if (L.reach[i] === 0) continue;
      const ix = Math.floor(L.cx[i] / cell), iy = Math.floor(L.cy[i] / cell), iz = Math.floor(L.cz[i] / cell);
      for (let a = ix - 1; a <= ix + 1; a++) for (let b = iy - 1; b <= iy + 1; b++) for (let c = iz - 1; c <= iz + 1; c++) {
        const near = grid.get((a * 73856093) ^ (b * 19349663) ^ (c * 83492791));
        if (!near) continue;
        for (const j of near) {
          const room = (L.reach[i] + L.reach[j]) * 0.9 + 0.35;
          if (hyp(L.cx[j] - L.cx[i], L.cy[j] - L.cy[i], L.cz[j] - L.cz[i]) > room) continue;
          if (n + 2 > this.pairs.length) {
            const bigger = new Int32Array(this.pairs.length * 2);
            bigger.set(this.pairs);
            this.pairs = bigger;
          }
          this.pairs[n++] = j;
          this.pairs[n++] = i;
        }
      }
      const key = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791);
      const here = grid.get(key);
      if (here) here.push(i);
      else grid.set(key, [i]);
    }
    this.pairCount = n;
  }

  ageLeaves(dt) {
    const L = this.leaf;
    this.lightClock += dt;
    if (this.lightCursor >= L.n && this.lightClock >= LIGHT_PERIOD) {
      this.lightSpan = this.lightClock;
      this.lightClock = 0;
      this.lightCursor = 0;
      this.countCanopy();
    }
    if (this.lightCursor < L.n) {
      const to = Math.min(L.n, this.lightCursor + Math.ceil((L.n * dt) / (LIGHT_PERIOD * 0.8)));
      this.measureLight(this.lightCursor, to, this.lightSpan);
      this.lightCursor = to;
    }
    // Rain: now and then a drop lands on a leaf and knocks it down.
    const tap = this.rain * 1.6 * dt;
    const p = this.params;
    const rng = this.rng;
    const [wx, , wz] = this.wind;
    for (let i = 0; i < L.n; i++) {
      const state = L.state[i];
      if (state === LEAF.FREE) continue;
      if (state === LEAF.ON || state === LEAF.WITHERED) {
        const node = L.node[i];
        // Growing. A leaf builds itself with what it earns from the sun: in
        // good light it grows quickly to full size, in poor light slowly,
        // and it stops short. It never shrinks.
        if (state === LEAF.ON && this.time >= L.born[i]) {
          const lit = Math.min(1, L.light[i] / 0.7);
          const limit = 0.45 + 0.55 * lit;
          if (L.scale[i] < limit) L.scale[i] = Math.min(limit, L.scale[i] + (dt / p.leafGrowTime) * (0.3 + 0.7 * lit));
        }
        // The wind on this leaf: it presses on the blade and bends it back
        // on its stalk, and the stalk springs it forward again.
        const g = this.gust(this.x[node], this.y[node], this.z[node]);
        let lx = this.wind[0] * g, ly = this.wind[1] * g, lz = this.wind[2] * g;
        if (this.air) {
          // The air as it really is where this leaf is: slowed, turned or
          // sheltered by the support and by other leaves. Gusts still ripple it.
          const a = this.air.at(L.cx[i] || this.x[node], L.cy[i] || this.y[node], L.cz[i] || this.z[node]);
          const ripple = 0.55 + 0.45 * g;
          lx = a[0] * ripple; ly = a[1] * ripple; lz = a[2] * ripple;
        }
        const dx = L.dx[i], dy = L.dy[i], dz = L.dz[i], fx = L.fx[i], fy = L.fy[i], fz = L.fz[i];
        const sx = dy * fz - dz * fy, sy = dz * fx - dx * fz, sz = dx * fy - dy * fx;
        // Strong wind also makes a leaf shiver at its own rate.
        const speed = hyp(lx, lz);
        const shiver = speed * speed * 2.2 * Math.sin(this.time * (9 + (L.phase[i] % 5)) + L.phase[i]);
        const push = (lx * fx + ly * fy + lz * fz) * 7 + shiver * 0.5;
        const twist = (lx * sx + ly * sy + lz * sz) * 9 + shiver;
        // Bigger leaves are heavier and slower.
        const spring = 46 / L.size[i], drag = 3.2;
        if (tap > 0) {
          this.drops = (Math.imul(this.drops, 1664525) + 1013904223) | 0;
          const r = (this.drops >>> 8) / 16777216;
          if (r < tap * L.scale[i]) {
            const hit = r / tap; // 0 to 1: how squarely it was struck
            L.pitchSpeed[i] -= 0.5 + 1.1 * hit;
            L.rollSpeed[i] += (((this.drops >>> 4) & 15) / 7.5 - 1) * 0.9;
          }
        }
        L.pitchSpeed[i] += (push - spring * L.pitch[i] - drag * L.pitchSpeed[i]) * dt;
        L.rollSpeed[i] += (twist - spring * 0.8 * L.roll[i] - drag * L.rollSpeed[i]) * dt;
        L.pitch[i] += L.pitchSpeed[i] * dt;
        L.roll[i] += L.rollSpeed[i] * dt;
        // A leaf against a surface can lift away from it but not swing into it.
        const floor = this.attached[node] ? -0.12 : -0.9;
        if (L.pitch[i] < floor) {
          L.pitch[i] = floor;
          L.pitchSpeed[i] *= -0.3;
        } else if (L.pitch[i] > 1) L.pitch[i] = 1;
        if (L.roll[i] > 0.6) L.roll[i] = 0.6;
        else if (L.roll[i] < -0.6) L.roll[i] = -0.6;
        if (state === LEAF.ON) {
          if ((p.leafLife > 0 || L.shaded[i]) && this.time - L.born[i] > L.life[i]) {
            // Dead, but still on the vine: it dries and curls where it is.
            L.state[i] = LEAF.WITHERED;
            L.since[i] = this.time;
          }
        } else if (speed > p.detachWind && this.time - L.since[i] > 4 && rng() < 0.9 * dt) {
          // A gust strong enough to snap a dry stalk.
          L.state[i] = LEAF.FALLING;
          L.x[i] = this.x[node] + L.dx[i] * L.size[i] * 0.5;
          L.y[i] = this.y[node] + L.dy[i] * L.size[i] * 0.5;
          L.z[i] = this.z[node] + L.dz[i] * L.size[i] * 0.5;
          L.vx[i] = lx * 0.6;
          L.vy[i] = 0;
          L.vz[i] = lz * 0.6;
          L.since[i] = this.time;
        }
      } else if (state === LEAF.FALLING) {
        // Light and flat: it flutters down rather than drops.
        const s = this.time * 2.4 + L.phase[i];
        L.vx[i] += (wx * 0.8 + Math.sin(s) * 1.6 - L.vx[i] * 1.5) * dt;
        L.vz[i] += (wz * 0.8 + Math.cos(s * 0.8) * 1.6 - L.vz[i] * 1.5) * dt;
        L.vy[i] += (-1.5 * p.gravity - 0.4 * Math.abs(Math.sin(s)) - L.vy[i]) * 1.4 * dt;
        L.x[i] += L.vx[i] * dt;
        L.y[i] += L.vy[i] * dt;
        L.z[i] += L.vz[i] * dt;
        const sd = this.distance(L.x[i], L.y[i], L.z[i]);
        if (sd < 0.03) {
          const g = this.gradient(L.x[i], L.y[i], L.z[i]);
          L.x[i] += g[0] * (0.03 - sd);
          L.y[i] += g[1] * (0.03 - sd);
          L.z[i] += g[2] * (0.03 - sd);
          if (g[1] > 0.6) {
            L.state[i] = LEAF.GROUND; // landed on something flat
            L.since[i] = this.time;
          }
        }
        if (this.time - L.since[i] > 40) L.state[i] = LEAF.FREE;
      } else if (this.time - L.since[i] > 9) {
        // It has rotted away. Young stems put out a replacement.
        const node = L.node[i];
        L.state[i] = LEAF.FREE;
        L.free.push(i);
        if (!L.shaded[i] && this.attached[node] && this.radius(node) < p.leafDrop && rng() < 0.7) this.addLeaf(node, 1 + rng() * 5);
      }
    }
      this.touchLeaves(dt);
  }

  get stats() {
    let tips = 0;
    for (const t of this.tips) if (!t.dead) tips++;
    const hanging = this.looseCount;
    let shaded = 0;
    let withered = 0;
    for (let i = 0; i < this.leaf.n; i++) {
      if (this.leaf.state[i] === LEAF.ON && this.leaf.light[i] < this.params.lightNeed) shaded++;
      if (this.leaf.state[i] === LEAF.WITHERED) withered++;
    }
    let gripping = 0;
    for (let i = 0; i < this.tendril.n; i++) if (this.tendril.state[i] === TENDRIL.GRIPPING) gripping++;
    return { clipping: this.clipping, nodes: this.n, tips, hanging, leaves: this.leaf.n - this.leaf.free.length, tendrils: this.tendril.n, gripping, shaded, withered };
  }
}
