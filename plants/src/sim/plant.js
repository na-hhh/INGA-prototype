import { clamp, tempResponse } from './math.js';
import { WATER_UNIT, MINERAL_UNIT } from './soil.js';
import { DETAIL } from './genome.js';

// Cell types. Every cell starts as APEX or MERISTEM and specialises later.
export const TYPE = {
  APEX: 0, // apical cell: the stem cell at the tip of an organ, keeps dividing
  MERISTEM: 1, // young daughter cell, still able to divide
  PARENCHYMA: 2, // living packing and storage tissue
  EPIDERMIS: 3, // skin with a waxy cuticle: first line of defence
  XYLEM: 4, // dies and becomes a woody pipe for water and minerals
  PHLOEM: 5, // living pipe for sugar
  MESOPHYLL: 6, // photosynthesis
  ROOTHAIR: 7, // root skin that absorbs water and minerals
  DEAD: 8,
};
export const TYPE_NAMES = ['Apical cell', 'Meristem', 'Parenchyma', 'Epidermis', 'Xylem', 'Phloem', 'Mesophyll', 'Root hair', 'Dead'];

const FATE = {
  xylem: TYPE.XYLEM,
  phloem: TYPE.PHLOEM,
  parenchyma: TYPE.PARENCHYMA,
  epidermis: TYPE.EPIDERMIS,
  mesophyll: TYPE.MESOPHYLL,
  roothair: TYPE.ROOTHAIR,
};

//                apex  meri  par   epi   xyl   phl   meso  hair  dead
const ABSORB = [0.3, 0.3, 0.5, 0.25, 0.4, 0.5, 0.55, 0.5, 0.8]; // chance to stop a photon
const EFFICIENCY = [0, 0.3, 0, 0.5, 0, 0, 1, 0, 0]; // share of that light turned into sugar

const SINK = [6, 3, 1, 1, 0.3, 1, 1, 1, 0.1]; // how strongly each type draws sugar

const PACK = 0.9; // neighbouring cells sit this fraction of (r1 + r2) apart
const BORN = 0.6; // a new cell starts at this fraction of its mature radius
const HORMONE_REF = 0.15; // hormone level at which an apical cell runs at full speed
const TURN_LENGTH = 0.2; // tropism genes are "per this much growth", whatever the cell size

// Quantities that depend on cell size (see DETAIL in genome.js).
const S = 1 / DETAIL;
const HASH = 0.2 * S; // spatial grid size: must stay above the widest cell's reach
const MAX_CELLS = Math.min(90000, Math.round(22000 * DETAIL * DETAIL));
export const PHOTON_DENSITY = 2 * DETAIL; // photons per unit width, relative to the reference
const YIELD = 0.025 * S; // sugar per absorbed photon
const GRAVITY = 0.0005 * S * S;
const RAY_STEP = 0.07 * S;
const SUGAR_MIN = 0.025 * S * S; // a cell keeps this much back when it pays for growth
const MINERAL_MIN = 0.02 * S * S;
const MINERAL_PER_CELL = 0.0125 * S * S;

// Spatial grid for finding nearby cells: a bucket per HASH-sized square,
// each holding a linked list of cell indices.
const X0 = -34;
const Y0 = -27;
const NX = Math.ceil(68 / HASH);
const NY = Math.ceil(95 / HASH);
const head = new Int32Array(NX * NY);
const next = new Int32Array(MAX_CELLS + 16);
const bucketOf = (x, y) => {
  let i = Math.floor((x - X0) / HASH);
  let j = Math.floor((y - Y0) / HASH);
  i = i < 0 ? 0 : i >= NX ? NX - 1 : i;
  j = j < 0 ? 0 : j >= NY ? NY - 1 : j;
  return i + j * NX;
};

export class Plant {
  constructor(genome, rng, soil) {
    this.g = genome;
    this.rng = rng;
    this.soil = soil;
    this.grad = [0, 0];
    this.photonPaths = new Float32Array(60 * 5); // x0, y0, x1, y1, absorbed
    this.reset();
  }

  reset() {
    this.cells = [];
    this.bonds = [];
    this.instances = [];
    head.fill(-1);
    this.nextId = 0;
    this.time = 0;
    this.uptakeWater = 0;
    this.uptakeMinerals = 0;
    this.recycledSugar = 0;
    this.waterRoom = 0;
    this.mineralRoom = 0;
    this.starved = 0;
    this.dead = false;
    this.photonCount = 0;
    this.photonSerial = 0;
    this.stats = {};

    // The simulation starts from a young sporophyte: one storage cell (the
    // "foot", which in a real fern is fed by the parent gametophyte), one
    // shoot apical cell above it and one root apical cell below.
    const { organs, metabolism } = this.g;
    const y0 = -0.6;
    const shoot = this.addInstance('rhizome', null);
    const root = this.addInstance('root', null);
    const foot = this.newCell(0, y0, 'rhizome', shoot, {
      type: TYPE.PARENCHYMA,
      r: organs.rhizome.cellSize,
      sugar: metabolism.reserve,
      minerals: 4,
      water: 1,
    });
    const up = (organs.rhizome.cellSize * 1.9) * PACK;
    const sa = this.newCell(0, y0 + up, 'rhizome', shoot, { type: TYPE.APEX, px: 0, py: 1, r: organs.rhizome.cellSize * 0.9, sugar: 1 });
    const ra = this.newCell(0, y0 - up, 'root', root, { type: TYPE.APEX, px: 0, py: -1, r: organs.root.cellSize * 0.9, sugar: 1 });
    sa.parent = sa.down = foot;
    ra.parent = foot;
    foot.down = ra;
    shoot.apex = sa;
    root.apex = ra;
    this.anchor = { cell: foot, x: 0, y: y0 };
    this.bond(foot, sa);
    this.bond(foot, ra);
    this.updateStats();
  }

