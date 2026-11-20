// Runs the simulation without graphics and prints how the plant develops.
// Usage: node plants/scripts/headless.mjs [days] [key=value ...]   e.g. watering=0
import { params } from '../src/params.js';
import { createGenome } from '../src/sim/genome.js';
import { Simulation } from '../src/sim/simulation.js';

const days = Number(process.argv[2] ?? 60);
for (const arg of process.argv.slice(3)) {
  const [k, v] = arg.split('=');
  if (k in params.environment) params.environment[k] = Number(v);
  else if (k === 'seed') params.simulation.seed = Number(v);
}
const sim = new Simulation(params, createGenome());
const t0 = performance.now();
console.log('day cells alive fronds pinnae roots height depth sugar turgor infected dead | soilW soilM | types');
for (let d = 1; d <= days; d++) {
  for (let h = 0; h < 24; h++) sim.step();
  if (d % 5 === 0 || d === 1) {
    const s = sim.plant.stats;
    console.log(
      [d, s.cells, s.alive, s.fronds, s.pinnae + '/' + s.pinnules, s.roots, s.height.toFixed(1), s.depth.toFixed(1), s.sugar.toFixed(1), s.turgor.toFixed(2), s.infected, s.byType[8]].join(' '),
      '|', sim.soil.water.n, sim.soil.minerals.n, '|', s.byType.join(','),
    );
  }
}
console.log(`${((performance.now() - t0) / (days * 24)).toFixed(2)} ms per step`);