  // --- Structure ------------------------------------------------------------

  addInstance(organ, parent) {
    const id = this.instances.length;
    const inst = {
      id,
      organ,
      parent: parent ? parent.id : -1,
      apex: null,
      born: this.time,
      done: false,
      state: 0, // 0 alive, 1 senescing, 2 dead, 3 shed
      sen: 0,
      deadTime: 0,
      founders: [], // cells of this organ that have founded another
      scale: 1, // size relative to the organ's genome default
      life: this.g.organs[organ].vitality, // hours its apical cell was given
      frond: organ === 'frond' ? id : parent ? parent.frond : -1,
    };
    this.instances.push(inst);
    return inst;
  }

  newCell(x, y, organ, inst, props) {
    const og = this.g.organs[organ];
    const c = {
      id: this.nextId++,
      x,
      y,
      r: og.cellSize * BORN,
      organ,
      inst: inst.id,
      frond: inst.frond,
      root: og.kind === 'root',
      type: TYPE.MERISTEM,
      fate: TYPE.PARENCHYMA,
      depth: 0, // layers out from the organ's central file
      side: 0, // which side of the central file (+1 / -1)
      core: true, // on the central file: part of the vascular strand
      phl: false, // sugar-conducting
      ax: 0, // direction the organ was growing when this cell was born
      ay: 1,
      px: 0, // apical cells only: current growth direction
      py: 1,
      vitality: 0,
      timer: 0,
      tipLife: 1, // how much life the organ's tip had left when this cell was made (1 = base, 0 = tip)
      age: 0,
      alive: true,
      conduct: true,
      health: 1,
      sugar: 0,
      water: 0.8,
      minerals: 0.1,
      auxin: 0,
      cyto: 0,
      aba: 0, // drought hormone
      sa: 0, // salicylic acid: immune alarm
      light: 0,
      photons: 0,
      energy: 0, // light caught but not yet turned into sugar
      infected: 0,
      necrotic: false,
      sen: 0,
      air: false,
      gone: false,
      parent: null,
      down: null, // neighbour that auxin is pumped towards
      nb: [],
      bonds: [],
    };
    Object.assign(c, props);
    c.core = c.depth === 0;
    c.fate = FATE[og.fates[Math.min(c.depth, og.fates.length - 1)]] ?? TYPE.PARENCHYMA;
    c.phl = c.fate === TYPE.PHLOEM;
    this.cells.push(c);
    this.hashAdd(c);
    return c;
  }

  // A bond is a shared cell wall. It remembers the direction it was formed
  // in, which is what makes tissue hold its shape.
  bond(a, b) {
    if (a.nb.includes(b)) return;
    let ux = b.x - a.x;
    let uy = b.y - a.y;
    const l = Math.hypot(ux, uy) || 1;
    const bd = { a, b, ux: ux / l, uy: uy / l };
    this.bonds.push(bd);
    a.nb.push(b);
    b.nb.push(a);
    a.bonds.push(bd);
    b.bonds.push(bd);
  }

  // Adds the newest cell (the last in the list) to the grid.
  hashAdd(c) {
    const i = this.cells.length - 1;
    const b = bucketOf(c.x, c.y);
    next[i] = head[b];
    head[b] = i;
  }

  rebuildHash() {
    head.fill(-1);
    const cells = this.cells;
    for (let i = 0; i < cells.length; i++) {
      const b = bucketOf(cells[i].x, cells[i].y);
      next[i] = head[b];
      head[b] = i;
    }
  }

  // Is there room for a cell of radius r at (x, y)?
  free(x, y, r, ignore) {
    const all = this.cells;
    const ix = Math.floor((x - X0) / HASH);
    const iy = Math.floor((y - Y0) / HASH);
    for (let j = iy - 1; j <= iy + 1; j++) {
      for (let i = ix - 1; i <= ix + 1; i++) {
        if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
        for (let k = head[i + j * NX]; k >= 0; k = next[k]) {
          const o = all[k];
          if (o === ignore || o.gone) continue;
          const min = 0.7 * (r + o.r);
          const dx = o.x - x;
          const dy = o.y - y;
          if (dx * dx + dy * dy < min * min) return false;
        }
      }
    }
    return true;
  }

  bondNearby(c) {
    const all = this.cells;
    const ix = Math.floor((c.x - X0) / HASH);
    const iy = Math.floor((c.y - Y0) / HASH);
    for (let j = iy - 1; j <= iy + 1; j++) {
      for (let i = ix - 1; i <= ix + 1; i++) {
        if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
        for (let k = head[i + j * NX]; k >= 0; k = next[k]) {
          const o = all[k];
          if (o === c || o.gone || o.inst !== c.inst || c.nb.length >= 7) continue;
          const max = (c.r + o.r) * PACK * 1.4;
          const dx = o.x - c.x;
          const dy = o.y - c.y;
          if (dx * dx + dy * dy < max * max) this.bond(o, c);
        }
      }
    }
  }

  // --- One hour of life -----------------------------------------------------

  step(dt, env) {
    if (this.dead) return;
    this.time += dt;
    const fT = tempResponse(env.temperature);
    this.metabolism(dt, fT);
    this.transport(dt);
    this.grow(dt, fT, env);
    this.senescence(dt);
    this.mechanics(env);
    this.registerRoots();
    this.updateStats();
  }

  metabolism(dt, fT) {
    const { hormones: H, metabolism: M } = this.g;
    const cells = this.cells;
    const keepAuxin = 1 - H.auxinDecay * dt;
    const keepCyto = 1 - H.cytokininDecay * dt;
    let living = 0;
    let hungry = 0; // cells that could not pay for their own upkeep this hour
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      c.age += dt;
      const photons = c.photons;
      c.photons = 0;
      c.light += (photons - c.light) * 0.05;
      c.auxin *= keepAuxin;
      c.cyto *= keepCyto;
      c.aba *= 0.85;
      c.sa *= 0.97;
      if (c.y > 1) c.air = true;
      if (c.frond >= 0) c.sen = this.instances[c.frond].sen;
      if (!c.alive) continue;

      // Respiration: every living cell burns sugar; dividing cells burn more.
      c.sugar -= M.respiration * (0.4 + 0.6 * fT) * dt * (c.type <= TYPE.MERISTEM ? 2 : 1);
      living++;
      if (c.sugar < 0) {
        hungry++;
        c.sugar = 0;
        c.health -= 0.008 * dt;
      } else if (c.health < 1) {
        c.health = Math.min(1, c.health + 0.01 * dt);
      }

      const turgor = clamp(c.water);
      if (turgor < 0.15) c.health -= 0.012 * dt;
      if (turgor < 0.6) c.aba += (0.6 - turgor) * 0.4 * dt; // drought alarm
      if (!c.root && c.y > 0) c.water -= 0.0008 * dt; // slow loss through the cuticle

      // Photosynthesis: light + water in, sugar out. Stomata close when the
      // cell is limp or the drought hormone is high, which stops both the
      // water loss and the sugar production.
      const eff = EFFICIENCY[c.type];
      c.energy = c.energy * 0.8 + photons * YIELD;
      if (c.energy > 0 && eff > 0) {
        const stomata = clamp((turgor - 0.3) / 0.3) * (1 - clamp(c.aba * H.abaSensitivity));
        const feedback = clamp(2 - c.sugar / (15 * SUGAR_MIN)); // a cell full of sugar stops making more
        const used = Math.min(c.energy, M.photosynthesis * dt);
        c.energy -= used;
        const made = used * eff * stomata * fT * feedback * (1 - c.sen);
        c.sugar += made;
        c.water -= made * M.waterUse;
      }
      if (c.water < 0) c.water = 0;

      // Hormone sources.
      if (c.type === TYPE.APEX) {
        if (c.root) c.cyto += H.cytokininProduction * 0.5 * dt;
        else c.auxin += H.auxinProduction * 0.5 * dt;
      }

      if (c.infected > 0) this.infection(c, dt);
      if (c.health <= 0 && c.alive) this.kill(c);
    }
    // Starving means cells going unfed, not merely a pool run low by growth.
    this.starved = hungry > living * 0.2 ? this.starved + dt : Math.max(0, this.starved - dt);
  }

  kill(c) {
    c.alive = false;
    c.conduct = c.core; // a dead vascular strand still works as a pipe
    if (c.type === TYPE.APEX) this.instances[c.inst].done = true;
    c.type = TYPE.DEAD;
  }

  // --- Immunity -------------------------------------------------------------
  // Plants have no travelling immune cells: every cell defends itself. An
  // infected cell that recognises the pathogen kills itself to starve it
  // (the hypersensitive response) and warns its neighbours with salicylic
  // acid, which makes them harder to infect.

  defense(c) {
    const I = this.g.immunity;
    return clamp((c.type === TYPE.EPIDERMIS ? I.cuticle : 0.45) + I.priming * c.sa, 0, 0.98);
  }

  infection(c, dt) {
    const { rng } = this;
    c.infected += 0.04 * dt;
    c.sugar = Math.max(0, c.sugar - 0.01 * dt);
    for (let i = 0; i < c.nb.length; i++) {
      const nb = c.nb[i];
      if (nb.alive && nb.infected === 0 && rng() < 0.025 * dt * (1 - this.defense(nb))) nb.infected = 0.05;
    }
    if (rng() < this.g.immunity.sensitivity * dt) {
      for (let i = 0; i < c.nb.length; i++) c.nb[i].sa += 1;
      c.infected = 0;
      c.necrotic = true;
      this.kill(c);
    } else if (c.infected >= 1) {
      c.infected = 0;
      this.kill(c);
    }
  }

  // A spore lands on a random exposed cell.
  infect() {
    const { rng, cells } = this;
    for (let tries = 0; tries < 30; tries++) {
      const c = cells[Math.floor(rng() * cells.length)];
      if (!c || !c.alive || c.y < 0.5 || c.infected > 0) continue;
      if (c.depth !== this.g.organs[c.organ].layers) continue;
      if (rng() > this.defense(c)) c.infected = 0.05;
      return;
    }
  }

  // --- Transport ------------------------------------------------------------
  // Cells never move. What moves is what they carry: water and minerals up
  // the xylem, sugar through the phloem, hormones from cell to cell.

  transport(dt) {
    const cells = this.cells;
    const bonds = this.bonds;

    // The vascular strand is fast compared to an hour, so within one step it
    // simply evens out along its whole length. The central file of every
    // organ stands for a whole vascular bundle: the xylem pipes plus the
    // phloem that runs alongside them.
    let nx = 0, water = 0, minerals = 0, cyto = 0, sugar = 0, pull = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c.conduct || c.type === TYPE.APEX || !(c.core || c.phl)) continue;
      nx++;
      water += c.water;
      minerals += c.minerals;
      cyto += c.cyto;
      sugar += c.sugar;
      pull += SINK[c.type];
    }
    water += this.uptakeWater * WATER_UNIT;
    minerals += this.uptakeMinerals * MINERAL_UNIT;
    this.uptakeWater = this.uptakeMinerals = 0;
    if (nx > 0) {
      sugar += this.recycledSugar;
      this.recycledSugar = 0;
      water /= nx;
      minerals /= nx;
      cyto /= nx;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (!c.conduct || c.type === TYPE.APEX || !(c.core || c.phl)) continue;
        c.water = water;
        c.minerals = minerals;
        c.cyto = cyto;
        c.sugar = (sugar * SINK[c.type]) / pull; // shared out by demand
      }
    }

    // Short-range exchange through shared walls, back and forth.
    const n = bonds.length;
    for (let sweep = 0; sweep < 4; sweep++) {
      const forward = sweep % 2 === 0;
      for (let k = 0; k < n; k++) {
        const bd = bonds[forward ? k : n - 1 - k];
        const a = bd.a;
        const b = bd.b;
        if (!a.conduct || !b.conduct) continue;
        const fast = a.core && b.core;
        const ks = fast ? 0.45 : 0.22;
        // Sugar flows towards demand: growing cells pull harder than mature
        // ones, so tips are fed first.
        const ca = SINK[a.type];
        const cb = SINK[b.type];
        let d = ((a.sugar * cb - b.sugar * ca) / (ca + cb)) * ks * 2;
        a.sugar -= d;
        b.sugar += d;
        d = (a.water - b.water) * ks;
        a.water -= d;
        b.water += d;
        d = (a.minerals - b.minerals) * ks;
        a.minerals -= d;
        b.minerals += d;
        d = (a.cyto - b.cyto) * 0.25;
        a.cyto -= d;
        b.cyto += d;
        d = (a.auxin - b.auxin) * 0.08;
        a.auxin -= d;
        b.auxin += d;
        d = (a.aba - b.aba) * 0.2;
        a.aba -= d;
        b.aba += d;
        d = (a.sa - b.sa) * 0.15;
        a.sa -= d;
        b.sa += d;
      }
    }

    // Auxin is actively pumped in one direction: from shoot tips down to the
    // base, then on towards the root tips.
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const to = c.down;
      if (to && c.conduct && to.conduct && c.auxin > 0) {
        const t = c.auxin * 0.3;
        c.auxin -= t;
        to.auxin += t;
      }
    }
  }

  // --- Growth ---------------------------------------------------------------

  grow(dt, fT, env) {
    const { organs, metabolism: M, rules } = this.g;
    const cells = this.cells;
    const ruleList = Object.values(rules);
    const count = cells.length; // cells born this hour wait until the next
    for (let i = 0; i < count; i++) {
      const c = cells[i];
      if (!c.alive) continue;
      const og = organs[c.organ];
      const turgor = clamp(c.water);

      // Expansion: turgor pressure stretches the wall, sugar builds new wall.
      const target = og.cellSize * (c.type === TYPE.APEX ? 0.9 : 1);
      if (c.r < target && turgor > 0.5 && c.sugar > SUGAR_MIN * 1.6) {
        const dr = Math.min(target - c.r, 0.04 * og.cellSize * fT * dt);
        c.r += dr;
        c.sugar -= (dr / (og.cellSize * (1 - BORN))) * M.expansionCost;
      }

      if (c.type === TYPE.APEX) {
        this.apexStep(c, og, dt, fT, turgor, env);
        continue;
      }

      const canPay = c.sugar >= M.divisionCost + SUGAR_MIN && c.minerals >= MINERAL_MIN && turgor > 0.5 && cells.length < MAX_CELLS;

      if (c.type === TYPE.MERISTEM) {
        if (c.age >= og.window) {
          this.specialise(c);
        } else if (canPay && c.depth < og.layers && c.age - c.timer >= 2) {
          this.divideOutward(c, og);
        }
      }

      // Founding a new organ from a surface cell.
      if (canPay && c.depth === og.layers && c.age > 4 && c.age < og.competence) {
        for (let k = 0; k < ruleList.length; k++) {
          const rule = ruleList[k];
          if (rule.parent !== c.organ) continue;
          if (c.auxin < rule.auxinMin) continue;
          if (rule.where === 'above' && c.y < 0.2) continue;
          if (rule.where === 'below' && c.y > -0.2) continue;
          if (this.rng() >= rule.rate * dt * (c.root ? this.rootNeed(c) : 1)) continue;
          this.foundOrgan(c, og, rule);
          break;
        }
      }
    }
  }

  apexStep(c, og, dt, fT, turgor, env) {
    const M = this.g.metabolism;
    if (og.vitality > 0) {
      c.vitality -= dt * fT;
      if (c.vitality <= 0) {
        // The apical cell retires: the organ has reached its final size.
        c.type = TYPE.MERISTEM;
        this.instances[c.inst].done = true;
        return;
      }
    }
    // Roots only grow as fast as the shoot sends auxin; shoots only as fast
    // as the roots send cytokinin. That keeps the two halves in balance.
    const signal = clamp(0.5 + (c.root ? c.auxin : c.cyto) / HORMONE_REF);
    // Roots work hard only while the plant is short of water or minerals;
    // shoots slow down when the drought hormone is high.
    const drought = c.root ? this.rootNeed(c) : 1 - 0.7 * clamp(c.aba);
    const alarm = c.sa > 0.3 ? 0.7 : 1; // defence costs growth
    c.timer += dt * fT * signal * drought * alarm * clamp(turgor * 2 - 0.6);
    // Fine cells divide more than once an hour.
    for (let n = 0; n < 4 && c.timer >= og.cycle; n++) {
      if (!this.divideApex(c, og, env)) break;
    }
    if (c.timer > og.cycle * 2) c.timer = og.cycle * 2;
  }

  // The apical cell divides: returns false if it could not.
  divideApex(c, og, env) {
    const M = this.g.metabolism;
    if (c.sugar < M.divisionCost + SUGAR_MIN * 1.6 || c.minerals < (c.root ? MINERAL_MIN * 0.4 : MINERAL_MIN) || this.cells.length >= MAX_CELLS) return false;

    // Decide which way to grow from what the cell can sense.
    const rng = this.rng;
    const r0 = og.cellSize * BORN;
    const stride = (c.r + r0) * PACK;
    const turn = stride / TURN_LENGTH; // how much of a "turn length" this step covers
    const jitter = og.wander * Math.sqrt(turn) * 2;
    let px = c.px + jitter * (rng() + rng() + rng() - 1.5);
    let py = c.py + jitter * (rng() + rng() + rng() - 1.5) + og.gravitropism * turn;
    if (c.root) {
      const grad = this.soil.waterGradient(c.x, c.y, this.grad);
      px += og.hydrotropism * grad[0] * turn;
      py += og.hydrotropism * grad[1] * turn;
    } else {
      px += og.phototropism * env.lightX * turn;
      py += og.phototropism * env.lightY * turn;
    }
    let l = Math.hypot(px, py) || 1;
    px /= l;
    py /= l;

    let nx = c.x + px * stride;
    let ny = c.y + py * stride;
    if (c.root) {
      // Roots stay in the soil and turn along its edges.
      const { half, depth } = this.soil;
      if (Math.abs(nx) > half - 0.5) px = -px;
      if (ny > -0.3) py = -Math.abs(py) - 0.2;
      if (ny < -depth + 0.5) {
        py = Math.abs(py) * 0.2;
        px += px >= 0 ? 0.5 : -0.5;
      }
      l = Math.hypot(px, py) || 1;
      px /= l;
      py /= l;
      nx = c.x + px * stride;
      ny = c.y + py * stride;
    }
    if (!this.free(nx, ny, c.r, c)) {
      // Something is in the way: try a slightly different heading next hour.
      const a = (rng() - 0.5) * 0.8;
      c.px = px * Math.cos(a) - py * Math.sin(a);
      c.py = px * Math.sin(a) + py * Math.cos(a);
      return false;
    }

    // Divide. The daughter takes the apical cell's place and neighbours;
    // the apical cell itself moves on one step.
    const inst = this.instances[c.inst];
    const d = this.newCell(c.x, c.y, c.organ, inst, { ax: px, ay: py, depth: 0, tipLife: inst.life > 0 ? clamp(c.vitality / inst.life) : 1 });
    c.sugar -= M.divisionCost;
    c.minerals -= MINERAL_PER_CELL;
    d.sugar = c.sugar * 0.4;
    c.sugar *= 0.6;
    d.minerals = c.minerals * 0.5;
    c.minerals *= 0.5;
    d.water = c.water;
    d.auxin = c.auxin;
    d.cyto = c.cyto;
    for (let i = 0; i < c.bonds.length; i++) {
      const bd = c.bonds[i];
      const other = bd.a === c ? bd.b : bd.a;
      if (bd.a === c) bd.a = d;
      else bd.b = d;
      other.nb[other.nb.indexOf(c)] = d;
      d.nb.push(other);
      d.bonds.push(bd);
    }
    c.nb = [];
    c.bonds = [];
    c.x = nx;
    c.y = ny;
    this.bond(d, c);

    d.parent = c.parent;
    if (c.root) {
      d.down = c;
      if (c.parent && c.parent.down === c) c.parent.down = d;
    } else {
      d.down = c.parent;
      c.down = d;
    }
    c.parent = d;
    c.px = px;
    c.py = py;
    c.timer -= og.cycle;
    return true;
  }

  rootNeed(c) {
    // ...and only as far as there is sugar to spare for them.
    return clamp(0.25 + Math.max((0.9 - c.water) / 0.4, (3 * MINERAL_MIN - c.minerals) / (1.75 * MINERAL_MIN))) * clamp((c.sugar / SUGAR_MIN) * 0.05 - 0.3);
  }

  // A young cell adds a daughter on its free outer side. Repeating this
  // `layers` times is what gives an organ its thickness.
  divideOutward(c, og) {
    const M = this.g.metabolism;
    const nx = -c.ay;
    const ny = c.ax;
    const r0 = og.cellSize * BORN;
    const stride = (c.r + r0) * PACK;
    const first = c.depth === 0 ? (this.rng() < 0.5 ? 1 : -1) : c.side;
    for (let t = 0; t < (c.depth === 0 ? 2 : 1); t++) {
      const side = t === 0 ? first : -first;
      const x = c.x + nx * side * stride;
      const y = c.y + ny * side * stride;
      if (c.root && (y > -0.1 || Math.abs(x) > this.soil.half - 0.2 || y < -this.soil.depth + 0.2)) continue;
      if (!this.free(x, y, r0, c)) continue;
      const d = this.newCell(x, y, c.organ, this.instances[c.inst], { ax: c.ax, ay: c.ay, depth: c.depth + 1, side, tipLife: c.tipLife });
      c.sugar -= M.divisionCost;
      c.minerals -= MINERAL_PER_CELL;
      d.sugar = c.sugar * 0.35;
      c.sugar *= 0.65;
      d.minerals = c.minerals * 0.4;
      c.minerals *= 0.6;
      d.water = c.water;
      d.auxin = c.auxin;
      d.cyto = c.cyto;
      d.parent = d.down = c;
      this.bond(c, d);
      this.bondNearby(d);
      c.timer = c.age;
      return;
    }
  }

  specialise(c) {
    c.type = c.fate;
    if (c.type === TYPE.XYLEM) {
      // Xylem finishes by dying: the wall is reinforced with lignin, the
      // contents are cleared out, and what is left is a hollow pipe.
      c.alive = false;
    }
  }

  foundOrgan(c, og, rule) {
    const organs = this.g.organs;
    const cg = organs[rule.child];
    if (!cg) return;
    const parentInst = this.instances[c.inst];
    // Where along its organ this cell sits decides whether it may branch
    // (not on the bare stalk) and how big the branch will get.
    const determinate = parentInst.life > 0;
    if (determinate && og.stipe > 0 && 1 - c.tipLife < og.stipe) return;
    const side = c.side || (this.rng() < 0.5 ? 1 : -1);
    const ox = -c.ay * side;
    const oy = c.ax * side;
    const out = 1 - Math.abs(rule.lean);
    let px = ox * out + c.ax * rule.lean;
    let py = oy * out + c.ay * rule.lean;
    const l = Math.hypot(px, py) || 1;
    px /= l;
    py /= l;
    const r = cg.cellSize * 0.9;
    const stride = (c.r + r) * PACK;
    const x = c.x + px * stride;
    const y = c.y + py * stride;
    if (cg.kind === 'root' && y > -0.2) return;
    // Young organs keep a zone around themselves clear of rivals. This is
    // what spaces pinnae along a frond and makes them alternate sides.
    const rivals = parentInst.founders;
    for (let i = rivals.length - 1; i >= 0; i--) {
      const f = rivals[i];
      if (f.cell.gone || f.inst.state >= 2) {
        rivals.splice(i, 1); // that organ is dead: its spot is free again
        continue;
      }
      if (f.rule === rule && Math.hypot(f.cell.x - c.x, f.cell.y - c.y) < rule.spacing) return;
    }
    if (!this.free(x, y, r, c)) return;

    const scale = (rule.child === rule.parent ? parentInst.scale : 1) * (rule.scale ?? 1);
    let vitality = cg.vitality * scale;
    if (rule.taper > 0 && determinate) vitality *= Math.pow(clamp(c.tipLife, 0.05, 1), rule.taper);
    if (cg.vitality > 0 && vitality < cg.cycle * 3) return; // too small to be worth building
    const inst = this.addInstance(rule.child, parentInst);
    inst.scale = scale;
    inst.life = vitality;
    const a = this.newCell(x, y, rule.child, inst, { type: TYPE.APEX, r, px, py, ax: px, ay: py, vitality, depth: 0 });
    inst.apex = a;
    const M = this.g.metabolism;
    c.sugar -= M.divisionCost;
    a.sugar = c.sugar * 0.5;
    c.sugar *= 0.5;
    a.minerals = c.minerals * 0.5;
    c.minerals *= 0.5;
    a.water = c.water;
    a.parent = c;
    if (cg.kind !== 'root') a.down = c;
    parentInst.founders.push({ cell: c, inst, rule });
    this.bond(c, a);
  }

  // --- Ageing ---------------------------------------------------------------

  senescence(dt) {
    const { organs } = this.g;
    const instances = this.instances;
    let oldest = null;
    let shed = false;
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const og = organs[inst.organ];
      if (!og || og.lifespan <= 0 || inst.state === 3) continue;
      if (inst.state === 0) {
        if (this.time - inst.born > og.lifespan * 24) inst.state = 1;
        else if (!oldest) oldest = inst;
      } else if (inst.state === 1) {
        inst.sen = Math.min(1, inst.sen + dt / 96);
        if (inst.sen >= 1) {
          inst.state = 2;
          // Salvage what can be salvaged before the frond dies.
          for (const c of this.cells) {
            if (c.frond !== inst.id) continue;
            if (c.alive) {
              this.recycledSugar += c.sugar * 0.5;
              this.uptakeMinerals += (c.minerals * 0.5) / MINERAL_UNIT;
            }
            c.alive = false;
            c.conduct = false;
            c.type = TYPE.DEAD;
          }
        }
      } else if (inst.state === 2) {
        inst.deadTime += dt;
        if (inst.deadTime > 150) {
          inst.state = 3;
          for (const c of this.cells) if (c.frond === inst.id) c.gone = true;
          shed = true;
        }
      }
    }
    // A plant that has run out of sugar gives up its oldest frond.
    if (this.starved > 72 && oldest) {
      oldest.state = 1;
      this.starved = 0;
    }
    if (shed) this.compact();
  }

  compact() {
    this.cells = this.cells.filter((c) => !c.gone);
    this.bonds = this.bonds.filter((b) => !b.a.gone && !b.b.gone);
    for (const c of this.cells) {
      c.nb = [];
      c.bonds = [];
      if (c.down && c.down.gone) c.down = null;
      if (c.parent && c.parent.gone) c.parent = null;
    }
    for (const bd of this.bonds) {
      bd.a.nb.push(bd.b);
      bd.b.nb.push(bd.a);
      bd.a.bonds.push(bd);
      bd.b.bonds.push(bd);
    }
  }

  // --- Physics --------------------------------------------------------------
  // Each wall pulls its two cells back towards the offset it was built at.
  // Stiffness comes from turgor: a cell short of water is limp, so a thirsty
  // frond sags under its own weight and a watered one stands back up.

  mechanics(env) {
    const cells = this.cells;
    const bonds = this.bonds;
    const gust = env.wind * 0.012 * Math.sin(this.time * 0.7) * (0.5 + this.rng());
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.y > 0 && !c.root) {
        c.y -= GRAVITY * (c.alive ? 1 : 1.5);
        c.x += gust * Math.min(1, c.y / 12);
      }
    }
    for (let it = 0; it < 3; it++) {
      for (let k = 0; k < bonds.length; k++) {
        const bd = bonds[k];
        const a = bd.a;
        const b = bd.b;
        const ta = a.alive ? clamp(a.water) : a.core ? 0.9 : 0.3;
        const tb = b.alive ? clamp(b.water) : b.core ? 0.9 : 0.3;
        const len = (a.r * (0.85 + 0.15 * ta) + b.r * (0.85 + 0.15 * tb)) * PACK;
        const ex = a.x + bd.ux * len - b.x;
        const ey = a.y + bd.uy * len - b.y;
        const wa = (a.y < 0 ? 0.08 : 1) * 0.3; // soil grips; older tissue carries the load
        const wb = b.y < 0 ? 0.08 : 1;
        const f = (0.45 + 0.5 * Math.min(ta, tb)) / (wa + wb);
        b.x += ex * wb * f;
        b.y += ey * wb * f;
        a.x -= ex * wa * f;
        a.y -= ey * wa * f;
        // Young walls are still plastic and slowly take on their new shape.
        if (it === 0 && a.age < 60 && b.age < 60) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const l = Math.hypot(dx, dy) || 1;
          const ux = bd.ux + 0.03 * (dx / l - bd.ux);
          const uy = bd.uy + 0.03 * (dy / l - bd.uy);
          const ul = Math.hypot(ux, uy) || 1;
          bd.ux = ux / ul;
          bd.uy = uy / ul;
        }
      }
    }

    // The base of the plant is held by the soil.
    if (!this.anchor.cell.gone) {
      const dx = this.anchor.x - this.anchor.cell.x;
      const dy = this.anchor.y - this.anchor.cell.y;
      for (let i = 0; i < cells.length; i++) {
        cells[i].x += dx;
        cells[i].y += dy;
      }
    }

    // Separate organs cannot pass through each other, or through the ground.
    this.rebuildHash();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.air && c.y < c.r) c.y = c.r;
      const ix = Math.floor((c.x - X0) / HASH);
      const iy = Math.floor((c.y - Y0) / HASH);
      for (let j = iy - 1; j <= iy + 1; j++) {
        for (let q = ix - 1; q <= ix + 1; q++) {
          if (q < 0 || j < 0 || q >= NX || j >= NY) continue;
          for (let k = head[q + j * NX]; k >= 0; k = next[k]) {
            const o = cells[k];
            if (o.id <= c.id || o.inst === c.inst) continue;
            const min = 0.85 * (c.r + o.r);
            const dx = o.x - c.x;
            const dy = o.y - c.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min || d2 === 0 || c.nb.includes(o)) continue;
            const d = Math.sqrt(d2);
            const push = ((min - d) / d) * 0.25;
            const wc = c.y < 0 ? 0.3 : 1;
            const wo = o.y < 0 ? 0.3 : 1;
            c.x -= dx * push * wc;
            c.y -= dy * push * wc;
            o.x += dx * push * wo;
            o.y += dy * push * wo;
          }
        }
      }
    }
  }

  // --- Roots and soil -------------------------------------------------------

  // Tells the soil where absorbing root surface is, and how much water and
  // mineral the plant currently has room for.
  registerRoots() {
    const { soil, cells } = this;
    const organs = this.g.organs;
    soil.absorb.fill(0);
    let water = 0;
    let minerals = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.conduct) water += Math.max(0, 1 - c.water);
      if (!c.alive) continue;
      minerals += Math.max(0, 10 * MINERAL_MIN - c.minerals);
      if (c.root && c.y < 0 && (c.type === TYPE.APEX || c.depth === organs[c.organ].layers)) {
        soil.absorb[soil.idx(c.x, c.y)] += c.age < 500 ? 1 : 0.35;
      }
    }
    this.waterRoom = Math.ceil(water / WATER_UNIT - 0.3);
    this.mineralRoom = Math.round(minerals / MINERAL_UNIT);
  }

  // --- Light ----------------------------------------------------------------

  // Fires photons along the sun's direction and lets cells catch them.
  // (sx, sy) points towards the sun; flux is photons per unit width per hour.
  trace(sx, sy, flux) {
    const { cells, rng } = this;
    let minX = Infinity, maxX = -Infinity, maxY = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.y <= 0) continue;
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }
    this.photonCount = 0;
    if (maxY <= 0) return;
    const top = maxY + 1;
    const slope = sx / sy; // sideways drift per unit of height
    // Entry points along the top edge, widened so slanted light still covers
    // the whole plant.
    const span = maxX - minX + 2 + Math.abs(slope) * top;
    const start = minX - 1 + Math.min(0, slope * top);
    const count = Math.min(8000, Math.round(flux * PHOTON_DENSITY * span * sy));
    const paths = this.photonPaths;
    const dx = -sx * RAY_STEP;
    const dy = -sy * RAY_STEP;
    for (let p = 0; p < count; p++) {
      let x = start + rng() * span;
      let y = top;
      const startX = x;
      let last = null;
      let absorbed = 0;
      while (y > 0) {
        const ix = Math.floor((x - X0) / HASH - 0.5);
        const iy = Math.floor((y - Y0) / HASH - 0.5);
        let hit = null;
        for (let j = iy; j <= iy + 1 && !hit; j++) {
          for (let i = ix; i <= ix + 1 && !hit; i++) {
            if (i < 0 || j < 0 || i >= NX || j >= NY) continue;
            for (let k = head[i + j * NX]; k >= 0; k = next[k]) {
              const c = cells[k];
              if (c === last || c.y <= 0) continue;
              const ex = c.x - x;
              const ey = c.y - y;
              if (ex * ex + ey * ey < c.r * c.r) {
                hit = c;
                break;
              }
            }
          }
        }
        if (hit) {
          if (rng() < ABSORB[hit.type]) {
            hit.photons++;
            absorbed = 1;
            break;
          }
          last = hit; // passed straight through
        }
        x += dx;
        y += dy;
      }
      if (this.photonCount < 60 && (absorbed || rng() < 0.15)) {
        const o = this.photonCount++ * 5;
        paths[o] = startX;
        paths[o + 1] = top;
        paths[o + 2] = x;
        paths[o + 3] = Math.max(0, y);
        paths[o + 4] = absorbed;
      }
    }
    this.photonSerial++;
  }

  // --- Summary --------------------------------------------------------------

  updateStats() {
    const cells = this.cells;
    const byType = new Array(TYPE_NAMES.length).fill(0);
    let alive = 0, sugar = 0, water = 0, height = 0, depth = 0, infected = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      byType[c.type]++;
      if (c.y > height) height = c.y;
      if (c.y < depth) depth = c.y;
      if (!c.alive) continue;
      alive++;
      sugar += c.sugar;
      water += clamp(c.water);
      if (c.infected > 0) infected++;
    }
    let fronds = 0, pinnae = 0, pinnules = 0, roots = 0;
    for (const inst of this.instances) {
      if (inst.state >= 2) continue;
      if (inst.organ === 'frond') fronds++;
      else if (inst.organ === 'pinna' || inst.organ === 'pinnule') {
        const f = this.instances[inst.frond];
        if (f && f.state < 2) inst.organ === 'pinna' ? pinnae++ : pinnules++;
      } else if (this.g.organs[inst.organ]?.kind === 'root') roots++;
    }
    if (alive === 0 && cells.length > 0) this.dead = true;
    this.stats = {
      cells: cells.length,
      alive,
      byType,
      fronds,
      pinnae,
      pinnules,
      roots,
      height,
      depth: -depth,
      sugar,
      turgor: alive ? water / alive : 0,
      infected,
    };
  }
}
